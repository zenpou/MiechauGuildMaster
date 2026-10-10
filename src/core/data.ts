import jobsJson from '../data/jobs.json';
import personalitiesJson from '../data/personalities.json';
import traitsJson from '../data/traits.json';
import policiesJson from '../data/policies.json';
import enemiesJson from '../data/enemies.json';
import itemsJson from '../data/items.json';
import dungeonsJson from '../data/dungeons.json';
import skillsJson from '../data/skills.json';
import namesJson from '../data/names.json';
import personaJson from '../data/persona.json';
import type { DungeonDef, EnemyDef, ItemDef, JobDef, PersonalityDef, PolicyDef, RoleSkillDef, TraitDef } from './types';

const byId = <T extends { id: string }>(arr: T[]): Record<string, T> => Object.fromEntries(arr.map((x) => [x.id, x]));

export const JOBS = jobsJson as unknown as JobDef[];
export const PERSONALITIES = personalitiesJson as unknown as PersonalityDef[];
export const TRAITS = traitsJson as unknown as TraitDef[];
export const POLICIES = policiesJson as unknown as PolicyDef[];
export const ENEMIES = enemiesJson as unknown as EnemyDef[];
export const ITEMS = itemsJson as unknown as ItemDef[];
export const DUNGEONS = dungeonsJson as unknown as DungeonDef[];
export const ROLE_SKILLS = skillsJson as unknown as RoleSkillDef[];
export const NAMES = namesJson as { given: string[] };
export const PERSONA = personaJson as { hobby: string[]; talent: string[]; likes: string[]; dislikes: string[] };

export const JOB = byId(JOBS);
export const PERSONALITY = byId(PERSONALITIES);
export const TRAIT = byId(TRAITS);
export const POLICY = byId(POLICIES);
export const ENEMY = byId(ENEMIES);
export const ITEM = byId(ITEMS);
export const DUNGEON = byId(DUNGEONS);
export const ROLE_SKILL = byId(ROLE_SKILLS);

export const LOWER_JOBS = JOBS.filter((j) => j.tier === 'lower');
export const UPPER_JOBS = JOBS.filter((j) => j.tier === 'upper');

/** その下級職から転職できる上級職 */
export function upperJobsFrom(lowerId: string): JobDef[] {
  return UPPER_JOBS.filter((j) => j.from?.includes(lowerId));
}
