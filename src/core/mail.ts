// メール(第6節の表): 発火条件の判定、文面の差し込み、返信の効果、自己退職。判定は advanceDay の忠誠+1の後に1日1回。
import { salaryOf } from './adventurer';
import { DUNGEON, DUNGEONS, MAIL_TEXT, TUNING } from './data';
import { exploredRate, parseFloor } from './dungeon';
import { getRelation, pairKey } from './relations';
import type { Rng } from './rng';
import {
  LOYALTY_MAX, LOYALTY_MILESTONES,
  type Adventurer, type GameState, type Mail, type MailKind, type Result,
} from './types';

const M = TUNING.mail;
/** 第6節の表: 昇給を連続でこの回数断ると退職警告 */
const WARN_REFUSALS = 2;
/** 噂が届く探索率 */
const RUMOR_RATES = [0.5, 1];
/** 1日3通の上限で溢れた挨拶を、雇ってからこの日数までは翌日以降に回す */
const GREETING_DAYS = 7;
/** 同じ日に複数あるときの優先順。人の去就に関わるものほど先 */
const PRIORITY: MailKind[] = ['warning', 'raise', 'rest', 'complaint', 'loyalty', 'greeting', 'rumor'];
/** 差出人が冒険者でないときの口調 */
const DEFAULT_VOICE = 'cautious';

const ok = (): Result => ({ ok: true });
const fail = (reason: string): Result => ({ ok: false, reason });
const num = (v: number | boolean | undefined) => (typeof v === 'number' ? v : 0);

type Vars = Record<string, string | number>;
interface Pending {
  kind: MailKind;
  a: Adventurer | null;
  vars: Vars;
  payload: Record<string, string | number>;
  commit: () => void;
}

export function desiredSalary(a: Adventurer): number {
  return salaryOf(a);
}

function addLoyalty(a: Adventurer, delta: number) {
  a.loyalty = Math.max(0, Math.min(LOYALTY_MAX, a.loyalty + delta));
}

/** 文面の差し込み。kind × 性格の定型に {name} などを入れる */
export function composeMail(kind: MailKind, a: Adventurer | null, vars: Vars = {}): Pick<Mail, 'subject' | 'body' | 'choices'> {
  const table = MAIL_TEXT.text[kind] ?? {};
  const t = table[a?.personality ?? DEFAULT_VOICE] ?? table[DEFAULT_VOICE] ?? { subject: kind, body: '' };
  const all: Vars = a
    ? { name: a.name, salary: a.salary, desired: desiredSalary(a), hobby: a.persona.hobby, likes: a.persona.likes, ...vars }
    : vars;
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (raw, k: string) => (k in all ? String(all[k]) : raw));
  return { subject: fill(t.subject), body: fill(t.body), choices: (MAIL_TEXT.choices[kind] ?? []).map((c) => ({ ...c })) };
}

function send(s: GameState, kind: MailKind, a: Adventurer | null, vars: Vars, payload: Record<string, string | number>): Mail {
  const seq = num(s.flags.mailSeq) + 1;
  s.flags.mailSeq = seq;
  const mail: Mail = {
    id: `m${seq}`, day: s.day, kind, from: a ? a.id : 'guild',
    ...composeMail(kind, a, vars),
    answered: null, read: false, payload,
  };
  s.mails.push(mail);
  return mail;
}

/** 挨拶を出さない(初期メンバー)。到達済みの節目も済みにして、加入直後に節目メールが来ないようにする */
export function markGreeted(s: GameState, a: Adventurer) {
  s.flags['greeted:' + a.id] = true;
  for (const m of LOYALTY_MILESTONES) if (a.loyalty >= m) s.flags[`loyal:${a.id}:${m}`] = true;
}

/** dispatch で呼ぶ。関係値が悪い相手と同じ隊に入った回数を、本人の派遣ごとに数える(別の隊に出たら0に戻る) */
export function recordParty(s: GameState, partyIds: string[]) {
  for (const id of partyIds) {
    const a = s.adventurers.find((x) => x.id === id);
    if (!a) continue;
    for (const b of s.adventurers) {
      if (b === a) continue;
      const k = `mates:${a.id}|${b.id}`;
      if (partyIds.includes(b.id) && getRelation(s.relations, a, b) <= M.complaintRelation) s.flags[k] = num(s.flags[k]) + 1;
      else if (k in s.flags) delete s.flags[k];
    }
  }
}

/** dispatch の検証。休ませると返した日と、分けると返した2人 */
export function dispatchBlock(s: GameState, members: Adventurer[]): string | null {
  for (const a of members) if (s.flags['rest:' + a.id] === s.day) return `${a.name}は今日は休ませています`;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const v = s.flags['split:' + pairKey(members[i].id, members[j].id)];
      if (typeof v === 'number' && s.day - v < M.splitDays) return `${members[i].name}と${members[j].name}は分けると約束しています`;
    }
  }
  return null;
}

