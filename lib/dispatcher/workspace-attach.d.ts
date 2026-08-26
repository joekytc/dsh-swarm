import type { Context } from '@deepseek-ai/cordis';
/** duck-typed Workspace 实体面（dsh-workspace 的 create()/resolveByPath() 返回物；attachSession 在实体上，不在 registry 上）。 */
export interface WorkspaceEntityLike {
    id: string;
    attachSession(sessionId: unknown): Promise<void>;
}
/** duck-typed workspaceRegistry 服务面（dsh-workspace 注册为 ctx.workspaceRegistry；无 attachSession）。 */
export interface WorkspaceRegistryLike {
    resolveByPath(path: string): Promise<WorkspaceEntityLike | undefined>;
    create(path: string, title?: string): Promise<WorkspaceEntityLike>;
}
/** duck-typed userQuestions 服务面（dsh-user-questions 注册为 ctx.userQuestions；custom 为自由文本 Other 答案）。 */
export interface UserQuestionsLike {
    ask(req: {
        questions: Array<{
            id: string;
            question: string;
            detail?: string;
            header?: string;
            options?: Array<{
                label: string;
                description?: string;
            }>;
        }>;
    }): Promise<{
        answers: Array<{
            id: string;
            selected: string[];
            custom?: string;
        }>;
    }>;
}
/**
 * 返回可用的会话工作目录路径。
 * - cwd 已知：优先复用已注册工作区；未注册则询问用户（默认创建 @cwd）自动 create；询问失败/跳过仍返回 cwd（目录正确性优先，归组是 bonus）。
 * - cwd 未知：必须经询问拿到路径并 create；无路径/无通道/无服务 → null（调用方 block 或待命）。
 */
export declare function resolveOrCreateWorkspace(ctx: Context, cwd: string | null | undefined, label: string): Promise<string | null>;
/** 把已创建/恢复的会话归组到 cwd 对应工作区；未注册时询问用户（仅明确「创建」才 create）；全程失败静默（归组是 UX 增强，不阻断任务）。 */
export declare function attachSessionToWorkspace(ctx: Context, sessionId: string, cwd: string, label: string): Promise<void>;
