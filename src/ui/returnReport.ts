import { availableRecipes, canCraft } from '../core/craft';
import { DUNGEON, FACILITY, ITEM, RECIPE, RECIPES } from '../core/data';
import { draftFromExpedition, type ReturnPlanTarget } from '../core/expeditionPlan';
import { recipeUnlocked } from '../core/quests';
import type { Expedition } from '../core/types';
import { actionText, destText, nameOf, render, state, ui } from './app';
import { div, h, span } from './dom';
import { canOpenJourney, openJourney } from './journeyHost';
import { mapFace } from './mapFace';
import { openDispatchDraft } from './dispatchForm';
import './returnReport.css';
import { tutorialFeatureUnlocked, tutorialTabUnlocked } from '../core/tutorial';

const itemList = (items: Record<string, number>) => Object.entries(items)
  .filter(([, n]) => n > 0).map(([id, n]) => `${ITEM[id]?.name ?? id} ×${n}`).join('、') || 'なし';
const placeName = (dungeon: string, floor: string) =>
  `${DUNGEON[dungeon]?.name ?? dungeon}・${DUNGEON[dungeon]?.floors.find((f) => f.id === floor)?.name ?? floor}`;

/** 保存された帰還履歴を使うので、再読み込みでも報告が消えない。 */
export function returnReportsBlock(): HTMLElement | null {
  const latest = state.history.find((e) => e.claimed);
  if (!latest) return null;
  const reports = state.history.filter((e) => e.claimed && e.returnDay === latest.returnDay);
  return h('section', { class: 'return-reports', 'aria-label': '帰還報告' },
    h('h2', null, latest.returnDay === state.day ? '帰還報告' : `最近の帰還報告 · ${latest.returnDay}日目`),
    ...reports.map((e) => returnReportCard(e)),
  );
}

