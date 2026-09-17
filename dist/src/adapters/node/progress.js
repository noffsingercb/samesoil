export class ConsoleProgressReporter {
    #verbose;
    constructor(verbose) { this.#verbose = verbose; }
    passStarted(passName) { console.log(`[${passName}] started`); }
    progress(passName, completed, total) {
        if (this.#verbose)
            console.log(`[${passName}] ${completed}${total === undefined ? "" : `/${total}`}`);
    }
    passFinished(passName, report) {
        console.log(`[${passName}] finished ${JSON.stringify(report)}`);
    }
    warn(message) { console.warn(`warning: ${message}`); }
}
