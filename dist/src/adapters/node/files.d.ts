import type { ArtifactSinkAdapter, FileSourceAdapter, GedcomSource } from "../../core/adapters.js";
export declare class NodeFileSourceAdapter implements FileSourceAdapter {
    readGedcom(path: string): Promise<GedcomSource>;
    readText(path: string): Promise<string>;
}
export declare class NodeArtifactSinkAdapter implements ArtifactSinkAdapter {
    #private;
    constructor(directory: string);
    write(name: string, data: string | Uint8Array): Promise<void>;
}
