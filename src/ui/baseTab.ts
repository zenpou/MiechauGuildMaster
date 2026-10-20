import { effectiveStats } from '../core/adventurer';
import {
  activeSynergies, assignWorker, canBuild, canDemolish, demolish, demolishGold, facilityLevel, listSynergies, unassignWorker, upgrade,
  workersOf,
} from '../core/base';
import { canCraft, craftDays, craftGold, startCraft } from '../core/craft';
import { FACILITIES, FACILITY, ITEM, ITEMS, RECIPE, RECIPES } from '../core/data';
import { buildFacility } from '../core/game';
import { recipeUnlocked } from '../core/quests';
import type { FacilityDef, FacilityLevelCost, PlacedFacility, Result } from '../core/types';
import { commit, render, STAT_LABEL, state, toast, ui } from './app';
import { div, h, span } from './dom';
import { craftPlanning } from './craftPlanning';
import { equipText } from './equipmentText';

const itemName = (id: string) => ITEM[id]?.name ?? id;
const placedAt = (x: number, y: number) => state.base.facilities.find((f) => f.x === x && f.y === y);
const stock = (id: string) => state.inventory[id] ?? 0;
const BUILDING_ITEMS = ITEMS.filter((i) => i.kind === 'building').map((i) => i.id);

const CATEGORY_NAME: Record<FacilityDef['category'], string> = {
  housing: '住居', production: '生産', training: '育成', recovery: '回復', info: '情報', office: '事務',
};
const CATEGORIES = Object.keys(CATEGORY_NAME) as FacilityDef['category'][];

/** 解体ボタンを一度押した施設。同じボタンをもう一度押すと解体し、ほかの場所に触れると取り消す */
let armed: string | null = null;
let watching = false;

/** 毎日の産出(製材所・石切場)。効果の値そのまま。勤務者の上乗せは effectText に任せる */
const PRODUCE: [key: string, item: string][] = [['produceLumber', 'lumber'], ['produceStone', 'stone']];
function produceText(fx: Record<string, number> | undefined): string {
  return PRODUCE.filter(([k]) => fx?.[k]).map(([k, item]) => `毎日 ${itemName(item)} +${fx![k]}`).join(' / ');
}

/** 手持ちの建材。費用の行と見比べられるよう、建設費の近くに出す */
function buildingStock(): HTMLElement | null {
  if (!BUILDING_ITEMS.length) return null;
  return div('small stock', '手持ちの建材: ', ...BUILDING_ITEMS.map((id) => span(stock(id) ? '' : 'dim', `${itemName(id)} ×${stock(id)} `)));
}

/** 足りない物を赤くした費用表示 */
function costView(c: FacilityLevelCost): HTMLElement {
  return span('small',
    span(state.gold >= c.gold ? '' : 'neg', `${c.gold}G`),
    ...Object.entries(c.materials).map(([id, n]) => span(stock(id) >= n ? '' : 'neg', ` ${itemName(id)}×${n}(${stock(id)})`)),
    ` ${c.days}日`,
  );
}

export function baseTab(): HTMLElement {
  const s = state;
  const active = new Set(activeSynergies(s).map((x) => x.id));
  const sel = ui.selCell;
  const cells: HTMLElement[] = [];
  for (let y = 0; y < s.base.height; y++) {
    for (let x = 0; x < s.base.width; x++) {
      const f = placedAt(x, y);
      const on = sel && sel.x === x && sel.y === y ? ' sel' : '';
      const name = f ? FACILITY[f.id]?.name ?? f.id : '';
      const body = !f ? span('dim small', '空き')
        : f.construction
          ? [span(null, name), span('small', `建設中${f.level ? `→Lv${f.construction.toLevel}` : ''}`), span('small', `あと${f.construction.untilDay - s.day}日`)]
          : [span(null, name), span('small', `Lv${f.level}`)];
      cells.push(h('button', { class: `plot${f ? (f.construction ? ' building' : ' built') : ''}${on}`, onclick: () => pick(x, y) }, body));
    }
  }
  return div('tab-body',
    h('h2', null, '区画図'),
    div('plots', { style: `grid-template-columns: repeat(${s.base.width}, 1fr)` }, ...cells),
    sel ? cellPanel(sel.x, sel.y) : div('dim small', 'マスを選ぶと、建てられる施設や施設の詳細が出ます。'),
    h('h2', null, 'シナジー(隣り合うと効く組)'),
    h('ul', { class: 'plain synergies' }, ...listSynergies().map((syn) => h('li', { class: active.has(syn.id) ? 'on' : '' },
      span(null, syn.name), span('dim small', ` ${FACILITY[syn.a]?.name ?? syn.a}×${FACILITY[syn.b]?.name ?? syn.b} `),
      active.has(syn.id) ? span('badge', '成立中') : span('dim small', '未成立'),
      div('small', syn.desc),
    ))),
    h('h2', null, '製作中'),
    s.crafts.length
      ? h('ul', { class: 'plain' }, ...s.crafts.map((j) => h('li', null,
        RECIPE[j.recipeId]?.name ?? j.recipeId,
        span('dim small', ` ${FACILITY[RECIPE[j.recipeId]?.facility]?.name ?? ''} / ${j.startDay}日目着手 → `),
        span(null, `${j.doneDay}日目に完成`))))
      : div('dim', '製作中の品はありません'),
  );
}

