import { NODE, TUNING } from '../core/data';
import { markRead, replyMail, unreadCount } from '../core/mail';
import type { Adventurer, GameState, Mail, MailChoice, MailKind } from '../core/types';
import { advById, commit, render, sign, state, toast, ui } from './app';
import { div, h, span } from './dom';

const KIND_LABEL: Record<MailKind, string> = {
  greeting: '挨拶', loyalty: '節目', raise: '昇給', warning: '退職の意向', resign: '退職',
  rest: '休み', complaint: '不満', rumor: '噂', quest: '依頼', event: '相談',
};

/** 返信した後の一文。キーは「種類:実際に入った返事」 */
const REPLY_DONE: Record<string, string> = {
  'raise:accept': '昇給を承認した',
  'raise:hold': '昇給を保留した',
  'raise:refuse': '昇給を断った',
  'warning:retain': '昇給して引き留めた',
  'warning:leave': '引き留めなかった',
  'rest:rest': '休ませることにした',
  'rest:deny': '休みを断った',
  'complaint:split': '隊を分けることにした',
  'complaint:keep': '隊はそのままにした',
};

/** 返事を待っているもの。差出人が去った後は返せない */
const waitingReply = (m: Mail) => m.choices.length > 0 && m.answered === null && !!advById(m.from);

function fromName(m: Mail): string {
  if (m.from === 'guild') return 'ギルド';
  if (m.from.startsWith('town:')) {
    const id = m.from.slice(5);
    return NODE[id]?.name ?? id;
  }
  return advById(m.from)?.name ?? m.fromName ?? '去った冒険者';
}

export function inboxTab(): HTMLElement {
  const list = [...state.mails].reverse();
  const waiting = state.mails.filter(waitingReply).length;
  const sel = state.mails.find((m) => m.id === ui.selMail) ?? null;
  return div('tab-body',
    div('summary',
      span('big', `未読 ${unreadCount(state)}通`),
      waiting ? span('neg', `返信待ち ${waiting}通`) : null,
      span('dim small', `全${state.mails.length}通`),
    ),
    div('dim small', `押すと本文が開き、既読になります。返事の要るものは選ぶまで「返信待ち」が付きます。読み終えたメールは新しい順に${TUNING.mail.keep}通まで残し、古いものから消えます(未読・返信待ち・退職の意向は消えません)。`),
    list.length
      ? h('ul', { class: 'plain maillist' }, ...list.map((m) => h('li', null,
        h('button', { class: [m.read ? '' : 'unread', m.id === ui.selMail ? 'sel' : ''].join(' ').trim(), onclick: () => open(m.id) },
          div('mail-head',
            span(`badge kind-${m.kind}`, KIND_LABEL[m.kind] ?? m.kind),
            m.read ? null : span('badge unread', '未読'),
            waitingReply(m) ? span('badge waiting', '返信待ち') : null,
            span('subject', m.subject),
          ),
          div('small dim', `${m.day}日目 ${fromName(m)}`),
        ),
        sel && m.id === sel.id ? mailBody(sel) : null,
      )))
      : div('dim', 'まだメールは届いていません'),
  );
}

function open(id: string) {
  if (ui.selMail === id) {
    ui.selMail = null;
    return render();
  }
  ui.selMail = id;
  const m = state.mails.find((x) => x.id === id);
  if (m && !m.read && markRead(state, id)) return commit();
  render();
}

function mailBody(m: Mail): HTMLElement {
  const answer = m.answered === null ? null : m.choices.find((c) => c.id === m.answered)?.label ?? '保留(返信しないまま期限切れ)';
  const orphan = m.choices.length > 0 && m.answered === null && !advById(m.from);
  return div('detail mail',
    h('h3', null, m.subject),
    div('small dim', `差出人: ${fromName(m)} / ${m.day}日目 / ${KIND_LABEL[m.kind] ?? m.kind}`),
    div('mail-text', m.body),
    waitingReply(m) ? div('choices',
      ...m.choices.map((c) => div('row tight',
        h('button', { class: 'small', onclick: () => reply(m.id, c) }, c.label),
        span('small dim', previewReply(m, c)),
      )),
      m.kind === 'warning'
        ? div('small neg', `警告から${TUNING.mail.resignDays}日のうちに引き留めないと、ギルドを去ります。`)
        : div('small dim', `返信しないまま${TUNING.mail.raiseResendDays}日たつと保留になります。`),
    ) : null,
    orphan ? div('small dim', '差出人はもうギルドにいないため、返信できません。') : null,
    answer ? div('small', '返信: ', span('pos', answer)) : null,
  );
}

/** 日給・忠誠の変わり方。返信の前後の差から作る */
function effects(before: Adventurer, after: Adventurer | undefined): string[] {
  if (!after) return [];
  const out: string[] = [];
  if (after.salary !== before.salary) out.push(`日給${before.salary}G→${after.salary}G`);
  if (after.loyalty !== before.loyalty) out.push(`忠誠${sign(after.loyalty - before.loyalty)}`);
  return out;
}

/** 返したらどうなるか。複製した状態で core の replyMail を試す(効果の表を UI に二重に持たないため) */
function previewReply(m: Mail, c: MailChoice): string {
  const before = advById(m.from);
  if (!before) return '';
  const trial: GameState = structuredClone(state);
  const r = replyMail(trial, m.id, c.id);
  if (!r.ok) return r.reason;
  const got = trial.mails.find((x) => x.id === m.id)?.answered;
  const fx = effects(before, trial.adventurers.find((x) => x.id === m.from));
  const note = got && got !== c.id ? `(${m.choices.find((x) => x.id === got)?.label ?? got}の扱い)` : '';
  return (fx.length ? fx.join('・') : '変化なし') + note;
}

function reply(mailId: string, c: MailChoice) {
  const m = state.mails.find((x) => x.id === mailId);
  const a = m ? advById(m.from) : undefined;
  const before = a ? { ...a } : undefined;
  const r = replyMail(state, mailId, c.id);
  if (!r.ok || !m) return toast(r.ok ? 'そのメールはありません' : r.reason, true);
  commit();
  const got = m.answered ?? c.id;
  const done = c.id === 'hold' && got === 'refuse'
    ? 'これ以上は保留できず、昇給を断った扱いになった'
    : REPLY_DONE[`${m.kind}:${got}`] ?? `「${c.label}」と返信した`;
  const fx = before ? effects(before, advById(m.from)) : [];
  toast(fx.length ? `${done}(${fx.join('、')})` : done);
}
