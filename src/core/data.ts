import jobsJson from '../data/jobs.json';
import personalitiesJson from '../data/personalities.json';
import type { JobDef, PersonalityDef } from './types';

const byId = <T extends { id: string }>(arr: T[]): Record<string, T> => Object.fromEntries(arr.map((x) => [x.id, x]));

export const JOBS = jobsJson as unknown as JobDef[];
export const PERSONALITIES = personalitiesJson as unknown as PersonalityDef[];

export const JOB = byId(JOBS);
export const PERSONALITY = byId(PERSONALITIES);

export const LOWER_JOBS = JOBS.filter((j) => j.tier === 'lower');
export const UPPER_JOBS = JOBS.filter((j) => j.tier === 'upper');

/** その下級職から転職できる上級職 */
export function upperJobsFrom(lowerId: string): JobDef[] {
  return UPPER_JOBS.filter((j) => j.from?.includes(lowerId));
}