function pick(x: number, y: number) {
  ui.selCell = ui.selCell && ui.selCell.x === x && ui.selCell.y === y ? null : { x, y };
  render();
}

function cellPanel(x: number, y: number): HTMLElement {
  const f = placedAt(x, y);
  return f ? facilityPanel(f) : buildPanel(x, y);
}

function buildPanel(x: number, y: number): HTMLElement {
  const placed = new Set(state.base.facilities.map((f) => f.id));
  const list = FACILITIES.filter((d) => !placed.has(d.id));
  const groups = [...CATEGORIES.map((c) => ({ name: CATEGORY_NAME[c], list: list.filter((d) => d.category === c) })),
    { name: 'その他', list: list.filter((d) => !CATEGORIES.includes(d.category)) }].filter((g) => g.list.length);
  return div('detail',
    div(null, span('big', `空きマス(${x + 1}, ${y + 1})`)),
    buildingStock(),
    groups.length ? groups.map((g) => div(null,
      h('h3', null, g.name),
      h('ul', { class: 'plain' }, ...g.list.map((d) => {
        const r = canBuild(state, d.id, x, y);
        const produce = produceText(d.effects[0]);
        return h('li', { id: `build-${d.id}` },
          div('row tight', span(null, d.name), costView(d.costs[0]),
            h('button', { class: 'small', disabled: !r.ok, onclick: () => doBuild(d.id, x, y) }, '建てる')),
          produce ? div('small pos', produce) : null,
          div('small', d.effectText[0], span('dim', ` / 維持費 ${d.upkeep}G/日`)),
          r.ok ? null : div('small neg', r.reason),
        );
      })))) : div('dim', '建てられる施設はもうありません'),
  );
}

function facilityPanel(f: PlacedFacility): HTMLElement {
  const d = FACILITY[f.id];
  if (!d) return div('detail', f.id);
  const lv = facilityLevel(state, f.id);
  const next = f.construction || f.level >= d.maxLevel ? null : d.costs[f.level];
  const produce = lv ? produceText(d.effects[lv - 1]) : '';
  const nextProduce = next ? produceText(d.effects[f.level]) : '';
  return div('detail',
    div(null, span('big', d.name), span('dim small', ` Lv${lv}/${d.maxLevel} 維持費 ${d.upkeep}G/日`)),
    div('dim small', d.desc),
    div('small', lv ? `効果: ${d.effectText[lv - 1]}` : '効果: 完成後に効きます'),
    produce ? div('small pos', produce) : null,
    f.construction ? div('small', `工事中: Lv${f.construction.toLevel}まで あと${f.construction.untilDay - state.day}日(${f.construction.untilDay}日目に完成)`) : null,
    next ? div(null,
      div('row tight', span('small', `Lv${f.level + 1}へ:`), costView(next), h('button', { class: 'small', onclick: () => doUpgrade(f.id) }, 'Lvを上げる')),
      buildingStock(),
      div('dim small', `Lv${f.level + 1}の効果: ${d.effectText[f.level]}${nextProduce ? `(${nextProduce})` : ''}`),
    ) : null,
    d.workSlots && lv ? workerBlock(f.id) : null,
    lv && RECIPES.some((r) => r.facility === f.id) ? recipeBlock(f.id) : null,
    f.construction ? null : demolishRow(f.id),
  );
}

/** 誤って触れても壊さないよう2段階。1度目で戻る金額を見せ、同じボタンをもう一度押すと解体する */
function demolishRow(facilityId: string): HTMLElement {
  const on = armed === facilityId;
  return div('row tight',
    h('button', { class: 'small danger demolish', onclick: () => (on ? doDemolish(facilityId) : arm(facilityId)) },
      on ? `本当に解体する?返金 ${demolishGold(state, facilityId)}G` : '解体'),
  );
}

