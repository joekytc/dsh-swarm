# dsh-swarm W1-pre 阻塞根因修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 dsh-swarm 第一步 W1-pre 任务 t_6_mt84zn3e 不应出现的阻塞：非法（可选）manifest 不再 block 任务本身，而是转 failed 自动重派自愈；同时修复会话 live 复用、attempts 语义与 W persona schema 缺失，从根因上杜绝「W1-pre 阻塞 → 解阻 → 会话 live 报错 → 重试 → gave_up」级联。

**Architecture:** 四类根因各自最小改动落点：
1. `kanban-service.completeTask` 把「非法 manifest → task/blocked」改为「非法 manifest → task/failed（不 throw）」，任务转 failed 后由调度器 B1 自动重派（attempts<maxRetries），resume 上下文反馈失败原因；W1-pre 未 done → V 的 `resolveTaskParents` 不取它 → 下游 P 卡天然不建（满足「拦下游 P」不变式）。
2. `agent-runner` resume 前先查 agents registry 同名会话是否仍 live，live 则 followup 续用（对齐 `VOrchestrator.getVAgent` L451-457 既有模式），消灭 `cannot prepare session while it is live`。
3. `persona-w.md` + `PHASE_INSTRUCTIONS['w1-pre']` 显式文档化 manifest schema（expected 枚举），从源头让 W 不产出非法值。
4. attempts 语义：`task/unblocked` 重置 attempts；`failTask` 支持 `{ infra: true }` 使瞬时基础设施错误不计入重试预算。

**Tech Stack:** TypeScript + Vitest（TDD），DSH/Cordis 插件（dsh-swarm）。测试命令 `rtk npx vitest run <file>`，类型检查 `rtk npx tsc -p tsconfig.json --noEmit`。

## Global Constraints

- 不修改 DSH 官方源码，仅改本插件 `dsh-swarm/src`、`dsh-swarm/personas`、`dsh-swarm/tests`。
- `manifest` 对 W1-pre 是**可选**交付（缺 manifest 合法，legacy 兼容）；`ref` 是必需交付（缺失仍走既有 delivery-block，不在本计划范围）。
- 硬不变式（project_memory.md）：`invalid manifests block downstream P cards`——非法 manifest 必须拦下游 P，不得 block W1-pre 本身。
- W1-pre 卡是 `done` 后**不可变**（`done: { task/archived }`）；返工走 `createReworkTask` 新卡，本计划不新增返工机制。
- attempts 语义：任务质量失败（非法交付/评审）正常 `attempts+1`；瞬时基础设施错误（会话 live 锁/timeout）不计入；`task/unblocked` 后重试预算重置为 0。
- 每个任务提交前 `rtk git status` 确认只含本任务文件；提交信息遵循仓库既有风格（`fix:`/`test:`/`docs:` 前缀 + 中文描述）。
- 所有 shell 命令经 `rtk` 前缀执行。

---

## File Structure

| 文件 | 责任 | 变更任务 |
|---|---|---|
| `src/domain/kanban-service.ts` | completeTask 的 manifest 闸改为 failed 语义；failTask 支持 infra 标记 | T1, T4 |
| `src/domain/projection.ts` | `task/failed` infra 不计数；`task/unblocked` 重置 attempts | T4 |
| `src/dispatcher/agent-runner.ts` | resume 前 live 会话复用；runner 错误按 infra 分类 | T2, T4 |
| `personas/persona-w.md` | 文档化 manifest schema | T3 |
| `src/dispatcher/v-orchestrator.ts` | `PHASE_INSTRUCTIONS['w1-pre']` 文案对齐 failed 语义 + schema | T3 |
| `tests/domain/kanban-service.test.ts` | manifest failed 语义回归 | T1, T5 |
| `tests/domain/projection.test.ts` | attempts 语义回归 | T4 |
| `tests/dispatcher/agent-runner.test.ts` | live 会话复用 + infra 不计数回归 | T2, T4 |
| `tests/dispatcher/dispatcher.test.ts` | 端到端重派自愈回归 | T5 |

任务边界：每个任务产出自包含、可独立测试的改动。T1 最核心（根因1），T2 消除重跑死锁（根因2），T3 源头防复发（根因3），T4 收紧重试预算语义（根因4），T5 整体回归。

---

### Task 1: W1-pre 非法 manifest → failed（自动重派自愈），不再 block 任务本身

