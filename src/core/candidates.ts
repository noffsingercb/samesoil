import { inclusiveDays } from "./presence.js";

export interface TemporalInterval { readonly start: string; readonly end: string }
export interface TemporalOverlap { readonly start: string; readonly end: string; readonly days: number }
const EARTH_RADIUS_KM = 6371.0088;
export function overlap(a: TemporalInterval, b: TemporalInterval): TemporalOverlap | null {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end, days: inclusiveDays(start, end) } : null;
}
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const radians = Math.PI / 180;
  const dLat = (bLat - aLat) * radians;
  const dLon = (bLon - aLon) * radians;
  const lat1 = aLat * radians;
  const lat2 = bLat * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function decades(start: string, end: string): ReadonlyArray<number> {
  const first = Math.floor(Number(start.slice(0, 4)) / 10);
  const last = Math.floor(Number(end.slice(0, 4)) / 10);
  const values: number[] = [];
  for (let value = first; value <= last; value += 1) values.push(value);
  return values;
}
export function canonicalPair(a: number, b: number): readonly [number, number] { return a < b ? [a, b] : [b, a]; }
