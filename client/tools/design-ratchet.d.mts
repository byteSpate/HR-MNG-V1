export const RULES: Record<string, RegExp>
export function isExempt(rel: string): boolean
export function countFiles(files: Record<string, string>): Record<string, number>
export function compare(
  baseline: Record<string, number>,
  current: Record<string, number>,
): { ok: boolean; worse: string[]; better: string[] }
