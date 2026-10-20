import { effectiveStats } from '../core/adventurer';
import { facilityLevel } from '../core/base';
import { blessingStatus } from '../core/blessing';
import { canEquip, equip, unequip } from '../core/equipment';
import { advanceDay, buyItem, newGame, sellGold, sellItem } from '../core/game';
import { ITEM, JOB, JOBS, PERSONALITY, TRAINED_SKILL, TUNING, type TrainedSkillDef } from '../core/data';
import { dismissHint, hintFor, hintsOff } from '../core/hints';
import { canChangeJob, changeJob, promotionCost, promotionOptions } from '../core/jobs';
import { capacity, dismiss } from '../core/recruit';
import { canTrain, trainDays, trainableSkills, trainSkill } from '../core/training';
import { LOYALTY_MILESTONES, STAT_KEYS, type Adventurer, type EquipSlot, type ItemDef, type JobDef, type Result } from '../core/types';
import { advById, commit, personaText, render, replaceState, sign, SLOTS, STAT_LABEL, state, statusText, toast, ui } from './app';
import { div, h, span } from './dom';
import { saveTransferRow } from './saveTransfer';
import { artUrl } from './storyPlayer';

const ELEMENT_NAME: Record<string, string> = { fire: '火', ice: '氷', thunder: '雷', earth: '土', dark: '闇' };
const EFFECT_NAME: Record<string, string> = { gather: '採取量', carry: '積載' };
const ARMOR_NAME: Record<string, string> = { light: '軽装', medium: '中装', heavy: '重装' };
const TIER_NAME: Record<JobDef['tier'], string> = { lower: '下級', upper: '上級' };
const slotsOf = (a: Adventurer) => a.equipment ?? { weapon: null, armor: null, accessory: null };
const skillsOf = (a: Adventurer) => a.skills ?? [];
const ROSTER_HEAD = ['名前', '職', '武器', '防具', '装飾', '性格', 'Lv', '疲労', '負傷', '忠誠', '日給', '状態', ''];

/** 「攻撃+2 採取+2」のような訓練スキルの効果文 */
function skillText(def: TrainedSkillDef | undefined): string {
  if (!def) return '';
  return Object.entries(def.mods).map(([k, v]) => `${STAT_LABEL[k as keyof typeof STAT_LABEL] ?? k}${sign(v as number)}`).join(' ');
}

/** 「攻撃+3 闇耐性30%」のような装備の効果文 */
function equipText(def: ItemDef | undefined): string {
  const e = def?.equip;
  if (!e) return '';
  const parts = Object.entries(e.mods).map(([k, v]) => `${STAT_LABEL[k as keyof typeof STAT_LABEL] ?? k}${sign(v as number)}`);
  for (const [k, v] of Object.entries(e.resist ?? {})) parts.push(`${ELEMENT_NAME[k] ?? k}耐性${Math.round((v as number) * 100)}%`);
  for (const [k, v] of Object.entries(e.effects ?? {})) parts.push(`${EFFECT_NAME[k] ?? k}${sign(v)}`);
  return parts.join(' ');
}

/** 最初の数日の「次にやること」。受付のノエルが案内する体裁(心配性なので顔は worried)。赤字のヒントは状態で消えるので閉じるボタンを出さない */
function hintBlock(): HTMLElement | null {
  const hint = hintFor(state);
  if (!hint) return null;
  return div('hint', { role: 'note' },
    h('img', { class: 'hint-face', src: artUrl('faces/noel/worried.webp'), alt: '', width: 56, height: 56 }),
    div('hint-body',
      div('hint-name', 'ノエル(受付)'),
      div('hint-text', hint.text),
      div('row tight',
        hint.id === 'debt' ? null : h('button', { class: 'small', onclick: () => { dismissHint(state, hint.id); commit(); } }, '閉じる'),
        h('button', { class: 'link small', onclick: () => { hintsOff(state); commit(); } }, 'ヒントをすべて消す'),
      ),
    ),
  );
}

