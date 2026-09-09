import { describe, it, expect, vi } from 'vitest';
import { installRoleTools, buildReadOnlyWriteGuard, buildDTWriteGuard, buildPlanWriteGuard, isReviewNamespacePath, buildSubagentTreeGuard, registerDtTaskChain, unregisterDtTaskChain, buildKbWriteGuard } from '../../src/roles/toolsets.js';

async function registeredFor(role: 'v' | 'p' | 'w' | 'd' | 'pt' | 'dt') {
  const names: string[] = [];
  const ctx = { tools: { register: vi.fn((def: { name?: string }) => { names.push(def.name ?? ''); }) } };
  await installRoleTools(ctx as never, role, { kanban: {} as never, wiki: {} as never });
  return names;
}

describe('role tool surfaces (design §3 工具面隔离)', () => {
  it('V: orchestration + complete/block/heartbeat + spec view; no write tools', async () => {
    const names = await registeredFor('v');
    expect(names).toEqual(expect.arrayContaining([
      'kanban_create', 'kanban_complete', 'kanban_block', 'kanban_heartbeat',
      'kanban_comment', 'kanban_show', 'kanban_list', 'spec_card_view',
    ]));
    // kanban_link/chain_show 在 src/tools/kanban-tools.ts 未实现 → 保持不注册（差异见 toolsets.ts 注释）
    expect(names).not.toContain('kanban_link');
    expect(names).not.toContain('chain_show');
    expect(names).not.toContain('wiki_write');
    expect(names).not.toContain('spec_card_edit');
    expect(names).not.toContain('spec_card_approve');
  });
  it('W: task tools + spec view + wiki + prefetch', async () => {
    const names = await registeredFor('w');
    expect(names).toEqual(expect.arrayContaining([
      'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'spec_card_view',
      'wiki_search', 'wiki_read', 'wiki_write', 'prefetch_file', 'prefetch_external', 'prefetch_kb',
    ]));
    expect(names).not.toContain('kanban_create');
  });
  it('D: read-only KB (search+read) + spec view; no wiki_write/create', async () => {
    const names = await registeredFor('d');
    expect(names).toEqual(expect.arrayContaining([
      'wiki_search', 'wiki_read', 'spec_card_view', 'kanban_complete', 'kanban_block', 'kanban_heartbeat',
    ]));
    expect(names).not.toContain('wiki_write');
    expect(names).not.toContain('kanban_create');
  });
  it('P: task tools + spec view; no create/wiki', async () => {
    const names = await registeredFor('p');
    expect(names).toEqual(expect.arrayContaining([
      'spec_card_view', 'kanban_complete', 'kanban_block', 'kanban_heartbeat',
    ]));
    expect(names).not.toContain('kanban_create');
    expect(names).not.toContain('wiki_write');
    expect(names).not.toContain('wiki_search');
  });
  it('PT: task tools + spec view; no create/wiki/exec', async () => {
    const names = await registeredFor('pt');
    expect(names).toEqual(expect.arrayContaining([
      'spec_card_view', 'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment', 'kanban_show', 'kanban_list',
    ]));
    expect(names).not.toContain('kanban_create');
    expect(names).not.toContain('wiki_write');
    expect(names).not.toContain('wiki_search');
    expect(names).not.toContain('run_code');
  });
  it('PT ToolGuard denies source writes, allows read commands', async () => {
    const repo = '/ws/repo';
    const guard = buildReadOnlyWriteGuard(repo);
    // tracked source 写 → 拒绝
    expect(guard({ name: 'write', arguments: { path: repo + '/src/a.ts', content: 'x' } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(guard({ name: 'edit', arguments: { file_path: repo + '/README.md' } } as never)).toMatch(/write-to-repo-source-denied/);
    // git mutation → 拒绝
    expect(guard({ name: 'bash', arguments: { command: 'cd ' + repo + ' && git apply p.diff' } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(guard({ name: 'bash', arguments: { command: 'git -C ' + repo + ' push' } } as never)).toMatch(/write-to-repo-source-denied/);
    // 含写标记且指向 repo → 拒绝
    expect(guard({ name: 'bash', arguments: { command: 'touch ' + repo + '/a.txt' } } as never)).toMatch(/write-to-repo-source-denied/);
    // 只读命令 → 放行（undefined）
    expect(guard({ name: 'bash', arguments: { command: 'git -C ' + repo + ' show HEAD' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'cat ' + repo + '/src/a.ts' } } as never)).toBeUndefined();
    expect(guard({ name: 'read', arguments: { path: repo + '/src/a.ts' } } as never)).toBeUndefined();
  });
  it('DT: task tools + spec view + KB read/write (review namespace) + ocr_review; no create', async () => {
    const names = await registeredFor('dt');
    expect(names).toEqual(expect.arrayContaining([
      'wiki_read', 'wiki_search', 'wiki_write', 'spec_card_view', 'ocr_review',
      'kanban_complete', 'kanban_block', 'kanban_heartbeat', 'kanban_comment', 'kanban_show', 'kanban_list',
    ]));
    expect(names).not.toContain('kanban_create');
  });
  it('DT wiki_write only allows projects/<repoSlug>/<chain>/review namespace', () => {
    expect(isReviewNamespacePath('projects/ws/ch_1/review/dt_1.md', 'ch_1')).toBe(true);
    expect(isReviewNamespacePath('projects/ws/ch_1/review/dt_1', 'ch_1')).toBe(true);
    expect(isReviewNamespacePath('projects/ws/ch_1/other.md', 'ch_1')).toBe(false); // 普通 projects 路径拒绝
    expect(isReviewNamespacePath('projects/ws/other_chain/review/x.md', 'ch_1')).toBe(false); // 跨链拒绝
    expect(isReviewNamespacePath('projects/ch_1/review/dt_1.md', 'ch_1')).toBe(false); // 旧格式（无 repoSlug 段）断代
    expect(isReviewNamespacePath('../etc/passwd', 'ch_1')).toBe(false); // 相对路径穿越拒绝
    expect(isReviewNamespacePath('/etc/passwd', 'ch_1')).toBe(false); // 绝对系统路径拒绝
  });
  it('DT ToolGuard denies source writes and allows verification commands', async () => {
    const repo = '/ws/repo';
    const guard = buildDTWriteGuard(repo, 'ch_1');
    // 写源码 → 拒绝
    expect(guard({ name: 'write', arguments: { path: repo + '/src/a.ts', content: 'x' } } as never)).toMatch(/write-to-repo-source-denied/);
    // run_code 子调用写源码（code 含写标记 + repo 路径）→ 拒绝
    expect(guard({ name: 'run_code', arguments: { code: 'fs.writeFileSync("' + repo + '/src/a.ts", "x")' } } as never)).toMatch(/write-to-repo-source-denied/);
    // git mutation → 拒绝
    expect(guard({ name: 'bash', arguments: { command: 'git -C ' + repo + ' commit -m x' } } as never)).toMatch(/write-to-repo-source-denied/);
    // wiki_write 越出 review namespace → 拒绝
    expect(guard({ name: 'wiki_write', arguments: { pagePath: 'projects/ws/ch_1/other.md', content: 'x' } } as never)).toMatch(/wiki-write-outside-review-namespace/);
    // wiki_write 在 review namespace → 放行
    expect(guard({ name: 'wiki_write', arguments: { pagePath: 'projects/ws/ch_1/review/dt_1.md', content: 'x' } } as never)).toBeUndefined();
    // 验证命令（无写标记）→ 放行
    expect(guard({ name: 'bash', arguments: { command: 'cd ' + repo + ' && npm test' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'cd ' + repo + ' && tsc --noEmit' } } as never)).toBeUndefined();
  });
});
describe('buildPlanWriteGuard（P 写护栏，Q3：禁改动源码为工具级硬约束）', () => {
  const guard = buildPlanWriteGuard('/ws/main');
  const planFile = '/ws/main/openspec/changes/autoNote-tab/design.md';
  it('读任意路径放行（含跨目录 /tmp）', () => {
    expect(guard({ name: 'read', arguments: { path: '/tmp/plan.md' } } as never)).toBeUndefined();
  });
  it('直接写工具写 openspec/changes/** 放行（write 的 path / edit 的 file_path 均解析）', () => {
    expect(guard({ name: 'write', arguments: { path: planFile } } as never)).toBeUndefined();
    expect(guard({ name: 'edit', arguments: { file_path: planFile } } as never)).toBeUndefined();
  });
  it('Fix: write/edit 附带 sandbox_permissions 即拒（自解释文案），与目标路径无关', () => {
    // 复现 2026-09-02 P 会话 30 连败：danger-full-access 天花板会话带该参数必被官方沙箱拒
    const denied = guard({ name: 'write', arguments: { file_path: planFile, content: 'x', sandbox_permissions: 'danger-full-access' } } as never);
    expect(denied).toContain('sandbox_permissions');
    expect(denied).toContain('danger-full-access');
    expect(denied).toContain('file_path');
    expect(guard({ name: 'edit', arguments: { file_path: planFile, sandbox_permissions: 'workspace-write' } } as never)).toContain('sandbox_permissions');
  });
  it('Fix: 裸 write（file_path+content，不带 sandbox_permissions）写 openspec/changes/** 放行', () => {
    expect(guard({ name: 'write', arguments: { file_path: planFile, content: 'x' } } as never)).toBeUndefined();
  });
  it('直接写工具写源码拒绝（禁改动源码硬性）', () => {
    expect(guard({ name: 'write', arguments: { path: '/ws/main/src/foo.ts' } } as never)).toContain('openspec/changes');
    expect(guard({ name: 'edit', arguments: { file_path: '/ws/main/src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('bash 写命令含 openspec/changes 子串放行（相对路径也命中）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'cat > openspec/changes/autoNote-tab/tasks.md' } } as never)).toBeUndefined();
  });
  it('bash 写源码拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x >> src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('git mutation 一律拒绝（含 git -C 形态）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git commit -m x' } } as never)).toContain('git');
    expect(guard({ name: 'bash', arguments: { command: 'cd /ws/main && git push origin main' } } as never)).toContain('git');
  });
  it('git 只读命令放行（status/log/show 不被 GIT_WRITE_RE 拒）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'git -C /ws/main log --oneline -5' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'git show HEAD' } } as never)).toBeUndefined();
  });
  it('W 用只读护栏：一切 fs 写拒绝（含 openspec/changes 内）', () => {
    const wg = buildReadOnlyWriteGuard('/ws/main');
    expect(wg({ name: 'write', arguments: { path: planFile } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  // ── Fix round 1/5：对抗性回归（M1-M4 绕过向量 + m1/m2 回归）────────────────
  it('B1: .. 路径穿越写拒绝（write file_path 解析后落源码）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/openspec/changes/../../src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('B2: 前缀边界逃逸拒绝（/ws/main2 兄弟仓库 openspec/changes）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main2/openspec/changes/evil.md' } } as never)).toContain('openspec/changes');
  });
  it('B3: bash 无空格重定向写拒绝（echo x>f 绕过 \\s>>?）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x>src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('B4: node -e 解释器文件写 API 拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: "node -e require('fs').writeFileSync('/ws/main/src/foo.ts','x')" } } as never)).toContain('openspec/changes');
  });
  it('B5: python -c 解释器文件写 API 拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: "python -c open('/ws/main/src/foo.ts','w').write('x')" } } as never)).toContain('openspec/changes');
  });
  it('B6: git checkout（非只读动词）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git checkout -- src/foo.ts' } } as never)).toContain('git');
  });
  it('B7: git branch（非只读动词）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git branch fix/x' } } as never)).toContain('git');
  });
  it('B8: sed -i 原地编辑写源码拒绝（sed -i 直改文件，无重定向仍识别）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'sed -i "s/a/b/" src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('B9: perl -i 原地编辑写源码拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'perl -i -pe "s/a/b/" src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('B10: awk -i inplace 原地编辑写源码拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'awk -i inplace "..." src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('B11: sed -i 原地编辑 openspec/changes 内 plan 文件放行（plan 标记 + 目标校验）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'sed -i "s/a/b/" openspec/changes/x/proposal.md' } } as never)).toBeUndefined();
  });
  it('B12 regression: run_code python open() 写源码仍拒绝（不改源码硬约束不回归）', () => {
    expect(guard({ name: 'run_code', arguments: { code: "open('src/foo.ts','w').write('x')" } } as never)).toContain('openspec/changes');
  });
  it('m1 regression: 写内容含 git 文本但路径合法 plan 路径 → 放行（git 判定仅命令文本，不扫内容）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/openspec/changes/x/tasks.md', content: 'run git commit then push' } } as never)).toBeUndefined();
  });
  it('m2 regression: 相对 openspec/changes 路径经 write 工具放行', () => {
    expect(guard({ name: 'write', arguments: { file_path: 'openspec/changes/x/design.md' } } as never)).toBeUndefined();
  });
  // ── Fix round 2/5：git 分段判定 + 全局选项 fail-closed + fd2 豁免收窄 + POSIX 反斜杠 ──
  it('R2-F1: git 链式命令分段判定（&& 分隔：git status 打头后跟 git commit）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status && git commit -m x' } } as never)).toContain('git');
  });
  it('R2-F2: git 链式命令分段判定（; 分隔：git log 后跟 git checkout）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git log; git checkout -- src/foo.ts' } } as never)).toContain('git');
  });
  it('R2-F3: git 链式命令分段判定（| 分隔：git status 后跟 git push）拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status | git push origin main' } } as never)).toContain('git');
  });
  it('R2-F4: git 全局选项前缀 fall-through 拒绝（--no-pager）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git --no-pager checkout -- src/foo.ts' } } as never)).toContain('git');
  });
  it('R2-F5: git 全局选项前缀 fall-through 拒绝（-c key=value）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git -c core.hooksPath=/x checkout -- src/foo.ts' } } as never)).toContain('git');
  });
  it('R2-F6: 显式 fd1 stdout 重定向（1> 等价 >）写源码拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo PAYLOAD 1>src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('R2-F7: POSIX 反斜杠目录名不归一化（src/openspec\\changes 非相邻段）→ 拒绝', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/src/openspec\\changes/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('R2-A1: stderr 重定向 2> 豁免（只读，不写源码）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x 2>/dev/null' } } as never)).toBeUndefined();
  });
  it('R2-A2: git 只读 + 良性 echo 放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status && echo ok' } } as never)).toBeUndefined();
  });
  it('R2-A3: git 只读 + 全局选项放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git --no-pager status' } } as never)).toBeUndefined();
  });
  it('R2-A4: 写内容含 git 文本但路径合法 plan 路径 → 放行（git 判定仅命令文本）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/openspec/changes/x/design.md', content: 'run git commit then push' } } as never)).toBeUndefined();
  });
  it('跨目录读仍放行（read /tmp/x）', () => {
    expect(guard({ name: 'read', arguments: { path: '/tmp/x' } } as never)).toBeUndefined();
  });
  // ── Fix round 3/5：I1 bash/run_code 写目标 resolve 判定 + M3 fd2 lookbehind ──
  it('I1: bash 重定向目标 .. 穿越写源码拒绝（相对 openspec/changes）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x > openspec/changes/../../src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('I1: bash 重定向目标 .. 穿越写源码拒绝（绝对 openspec/changes）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x > /ws/main/openspec/changes/../../src/foo.ts' } } as never)).toContain('openspec/changes');
  });
  it('I1: node -e 写 API .. 穿越拒绝（含 plan 子串仍解析目标）', () => {
    expect(guard({ name: 'bash', arguments: { command: "node -e \"fs.writeFileSync('openspec/changes/../../src/foo.ts','x')\"" } } as never)).toContain('openspec/changes');
  });
  it('I1: run_code 写 API .. 穿越拒绝（CODE_WRITE_RE 命中）', () => {
    expect(guard({ name: 'run_code', arguments: { code: "fs.writeFileSync('openspec/changes/../../src/foo.ts','x')" } } as never)).toContain('openspec/changes');
  });
  it('I1 regression: cat > plan 相对路径放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'cat > openspec/changes/x/design.md' } } as never)).toBeUndefined();
  });
  it('I1 regression: echo x > plan tasks.md 放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x > openspec/changes/x/tasks.md' } } as never)).toBeUndefined();
  });
  it('I1 regression: fd2 重定向 echo x 2>/dev/null 放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x 2>/dev/null' } } as never)).toBeUndefined();
  });
  it('I1 regression: git status 放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git status' } } as never)).toBeUndefined();
  });
  it('M3: 2>> 双 fd2 重定向不误判写意图（echo x 2>>err.log）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x 2>>err.log' } } as never)).toBeUndefined();
  });
  // ── Fix round 2/5：F3 引号包裹重定向目标剥壳后 resolve 命中（I1 误伤修复）──
  it('F3: 引号包裹的 plan 路径写放行（剥首尾引号后 resolve 命中）', () => {
    expect(guard({ name: 'bash', arguments: { command: "echo x > 'openspec/changes/x/design.md'" } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: 'echo x > "openspec/changes/x/design.md"' } } as never)).toBeUndefined();
    expect(guard({ name: 'bash', arguments: { command: "echo x >> 'openspec/changes/x/tasks.md'" } } as never)).toBeUndefined();
  });
  it('F3: 引号包裹的源码路径写拒绝（剥壳后仍落源码）', () => {
    expect(guard({ name: 'bash', arguments: { command: "echo x > 'src/foo.ts'" } } as never)).toContain('openspec/changes');
    expect(guard({ name: 'bash', arguments: { command: "echo x > '../src/foo.ts'" } } as never)).toContain('openspec/changes');
  });
  // ── Task 1（planguard-falsepositive）：run_code 运算符 > 不再误判为重定向写意图 ──
  it('FP1: run_code 箭头函数 => 的 openspec 裸 edit 放行（无空格 > 是运算符非重定向）', () => {
    const code = "const names = list.filter(x => x.active).map(x => x.name);\nedit('openspec/changes/x/design.md')";
    expect(guard({ name: 'run_code', arguments: { code } } as never)).toBeUndefined();
  });
  it('FP2: run_code 比较运算符 remaining>0 的 openspec 裸 edit 放行（旧版提取 "0" 当写目标误拒）', () => {
    const code = "if (remaining>0) retry();\nedit('openspec/changes/x/tasks.md')";
    expect(guard({ name: 'run_code', arguments: { code } } as never)).toBeUndefined();
  });
  it('FP3: run_code 泛比较 a>b 的 openspec 裸 edit 放行', () => {
    const code = "const max = a>b ? a : b;\nedit('openspec/changes/x/design.md')";
    expect(guard({ name: 'run_code', arguments: { code } } as never)).toBeUndefined();
  });
  it('FP-reg1: run_code writeFileSync/appendFileSync 写源码仍拒绝（CODE_WRITE_RE 不回归）', () => {
    expect(guard({ name: 'run_code', arguments: { code: "fs.writeFileSync('src/foo.ts','x')" } } as never)).toContain('openspec/changes');
    expect(guard({ name: 'run_code', arguments: { code: "fs.appendFileSync('src/foo.ts','x')" } } as never)).toContain('openspec/changes');
  });
  it('FP-reg2: run_code 内嵌 shell 带空格重定向仍拒绝（echo x > /tmp/f）', () => {
    expect(guard({ name: 'run_code', arguments: { code: 'require("child_process").exec("echo x > /tmp/f")' } } as never)).toContain('openspec/changes');
  });
  it('FP-reg3: bash 无空格重定向写仍拒绝（>f 是 bash 合法写，bash 分支不动）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x>f' } } as never)).toContain('openspec/changes');
  });
  it('FP-reg4: bash 2>/dev/null 只读重定向放行（fd2 豁免不回归）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x 2>/dev/null' } } as never)).toBeUndefined();
  });
  it('FP-reg5: git add 仍拒绝（git 文案）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'git add src/foo.ts' } } as never)).toContain('git');
  });
  it('FP-reg6: openspec 裸 write 放行（allow 标记语义不回归）', () => {
    expect(guard({ name: 'write', arguments: { file_path: '/ws/main/openspec/changes/x/design.md', content: 'x' } } as never)).toBeUndefined();
  });
  // ── Fix round 1（planguard-falsepositive 续）：run_code 裸 shell 动词补齐（评审 Important）──
  it('FP-bypass: run_code child_process exec cp/mv 写 src/ 拒绝（裸 shell 动词不再绕过 P 写护栏）', () => {
    expect(guard({ name: 'run_code', arguments: { code: 'require("child_process").exec("cp /tmp/x src/foo.ts")' } } as never)).toContain('openspec/changes');
    expect(guard({ name: 'run_code', arguments: { code: 'require("child_process").exec("mv /tmp/x src/foo.ts")' } } as never)).toContain('openspec/changes');
  });
  it('FP-reg7: run_code 带空格 >> 追加重定向仍拒绝（CODE_REDIRECT_WRITE_RE 不回归）', () => {
    expect(guard({ name: 'run_code', arguments: { code: 'require("child_process").exec("echo x >> src/foo.ts")' } } as never)).toContain('openspec/changes');
  });
  it('FP-reg8: run_code 含 git add 仍拒绝（git 文案）', () => {
    expect(guard({ name: 'run_code', arguments: { code: 'require("child_process").exec("git add -A")' } } as never)).toContain('git');
  });
});

