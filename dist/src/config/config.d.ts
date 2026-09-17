import type { EnvAdapter } from "../core/adapters.js";
export type PrecisionTier = "address" | "locality" | "district" | "region" | "country";
export interface SamesoilConfig {
    readonly engine_version: string;
    readonly date: {
        readonly abt_years: number;
        readonly est_years: number;
        readonly cal_years: number;
        readonly open_interval_fallback_years: number;
        readonly pre_1752_widen_days: number;
    };
    readonly presence: {
        readonly point_event_dwell_days: number;
        readonly transit_event_window_days: number;
        readonly min_presence_conf: number;
    };
    readonly place: {
        readonly radius_km_by_tier: Readonly<Record<PrecisionTier, number>>;
        readonly min_tier: PrecisionTier;
        readonly proximity_radius_multiplier: number;
        readonly min_geocode_conf: number;
    };
    readonly kinship: {
        readonly close_kin_cutoff: number;
        readonly in_law_cutoff: number;
        readonly generations_cutoff: number;
        readonly branch_cutoff: number;
        readonly bfs_max_depth: number;
    };
    readonly scoring: {
        readonly weights: {
            readonly proximity: number;
            readonly temporal: number;
            readonly precision: number;
            readonly confidence: number;
            readonly unrelatedness: number;
            readonly independence: number;
        };
        readonly score_threshold: number;
        readonly max_candidates: number;
    };
    readonly privacy: {
        readonly include_living: boolean;
        readonly living_cutoff_year: number;
    };
}
export interface LoadedConfig {
    readonly config: SamesoilConfig;
    readonly hash: string;
    readonly canonicalJson: string;
}
export declare function loadConfig(defaultJson: string, overrideJson: string | undefined, env: EnvAdapter): Promise<LoadedConfig>;
