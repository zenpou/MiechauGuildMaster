// 遊び方別の計測: 依頼を受けない / 受けるが締め切りを見ない / 締め切りの近い順に片付ける、の3通りの bot を
// 同じ seed で回し、所持金・評判・依頼の成否・隊の育ち・探索率を比べる。「締め切りだけで経済の圧力が足りるか」を判定する。
// メールに返信するか(--mail)で、退職・忠誠・昇給が隊と収支にどう効くかも比べる。
// 使い方: npm run sim:styles -- [seeds=20] [days=60] [--mail reply|ignore]
import { facilityLevel } from '../src/core/base';
import { canCraft, startCraft } from '../src/core/craft';
import { DUNGEON, ENEMY, ITEM, JOB } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { equip } from '../src/core/equipment';
import { acceptQuest, advanceDay, buildFacility, dispatch, exploredRateOf, newGame, sellItem } from '../src/core/game';
import { dispatchBlock, markRead, replyMail } from '../src/core/mail';
import { activeQuests, deliver, visibleQuests } from '../src/core/quests';
import { capacity, hire, hireFee } from '../src/core/recruit';
import {
  PARTIES_MAX, PARTY_MAX,
  type ActionKind, type Adventurer, type DispatchOrder, type GameState, type Mail, type Quest,
} from '../src/core/types';
import { travelDays } from '../src/core/world';

const args = process.argv.slice(2);
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const SEEDS = nums[0] ?? 20;
const LAST_DAY = nums[1] ?? 60;
const MAIL_POLICIES = ['reply', 'ignore'] as const;
type MailPolicy = (typeof MAIL_POLICIES)[number];
const mailAt = args.indexOf('--mail');
const MAIL = (mailAt >= 0 ? args[mailAt + 1] : 'reply') as MailPolicy;
if (!MAIL_POLICIES.includes(MAIL)) {
  console.error(`--mail は ${MAIL_POLICIES.join(' か ')} を指定する(既定 reply)`);
  process.exit(1);
}

const FLOOR_ID = 'f1';
const DAYS = 3;
const POLICY_ID = 'standard';
const MIN_PARTY = 2;
const REST_FATIGUE = 50;
const STAFF_MAX = 8;
const HOME = 'base';
const FOREST = 'forest_cave';
const MINE = 'old_mine';
const TOWER = 'ruined_tower';
const DUNGEONS = [FOREST, MINE, TOWER];
const WORKSHOP_AT = [0, 0] as const;
/** 防具が全員に行き渡らなくても、この日からは坑道へ行く(森で詰まらないための打ち切り) */
const MINE_BY_DAY = 20;
/** 森をこの探索率まで広げたら、以後は討伐で牙・スライムの核を集める */
const FOREST_EXPLORED = 0.9;
/** 探索依頼の見込み: 1回の派遣で増える探索率(森の sim の序盤のおおよそ) */
const EXPLORE_GAIN = 0.15;

const STYLES = ['no-quests', 'quests-lazy', 'quests-deadline'] as const;
type Style = (typeof STYLES)[number];
const STYLE_NAME: Record<Style, string> = {
  'no-quests': '依頼を受けない',
  'quests-lazy': '受けるが締め切りを見ない',
  'quests-deadline': '締め切りの近い順に片付ける',
};

/** 資金が日給合計のこの日数分に満たないうちは昇給を保留する。払えないまま日給を上げても借金が膨らむだけなので */
const RAISE_RESERVE_DAYS = 5;
const MAIL_NAME: Record<MailPolicy, string> = {
  reply: `毎朝、未読のメールに返信する。昇給要望は承認(資金が日給合計の${RAISE_RESERVE_DAYS}日分に満たなければ保留)、退職警告は引き留める、休みたいは休ませる、仲間への不満は分ける。ほかは既読にするだけ。休ませる・分けると返した人は dispatch が断るので、その日・その組み合わせでは隊に入れない`,
  ignore: 'メールに返信しない(既読にもしない)',
};

