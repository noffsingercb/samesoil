import type {
  ArtifactSinkAdapter,
  ContextProviderAdapter,
  EnvAdapter,
  FileSourceAdapter,
  PlaceProviderAdapter,
  ProgressReporter,
  StorageAdapter
} from "./adapters.js";
import type { SamesoilConfig } from "../config/config.js";

export interface EngineContext {
  readonly storage: StorageAdapter;
  readonly fileSource: FileSourceAdapter;
  readonly artifactSink: ArtifactSinkAdapter;
  readonly progress: ProgressReporter;
  readonly env: EnvAdapter;
  readonly inputPath?: string;
  readonly placeProvider?: PlaceProviderAdapter;
  readonly contextProvider?: ContextProviderAdapter;
  readonly config: SamesoilConfig;
  readonly configHash: string;
}
