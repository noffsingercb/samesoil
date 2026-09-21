import { inclusiveDays } from "./presence.js";

export interface TemporalInterval { readonly start: string; readonly end: string }
export interface TemporalOverlap { readonly start: string; readonly end: string; readonly days: number }
export type TemporalRelation = "overlap" | "near";
export interface TemporalMatch { readonly relation: TemporalRelation; readonly start: string; readonly end: string; readonly overlapDays: number; readonly gapDays: number }
const EARTH_RADIUS_KM = 6371.0088;
export function overlap(a: TemporalInterval, b: TemporalInterval): TemporalOverlap | null { const start = a.start > b.start ? a.start : b.start, end = a.end < b.end ? a.end : b.end; return start <= end ? { start, end, days: inclusiveDays(start, end) } : null; }
export function temporalMatch(a: TemporalInterval, b: TemporalInterval, maxGapDays: number): TemporalMatch | null { const shared = overlap(a, b); if (shared !== null) return { relation: "overlap", start: shared.start, end: shared.end, overlapDays: shared.days, gapDays: 0 }; const earlier = a.end < b.start ? a : b, later = earlier === a ? b : a, gapDays = Math.max(1, inclusiveDays(earlier.end, later.start) - 1); return gapDays <= maxGapDays ? { relation: "near", start: earlier.end, end: later.start, overlapDays: 0, gapDays } : null; }
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number { const radians = Math.PI / 180, dLat = (bLat - aLat) * radians, dLon = (bLon - aLon) * radians, lat1 = aLat * radians, lat2 = bLat * radians, h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2; return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); }
export function decades(start: string, end: string): ReadonlyArray<number> { const first = Math.floor(Number(start.slice(0, 4)) / 10), last = Math.floor(Number(end.slice(0, 4)) / 10), values: number[] = []; for (let value = first; value <= last; value += 1) values.push(value); return values; }
export function canonicalPair(a: number, b: number): readonly [number, number] { return a < b ? [a, b] : [b, a]; }