export function homeTab(): HTMLElement {
  const s = state;
  const potion = ITEM.potion;
  return div('tab-body',
    hintBlock(),
    blessingBlock(),
    sceneBlock(),
    noticesBlock(),
    h('h2', null, `名簿(${s.adventurers.length}/${capacity(s)}人)`),
    div('dim small', `名前を押すと装備の付け替えと訓練ができます。解雇は待機中の者だけ(費用なし)。★はユニーク。忠誠が節目(${LOYALTY_MILESTONES.join('/')})に届くとメールが来ます。`),
    div('scroll',
      h('table', { class: 'roster' },
        h('thead', null, h('tr', null, ...ROSTER_HEAD.map((t) => h('th', null, t)))),
        h('tbody', null, ...s.adventurers.flatMap((a) => [labeled(h('tr', { class: ui.selAdv === a.id ? 'sel has-sub' : 'has-sub' },
          h('td', null, h('button', { class: 'link', onclick: () => pickAdv(a.id) }, a.unique ? `★${a.name}` : a.name)),
          h('td', null, JOB[a.job].name),
          ...SLOTS.map((sl) => { const id = slotsOf(a)[sl.id]; return h('td', id ? null : { class: 'dim' }, id ? ITEM[id]?.name ?? id : '—'); }),
          h('td', null, PERSONALITY[a.personality]?.name ?? a.personality),
          h('td', { class: 'num' }, a.level),
          h('td', { class: 'num' }, a.fatigue),
          h('td', { class: 'num' }, a.injuryDays || '-'),
          h('td', { class: 'num' }, loyaltyCell(a)),
          h('td', { class: 'num' }, `${a.salary}G`),
          h('td', null, statusText(a)),
          h('td', null, a.status === 'idle' ? h('button', { class: 'small danger', onclick: () => fire(a) }, '解雇') : null),
        )), profileRow(a)])),
      ),
    ),
    equipPanel(),
    h('h2', null, '在庫'),
    inventoryBlock(),
    div('row',
      h('button', { onclick: () => buy(1) }, `${potion.name}を買う(${potion.price}G)`),
    ),
    div('dim small', '台帳(お金の出入り)と実績は記録タブにあります。'),
    saveTransferRow(),
    div('row footer',
      span('dim small', `seed ${s.seed}`),
      h('button', { class: 'danger', onclick: restart }, '新しく始める'),
    ),
  );
}

function loyaltyCell(a: Adventurer): HTMLElement {
  const next = LOYALTY_MILESTONES.find((m) => a.loyalty < m);
  return span(null, String(a.loyalty), next === undefined ? null : span('dim tiny', ` 次の節目 ${next}`));
}

/** 狭い画面では表をカードにし、各セルの上に見出しを出す(CSS の attr(data-label))。横に流さず、忠誠・日給・状態が見える */
function labeled(row: HTMLElement): HTMLElement {
  [...row.children].forEach((cell, i) => cell.setAttribute('data-label', ROSTER_HEAD[i] ?? ''));
  return row;
}

/** 名簿の2行目: 所持スキルと人となり */
function profileRow(a: Adventurer): HTMLElement {
  const names = skillsOf(a).map((id) => TRAINED_SKILL[id]?.name ?? id);
  return h('tr', { class: ui.selAdv === a.id ? 'sub sel' : 'sub' },
    h('td', { colspan: ROSTER_HEAD.length },
      div('profile small',
        span(names.length ? 'skills' : 'dim', names.length ? `スキル: ${names.join('・')}` : 'スキルなし'),
        span('dim', personaText(a.persona)),
      ),
    ),
  );
}