/** 疲労が残ったまま派遣に組まれた人。翌日以降に「休みたい」が届く */
export function markTired(s: GameState, members: Adventurer[]) {
  for (const a of members) if (a.fatigue > M.restFatigue) s.flags['tiredDispatch:' + a.id] = s.day;
}

function warningOf(s: GameState, a: Adventurer): Pending | null {
  if (a.history.warnedDay !== null) return null;
  const retained = s.flags['retained:' + a.id];
  const cooling = typeof retained === 'number' && s.day - retained <= M.resignDays;
  const low = a.loyalty < (cooling ? M.resignLoyalty : M.warnLoyalty);
  if (a.history.raisesRefused < WARN_REFUSALS && !low) return null;
  const desired = desiredSalary(a);
  return { kind: 'warning', a, vars: { desired }, payload: { desired }, commit: () => { a.history.warnedDay = s.day; } };
}

function raiseOf(s: GameState, a: Adventurer): Pending | null {
  const desired = desiredSalary(a);
  if (a.salary >= desired * M.raiseThreshold) return null;
  if (s.mails.some((m) => m.kind === 'raise' && m.from === a.id && m.answered === null)) return null;
  const at = s.flags['raiseAt:' + a.id];
  if (typeof at === 'number' && s.day - at < M.raiseResendDays) return null;
  return {
    kind: 'raise', a, vars: { desired }, payload: { desired, salary: a.salary },
    commit: () => { s.flags['raiseAt:' + a.id] = s.day; },
  };
}

function restOf(s: GameState, a: Adventurer): Pending | null {
  const k = 'tiredDispatch:' + a.id;
  const t = s.flags[k];
  if (typeof t !== 'number' || t >= s.day) return null;
  return { kind: 'rest', a, vars: {}, payload: { dispatchedDay: t }, commit: () => { delete s.flags[k]; } };
}

function complaintOf(s: GameState, a: Adventurer): Pending | null {
  for (const b of s.adventurers) {
    if (b === a) continue;
    const k = `mates:${a.id}|${b.id}`;
    if (num(s.flags[k]) < M.complaintStreak || getRelation(s.relations, a, b) > M.complaintRelation) continue;
    return { kind: 'complaint', a, vars: { mate: b.name }, payload: { mate: b.id }, commit: () => { delete s.flags[k]; } };
  }
  return null;
}

function loyaltyOf(s: GameState, a: Adventurer): Pending | null {
  // 挨拶より先に節目が届かないように
  if (!s.flags['greeted:' + a.id] && s.day <= a.history.hiredDay + GREETING_DAYS) return null;
  for (const m of LOYALTY_MILESTONES) {
    const k = `loyal:${a.id}:${m}`;
    if (a.loyalty < m || s.flags[k]) continue;
    return { kind: 'loyalty', a, vars: { milestone: m }, payload: { milestone: m }, commit: () => { s.flags[k] = true; } };
  }
  return null;
}

function greetingOf(s: GameState, a: Adventurer): Pending | null {
  if (s.flags['greeted:' + a.id] || s.day <= a.history.hiredDay || s.day > a.history.hiredDay + GREETING_DAYS) return null;
  return { kind: 'greeting', a, vars: {}, payload: {}, commit: () => markGreeted(s, a) };
}

function dungeonRate(s: GameState, dungeonId: string): number {
  const def = DUNGEON[dungeonId];
  const prog = s.dungeons[dungeonId];
  if (!def || !prog || def.floors.length === 0) return 0;
  const sum = def.floors.reduce((t, f) => t + exploredRate(parseFloor(f), prog.floors[f.id]?.visited ?? []), 0);
  return sum / def.floors.length;
}

function rumorOf(s: GameState, rng: Rng, voices: Adventurer[]): Pending | null {
  for (const d of DUNGEONS) {
    if (!s.dungeons[d.id]?.confirmed) continue;
    const keys = RUMOR_RATES.map((r) => `rumor:${d.id}:${Math.round(r * 100)}`);
    if (keys.every((k) => s.flags[k])) continue;
    const rate = dungeonRate(s, d.id);
    for (let i = 0; i < RUMOR_RATES.length; i++) {
      const k = keys[i];
      if (rate < RUMOR_RATES[i] || s.flags[k]) continue;
      const unknown = DUNGEONS.filter((x) => s.dungeons[x.id] && !s.dungeons[x.id].confirmed);
      if (unknown.length === 0) { s.flags[k] = true; continue; }
      const fresh = unknown.filter((x) => !s.flags['rumored:' + x.id]);
      const target = rng.pick(fresh.length ? fresh : unknown);
      const voice = voices.length ? rng.pick(voices) : null;
      return {
        kind: 'rumor', a: voice, vars: { dungeon: target.name }, payload: { dungeon: target.id, rate: Math.round(RUMOR_RATES[i] * 100) },
        commit: () => { s.flags[k] = true; s.flags['rumored:' + target.id] = true; },
      };
    }
  }
  return null;
}

