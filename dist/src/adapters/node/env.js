import { createHash } from "node:crypto";
export class NodeEnvAdapter {
    now() { return new Date().toISOString(); }
    async sha256(data) {
        return createHash("sha256").update(data).digest("hex");
    }
}
