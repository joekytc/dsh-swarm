import type { BoardState, Handoff, Role, TaskMode } from './types.js';
export declare function requiredDeliveryKeys(assignee: Role, mode: TaskMode): string[];
/** v2：pt_decision 结构校验（needed 布尔必填；needed=true 时 reason 必填）。返回缺失键列表。 */
export declare function missingPtDecisionKeys(handoff: Handoff | undefined): string[];
/** 缺失的交付键（存在但为空的字符串/非字符串均视为缺失；pt_decision 走结构校验透传细粒度键）。 */
export declare function missingDeliveryKeys(assignee: Role, mode: TaskMode, handoff: Handoff | undefined): string[];
export declare function hasRequiredDelivery(assignee: Role, mode: TaskMode, handoff: Handoff | undefined): boolean;
/** 交付契约缺失的父卡项（供 V 建下游卡前的前置校验）。 */
export interface MissingParentDelivery {
    taskId: string;
    assignee: Role;
    mode: TaskMode;
    missing: string[];
}
/** 对一组父任务 id 做交付契约校验，返回缺关键交付物的父卡清单（无缺失返回空数组）。 */
export declare function missingParentDelivery(state: BoardState, parentIds: string[]): MissingParentDelivery[];