/** アイリスの祝福の残り。隊が出ない日が続くと溜まりすぎて発熱するので、いつ溢れるかまで見せる */
function blessingBlock(): HTMLElement | null {
  const b = blessingStatus(state);
  if (!b.unlocked) return null;
  const gauge = '●'.repeat(b.charges) + '○'.repeat(Math.max(0, b.max - b.charges));
  const note = b.fever ? `発熱中。あと${b.daysLeft}日は祝福が使えない`
    : b.charges >= b.max ? `魔力が溜まりきっている。あと${b.daysLeft}日で熱を出す。隊を出す朝に「派遣」で祝福を`
      : '1日に1つ溜まる。出発する隊に掛けると疲れにくくなる';
  return div('detail blessing',
    div('small dim', 'アイリスの祝福'),
    div(null, `${gauge} 残り${b.charges}/${b.max}`),
    div('small dim', note),
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
  { name: '鍵', kinds: ['key'] },
  { name: '建材', kinds: ['building'] },
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
      // 素材と、使わなくなった装備(中古)。回復薬・鍵・建材は売れない
      const sellable = def?.kind === 'material' || def?.kind === 'weapon' || def?.kind === 'armor' || def?.kind === 'accessory';
      const fx = equipText(def);
      const note = def?.kind === 'key' || def?.kind === 'building' ? def.desc : '';
      return h('li', null,
        span(null, `${def?.name ?? id} ×${n}`),
        fx ? span('dim small', ` ${fx}`) : null,
        note ? span('dim small', ` ${note}`) : null,
        sellable ? span('dim small', ` (${sellGold(state, id, 1)}G)`) : null,
        sellable ? h('button', { class: 'small', onclick: () => sell(id, 1) }, '1つ売る') : null,
        sellable && n > 1 ? h('button', { class: 'small', onclick: () => sell(id, n) }, '全部売る') : null,
      );
    })),
  )), div('dim small', '売れるのは素材と、使わなくなった装備です。装備は中古なので、作るのにかかった費用よりずっと安く、着けている間は売れません。'));
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
    trainingBlock(a),
    jobBlock(a),
  );
}

// canChangeJob は可否しか返さないので、並べる候補はここで決める(上級からは入口の下級へ戻るだけ)
function jobTargets(a: Adventurer): JobDef[] {
  const cur = JOB[a.job];
  if (cur?.tier === 'upper') return (cur.from ?? []).map((id) => JOB[id]).filter((j): j is JobDef => !!j);
  return [...JOBS.filter((j) => j.tier === 'lower' && j.id !== a.job), ...promotionOptions(a)];
}

const isPromotion = (a: Adventurer, j: JobDef) => j.tier === 'upper' && JOB[a.job]?.tier !== 'upper';
const armorText = (j: JobDef) => j.armor.map((c) => ARMOR_NAME[c] ?? c).join('・');

function jobBlock(a: Adventurer): HTMLElement {
  const cur = JOB[a.job];
  const cost = promotionCost(state);
  const checks = jobTargets(a).map((j) => ({ j, c: canChangeJob(state, a.id, j.id) }));
  const reasons = new Set(checks.map(({ c }) => (c.ok ? '' : c.reason)));
  // 訓練と同じく、全行が同じ理由(待機中でない等)なら1回だけ出す
  const common = reasons.size === 1 ? [...reasons][0] : '';
  return div('slot jobs',
    h('h3', null, '転職'),
    div('small', `今の職: ${cur.name}(${TIER_NAME[cur.tier]})`, span('dim', ` ${cur.desc}`)),
    div('dim small', `下級どうしは無料。上級への昇格は条件を満たすと${cost}G。上級からは入口の下級へ無料で戻れます(別の上級へは移れません)。転職は待機中のみ。Lvは変わりません。`),
    div('small neg', '着けられなくなる防具は在庫に戻ります。'),
    common ? div('small neg', common) : null,
    checks.length ? h('ul', { class: 'plain' }, ...checks.map(({ j, c }) => h('li', { class: c.ok ? '' : 'dim' },
      div('row tight',
        span(null, j.name), span(j.tier === 'upper' ? 'badge' : 'dim small', TIER_NAME[j.tier]),
        span('dim small', isPromotion(a, j) ? `Lv${j.requireLevel ?? '?'}以上・${cost}G` : '無料'),
        h('button', { class: 'small', disabled: !c.ok, onclick: () => doChangeJob(a, j) }, isPromotion(a, j) ? '昇格する' : '転職する')),
      div('dim small', `${j.desc} 着られる防具: ${armorText(j)}`),
      c.ok || common ? null : div('small neg', c.reason),
    ))) : div('dim small', '転職先がありません'),
  );
}

