// src/dispatcher/workspace-attach.ts
// 角色/编排/prefetch 会话工作区归组：复刻官方 dsh-host-apiproxy fork 流程
// （create(meta.cwd) → resolveByPath(cwd) → attachSession），缺失时经 userQuestions
// 询问用户后自动 create。归组是 UX 增强，失败一律静默降级 Ungrouped，绝不阻断任务。
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';

/** duck-typed workspaceRegistry 服务面（dsh-workspace 注册为 ctx.workspaceRegistry）。 */
export interface WorkspaceRegistryLike {
  resolveByPath(path: string): Promise<{ id: string } | undefined>;
  create(path: string, title?: string): Promise<{ id: string }>;
  attachSession(sessionId: unknown): Promise<void>;
}

/** duck-typed userQuestions 服务面（dsh-user-questions 注册为 ctx.userQuestions；custom 为自由文本 Other 答案）。 */
export interface UserQuestionsLike {
  ask(req: {
    questions: Array<{
      id: string; question: string; detail?: string; header?: string;
      options?: Array<{ label: string; description?: string }>;
    }>;
  }): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>;
}

const ASK_TIMEOUT_MS = 120_000;

function getWs(ctx: Context): WorkspaceRegistryLike | undefined {
  return (ctx as unknown as { get?(n: string): unknown }).get?.('workspaceRegistry') as WorkspaceRegistryLike | undefined;
}
function getUq(ctx: Context): UserQuestionsLike | undefined {
  return (ctx as unknown as { get?(n: string): unknown }).get?.('userQuestions') as UserQuestionsLike | undefined;
}

/** 询问用户注册工作区（超时护栏，与 requestRepoPermission 一致）。返回选定路径或 null。 */
async function askWorkspace(uq: UserQuestionsLike, cwd: string | null, label: string): Promise<string | null> {
  try {
    const options: Array<{ label: string; description?: string }> = cwd
      ? [{ label: '创建', description: '注册 ' + cwd + ' 为工作区并归组会话' }]
      : [];
    options.push({ label: '跳过', description: '保持 Ungrouped，不创建工作区' });
    const ans = await Promise.race([
      uq.ask({
        questions: [{
          id: 'workspace-register',
          header: '工作区注册',
          question: cwd
            ? '会话工作目录 ' + cwd + '（' + label + '）未注册为 DSH 工作区。是否注册为工作区以归组角色会话？'
            : label + ' 未绑定工作区。请在 Other 中输入要注册为工作区的目录绝对路径，或选择跳过。',
          detail: '注册后角色/编排会话将与主 agent 同组展示；不注册则保持 Ungrouped。',
          options,
        }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('workspace-ask-timeout')), ASK_TIMEOUT_MS)),
    ]);
    const item = ans.answers?.[0];
    if (item?.custom?.trim()) return item.custom.trim();
    if (item?.selected?.includes('创建') && cwd) return cwd;
    return null;
  } catch {
    return null;
  }
}

/**
 * 返回可用的会话工作目录路径。
 * - cwd 已知：优先复用已注册工作区；未注册则询问用户（默认创建 @cwd）自动 create；询问失败/跳过仍返回 cwd（目录正确性优先，归组是 bonus）。
 * - cwd 未知：必须经询问拿到路径并 create；无路径/无通道/无服务 → null（调用方 block 或待命）。
 */
export async function resolveOrCreateWorkspace(ctx: Context, cwd: string | null | undefined, label: string): Promise<string | null> {
  const ws = getWs(ctx);
  if (cwd) {
    if (ws?.resolveByPath) {
      try { if (await ws.resolveByPath(cwd)) return cwd; } catch { /* 归组失败不阻断 */ }
    }
    if (ws?.create) {
      const uq = getUq(ctx);
      if (uq?.ask) {
        const chosen = await askWorkspace(uq, cwd, label);
        if (chosen) {
          try { await ws.create(chosen); } catch { /* 创建失败不阻断 */ }
          return chosen;
        }
      }
    }
    return cwd;
  }
  if (!ws?.create) return null;
  const uq = getUq(ctx);
  if (!uq?.ask) return null;
  const chosen = await askWorkspace(uq, null, label);
  if (!chosen) return null;
  try { await ws.create(chosen); } catch { return null; }
  return chosen;
}

/** 把已创建/恢复的会话归组到 cwd 对应工作区；无则询问创建；全程失败静默（归组是 UX 增强，不阻断任务）。 */
export async function attachSessionToWorkspace(ctx: Context, sessionId: string, cwd: string, label: string): Promise<void> {
  const ws = getWs(ctx);
  if (!ws?.attachSession) return;
  try {
    const path = await resolveOrCreateWorkspace(ctx, cwd, label);
    if (!path) return;
    await ws.attachSession(SessionId(sessionId));
    console.error('[dsh-swarm][debug] session attached workspace ' + sessionId + ' cwd=' + path + ' label=' + label);
  } catch (err) {
    console.error('[dsh-swarm][debug] attach session failed ' + sessionId + ': ' + String(err));
  }
}
