// 竜の回想は戦闘を再計算せず、最初の勝利遠征の観測と出発時の隊を使う。
import { equipResist } from './adventurer';
import { isJourneyRecord } from './journey';
import { castMember, type PresentedLine, type StageActor } from './presentation';
import type { Adventurer, DragonVictory, Expedition, GameState, JourneyFrame, StoryPartyMember } from './types';

export function storyPartyFor(members: Adventurer[]): StoryPartyMember[] {
  return members.map(a => ({
    id: a.id, name: a.name, unique: a.unique, appearance: a.appearance,
    personality: a.personality, fireResist: equipResist(a).fire ?? 0,
  }));
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function isStoryParty(value: unknown): value is StoryPartyMember[] {
  return Array.isArray(value) && value.length <= 4 && new Set(value.map(m => m?.id)).size === value.length
    && value.every(m => object(m) && ['id', 'name', 'appearance', 'personality'].every(k => typeof m[k] === 'string')
      && (m.unique === undefined || typeof m.unique === 'string')
      && (m.fireResist === null || (typeof m.fireResist === 'number' && Number.isFinite(m.fireResist) && m.fireResist >= 0)));
}

export function isDragonVictory(value: unknown): value is DragonVictory {
  if (!object(value) || value.version !== 1 || !isStoryParty(value.members)
    || typeof value.expeditionId !== 'string' || typeof value.leaderId !== 'string'
    || !Number.isSafeInteger(value.returnDay) || Number(value.returnDay) < 1
    || !(value.blessed === null || typeof value.blessed === 'boolean') || typeof value.wiped !== 'boolean'
    || !Array.isArray(value.injuredIds) || !value.injuredIds.every(id => typeof id === 'string')
    || !Array.isArray(value.combat) || !value.combat.every(f => f?.kind === 'combat_action')) return false;
  return isJourneyRecord({
    version: 1, dungeon: 'dragon_lair', floor: 'f2', startDay: 1, outDays: 0,
    leaderId: value.leaderId, members: [], initialVisited: [], initialHiddenFound: [], frames: value.combat,
  });
}

/** 竜を含む戦闘の観測だけ。文章から敵や勝敗を推測しない。 */
function dragonCombat(e: Expedition): JourneyFrame[] {
  const frames = e.journey?.frames ?? [];
  const dragon = (id?: string) => id?.startsWith('e_dragon_') === true;
  let last = -1;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].combatKind === 'down' && dragon(frames[i].actorId)) { last = i; break; }
  }
  if (last < 0) return [];
  const end = frames[last];
  return structuredClone(frames.slice(0, last + 1).filter(f => f.kind === 'combat_action'
    && f.cell === end.cell && f.day === end.day
    && (f.battleEnemy === 'dragon' || (f.battleEnemy === undefined && (dragon(f.actorId) || dragon(f.targetId))))));
}

export function captureDragonVictory(s: GameState, e: Expedition): DragonVictory {
  // 古い遠征には出発時装備が無い。今の装備で過去を補完しない。
  const members = e.storyParty ?? e.order.partyIds.flatMap(id => {
    const a = e.journey?.members.find(m => m.id === id) ?? s.adventurers.find(m => m.id === id);
    const name = e.result.returnDialogue?.find(m => m.advId === id)?.name ?? a?.name;
    return a && name ? [{ id, name, unique: a.unique, appearance: a.appearance, personality: a.personality, fireResist: null }] : [];
  });
  return {
    version: 1, expeditionId: e.id, returnDay: e.returnDay, leaderId: e.order.leaderId,
    members: structuredClone(members), blessed: e.order.blessed ?? null,
    injuredIds: Object.entries(e.result.injuries).filter(([, days]) => days > 0).map(([id]) => id),
    wiped: e.result.wiped, combat: dragonCombat(e),
  };
}

const BG = 'bg_dungeon_dragon';
const actor = (m: StoryPartyMember, pose = 'neutral', motion?: StageActor['motion']): StageActor[] => {
  const character = m.unique ?? m.appearance;
  const def = castMember(character);
  return def ? [{ character, pose: def.poses.includes(pose) ? pose : 'neutral', position: 'center', ...(motion ? { motion } : {}) }] : [];
};
const speech = (m: StoryPartyMember, text: string, pose = 'neutral'): PresentedLine => ({ speaker: m.name, text, background: BG, cast: actor(m, pose) });
const START: Record<string, string> = {
  tina: 'あたしの剣で、道を開くわ！', sera: '神よ、みんなを守り給え……！',
  viola: 'ふっ……私の盾を頼りにしなさい！', ruu: '隙はボクが探す。無理はしないでよね！',
  fine: 'お薬は任せてねぇ。みんな、無理しちゃだめよぉ。',
};
const PERSONALITY_START: Record<string, string> = {
  brave: '力を示して、みんなで戻ろう！', cautious: '落ち着いて、一つずつ対処しよう。',
  proud: 'ここまで来た力を見せよう。', timid: 'こ、怖いけれど……帰るために、やってみます。',
  caring: 'みんな、離れないで。支え合っていこう。', greedy: '素材を分けてもらって、無事に帰ろう。',
};
const WON: Record<string, string> = {
  tina: 'やった……！ 試練を越えたわ！', sera: 'みんな、動かないで……セラが手当てします。',
  viola: 'ふっ……やり遂げたわね。少し、座ってもいいかしら。', ruu: 'ふぅ……帰り道も気を抜かないでよ。',
  fine: 'ひと息つきましょうねぇ。お薬も分けるわよぉ。',
};
const REQUEST: Record<string, string> = {
  tina: '火竜……！ 倒れたガルドを救うために、鱗か抜け殻を分けてほしいの！',
  sera: 'あ、あの……ガルドさんを救いたくて……鱗か抜け殻を、分けていただけませんか。',
  viola: '火竜よ。ガルドを救うために来たわ。鱗か抜け殻を分けてほしいの。',
  ruu: 'ねえ、少し話を聞いてよ。ガルドを助けたいんだ。鱗か抜け殻、分けてくれない？',
  fine: 'ガルドのおじさまのお薬を作りたいの。鱗か抜け殻を、分けてもらえないかしらぁ。',
};
const HURT: Record<string, string> = {
  tina: '……ごめん、手当てを頼むわ。ここで無理するわけにはいかないもの。',
  sera: 'せ、セラも……少し休ませてください。みんなで戻りましょう。',
  viola: 'ふっ……さすがに、手当てが必要だわ。ここで意地を張るのはやめておくわね。',
  ruu: '……ちょっと肩、貸してよ。今は強がってる場合じゃないし。',
  fine: 'お姉さんも、少し手当てがいるみたい。ゆっくり帰りましょうねぇ。',
};