describe('buildReadOnlyWriteGuard（I2：全名拦截——repo 外/workspace 内写一律拒）', () => {
  const wg = buildReadOnlyWriteGuard('/ws/main');
  it('I2: 直接写工具 repo 外路径拒绝（write file_path=/tmp/x）', () => {
    expect(wg({ name: 'write', arguments: { file_path: '/tmp/x', content: 'x' } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('I2: 直接写工具 repo 内源码拒绝（write file_path=<repo>/src/foo.ts）', () => {
    expect(wg({ name: 'write', arguments: { file_path: '/ws/main/src/foo.ts', content: 'x' } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('I2: bash 写标记 repo 外目标拒绝（echo x > /tmp/x）', () => {
    expect(wg({ name: 'bash', arguments: { command: 'echo x > /tmp/x' } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('I2: bash 写标记 repo 内目标拒绝（echo x > <repo>/src/foo.ts）', () => {
    expect(wg({ name: 'bash', arguments: { command: 'echo x > /ws/main/src/foo.ts' } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('I2: run_code 写 API 拒绝（无 repo 子串）', () => {
    expect(wg({ name: 'run_code', arguments: { code: "fs.writeFileSync('/tmp/x','x')" } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('I2: 只读命令仍放行（cat / git show）', () => {
    expect(wg({ name: 'bash', arguments: { command: 'cat /tmp/a.ts' } } as never)).toBeUndefined();
    expect(wg({ name: 'bash', arguments: { command: 'git -C /ws/main show HEAD' } } as never)).toBeUndefined();
  });
  // ── Fix round 2/5：F2 DT run_code Python 写 API 全覆盖（fail-closed）──
  it('F2: run_code Python open() 写模式拒绝（open(path,"w")/open(path,"a")/open(path,"w+")）', () => {
    expect(wg({ name: 'run_code', arguments: { code: "open('src/foo.ts','w').write('x')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "open('src/foo.ts','a')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "open('src/foo.ts','w+')" } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('F2: run_code os 模块写 API 拒绝（remove/unlink/rename/write/rmdir/makedirs）', () => {
    expect(wg({ name: 'run_code', arguments: { code: "import os; os.remove('src/x')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "os.unlink('src/x')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "os.rename('src/a','src/b')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "os.makedirs('src/sub', exist_ok=True)" } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('F2: run_code pathlib Path 写 API 拒绝（write_text/write_bytes/unlink/mkdir/rename）', () => {
    expect(wg({ name: 'run_code', arguments: { code: "Path('src/foo.ts').write_text('x')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "Path('src/foo.ts').write_bytes(b'x')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "Path('src/x').unlink()" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "Path('src/sub').mkdir(parents=True)" } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('F2: run_code shutil 写 API 拒绝（copy/move/rmtree）', () => {
    expect(wg({ name: 'run_code', arguments: { code: "shutil.rmtree('src')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "shutil.copy('a.txt','b.txt')" } } as never)).toMatch(/write-to-repo-source-denied/);
    expect(wg({ name: 'run_code', arguments: { code: "shutil.move('a','b')" } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('F2: run_code Python 只读操作放行（open r / read_text / listdir）', () => {
    expect(wg({ name: 'run_code', arguments: { code: "open('x','r').read()" } } as never)).toBeUndefined();
    expect(wg({ name: 'run_code', arguments: { code: "Path('x').read_text()" } } as never)).toBeUndefined();
    expect(wg({ name: 'run_code', arguments: { code: "os.listdir('src')" } } as never)).toBeUndefined();
  });
  // ── Task 1（planguard-falsepositive）：run_code 无空格 > 运算符误判修复（W/PT/DT 只读护栏同源）──
  it('FP: run_code JS 运算符 >（=>、比较）不再误判写意图', () => {
    expect(wg({ name: 'run_code', arguments: { code: 'const f=(x)=>x>1; return list.filter(v=>v.ok);' } } as never)).toBeUndefined();
  });
  it('FP-reg: run_code 内嵌 shell 带空格重定向仍拒绝（echo x > /tmp/f）', () => {
    expect(wg({ name: 'run_code', arguments: { code: 'require("child_process").execSync("echo x > /tmp/f")' } } as never)).toMatch(/write-to-repo-source-denied/);
  });
  it('FP-bypass: run_code exec cp 写源码拒绝（裸 shell 动词同源补齐，W/PT/DT 只读护栏）', () => {
    expect(wg({ name: 'run_code', arguments: { code: 'require("child_process").execSync("cp /tmp/x src/foo.ts")' } } as never)).toMatch(/write-to-repo-source-denied/);
  });
});
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { AgentRunner } from '../../src/dispatcher/agent-runner.js';
import type { WikiVaultClient } from '../../src/wiki/wiki-vault-client.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface PresetRow { id?: string; name?: string; disabled?: boolean }

/** 读取包内裁剪组合文件（D22：随包分发 personas/<preset-id>/agent.cordis.yml）。 */
function loadComposition(presetId: string): PresetRow[] {
  const filePath = join(REPO_ROOT, 'personas', presetId, 'agent.cordis.yml');
  expect(existsSync(filePath), 'missing composition: ' + filePath).toBe(true);
  // 用真实 loader 方言解析（entryListSchema 处理 !!js 标量），与 agent-presets 加载语义一致
  const parsed = load(readFileSync(filePath, 'utf8'), { schema: entryListSchema }) as unknown;
  if (!Array.isArray(parsed)) throw new Error('composition must be a list of rows: ' + presetId);
  return parsed as PresetRow[];
}

const rowIds = (rows: PresetRow[]): string[] => rows.map((r) => r.id).filter((x): x is string => Boolean(x));

describe('role preset trimming (D22: per-role minimal capability, no full code preset)', () => {
  // P 禁用的基座能力（对应设计 §4 裁剪列）；W 自双模式（D8）起保留 skill-filesystem/tool-skill
  // （local KB 模式经 skill 工具自治查写 llm-wiki）；W 自 2026-09-09 起开放 tool-web
  // （web_search/web_fetch 联网收集外部事实供 prefetch_external 落盘），其余裁剪与 P 一致。
  const P_BANNED = [
    'tool-presentation', // run_code
    'tool-jobs',
    'skill-filesystem',
    'tool-skill',
    'tool-goal',
    'planning',
    'compaction',
    'delegation', // subagent/fork/workflow/ralph
    'tool-ask-user',
    'tool-todo',
    'tool-web',
  ];
  const W_BANNED = P_BANNED.filter((id) => id !== 'skill-filesystem' && id !== 'tool-skill' && id !== 'tool-web');
  it('kanban-p: keeps persona/instructions/bash/fs/fs-search; no run_code/jobs/skill/goal/plan/compaction/delegation/web/todo/ask-user', () => {
    const list = rowIds(loadComposition('kanban-p'));
    expect(list).toEqual(expect.arrayContaining(['persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search']));
    for (const banned of P_BANNED) expect(list, 'kanban-p must not contain ' + banned).not.toContain(banned);
    // 明确断言无 delegation 子行（subagent / workflow / ralph）
    expect(list.some((id) => id.startsWith('tool-subagent') || id === 'tool-workflow' || id === 'tool-ralph')).toBe(false);
  });
  it('kanban-w: keeps persona/instructions/bash/fs/fs-search; same trim as P except skill (dual-mode D8) and tool-web (2026-09-09 联网收集)', () => {
    const list = rowIds(loadComposition('kanban-w'));
    expect(list).toEqual(expect.arrayContaining(['persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search', 'tool-skill', 'tool-web']));
    for (const banned of W_BANNED) expect(list, 'kanban-w must not contain ' + banned).not.toContain(banned);
    expect(list.some((id) => id.startsWith('tool-subagent') || id === 'tool-workflow' || id === 'tool-ralph')).toBe(false);
  });
  it('kanban-v (R21 butler·orchestrator): persona/instructions ONLY — zero execution/exploration tools', () => {
    const list = rowIds(loadComposition('kanban-v'));
    expect(list).toEqual(expect.arrayContaining(['persona', 'agent-instructions']));
    // 零执行能力（R21：V disabled browser/file/web/search/delegation/code_execution；只路由）
    for (const banned of ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-presentation', 'tool-jobs', 'skill-filesystem', 'tool-skill', 'tool-goal', 'planning', 'compaction', 'delegation', 'tool-ask-user', 'tool-todo', 'tool-web']) {
      expect(list, 'kanban-v must not contain ' + banned).not.toContain(banned);
    }
    expect(list.some((id) => id.startsWith('tool-subagent') || id === 'tool-workflow' || id === 'tool-ralph')).toBe(false);
  });
  it('kanban-d: keeps full dev set + delegation(spawn/fork/control/list-agents) + goal; no workflow/ralph/plan-mode/web', () => {
    const list = rowIds(loadComposition('kanban-d'));
    expect(list).toEqual(expect.arrayContaining([
      'persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search',
      'tool-jobs', 'skill-filesystem', 'tool-skill', 'tool-todo', 'tool-ask-user', 'tool-presentation',
      // 0.1.0 delegation：D 可派单（子代理继承 D 权限，产物归 D feature 分支）+ goal（条件启用）
      'tool-subagent', 'tool-subagent-fork', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-goal',
    ]));
    for (const banned of ['planning', 'tool-web', 'tool-workflow', 'tool-ralph']) {
      expect(list, 'kanban-d must not contain ' + banned).not.toContain(banned);
    }
  });
  it('kanban-d tool-presentation mode is both (B1: 直接 bash/kanban_* 可调用 + run_code 可用)', () => {
    const rows = loadComposition('kanban-d');
    const pres = rows.find((r) => r.id === 'tool-presentation');
    expect(pres).toBeTruthy();
    // code 模式会令注册表把直接调用 bash/kanban_* 解析为 UNKNOWN_TOOL（仅 run_code 可直呼）；
    // native 又隐藏 run_code。both = 原生工具 schema + run_code 并存——D 执行者工具面。
    expect((pres as { config?: { mode?: string } }).config?.mode).toBe('both');
  });
  it('kanban-dt: spawn-only delegation (parallel read-only review); no fork/control/goal/workflow/ralph', () => {
    const list = rowIds(loadComposition('kanban-dt'));
    expect(list).toEqual(expect.arrayContaining(['persona', 'agent-instructions', 'tool-bash', 'tool-fs', 'tool-fs-search', 'tool-presentation', 'tool-subagent']));
    for (const banned of ['tool-subagent-fork', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-goal', 'tool-workflow', 'tool-ralph', 'planning', 'tool-web']) {
      expect(list, 'kanban-dt must not contain ' + banned).not.toContain(banned);
    }
  });
  it('agent-runner mounts kanban-<role> trimmed preset (not full code) for p/w/d', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-preset-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's', workspaceDir: '/ws/main' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: '', out_of_scope: '' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'p1', assignee: 'p', mode: 'openspec' }, 'v');
      const mounts: string[] = [];
      const fakePresets = { mount: async (_ctx: unknown, id?: string) => { mounts.push(id ?? ''); } };
      let capturedSetup: unknown = null;
      const agents = {
        create: async (o: { setup?: unknown }) => {
          capturedSetup = o.setup;
          return { agent: { followup: vi.fn(), whenIdle: vi.fn(async () => {}), session: { events: [{ type: 'tool-call', name: 'kanban_complete' }] } } };
        },
      };
      const ctx = { get: (n: string) => (n === 'agents' ? agents : n === 'agentPresets' ? fakePresets : undefined) };
      const runner = new AgentRunner(ctx as never, svc, { getEffective: () => ({}) } as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const setup = capturedSetup as (agentCtx: unknown) => Promise<void>;
      const agentCtx = {
        get: (n: string) => (n === 'agentPresets' ? fakePresets : undefined),
        agent: { session: { append: vi.fn() } },
        on: () => () => {}, // setup 注册 agent/request waterfall（强制思考等级）需要 on
      };
      await setup(agentCtx);
      expect(mounts).toEqual(['kanban-p']);
      expect(mounts).not.toContain('code');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
import { installRolePresets, userPresetsRoot } from '../../src/roles/preset-installer.js';

describe('role preset installer (D22: runtime write to $DSH_HOME/.agent-presets)', () => {
  it('installs kanban-v/p/w/d/pt/dt composition files under $DSH_HOME/.agent-presets (idempotent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    const prev = process.env.DSH_HOME;
    try {
      process.env.DSH_HOME = dir;
      const installed = installRolePresets();
      expect(installed.sort()).toEqual(['kanban-d', 'kanban-dt', 'kanban-p', 'kanban-pt', 'kanban-v', 'kanban-w', 'swarm']);
      for (const id of ['kanban-v', 'kanban-p', 'kanban-w', 'kanban-d', 'kanban-pt', 'kanban-dt', 'swarm']) {
        const comp = join(userPresetsRoot(), id, 'agent.cordis.yml');
        expect(existsSync(comp), 'missing ' + comp).toBe(true);
        const list = rowIds(loadComposition(id)); // 复用真实 loader 方言解析已安装副本
        expect(list.length).toBeGreaterThan(0);
      }
      // 幂等：再次安装不报错、文件仍存在
      const again = installRolePresets();
      expect(again.sort()).toEqual(['kanban-d', 'kanban-dt', 'kanban-p', 'kanban-pt', 'kanban-v', 'kanban-w', 'swarm']);
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('subagent tree guard (0.1.0 delegation: DT 子代理强制只读，D 系放行)', () => {
  const dtHeader = { cwd: '/ws/repo', parentSession: 'kbn-t_dtx', agentPreset: 'kanban-dt' };
  const dHeader = { cwd: '/ws/repo', parentSession: 'kbn-t_dx', agentPreset: 'kanban-d' };
  const mainSubHeader = { cwd: '/ws/repo', parentSession: 'user-main-session' };
  const exec = (name: string, args: unknown, header: Record<string, unknown> | undefined) =>
    ({ name, arguments: args, agent: header ? { session: { header } } : undefined }) as never;
  const guard = buildSubagentTreeGuard();

  it('DT subagent: direct write tool targeting repo → denied', () => {
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, dtHeader))).toMatch(/write-to-repo-source-denied/);
  });
  it('DT subagent: bash write marker targeting repo → denied', () => {
    expect(guard(exec('bash', { command: 'touch /ws/repo/a.txt' }, dtHeader))).toMatch(/write-to-repo-source-denied/);
  });
  it('DT subagent: run_code write marker → denied', () => {
    expect(guard(exec('run_code', { code: 'fs.writeFileSync("/ws/repo/src/a.ts","x")' }, dtHeader))).toMatch(/write-to-repo-source-denied/);
  });
  it('DT subagent: wiki_write resolved via chainId cache (registerDtTaskChain)', () => {
    registerDtTaskChain('t_dtx', 'ch_9');
    try {
      expect(guard(exec('wiki_write', { pagePath: 'projects/ws/ch_9/review/dt_1.md' }, dtHeader))).toBeUndefined();
      expect(guard(exec('wiki_write', { pagePath: 'projects/ws/ch_9/other.md' }, dtHeader))).toMatch(/wiki-write-outside-review-namespace/);
    } finally { unregisterDtTaskChain('t_dtx'); }
  });
  it('DT subagent: chainId unresolved → wiki_write fail-closed (deny all)', () => {
    expect(guard(exec('wiki_write', { pagePath: 'projects/ws/ch_9/review/dt_1.md' }, dtHeader))).toMatch(/wiki-write-outside-review-namespace/);
  });
  it('D subagent: same writes → allowed (inherits D permission — RED LINE)', () => {
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, dHeader))).toBeUndefined();
    expect(guard(exec('bash', { command: 'touch /ws/repo/a.txt' }, dHeader))).toBeUndefined();
    expect(guard(exec('run_code', { code: 'fs.writeFileSync("/ws/repo/src/a.ts","x")' }, dHeader))).toBeUndefined();
  });
  it('main-session subagent / no preset mark / headerless execution → untouched (fail-open)', () => {
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, mainSubHeader))).toBeUndefined();
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, undefined))).toBeUndefined();
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, { cwd: '/ws/repo' }))).toBeUndefined();
  });
  it('getTaskChainId dep overrides module cache', () => {
    const g2 = buildSubagentTreeGuard({ getTaskChainId: () => 'ch_dep' });
    expect(g2(exec('wiki_write', { pagePath: 'projects/ws/ch_dep/review/x.md' }, dtHeader))).toBeUndefined();
  });
  it('DT parent-session (无 parentSession / 非 kbn- 前缀 parent) → 全局护栏不拦截 (pass-through，只读由 agent.ctx guard 兜底)', () => {
    // DT 父会话自身：parentSession 缺失或非 kbn- 前缀（如主会话直接派生），chainId 解析不到，
    // 全局护栏应放行（undefined）；其只读由 agent.ctx guard 保证，误拦会拒掉 DT 评审写入。
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, { cwd: '/ws/repo', agentPreset: 'kanban-dt' }))).toBeUndefined();
    expect(guard(exec('wiki_write', { pagePath: 'projects/ws/ch_9/review/dt_1.md' }, { cwd: '/ws/repo', agentPreset: 'kanban-dt' }))).toBeUndefined();
    expect(guard(exec('edit', { file_path: '/ws/repo/src/a.ts' }, { cwd: '/ws/repo', parentSession: 'user-main-session', agentPreset: 'kanban-dt' }))).toBeUndefined();
  });
});

// ── Task 5（W 角色知识库双模式）：installRoleTools 按 kbMode 裁剪 W/D/DT wiki 工具 ──
async function registeredForWith(role: 'v' | 'p' | 'w' | 'd' | 'pt' | 'dt', opts: { kbMode: 'remote' | 'local' }) {
  const names: string[] = [];
  const ctx = { tools: { register: vi.fn((def: { name?: string }) => { names.push(def.name ?? ''); }) } };
  await installRoleTools(ctx as never, role, { kanban: {} as never, wiki: {} as never, kbMode: opts.kbMode });
  return names;
}

describe('installRoleTools kbMode（W 角色知识库双模式：D2 local 裁剪 / D9 remote 回归）', () => {
  it('local 模式：W 不注册 wiki 三原语，仍保留 prefetch 与 spec_card_view', async () => {
    const names = await registeredForWith('w', { kbMode: 'local' });
    expect(names).not.toContain('wiki_search');
    expect(names).not.toContain('wiki_read');
    expect(names).not.toContain('wiki_write');
    expect(names).toContain('prefetch_file');
    expect(names).toContain('spec_card_view');
  });
  it('local 模式：D/DT 不注册任何 wiki 工具', async () => {
    expect(await registeredForWith('d', { kbMode: 'local' })).not.toContain('wiki_read');
    expect(await registeredForWith('dt', { kbMode: 'local' })).not.toContain('wiki_write');
  });
  it('remote 模式：W/D/DT wiki 工具面与现状一致（回归）', async () => {
    expect(await registeredForWith('w', { kbMode: 'remote' })).toEqual(expect.arrayContaining(['wiki_search', 'wiki_read', 'wiki_write']));
    expect(await registeredForWith('d', { kbMode: 'remote' })).toEqual(expect.arrayContaining(['wiki_read', 'wiki_search']));
    expect(await registeredForWith('dt', { kbMode: 'remote' })).toEqual(expect.arrayContaining(['wiki_read', 'wiki_write']));
  });
});

describe('buildKbWriteGuard（D7/D10：路径感知）', () => {
  const root = '/tmp/fake-kb-root'; // 纯字符串判定，无需真实建目录
  const guard = buildKbWriteGuard(root);
  it('fs 写库根内绝对路径 → 放行', () => {
    expect(guard({ name: 'write', arguments: { path: root + '/wiki/entities/X.md' } })).toBeUndefined();
  });
  it('fs 写库根外 → 拒绝', () => {
    expect(guard({ name: 'write', arguments: { path: '/repo/src/a.ts' } })).toMatch(/write-to-repo-source-denied/);
  });
  it('fs 写 .. 穿越 → 拒绝', () => {
    expect(guard({ name: 'write', arguments: { path: root + '/../evil.md' } })).toMatch(/write-to-repo-source-denied/);
  });
  it('bash 重定向到库根内绝对路径 → 放行', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x > ' + root + '/wiki/log.md' } })).toBeUndefined();
  });
  it('bash mkdir 库根内绝对路径 → 放行（extractWriteTargets 扩展）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'mkdir -p ' + root + '/wiki/sources' } })).toBeUndefined();
  });
  it('bash 写仓库源码 → 拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'echo x > /repo/src/a.ts' } })).toMatch(/write-to-repo-source-denied/);
  });
  it('bash 相对路径写目标 fail-closed → 拒绝', () => {
    expect(guard({ name: 'bash', arguments: { command: 'mkdir -p wiki/sources' } })).toMatch(/write-to-repo-source-denied/);
  });
  it('bash 多目标动词：任一目标出库根 → 整条拒绝（C2 越权回归）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'mkdir -p ' + root + '/wiki/x /repo/evil' } })).toMatch(/write-to-repo-source-denied/);
    expect(guard({ name: 'bash', arguments: { command: 'touch ' + root + '/wiki/a.md ' + root + '/../../evil.md' } })).toMatch(/write-to-repo-source-denied/);
  });
  it('bash cp 进库根 fail-closed 拒绝（accepted-risk：源路径不可信，用 write 工具替代）', () => {
    expect(guard({ name: 'bash', arguments: { command: 'cp /tmp/a.md ' + root + '/wiki/x.md' } })).toMatch(/write-to-repo-source-denied/);
  });
  it('只读命令不受影响', () => {
    expect(guard({ name: 'bash', arguments: { command: 'cat /repo/src/a.ts' } })).toBeUndefined();
  });
});

// ── Task 6（角色工具注册防御）：registry 直取→回退→全空告警 ─────────────────
describe('installRoleTools registry 解析防御（直取 .tools / ctx.get 回退 / 全空告警）', () => {
  const ERR_UNAVAILABLE = 'tool registry unavailable';
  const DBG_FALLBACK = 'ctx.get fallback';

  function spyErr() {
    return vi.spyOn(console, 'error').mockImplementation(() => {});
  }
  const msgs = (spy: ReturnType<typeof spyErr>) => spy.mock.calls.map((c) => String(c[0]));

  it('直取 agentCtx.tools 存在 → 注册成功、无回退/告警日志（现状不回归）', async () => {
    const names: string[] = [];
    const ctx = { tools: { register: vi.fn((def: { name?: string }) => { names.push(def.name ?? ''); }) } };
    const err = spyErr();
    try {
      await installRoleTools(ctx as never, 'v', { kanban: {} as never, wiki: {} as never });
      expect(names).toContain('kanban_create');
      expect(msgs(err).some((m) => m.includes(DBG_FALLBACK))).toBe(false);
      expect(msgs(err).some((m) => m.includes(ERR_UNAVAILABLE))).toBe(false);
    } finally { err.mockRestore(); }
  });

  it('无 .tools 但 ctx.get("tools") 返回带 register 的对象 → 注册落在回退 registry 上', async () => {
    const names: string[] = [];
    const fallbackRegistry = { register: vi.fn((def: { name?: string }) => { names.push(def.name ?? ''); }) };
    const ctx = { get: (n: string) => (n === 'tools' ? fallbackRegistry : undefined) };
    const err = spyErr();
    try {
      await installRoleTools(ctx as never, 'v', { kanban: {} as never, wiki: {} as never });
      expect(names).toContain('kanban_create');
      expect(fallbackRegistry.register).toHaveBeenCalled();
      expect(msgs(err).some((m) => m.includes(DBG_FALLBACK))).toBe(true);
      expect(msgs(err).some((m) => m.includes(ERR_UNAVAILABLE))).toBe(false);
    } finally { err.mockRestore(); }
  });

  it('ctx.get("tools") 无 register / 返回非对象 → 不采用回退，走全空告警（不抛错、不注册）', async () => {
    for (const bad of [undefined, {}, { register: 'not-a-fn' }]) {
      const ctx = { get: (n: string) => (n === 'tools' ? bad : undefined) };
      const err = spyErr();
      try {
        await expect(installRoleTools(ctx as never, 'p', { kanban: {} as never, wiki: {} as never })).resolves.toBeUndefined();
        const unavailable = msgs(err).find((m) => m.includes(ERR_UNAVAILABLE));
        expect(unavailable).toBeTruthy();
        expect(unavailable).toContain('role=p');
        expect(unavailable).toContain('task=-');
        expect(unavailable).toContain('ctxKeys=get');
      } finally { err.mockRestore(); }
    }
  });

  it('两者皆无 → 不抛错、不注册、error 日志含 role/taskId/ctxKeys 采样', async () => {
    const ctx = { agent: { session: {} } }; // 无 tools、get('tools') 无果；ctxKeys 应含 agent
    const err = spyErr();
    try {
      await expect(installRoleTools(ctx as never, 'v', { kanban: {} as never, wiki: {} as never, taskId: 't_9' })).resolves.toBeUndefined();
      const unavailable = msgs(err).find((m) => m.includes(ERR_UNAVAILABLE));
      expect(unavailable).toBeTruthy();
      expect(unavailable).toContain('role=v');
      expect(unavailable).toContain('task=t_9');
      expect(unavailable).toContain('ctxKeys=agent');
    } finally { err.mockRestore(); }
  });
});

// ── 蜂群模式（swarm-mode-design §7）：buildSwarmSessionGuard 硬闸 ──
import { buildSwarmSessionGuard } from '../../src/roles/toolsets.js';

describe('buildSwarmSessionGuard (蜂群硬闸)', () => {
  const swarm = (name: string, args: Record<string, unknown>) => ({ name, arguments: args, agent: { session: { header: { agentPreset: 'swarm', cwd: '/ws/repo' } } } });
  const other = (name: string, args: Record<string, unknown>) => ({ name, arguments: args, agent: { session: { header: { agentPreset: 'kanban-d', cwd: '/ws/repo' } } } });

  it('swarm 会话：直接写工具拦截', () => {
    const g = buildSwarmSessionGuard();
    expect(g(swarm('write', { file_path: '/ws/repo/a.ts', content: 'x' }))).toContain('write-to-repo-source-denied');
  });

  it('swarm 会话：bash 写标记拦截（重定向/rm/touch）', () => {
    const g = buildSwarmSessionGuard();
    expect(g(swarm('bash', { command: 'echo hi > /ws/repo/a.ts' }))).toBeTruthy();
    expect(g(swarm('bash', { command: 'rm /ws/repo/a.ts' }))).toBeTruthy();
  });

  it('swarm 会话：git 反选——查询/clone/fetch/双态只读面放行，变更动词拦', () => {
    const g = buildSwarmSessionGuard();
    for (const cmd of [
      'git status', 'git log --oneline -5', 'git diff HEAD~1', 'git show abc', 'git rev-parse HEAD', 'git blame a.ts',
      'git -C /ws/repo log -1', 'git clone https://github.com/x/y.git /tmp/y', 'git fetch --all',
      // session 13 实测被老白名单误拦的查询面
      'git branch --all --no-color', 'git remote -v', 'git show-ref --heads --dereference',
      'git rev-list --count HEAD', 'git merge-base main feat', 'git tag -l v1*', 'git config --get user.name',
    ]) {
      expect(g(swarm('bash', { command: cmd }))).toBeUndefined();
    }
    for (const cmd of ['git push', 'git commit -m x', 'git checkout -b feat', 'git branch -d x', 'git config user.name x', 'git status && git push']) {
      expect(g(swarm('bash', { command: cmd }))).toContain('swarm-guard: 蜂群会话禁止 git 变更操作');
    }
  });

  it('swarm 会话：扩权参数教学拦截（天花板会话带参必被宿主拒，教模型去参重试）', () => {
    const g = buildSwarmSessionGuard();
    expect(g(swarm('bash', { command: 'rtk git status', sandbox_permissions: 'danger-full-access', justification: 'Need inspect repository state.' }))).toContain('不要传 sandbox_permissions/justification 扩权参数');
    expect(g(swarm('write', { file_path: '/ws/repo/a.ts', content: 'x', justification: 'x' }))).toContain('不要传 sandbox_permissions/justification 扩权参数');
    // 去参后恢复 git 反选与只读基座判定
    expect(g(swarm('bash', { command: 'rtk git status' }))).toBeUndefined();
  });

  it('swarm 会话：run_code 内嵌 git push 拦截', () => {
    const g = buildSwarmSessionGuard();
    expect(g(swarm('run_code', { code: "require('child_process').execSync('git push origin main')" }))).toContain('swarm-guard');
  });

  it('非 swarm 会话（kanban-d / 无 header）恒放行（角色自有护栏兜底）', () => {
    const g = buildSwarmSessionGuard();
    expect(g(other('write', { file_path: '/ws/repo/a.ts', content: 'x' }))).toBeUndefined();
    expect(g(other('bash', { command: 'git push' }))).toBeUndefined();
    expect(g({ name: 'bash', arguments: { command: 'git push' } })).toBeUndefined();
  });
});

// ── 独立评审（standalone DT）：buildStandaloneDtGuard 全局 guard ──
import { buildStandaloneDtGuard, registerStandaloneReviewerTools, isRoleComposed } from '../../src/roles/toolsets.js';
import { markRoleComposition } from '../../src/dispatcher/agent-runner.js';

describe('buildStandaloneDtGuard (独立评审全局 guard)', () => {
  // 独立 DT fake：preset=kanban-dt、无角色组合标记、session id 非 kbn- 前缀（dsh web 直聊形态）
  const standaloneAgent = { id: 'web-sess-1', session: { header: { agentPreset: 'kanban-dt', cwd: '/ws/repo' } } };
  const exec = (name: string, args: unknown, agent: unknown = standaloneAgent) =>
    ({ name, arguments: args, agent }) as never;
  const g = buildStandaloneDtGuard();

  it('①独立 DT bash：git 查询/clone/fetch/裸 checkout·switch 放行（反选：仅禁变更）', () => {
    for (const cmd of [
      'git status', 'git log --oneline -5', 'git clone https://github.com/x/y.git /tmp/y', 'git -C /ws/repo fetch --all',
      'echo hi && git diff HEAD~1',
      // 查询补充与双态动词只读面
      'git rev-list --count HEAD', 'git merge-base main feat', 'git cat-file -t abc', 'git reflog',
      'git branch', 'git branch -a -v', 'git tag', 'git tag -l v1*', 'git stash list', 'git stash show',
      'git remote -v', 'git remote get-url origin', 'git worktree list', 'git config --get user.name', 'git config --list',
      // 裸切换放行（用户决策：checkout/switch 裸切分支）
      'git checkout main', 'git checkout -q feat && git diff HEAD~1', 'git switch main',
    ]) {
      expect(g(exec('bash', { command: cmd }))).toBeUndefined();
    }
  });

  it('①-b 独立 DT bash：git 变更动词与双态变更子形态拒（fail-closed 含裸 git）', () => {
    for (const cmd of [
      'git', 'git push origin main', 'git merge feat', 'git rebase main', 'git reset --hard HEAD~1', 'git revert abc',
      'git cherry-pick abc', 'git commit -m x', 'git add .', 'git clean -fd', 'git restore a.ts', 'git gc',
      'git status && git push origin main',
      // 双态动词变更子形态
      'git checkout -b feat', 'git checkout -- a.ts', 'git switch -c feat', 'git branch feat', 'git branch -d feat',
      'git tag -d v1', 'git tag v2', 'git stash pop', 'git stash drop', 'git remote add up https://x', 'git remote set-url up https://y',
      'git worktree add /tmp/w main', 'git config user.name x', 'git config --global user.email a@b.c', 'git reflog delete abc',
    ]) {
      expect(g(exec('bash', { command: cmd }))).toContain('standalone-dt: 独立评审禁止 git 变更操作');
    }
  });

  it('①-c 独立 DT bash/write/edit：扩权参数教学拦截（防宿主 invalid justification 晦涩报错）', () => {
    expect(g(exec('bash', { command: 'rtk git status', justification: '' }))).toContain('不要传 sandbox_permissions/justification 扩权参数');
    expect(g(exec('bash', { command: 'git checkout main', sandbox_permissions: 'full-access' }))).toContain('不要传 sandbox_permissions/justification 扩权参数');
    expect(g(exec('write', { file_path: '/ws/repo/a.ts', content: 'x', justification: '需要写入' }))).toContain('不要传 sandbox_permissions/justification 扩权参数');
    expect(g(exec('edit', { file_path: '/ws/repo/a.ts', old_string: 'a', new_string: 'b', sandbox_permissions: 'full-access' }))).toContain('不要传 sandbox_permissions/justification 扩权参数');
    // 去参后恢复 git 反选与只读基座判定
    expect(g(exec('bash', { command: 'rtk git status' }))).toBeUndefined();
  });

  it('②独立 DT wiki_write：reviews 命名空间放行，链命名空间/越界/空路径拒', () => {
    expect(g(exec('wiki_write', { pagePath: 'projects/dsh-dashboard/reviews/login-2026-09-08/', content: 'x' }))).toBeUndefined();
    expect(g(exec('wiki_write', { pagePath: 'projects/dsh-dashboard/ch_1_x/review/dt.md', content: 'x' }))).toContain('wiki-write-outside-reviews-namespace');
    expect(g(exec('wiki_write', { pagePath: 'projects/dsh-dashboard/other/x.md', content: 'x' }))).toContain('wiki-write-outside-reviews-namespace');
    expect(g(exec('wiki_write', { pagePath: '../../etc/passwd', content: 'x' }))).toContain('wiki-write-outside-reviews-namespace');
    expect(g(exec('wiki_write', { pagePath: '', content: 'x' }))).toContain('wiki-write-outside-reviews-namespace');
  });

  it('③独立 DT：看板写工具拒，只读看板工具放行', () => {
    for (const name of ['kanban_complete', 'kanban_block', 'kanban_comment', 'kanban_heartbeat', 'kanban_create']) {
      expect(g(exec(name, {}))).toContain('standalone-dt: 独立评审模式不使用看板工具');
    }
    expect(g(exec('kanban_show', {}))).toBeUndefined();
    expect(g(exec('kanban_list', {}))).toBeUndefined();
  });

  it('④链上组合 DT（markRoleComposition 后）：wiki_write 链命名空间不被本 guard 拒（undefined）', () => {
    const agent = { id: 'kbn-t42', session: { header: { agentPreset: 'kanban-dt', parentSession: 'kbn-t42', cwd: '/ws/repo' } } };
    markRoleComposition(agent, { role: 'dt', taskId: 't42' });
    expect(g(exec('wiki_write', { pagePath: 'projects/ws/ch_1/review/dt.md', content: 'x' }, agent))).toBeUndefined();
    // 非 wiki_write 工具对组合会话恒 undefined（链上 DT 由自有 agent-scope guard 管）
    expect(g(exec('bash', { command: 'git push origin main' }, agent))).toBeUndefined();
  });

  it('⑤swarm 会话：wiki_write 拒（全局 wiki_write 收紧到评审会话）', () => {
    const agent = { session: { header: { agentPreset: 'swarm', cwd: '/ws/repo' } } };
    expect(g(exec('wiki_write', { pagePath: 'projects/ws/ch_1/review/x.md', content: 'x' }, agent))).toContain('wiki-write-restricted-to-reviewer-sessions');
  });

  it('⑥main 会话（无 preset / 无 agent）：wiki_write 拒', () => {
    expect(g(exec('wiki_write', { pagePath: 'projects/ws/ch_1/review/x.md', content: 'x' }, { session: { header: { cwd: '/ws/repo' } } }))).toContain('wiki-write-restricted-to-reviewer-sessions');
    expect(g({ name: 'wiki_write', arguments: { pagePath: 'projects/ws/ch_1/review/x.md', content: 'x' } } as never)).toContain('wiki-write-restricted-to-reviewer-sessions');
  });

  it('⑦独立 DT bash：非 git 无写标记放行（npm test），写标记由只读基座拒（重定向/包安装）', () => {
    expect(g(exec('bash', { command: 'npm test' }))).toBeUndefined();
    expect(g(exec('bash', { command: 'echo x > /tmp/f.txt' }))).toContain('write-to-repo-source-denied');
    expect(g(exec('bash', { command: 'pnpm add left-pad' }))).toContain('write-to-repo-source-denied');
  });

  it('⑧非 kanban-dt preset 的链上组合角色（kanban-d）：恒 undefined', () => {
    const agent = { id: 'kbn-t7', session: { header: { agentPreset: 'kanban-d', parentSession: 'kbn-t7', cwd: '/ws/repo' } } };
    markRoleComposition(agent, { role: 'd', taskId: 't7' });
    expect(g(exec('wiki_write', { pagePath: 'projects/ws/ch_1/review/x.md', content: 'x' }, agent))).toBeUndefined();
    expect(g(exec('bash', { command: 'git push' }, agent))).toBeUndefined();
    expect(g(exec('kanban_comment', {}, agent))).toBeUndefined();
  });

  it('独立 DT 其余工具（read/glob/grep/wiki_read/wiki_search/ocr_review）恒放行', () => {
    for (const name of ['read', 'glob', 'grep', 'wiki_read', 'wiki_search', 'ocr_review']) {
      expect(g(exec(name, {}))).toBeUndefined();
    }
  });

  it('kbn- 前缀 id 的未标记 DT 会话不按独立模式收紧（kanban/bash 恒 undefined）', () => {
    const agent = { id: 'kbn-t99', session: { header: { agentPreset: 'kanban-dt', parentSession: 'kbn-t99', cwd: '/ws/repo' } } };
    expect(g(exec('bash', { command: 'npm test' }, agent))).toBeUndefined();
    expect(g(exec('kanban_comment', {}, agent))).toBeUndefined();
  });

  it('⑨链上 DT 子代理（parentSession kbn- 前缀、无组合标记、id 非 kbn-）：不按独立收紧，wiki_write 链命名空间不被拒（交由 buildSubagentTreeGuard 管）', () => {
    const agent = { id: 'host-sub-1', session: { header: { agentPreset: 'kanban-dt', parentSession: 'kbn-t99', cwd: '/ws/repo' } } };
    expect(g(exec('wiki_write', { pagePath: 'projects/ws/ch_1/review/dt.md', content: 'x' }, agent))).toBeUndefined();
    expect(g(exec('bash', { command: 'git push origin main' }, agent))).toBeUndefined();
    expect(g(exec('kanban_comment', {}, agent))).toBeUndefined();
  });

  it('⑩parentSession 非 kbn-（主会话直聊形态）维持独立判定', () => {
    const agent = { id: 'web-sess-2', session: { header: { agentPreset: 'kanban-dt', parentSession: 'session_main', cwd: '/ws/repo' } } };
    expect(g(exec('kanban_comment', {}, agent))).toContain('standalone-dt: 独立评审模式不使用看板工具');
    expect(g(exec('wiki_write', { pagePath: 'projects/dsh-dashboard/reviews/login-2026-09-08/', content: 'x' }, agent))).toBeUndefined();
    expect(g(exec('wiki_write', { pagePath: 'projects/dsh-dashboard/ch_1/review/dt.md', content: 'x' }, agent))).toContain('wiki-write-outside-reviews-namespace');
  });
});

describe('isRoleComposed (角色组合标记只读判定)', () => {
  it('mark 后 true；未标记 incarnation / 非 object 为 false', () => {
    const a = { id: 'kbn-x', session: {} };
    expect(isRoleComposed(a)).toBe(false);
    markRoleComposition(a, { role: 'w', taskId: 'x' });
    expect(isRoleComposed(a)).toBe(true);
    expect(isRoleComposed(undefined)).toBe(false);
  });
});

describe('registerStandaloneReviewerTools (评审工具全局注册)', () => {
  it('remote 模式：注册 ocr_review + wiki 三原语（wiki 客户端经 ctx.get(\'wiki\') 注入）', () => {
    const names: string[] = [];
    const wikiMock = { baseUrl: 'http://kb', search: async () => [], read: async () => ({}), write: async () => ({ path: 'x' }) };
    const registry = { register: vi.fn((def: { name?: string }) => { names.push(def.name ?? ''); }) };
    const ctx = { get: (k: string) => (k === 'tools' ? registry : k === 'wiki' ? wikiMock : undefined) };
    const configProvider = { mode: 'remote', getEffective: () => ({ wikiVault: { baseUrl: 'http://kb' } }) };
    registerStandaloneReviewerTools(ctx as never, configProvider as never);
    expect(names).toEqual(expect.arrayContaining(['ocr_review', 'wiki_read', 'wiki_search', 'wiki_write']));
  });

  it('local 模式：注册 ocr_review + wiki_read/wiki_search；不注册 wiki_write（LocalWikiClient 只收 wiki/** 与工具边界 projects/** 双锁死）', () => {
    const prevHome = process.env.DSH_HOME;
    const kbHome = mkdtempSync(join(tmpdir(), 'standalone-local-kb-'));
    process.env.DSH_HOME = kbHome; // local 注册路径会 ensureLocalKbRoot 建库根，隔离到临时目录
    try {
      const names: string[] = [];
      const registry = { register: vi.fn((def: { name?: string }) => { names.push(def.name ?? ''); }) };
      const ctx = { get: (k: string) => (k === 'tools' ? registry : undefined) };
      const configProvider = { mode: 'local', getEffective: () => ({ wikiVault: { baseUrl: '' } }) };
      registerStandaloneReviewerTools(ctx as never, configProvider as never);
      expect(names).toEqual(expect.arrayContaining(['ocr_review', 'wiki_read', 'wiki_search']));
      expect(names).not.toContain('wiki_write');
    } finally {
      if (prevHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prevHome;
      rmSync(kbHome, { recursive: true, force: true });
    }
  });

  it('裸 Context（无 tools 服务）跳过注册不抛错', () => {
    const ctx = { get: () => undefined };
    const configProvider = { mode: 'remote', getEffective: () => ({}) };
    expect(() => registerStandaloneReviewerTools(ctx as never, configProvider as never)).not.toThrow();
  });
});
