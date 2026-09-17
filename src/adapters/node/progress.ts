import type { ProgressReporter } from "../../core/adapters.js";
export class ConsoleProgressReporter implements ProgressReporter {
  readonly #verbose: boolean;
  public constructor(verbose: boolean) { this.#verbose = verbose; }
  public passStarted(passName: string): void { console.log(`[${passName}] started`); }
  public progress(passName: string, completed: number, total?: number): void {
    if (this.#verbose) console.log(`[${passName}] ${completed}${total === undefined ? "" : `/${total}`}`);
  }
  public passFinished(passName: string, report: Readonly<Record<string, unknown>>): void {
    console.log(`[${passName}] finished ${JSON.stringify(report)}`);
  }
  public warn(message: string): void { console.warn(`warning: ${message}`); }
}
