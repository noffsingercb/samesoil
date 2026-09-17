import type { EnvAdapter } from "../../core/adapters.js";
export declare class NodeEnvAdapter implements EnvAdapter {
    now(): string;
    sha256(data: string | Uint8Array): Promise<string>;
}
