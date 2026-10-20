import type { JourneyMember } from '../core/types';

export type MapFaceMember = Pick<JourneyMember, 'name' | 'appearance' | 'unique' | 'personality' | 'gender'>;
export interface MapFaceAsset { file: string; x: number; y: number; size: number; atlasSize: number }
const sprite = (file: string, x: number, y: number, size: number): MapFaceAsset =>
  ({ file: `map-faces/${file}.png`, x, y, size, atlasSize: 1254 });

/** 専用に描いた頭の輪郭全体を含む領域。会話用ポートレートは切り抜かない。 */
export const MAP_FACES: Record<string, MapFaceAsset> = {
  tina: sprite('tina-v1', 0, 0, 1254),
  sera: sprite('unique-heads-v2', 118, 113, 393),
  viola: sprite('unique-heads-v2', 764, 120, 388),
  ruu: sprite('unique-heads-v2', 116, 740, 406),
  fine: sprite('unique-heads-v2', 743, 741, 412),
  aurelia: sprite('aurelia-v1', 0, 0, 1254),
  adv_brave_female: sprite('adventurer-heads-a-v1', 37, 106, 554),
  adv_brave_male: sprite('adventurer-heads-a-v1', 687, 75, 542),
  adv_cautious_female: sprite('adventurer-heads-a-v1', 55, 684, 546),
  adv_cautious_male: sprite('adventurer-heads-a-v1', 671, 653, 560),
  adv_greedy_female: sprite('adventurer-heads-b-v1', 45, 60, 582),
  adv_greedy_male: sprite('adventurer-heads-b-v1', 668, 70, 538),
  adv_caring_female: sprite('adventurer-heads-b-v1', 43, 646, 564),
  adv_caring_male: sprite('adventurer-heads-b-v1', 673, 663, 536),
  adv_timid_female: sprite('adventurer-heads-c-v1', 39, 73, 546),
  adv_timid_male: sprite('adventurer-heads-c-v1', 724, 56, 488),
  adv_proud_female: sprite('adventurer-heads-c-v1', 39, 654, 570),
  adv_proud_male: sprite('adventurer-heads-c-v1', 700, 669, 552),
};

export function mapFaceAsset(member: MapFaceMember): MapFaceAsset | undefined {
  return MAP_FACES[member.appearance] ?? MAP_FACES[member.unique ?? '']
    ?? MAP_FACES[`adv_${member.personality}_${member.gender}`];
}