**Files:**
- Modify: `src/domain/kanban-service.ts:170-177`
- Test: `tests/domain/kanban-service.test.ts:348-364`

**Interfaces:**
- Consumes: `validateManifestIfPresent(assignee, mode, handoff)`（`src/domain/prefetch-manifest.ts`，返回错误数组）。
- Produces: `completeTask` 对非法 manifest 的行为变更——返回 `status === 'failed'` 的 task 而非 throw/block；`task/failed` 事件 reason 以 `invalid prefetch manifest:` 开头，供 T5 与 resume 上下文断言。

- [ ] **Step 1: 改写失败测试（先红）**

修改 `tests/domain/kanban-service.test.ts` L348-364 的现有测试，把「拒绝完成 + 标 blocked」断言改为「转 failed、不 block、attempts+1」：

```ts
  it('light-tier manifest: W1-pre invalid manifest → failed (auto-retry, not blocked), absent manifest completes', async () => {
    const { svc, dir } = await fresh();
    try {
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      // 缺 manifest → 通过（legacy 兼容）
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1.id, 'system');
      const ok = await svc.completeTask(w1.id, { summary: 'f', metadata: { ref: '/ws' }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id });
      expect(ok.status).toBe('done');
      // 非法 manifest → 不 block 本任务：completeTask 返回 failed 任务（attempts+1），调度器 B1 自动重派
      const w1b = await svc.createTask({ chainId: chain.id, title: 'w1b', assignee: 'w', mode: 'file' }, 'v');
      await svc.claimTask(w1b.id, 'system');
      const failed = await svc.completeTask(w1b.id, { summary: 'f', metadata: { ref: '/ws', manifest: { bad: true } }, completedAt: Date.now() }, 'w', { boundTaskId: w1b.id });
      expect(failed.status).toBe('failed');
      const st = await svc.snapshot();
      expect(st.tasks.get(w1b.id)!.attempts).toBe(1); // 任务质量失败计入一次
      expect(st.events.some((e) => e.taskId === w1b.id && e.kind === 'task/blocked')).toBe(false); // 关键：不产生 block
      const failEv = st.events.find((e) => e.taskId === w1b.id && e.kind === 'task/failed');
      expect(String(failEv!.payload['reason'])).toContain('invalid prefetch manifest');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk npx vitest run tests/domain/kanban-service.test.ts`
Expected: FAIL——现有实现 emit `task/blocked` + throw，`failed.status` 断言不成立（实际 rejected 且 blocked）。

- [ ] **Step 3: 实现最小改动**

修改 `src/domain/kanban-service.ts` L170-177，把 `task/blocked` + throw 替换为 `task/failed` + return：

```ts
    // 轻档 manifest 校验（W1-pre）：交接带 manifest 则 schema 校验，非法即 failed（非 block）。
    // 语义：manifest 为可选交付，非法 ≈ 未提供——不 block 任务本身（避免阻塞级联与会话 live 重跑死锁），
    // 直接转 failed 让调度器 B1 自动重派（attempts<maxRetries）并在 resume 上下文反馈失败原因；
    // W1-pre 未 done → V 的 resolveTaskParents 不取它 → 下游 P 卡天然不建（「拦下游 P」不变式）。
    {
      const manifestErrors = validateManifestIfPresent(t.assignee, t.mode, handoff);
      if (manifestErrors.length > 0) {
        await this.emit({ chainId: t.chainId, taskId, kind: 'task/failed', payload: { reason: manifestErrors.join('; ') }, author: 'system', at: Date.now() });
        return this.state.tasks.get(taskId)!;
      }
    }
```

说明：`task/failed` 对 `running` 是合法转换（state-machine.ts L7），投影按既有逻辑 `attempts+1`（T4 前默认非 infra）。不 throw——避免 W 会话拿到工具错误后 idle 触发 `protocol_violation` 二次 block，让调度器确定性接管重派。

- [ ] **Step 4: 运行测试确认通过**

Run: `rtk npx vitest run tests/domain/kanban-service.test.ts`
Expected: PASS（含既有 delivery/evidence/chain-complete 测试不回归）。

- [ ] **Step 5: 提交**

```bash
rtk git add src/domain/kanban-service.ts tests/domain/kanban-service.test.ts
rtk git commit -m "fix: W1-pre 非法 manifest 转 failed 自动重派，不再 block 任务本身（拦下游 P）"
```

