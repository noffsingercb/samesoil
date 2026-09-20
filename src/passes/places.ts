import type { PlaceResolution, PrecisionTier } from "../core/adapters.js";
import type { EngineContext } from "../core/context.js";
import { applyQualifierPenalty, cacheKeyText, loadPlaceNormalizationData, normalizePlaceQuery, parseCachedResolution, radiusForTier, serializeResolution, tierIsCoarser } from "../core/place-resolution.js";
const NORMALIZATION_DATA_PATH = "src/data/us-place-abbreviations.json";
interface PlaceInputRow extends Readonly<Record<string, unknown>> { readonly place_raw: string; readonly occurrence_count: number; readonly affected_individuals: number }
interface ExistingPlaceRow extends Readonly<Record<string, unknown>> { readonly place_raw: string; readonly review_status: string }
interface CacheRow extends Readonly<Record<string, unknown>> { readonly response_json: string }
interface ReviewRow { readonly placeRaw: string; readonly occurrenceCount: number; readonly affectedIndividuals: number; readonly reason: string }
function unresolved(normalized: string, source: string): PlaceResolution { return { normalized, lat: null, lon: null, precisionTier: "unknown", admin1: null, admin2: null, country: null, confidence: 0, source }; }
function csvCell(value: string | number): string { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function renderReviewQueue(rows: ReadonlyArray<ReviewRow>): string {
  const lines = ["place_raw,occurrence_count,affected_individuals,reason"];
  for (const row of rows) lines.push([row.placeRaw, row.occurrenceCount, row.affectedIndividuals, row.reason].map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}
function reviewReason(resolution: PlaceResolution, minimumConfidence: number, minimumTier: Exclude<PrecisionTier, "unknown">): string | null {
  if (resolution.lat === null || resolution.lon === null || resolution.precisionTier === "unknown") return "unresolved";
  if (resolution.confidence < minimumConfidence) return "low_conf";
  if (tierIsCoarser(resolution.precisionTier, minimumTier)) return "coarse_place";
  return null;
}
function compareReviewRows(a: ReviewRow, b: ReviewRow): number {
  if (a.occurrenceCount !== b.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
  if (a.affectedIndividuals !== b.affectedIndividuals) return b.affectedIndividuals - a.affectedIndividuals;
  return a.placeRaw < b.placeRaw ? -1 : a.placeRaw > b.placeRaw ? 1 : 0;
}
export async function run(ctx: EngineContext): Promise<void> {
  ctx.progress.passStarted("places");
  const data = await loadPlaceNormalizationData(ctx.fileSource, NORMALIZATION_DATA_PATH);
  const inputs = ctx.storage.all<PlaceInputRow>(`
    WITH event_stats AS (
      SELECT place_raw, COUNT(*) AS occurrence_count FROM events WHERE place_raw IS NOT NULL GROUP BY place_raw
    ), affected AS (
      SELECT e.place_raw, e.subject_id AS individual_id FROM events e WHERE e.place_raw IS NOT NULL AND e.subject_type = 'individual'
      UNION ALL
      SELECT e.place_raw, f.husband_id FROM events e JOIN families f ON e.subject_type = 'family' AND e.subject_id = f.id WHERE e.place_raw IS NOT NULL AND f.husband_id IS NOT NULL
      UNION ALL
      SELECT e.place_raw, f.wife_id FROM events e JOIN families f ON e.subject_type = 'family' AND e.subject_id = f.id WHERE e.place_raw IS NOT NULL AND f.wife_id IS NOT NULL
    ), affected_stats AS (
      SELECT place_raw, COUNT(DISTINCT individual_id) AS affected_individuals FROM affected GROUP BY place_raw
    )
    SELECT e.place_raw, e.occurrence_count, COALESCE(a.affected_individuals, 0) AS affected_individuals
    FROM event_stats e LEFT JOIN affected_stats a ON a.place_raw = e.place_raw ORDER BY e.place_raw COLLATE BINARY
  `);
  const existing = new Map(ctx.storage.all<ExistingPlaceRow>("SELECT place_raw, review_status FROM places ORDER BY place_raw COLLATE BINARY").map((row) => [row.place_raw, row]));
  const reviewRows: ReviewRow[] = [];
  let cacheHits = 0, providerCalls = 0, resolved = 0, preservedHumanRows = 0;
  ctx.storage.transaction((): void => {
    ctx.storage.run("DELETE FROM scored_candidates");
    ctx.storage.run("DELETE FROM suppression_log");
    ctx.storage.run("DELETE FROM candidate_pairs");
    ctx.storage.run("DELETE FROM presence_intervals");
  });
  for (const [index, input] of inputs.entries()) {
    const prior = existing.get(input.place_raw);
    if (prior !== undefined && prior.review_status !== "auto") { preservedHumanRows += 1; ctx.progress.progress("places", index + 1, inputs.length); continue; }
    const query = normalizePlaceQuery(input.place_raw, data);
    let resolution = unresolved(query.normalized, "none");
    if (query.normalized.length > 0) {
      const hash = await ctx.env.sha256(cacheKeyText(query.normalized));
      const cache = ctx.storage.get<CacheRow>("SELECT response_json FROM geocode_cache WHERE query_hash = ?", [hash]);
      const cached = cache === undefined ? null : parseCachedResolution(cache.response_json);
      if (cached !== null) { resolution = cached; cacheHits += 1; }
      else if (ctx.placeProvider !== undefined) {
        providerCalls += 1;
        resolution = await ctx.placeProvider.resolvePlace(query.normalized);
        if (resolution.source !== "cache-only") ctx.storage.run(`INSERT INTO geocode_cache(query_hash, query_text, response_json, fetched_at) VALUES(?, ?, ?, ?) ON CONFLICT(query_hash) DO UPDATE SET query_text = excluded.query_text, response_json = excluded.response_json, fetched_at = excluded.fetched_at`, [hash, query.normalized, serializeResolution(resolution), ctx.env.now()]);
      }
    }
    if (query.qualifierStripped !== null) resolution = { ...resolution, confidence: applyQualifierPenalty(resolution.confidence, ctx.config.place.min_geocode_conf) };
    const radius = radiusForTier(resolution.precisionTier, ctx.config.place.radius_km_by_tier);
    ctx.storage.run(`INSERT INTO places(place_raw, place_normalized, lat, lon, radius_km, precision_tier, admin1, admin2, country, geocode_source, geocode_conf, review_status) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto') ON CONFLICT(place_raw) DO UPDATE SET place_normalized = excluded.place_normalized, lat = excluded.lat, lon = excluded.lon, radius_km = excluded.radius_km, precision_tier = excluded.precision_tier, admin1 = excluded.admin1, admin2 = excluded.admin2, country = excluded.country, geocode_source = excluded.geocode_source, geocode_conf = excluded.geocode_conf WHERE places.review_status = 'auto'`, [input.place_raw, resolution.normalized, resolution.lat, resolution.lon, radius, resolution.precisionTier, resolution.admin1, resolution.admin2, resolution.country, resolution.source, resolution.confidence]);
    const reason = reviewReason(resolution, ctx.config.place.min_geocode_conf, ctx.config.place.min_tier);
    if (reason !== null) reviewRows.push({ placeRaw: input.place_raw, occurrenceCount: input.occurrence_count, affectedIndividuals: input.affected_individuals, reason });
    else resolved += 1;
    ctx.progress.progress("places", index + 1, inputs.length);
  }
  reviewRows.sort(compareReviewRows);
  await ctx.artifactSink.write("review_queue.csv", renderReviewQueue(reviewRows));
  if (reviewRows.length > 0) ctx.progress.warn(`${reviewRows.length} places require review`);
  ctx.progress.passFinished("places", { placesIn: inputs.length, resolved, reviewQueue: reviewRows.length, cacheHits, providerCalls, preservedHumanRows, caveat: "Modern geocoding does not reconstruct historical boundaries." });
}
