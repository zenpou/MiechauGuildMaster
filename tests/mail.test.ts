import { describe, expect, it } from 'vitest';
import { DUNGEON, TUNING } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { advanceDay, dispatch, newGame } from '../src/core/game';
import { checkMails, composeMail, desiredSalary, markRead, pruneMails, recordParty, replyMail, unreadCount } from '../src/core/mail';
import { hire } from '../src/core/recruit';
import { pairKey } from '../src/core/relations';
import { rngFor } from '../src/core/rng';
import { deserialize, serialize } from '../src/core/save';
import type { DispatchOrder, GameState, Mail, MailKind } from '../src/core/types';
import { fullGame } from './helpers';

const M = TUNING.mail;

function order(ids: string[], o: Partial<DispatchOrder> = {}): DispatchOrder {
  return {
    partyIds: ids, leaderId: ids[0], action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' },
    policy: 'standard', days: 2, items: {},
    ...o,
  };
}

function rich(seed = 1): GameState {
  const s = fullGame(seed);
  // 退職の対象は汎用の者だけなので、先頭を汎用にする(ユニークは末尾へ)
  s.adventurers = [
    ...s.adventurers.filter((a) => !a.unique),
    ...s.adventurers.filter((a) => a.unique),
  ];
  s.gold = 1_000_000;
  return s;
}

const check = (s: GameState, notices: string[] = []) => checkMails(s, rngFor(s.seed, 'mail', s.day), notices);
const ofKind = (mails: Mail[], kind: string, from?: string) => mails.filter((m) => m.kind === kind && (!from || m.from === from));

describe('挨拶', () => {
  it('雇用の翌日に届き、初期メンバーからは届かない', () => {
    const s = rich();
    const id = s.candidates[0].adv.id;
    expect(hire(s, id).ok).toBe(true);
    const r = advanceDay(s);
    expect(ofKind(r.mails, 'greeting', id)).toHaveLength(1);
    expect(ofKind(r.mails, 'greeting')).toHaveLength(1);
    expect(ofKind(r.mails, 'greeting', id)[0].body).toContain(s.adventurers.find((a) => a.id === id)!.name);
    const r2 = advanceDay(s);
    expect(ofKind(r2.mails, 'greeting')).toHaveLength(0);
  });
});

describe('忠誠の節目', () => {
  it('節目(120)に達すると1通だけ届く', () => {
    const s = rich();
    const a = s.adventurers[0];
    a.loyalty = 119;
    expect(ofKind(check(s), 'loyalty', a.id)).toHaveLength(0);
    a.loyalty = 120;
    const got = ofKind(check(s), 'loyalty', a.id);
    expect(got).toHaveLength(1);
    expect(got[0].payload.milestone).toBe(120);
    s.day++;
    expect(ofKind(check(s), 'loyalty', a.id)).toHaveLength(0);
  });

  it('初期メンバーは開業時に越えている節目では届かない', () => {
    const s = rich();
    for (const a of s.adventurers) a.loyalty = Math.max(a.loyalty, 50);
    const fresh = s.adventurers.filter((a) => !s.flags[`loyal:${a.id}:50`]);
    expect(ofKind(check(s), 'loyalty')).toHaveLength(Math.min(fresh.length, M.perDay));
  });

  it('ユニークの忠誠節目は人物別ストーリーに任せ、汎用メールを送らない', () => {
    const s = newGame(1);
    s.adventurers = s.adventurers.filter((a) => a.unique);
    for (const a of s.adventurers) {
      a.loyalty = 120;
      s.flags[`loyal:${a.id}:50`] = true;
    }
    expect(ofKind(check(s), 'loyalty')).toHaveLength(0);
  });

  it('女性の自信家を含む全メール種別で男性一人称を出さない', () => {
    const s = newGame(1);
    const a = { ...s.adventurers[0], unique: undefined, gender: 'female' as const, personality: 'proud' };
    const kinds: MailKind[] = ['greeting', 'loyalty', 'raise', 'warning', 'resign', 'rest', 'complaint', 'rumor', 'quest', 'event'];
    for (const kind of kinds) expect(composeMail(kind, a).body, kind).not.toContain('俺');

    const unique = { ...a, unique: 'viola' };
    for (const kind of kinds) expect(composeMail(kind, unique).body, `viola/${kind}`).not.toContain('俺');
  });
});