const ready = (a: Adventurer) => a.status === 'idle' && a.injuryDays === 0 && a.fatigue < REST_FATIGUE;
const armorRecipe = (a: Adventurer) => (JOB[a.job].armor.includes('light') ? 'r_leather_armor' : 'r_studded_armor');
const RECIPE_INPUTS: Record<string, Record<string, number>> = {
  r_leather_armor: { fang: 2, slime_gel: 2 },
  r_studded_armor: { fang: 3, moss_ore: 1 },
};

// ---- 素材の出どころ(依頼の採集先を決める) ----
const grids = Object.fromEntries(DUNGEONS.map((d) => [d, parseFloor(DUNGEON[d].floors.find((f) => f.id === FLOOR_ID)!)]));
const gatherCells = (dungeon: string, item: string) =>
  grids[dungeon].cells.map((c, i) => (c.kind === 'gather' && c.item === item ? i : -1)).filter((i) => i >= 0);
const lootOf = (dungeon: string) => {
  const ids = new Set([
    ...DUNGEON[dungeon].enemies.map((e) => e.id),
    ...grids[dungeon].cells.filter((c) => c.enemy).map((c) => c.enemy!),
  ]);
  return new Set([...ids].flatMap((id) => (ENEMY[id]?.loot ?? []).map((l) => l.item)));
};
/** 素材を採る先。採取点があればそこ、無ければ落とす敵のいるダンジョン(森→坑道→塔の順で最初) */
function sourceOf(item: string): { dungeon: string; gather: boolean } | null {
  for (const d of DUNGEONS) if (gatherCells(d, item).length) return { dungeon: d, gather: true };
  for (const d of DUNGEONS) if (lootOf(d).has(item)) return { dungeon: d, gather: false };
  return null;
}

// ---- 1回分の実行 ----
interface Run {
  gold: number; rep: number;
  done: number; failed: number; expired: number;
  staff: number; avgLevel: number; debtDays: number;
  rates: Record<string, number>;
  /** 種別ごとの 達成/失敗 */
  byType: Record<string, { done: number; failed: number }>;
  accepted: number;
  resigned: number; warned: number;
  /** 最終日の名簿の平均。隊員が0人なら NaN */
  loyalty: number;
  payroll: number;
  /** 承認は引き留め(警告への返信)を含む。保留の上限を超えた保留は core が断りとして扱う */
  raises: number; holds: number; holdRefused: number;
  replies: number;
}

type Target = { action: ActionKind; target: DispatchOrder['target']; questId?: string };

