import type { Handoff } from './types.js';
/**
 * R20 D(execute) 交付物证据判定（C1/C2 共用）：
 * 完成交接 metadata 必须带 changed_files（非空）+ (commit_hash | push) 至少其一，
 * 才算具备"实际执行并产出 git 产物"的证据。无证据 → 不判链完成 / kanban_complete 拒绝。
 *
 * changed_files：string[] 或非空字符串（分支/README/代码变更清单）。
 * commit_hash：提交哈希字符串；push：布尔或描述串（已推送）。
 */
export declare function hasDeliveryEvidence(handoff: Handoff | undefined): boolean;
/** D(execute) 的 TDD 声明（2026-08-26）：tdd 必须存在且结构合法——test_files 与 skipped 二选一（XOR）。 */
export declare function hasTddDeclaration(handoff: Handoff | undefined): boolean;
