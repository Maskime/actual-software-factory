import { createHash } from 'node:crypto';

export interface EvalResult {
  iid: number;
  durationMs: number;
  outputLength: number;
  structureValid: boolean;
  mentionsFiles: boolean;
  criteriaHit: number;
  criteriaTotal: number;
  promptVersion: string;
}

export function promptHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

export function scoreStructure(text: string): boolean {
  return /^\d+\./m.test(text) || /^[-*] /m.test(text);
}

export function scoreMentionsFiles(text: string): boolean {
  return /\.[jt]sx?|\.md|\.json|\.yml|\.yaml/.test(text);
}

export function scoreCriteriaHit(output: string, criteria: string[]): number {
  const lower = output.toLowerCase();
  return criteria.filter((c) => {
    const words = c.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    return words.some((w) => lower.includes(w));
  }).length;
}
