import type { ProgressReporter } from "../../core/adapters.js";
export declare class ConsoleProgressReporter implements ProgressReporter {
    #private;
    constructor(verbose: boolean);
    passStarted(passName: string): void;
    progress(passName: string, completed: number, total?: number): void;
    passFinished(passName: string, report: Readonly<Record<string, unknown>>): void;
    warn(message: string): void;
}
