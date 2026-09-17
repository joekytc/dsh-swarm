export interface GateCommand {
    command: string;
    cwd: string;
    source: 'tdd';
}
export type GateOutcome = {
    kind: 'run';
    commands: GateCommand[];
} | {
    kind: 'bounce';
    reason: string;
} | {
    kind: 'alarm-skip';
    reason: string;
} | {
    kind: 'silent-skip';
    reason: string;
};
export type SkippedVerdict = {
    action: 'allow-alarm';
    reason: string;
} | {
    action: 'bounce';
    reason: string;
} | {
    action: 'proceed';
};
/** ④ tdd.skipped 声明互证：diff 实况三分支（改声明 / tdd 先行 / 放行留痕）。
 * 返回类型排除 proceed（proceed 仅为 test_files 对称核验的"放行"语义）。 */
export declare function classifySkippedDeclaration(diffFiles: string[] | null): Exclude<SkippedVerdict, {
    action: 'proceed';
}>;
/** 对称核验：声明 tdd.test_files 但 diff 零测试变更（拿旧测试交差）→ bounce。 */
export declare function classifyTestFilesDeclaration(diffFiles: string[] | null): SkippedVerdict;
/** 从 D 卡 body 解析 diff base（body 模板声明 `TARGET_BRANCH=<目标分支名>`，v-orchestrator d:76）。
 * 与 test_files 同款防线：拒 git 旗标注入（`--output=/x` 可写任意路径文件）与路径逃逸。 */
export declare function resolveDiffBase(body: string): string | null;
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
    /** 装配层 git diff --name-only base...HEAD 结果；undefined/null=不可得（保守）。 */
    diffFiles?: string[] | null;
}): GateOutcome;
