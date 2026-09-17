export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlParameters = ReadonlyArray<SqlValue> | Readonly<Record<string, SqlValue>>;
export type SqlRow = Readonly<Record<string, unknown>>;
export interface RunResult {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
}
export interface StorageAdapter {
    run(sql: string, parameters?: SqlParameters): RunResult;
    get<T extends SqlRow>(sql: string, parameters?: SqlParameters): T | undefined;
    all<T extends SqlRow>(sql: string, parameters?: SqlParameters): ReadonlyArray<T>;
    transaction<T>(work: () => T): T;
    applySchema(sql: string): void;
    close(): void;
}
export type GedcomEncoding = "ANSEL" | "UTF-8" | "UTF-16" | "CP1252" | "unknown";
export interface GedcomSource {
    readonly bytes: Uint8Array;
    readonly encodingHint: GedcomEncoding;
}
export interface FileSourceAdapter {
    readGedcom(path: string): Promise<GedcomSource>;
    readText(path: string): Promise<string>;
}
export type PrecisionTier = "address" | "locality" | "district" | "region" | "country" | "unknown";
export interface PlaceResolution {
    readonly normalized: string;
    readonly lat: number | null;
    readonly lon: number | null;
    readonly precisionTier: PrecisionTier;
    readonly admin1: string | null;
    readonly admin2: string | null;
    readonly country: string | null;
    readonly confidence: number;
    readonly source: string;
}
export interface PlaceProviderAdapter {
    resolvePlace(rawString: string): Promise<PlaceResolution>;
}
export interface ContextRequest {
    readonly lat: number;
    readonly lon: number;
    readonly radiusKm: number;
    readonly dateStart: string;
    readonly dateEnd: string;
    readonly admin1: string | null;
    readonly admin2: string | null;
    readonly country: string | null;
    readonly maxEvents: number;
    readonly scopeTiers: ReadonlyArray<string>;
}
export interface ContextResult {
    readonly events: ReadonlyArray<Readonly<Record<string, unknown>>>;
    readonly version: string;
    readonly queryHash: string;
    readonly status: "ok" | "partial" | "unavailable";
}
export interface ContextProviderAdapter {
    fetchContext(request: ContextRequest): Promise<ContextResult>;
}
export interface ArtifactSinkAdapter {
    write(name: string, data: string | Uint8Array): Promise<void>;
}
export interface ProgressReporter {
    passStarted(passName: string): void;
    progress(passName: string, completed: number, total?: number): void;
    passFinished(passName: string, report: Readonly<Record<string, unknown>>): void;
    warn(message: string): void;
}
export interface EnvAdapter {
    now(): string;
    sha256(data: string | Uint8Array): Promise<string>;
}
