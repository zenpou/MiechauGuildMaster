import { effectiveStats } from '../core/adventurer';
import { activeSynergies, assignWorker, canBuild, facilityLevel, listSynergies, unassignWorker, upgrade, workersOf } from '../core/base';
import { canCraft, craftDays, startCraft } from '../core/craft';
import { FACILITIES, FACILITY, ITEM, RECIPE, RECIPES } from '../core/data';
import { buildFacility } from '../core/game';
import type { FacilityLevelCost, PlacedFacility, Result } from '../core/types';
import { commit, render, STAT_LABEL, state, toast, ui } from './app';
import { div, h, span } from './dom';

const itemName = (id: string) => ITEM[id]?.name ?? id;
const placedAt = (x: number, y: number) => state.base.facilities.find((f) => f.x === x && f.y === y);
const stock = (id: string) => state.inventory[id] ?? 0;

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
    div('summary', span('big', `${s.day}日目`), span(s.gold < 0 ? 'big neg' : 'big', `${s.gold}G`)),
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
  return div('detail',
    div(null, span('big', `空きマス(${x + 1}, ${y + 1})`)),
    list.length ? h('ul', { class: 'plain' }, ...list.map((d) => {
      const r = canBuild(state, d.id, x, y);
      return h('li', null,
        div('row tight', span(null, d.name), costView(d.costs[0]),
          h('button', { class: 'small', disabled: !r.ok, onclick: () => doBuild(d.id, x, y) }, '建てる')),
        div('small', d.effectText[0], span('dim', ` / 維持費 ${d.upkeep}G/日`)),
        r.ok ? null : div('small neg', r.reason),
      );
    })) : div('dim', '建てられる施設はもうありません'),
  );
}

function facilityPanel(f: PlacedFacility): HTMLElement {
  const d = FACILITY[f.id];
  if (!d) return div('detail', f.id);
  const lv = facilityLevel(state, f.id);
  const next = f.construction || f.level >= d.maxLevel ? null : d.costs[f.level];
  return div('detail',
    div(null, span('big', d.name), span('dim small', ` Lv${lv}/${d.maxLevel} 維持費 ${d.upkeep}G/日`)),
    div('dim small', d.desc),
    div('small', lv ? `効果: ${d.effectText[lv - 1]}` : '効果: 完成後に効きます'),
    f.construction ? div('small', `工事中: Lv${f.construction.toLevel}まで あと${f.construction.untilDay - state.day}日(${f.construction.untilDay}日目に完成)`) : null,
    next ? div(null,
      div('row tight', span('small', `Lv${f.level + 1}へ:`), costView(next), h('button', { class: 'small', onclick: () => doUpgrade(f.id) }, 'Lvを上げる')),
      div('dim small', `Lv${f.level + 1}の効果: ${d.effectText[f.level]}`),
    ) : null,
    d.workSlots && lv ? workerBlock(f.id) : null,
    lv && RECIPES.some((r) => r.facility === f.id) ? recipeBlock(f.id) : null,
  );
}

function workerBlock(facilityId: string): HTMLElement {
  const d = FACILITY[facilityId];
  const workers = workersOf(state, facilityId);
  const idle = state.adventurers.filter((a) => a.status === 'idle');
  const full = workers.length >= (d.workSlots ?? 0);
  const stat = d.workStat;
  return div(null,
    h('h3', null, `勤務(${workers.length}/${d.workSlots})`),
    div('dim small', `${stat ? `勤務者の${STAT_LABEL[stat]}が12以上なら完成日数−1。` : ''}勤務中は派遣に出せません。`),
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
      return h('li', null,
        div('row tight',
          span(null, `${r.name}${r.output.n > 1 ? `×${r.output.n}` : ''}`),
          span('small', span(state.gold >= r.gold ? '' : 'neg', `${r.gold}G`), ` ${craftDays(state, r.id)}日`),
          h('button', { class: 'small', disabled: !c.ok, onclick: () => doCraft(r.id) }, '作る')),
        div('small', ...r.inputs.map((i) => span(stock(i.item) >= i.n ? 'pos' : 'neg', `${itemName(i.item)}×${i.n}(${stock(i.item)}) `))),
        div('dim small', ITEM[r.output.item]?.desc ?? ''),
        c.ok ? null : div('small dim', c.reason),
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