function doChangeJob(a: Adventurer, j: JobDef) {
  if (isPromotion(a, j) && !window.confirm(`${a.name}を${j.name}に昇格させますか?(費用${promotionCost(state)}G)`)) return;
  const armorBefore = slotsOf(a).armor;
  const r = changeJob(state, a.id, j.id);
  if (!r.ok) return toast(r.reason, true);
  const now = advById(a.id) ?? a;
  const dropped = armorBefore && slotsOf(now).armor !== armorBefore ? armorBefore : null;
  commit();
  toast(`${a.name}が${j.name}になりました。${dropped ? `${ITEM[dropped]?.name ?? dropped}は着けられないので在庫に戻しました。` : ''}`);
}

/** 訓練所があるときだけ出す */
function trainingBlock(a: Adventurer): HTMLElement | null {
  if (facilityLevel(state, 'training') < 1) return null;
  const T = TUNING.training;
  const as = a.assignment;
  const doing = a.status === 'training' && as && 'training' in as ? as : null;
  const owned = skillsOf(a);
  const checks = trainableSkills(state, a.id).map((d) => ({ d, c: canTrain(state, a.id, d.id) }));
  const reasons = new Set(checks.map(({ c }) => (c.ok ? '' : c.reason)));
  // 同じ理由(待機中でない・費用不足)が全行に並ぶと読みにくいので、そのときは1回だけ出す
  const common = reasons.size === 1 ? [...reasons][0] : '';
  return div('slot training',
    h('h3', null, '訓練'),
    div('dim small', `1回${trainDays(state)}日・${T.gold}G。訓練で覚えられるのは1人${T.maxSkills}つまで(固有スキルは数えない)。訓練中は派遣や勤務に出せません。`),
    owned.length
      ? div('small', '覚えているスキル: ', owned.map((id, i) => `${i ? '、' : ''}${TRAINED_SKILL[id]?.name ?? id}(${skillText(TRAINED_SKILL[id])})`).join(''))
      : null,
    doing ? div('small pos', `「${TRAINED_SKILL[doing.training]?.name ?? doing.training}」を訓練中(${doing.untilDay}日目に終わる)`) : null,
    common ? div('small neg', common) : null,
    checks.length ? h('ul', { class: 'plain' }, ...checks.map(({ d, c }) => h('li', { class: c.ok ? '' : 'dim' },
      div('row tight',
        span(null, d.name), span('small', skillText(d)), span('dim small', `${trainDays(state)}日・${T.gold}G`),
        h('button', { class: 'small', disabled: !c.ok, onclick: () => act(trainSkill(state, a.id, d.id), `${a.name}が「${d.name}」の訓練を始めました(${trainDays(state)}日)`) }, '訓練する'),
      ),
      d.desc ? div('dim small', d.desc) : null,
      c.ok || common ? null : div('small neg', c.reason),
    ))) : div('dim small', `訓練で覚えられる上限(${T.maxSkills}つ)に達しています`),
  );
}

function act(r: Result, msg: string) {
  if (!r.ok) return toast(r.reason, true);
  commit();
  toast(msg);
}

export function nextDay() {
  const r = advanceDay(state);
  ui.lastReport = r;
  commit();
  const msgs: string[] = [];
  if (r.returned.length) msgs.push(`${r.returned.length}隊が帰還しました。ログで報告を読めます。`);
  else if (r.scene) msgs.push('街で噂が立っています。');
  if (r.mails.length) msgs.push(`メールが届きました(${r.mails.length}通)`);
  if (msgs.length) toast(msgs.join(' '));
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
  const r = sellItem(state, id, n);
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