/** 返信しないまま日数が過ぎたものは保留扱い。昇給は再送される。警告は退職まで開いておく */
function expireMails(s: GameState) {
  for (const m of s.mails) {
    if (m.answered !== null || m.choices.length === 0 || m.kind === 'warning' || s.day - m.day < M.raiseResendDays) continue;
    m.answered = 'hold';
    // 返信しないだけで断る扱いにはしない。保留の回数は上限で止める
    if (m.kind === 'raise') s.flags['raiseHolds:' + m.from] = Math.min(M.holdMax, num(s.flags['raiseHolds:' + m.from]) + 1);
  }
}

/** 今日届くメールを判定して s.mails に入れる。同じ人からは1日1通、全体で perDay 通まで。溢れた分は条件が続く限り翌日以降に届く */
export function checkMails(s: GameState, rng: Rng, notices: string[]): Mail[] {
  expireMails(s);
  const today = s.mails.filter((m) => m.day === s.day);
  const busy = new Set(today.map((m) => m.from));
  const pending: Pending[] = [];
  const voices: Adventurer[] = [];
  for (const a of s.adventurers) {
    if (busy.has(a.id)) continue;
    const p = warningOf(s, a) ?? raiseOf(s, a) ?? restOf(s, a) ?? complaintOf(s, a) ?? loyaltyOf(s, a) ?? greetingOf(s, a);
    if (p) pending.push(p);
    else voices.push(a);
  }
  const rumor = rumorOf(s, rng, voices);
  if (rumor) pending.push(rumor);
  pending.sort((x, y) => PRIORITY.indexOf(x.kind) - PRIORITY.indexOf(y.kind));
  const out: Mail[] = [];
  for (const p of pending.slice(0, Math.max(0, M.perDay - today.length))) {
    p.commit();
    out.push(send(s, p.kind, p.a, p.vars, p.payload));
  }
  if (out.length) notices.push(`メールが${out.length}通届いた。`);
  return out;
}

/** 警告から resignDays を過ぎた人が去る。派遣中・訓練中は戻ってから */
export function applyResignations(s: GameState, notices: string[]): Mail[] {
  const out: Mail[] = [];
  for (const a of [...s.adventurers]) {
    const w = a.history.warnedDay;
    if (w === null || s.day <= w + M.resignDays || a.status === 'away' || a.status === 'training') continue;
    out.push(send(s, 'resign', a, {}, {}));
    s.adventurers = s.adventurers.filter((x) => x !== a);
    s.flags['gone:' + a.id] = true;
    s.flags['goneName:' + a.name] = true;
    notices.push(`${a.name}がギルドを去った。`);
  }
  return out;
}

function approveRaise(s: GameState, a: Adventurer) {
  a.salary = desiredSalary(a);
  addLoyalty(a, M.reply.accept);
  a.history.raisesRefused = 0;
  a.history.warnedDay = null;
  delete s.flags['raiseHolds:' + a.id];
}

function refuseRaise(s: GameState, a: Adventurer) {
  addLoyalty(a, M.reply.refuse);
  a.history.raisesRefused++;
  delete s.flags['raiseHolds:' + a.id];
}

export function replyMail(s: GameState, mailId: string, choiceId: string): Result {
  const m = s.mails.find((x) => x.id === mailId);
  if (!m) return fail('そのメールはありません');
  if (m.answered !== null) return fail('返信済みです');
  if (!m.choices.some((c) => c.id === choiceId)) return fail('その返事は選べません');
  const a = s.adventurers.find((x) => x.id === m.from);
  if (!a) return fail('差出人はもうギルドにいません');
  let answered = choiceId;
  switch (`${m.kind}:${choiceId}`) {
    case 'raise:accept': approveRaise(s, a); break;
    case 'raise:refuse': refuseRaise(s, a); break;
    case 'raise:hold': {
      const holds = num(s.flags['raiseHolds:' + a.id]);
      if (holds >= M.holdMax) { refuseRaise(s, a); answered = 'refuse'; } else s.flags['raiseHolds:' + a.id] = holds + 1;
      break;
    }
    case 'warning:retain':
      approveRaise(s, a);
      s.flags['retained:' + a.id] = s.day;
      break;
    case 'rest:rest':
      addLoyalty(a, M.reply.rest);
      s.flags['rest:' + a.id] = s.day;
      break;
    case 'rest:deny': addLoyalty(a, M.reply.deny); break;
    case 'complaint:split':
      addLoyalty(a, M.reply.split);
      s.flags['split:' + pairKey(a.id, String(m.payload.mate))] = s.day;
      break;
    case 'complaint:keep': addLoyalty(a, M.reply.keep); break;
  }
  m.answered = answered;
  m.read = true;
  return ok();
}

export function unreadCount(s: GameState): number {
  return s.mails.filter((m) => !m.read).length;
}

export function markRead(s: GameState, id: string): boolean {
  const m = s.mails.find((x) => x.id === id);
  if (!m) return false;
  m.read = true;
  return true;
}