function runStyle(style: Style, seed: number): Run {
  const s = newGame(seed);
  const takesQuests = style !== 'no-quests';
  const seen = new Set<string>();
  const accepted = new Set<string>();
  /** 依頼のために出した隊: 遠征ID → 依頼ID */
  const working = new Map<string, string>();
  let debtDays = 0;
  const mail = { raises: 0, holds: 0, holdRefused: 0, replies: 0 };

  const roundTrip = (dungeon: string) => 2 * (travelDays(HOME, DUNGEON[dungeon].node, s.world) ?? Infinity);
  const unarmored = () => s.adventurers.filter((a) => !a.equipment.armor);

  /** 防具の材料と、受注中の納品に要る分は売らずに残す */
  const keepOf = (): Record<string, number> => {
    const keep: Record<string, number> = {};
    for (const a of unarmored()) for (const [it, n] of Object.entries(RECIPE_INPUTS[armorRecipe(a)])) keep[it] = (keep[it] ?? 0) + n;
    for (const q of activeQuests(s)) if (q.type === 'deliver' && q.target.item) keep[q.target.item] = (keep[q.target.item] ?? 0) + (q.target.n ?? 0);
    return keep;
  };

  const deliverAll = () => {
    for (const q of activeQuests(s)) {
      if (q.type !== 'deliver') continue;
      if ((s.inventory[q.target.item!] ?? 0) >= (q.target.n ?? 0)) deliver(s, q.id);
    }
  };

  // 討伐は踏んだ巣しか回らないので、目当ての敵の巣をまだ踏んでいなければ探索で地図を広げる
  const knownNest = (dungeon: string, wanted: (enemy: string) => boolean) => {
    const visited = s.dungeons[dungeon]?.floors[FLOOR_ID]?.visited ?? [];
    return visited.some((i) => grids[dungeon].cells[i]?.kind === 'nest' && wanted(grids[dungeon].cells[i].enemy!));
  };

  /** 依頼の行き先。null なら今は手を付けない(在庫で納める・出発日でない 等) */
  const workFor = (q: Quest): Target | null => {
    const dungeonAction = (dungeon: string, act: ActionKind, item?: string): Target | null => {
      if (!s.dungeons[dungeon]) return null;
      if (!s.dungeons[dungeon].confirmed) return { action: 'survey', target: { dungeon, floor: FLOOR_ID }, questId: q.id };
      const target: DispatchOrder['target'] = { dungeon, floor: FLOOR_ID };
      if (item) target.item = item;
      return { action: act, target, questId: q.id };
    };
    switch (q.type) {
      case 'escort': return q.departDay === s.day ? { action: 'escort', target: { questId: q.id }, questId: q.id } : null;
      case 'transport': return { action: 'transport', target: { questId: q.id }, questId: q.id };
      case 'hunt': {
        const d = q.target.dungeon!;
        return dungeonAction(d, knownNest(d, (enemy) => enemy === q.target.enemy) ? 'hunt' : 'explore');
      }
      case 'explore': return dungeonAction(q.target.dungeon!, 'explore');
      case 'deliver': {
        const item = q.target.item!;
        if ((s.inventory[item] ?? 0) >= (q.target.n ?? 0)) return null;
        const src = sourceOf(item);
        if (!src) return null;
        if (!src.gather) {
          const drops = (enemy: string) => (ENEMY[enemy]?.loot ?? []).some((l) => l.item === item);
          return dungeonAction(src.dungeon, knownNest(src.dungeon, drops) ? 'hunt' : 'explore');
        }
        // 採集は未踏のマスに入らないので、採取点をまだ踏んでいなければ探索で地図を広げる
        const visited = s.dungeons[src.dungeon]?.floors[FLOOR_ID]?.visited ?? [];
        const reached = gatherCells(src.dungeon, item).some((i) => visited.includes(i));
        return reached ? dungeonAction(src.dungeon, 'gather', item) : dungeonAction(src.dungeon, 'explore');
      }
      default: return null;
    }
  };

  /** 受注したら片付くまでの見込み日数(往復+現地)。行けなければ Infinity */
  const needDays = (q: Quest): number => {
    const survey = (d: string) => (s.dungeons[d]?.confirmed ? 0 : roundTrip(d) + DAYS);
    switch (q.type) {
      case 'escort': return 0;
      case 'transport': {
        const from = q.target.from ?? HOME;
        const to = q.target.to ?? HOME;
        const a = travelDays(HOME, from, s.world);
        const b = travelDays(from, to, s.world);
        const c = travelDays(to, HOME, s.world);
        return a === null || b === null || c === null ? Infinity : a + b + c;
      }
      case 'hunt': return survey(q.target.dungeon!) + roundTrip(q.target.dungeon!) + DAYS;
      case 'explore': {
        const d = q.target.dungeon!;
        const gap = Math.max(0, (q.target.percent ?? 100) / 100 - exploredRateOf(s, d, FLOOR_ID));
        return survey(d) + Math.ceil(gap / EXPLORE_GAIN) * (roundTrip(d) + DAYS);
      }
      case 'deliver': {
        if ((s.inventory[q.target.item!] ?? 0) >= (q.target.n ?? 0)) return 0;
        const src = sourceOf(q.target.item!);
        return src ? survey(src.dungeon) + roundTrip(src.dungeon) + DAYS : Infinity;
      }
      default: return Infinity;
    }
  };

  /** 受注後の納期は core が道の日数から決めるので、複製した状態で受けてみて読む */
  const dueIfAccepted = (q: Quest): number | null => {
    const probe = structuredClone(s);
    if (!acceptQuest(probe, q.id).ok) return null;
    return probe.quests.find((x) => x.id === q.id)!.dueDay;
  };

  const acceptAll = () => {
    // 解放依頼は納期が無く枠を埋め続けるだけなので、締め切りの比較から外す
    const board = visibleQuests(s).filter((q) => q.status === 'posted' && q.type !== 'unlock');
    const order = style === 'quests-deadline' ? [...board].sort((a, b) => (a.acceptBy ?? Infinity) - (b.acceptBy ?? Infinity)) : board;
    for (const q of order) {
      if (activeQuests(s).length >= 3) break;
      if (style === 'quests-deadline') {
        const due = dueIfAccepted(q);
        if (due === null || needDays(q) > due - s.day) continue;
      }
      if (acceptQuest(s, q.id).ok) accepted.add(q.id);
    }
  };

  /** 依頼に関係なく回す流れ: 森で防具を揃え、揃うか20日目から坑道 */
  const defaultTarget = (): Target => {
    const armored = s.adventurers.filter((a) => a.equipment.armor).length;
    const toMine = armored >= Math.min(PARTY_MAX, s.adventurers.length) || s.day >= MINE_BY_DAY;
    if (toMine) return { action: s.dungeons[MINE].confirmed ? 'explore' : 'survey', target: { dungeon: MINE, floor: FLOOR_ID } };
    const action: ActionKind = exploredRateOf(s, FOREST, FLOOR_ID) < FOREST_EXPLORED ? 'explore' : 'hunt';
    return { action, target: { dungeon: FOREST, floor: FLOOR_ID } };
  };

  const send = (party: Adventurer[], t: Target): boolean => {
    const items: Record<string, number> = (s.inventory.potion ?? 0) >= 1 ? { potion: 1 } : {};
    const r = dispatch(s, {
      partyIds: party.map((a) => a.id), leaderId: party[0].id,
      action: t.action, target: t.target, policy: POLICY_ID, days: DAYS, items,
    });
    if (r.ok && t.questId) working.set(r.expedition.id, t.questId);
    return r.ok;
  };

  const dispatchAll = () => {
    const nextParty = () => {
      const party: Adventurer[] = [];
      for (const a of s.adventurers.filter(ready)) if (party.length < PARTY_MAX && !dispatchBlock(s, [...party, a])) party.push(a);
      return party;
    };
    const canSend = () => nextParty().length >= MIN_PARTY && s.expeditions.length < PARTIES_MAX;
    const questBusy = (id: string) => [...working.entries()].some(([eid, qid]) => qid === id && s.expeditions.some((e) => e.id === eid));
    const questTargets = (): Target[] => {
      const qs = activeQuests(s).filter((q) => !questBusy(q.id));
      if (style === 'quests-lazy') return qs.filter((q) => q.type === 'escort' || q.type === 'transport').map(workFor).filter((t): t is Target => !!t);
      // 護衛は出発日を逃すと失敗なので、その日だけは納期順より先に出す
      const sorted = [...qs].sort((a, b) => (a.type === 'escort' ? -1 : 0) - (b.type === 'escort' ? -1 : 0) || (a.dueDay ?? Infinity) - (b.dueDay ?? Infinity));
      return sorted.map(workFor).filter((t): t is Target => !!t);
    };

    if (style === 'quests-deadline') {
      for (const t of questTargets()) {
        if (!canSend()) break;
        send(nextParty(), t);
      }
    }
    while (canSend()) if (!send(nextParty(), defaultTarget())) break;
    if (style === 'quests-lazy') {
      for (const t of questTargets()) {
        if (!canSend()) break;
        send(nextParty(), t);
      }
    }
  };

  const hireOne = () => {
    if (s.adventurers.length >= Math.min(capacity(s), STAFF_MAX)) return;
    const c = [...s.candidates].sort((a, b) => a.adv.salary - b.adv.salary)[0];
    if (c && s.gold >= hireFee(c.adv.salary)) hire(s, c.adv.id);
  };

  const workshop = () => {
    if (!s.base.facilities.some((f) => f.id === 'workshop')) buildFacility(s, 'workshop', ...WORKSHOP_AT);
    if (facilityLevel(s, 'workshop') < 1) return;
    for (const a of s.adventurers) {
      if (a.equipment.armor) continue;
      for (const it of ['leather_armor', 'studded_armor']) if ((s.inventory[it] ?? 0) > 0 && equip(s, a.id, it).ok) break;
    }
    const waiting = unarmored().length - (s.inventory.leather_armor ?? 0) - (s.inventory.studded_armor ?? 0)
      - s.crafts.filter((j) => j.recipeId in RECIPE_INPUTS).length;
    if (waiting <= 0) return;
    const recipe = unarmored().map(armorRecipe).find((r) => canCraft(s, r).ok);
    if (recipe) startCraft(s, recipe);
  };

  const sellAll = () => {
    const keep = keepOf();
    for (const [item, n] of Object.entries(s.inventory)) {
      if (ITEM[item].kind !== 'material') continue;
      const extra = n - (keep[item] ?? 0);
      if (extra > 0) sellItem(s, item, extra);
    }
  };

  const choiceFor = (m: Mail): string | null => {
    switch (m.kind) {
      case 'raise': {
        const payroll = s.adventurers.reduce((t, a) => t + a.salary, 0);
        return s.gold >= RAISE_RESERVE_DAYS * payroll ? 'accept' : 'hold';
      }
      case 'warning': return 'retain';
      case 'rest': return 'rest';
      case 'complaint': return 'split';
      default: return null;
    }
  };

  // 返信できないもの(選択肢が無い・差出人が去った)も既読にしておかないと、毎日同じメールを開き直す
  const answerMails = () => {
    for (const m of s.mails) {
      if (m.read) continue;
      const choice = choiceFor(m);
      if (!choice || !replyMail(s, m.id, choice).ok) {
        markRead(s, m.id);
        continue;
      }
      mail.replies++;
      if (choice === 'accept' || choice === 'retain') mail.raises++;
      else if (choice === 'hold' && m.answered === 'refuse') mail.holdRefused++;
      else if (choice === 'hold') mail.holds++;
    }
  };

  while (s.day < LAST_DAY) {
    if (MAIL === 'reply') answerMails();
    if (takesQuests) {
      deliverAll();
      acceptAll();
      deliverAll();
    }
    for (const q of visibleQuests(s)) if (q.status === 'posted' && q.type !== 'unlock') seen.add(q.id);
    sellAll();
    workshop();
    hireOne();
    dispatchAll();
    advanceDay(s);
    if (s.debt) debtDays++;
  }

  const mine = s.quests.filter((q) => accepted.has(q.id));
  const byType: Run['byType'] = {};
  for (const q of mine) {
    const b = (byType[q.type] ??= { done: 0, failed: 0 });
    if (q.status === 'done') b.done++;
    if (q.status === 'failed') b.failed++;
  }
  const posted = new Set(s.quests.filter((q) => q.status === 'posted').map((q) => q.id));
  return {
    gold: s.gold, rep: s.rep,
    done: mine.filter((q) => q.status === 'done').length,
    failed: mine.filter((q) => q.status === 'failed').length,
    expired: [...seen].filter((id) => !accepted.has(id) && !posted.has(id)).length,
    staff: s.adventurers.length,
    avgLevel: s.adventurers.reduce((t, a) => t + a.level, 0) / s.adventurers.length,
    debtDays,
    rates: Object.fromEntries(DUNGEONS.map((d) => [d, exploredRateOf(s, d, FLOOR_ID)])),
    byType,
    accepted: accepted.size,
    resigned: Object.keys(s.flags).filter((k) => k.startsWith('gone:')).length,
    warned: s.mails.filter((m) => m.kind === 'warning').length,
    loyalty: s.adventurers.reduce((t, a) => t + a.loyalty, 0) / s.adventurers.length,
    payroll: s.adventurers.reduce((t, a) => t + a.salary, 0),
    ...mail,
  };
}