---

### Task 2: AgentRunner resume 前复用仍 live 的会话（消灭 session-live 重跑死锁）

**Files:**
- Modify: `src/dispatcher/agent-runner.ts:14-18, 229-283`
- Test: `tests/dispatcher/agent-runner.test.ts`

**Interfaces:**
- Consumes: `task.resumeSessionId ?? \`kbn-${taskId}\``（既有会话 id 约定）；`AgentLike`（L14-18）。
- Produces: 新增私有方法 `private async resumeOrReuse(agents, sessionId, opts): Promise<AgentLike>`——两个 resume 调用点（无候选路径 + 候选循环）统一走它。live 命中返回既有 agent（后续 `followup` 续用），否则回退 `agents.resume`。`agents.get` 未实现时防御回退 resume。

- [ ] **Step 1: 写失败测试（先红）**

在 `tests/dispatcher/agent-runner.test.ts` 追加（复用文件顶部 `fakeCtx`/`FakeAgent` 类型）：

```ts
  it('reuses live session on re-run after unblock instead of resume (RC2: no "while it is live" error)', async () => {
    const { svc, dir, t } = await setupTask(false);
    try {
      const calls: string[] = [];
      const events: unknown[] = [];
      const pending: Promise<void>[] = [];
      let phase = 0;
      const followup = vi.fn((msg: unknown) => {
        phase++;
        const text = (msg as { content?: Array<{ type: string; text: string }> })?.content?.[0]?.text ?? '';
        if (phase === 2 && /Prior attempts/.test(text)) {
          // 二轮（unblock 后复用 live 会话）：上下文带 last failure → W 修正 → 完成
          pending.push((async () => {
            events.push({ type: 'tool-call', name: 'kanban_complete' });
            await svc.completeTask(t.id, { summary: 'ok', metadata: { ref: '/ws' }, completedAt: Date.now() }, 'w', { boundTaskId: t.id });
          })());
        } else {
          pending.push((async () => { events.push({ type: 'assistant', text: 'ok' }); })());
        }
      });
      const whenIdle = vi.fn(async () => { await Promise.all(pending); });
      const liveAgent = { followup, whenIdle, session: { events } };
      const agents = {
        create: async () => { calls.push('create'); return { agent: liveAgent }; },
        get: (id: string) => { calls.push('get:' + id); return id === 'kbn-' + t.id ? liveAgent : undefined; },
        resume: async () => { calls.push('resume'); throw new Error("cannot prepare session 'kbn-" + t.id + "' while it is live"); },
      };
      const runner = new AgentRunner(fakeCtx(agents) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id); // 首轮 create → idle 无 complete → blocked(protocol_violation)
      let state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
      await svc.unblockTask(t.id, 'human'); // blocked → ready
      await runner.runTask(t.id); // 二轮 hasRunHistory → get 命中 live → followup 续用（不调 resume）
      expect(calls).toEqual(['create', 'get:kbn-' + t.id]);
      state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('done');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk npx vitest run tests/dispatcher/agent-runner.test.ts -t "reuses live session"`
Expected: FAIL——现有实现无 live 复用，直接调 `resume` 抛错 → 任务 `failed` 而非 `done`，`calls` 含 `resume`。

- [ ] **Step 3: 实现最小改动**

3a. 新增私有方法（放在 `runTask` 之后）：

```ts
  /** RC2：resume 前先查 agents registry 同名会话是否仍 live——live 则直接复用（后续 followup 续用），
   *  避免 block→unblock→重跑同一会话时 resume 抛 "cannot prepare session while it is live"
   *  （对齐 VOrchestrator.getVAgent 的 live 复用逻辑）。agents.get 未实现 → 防御回退 resume。 */
  private async resumeOrReuse(
    agents: { resume(o: unknown): Promise<{ agent: AgentLike }>; get?(id: string): AgentLike | undefined },
    sessionId: string,
    opts: { agentOptions?: AgentModelOptions; setup: (c: Context) => Promise<void> },
  ): Promise<AgentLike> {
    const live = agents.get?.(sessionId);
    if (live) return live;
    const h = await agents.resume({ resumeSessionId: SessionId(sessionId), ...opts });
    return h.agent;
  }
```

3b. 无候选路径（L240-249）——resume 分支改走 helper：

