import { resolve } from "node:path";
import { NodeStorageAdapter } from "./adapters/node/storage.js";
import { NodeArtifactSinkAdapter, NodeFileSourceAdapter } from "./adapters/node/files.js";
import { ConsoleProgressReporter } from "./adapters/node/progress.js";
import { NodeEnvAdapter } from "./adapters/node/env.js";
import { loadConfig } from "./config/config.js";
import type { EngineContext } from "./core/context.js";
import { migrate } from "./db/migrate.js";
import { run as ingest } from "./passes/ingest.js";
import { run as dates } from "./passes/dates.js";
import { run as places } from "./passes/places.js";
import { run as kinship } from "./passes/kinship.js";
import { run as presence } from "./passes/presence.js";
import { run as candidates } from "./passes/candidates.js";
import { run as score } from "./passes/score.js";
type Command = "init" | "ingest" | "dates" | "places" | "kinship" | "presence" | "candidates" | "score" | "export" | "all";
const COMMANDS: readonly Command[] = ["init", "ingest", "dates", "places", "kinship", "presence", "candidates", "score", "export", "all"];
interface Options { readonly command: Command; readonly dbPath: string; readonly configPath?: string; readonly gedcomPath?: string; readonly verbose: boolean }
function parseArgs(argv: readonly string[]): Options { const command = argv[0] as Command; if (!COMMANDS.includes(command)) throw new Error(`Usage: samesoil <${COMMANDS.join("|")}> [--db path] [--config path] [--gedcom path] [--verbose]`); let dbPath = "samesoil.sqlite", configPath: string | undefined, gedcomPath: string | undefined, verbose = false; for (let index = 1; index < argv.length; index += 1) { const arg = argv[index]; if (arg === "--verbose") verbose = true; else if (arg === "--db" || arg === "--config" || arg === "--gedcom") { const value = argv[index + 1]; if (value === undefined) throw new Error(`${arg} requires a path`); if (arg === "--db") dbPath = value; else if (arg === "--config") configPath = value; else gedcomPath = value; index += 1; } else throw new Error(`Unknown argument: ${arg}`); } return { command, dbPath: resolve(dbPath), verbose, ...(configPath === undefined ? {} : { configPath: resolve(configPath) }), ...(gedcomPath === undefined ? {} : { gedcomPath: resolve(gedcomPath) }) }; }
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> { const options = parseArgs(argv), files = new NodeFileSourceAdapter(), env = new NodeEnvAdapter(), root = process.cwd(), defaults = await files.readText(resolve(root, "config/default.json")), override = options.configPath === undefined ? undefined : await files.readText(options.configPath), loaded = await loadConfig(defaults, override, env), storage = new NodeStorageAdapter(options.dbPath); try { const ctx: EngineContext = { storage, fileSource: files, artifactSink: new NodeArtifactSinkAdapter(resolve(options.dbPath, "../artifacts")), progress: new ConsoleProgressReporter(options.verbose), env, config: loaded.config, configHash: loaded.hash, ...(options.gedcomPath === undefined ? {} : { inputPath: options.gedcomPath }) }; if (options.command === "init") migrate(storage, await files.readText(resolve(root, "src/db/schema.sql"))); else if (options.command === "ingest") await ingest(ctx); else if (options.command === "dates") await dates(ctx); else if (options.command === "places") await places(ctx); else if (options.command === "kinship") await kinship(ctx); else if (options.command === "presence") await presence(ctx); else if (options.command === "candidates") await candidates(ctx); else if (options.command === "score") await score(ctx); else if (options.command === "all") { await ingest(ctx); await dates(ctx); await places(ctx); await kinship(ctx); await presence(ctx); await candidates(ctx); await score(ctx); } console.log(`command=${options.command}`); console.log(`db=${options.dbPath}`); console.log(`config_hash=${loaded.hash}`); } finally { storage.close(); } }
main().catch((error: unknown): void => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
