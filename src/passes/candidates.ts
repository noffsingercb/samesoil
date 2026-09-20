import type { EngineContext } from "../core/context.js";
import { decades, haversineKm, overlap } from "../core/candidates.js";
import { createKinshipService } from "./kinship.js";
interface PresenceRow extends Readonly<Record<string, unknown>> { readonly id: number; readonly individual_id: number; readonly date_start: string; readonly date_end: string; readonly radius_km: number; readonly lat: number; readonly lon: number }
interface Draft { readonly aIntervalId: number; readonly bIntervalId: number; readonly aId: number; readonly bId: number; readonly overlapStart: string; readonly overlapEnd: string; readonly overlapDays: number; readonly distanceKm: number; readonly combinedRadius: number }
const KM_PER_DEGREE = 111.32;
function elapsed(start: string, end: string): number { return Math.max(0, Date.parse(end) - Date.parse(start)); }
function bucketKey(decade: number, x: number, y: number): string { return `${decade}:${x}:${y}`; }
export async function run(ctx: EngineContext): Promise<void> {
  const pass = "candidates", started = ctx.env.now(); ctx.progress.passStarted(pass);
  const rows = ctx.storage.all<PresenceRow>(`SELECT pi.id,pi.individual_id,pi.date_start,pi.date_end,pi.radius_km,p.lat,p.lon FROM presence_intervals pi JOIN places p ON p.id=pi.place_id WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL AND pi.radius_km IS NOT NULL ORDER BY pi.id`);
  const configuredRadii = Object.values(ctx.config.place.radius_km_by_tier), maxConfiguredRadius = Math.max(...configuredRadii), cellKm = Math.max(maxConfiguredRadius * 2 * ctx.config.place.proximity_radius_multiplier, Number.EPSILON), degreeStep = cellKm / KM_PER_DEGREE, buckets = new Map<string, PresenceRow[]>();
  for (const row of rows) { const x = Math.floor(row.lon / degreeStep), y = Math.floor(row.lat / degreeStep); for (const decade of decades(row.date_start, row.date_end)) { const key = bucketKey(decade, x, y), values = buckets.get(key) ?? []; values.push(row); buckets.set(key, values); } }
  const drafts: Draft[] = []; let comparisons = 0, temporalRejections = 0, distanceRejections = 0, kinshipQueries = 0, peakIntervalNeighbors = 0; const kinship = createKinshipService(ctx);
  ctx.storage.transaction((): void => { ctx.storage.run("DELETE FROM scored_candidates"); ctx.storage.run("DELETE FROM suppression_log"); ctx.storage.run("DELETE FROM candidate_pairs"); });
  for (const [index, row] of rows.entries()) {
    const x = Math.floor(row.lon / degreeStep), y = Math.floor(row.lat / degreeStep), longitudeNeighbors = Math.max(1, Math.ceil(1 / Math.max(Math.cos(row.lat * Math.PI / 180), 0.1))), seenOtherIntervals = new Set<number>();
    for (const decade of decades(row.date_start, row.date_end)) for (let decadeOffset = -1; decadeOffset <= 1; decadeOffset += 1) for (let dx = -longitudeNeighbors; dx <= longitudeNeighbors; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const other of buckets.get(bucketKey(decade + decadeOffset, x + dx, y + dy)) ?? []) {
      if (other.id <= row.id || seenOtherIntervals.has(other.id)) continue;
      seenOtherIntervals.add(other.id); comparisons += 1;
      const temporal = overlap({ start: row.date_start, end: row.date_end }, { start: other.date_start, end: other.date_end }); if (temporal === null) { temporalRejections += 1; continue; }
      const combinedRadius = row.radius_km + other.radius_km, distance = haversineKm(row.lat, row.lon, other.lat, other.lon); if (distance > combinedRadius * ctx.config.place.proximity_radius_multiplier) { distanceRejections += 1; continue; }
      kinship.resolve(row.individual_id, other.individual_id); kinshipQueries += 1;
      drafts.push({ aIntervalId: row.id, bIntervalId: other.id, aId: row.individual_id, bId: other.individual_id, overlapStart: temporal.start, overlapEnd: temporal.end, overlapDays: temporal.days, distanceKm: distance, combinedRadius });
    }
    peakIntervalNeighbors = Math.max(peakIntervalNeighbors, seenOtherIntervals.size); ctx.progress.progress(pass, index + 1, rows.length);
  }
  ctx.storage.transaction((): void => { for (const row of drafts) ctx.storage.run("INSERT INTO candidate_pairs(a_interval_id,b_interval_id,a_id,b_id,overlap_start,overlap_end,overlap_days,distance_km,combined_radius) VALUES(?,?,?,?,?,?,?,?,?)", [row.aIntervalId, row.bIntervalId, row.aId, row.bId, row.overlapStart, row.overlapEnd, row.overlapDays, row.distanceKm, row.combinedRadius]); });
  ctx.progress.passFinished(pass, { rows_in: rows.length, rows_out: drafts.length, blocked_comparisons: comparisons, rejected_temporal: temporalRejections, rejected_distance: distanceRejections, kinship_queries: kinshipQueries, peak_interval_neighbors: peakIntervalNeighbors, elapsed_ms: elapsed(started, ctx.env.now()) });
}
