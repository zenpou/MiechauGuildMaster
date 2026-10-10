import { effectiveStats } from '../core/adventurer';
import { canEquip, equip, unequip } from '../core/equipment';
import { advanceDay, buyItem, dailyCost, newGame, sellMaterial } from '../core/game';
import { ITEM, JOB, PERSONALITY } from '../core/data';
import { REP_LEVELS, repLevel } from '../core/quests';
import { capacity, dismiss } from '../core/recruit';
import { STAT_KEYS, type Adventurer, type EquipSlot, type ItemDef, type Result } from '../core/types';
import { advById, commit, render, replaceState, SLOTS, STAT_LABEL, state, statusText, toast, ui } from './app';
import { div, h, span } from './dom';

const ELEMENT_NAME: Record<string, string> = { fire: '火', ice: '氷', thunder: '雷', earth: '土', dark: '闇' };
const EFFECT_NAME: Record<string, string> = { gather: '採取量', carry: '積載' };
const ARMOR_NAME: Record<string, string> = { light: '軽装', medium: '中装', heavy: '重装' };
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const slotsOf = (a: Adventurer) => a.equipment ?? { weapon: null, armor: null, accessory: null };

/** 「攻撃+3 闇耐性30%」のような装備の効果文 */
function equipText(def: ItemDef | undefined): string {
  const e = def?.equip;
  if (!e) return '';
  const parts = Object.entries(e.mods).map(([k, v]) => `${STAT_LABEL[k as keyof typeof STAT_LABEL] ?? k}${sign(v as number)}`);
  for (const [k, v] of Object.entries(e.resist ?? {})) parts.push(`${ELEMENT_NAME[k] ?? k}耐性${Math.round((v as number) * 100)}%`);
  for (const [k, v] of Object.entries(e.effects ?? {})) parts.push(`${EFFECT_NAME[k] ?? k}${sign(v)}`);
  return parts.join(' ');
}

export function homeTab(): HTMLElement {
  const s = state;
  const potion = ITEM.potion;
  return div('tab-body',
    div('summary',
      span('big', `${s.day}日目`),
      span(s.gold < 0 ? 'big neg' : 'big', `${s.gold}G`),
      span('dim', `1日の支出 ${dailyCost(s)}G`),
    ),
    repBlock(),
    h('button', { class: 'primary wide', onclick: nextDay }, '次の日へ'),
    sceneBlock(),
    noticesBlock(),
    h('h2', null, `名簿(${s.adventurers.length}/${capacity(s)}人)`),
    div('dim small', '名前を押すと装備を付け替えられます。解雇は待機中の者だけ(費用なし)。'),
    div('scroll',
      h('table', null,
        h('thead', null, h('tr', null, ...['名前', '職', '武器', '防具', '装飾', '性格', 'Lv', '疲労', '負傷', '忠誠', '日給', '状態', ''].map((t) => h('th', null, t)))),
        h('tbody', null, ...s.adventurers.map((a) => h('tr', { class: ui.selAdv === a.id ? 'sel' : '' },
          h('td', null, h('button', { class: 'link', onclick: () => pickAdv(a.id) }, a.name)),
          h('td', null, JOB[a.job].name),
          ...SLOTS.map((sl) => { const id = slotsOf(a)[sl.id]; return h('td', id ? null : { class: 'dim' }, id ? ITEM[id]?.name ?? id : '—'); }),
          h('td', null, PERSONALITY[a.personality]?.name ?? a.personality),
          h('td', { class: 'num' }, a.level),
          h('td', { class: 'num' }, a.fatigue),
          h('td', { class: 'num' }, a.injuryDays || '-'),
          h('td', { class: 'num' }, a.loyalty),
          h('td', { class: 'num' }, `${a.salary}G`),
          h('td', null, statusText(a)),
          h('td', null, a.status === 'idle' ? h('button', { class: 'small danger', onclick: () => fire(a) }, '解雇') : null),
        ))),
      ),
    ),
    equipPanel(),
    h('h2', null, '在庫'),
    inventoryBlock(),
    div('row',
      h('button', { onclick: () => buy(1) }, `${potion.name}を買う(${potion.price}G)`),
    ),
    h('h2', null, '台帳(最近10件)'),
    h('ul', { class: 'plain small' }, ...s.ledger.slice(0, 10).map((l) =>
      h('li', null, span('dim', `${l.day}日目 `), l.label, ' ', span(l.amount < 0 ? 'neg' : 'pos', `${l.amount > 0 ? '+' : ''}${l.amount}G`)))),
    div('row footer',
      span('dim small', `seed ${s.seed}`),
      h('button', { class: 'danger', onclick: restart }, '新しく始める'),
    ),
  );
}