// ---- 集計と出力 ----
const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN);
const fix = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');
// 全員辞めた seed は平均Lv・平均忠誠が NaN になり、1つでも混ざると列ごと '-' になるので除く
const stat = (xs: number[], f: (x: number) => string) => {
  const v = xs.filter(Number.isFinite);
  return v.length ? `${f(mean(v))}(${f(Math.min(...v))}〜${f(Math.max(...v))})` : '-';
};
const gold = (x: number) => `${Math.round(x)}G`;
const table = (head: string[], rows: string[][]) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');

const t0 = performance.now();
const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
const runs = Object.fromEntries(STYLES.map((st) => [st, seeds.map((seed) => runStyle(st, seed))])) as Record<Style, Run[]>;
const elapsed = (performance.now() - t0) / 1000;

const out: string[] = [];
out.push(`### 計測(\`npm run sim:styles -- ${SEEDS} ${LAST_DAY} --mail ${MAIL}\`。${SEEDS}seed×${LAST_DAY}日)`);
out.push('');
out.push(`共通: 初日に工房(${WORKSHOP_AT.join(',')})。防具の無い者の分だけ革の鎧(軽装不可なら鋲打ち革鎧)を作って着せ、材料と受注中の納品分を残して素材は毎日売る。候補者は資金があり上限内なら日給の安い順に1日1人(最大${STAFF_MAX}人)。疲労${REST_FATIGUE}以上・負傷中は休み、待機中の者を${PARTY_MAX}人ずつ隊にして${MIN_PARTY}人以上なら出す(現地${DAYS}日・標準方針・回復薬1)。依頼に関係ない派遣は、森(探索率${FOREST_EXPLORED * 100}%までは探索、以後は討伐)→防具が${PARTY_MAX}人に行き渡るか${MINE_BY_DAY}日目から坑道(踏査→探索)。解放依頼は受けない。`);
out.push('');
for (const st of STYLES) out.push(`- \`${st}\`: ${STYLE_NAME[st]}`);
out.push('');
out.push(`メール(\`--mail ${MAIL}\`): ${MAIL_NAME[MAIL]}。`);
out.push('');
out.push(`値は 平均(最小〜最大)。隊員・平均Lv・平均忠誠・日給合計は${LAST_DAY}日目の名簿で、平均Lv・平均忠誠は隊員が0人の seed を除く。`);
out.push('');
const metric = (label: string, f: (r: Run) => number, fmt: (x: number) => string) => [label, ...STYLES.map((st) => stat(runs[st].map(f), fmt))];
out.push(table(['項目', ...STYLES], [
  metric(`${LAST_DAY}日目の所持金`, (r) => r.gold, gold),
  metric('評判', (r) => r.rep, (x) => fix(x)),
  metric('受注数', (r) => r.accepted, (x) => fix(x)),
  metric('達成数', (r) => r.done, (x) => fix(x)),
  metric('失敗数(納期切れ)', (r) => r.failed, (x) => fix(x)),
  metric('受けなかった(期限切れ)数', (r) => r.expired, (x) => fix(x)),
  metric('隊員数', (r) => r.staff, (x) => fix(x)),
  metric('退職者数', (r) => r.resigned, (x) => fix(x)),
  metric('退職警告(通)', (r) => r.warned, (x) => fix(x)),
  metric('平均忠誠', (r) => r.loyalty, (x) => fix(x)),
  metric('日給合計', (r) => r.payroll, gold),
  metric('昇給承認数(引き留め含む)', (r) => r.raises, (x) => fix(x)),
  metric('昇給の保留数', (r) => r.holds, (x) => fix(x)),
  metric('保留が上限で断り扱いになった数', (r) => r.holdRefused, (x) => fix(x)),
  metric('返信した通数', (r) => r.replies, (x) => fix(x)),
  metric('平均Lv', (r) => r.avgLevel, (x) => fix(x, 2)),
  metric('借金だった日数', (r) => r.debtDays, (x) => fix(x)),
  ...DUNGEONS.map((d) => metric(`${DUNGEON[d].name}の探索率`, (r) => r.rates[d], pct)),
]));
out.push('');
out.push('#### 依頼の種別ごと(全seed 合計、達成/失敗)');
out.push('');
const types = [...new Set(STYLES.flatMap((st) => runs[st].flatMap((r) => Object.keys(r.byType))))];
out.push(types.length
  ? table(['種別', ...STYLES], types.map((ty) => [ty, ...STYLES.map((st) => {
      const d = runs[st].reduce((t, r) => t + (r.byType[ty]?.done ?? 0), 0);
      const f = runs[st].reduce((t, r) => t + (r.byType[ty]?.failed ?? 0), 0);
      return `${d}/${f}`;
    })]))
  : 'なし');
