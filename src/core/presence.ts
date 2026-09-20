export interface PresenceProjection { readonly subject: number; readonly spouse?: number; readonly mother?: number; readonly father?: number; readonly parents?: number }
export type PresenceProjectionTable = Readonly<Record<string, PresenceProjection>>;
export interface DateWindow { readonly start: string; readonly end: string }
export interface LifespanWindow { readonly birthStart: string | null; readonly deathEnd: string | null }

const MS_PER_DAY = 86_400_000;
function epochDay(value: string): number { return Math.floor(Date.parse(`${value}T00:00:00Z`) / MS_PER_DAY); }
function isoDay(value: number): string { return new Date(value * MS_PER_DAY).toISOString().slice(0, 10); }
export function addDays(value: string, days: number): string { return isoDay(epochDay(value) + days); }
export function inclusiveDays(start: string, end: string): number { return epochDay(end) - epochDay(start) + 1; }
export function projectionFor(eventType: string, table: PresenceProjectionTable): PresenceProjection | null { return table[eventType.toUpperCase()] ?? null; }
export function projectWindow(dateStart: string, dateEnd: string, eventType: string, pointDays: number, transitDays: number): DateWindow {
  const type = eventType.toUpperCase();
  if (type === "RESI" || type === "CENS") return { start: dateStart, end: dateEnd };
  const days = type === "IMMI" || type === "EMIG" ? transitDays : pointDays;
  return { start: addDays(dateStart, -days), end: addDays(dateEnd, days) };
}
export function clampToLifespan(interval: DateWindow, lifespan: LifespanWindow): DateWindow | null {
  const start = lifespan.birthStart !== null && lifespan.birthStart > interval.start ? lifespan.birthStart : interval.start;
  const end = lifespan.deathEnd !== null && lifespan.deathEnd < interval.end ? lifespan.deathEnd : interval.end;
  return start <= end ? { start, end } : null;
}
