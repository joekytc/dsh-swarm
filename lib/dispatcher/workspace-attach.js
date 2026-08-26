import { SessionId } from '@deepseek-ai/dsh-session';
const ASK_TIMEOUT_MS = 120_000;
function getWs(ctx) {
    return ctx.get?.('workspaceRegistry');
}
function getUq(ctx) {
    return ctx.get?.('userQuestions');
}
/** 询问用户注册工作区（超时护栏，与 requestRepoPermission 一致）。返回选定路径或 null。 */
async function askWorkspace(uq, cwd, label) {
    try {
        const options = cwd
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
            new Promise((_, reject) => setTimeout(() => reject(new Error('workspace-ask-timeout')), ASK_TIMEOUT_MS)),
        ]);
        const item = ans.answers?.[0];
        if (item?.custom?.trim())
            return item.custom.trim();
        if (item?.selected?.includes('创建') && cwd)
            return cwd;
        return null;
    }
    catch {
        return null;
    }
}
/**
 * 返回可用的会话工作目录路径。
 * - cwd 已知：优先复用已注册工作区；未注册则询问用户（默认创建 @cwd）自动 create；询问失败/跳过仍返回 cwd（目录正确性优先，归组是 bonus）。
 * - cwd 未知：必须经询问拿到路径并 create；无路径/无通道/无服务 → null（调用方 block 或待命）。
 */
export async function resolveOrCreateWorkspace(ctx, cwd, label) {
    const ws = getWs(ctx);
    if (cwd) {
        if (ws?.resolveByPath) {
            try {
                if (await ws.resolveByPath(cwd))
                    return cwd;
            }
            catch { /* 归组失败不阻断 */ }
        }
        if (ws?.create) {
            const uq = getUq(ctx);
            if (uq?.ask) {
                const chosen = await askWorkspace(uq, cwd, label);
                if (chosen) {
                    try {
                        await ws.create(chosen);
                    }
                    catch { /* 创建失败不阻断 */ }
                    return chosen;
                }
            }
        }
        return cwd;
    }
    if (!ws?.create)
        return null;
    const uq = getUq(ctx);
    if (!uq?.ask)
        return null;
    const chosen = await askWorkspace(uq, null, label);
    if (!chosen)
        return null;
    try {
        await ws.create(chosen);
    }
    catch {
        return null;
    }
    return chosen;
}
/** 把已创建/恢复的会话归组到 cwd 对应工作区；未注册时询问用户（仅明确「创建」才 create）；全程失败静默（归组是 UX 增强，不阻断任务）。 */
export async function attachSessionToWorkspace(ctx, sessionId, cwd, label) {
    const ws = getWs(ctx);
    if (!ws?.create || !ws?.resolveByPath)
        return; // 无注册表 → 静默跳过（归组是 bonus）
    try {
        let entity = await ws.resolveByPath(cwd);
        if (!entity) {
            // 未注册：询问用户是否注册；跳过/无通道/超时 → 保持 Ungrouped（不创建）
            const uq = getUq(ctx);
            if (!uq?.ask)
                return;
            const chosen = await askWorkspace(uq, cwd, label);
            if (!chosen)
                return;
            entity = await ws.create(chosen);
        }
        if (!entity?.attachSession)
            return;
        await entity.attachSession(SessionId(sessionId));
        console.error('[dsh-swarm][debug] session attached workspace ' + sessionId + ' cwd=' + cwd + ' label=' + label);
    }
    catch (err) {
        console.error('[dsh-swarm][debug] attach session failed ' + sessionId + ': ' + String(err));
    }
}
