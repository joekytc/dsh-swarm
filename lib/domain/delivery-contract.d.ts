import type { BoardState, Handoff, Role, TaskMode } from './types.js';
export declare function requiredDeliveryKeys(assignee: Role, mode: TaskMode): string[];
/** 缺失的交付键（存在但为空的字符串/非字符串均视为缺失）。 */
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
