import { DUNGEON, ENEMY, ITEM, JOB } from '../core/data';
import { previewEquipment } from '../core/equipment';
import { draftForMaterial, knownMaterialSources } from '../core/materialSources';
import { craftGold } from '../core/craft';
import { dailyCost } from '../core/game';
import type { RecipeDef } from '../core/types';
import { render, state, statusText, ui } from './app';
import { openDispatchDraft } from './dispatchForm';
import { div, h, span } from './dom';
import { equipmentChangeText, equipText } from './equipmentText';
import { mapFace } from './mapFace';
import './craftPlanning.css';

/** 製作・出発前の相談。選択しただけでは在庫や編成を変更しない。 */
export function craftPlanning(recipe: RecipeDef): HTMLElement {
  const open = ui.craftRecipe === recipe.id;
  return div('craft-planning',
    h('button', {
      class: 'small', 'aria-expanded': String(open), 'aria-controls': `craft-plan-${recipe.id}`,
      onclick: () => { ui.craftRecipe = open ? '' : recipe.id; render(); },
    }, '効果と素材集めを確認'),
    open ? h('section', { id: `craft-plan-${recipe.id}`, class: 'craft-plan', 'aria-label': `${recipe.name}の製作準備` },
      div('small', `製作後の資金 ${state.gold - craftGold(state, recipe.id)}G / 日給・維持費 ${dailyCost(state)}G/日`),
      equipmentPlan(recipe),
      h('h4', null, '必要な素材'),
      ...recipe.inputs.map((input) => {
        const have = state.inventory[input.item] ?? 0;
        const missing = Math.max(0, input.n - have);
        const sources = missing > 0 ? knownMaterialSources(state, input.item) : [];
        return div('craft-material',
          div(null, `${ITEM[input.item]?.name ?? input.item}：${have} / ${input.n}個`,
            span(missing ? 'neg' : 'pos', missing ? `（あと${missing}個）` : '（揃っています）')),
          ...sources.map((source) => {
            const dungeon = DUNGEON[source.dungeon];
            const floor = dungeon?.floors.find((f) => f.id === source.floor);
            const place = `${dungeon?.name ?? source.dungeon}・${floor?.name ?? source.floor}`;
            const action = source.action === 'gather' ? '採集' : `${ENEMY[source.enemy!]?.name ?? source.enemy}を討伐`;
            return div('craft-source',
              span('small', source.action === 'gather' ? `${place}の採取点` : `${place} / ${ENEMY[source.enemy!]?.name}が落とすことがあります`),
              h('button', { class: 'small', onclick: () => openDispatchDraft(draftForMaterial(state, input.item, source),
                `${recipe.name}に使う${ITEM[input.item]?.name ?? input.item}を集める準備です。隊員と日数を選び、見込みを確認してから出発できます。`) },
              `${place}で${action}する準備`),
            );
          }),
          missing > 0 && !sources.length ? div('small dim', '今行ける既知の入手先がありません。探索で採取点や敵を見つけると、ここから準備できます。') : null,
        );
      }),
    ) : null,
  );
}

function equipmentPlan(recipe: RecipeDef): HTMLElement | null {
  const item = ITEM[recipe.output.item];
  if (!item?.equip) return null;
  const slot = item.equip.slot;
  const members = state.adventurers.filter((a) => previewEquipment(a, slot, item.id) !== null);
  const selected = members.find((a) => a.id === ui.craftMember) ?? members[0];
  return div('craft-equipment',
    h('h4', null, '誰に持たせるか'),
    div('small', equipText(item)),
    members.length ? h('label', null, span('small', '装備を比べる仲間'),
      h('select', {
        class: 'wide', 'aria-label': `${recipe.name}の装備を比べる仲間`,
        onchange: (ev: Event) => { ui.craftMember = (ev.target as HTMLSelectElement).value; render(); },
      }, ...members.map((a) => h('option', { value: a.id, selected: a.id === selected?.id },
        `${a.name} / ${JOB[a.job].name} / ${statusText(a)}`))),
    ) : div('small dim', '今の名簿には、この装備を着けられる職業の仲間がいません。'),
    selected ? div('craft-comparison',
      mapFace(selected),
      div(null,
        div(null, `${selected.name}：${ITEM[selected.equipment?.[slot] ?? '']?.name ?? '装備なし'} → ${item.name}`),
        div('small', equipmentChangeText(selected, slot, item.id)),
        div('small dim', '現在の職業・疲労での比較です。完成後、拠点で装備できます。'),
      ),
    ) : null,
  );
}
