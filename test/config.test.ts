import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NodeEnvAdapter } from "../src/adapters/node/env.js";
import { loadConfig } from "../src/config/config.js";
test("default config hash is stable", async (): Promise<void> => { const json=await readFile(new URL("../config/default.json",import.meta.url),"utf8"), env=new NodeEnvAdapter(), first=await loadConfig(json,undefined,env), second=await loadConfig(json,"{}",env); assert.equal(first.hash,second.hash); });
test("validation reports the offending path", async (): Promise<void> => { const json=await readFile(new URL("../config/default.json",import.meta.url),"utf8"); await assert.rejects(loadConfig(json,'{"date":{"abt_years":"five"}}',new NodeEnvAdapter()),/config\.date\.abt_years/); });
