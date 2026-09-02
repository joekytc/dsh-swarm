export interface GateCommand {
    command: string;
    cwd: string;
    source: 'tdd';
}
export interface GatePlan {
    commands: GateCommand[];
    skipped: false;
}
export interface GateSkip {
    commands: [];
    skipped: true;
    reason: string;
}
export declare function isGatePlan(x: GatePlan | GateSkip): x is GatePlan;
export declare function branchMatches(current: string | null, declared: unknown): boolean;
export declare function deriveGatePlan(input: {
    assignee: string;
    mode: string;
    handoff: {
        metadata?: Record<string, unknown>;
    };
    config: {
        enabled: boolean;
    };
}): GatePlan | GateSkip;