describe('昇給', () => {
  it('日給が再計算値のしきい値(raiseThreshold)未満で要望が届き、以上なら届かない', () => {
    const s = rich();
    const a = s.adventurers[0];
    const desired = desiredSalary(a);
    a.salary = Math.ceil(desired * M.raiseThreshold);
    expect(ofKind(check(s), 'raise', a.id)).toHaveLength(0);
    a.salary = Math.floor(desired * 0.5);
    const got = ofKind(check(s), 'raise', a.id);
    expect(got).toHaveLength(1);
    expect(got[0].payload.desired).toBe(desired);
    expect(got[0].choices.map((c) => c.id)).toEqual(['accept', 'hold', 'refuse']);
  });

  it('承認で日給が更新され忠誠+5', () => {
    const s = rich();
    const a = s.adventurers[0];
    a.salary = 1;
    a.loyalty = 40;
    const [m] = ofKind(check(s), 'raise', a.id);
    expect(replyMail(s, m.id, 'accept').ok).toBe(true);
    expect(a.salary).toBe(desiredSalary(a));
    expect(a.loyalty).toBe(45);
    expect(m.answered).toBe('accept');
    expect(replyMail(s, m.id, 'accept').ok).toBe(false);
  });

  it('断ると忠誠−20、raisesRefused+1', () => {
    const s = rich();
    const a = s.adventurers[0];
    a.salary = 1;
    a.loyalty = 100;
    const [m] = ofKind(check(s), 'raise', a.id);
    expect(replyMail(s, m.id, 'refuse').ok).toBe(true);
    expect(a.loyalty).toBe(80);
    expect(a.history.raisesRefused).toBe(1);
    expect(a.salary).toBe(1);
  });

  it('保留は7日後に再送され、3回目の保留は断る扱い', () => {
    const s = rich();
    const a = s.adventurers[0];
    a.salary = 1;
    a.loyalty = 100;
    for (let i = 0; i < M.holdMax; i++) {
      const [m] = ofKind(check(s), 'raise', a.id);
      expect(replyMail(s, m.id, 'hold').ok).toBe(true);
      s.day++;
      expect(ofKind(check(s), 'raise', a.id)).toHaveLength(0);
      s.day += M.raiseResendDays - 1;
    }
    const [m] = ofKind(check(s), 'raise', a.id);
    expect(replyMail(s, m.id, 'hold').ok).toBe(true);
    expect(a.history.raisesRefused).toBe(1);
    expect(a.loyalty).toBe(80);
  });

  it('返信しないまま期限切れを繰り返すと、明示的な保留と同じく3回目で断る扱い(無視が得にならない)', () => {
    const s = rich();
    const a = s.adventurers[0];
    a.salary = 1;
    a.loyalty = 100;
    const raises = () => s.mails.filter((m) => m.kind === 'raise' && m.from === a.id);
    check(s);
    for (let i = 0; i < M.holdMax + 1; i++) {
      s.day += M.raiseResendDays;
      check(s);
    }
    expect(raises().slice(0, 3).map((m) => m.answered)).toEqual(['hold', 'hold', 'refuse']);
    expect(a.history.raisesRefused).toBe(1);
    expect(a.loyalty).toBe(80);
  });

  it('不正な選択肢・存在しないメールは ok:false', () => {
    const s = rich();
    const a = s.adventurers[0];
    a.salary = 1;
    const [m] = ofKind(check(s), 'raise', a.id);
    expect(replyMail(s, m.id, 'xxx').ok).toBe(false);
    expect(replyMail(s, 'nope', 'accept').ok).toBe(false);
  });
});

