/** 目标页若已含指定行（幂等判据），则不再重复注入。 */
function containsLine(content, line) {
    return content.split('\n').some((l) => l.trim() === line.trim());
}
/** 构造页内互链行：用 wiki 内部相对路径（#/page/…），host 变化不失效。 */
function linkLine(label, pagePath) {
    return `- ${label}：[#/page/${pagePath}](#/page/${pagePath})`;
}
/** 读取现有内容；页不存在或 KB 不可达 → 返回 null（调用方跳过，不阻塞）。 */
async function tryRead(wiki, pagePath) {
    try {
        const d = await wiki.read(pagePath);
        return d.rawMd;
    }
    catch {
        return null;
    }
}
async function tryWrite(wiki, pagePath, content) {
    try {
        await wiki.write(pagePath, content);
    }
    catch {
        // 登记失败不阻塞完成（completeTask 钩子外再捕获）
    }
}
/** 往文档追加「关联文档」区块（已存在则就地更新，避免重复追加）。 */
function upsertLinkedBlock(content, header, lines) {
    const block = ['## 关联文档', `> ${header}`, ...lines, ''].join('\n');
    const idx = content.indexOf('## 关联文档');
    if (idx === -1)
        return content.replace(/\n*$/, '\n\n') + block;
    // 替换旧区块：找到下一个二级标题或结尾
    const next = content.indexOf('\n## ', idx + '## 关联文档'.length);
    const end = next === -1 ? content.length : next + 1;
    return content.slice(0, idx) + block + '\n' + content.slice(end);
}
/**
 * 机械互链登记：链上 w:kb 任务完成时调用。
 * - 清单页：追加/更新「关联文档」区块，列出链上全部已 done 的 W2/W3 页。
 * - 当前页：写回清单页链接（清单 ref 来自规格卡 kind:'kb' 附件）。
 * 幂等（containsLine / 区块就地替换）；任何 wiki 读/写失败均静默跳过，不抛错。
 */
export async function syncKbLinks(wiki, state, taskId) {
    const task = state.tasks.get(taskId);
    if (!task || task.assignee !== 'w' || task.mode !== 'kb')
        return;
    const chain = state.chains.get(task.chainId);
    if (!chain?.specCardId)
        return;
    const spec = state.specCards.get(chain.specCardId);
    // 清单页 ref：kind:'kb' 附件；仅接受 projects/ 命名空间（临时目录兜底路径不是 KB 页，跳过）
    const checklistRef = spec?.attachments.find((a) => a.kind === 'kb')?.ref ?? null;
    const checklistPath = checklistRef && checklistRef.startsWith('projects/') ? checklistRef : null;
    // 链上已 done 的 W2/W3 页（含当前任务所属页）
    const pages = [...state.tasks.values()]
        .filter((t) => t.chainId === task.chainId && t.assignee === 'w' && t.mode === 'kb' && t.status === 'done')
        .map((t) => ({
        title: t.title,
        pagePath: typeof state.handoffs.get(t.id)?.metadata?.page_path === 'string'
            ? state.handoffs.get(t.id).metadata.page_path
            : null,
    }))
        .filter((p) => p.pagePath !== null && p.pagePath.startsWith('projects/'));
    if (pages.length === 0)
        return;
    // 1) 清单页：登记全部 W2/W3 页链接
    if (checklistPath) {
        const cur = await tryRead(wiki, checklistPath);
        if (cur !== null) {
            const lines = pages.map((p) => linkLine(p.title, p.pagePath));
            await tryWrite(wiki, checklistPath, upsertLinkedBlock(cur, '需求完整链路', lines));
        }
    }
    // 2) 每个 W2/W3 页：写回清单页链接
    if (checklistPath) {
        for (const p of pages) {
            const cur = await tryRead(wiki, p.pagePath);
            if (cur === null)
                continue;
            const line = linkLine('需求清单', checklistPath);
            if (containsLine(cur, line))
                continue;
            await tryWrite(wiki, p.pagePath, upsertLinkedBlock(cur, '需求清单', [line]));
        }
    }
}
