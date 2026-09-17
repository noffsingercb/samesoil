import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const roots=["src/core","src/passes"];
const forbidden=[[/from\s+["']node:/,"Node builtin import"],[/import\s*["']node:/,"Node builtin import"],[/from\s+["']better-sqlite3["']/,"better-sqlite3 import"],[/\bfetch\s*\(/,"global fetch"],[/\bwindow\b/,"window"],[/\bdocument\b/,"document"],[/\bprocess\.env\b/,"process.env"],[/\bDate\.now\s*\(/,"Date.now"],[/\bMath\.random\s*\(/,"Math.random"]];
async function walk(directory){ const output=[]; for(const entry of await readdir(directory,{withFileTypes:true})){ const path=join(directory,entry.name); if(entry.isDirectory()) output.push(...await walk(path)); else if(extname(path)===".ts") output.push(path); } return output; }
const failures=[]; for(const root of roots){ for(const path of await walk(root)){ const source=await readFile(path,"utf8"); for(const [pattern,label] of forbidden){ if(pattern.test(source)) failures.push(`${path}: ${label}`); } } }
if(failures.length>0){ console.error(failures.join("\n")); process.exitCode=1; } else console.log("Purity check passed.");