describe('退職', () => {
  function refuseTwice(s: GameState) {
    const a = s.adventurers[0];
    a.salary = 1;
    a.loyalty = 200;
    for (let i = 0; i < 2; i++) {
      const [m] = ofKind(check(s), 'raise', a.id);
      replyMail(s, m.id, 'refuse');
      s.day += M.raiseResendDays;
    }
    return a;
  }

  it('2回連続で断ると退職警告が届く', () => {
    const s = rich();
    const a = refuseTwice(s);
    const got = ofKind(check(s), 'warning', a.id);
    expect(got).toHaveLength(1);
    expect(a.history.warnedDay).toBe(s.day);
    expect(ofKind(check(s), 'warning', a.id)).toHaveLength(0);
  });

  it('忠誠30未満でも退職警告が届く', () => {
    const s = rich();
    const a = s.adventurers[1];
    a.loyalty = M.warnLoyalty - 1;
    expect(ofKind(check(s), 'warning', a.id)).toHaveLength(1);
  });

  it('警告から7日過ぎると自己退職し、名簿から消える', () => {
    const s = rich();
    const a = refuseTwice(s);
    check(s);
    const warned = a.history.warnedDay!;
    const reports = [];
    while (s.day <= warned + M.resignDays) {
      reports.push(advanceDay(s));
      if (s.day <= warned + M.resignDays) expect(s.adventurers.some((x) => x.id === a.id)).toBe(true);
    }
    expect(s.day).toBe(warned + M.resignDays + 1);
    expect(s.adventurers.some((x) => x.id === a.id)).toBe(false);
    expect(s.flags['gone:' + a.id]).toBe(true);
    expect(s.flags['goneName:' + a.name]).toBe(true);
    expect(ofKind(reports[reports.length - 1].mails, 'resign', a.id)).toHaveLength(1);
  });

  it('派遣中なら帰還まで退職しない', () => {
    const s = rich();
    const a = s.adventurers[0];
    a.history.warnedDay = s.day - M.resignDays;
    const r = dispatch(s, order([a.id]));
    if (!r.ok) throw new Error(r.reason);
    advanceDay(s);
    expect(s.adventurers.some((x) => x.id === a.id)).toBe(true);
    while (s.expeditions.length) advanceDay(s);
    advanceDay(s);
    expect(s.adventurers.some((x) => x.id === a.id)).toBe(false);
  });

  it('引き留めると撤回され、日給が上がって残る', () => {
    const s = rich();
    const a = refuseTwice(s);
    const [w] = ofKind(check(s), 'warning', a.id);
    expect(w.choices.map((c) => c.id)).toContain('retain');
    expect(replyMail(s, w.id, 'retain').ok).toBe(true);
    expect(a.history.warnedDay).toBeNull();
    expect(a.history.raisesRefused).toBe(0);
    expect(a.salary).toBe(desiredSalary(a));
    for (let i = 0; i < M.resignDays + 3; i++) advanceDay(s);
    expect(s.adventurers.some((x) => x.id === a.id)).toBe(true);
  });

  it('退職者の名前は候補者に出ない', () => {
    const s = rich();
    const name = s.candidates[0].adv.name;
    s.flags['goneName:' + name] = true;
    s.candidates = [];
    for (let d = 0; d < 30; d++) advanceDay(s);
    expect(s.candidates.some((c) => c.adv.name === name)).toBe(false);
  });
});

describe('休みたい', () => {
  it('疲労70超で派遣された翌日に届く', () => {
    const s = rich();
    const [a, b] = s.adventurers;
    a.fatigue = M.restFatigue + 1;
    b.fatigue = M.restFatigue;
    const r = dispatch(s, order([a.id, b.id]));
    if (!r.ok) throw new Error(r.reason);
    expect(s.flags['tiredDispatch:' + a.id]).toBe(s.day);
    expect(s.flags['tiredDispatch:' + b.id]).toBeUndefined();
    const rep = advanceDay(s);
    expect(ofKind(rep.mails, 'rest', a.id)).toHaveLength(1);
    expect(ofKind(rep.mails, 'rest', b.id)).toHaveLength(0);
    expect(ofKind(advanceDay(s).mails, 'rest', a.id)).toHaveLength(0);
  });

  it('休ませると忠誠+2、その日は派遣できない', () => {
    const s = rich();
    const a = s.adventurers[0];
    s.flags['tiredDispatch:' + a.id] = s.day - 1;
    a.loyalty = 100;
    const [m] = ofKind(check(s), 'rest', a.id);
    expect(replyMail(s, m.id, 'rest').ok).toBe(true);
    expect(a.loyalty).toBe(102);
    expect(dispatch(s, order([a.id])).ok).toBe(false);
    s.day++;
    expect(dispatch(s, order([a.id])).ok).toBe(true);
  });
});

