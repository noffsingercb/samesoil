import { resolve } from "node:path";
import { NodeStorageAdapter } from "./adapters/node/storage.js";
import { NodeArtifactSinkAdapter, NodeFileSourceAdapter } from "./adapters/node/files.js";
import { ConsoleProgressReporter } from "./adapters/node/progress.js";
import { NodeEnvAdapter } from "./adapters/node/env.js";
import { loadConfig } from "./config/config.js";
import type { EngineContext } from "./core/context.js";
import { migrate } from "./db/migrate.js";

type Command = "init"|"ingest"|"dates"|"places"|"kinship"|"presence"|"candidates"|"score"|"export"|"all";
const COMMANDS: readonly Command[]=["init","ingest","dates","places","kinship","presence","candidates","score","export","all"];
interface Options { command: Command; dbPath: string; configPath?: string; verbose: boolean }
function parseArgs(argv: readonly string[]): Options {
  const command=argv[0] as Command; if (!COMMANDS.includes(command)) throw new Error(`Usage: samesoil <${COMMANDS.join("|")}> [--db path] [--config path] [--verbose]`);
  let dbPath="samesoil.sqlite", configPath: string|undefined, verbose=false;
  for(let index=1;index<argv.length;index+=1){ const arg=argv[index]; if(arg==="--verbose") verbose=true; else if(arg==="--db"||arg==="--config"){ const value=argv[index+1]; if(value===undefined) throw new Error(`${arg} requires a path`); if(arg==="--db") dbPath=value; else configPath=value; index+=1; } else throw new Error(`Unknown argument: ${arg}`); }
  return configPath===undefined?{command,dbPath:resolve(dbPath),verbose}:{command,dbPath:resolve(dbPath),configPath:resolve(configPath),verbose};
}
export async function main(argv: readonly string[]=process.argv.slice(2)): Promise<void> {
  const options=parseArgs(argv), files=new NodeFileSourceAdapter(), env=new NodeEnvAdapter(), root=process.cwd(), defaultJson=await files.readText(resolve(root,"config/default.json")), overrideJson=options.configPath===undefined?undefined:await files.readText(options.configPath), loaded=await loadConfig(defaultJson,overrideJson,env), storage=new NodeStorageAdapter(options.dbPath);
  try { const ctx:EngineContext={storage,fileSource:files,artifactSink:new NodeArtifactSinkAdapter(resolve(options.dbPath,"../artifacts")),progress:new ConsoleProgressReporter(options.verbose),env,config:loaded.config,configHash:loaded.hash}; void ctx; if(options.command==="init"){ const schema=await files.readText(resolve(root,"src/db/schema.sql")); migrate(storage,schema); } console.log(`command=${options.command}`); console.log(`db=${options.dbPath}`); console.log(`config_hash=${loaded.hash}`); } finally { storage.close(); }
}
main().catch((error:unknown):void=>{ console.error(error instanceof Error?error.message:String(error)); process.exitCode=1; });