```ts
          agent = hasRunHistory
            ? await this.resumeOrReuse(
                this.ctx.get('agents') as unknown as { resume(o: unknown): Promise<{ agent: AgentLike }>; get?(id: string): AgentLike | undefined },
                task.resumeSessionId ?? `kbn-${taskId}`,
                { setup },
              )
            : (await (this.ctx.get('agents') as unknown as { create(o: unknown): Promise<{ agent: AgentLike }> }).create({
                sessionId: SessionId(`kbn-${taskId}`),
                meta: { cwd: sessionCwd },
                setup,
              })).agent;
```

3c. 候选循环（L251-274）——`agents` 类型补 `get?`，resume 分支改走 helper：

```ts
          const agents = this.ctx.get('agents') as unknown as {
            create(o: unknown): Promise<{ agent: AgentLike }>;
            resume(o: unknown): Promise<{ agent: AgentLike }>;
            get?(id: string): AgentLike | undefined;
          };
```
```ts
              const h = hasRunHistory
                ? await this.resumeOrReuse(agents, task.resumeSessionId ?? `kbn-${taskId}`, { agentOptions: candidate, setup })
                : await agents.create({ sessionId: SessionId(`kbn-${taskId}`), meta: { cwd: sessionCwd }, agentOptions: candidate, setup });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `rtk npx vitest run tests/dispatcher/agent-runner.test.ts`
Expected: PASS（既有 `re-dispatches`/`marks failed`/`返工 blocked→unblocked→ready` 等测试不回归——旧假 agents 无 `get` 方法，helper 走 `get?.` 回退 resume，行为不变）。

- [ ] **Step 5: 提交**

```bash
rtk git add src/dispatcher/agent-runner.ts tests/dispatcher/agent-runner.test.ts
rtk git commit -m "fix: AgentRunner resume 前复用 live 会话，消除 session-live 重跑死锁"
```

---

### Task 3: 文档化 manifest schema（persona + 阶段指令），源头防非法值

**Files:**
- Modify: `personas/persona-w.md`
- Modify: `src/dispatcher/v-orchestrator.ts:69-73`
- Test: `tests/dispatcher/v-orchestrator.test.ts:460-461`

**Interfaces:**
- Consumes: `PrefetchFileEntry.expected` 三枚举（`src/domain/prefetch-manifest.ts` L4-8）。
- Produces: persona-w.md 新增规则 7（schema 定义 + 反例 `'sha256'`）；`PHASE_INSTRUCTIONS['w1-pre']` 文案把「非法即 block」改为「非法即 failed 自动重试」。

- [ ] **Step 1: 写失败测试（先红）**

修改 `tests/dispatcher/v-orchestrator.test.ts:460-461`，断言指令文案不再提 block 且显式列出 expected 枚举：

```ts
  it('w1-pre 指令说明可选 manifest 产出（failed 语义 + expected 枚举）', () => {
    expect(PHASE_INSTRUCTIONS['w1-pre']).toContain('manifest');
    expect(PHASE_INSTRUCTIONS['w1-pre']).toContain('exists|absent|content-hash');
    expect(PHASE_INSTRUCTIONS['w1-pre']).not.toContain('非法即 block');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts -t "w1-pre"`
Expected: FAIL——现文案含「非法即 block」且未显式列 `exists|absent|content-hash`。

- [ ] **Step 3: 实现**

3a. `personas/persona-w.md` 规则列表末尾追加规则 7：

```md
7. manifest（可选，仅 W1-pre 交接 metadata.manifest）：结构化预取清单，schema 固定为
   repo = { localPath: 目标仓库绝对路径, remoteUrl?, branch?, dirtyFiles: string[] }
   files = [{ path: string, expected: 'exists' | 'absent' | 'content-hash', note? }]
   expected 只允许上述三枚举值（content-hash 时必须带非空 note）。用错枚举（如 'sha256'）会导致交接被系统
   判失败并自动重试；对不确定的文件状态不要硬写，不提供 manifest 也完全合法（宁缺勿滥）。
```

3b. `src/dispatcher/v-orchestrator.ts:69-73` 的 `'w1-pre'` 文案末尾一句改写：

```ts
    'complete 时 metadata 可选带 manifest（结构化预取清单：repo.localPath/remoteUrl/branch/dirtyFiles + files[{path, expected: exists|absent|content-hash, note}]）。提供则 system 会 schema 校验，非法即 failed 自动重试（不 block 本任务；重派时注入失败原因，W1-pre 未 done 则下游 P 卡不创建）；不提供不拦（legacy 兼容）。',
```

- [ ] **Step 4: 运行测试确认通过**

Run: `rtk npx vitest run tests/dispatcher/v-orchestrator.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
rtk git add personas/persona-w.md src/dispatcher/v-orchestrator.ts tests/dispatcher/v-orchestrator.test.ts
rtk git commit -m "docs: W persona 与阶段指令文档化 manifest schema（failed 语义 + expected 枚举）"
```

---

### Task 4: attempts 语义收紧——unblock 重置预算 + infra 失败不计数

**Files:**
- Modify: `src/domain/kanban-service.ts:251-258`（failTask 支持 infra）
- Modify: `src/domain/projection.ts:89-96`（failed infra 不计数 + unblocked 重置）
- Modify: `src/dispatcher/agent-runner.ts:284-294, 349-357`（runner 错误按 infra 分类）
- Test: `tests/domain/projection.test.ts`、`tests/dispatcher/agent-runner.test.ts`

**Interfaces:**
- Consumes: `failTask(taskId, reason, actor)` 既有签名；`task/failed` 事件 `payload.reason`。
- Produces: `failTask(taskId, reason, actor, opts?: { infra?: boolean })`（新可选参）；`task/failed` payload 新增 `infra: boolean`；`task/unblocked` 后 `task.attempts === 0`。新增模块级纯函数 `isInfraError(err: unknown): boolean`（放 `agent-runner.ts`）。

- [ ] **Step 1: 写失败测试（先红）**

1a. `tests/domain/projection.test.ts` 追加（复用 `mk` helper）：

```ts
  it('infra failure does not increment attempts; unblock resets attempts (RC4)', () => {
    const base: KanbanEvent[] = [
      mk(0, 'chain/created', { id: 'ch_1', title: 'c', ownerSessionId: 's_1' }),
      mk(1, 'task/created', { id: 't_1', title: 'w1', assignee: 'w', mode: 'file' }, 't_1'),
      mk(2, 'task/claimed', {}, 't_1'),
      mk(3, 'task/failed', { reason: 'runner-error: cannot prepare session while it is live', infra: true }, 't_1'),
    ];
    let state = project(base);
    expect(state.tasks.get('t_1')!.attempts).toBe(0); // infra 不计数
    const withQualityFail: KanbanEvent[] = [
      ...base,
      mk(4, 'task/claimed', {}, 't_1'),
      mk(5, 'task/failed', { reason: 'invalid prefetch manifest: x', infra: false }, 't_1'),
    ];
    state = project(withQualityFail);
    expect(state.tasks.get('t_1')!.attempts).toBe(1); // 任务质量失败计数
    const withUnblock: KanbanEvent[] = [
      ...withQualityFail,
      mk(6, 'task/blocked', { reason: 'gave_up: max retries' }, 't_1'),
      mk(7, 'task/unblocked', {}, 't_1'),
    ];
    state = project(withUnblock);
    expect(state.tasks.get('t_1')!.attempts).toBe(0); // unblock 重置
  });
```

1b. `tests/dispatcher/agent-runner.test.ts` 追加：

```ts
  it('infra spawn error (session-live) marks failed WITHOUT incrementing attempts (RC4)', async () => {
    const { svc, dir, t } = await setupTask(true);
    try {
      const agents = {
        create: async () => { throw new Error("cannot prepare session 'kbn-" + t.id + "' while it is live"); },
      };
      const runner = new AgentRunner(fakeCtx(agents) as never, svc, {} as never, {} as unknown as WikiVaultClient);
      await runner.runTask(t.id);
      const state = await svc.snapshot();
      const task = state.tasks.get(t.id)!;
      expect(task.status).toBe('failed');
      expect(task.attempts).toBe(0); // infra 不计入重试预算
      const failEv = state.events.find((e) => e.taskId === t.id && e.kind === 'task/failed');
      expect(failEv!.payload['infra']).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk npx vitest run tests/domain/projection.test.ts tests/dispatcher/agent-runner.test.ts -t "RC4"`
Expected: FAIL——现投影对 `task/failed` 一律 `attempts+1`，`task/unblocked` 不重置；runner 未打 infra 标记。

- [ ] **Step 3: 实现最小改动**

3a. `src/domain/kanban-service.ts` `failTask`（L251-258）加 infra 可选参并写入 payload：

```ts
  /** 标记任务失败（runner 异常/心跳超时回收）；投影递增 attempts（infra 瞬时错误不计数）。重试由调度器重派。 */
  async failTask(taskId: string, reason: string, actor: Actor, opts: { infra?: boolean } = {}): Promise<Task> {
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    if (actor !== 'system') throw new Error('permission denied: only dispatcher may fail tasks');
    if (!reason.trim()) throw new Error('fail reason required');
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/failed', payload: { reason, infra: opts.infra ?? false }, author: actor, at: Date.now() });
    return this.state.tasks.get(taskId)!;
  }
```

3b. `src/domain/projection.ts`（L90-91）两处改：

```ts
      if (ev.kind === 'task/heartbeat') updated.heartbeats = [...t.heartbeats, ev.at];
      // RC4：infra 失败不计入 attempts（瞬时基础设施错误不烧重试预算）；任务质量失败正常 +1
      if (ev.kind === 'task/failed' && !ev.payload['infra']) updated.attempts = t.attempts + 1;
      if (ev.kind === 'task/unblocked') updated.attempts = 0; // RC4：人工解除阻塞 → 重试预算重置
```

3c. `src/dispatcher/agent-runner.ts` 新增模块级 infra 分类函数（放在 `AgentRunner` 类前），并让两处 runner 失败 catch（spawn catch L288、run catch L354）按分类打 infra：

```ts
/** RC4：瞬时基础设施错误（会话 live 锁/网络超时）与任务质量失败区分——infra 不计入 attempts 重试预算。 */
function isInfraError(err: unknown): boolean {
  return /cannot prepare session|while it is live|timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket/i.test(String(err));
}
```
```ts
          await this.kanban.failTask(taskId, 'runner-error: ' + String(err), 'system', { infra: isInfraError(err) });
```
（两处 `failTask` 调用 `... , 'system');` 均改为带 `{ infra: isInfraError(err) }`。）

- [ ] **Step 4: 运行测试确认通过**

Run: `rtk npx vitest run tests/domain/projection.test.ts tests/dispatcher/agent-runner.test.ts tests/domain/kanban-service.test.ts tests/dispatcher/dispatcher.test.ts tests/dispatcher/watchdog.test.ts`
Expected: PASS（既有 dispatcher/watchdog 熔断测试用 `failTask(..., 'system')` 不带 infra → 默认 false → 仍计数，行为不变）。

- [ ] **Step 5: 提交**

```bash
rtk git add src/domain/kanban-service.ts src/domain/projection.ts src/dispatcher/agent-runner.ts tests/domain/projection.test.ts tests/dispatcher/agent-runner.test.ts
rtk git commit -m "fix: attempts 语义收紧——unblock 重置重试预算，infra 失败不计数"
```

---

### Task 5: 端到端回归——非法 manifest → 重派自愈 → 链继续到 P

**Files:**
- Test: `tests/dispatcher/dispatcher.test.ts`
- Verify: 全仓 `rtk npx vitest run` + `rtk npx tsc -p tsconfig.json --noEmit`

**Interfaces:**
- Consumes: T1（completeTask failed 语义）、T2（live 会话复用）、T4（attempts 语义）全部落地。
- Produces: 复现 t_6_mt84zn3e 场景的服务级回归：非法 manifest 不阻塞、重派后合法 manifest 完成、V 能推进建下游 P 卡。

- [ ] **Step 1: 写失败测试（先红）**

在 `tests/dispatcher/dispatcher.test.ts` 追加：

```ts
  it('regression: W1-pre invalid manifest → failed (not blocked) → re-dispatch with valid manifest → done → P can be created (t_6_mt84zn3e)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disp-r-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const card = await svc.createSpecCard(chain.id, { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.approveSpecCard(card.id, 'human');
      const w1 = await svc.createTask({ chainId: chain.id, title: 'w1-pre', assignee: 'w', mode: 'file' }, 'v');
      // 第 1 轮：W 提交非法 manifest（expected:'sha256' 反例）→ 任务 failed（attempts=1），绝不 blocked
      await svc.claimTask(w1.id, 'system');
      const failed = await svc.completeTask(w1.id, { summary: 'facts', metadata: { ref: '/ws', manifest: { repo: { localPath: '/ws', dirtyFiles: [] }, files: [{ path: 'README.md', expected: 'sha256' }] } }, completedAt: Date.now() }, 'w', { boundTaskId: w1.id });
      expect(failed.status).toBe('failed');
      let state = await svc.snapshot();
      expect(state.events.some((e) => e.taskId === w1.id && e.kind === 'task/blocked')).toBe(false);
      expect(state.tasks.get(w1.id)!.attempts).toBe(1);
      // 调度器 B1 自动重派（attempts=1 < maxRetries=3）→ W 修正为合法 manifest → done
      const d = makeDispatcher(svc, {
        runner: { runTask: async (id: string) => {
          await svc.claimTask(id, 'system');
          await svc.completeTask(id, { summary: 'facts', metadata: { ref: '/ws', manifest: { repo: { localPath: '/ws', dirtyFiles: [] }, files: [{ path: 'README.md', expected: 'exists' }] } }, completedAt: Date.now() }, 'w', { boundTaskId: id });
        } },
        maxRetries: 3,
        stateFile: join(dir, 'dispatcher-state.json'),
      });
      await d.tick();
      state = await svc.snapshot();
      expect(state.tasks.get(w1.id)!.status).toBe('done');
      // 拦下游 P：W1-pre 已 done → V 可正常 resolve 并建 P 卡（不再卡 w1-pre 阶段）
      const p = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'p', mode: 'openspec', parents: [w1.id] }, 'v');
      expect(p.status).toBe('todo');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk npx vitest run tests/dispatcher/dispatcher.test.ts -t "regression: W1-pre invalid manifest"`
Expected: FAIL——现实现第 1 轮非法 manifest 直接 `task/blocked`（`failed.status` 断言失败），复现 t_6 阻塞。

- [ ] **Step 3: 实现**

无需新代码——T1-T4 已落地。本步骤仅为确认 T1-T4 组合后测试转绿（若红，回到对应 Task 排查）。

- [ ] **Step 4: 全仓回归**

Run: `rtk npx vitest run && rtk npx tsc -p tsconfig.json --noEmit`
Expected: 全部 PASS + 无类型错误。重点确认无任何旧断言仍期望「非法 manifest → blocked」行为。

- [ ] **Step 5: 提交**

```bash
rtk git add tests/dispatcher/dispatcher.test.ts
rtk git commit -m "test: 端到端回归——W1-pre 非法 manifest 重派自愈且不阻塞、下游 P 正常建卡"
```

---

## Self-Review

**1. Spec 覆盖：**
- 根因1（manifest block 级联）→ T1（completeTask failed 语义）+ T5（回归）。
- 根因2（session-live 重跑死锁）→ T2（resumeOrReuse）。
- 根因3（persona 无 schema）→ T3（persona-w.md + PHASE_INSTRUCTIONS）。
- 根因4（attempts 语义）→ T4（unblock 重置 + infra 不计数）。
- 决策澄清（3 项，上轮已确认）全部落入：failed+自动重试（T1）、复用 live 会话（T2）、unblock 重置+infra 不计数（T4）。
- 用户核心诉求「不出现阻塞 + 解决根因非表面修复」：T1/T5 证明非法 manifest 不产生 `task/blocked`；T3 从源头消除非法值；T2/T4 兜住会话与重试预算。

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤含完整可运行代码；测试均含具体断言与运行命令。

**3. 类型一致性：**
- `failTask(taskId, reason, actor, opts?: { infra?: boolean })`——T4 定义，T5 测试不直接调用（走 completeTask/调度器），dispatcher/watchdog 既有调用不传 opts 默认 `{ infra: false }`。
- `resumeOrReuse(agents, sessionId, opts: { agentOptions?; setup })`——T2 定义，两处调用签名一致；`agents.get?.(sessionId)` 防御回退。
- `isInfraError(err)` 模块级纯函数——T4 定义，两处 catch 调用。
- `task/failed` payload 新增 `infra` 字段——T4 投影读取 `ev.payload['infra']`，T1 直接 emit 不设 infra（默认 undefined → falsy → 计数）。
- 会话 id 约定 `kbn-${taskId}` / `task.resumeSessionId ?? kbn-${taskId}`——T1/T2/T5 断言一致。