export function returnReportCard(e: Expedition, showLog = true): HTMLElement | null {
  if (!e.claimed) return null;
  const report = e.returnReport;
  const result = e.result;
  const leaderName = report?.members.find((m) => m.id === e.order.leaderId)?.name ?? nameOf(e.order.leaderId);
  const outcome = result.wiped ? '全滅・救助' : result.retreated ? '途中帰還' : '帰還';
  const quote = result.returnDialogue?.find((q) => q.advId === e.order.leaderId);
  const acquired = Object.keys(result.materials).filter((id) => result.materials[id] > 0);
  const recipes = availableRecipes(state).filter((r) => r.inputs.some((i) => acquired.includes(i.item)) && canCraft(state, r.id).ok).slice(0, 2);
  const materialFacilities = [...new Set(RECIPES.filter((r) => recipeUnlocked(state, r.id)
    && r.inputs.some((i) => acquired.includes(i.item))).map((r) => r.facility))];
  const gathers = report?.floors.flatMap((f) => [...new Set(f.newlyDiscoveredGather.map((g) => g.item))]
    .map((item) => ({ dungeon: f.dungeon, floor: f.floor, item }))) ?? [];

  return h('article', { class: 'return-card', 'aria-label': `${leaderName}隊の帰還報告` },
    h('h3', null, `${leaderName}隊 · ${destText(e)}`, span(`badge ${result.wiped ? '全滅' : result.retreated ? '撤退' : '成功'}`, outcome)),
    div('dim small', `${e.startDay}〜${e.returnDay}日目 / ${actionText(e.order)}`),
    div('return-metrics',
      span(null, `拾得金 ${result.gold}G`),
      result.rescueCost ? span('neg', `救助費用 ${result.rescueCost}G`) : null,
      span(null, `持ち帰り: ${itemList(result.materials)}`),
    ),
    result.wiped && Object.keys(result.lostMaterials).length ? div('small neg', `失った素材: ${itemList(result.lostMaterials)}`) : null,
    report ? div('return-discoveries',
      ...report.floors.map((f) => div(null, `${placeName(f.dungeon, f.floor)}　探索率 ${Math.round(f.rateBefore * 100)}% → ${Math.round(f.rateAfter * 100)}%`,
        span(f.newCells ? 'pos' : 'dim', `（ギルドの地図に＋${f.newCells}マス）`))),
      ...report.confirmedDungeons.map((id) => div('pos', `${DUNGEON[id]?.name ?? id}の入口を確認。探索隊を送れるようになった。`)),
      ...report.newKeys.map((id) => div('pos', `鍵を入手: ${ITEM[id]?.name ?? id}`)),
      ...report.unlockedFloors.map((f) => div('pos', `次の階へ: ${placeName(f.dungeon, f.floor)}`)),
      gathers.length ? div('pos', `採取点を発見: ${[...new Set(gathers.map((g) => ITEM[g.item]?.name ?? g.item))].join('、')}`) : null,
    ) : null,
    report ? div('return-members', ...report.members.map((m) => div('return-member',
      mapFace(m),
      div(null, div(null, m.name, span(m.levelAfter > m.levelBefore ? 'pos' : 'dim',
        m.levelAfter > m.levelBefore ? `　Lv${m.levelBefore} → ${m.levelAfter}` : `　Lv${m.levelAfter}`)),
      div('small dim', `疲労 ${m.fatigueBefore} → ${m.fatigueAfter}`),
      m.injuryDays ? div('small neg', `帰還時に負傷 ${m.injuryDays}日`) : null),
    ))) : null,
    quote ? div('return-quote small', `${quote.name}「${quote.text}」`) : null,
    tutorialFeatureUnlocked(state, 'preparation') ? h('h4', null, '次の準備') : null,
    tutorialFeatureUnlocked(state, 'preparation') ? div('small dim', '以下は現在の名簿・在庫での準備です。') : null,
    tutorialFeatureUnlocked(state, 'preparation') ? div('return-actions',
      e.order.target.dungeon ? h('button', { onclick: () => prepareFromReturn(e) }, 'この隊を組み直す') : null,
      ...(tutorialFeatureUnlocked(state, 'travel') ? gathers : []).map((g) => h('button', { onclick: () => prepareFromReturn(e, { ...g, action: 'gather' }) }, `${ITEM[g.item]?.name ?? g.item}を採りに行く準備`)),
      ...(tutorialFeatureUnlocked(state, 'travel') ? report?.unlockedFloors ?? [] : []).map((f) => h('button', { onclick: () => prepareFromReturn(e, { ...f, action: 'explore' }) }, `${placeName(f.dungeon, f.floor)}への準備`)),
      ...(tutorialTabUnlocked(state, 'base') ? recipes : []).map((r) => h('button', { onclick: () => openWorkshop(r.id) }, `${r.name}の製作を確認`)),
      ...(!recipes.length && tutorialTabUnlocked(state, 'base') ? materialFacilities.map((id) => h('button', {
        onclick: () => openWorkshop(undefined, id),
      }, `素材を使う${FACILITY[id]?.name ?? id}を確認`)) : []),
      h('button', { onclick: () => {
        ui.tab = 'home'; ui.selAdv = e.order.partyIds.find((id) => state.adventurers.some((a) => a.id === id)) ?? null;
        render(); document.querySelector('.equip')?.scrollIntoView({ block: 'center' });
      } }, '装備と休養を確認'),
      canOpenJourney(e) ? h('button', { onclick: () => openJourney(e) }, '道中を再生') : null,
      showLog && tutorialTabUnlocked(state, 'log') ? h('button', { onclick: () => { ui.tab = 'log'; ui.selLog = e.id; render(); } }, '詳しい記録') : null,
    ) : null,
  );
}

function prepareFromReturn(e: Expedition, target?: ReturnPlanTarget) {
  openDispatchDraft(draftFromExpedition(state, e, target),
    '帰還した隊をもとに準備しています。隊員・隊長・装備・持ち物を見直してから出発できます。');
}

function openWorkshop(recipeId?: string, requestedFacility = 'workshop') {
  const facilityId = recipeId ? RECIPE[recipeId]?.facility ?? requestedFacility : requestedFacility;
  const placed = state.base.facilities.find((f) => f.id === facilityId);
  ui.selCell = placed ? { x: placed.x, y: placed.y } : null;
  if (!placed) {
    for (let y = 0; y < state.base.height && !ui.selCell; y++) for (let x = 0; x < state.base.width && !ui.selCell; x++) {
      if (!state.base.facilities.some((f) => f.x === x && f.y === y)) ui.selCell = { x, y };
    }
  }
  ui.tab = 'base'; render();
  if (!placed) document.getElementById(`build-${facilityId}`)?.scrollIntoView({ block: 'center' });
  else if (recipeId) document.getElementById(`recipe-${recipeId}`)?.scrollIntoView({ block: 'center' });
  else document.querySelector('main')?.scrollIntoView({ block: 'start' });
}
