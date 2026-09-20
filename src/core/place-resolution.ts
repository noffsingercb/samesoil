import type {
  EnvAdapter,
  FileSourceAdapter,
  PlaceProviderAdapter,
  PlaceResolution,
  PrecisionTier,
  StorageAdapter
} from "./adapters.js";

export interface PlaceNormalizationData {
  readonly componentAliases: Readonly<Record<string, string>>;
  readonly suffixAliases: Readonly<Record<string, string>>;
}
export interface NormalizedPlaceQuery {
  readonly original: string;
  readonly normalized: string;
  readonly qualifierStripped: string | null;
}
interface CacheRow extends Readonly<Record<string, unknown>> { readonly response_json: string }
const TIERS: ReadonlyArray<PrecisionTier> = ["address", "locality", "district", "region", "country", "unknown"];
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringMap(value: unknown, path: string): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new Error(`${path}: expected object`);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || item.length === 0) throw new Error(`${path}.${key}: expected non-empty string`);
    output[key] = item;
  }
  return output;
}
export async function loadPlaceNormalizationData(files: FileSourceAdapter, path: string): Promise<PlaceNormalizationData> {
  let parsed: unknown;
  try { parsed = JSON.parse(await files.readText(path)); }
  catch (error) { throw new Error(`Unable to load place normalization data at ${path}: ${String(error)}`); }
  if (!isRecord(parsed)) throw new Error("place normalization data: expected object");
  return { componentAliases: stringMap(parsed.componentAliases, "componentAliases"), suffixAliases: stringMap(parsed.suffixAliases, "suffixAliases") };
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function aliasFor(value: string, aliases: Readonly<Record<string, string>>): string | undefined {
  const wanted = value.toUpperCase();
  for (const [key, replacement] of Object.entries(aliases)) if (key.toUpperCase() === wanted) return replacement;
  return undefined;
}
function expandComponent(component: string, data: PlaceNormalizationData): string {
  const whole = aliasFor(component, data.componentAliases);
  if (whole !== undefined) return whole;
  const suffixes = Object.entries(data.suffixAliases).sort((a, b) => b[0].length - a[0].length);
  for (const [suffix, replacement] of suffixes) {
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(suffix)}$`, "i");
    if (pattern.test(component)) return component.replace(pattern, (match) => `${match.startsWith(" ") ? " " : ""}${replacement}`);
  }
  return component;
}
export function normalizePlaceQuery(rawString: string, data: PlaceNormalizationData): NormalizedPlaceQuery {
  const components = rawString.split(",").map((component) => component.trim().replace(/\s+/g, " "));
  let qualifierStripped: string | null = null;
  const first = components[0] ?? "";
  const qualifier = /^(of|near|probably|prob\.)\s+/i.exec(first);
  if (qualifier !== null) { qualifierStripped = qualifier[1] ?? null; components[0] = first.slice(qualifier[0].length).trim(); }
  return { original: rawString, normalized: components.filter((component) => component.length > 0).map((component) => expandComponent(component, data)).join(", "), qualifierStripped };
}
export function cacheKeyText(normalized: string): string { return normalized.toLowerCase(); }
function finiteNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nullableString(value: unknown): string | null { return typeof value === "string" ? value : null; }
export function parseCachedResolution(json: string): PlaceResolution | null {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!isRecord(parsed)) return null;
  if (typeof parsed.normalized !== "string" || typeof parsed.source !== "string") return null;
  if (typeof parsed.precisionTier !== "string" || !TIERS.includes(parsed.precisionTier as PrecisionTier)) return null;
  const confidence = finiteNumber(parsed.confidence);
  if (confidence === null) return null;
  return { normalized: parsed.normalized, lat: finiteNumber(parsed.lat), lon: finiteNumber(parsed.lon), precisionTier: parsed.precisionTier as PrecisionTier, admin1: nullableString(parsed.admin1), admin2: nullableString(parsed.admin2), country: nullableString(parsed.country), confidence, source: parsed.source };
}
export function serializeResolution(value: PlaceResolution): string {
  return JSON.stringify({ normalized: value.normalized, lat: value.lat, lon: value.lon, precisionTier: value.precisionTier, admin1: value.admin1, admin2: value.admin2, country: value.country, confidence: value.confidence, source: value.source });
}
export class CacheOnlyPlaceProvider implements PlaceProviderAdapter {
  readonly #storage: StorageAdapter;
  readonly #env: EnvAdapter;
  public constructor(storage: StorageAdapter, env: EnvAdapter) { this.#storage = storage; this.#env = env; }
  public async resolvePlace(rawString: string): Promise<PlaceResolution> {
    const hash = await this.#env.sha256(cacheKeyText(rawString));
    const row = this.#storage.get<CacheRow>("SELECT response_json FROM geocode_cache WHERE query_hash = ?", [hash]);
    const cached = row === undefined ? null : parseCachedResolution(row.response_json);
    return cached ?? { normalized: rawString, lat: null, lon: null, precisionTier: "unknown", admin1: null, admin2: null, country: null, confidence: 0, source: "cache-only" };
  }
}
export function radiusForTier(tier: PrecisionTier, radii: Readonly<Record<Exclude<PrecisionTier, "unknown">, number>>): number | null { return tier === "unknown" ? null : radii[tier]; }
export function tierIsCoarser(tier: PrecisionTier, minimum: Exclude<PrecisionTier, "unknown">): boolean { return TIERS.indexOf(tier) > TIERS.indexOf(minimum); }
export function applyQualifierPenalty(confidence: number, minGeocodeConfidence: number): number {
  const boundedConfidence = Math.max(0, Math.min(1, confidence));
  const boundedMinimum = Math.max(0, Math.min(1, minGeocodeConfidence));
  return boundedConfidence * (1 - boundedMinimum);
}
