import { createHash } from "node:crypto";
import type { EnvAdapter } from "../../core/adapters.js";
export class NodeEnvAdapter implements EnvAdapter {
  public now(): string { return new Date().toISOString(); }
  public async sha256(data: string | Uint8Array): Promise<string> {
    return createHash("sha256").update(data).digest("hex");
  }
}