function arm(facilityId: string) {
  const r = canDemolish(state, facilityId);
  if (!r.ok) return toast(r.reason, true);
  armed = facilityId;
  watchOutside();
  render();
}

/** 構えたあと、解体ボタンの外に触れたら構えを解く。2度目の押下はボタン自身の onclick が受ける */
function watchOutside() {
  if (watching) return;
  watching = true;
  document.addEventListener('pointerdown', (ev) => {
    if (!armed || (ev.target instanceof Element && ev.target.closest('.demolish'))) return;
    armed = null;
    // その場で描き直すと、触れた先のボタンが click を受け取る前に差し替わってしまう
    setTimeout(render);
  }, true);
}

function workerBlock(facilityId: string): HTMLElement {
  const d = FACILITY[facilityId];
  const workers = workersOf(state, facilityId);
  const idle = state.adventurers.filter((a) => a.status === 'idle');
  const full = workers.length >= (d.workSlots ?? 0);
  const stat = d.workStat;
  // 製材所・石切場の勤務の効き目は効果の欄(effectText)に書いてあるので、ここでは製作の短縮だけ説明する
  const crafts = RECIPES.some((r) => r.facility === facilityId);
  return div(null,
    h('h3', null, `勤務(${workers.length}/${d.workSlots})`),
    div('dim small', `${stat && crafts ? `勤務者の${STAT_LABEL[stat]}が12以上なら完成日数−1。` : ''}勤務中は派遣に出せません。`),
    h('ul', { class: 'plain' }, ...workers.map((a) => h('li', null, a.name,
      h('button', { class: 'small', onclick: () => doUnassign(a.id) }, '解除')))),
    full ? null : h('select', { class: 'wide', onchange: (ev: Event) => { const v = (ev.target as HTMLSelectElement).value; if (v) doAssign(v, facilityId); } },
      h('option', { value: '' }, idle.length ? '待機中から選んで割り当てる' : '待機中の冒険者がいません'),
      ...idle.map((a) => h('option', { value: a.id }, stat ? `${a.name}(${STAT_LABEL[stat]}${effectiveStats(a)[stat]})` : a.name))),
  );
}

function recipeBlock(facilityId: string): HTMLElement {
  const job = state.crafts.find((j) => RECIPE[j.recipeId]?.facility === facilityId);
  return div(null,
    h('h3', null, 'レシピ'),
    job ? div('small', `製作中: ${RECIPE[job.recipeId]?.name}(${job.doneDay}日目に完成)`) : null,
    h('ul', { class: 'plain' }, ...RECIPES.filter((r) => r.facility === facilityId).map((r) => {
      const c = canCraft(state, r.id);
      return h('li', { id: `recipe-${r.id}` },
        div('row tight',
          span(null, `${r.name}${r.output.n > 1 ? `×${r.output.n}` : ''}`),
          span('small', span(state.gold >= craftGold(state, r.id) ? '' : 'neg', `${craftGold(state, r.id)}G`), ` ${craftDays(state, r.id)}日`),
          h('button', { class: 'small', disabled: !c.ok, onclick: () => doCraft(r.id) }, '作る')),
        div('small', ...r.inputs.map((i) => span(stock(i.item) >= i.n ? 'pos' : 'neg', `${itemName(i.item)}×${i.n}(${stock(i.item)}) `))),
        div('dim small', ITEM[r.output.item]?.desc ?? ''),
        ITEM[r.output.item]?.equip ? div('small', equipText(ITEM[r.output.item])) : null,
        c.ok ? null : div('small dim', c.reason),
        recipeUnlocked(state, r.id) ? craftPlanning(r) : null,
      );
    })),
  );
}

function done(r: Result, msg: string) {
  if (!r.ok) return toast(r.reason, true);
  commit();
  toast(msg);
}

const doBuild = (id: string, x: number, y: number) => done(buildFacility(state, id, x, y), `${FACILITY[id].name}の建設を始めました`);
const doUpgrade = (id: string) => done(upgrade(state, id), `${FACILITY[id].name}の増築を始めました`);
const doAssign = (advId: string, facilityId: string) => done(assignWorker(state, advId, facilityId), `${FACILITY[facilityId].name}に勤務させました`);
const doUnassign = (advId: string) => done(unassignWorker(state, advId), '勤務を解きました');
const doCraft = (id: string) => done(startCraft(state, id), `${RECIPE[id].name}を作り始めました`);

function doDemolish(facilityId: string) {
  armed = null;
  const gold = demolishGold(state, facilityId);
  done(demolish(state, facilityId), `${FACILITY[facilityId].name}を解体しました。${gold}G戻りました`);
}
