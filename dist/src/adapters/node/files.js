import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
function encodingHint(bytes) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
        return "UTF-8";
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
        return "UTF-16";
    return "unknown";
}
export class NodeFileSourceAdapter {
    async readGedcom(path) {
        const bytes = new Uint8Array(await readFile(path));
        return { bytes, encodingHint: encodingHint(bytes) };
    }
    async readText(path) { return readFile(path, "utf8"); }
}
export class NodeArtifactSinkAdapter {
    #directory;
    constructor(directory) { this.#directory = resolve(directory); }
    async write(name, data) {
        const outputPath = resolve(this.#directory, name);
        if (!outputPath.startsWith(`${this.#directory}/`) && outputPath !== this.#directory) {
            throw new Error(`Artifact path escapes output directory: ${name}`);
        }
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, data);
    }
}
