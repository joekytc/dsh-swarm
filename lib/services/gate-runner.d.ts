import type { GateCommand } from '../domain/gate-policy.js';
export interface GateResult {
    command: string;
    exitCode: number | null;
    durationMs: number;
    output: string;
    truncated: boolean;
}
export interface GateRunReport {
    ok: boolean;
    results: GateResult[];
    failure?: {
        command: string;
        code: 'NONZERO' | 'TIMEOUT' | 'FORBIDDEN' | 'SPAWN_FAIL';
        detail: string;
    };
}
export declare function runOne(cmd: GateCommand, timeoutMs: number): Promise<GateResult & {
    timedOut?: boolean;
}>;
export declare function runGateCommands(commands: GateCommand[], cfg: {
    timeoutMs: number;
    forbidden: string[];
}, run?: typeof runOne): Promise<GateRunReport>;
