export interface RankedCandidate { readonly candidateId: number; readonly aId: number; readonly bId: number; readonly localityKey: string; readonly score: number }
export interface DuplicateCandidate<T> { readonly row: T; readonly keptCandidateId: number }
export interface CandidateSelection<T> { readonly kept: ReadonlyArray<T>; readonly duplicates: ReadonlyArray<DuplicateCandidate<T>>; readonly localityLimited: ReadonlyArray<T>; readonly belowLimit: ReadonlyArray<T> }
function pairKey(aId: number, bId: number): string { return aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`; }
export function selectCandidates<T extends RankedCandidate>(input: ReadonlyArray<T>, maxCandidates: number, maxPerLocality: number): CandidateSelection<T> {
  const sorted = [...input].sort((a, b) => b.score - a.score || a.candidateId - b.candidateId), unique: T[] = [], duplicates: Array<DuplicateCandidate<T>> = [], bestByPair = new Map<string, number>();
  for (const row of sorted) { const key = pairKey(row.aId, row.bId), keptCandidateId = bestByPair.get(key); if (keptCandidateId !== undefined) duplicates.push({ row, keptCandidateId }); else { bestByPair.set(key, row.candidateId); unique.push(row); } }
  const kept: T[] = [], localityLimited: T[] = [], belowLimit: T[] = [], localityCounts = new Map<string, number>();
  for (const row of unique) { const count = localityCounts.get(row.localityKey) ?? 0; if (count >= maxPerLocality) localityLimited.push(row); else if (kept.length >= maxCandidates) belowLimit.push(row); else { kept.push(row); localityCounts.set(row.localityKey, count + 1); } }
  return { kept, duplicates, localityLimited, belowLimit };
}