function combatLine(f: JourneyFrame, members: StoryPartyMember[]): PresentedLine | null {
  const a = members.find(m => m.id === f.actorId);
  const target = members.find(m => m.id === f.targetId);
  const isDragon = f.actorId?.startsWith('e_dragon_');
  const base: PresentedLine = { text: '', background: BG, cast: a ? actor(a) : [{ character: 'aurelia', pose: 'dragon', position: 'center' }] };
  switch (f.combatKind) {
    case 'attack': return { ...base, text: isDragon ? `火竜が${f.targetName}へ攻撃を放つ！` : `${f.actorName}の攻撃が${f.targetName}を捉える！`, sfx: isDragon ? 'flame' : 'slash' };
    case 'heal': return { ...base, text: `${f.actorName}の祈りが${f.targetName}を癒す。`, sfx: 'chime' };
    case 'item': return { ...base, text: `${f.actorName}が${f.targetName}に回復薬を使う。`, sfx: 'water' };
    case 'down': return { ...base, text: isDragon ? '火竜が膝をつき、試練の決着を認める。' : `${f.actorName}が倒れた。仲間がその体を支える。`, cast: a ? actor(a, 'surprised') : base.cast, effect: 'impact' };
    case 'flee': return { ...base, text: `${f.actorName}が退路を確保する。`, cast: target ? actor(target) : base.cast };
    default: return null;
  }
}

/** 行はその都度純粋に生成するので、読み返しでも当時の隊のまま。 */
export function dragonBattleLines(record: DragonVictory | null): PresentedLine[] {
  if (!record || record.members.length === 0) return [{ text: '竜の試練を越えた隊の報せが、ギルドに届いた。', background: 'bg_guild_office', transition: 'fade' }];
  const representative = record.members.find(m => m.id === record.leaderId) ?? record.members[0];
  const lines: PresentedLine[] = [
    { ...speech(representative, REQUEST[representative.unique ?? ''] ?? '倒れた先代を救うために来ました。鱗か抜け殻を分けてもらえませんか。'), transition: 'fade' },
    { speaker: 'アウレリア', text: '我の素材を欲するならば、力を示せ。我が炎に耐え、我に勝ってみせよ！', background: BG, cast: [{ character: 'aurelia', pose: 'dragon', position: 'center' }], sfx: 'roar' },
    ...record.members.map(m => speech(m, START[m.unique ?? ''] ?? PERSONALITY_START[m.personality] ?? '力を合わせて、試練を越えよう。')),
  ];
  if (record.blessed) lines.push({ text: '出発の朝に受けたアイリスの祝福が、隊の疲れを和らげている。', background: BG, sfx: 'chime' });
  const protectedMembers = record.members.filter(m => m.fireResist !== null && m.fireResist > 0);
  if (protectedMembers.length) lines.push({ text: `${protectedMembers.map(m => m.name).join('・')}の耐火装備が、炎の熱を和らげる。`, background: BG });
  lines.push(...record.combat.flatMap(f => { const line = combatLine(f, record.members); return line ? [line] : []; }));
  if (!record.combat.length) lines.push({ text: '隊は力を示し、古竜に勝利を認められた。', background: BG });
  lines.push(...record.members.map(m => speech(m, record.injuredIds.includes(m.id) ? HURT[m.unique ?? ''] ?? '……手当てをお願いします。無理せず、戻りましょう。' : WON[m.unique ?? ''] ?? '試練を越えた……。あとは、みんなで帰ろう。', record.injuredIds.includes(m.id) ? 'neutral' : 'happy')));
  lines.push({
    text: record.wiped ? '帰路で隊は力尽き、救助されてギルドへ戻った。まずは治療と休養が必要だ。'
      : record.injuredIds.length ? '傷ついた仲間を支えながら隊は帰還した。ギルドでは手当ての準備が待っていた。'
      : '隊はギルドへ戻り、古竜との約束を報告した。',
    background: 'bg_guild_office', transition: 'fade',
  });
  return lines;
}