function repBlock(): HTMLElement {
  const lv = repLevel(state.rep);
  const next = REP_LEVELS[lv];
  return div('summary small',
    span(null, `評判 ${state.rep}`),
    span('badge', `Lv${lv}/${REP_LEVELS.length}`),
    span('dim', next === undefined ? '最高段階' : `次の段階まで ${next - state.rep}`),
  );
}

/** 最新の噂。本音はギルドマスターにしか見えない */
function sceneBlock(): HTMLElement | null {
  const sc = state.scenes[0];
  if (!sc) return null;
  return div('detail scene',
    div('small dim', `${sc.day}日目の噂(評判+${sc.rep})`),
    ...sc.lines.map((l) => div('scene-line', l)),
    div('thought', `(本音)${sc.thought}`),
  );
}

function noticesBlock(): HTMLElement | null {
  const list = state.notices.slice(0, 8);
  if (!list.length) return null;
  return div('notices',
    h('h2', null, 'お知らせ'),
    h('ul', { class: 'plain' }, ...list.map((n) => h('li', { class: n.day === state.day ? 'fresh' : 'dim' }, `${n.day}日目 `, n.text))),
  );
}

const KIND_GROUPS: { name: string; kinds: string[] }[] = [
  { name: '素材', kinds: ['material'] },
  { name: '装備', kinds: ['weapon', 'armor', 'accessory'] },
  { name: '消耗品', kinds: ['consumable'] },
];

function inventoryBlock(): HTMLElement {
  const entries = Object.entries(state.inventory).filter(([, n]) => n > 0);
  if (!entries.length) return div('dim', '何も無い');
  const known = new Set(KIND_GROUPS.flatMap((g) => g.kinds));
  const groups = [...KIND_GROUPS, { name: 'その他', kinds: [] as string[] }].map((g) => ({
    name: g.name,
    list: entries.filter(([id]) => (g.kinds.length ? g.kinds.includes(ITEM[id]?.kind) : !known.has(ITEM[id]?.kind))),
  })).filter((g) => g.list.length);
  return div(null, ...groups.map((g) => div(null,
    h('h3', null, g.name),
    h('ul', { class: 'plain inv' }, ...g.list.map(([id, n]) => {
      const def = ITEM[id];
      const sellable = def?.kind === 'material';
      const fx = equipText(def);
      return h('li', null,
        span(null, `${def?.name ?? id} ×${n}`),
        fx ? span('dim small', ` ${fx}`) : null,
        sellable ? span('dim small', ` (${def.price}G)`) : null,
        sellable ? h('button', { class: 'small', onclick: () => sell(id, 1) }, '1つ売る') : null,
        sellable && n > 1 ? h('button', { class: 'small', onclick: () => sell(id, n) }, '全部売る') : null,
      );
    })),
  )), div('dim small', '売れるのは素材だけです。'));
}

function pickAdv(id: string) {
  ui.selAdv = ui.selAdv === id ? null : id;
  render();
}

/** 付け替えた場合の実効能力。変わる能力だけ「前→後」で返す */
function statDiff(a: Adventurer, slot: EquipSlot, itemId: string | null): string {
  const before = effectiveStats(a);
  const after = effectiveStats({ ...a, equipment: { ...slotsOf(a), [slot]: itemId } });
  const out = STAT_KEYS.filter((k) => before[k] !== after[k]).map((k) => `${STAT_LABEL[k]} ${before[k]}→${after[k]}`);
  return out.length ? out.join(' / ') : '能力の変化なし';
}

