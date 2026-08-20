/** 审计事件不是状态转换（不改变 Chain 状态，见 state-machine.ts）。 */
export const isAuditEventKind = (kind) => kind === 'chain/audit-warning' || kind === 'chain/audit-confirmed';
