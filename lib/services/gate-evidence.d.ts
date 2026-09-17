import type { GateRunReport } from './gate-runner.js';
export declare function writeGateLog(dir: string, taskId: string, report: GateRunReport): Promise<string>;