describe('仲間への不満', () => {
  it('関係値−40以下の相手と連続3回同じ隊で届き、分けると7日は一緒に出せない', () => {
    const s = rich();
    const [a, b, c] = s.adventurers;
    s.relations[pairKey(a.id, b.id)] = M.complaintRelation;
    recordParty(s, [a.id, b.id]);
    recordParty(s, [a.id, c.id]);
    recordParty(s, [b.id, c.id]);
    recordParty(s, [a.id, b.id]);
    recordParty(s, [a.id, b.id]);
    expect(ofKind(check(s), 'complaint')).toHaveLength(0);
    recordParty(s, [a.id, b.id]);
    const got = ofKind(check(s), 'complaint');
    expect(got).toHaveLength(2);
    const [m] = ofKind(got, 'complaint', a.id);
    expect(m.payload.mate).toBe(b.id);
    a.loyalty = 100;
    expect(replyMail(s, m.id, 'split').ok).toBe(true);
    expect(a.loyalty).toBe(102);
    expect(dispatch(s, order([a.id, b.id])).ok).toBe(false);
    s.day += 8;
    expect(dispatch(s, order([a.id, b.id])).ok).toBe(true);
  });

  it('dispatch で同じ隊の回数が数えられる', () => {
    const s = rich();
    const [a, b] = s.adventurers;
    s.relations[pairKey(a.id, b.id)] = -50;
    const r = dispatch(s, order([a.id, b.id]));
    expect(r.ok).toBe(true);
    expect(s.flags[`mates:${a.id}|${b.id}`]).toBe(1);
    expect(s.flags[`mates:${b.id}|${a.id}`]).toBe(1);
  });
});

describe('噂', () => {
  it('探索率50%到達で未確認のダンジョンの噂が1通届く', () => {
    const s = rich();
    const def = DUNGEON.forest_cave;
    const fl = def.floors[0];
    const n = parseFloor(fl).cells.length;
    s.dungeons.forest_cave.floors[fl.id].visited = Array.from({ length: n }, (_, i) => i);
    const got = ofKind(check(s), 'rumor');
    expect(got).toHaveLength(1);
    const d = String(got[0].payload.dungeon);
    expect(DUNGEON[d]).toBeDefined();
    expect(s.dungeons[d].confirmed).toBe(false);
    s.day++;
    expect(ofKind(check(s), 'rumor')).toHaveLength(1);
    s.day++;
    expect(ofKind(check(s), 'rumor')).toHaveLength(0);
  });
});

describe('受信箱', () => {
  it('1日3通まで、溢れた分は翌日以降に届く', () => {
    const s = rich();
    // 節目50が残っている人は翌日に120を出すので、1人1通に揃える
    for (const a of s.adventurers) { a.loyalty = 120; s.flags[`loyal:${a.id}:50`] = true; }
    const genericCount = s.adventurers.filter((a) => !a.unique).length;
    const notices: string[] = [];
    expect(check(s, notices)).toHaveLength(M.perDay);
    expect(notices.length).toBeGreaterThan(0);
    s.day++;
    expect(ofKind(check(s), 'loyalty')).toHaveLength(Math.max(0, genericCount - M.perDay));
  });

  it('同じ人からは1日1通まで', () => {
    const s = rich();
    const a = s.adventurers[0];
    a.loyalty = 120;
    a.salary = 1;
    expect(check(s).filter((m) => m.from === a.id)).toHaveLength(1);
  });

  it('未読数と既読', () => {
    const s = rich();
    s.adventurers[0].loyalty = 120;
    const [m] = check(s);
    expect(unreadCount(s)).toBe(1);
    markRead(s, m.id);
    expect(unreadCount(s)).toBe(0);
  });

  it('同じ入力なら同じメール(決定論)', () => {
    const run = () => {
      const s = rich(9);
      s.adventurers[0].salary = 1;
      s.adventurers[1].loyalty = 25;
      const id = s.candidates[0].adv.id;
      hire(s, id);
      for (let d = 0; d < 20; d++) advanceDay(s);
      return JSON.stringify(s.mails);
    };
    expect(run()).toBe(run());
  });
});

