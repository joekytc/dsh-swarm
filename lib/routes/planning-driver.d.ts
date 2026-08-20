import { KanbanService } from '../domain/kanban-service.js';
import type { SpecCard, SpecCardAttachment } from '../domain/types.js';
export declare const MATTPOCOCK_PLANNING_GUIDANCE = "\n# \u9636\u6BB5 0 \u89C4\u5212\u5BF9\u8BDD\uFF08mattpocock \u65B9\u6CD5\u8BBA\uFF09\n1. ask-matt\uFF1A\u4E00\u6B21\u53EA\u95EE\u4E00\u4E2A\u95EE\u9898\uFF0C\u5148\u6F84\u6E05\u76EE\u7684\u3001\u7EA6\u675F\u3001\u6210\u529F\u6807\u51C6\uFF1B\u57FA\u4E8E\u89C4\u683C\u5361\u9644\u4EF6\u7684\u4ED3\u5E93\u4E8B\u5B9E\u63D0\u95EE\uFF0C\u4E0D\u51ED\u7A7A\u5047\u8BBE\u3002\n2. grill-me\uFF1A\u5BF9\u6BCF\u4E2A\u5047\u8BBE\u9010\u9879\u62F7\u95EE\uFF08\u82CF\u683C\u62C9\u5E95\u5F0F\uFF09\uFF0C\u76F4\u81F3\u7528\u6237\u660E\u786E\u8868\u793A\"\u6CA1\u6709\u4EFB\u4F55\u7591\u95EE\"\u3002\n3. \u6536\u655B\uFF1A\u628A\u7ED3\u8BBA\u5199\u5165\u89C4\u683C\u5361\u516D\u6BB5\uFF08problem/solution/user_stories/impl_decisions/testing/out_of_scope\uFF09\u3002\n4. \u6536\u5C3E\uFF1A\u63D0\u9192\u7528\u6237\u4EE5 /openspec: \u786E\u8BA4\u6267\u884C\u7ED3\u675F\u89C4\u5212\u9636\u6BB5\u3002\n";
export declare function validateSpecCardForApproval(card: SpecCard): string[];
export declare function buildPlanningContext(chainId: string, card: SpecCard, attachments: SpecCardAttachment[]): string;
export declare function approveIfReady(message: string, service: KanbanService, cfg: {
    plan: string;
    openspec: string;
}, chainId: string, specCardId: string): Promise<{
    ok: true;
    card: SpecCard;
} | {
    ok: false;
    missing: string[];
    guidance: string;
}>;
