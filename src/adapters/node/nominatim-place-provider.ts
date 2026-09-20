import type { PlaceProviderAdapter, PlaceResolution, PrecisionTier } from "../../core/adapters.js";
interface NominatimAddress { readonly state?: string; readonly province?: string; readonly county?: string; readonly state_district?: string; readonly country?: string }
interface NominatimResult { readonly lat?: string; readonly lon?: string; readonly display_name?: string; readonly importance?: number; readonly addresstype?: string; readonly type?: string; readonly address?: NominatimAddress }
export interface NominatimRequest { readonly url: string; readonly init: RequestInit }
export function buildNominatimRequest(endpoint: string, userAgent: string, rawString: string): NominatimRequest {
  const url = new URL(endpoint);
  url.searchParams.set("q", rawString);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  return { url: url.toString(), init: { headers: { Accept: "application/json", "User-Agent": userAgent } } };
}
function tierFor(result: NominatimResult): PrecisionTier {
  const type = (result.addresstype ?? result.type ?? "").toLowerCase();
  if (["house", "building", "residential", "road", "street"].includes(type)) return "address";
  if (["city", "town", "village", "hamlet", "municipality", "borough", "suburb"].includes(type)) return "locality";
  if (["county", "district", "parish", "state_district"].includes(type)) return "district";
  if (["state", "province", "region"].includes(type)) return "region";
  if (type === "country") return "country";
  return "unknown";
}
function coordinate(value: string | undefined): number | null { if (value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function confidence(value: number | undefined): number { if (value === undefined || !Number.isFinite(value)) return 0; return Math.max(0, Math.min(1, value)); }
export class NominatimPlaceProvider implements PlaceProviderAdapter {
  readonly #endpoint: string;
  readonly #userAgent: string;
  public constructor(endpoint = "https://nominatim.openstreetmap.org/search", userAgent = "samesoil/0.1") { this.#endpoint = endpoint; this.#userAgent = userAgent; }
  public async resolvePlace(rawString: string): Promise<PlaceResolution> {
    const request = buildNominatimRequest(this.#endpoint, this.#userAgent, rawString);
    const response = await fetch(request.url, request.init);
    if (!response.ok) throw new Error(`Nominatim request failed: HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const first = Array.isArray(payload) ? payload[0] as NominatimResult | undefined : undefined;
    if (first === undefined) return { normalized: rawString, lat: null, lon: null, precisionTier: "unknown", admin1: null, admin2: null, country: null, confidence: 0, source: "nominatim" };
    const address = first.address;
    return { normalized: first.display_name ?? rawString, lat: coordinate(first.lat), lon: coordinate(first.lon), precisionTier: tierFor(first), admin1: address?.state ?? address?.province ?? null, admin2: address?.county ?? address?.state_district ?? null, country: address?.country ?? null, confidence: confidence(first.importance), source: "nominatim" };
  }
}