out.push('');

const lazy = runs['quests-lazy'];
const dl = runs['quests-deadline'];
const none = runs['no-quests'];
const goldGap = mean(dl.map((r) => r.gold)) - mean(lazy.map((r) => r.gold));
const repGap = mean(dl.map((r) => r.rep)) - mean(lazy.map((r) => r.rep));
const noneGold = mean(none.map((r) => r.gold));
const conds = [
  { label: '所持金 deadline − lazy ≥ +300G', value: gold(goldGap), ok: goldGap >= 300 },
  { label: '評判 deadline − lazy ≥ +5', value: fix(repGap), ok: repGap >= 5 },
  { label: `no-quests の${LAST_DAY}日目の所持金 < 0`, value: gold(noneGold), ok: noneGold < 0 },
];
out.push('#### 判定: 締め切りだけで圧力が十分か');
out.push('');
out.push(table(['条件', '値', '結果'], conds.map((c) => [c.label, c.value, c.ok ? '満たす' : '満たさない'])));
out.push('');
out.push(`→ ${conds.every((c) => c.ok) ? '十分' : '不十分'}`);
out.push('');

// 去った分を雇い直すと名簿の人数だけでは減りが見えないので、在籍した全員に対する割合で見る
const keptRate = (r: Run) => r.staff / (r.staff + r.resigned);
const mailConds: { label: string; cell: (rs: Run[]) => [string, boolean] }[] = [
  {
    label: `隊員が半分以上残る(${LAST_DAY}日目の名簿 ÷ (名簿 + 退職者) ≥ 50%)`,
    cell: (rs) => { const v = mean(rs.map(keptRate)); return [pct(v), v >= 0.5]; },
  },
  {
    label: '全員辞めた seed が無い',
    cell: (rs) => { const n = rs.filter((r) => r.staff === 0).length; return [`${n}/${rs.length}`, n === 0]; },
  },
  {
    label: `収支が破綻しない(${LAST_DAY}日目の所持金 ≥ 0)`,
    cell: (rs) => { const v = mean(rs.map((r) => r.gold)); return [gold(v), v >= 0]; },
  },
];
out.push(`#### 判定: メールに${MAIL === 'reply' ? '返信して' : '返信せずに'}遊べるか`);
out.push('');
out.push(table(['条件', ...STYLES], mailConds.map((c) => [c.label, ...STYLES.map((st) => {
  const [value, ok] = c.cell(runs[st]);
  return `${value}(${ok ? '満たす' : '満たさない'})`;
})])));
out.push('');
const [dlKept, dlKeptOk] = mailConds[0].cell(dl);
const [dlGone] = mailConds[1].cell(dl);
const [dlGold, dlGoldOk] = mailConds[2].cell(dl);
out.push(`→ quests-deadline で${MAIL === 'reply' ? '返信すると' : '返信しないと'}、隊員は${dlKeptOk ? '半分以上残る' : '半分も残らない'}(${dlKept}、全員辞めた seed ${dlGone})。`
  + `収支は${dlGoldOk ? '破綻しない' : '破綻する'}(${dlGold}、借金${fix(mean(dl.map((r) => r.debtDays)))}日、`
  + `昇給承認${fix(mean(dl.map((r) => r.raises)))}回、日給合計${gold(mean(dl.map((r) => r.payroll)))})。`);
out.push('');
out.push(`処理時間: ${elapsed.toFixed(2)}秒`);
console.log(out.join('\n'));
