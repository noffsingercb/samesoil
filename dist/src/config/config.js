const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function merge(defaults, override, path) {
    if (override === undefined)
        return defaults;
    if (isObject(defaults)) {
        if (!isObject(override))
            throw new Error(`${path}: expected object`);
        const unknown = Object.keys(override).filter((key) => !(key in defaults));
        if (unknown.length > 0)
            throw new Error(`${path}.${unknown[0]}: unknown key`);
        return Object.fromEntries(Object.keys(defaults).map((key) => [key, merge(defaults[key], override[key], `${path}.${key}`)]));
    }
    return override;
}
function requireObject(value, path) { if (!isObject(value))
    throw new Error(`${path}: expected object`); return value; }
function requireString(value, path) { if (typeof value !== "string" || value.length === 0)
    throw new Error(`${path}: expected non-empty string`); return value; }
function requireNumber(value, path) { if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path}: expected finite number`); return value; }
function requireBoolean(value, path) { if (typeof value !== "boolean")
    throw new Error(`${path}: expected boolean`); return value; }
function numberObject(value, path, keys) { const object = requireObject(value, path); return Object.fromEntries(keys.map((key) => [key, requireNumber(object[key], `${path}.${key}`)])); }
function validate(value) {
    const root = requireObject(value, "config"), date = numberObject(root.date, "config.date", ["abt_years", "est_years", "cal_years", "open_interval_fallback_years", "pre_1752_widen_days"]), presence = numberObject(root.presence, "config.presence", ["point_event_dwell_days", "transit_event_window_days", "min_presence_conf"]), place = requireObject(root.place, "config.place"), radii = numberObject(place.radius_km_by_tier, "config.place.radius_km_by_tier", ["address", "locality", "district", "region", "country"]), kinship = numberObject(root.kinship, "config.kinship", ["close_kin_cutoff", "in_law_cutoff", "generations_cutoff", "branch_cutoff", "bfs_max_depth"]), scoring = requireObject(root.scoring, "config.scoring"), weights = numberObject(scoring.weights, "config.scoring.weights", ["proximity", "temporal", "precision", "confidence", "unrelatedness", "independence"]), privacy = requireObject(root.privacy, "config.privacy");
    const tier = requireString(place.min_tier, "config.place.min_tier");
    if (!["address", "locality", "district", "region", "country"].includes(tier))
        throw new Error("config.place.min_tier: invalid precision tier");
    return { engine_version: requireString(root.engine_version, "config.engine_version"), date: date, presence: presence, place: { radius_km_by_tier: radii, min_tier: tier, proximity_radius_multiplier: requireNumber(place.proximity_radius_multiplier, "config.place.proximity_radius_multiplier"), min_geocode_conf: requireNumber(place.min_geocode_conf, "config.place.min_geocode_conf") }, kinship: kinship, scoring: { weights: weights, score_threshold: requireNumber(scoring.score_threshold, "config.scoring.score_threshold"), max_candidates: requireNumber(scoring.max_candidates, "config.scoring.max_candidates") }, privacy: { include_living: requireBoolean(privacy.include_living, "config.privacy.include_living"), living_cutoff_year: requireNumber(privacy.living_cutoff_year, "config.privacy.living_cutoff_year") } };
}
function canonicalize(value) { if (Array.isArray(value))
    return `[${value.map(canonicalize).join(",")}]`; if (isObject(value))
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`; return JSON.stringify(value); }
export async function loadConfig(defaultJson, overrideJson, env) {
    let defaults, override = undefined;
    try {
        defaults = JSON.parse(defaultJson);
    }
    catch {
        throw new Error("config defaults: invalid JSON");
    }
    if (overrideJson !== undefined) {
        try {
            override = JSON.parse(overrideJson);
        }
        catch {
            throw new Error("config override: invalid JSON");
        }
    }
    const config = validate(merge(defaults, override, "config"));
    const canonicalJson = canonicalize(config);
    return { config, canonicalJson, hash: await env.sha256(canonicalJson) };
}
