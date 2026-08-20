// src/domain/delivery-contract.ts
import type { BoardState, Handoff, Role, TaskMode } from './types.js';

/**
 * 上游交付契约（R20「上游对下游负责」宗旨）：每阶段任务完成交接 metadata 必须产出的键。
 * key = `${assignee}:${mode}`；仅列出「下游实际读取」的硬交付物——
 *   - w:file（W1-pre）：ref = 目标仓库绝对路径（规格卡附件 / D 定位仓库 / P 读仓库事实）
 *   - w:kb（W2/W3）：kb_url + page_path = KB 同步页（下游 wiki_read 读原文 / 收尾）
 *   - p:openspec（P）：artifacts_path = openspec 实施计划产物路径（W2 读取同步 KB）
 * d:execute 的 git 产物证据由 hasDeliveryEvidence 单独判定；pt/dt 由 validateReviewEvidence 判定，
 * 二者不重复登记。
 * 未列出的 mode（w:external 可选、align 旧兼容等）无硬交付约束。
 */
const REQUIRED_DELIVERY: Record<string, string[]> = {
  'w:file': ['ref'],
  'w:kb': ['kb_url', 'page_path'],
  'p:openspec': ['artifacts_path'],
};

export function requiredDeliveryKeys(assignee: Role, mode: TaskMode): string[] {
  return REQUIRED_DELIVERY[`${assignee}:${mode}`] ?? [];
}

/** 缺失的交付键（存在但为空的字符串/非字符串均视为缺失）。 */
export function missingDeliveryKeys(assignee: Role, mode: TaskMode, handoff: Handoff | undefined): string[] {
  const keys = requiredDeliveryKeys(assignee, mode);
  if (keys.length === 0) return [];
  if (!handoff) return keys.slice();
  const m = handoff.metadata ?? {};
  return keys.filter((k) => {
    const v = m[k];
    return typeof v !== 'string' || v.trim().length === 0;
  });
}

export function hasRequiredDelivery(assignee: Role, mode: TaskMode, handoff: Handoff | undefined): boolean {
  return missingDeliveryKeys(assignee, mode, handoff).length === 0;
}

/** 交付契约缺失的父卡项（供 V 建下游卡前的前置校验）。 */
export interface MissingParentDelivery {
  taskId: string;
  assignee: Role;
  mode: TaskMode;
  missing: string[];
}

/** 对一组父任务 id 做交付契约校验，返回缺关键交付物的父卡清单（无缺失返回空数组）。 */
export function missingParentDelivery(state: BoardState, parentIds: string[]): MissingParentDelivery[] {
  const out: MissingParentDelivery[] = [];
  for (const pid of parentIds) {
    const pt = state.tasks.get(pid);
    if (!pt) continue;
    const missing = missingDeliveryKeys(pt.assignee, pt.mode, state.handoffs.get(pid));
    if (missing.length > 0) out.push({ taskId: pid, assignee: pt.assignee, mode: pt.mode, missing });
  }
  return out;
}