describe('受信箱の整理', () => {
  let seq = 0;
  /** 受信箱に直に積む。既定は昨日届いた既読の挨拶(選択肢なし) */
  function put(s: GameState, o: Partial<Mail> = {}): Mail {
    const kind = o.kind ?? 'greeting';
    const m: Mail = {
      id: `t${++seq}`, day: s.day - 1, kind, from: 'guild', ...composeMail(kind, null),
      answered: null, read: true, payload: {}, ...o,
    };
    s.mails.push(m);
    return m;
  }
  const many = (s: GameState, n: number, o: Partial<Mail> = {}) => Array.from({ length: n }, () => put(s, o));

  it('残す通数の既定は40', () => {
    expect(M.keep).toBe(40);
  });

  it('既読の返信済み・選択肢なしは、新しい順に keep 通を超えた古い分だけ消え、消した通数を返す。並びは古い順のまま', () => {
    const s = rich();
    const answered = many(s, 3, { kind: 'raise', answered: 'accept' });
    const plain = many(s, M.keep);
    expect(pruneMails(s)).toBe(3);
    expect(s.mails).toEqual(plain);
    expect(pruneMails(s)).toBe(0);
    expect(answered.some((m) => s.mails.includes(m))).toBe(false);
  });

  it('keep 通以下なら1通も消さない', () => {
    const s = rich();
    const all = many(s, M.keep);
    expect(pruneMails(s)).toBe(0);
    expect(s.mails).toEqual(all);
  });

  it('未読・返信待ち(差出人が在籍中)・警告は、古くても数に入れず消さない', () => {
    const s = rich();
    const [a, b] = s.adventurers;
    const unread = put(s, { read: false });
    const waiting = put(s, { kind: 'raise', from: a.id });
    const warned = put(s, { kind: 'warning', from: b.id });
    const retained = put(s, { kind: 'warning', from: b.id, answered: 'retain' });
    const old = put(s);
    const fresh = many(s, M.keep);
    expect(pruneMails(s)).toBe(1);
    expect(s.mails).toEqual([unread, waiting, warned, retained, ...fresh]);
    expect(s.mails.includes(old)).toBe(false);
  });

  it('checkMails の終わりに整理する。返信待ちは残る', () => {
    const s = rich();
    many(s, M.keep + 25);
    const waiting = put(s, { kind: 'rest', from: s.adventurers[0].id, day: s.day });
    check(s);
    expect(s.mails.filter((m) => m.read && m.choices.length === 0)).toHaveLength(M.keep);
    expect(s.mails.includes(waiting)).toBe(true);
  });

  it('整理の無かった頃のセーブも、読み込んで1日進めれば keep 通まで縮む', () => {
    const s = rich();
    many(s, M.keep + 25);
    const loaded = deserialize(serialize(s))!;
    expect(loaded.mails).toHaveLength(M.keep + 25);
    advanceDay(loaded);
    expect(loaded.mails.filter((m) => m.read)).toHaveLength(M.keep);
  });
});

describe('差出人名の控え', () => {
  it('冒険者のメールには差出人の名前が残り、本人が去った後も名前が引ける', () => {
    const s = newGame(51);
    const a = s.adventurers[0];
    a.salary = 1;
    a.level = 5;
    for (let i = 0; i < 3 && !s.mails.some((m) => m.from === a.id); i++) advanceDay(s);
    const m = s.mails.find((x) => x.from === a.id);
    expect(m).toBeDefined();
    expect(m!.fromName).toBe(a.name);
    s.adventurers = s.adventurers.filter((x) => x.id !== a.id);
    expect(m!.fromName).toBe(a.name);
  });
});
