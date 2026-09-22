import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NodeEnvAdapter } from "../src/adapters/node/env.js";
import { loadConfig } from "../src/config/config.js";
async function defaults():Promise<string>{return readFile(new URL("../config/default.json",import.meta.url),"utf8")}
test("default config hash is stable",async():Promise<void>=>{const json=await defaults(),env=new NodeEnvAdapter(),first=await loadConfig(json,undefined,env),second=await loadConfig(json,"{}",env);assert.equal(first.hash,second.hash)});
test("validation reports the offending path",async():Promise<void>=>{await assert.rejects(loadConfig(await defaults(),'{"date":{"abt_years":"five"}}',new NodeEnvAdapter()),/config\.date\.abt_years/)});
test("validation rejects nonmonotone place weights",async():Promise<void>=>{await assert.rejects(loadConfig(await defaults(),'{"scoring":{"precision_tier_weights":{"locality":1.1}}}',new NodeEnvAdapter()),/precision_tier_weights\.locality/)});
test("validation rejects nonmonotone date weights",async():Promise<void>=>{await assert.rejects(loadConfig(await defaults(),'{"scoring":{"temporal_precision_weights":{"year":0.95}}}',new NodeEnvAdapter()),/temporal_precision_weights\.year/)});
test("validation rejects kinship searches shallower than suppression policy",async():Promise<void>=>{await assert.rejects(loadConfig(await defaults(),'{"kinship":{"bfs_max_depth":1}}',new NodeEnvAdapter()),/bfs_max_depth/)});
test("validation rejects contradictory temporal windows",async():Promise<void>=>{await assert.rejects(loadConfig(await defaults(),'{"scoring":{"temporal_gap_full_score_days":4000}}',new NodeEnvAdapter()),/temporal_gap_full_score_days/)});
test("validation rejects negative limits and invalid confidence",async():Promise<void>=>{await assert.rejects(loadConfig(await defaults(),'{"scoring":{"max_candidates_per_locality":-1}}',new NodeEnvAdapter()),/max_candidates_per_locality/);await assert.rejects(loadConfig(await defaults(),'{"place":{"min_geocode_conf":2}}',new NodeEnvAdapter()),/min_geocode_conf/)});