function equipPanel(): HTMLElement | null {
  const a = ui.selAdv ? advById(ui.selAdv) : undefined;
  if (!a) return null;
  const idle = a.status === 'idle';
  const st = effectiveStats(a);
  const eq = slotsOf(a);
  return div('detail equip',
    div('row tight', span('big', a.name), span('dim small', `${JOB[a.job].name} Lv${a.level} 着られる防具: ${JOB[a.job].armor.map((c) => ARMOR_NAME[c] ?? c).join('・')}`),
      h('button', { class: 'small', onclick: () => pickAdv(a.id) }, '閉じる')),
    div('small stats', ...STAT_KEYS.map((k) => span(null, `${STAT_LABEL[k]}${st[k]}`))),
    idle ? null : div('small neg', `${statusText(a)}のため付け替えできません(待機中のみ)`),
    ...SLOTS.map((sl) => {
      const cur = eq[sl.id];
      const cands = Object.keys(state.inventory).filter((id) => (state.inventory[id] ?? 0) > 0 && ITEM[id]?.equip?.slot === sl.id);
      return div('slot',
        h('h3', null, `${sl.name}: ${cur ? ITEM[cur]?.name ?? cur : '—'}`),
        cur ? div('small', span('dim', equipText(ITEM[cur])),
          h('button', { class: 'small', disabled: !idle, onclick: () => act(unequip(state, a.id, sl.id), `${ITEM[cur]?.name ?? cur}を外しました`) }, '外す'),
          div('dim small', `外すと: ${statDiff(a, sl.id, null)}`)) : null,
        cands.length ? h('ul', { class: 'plain' }, ...cands.map((id) => {
          const c = canEquip(a, id);
          return h('li', { class: c.ok ? '' : 'dim' },
            div('row tight', span(null, `${ITEM[id].name} ×${state.inventory[id]}`), span('dim small', equipText(ITEM[id])),
              h('button', { class: 'small', disabled: !c.ok, onclick: () => act(equip(state, a.id, id), `${a.name}に${ITEM[id].name}を着けました`) }, '着ける')),
            c.ok ? div('small', statDiff(a, sl.id, id)) : div('small neg', c.reason),
          );
        })) : div('dim small', '在庫に着けられる物がありません'),
      );
    }),
  );
}

function act(r: Result, msg: string) {
  if (!r.ok) return toast(r.reason, true);
  commit();
  toast(msg);
}

function nextDay() {
  const r = advanceDay(state);
  ui.lastReport = r;
  commit();
  if (r.returned.length) toast(`${r.returned.length}隊が帰還しました。ログで報告を読めます。`);
  else if (r.scene) toast('街で噂が立っています');
}

function fire(a: Adventurer) {
  if (!window.confirm(`${a.name}を解雇しますか? 取り消せません。`)) return;
  const r = dismiss(state, a.id);
  if (!r.ok) return toast(r.reason, true);
  if (ui.selAdv === a.id) ui.selAdv = null;
  commit();
  toast(`${a.name}を解雇しました`);
}

function sell(id: string, n: number) {
  const r = sellMaterial(state, id, n);
  if (!r.ok) return toast(r.reason, true);
  commit();
}

function buy(n: number) {
  const r = buyItem(state, 'potion', n);
  if (!r.ok) return toast(r.reason, true);
  commit();
}

function restart() {
  const input = window.prompt('新しく始めます。今の進行は消えます。seed(数字)を入力してください。', String(Date.now() % 100000));
  if (input === null) return;
  const seed = Number.parseInt(input, 10);
  if (!Number.isFinite(seed)) return toast('seed は数字で入力してください', true);
  replaceState(newGame(seed >>> 0, state.playerName));
  toast(`seed ${seed >>> 0} で始めました`);
}
