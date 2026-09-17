window.__ModuleLoader__.load({
	id: "@joekytc/dsh-swarm",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		"use strict";
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name2 in all)
		    __defProp(target, name2, { get: all[name2], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
		
		// client/index.ts
		var index_exports = {};
		__export(index_exports, {
		  apply: () => apply,
		  inject: () => inject,
		  name: () => name
		});
		module.exports = __toCommonJS(index_exports);
		
		// client/KanbanTab.tsx
		var import_react7 = require("react");
		
		// src/domain/state-machine.ts
		var TASK_TRANSITIONS = {
		  triage: { "task/claimed": "running" },
		  todo: { "task/claimed": "running", "task/archived": "archived" },
		  ready: { "task/claimed": "running", "task/archived": "archived" },
		  running: { "task/completed": "done", "task/blocked": "blocked", "task/failed": "failed", "task/heartbeat": "running" },
		  blocked: { "task/unblocked": "ready", "task/archived": "archived" },
		  done: { "task/archived": "archived" },
		  failed: { "task/claimed": "running", "task/blocked": "blocked", "task/archived": "archived" },
		  archived: {}
		};
		var CHAIN_TRANSITIONS = {
		  planning: { "chain/executing": "executing" },
		  executing: { "chain/completed": "completed", "chain/aborted": "aborted", "chain/blocked": "blocked" },
		  blocked: { "chain/reopened": "executing" },
		  // 人工恢复唯一出边（其余事件对 blocked 仍非法）
		  completed: {},
		  aborted: {}
		};
		var SPEC_TRANSITIONS = {
		  draft: { "spec-card/approved": "approved" },
		  approved: {}
		};
		function step(name2, table, current, kind) {
		  const next = table[current]?.[kind];
		  if (next === void 0) throw new Error(`illegal transition: ${current} --${kind}--> (none)`);
		  return next;
		}
		var transitionTask = (c, k) => step("task", TASK_TRANSITIONS, c, k);
		var transitionChain = (c, k) => step("chain", CHAIN_TRANSITIONS, c, k);
		var transitionSpecCard = (c, k) => step("spec", SPEC_TRANSITIONS, c, k);
		
		// src/domain/projection.ts
		function applyTo(state, ev) {
		  const next = { ...state, events: [...state.events, ev] };
		  switch (ev.kind) {
		    case "chain/created": {
		      const p = ev.payload;
		      next.chains = new Map(state.chains).set(p.id, { ...p, status: "planning", workspaceDir: p.workspaceDir ?? null });
		      break;
		    }
		    case "chain/executing":
		    case "chain/completed":
		    case "chain/aborted":
		    case "chain/blocked":
		    case "chain/reopened": {
		      const c = state.chains.get(ev.chainId);
		      if (!c) throw new Error("projection: unknown chain " + ev.chainId);
		      next.chains = new Map(state.chains).set(ev.chainId, { ...c, status: transitionChain(c.status, ev.kind) });
		      break;
		    }
		    case "chain/root-task-set": {
		      const c = state.chains.get(ev.chainId);
		      if (!c) throw new Error("projection: unknown chain " + ev.chainId);
		      next.chains = new Map(state.chains).set(ev.chainId, { ...c, rootTaskId: String(ev.payload["rootTaskId"] ?? "") });
		      break;
		    }
		    // audit 事件不改 Chain 状态，只写验收核对视图（auditWarnings）
		    case "chain/audit-warning": {
		      const c = state.chains.get(ev.chainId);
		      if (!c) throw new Error("projection: unknown chain " + ev.chainId);
		      const evidence = ev.payload["evidence"] ?? [];
		      const audit = {
		        evidence,
		        warnedAt: ev.at,
		        warnedSeq: ev.seq,
		        confirmedAt: null,
		        confirmedBy: null,
		        confirmedSeq: null
		      };
		      next.auditWarnings = new Map(state.auditWarnings).set(ev.chainId, audit);
		      break;
		    }
		    case "chain/audit-confirmed": {
		      const c = state.chains.get(ev.chainId);
		      if (!c) throw new Error("projection: unknown chain " + ev.chainId);
		      const existing = state.auditWarnings.get(ev.chainId);
		      if (!existing) throw new Error("projection: audit-confirmed without audit-warning: " + ev.chainId);
		      next.auditWarnings = new Map(state.auditWarnings).set(ev.chainId, {
		        ...existing,
		        confirmedAt: ev.at,
		        confirmedBy: ev.author,
		        confirmedSeq: ev.seq
		      });
		      break;
		    }
		    // 链标题改名（非状态转换，只更新 title；快照重放可见）
		    case "chain/title-updated": {
		      const c = state.chains.get(ev.chainId);
		      if (!c) throw new Error("projection: unknown chain " + ev.chainId);
		      next.chains = new Map(state.chains).set(ev.chainId, { ...c, title: String(ev.payload["to"] ?? "") });
		      break;
		    }
		    // 任务标题改名（非状态转换，只更新 title）
		    case "task/renamed": {
		      if (!ev.taskId) throw new Error("projection: event without taskId");
		      const t = state.tasks.get(ev.taskId);
		      if (!t) throw new Error("projection: unknown task " + ev.taskId);
		      next.tasks = new Map(state.tasks).set(ev.taskId, { ...t, title: String(ev.payload["to"] ?? "") });
		      break;
		    }
		    case "task/created": {
		      const p = ev.payload;
		      if (!p.id || !p.assignee) throw new Error("projection: malformed task/created");
		      const normalized = {
		        ...p,
		        status: p.status ?? "todo",
		        parents: p.parents ?? [],
		        children: p.children ?? [],
		        attempts: p.attempts ?? 0,
		        heartbeats: p.heartbeats ?? [],
		        sessionId: p.sessionId ?? "kbn-" + p.id,
		        reworkOfTaskId: p.reworkOfTaskId ?? null,
		        resumeSessionId: p.resumeSessionId ?? null,
		        reviewAttempt: p.reviewAttempt ?? 0,
		        reviewStatus: p.reviewStatus ?? "not-required"
		      };
		      next.tasks = new Map(state.tasks).set(p.id, normalized);
		      break;
		    }
		    case "task/claimed":
		    case "task/heartbeat":
		    case "task/completed":
		    case "task/blocked":
		    case "task/unblocked":
		    case "task/failed":
		    case "task/archived": {
		      if (!ev.taskId) throw new Error("projection: event without taskId");
		      const t = state.tasks.get(ev.taskId);
		      if (!t) throw new Error("projection: unknown task " + ev.taskId);
		      const updated = { ...t, status: transitionTask(t.status, ev.kind) };
		      if (ev.kind === "task/heartbeat") updated.heartbeats = [...t.heartbeats, ev.at];
		      if (ev.kind === "task/failed" && !ev.payload["infra"]) updated.attempts = t.attempts + 1;
		      if (ev.kind === "task/unblocked") updated.attempts = 0;
		      if (ev.kind === "task/completed") {
		        const p = ev.payload;
		        next.handoffs = new Map(state.handoffs).set(ev.taskId, p);
		      }
		      next.tasks = new Map(state.tasks).set(ev.taskId, updated);
		      break;
		    }
		    // 评审事件（交付质量链）：非状态转换——按 payload.targetTaskId 更新被评审任务 reviewStatus
		    case "review/passed":
		    case "review/failed":
		    case "review/gave-up":
		    case "review/waived": {
		      const targetId = String(ev.payload["targetTaskId"] ?? "");
		      const t = state.tasks.get(targetId);
		      if (!t) throw new Error("projection: unknown review target " + targetId);
		      const status = ev.kind === "review/passed" ? "passed" : ev.kind === "review/failed" ? "failed" : ev.kind === "review/waived" ? "waived" : "gave-up";
		      next.tasks = new Map(state.tasks).set(targetId, { ...t, reviewStatus: status });
		      break;
		    }
		    case "spec-card/created":
		    case "spec-card/edited": {
		      const p = ev.payload;
		      next.specCards = new Map(state.specCards).set(p.id, p);
		      if (ev.kind === "spec-card/created") {
		        const c = state.chains.get(p.chainId);
		        if (c && !c.specCardId) {
		          next.chains = new Map(state.chains).set(p.chainId, { ...c, specCardId: p.id });
		        }
		      }
		      break;
		    }
		    case "spec-card/approved": {
		      const id = String(ev.payload["id"] ?? "");
		      const s = state.specCards.get(id);
		      if (!s) throw new Error("projection: unknown spec card " + id);
		      next.specCards = new Map(state.specCards).set(id, { ...s, status: transitionSpecCard(s.status, ev.kind), approvedAt: ev.at, approvedBy: ev.author });
		      break;
		    }
		  }
		  return next;
		}
		
		// client/board-store.ts
		function hydrate(wire) {
		  return {
		    chains: new Map(wire.chains.map((value) => [value.id, value])),
		    tasks: new Map(wire.tasks.map((value) => [value.id, value])),
		    specCards: new Map(wire.specCards.map((value) => [value.id, value])),
		    handoffs: new Map(wire.handoffs.map(({ id, ...value }) => [id, value])),
		    auditWarnings: new Map(wire.auditWarnings.map(({ chainId, ...value }) => [chainId, value])),
		    events: wire.events
		  };
		}
		var OPTIMISTIC_STATUS = {
		  block: "blocked",
		  unblock: "ready",
		  complete: "done",
		  archive: "archived",
		  retry: "running"
		};
		function applyOptimistic(board, taskId, status) {
		  const task = board.tasks.get(taskId);
		  if (!task || task.status === status) return board;
		  return { ...board, tasks: new Map(board.tasks).set(taskId, { ...task, status }) };
		}
		function createBoardStore(deps = {}) {
		  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
		  const eventSourceFactory = deps.eventSourceFactory ?? ((url) => new EventSource(url));
		  let snapshot = { board: null, lastSeq: -1, connection: "loading", lastSuccessAt: null, error: null, actionError: null };
		  const listeners = /* @__PURE__ */ new Set();
		  let generation = 0;
		  let source = null;
		  let started = false;
		  const commit = (patch) => {
		    snapshot = { ...snapshot, ...patch };
		    for (const listener of [...listeners]) listener();
		  };
		  const resync = async () => {
		    const gen = ++generation;
		    source?.close();
		    source = null;
		    commit({ connection: "loading" });
		    try {
		      const res = await fetchImpl("/kanban/board");
		      if (!res.ok) throw new Error(`board snapshot failed: ${res.status}`);
		      const wire = await res.json();
		      if (gen !== generation) return;
		      commit({
		        board: hydrate(wire),
		        lastSeq: wire.lastSeq,
		        connection: "ready",
		        lastSuccessAt: Date.now(),
		        error: null
		      });
		      installSource(gen, wire.lastSeq);
		    } catch (err) {
		      if (gen !== generation) return;
		      commit({ connection: "error", error: String(err) });
		    }
		  };
		  const installSource = (gen, lastSeq) => {
		    const next = eventSourceFactory(`/kanban/events?after=${lastSeq}`);
		    if (gen !== generation) {
		      next.close();
		      return;
		    }
		    source = next;
		    next.onopen = () => {
		      if (gen !== generation) return;
		      commit({ connection: "ready" });
		    };
		    next.onerror = () => {
		      if (gen !== generation) return;
		      commit({ connection: "reconnecting" });
		    };
		    next.onmessage = (message) => {
		      if (gen !== generation) return;
		      const event = JSON.parse(message.data);
		      if (event.seq <= snapshot.lastSeq) return;
		      if (event.seq === snapshot.lastSeq + 1) {
		        const board = snapshot.board ? applyTo(snapshot.board, event) : snapshot.board;
		        if (board) commit({ board, lastSeq: event.seq });
		        return;
		      }
		      void resync();
		    };
		  };
		  return {
		    async start() {
		      if (started) return;
		      started = true;
		      await resync();
		    },
		    stop() {
		      generation += 1;
		      source?.close();
		      source = null;
		      started = false;
		    },
		    async retry() {
		      if (!started) return;
		      await resync();
		    },
		    subscribe(listener) {
		      listeners.add(listener);
		      return () => {
		        listeners.delete(listener);
		      };
		    },
		    getSnapshot() {
		      return snapshot;
		    },
		    async postAction(action) {
		      const a = action;
		      const type = a.type ?? "";
		      const taskId = a.taskId ?? "";
		      const optimistic = taskId ? OPTIMISTIC_STATUS[type] : void 0;
		      const before = optimistic ? snapshot.board : void 0;
		      const beforeSeq = snapshot.lastSeq;
		      if (before && optimistic) commit({ actionError: null, board: applyOptimistic(before, taskId, optimistic) });
		      try {
		        const res = await fetchImpl("/kanban/action", {
		          method: "POST",
		          headers: { "Content-Type": "application/json" },
		          body: JSON.stringify(action)
		        });
		        const data = await res.json();
		        if (!res.ok || data.ok === false) throw new Error(data.error ?? "action failed");
		        commit({ actionError: null });
		        return data;
		      } catch (err) {
		        const patch = { actionError: { taskId, message: String(err) } };
		        if (before) patch.board = before;
		        commit(patch);
		        if (snapshot.lastSeq !== beforeSeq) void resync();
		        throw err;
		      }
		    }
		  };
		}
		
		// client/useKanbanBoard.ts
		var import_react = require("react");
		function useKanbanBoard(store) {
		  return (0, import_react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
		}
		
		// client/KanbanBoard.tsx
		var import_react6 = require("react");
		
		// client/workflow-model.ts
		var CHAIN_FILTERS = ["executing", "blocked", "failed", "completed"];
		var CHAIN_FILTER_LABEL = {
		  executing: "\u6267\u884C\u4E2D",
		  blocked: "\u963B\u585E",
		  failed: "\u5931\u8D25",
		  completed: "\u5DF2\u5B8C\u6210"
		};
		function chainFilterStateOf(chain, chainTasks) {
		  const archived = chain.status === "aborted" || chainTasks.length > 0 && chainTasks.every((t) => t.status === "archived");
		  const blocked = chain.status === "blocked" || chainTasks.some((t) => t.status === "blocked");
		  const failed = chainTasks.some((t) => t.status === "failed");
		  return {
		    executing: chain.status === "executing" && !blocked && !failed,
		    blocked,
		    failed,
		    completed: chain.status === "completed" || chain.status === "aborted" || archived,
		    archived
		  };
		}
		var STATUS_LABEL = {
		  triage: "\u5206\u8BCA",
		  todo: "\u5F85\u529E",
		  ready: "\u5C31\u7EEA",
		  running: "\u6267\u884C\u4E2D",
		  blocked: "\u53D7\u963B",
		  done: "\u5B8C\u6210",
		  failed: "\u5931\u8D25",
		  archived: "\u5DF2\u5F52\u6863"
		};
		function statusLabelOf(status) {
		  return STATUS_LABEL[status];
		}
		function phaseOf(task, ordered) {
		  if (task.assignee === "p") return "P";
		  if (task.assignee === "d") return "D";
		  if (task.assignee === "w" && task.mode === "kb") {
		    const dIndex = ordered.findIndex((value) => value.assignee === "d");
		    return dIndex >= 0 && ordered.indexOf(task) > dIndex ? "W3" : "W2";
		  }
		  return task.assignee.toUpperCase();
		}
		function lineStateOf(task, selectedTaskId) {
		  if (task.status === "blocked" || task.status === "failed") return "blocked";
		  if (task.id === selectedTaskId || task.status === "running") return "active";
		  if (task.status === "done" || task.status === "archived") return "complete";
		  return "pending";
		}
		function taskOrder(tasks, state) {
		  const seq = /* @__PURE__ */ new Map();
		  for (const ev of state.events) {
		    if (ev.kind === "task/created" && ev.taskId) seq.set(ev.taskId, ev.seq);
		  }
		  return [...tasks].sort((a, b) => {
		    const aSeq = seq.get(a.id) ?? Number.MAX_SAFE_INTEGER;
		    const bSeq = seq.get(b.id) ?? Number.MAX_SAFE_INTEGER;
		    return aSeq - bSeq || a.id.localeCompare(b.id);
		  });
		}
		function activityLabel(task, state, now) {
		  let lastAt = 0;
		  for (const h of task.heartbeats) lastAt = Math.max(lastAt, h);
		  for (const ev of state.events) {
		    if (ev.taskId === task.id) lastAt = Math.max(lastAt, ev.at);
		  }
		  if (!lastAt) return "\u5F85\u542F\u52A8";
		  const diff = Math.max(0, now - lastAt);
		  if (diff < 6e4) return "\u521A\u521A";
		  if (diff < 36e5) return `${Math.floor(diff / 6e4)}m`;
		  if (diff < 864e5) return `${Math.floor(diff / 36e5)}h`;
		  return `${Math.floor(diff / 864e5)}d`;
		}
		function blockedSummary(chainId, state) {
		  if (state.chains.get(chainId)?.status === "blocked") {
		    const ev2 = [...state.events].reverse().find((e) => e.chainId === chainId && e.kind === "chain/blocked");
		    return String(ev2?.payload["reason"] ?? "") || "\u94FE\u7EA7\u963B\u585E\uFF08\u539F\u56E0\u672A\u8BB0\u5F55\uFF09";
		  }
		  const blockedIds = new Set(
		    [...state.tasks.values()].filter((t) => t.chainId === chainId && (t.status === "blocked" || t.status === "failed")).map((t) => t.id)
		  );
		  if (blockedIds.size === 0) return null;
		  const ev = [...state.events].reverse().find((e) => e.chainId === chainId && e.taskId !== null && blockedIds.has(e.taskId) && (e.kind === "task/blocked" || e.kind === "task/failed"));
		  return ev ? String(ev.payload["reason"] ?? "") : null;
		}
		function relatedIds(state, chainId, selectedTaskId) {
		  const set = /* @__PURE__ */ new Set();
		  const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chainId);
		  const byId = new Map(chainTasks.map((t) => [t.id, t]));
		  const childrenBy = /* @__PURE__ */ new Map();
		  for (const t of chainTasks) {
		    for (const p of t.parents) {
		      const list = childrenBy.get(p) ?? [];
		      list.push(t.id);
		      childrenBy.set(p, list);
		    }
		  }
		  if (!byId.has(selectedTaskId)) return set;
		  set.add(selectedTaskId);
		  let frontier = [selectedTaskId];
		  while (frontier.length > 0) {
		    const next = [];
		    for (const id of frontier) {
		      const t = byId.get(id);
		      if (!t) continue;
		      for (const p of t.parents) if (byId.has(p) && !set.has(p)) {
		        set.add(p);
		        next.push(p);
		      }
		      for (const c of childrenBy.get(id) ?? []) if (byId.has(c) && !set.has(c)) {
		        set.add(c);
		        next.push(c);
		      }
		    }
		    frontier = next;
		  }
		  return set;
		}
		function sortRankOf(chain, tasks) {
		  if (chain.status === "blocked") return 0;
		  if (tasks.some((t) => t.status === "blocked" || t.status === "failed")) return 0;
		  if (chain.status === "executing") return 1;
		  if (chain.status === "planning") return 2;
		  return 3;
		}
		function deriveWorkflowBoard(state, opts) {
		  const filter = opts.statusFilter ?? /* @__PURE__ */ new Set();
		  const views = [];
		  for (const chain of state.chains.values()) {
		    const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chain.id);
		    const st = chainFilterStateOf(chain, chainTasks);
		    const archived = st.archived;
		    const matchesFilter = filter.has("executing") && st.executing || filter.has("blocked") && st.blocked || filter.has("failed") && st.failed || filter.has("completed") && st.completed;
		    const selectedInChain = opts.selectedTaskId != null && chainTasks.some((t) => t.id === opts.selectedTaskId);
		    if (selectedInChain) {
		    } else if (filter.size > 0) {
		      if (!matchesFilter) continue;
		    } else if (archived) continue;
		    const ordered = taskOrder(chainTasks, state);
		    const related = opts.selectedTaskId ? relatedIds(state, chain.id, opts.selectedTaskId) : /* @__PURE__ */ new Set();
		    let lastActivityAt = chain.createdAt;
		    for (const ev of state.events) {
		      if (ev.chainId === chain.id) lastActivityAt = Math.max(lastActivityAt, ev.at);
		    }
		    const auditRec = state.auditWarnings.get(chain.id);
		    views.push({
		      chain,
		      sortRank: sortRankOf(chain, chainTasks),
		      lastActivityAt,
		      blockedSummary: blockedSummary(chain.id, state),
		      audit: auditRec ? {
		        warned: true,
		        confirmed: auditRec.confirmedAt !== null,
		        evidenceCount: auditRec.evidence.length,
		        evidence: auditRec.evidence
		      } : null,
		      tasks: ordered.map((task) => ({
		        task,
		        phase: phaseOf(task, ordered),
		        statusLabel: statusLabelOf(task.status),
		        activityLabel: activityLabel(task, state, opts.now),
		        // D15/D17：阻塞/失败任务优先展示阻塞原因，其余展示父依赖
		        dependencyLabel: task.status === "blocked" || task.status === "failed" ? blockedSummary(chain.id, state) ?? "" : task.parents.map((id) => state.tasks.get(id)?.title ?? id).join(", "),
		        lineState: lineStateOf(task, opts.selectedTaskId),
		        selected: task.id === opts.selectedTaskId,
		        related: opts.selectedTaskId === task.id || related.has(task.id)
		      }))
		    });
		  }
		  views.sort((a, b) => a.sortRank - b.sortRank || b.lastActivityAt - a.lastActivityAt);
		  return views;
		}
		
		// client/WorkflowRail.tsx
		var import_react4 = require("react");
		
		// client/session-bridge.ts
		var import_react2 = require("react");
		var service = null;
		function setSessionsService(next) {
		  service = next;
		}
		var EMPTY = /* @__PURE__ */ new Set();
		var cache = { source: void 0, ids: EMPTY };
		function useSessionIds() {
		  return (0, import_react2.useSyncExternalStore)(
		    (onChange) => service?.list.subscribe(onChange) ?? (() => {
		    }),
		    () => {
		      if (!service) return EMPTY;
		      const snap = service.list.getSnapshot();
		      if (cache.source !== snap) {
		        const next = snap.ids;
		        const prev = cache.ids;
		        const same = prev.size === next.length && [...next].every((id) => prev.has(id));
		        cache = same ? { source: snap, ids: prev } : { source: snap, ids: new Set(next) };
		      }
		      return cache.ids;
		    },
		    () => EMPTY
		  );
		}
		function openSession(id) {
		  if (!service) throw new Error("sessions service unavailable");
		  service.open(id);
		}
		
		// client/BoardCard.tsx
		var import_jsx_runtime = require("react/jsx-runtime");
		function BoardCard(props) {
		  const { view } = props;
		  const { task } = view;
		  const blocked = view.lineState === "blocked" && view.dependencyLabel.length > 0;
		  const sessionIds = useSessionIds();
		  const sessionId = task.resumeSessionId ?? task.sessionId;
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
		    "div",
		    {
		      role: "button",
		      tabIndex: 0,
		      className: `dsh-kb-task dsh-kb-task--${view.lineState}${view.related ? " dsh-kb-task--related" : ""}`,
		      "data-selected": view.selected || void 0,
		      onClick: () => props.onOpen(task.id),
		      onKeyDown: (e) => {
		        if (e.key === "Enter" || e.key === " ") {
		          e.preventDefault();
		          props.onOpen(task.id);
		        }
		      },
		      "aria-label": `${view.phase} ${task.title} ${view.statusLabel}`,
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dsh-kb-profile dsh-kb-profile--${task.assignee}`, children: task.assignee.toUpperCase() }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-kb-task__title", children: task.title }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-kb-task__status-row", children: [
		          sessionIds.has(sessionId) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "button",
		            {
		              type: "button",
		              className: "dsh-kb-task__session",
		              onClick: (e) => {
		                e.stopPropagation();
		                openSession(sessionId);
		                props.onOpenView?.("chat", sessionId);
		                window.setTimeout(() => props.onOpenView?.("chat", sessionId), 500);
		              },
		              onKeyDown: (e) => {
		                e.stopPropagation();
		              },
		              children: "\u4F1A\u8BDD"
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-kb-task__status", children: view.statusLabel })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-kb-task__meta", children: [
		          view.phase,
		          " \xB7 ",
		          view.activityLabel,
		          !blocked && view.dependencyLabel ? ` \xB7 ${view.dependencyLabel}` : ""
		        ] }),
		        blocked && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-kb-task__warn", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 16 16", width: "12", height: "12", "aria-hidden": "true", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 1.5 14.5 13.5h-13L8 1.5Z", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 6.2v3.6", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "8", cy: "11.6", r: "0.9", fill: "currentColor" })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: view.dependencyLabel })
		        ] })
		      ]
		    }
		  );
		}
		
		// client/RenameModal.tsx
		var import_react3 = require("react");
		var import_jsx_runtime2 = require("react/jsx-runtime");
		function RenameModal(props) {
		  const [value, setValue] = (0, import_react3.useState)(props.initialValue);
		  const save = () => {
		    const next = value.trim();
		    if (next) props.onSave(next);
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-kb-rename-overlay", onClick: (e) => {
		    e.stopPropagation();
		    props.onCancel();
		  }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		    "div",
		    {
		      className: "dsh-kb-rename-modal",
		      role: "dialog",
		      "aria-modal": "true",
		      "aria-label": props.title,
		      onClick: (e) => e.stopPropagation(),
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-kb-rename-modal__label", children: props.title }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		          "input",
		          {
		            className: "dsh-kb-rename-modal__input",
		            "aria-label": props.title,
		            value,
		            autoFocus: true,
		            onChange: (e) => setValue(e.target.value),
		            onKeyDown: (e) => {
		              if (e.key === "Enter") save();
		              if (e.key === "Escape") props.onCancel();
		            }
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-kb-rename-modal__actions", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dsh-kb-rename-cancel", onClick: props.onCancel, children: "\u53D6\u6D88" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dsh-kb-rename-save", onClick: save, children: "\u4FDD\u5B58" })
		        ] })
		      ]
		    }
		  ) });
		}
		
		// client/WorkflowRail.tsx
		var import_jsx_runtime3 = require("react/jsx-runtime");
		function matches(view, query) {
		  const q = query.trim().toLowerCase();
		  if (!q) return true;
		  if (view.chain.title.toLowerCase().includes(q)) return true;
		  return view.tasks.some((item) => item.task.title.toLowerCase().includes(q));
		}
		function WorkflowRail(props) {
		  const searching = props.query.trim().length > 0;
		  const visible = props.chains.filter((view) => matches(view, props.query));
		  const [renamingChainId, setRenamingChainId] = (0, import_react4.useState)(null);
		  const renamingChain = renamingChainId ? props.chains.find((v) => v.chain.id === renamingChainId)?.chain : void 0;
		  const [deletingChainId, setDeletingChainId] = (0, import_react4.useState)(null);
		  const [deleteError, setDeleteError] = (0, import_react4.useState)(null);
		  const [reopeningChainId, setReopeningChainId] = (0, import_react4.useState)(null);
		  const [reopenReason, setReopenReason] = (0, import_react4.useState)("");
		  const [reopenError, setReopenError] = (0, import_react4.useState)(null);
		  const [reopenBusy, setReopenBusy] = (0, import_react4.useState)(false);
		  const [reopenOk, setReopenOk] = (0, import_react4.useState)(false);
		  const reopeningView = reopeningChainId ? props.chains.find((v) => v.chain.id === reopeningChainId) : void 0;
		  const closeReopen = () => {
		    setReopeningChainId(null);
		    setReopenReason("");
		    setReopenError(null);
		    setReopenOk(false);
		  };
		  const confirmReopen = async () => {
		    if (!reopeningChainId) return;
		    if (!reopenReason.trim()) {
		      setReopenError("\u8BF7\u586B\u5199\u6062\u590D\u7406\u7531\uFF08\u5FC5\u586B\uFF0C\u7528\u4E8E\u5BA1\u8BA1\u7559\u75D5\uFF09");
		      return;
		    }
		    setReopenError(null);
		    setReopenBusy(true);
		    try {
		      await props.onReopenChain?.(reopeningChainId, reopenReason.trim());
		      setReopenOk(true);
		      window.setTimeout(() => closeReopen(), 800);
		    } catch (err) {
		      setReopenError("\u6062\u590D\u5931\u8D25\uFF1A" + String(err));
		    } finally {
		      setReopenBusy(false);
		    }
		  };
		  const deletingView = deletingChainId ? props.chains.find((v) => v.chain.id === deletingChainId) : void 0;
		  const confirmDelete = async () => {
		    if (!deletingChainId) return;
		    setDeleteError(null);
		    try {
		      await props.onDeleteChain?.(deletingChainId);
		      setDeletingChainId(null);
		    } catch (err) {
		      setDeleteError(String(err));
		    }
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-kb-rail", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-filters", role: "group", "aria-label": "\u6309\u94FE\u8DEF\u72B6\u6001\u7B5B\u9009", children: CHAIN_FILTERS.map((f) => {
		      const active = props.statusFilter.has(f);
		      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		        "button",
		        {
		          type: "button",
		          className: `dsh-kb-filter${active ? " dsh-kb-filter--active" : ""}`,
		          "aria-pressed": active,
		          onClick: () => props.onToggleFilter(f),
		          children: CHAIN_FILTER_LABEL[f]
		        },
		        f
		      );
		    }) }),
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-rail__list", role: "list", "aria-label": "\u4EFB\u52A1\u94FE\u8DEF", children: visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-empty", role: "status", children: searching ? "\u65E0\u5339\u914D\u94FE\u8DEF" : "\u6682\u65E0\u770B\u677F\u4EFB\u52A1\uFF0C\u8F93\u5165 /plan: \u5F00\u542F\u65B0\u94FE\u8DEF" }) : visible.map((view) => {
		      const matched = searching ? view.tasks.filter((item) => item.task.title.toLowerCase().includes(props.query.trim().toLowerCase())) : view.tasks;
		      const expanded = searching || !props.collapsedChainIds.has(view.chain.id);
		      const done = view.tasks.filter((item) => item.task.status === "done" || item.task.status === "archived").length;
		      const blocked = view.tasks.some((item) => item.task.status === "blocked" || item.task.status === "failed");
		      const summary = view.blockedSummary ?? (blocked ? "\u94FE\u8DEF\u53D7\u963B" : `${done}/${view.tasks.length}`);
		      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: `dsh-kb-chain dsh-kb-chain--${view.chain.status}`, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
		          "div",
		          {
		            role: "button",
		            tabIndex: 0,
		            className: "dsh-kb-chain__title",
		            "aria-expanded": expanded,
		            onClick: () => props.onToggleChain(view.chain.id),
		            onKeyDown: (e) => {
		              if (e.key === "Enter" || e.key === " ") {
		                e.preventDefault();
		                props.onToggleChain(view.chain.id);
		              }
		            },
		            children: [
		              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-kb-chain__chevron", "aria-hidden": "true" }),
		              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-kb-chain__name", children: view.chain.title }),
		              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dsh-kb-chain__meta", children: [
		                done,
		                "/",
		                view.tasks.length
		              ] }),
		              props.onDeleteChain && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		                "button",
		                {
		                  type: "button",
		                  className: "dsh-kb-chain__delete",
		                  "aria-label": "\u5220\u9664\u9700\u6C42",
		                  title: "\u5220\u9664\u9700\u6C42\uFF08\u6574\u94FE\u786C\u5220\u9664\uFF0C\u4E0D\u53EF\u6062\u590D\uFF09",
		                  onClick: (e) => {
		                    e.stopPropagation();
		                    setDeleteError(null);
		                    setDeletingChainId(view.chain.id);
		                  },
		                  onKeyDown: (e) => {
		                    e.stopPropagation();
		                  },
		                  children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("svg", { viewBox: "0 0 16 16", width: "12", height: "12", "aria-hidden": "true", children: [
		                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4", fill: "none", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }),
		                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("path", { d: "M6.6 6.5v4.5M9.4 6.5v4.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" })
		                  ] })
		                }
		              ),
		              props.onRenameChain && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		                "button",
		                {
		                  type: "button",
		                  className: "dsh-kb-chain__rename",
		                  "aria-label": "\u6539\u94FE\u6807\u9898",
		                  title: "\u4FEE\u6539\u94FE\u8DEF\u6807\u9898",
		                  onClick: (e) => {
		                    e.stopPropagation();
		                    setRenamingChainId(view.chain.id);
		                  },
		                  onKeyDown: (e) => {
		                    e.stopPropagation();
		                  },
		                  children: "\u270E"
		                }
		              ),
		              props.onReopenChain && view.chain.status === "blocked" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		                "button",
		                {
		                  type: "button",
		                  className: "dsh-kb-chain__reopen",
		                  "aria-label": "\u4EBA\u5DE5\u6062\u590D\u94FE\u8DEF",
		                  title: "\u5C06 blocked \u94FE\u6062\u590D\u4E3A executing\uFF0C\u7F16\u6392\u5668\u7EE7\u7EED\u63A8\u8FDB\u540E\u7EED\u9636\u6BB5",
		                  onClick: (e) => {
		                    e.stopPropagation();
		                    setReopenError(null);
		                    setReopenReason("");
		                    setReopeningChainId(view.chain.id);
		                  },
		                  onKeyDown: (e) => {
		                    e.stopPropagation();
		                  },
		                  children: "\u6062\u590D"
		                }
		              )
		            ]
		          }
		        ),
		        (blocked || view.blockedSummary) && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-chain__warning", title: summary, children: summary }),
		        view.audit && !view.audit.confirmed && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-kb-chain__warning dsh-kb-chain__audit", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
		            "\u26A0 \u4E3B agent \u7591\u4F3C\u8D8A\u6743\u5199\u5DE5\u4F5C\u533A\u4EA7\u7269\uFF08",
		            view.audit.evidenceCount,
		            " \u6761\u7EBF\u7D22\uFF09\uFF0C\u6700\u7EC8\u6C47\u62A5\u5DF2\u963B\u585E\uFF0C\u8BF7\u6838\u5BF9\u4EA7\u7269\u5F52\u5C5E"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-kb-audit-confirm", onClick: () => props.onConfirmAudit?.(view.chain.id), children: "\u786E\u8BA4\u4EA7\u7269\u5F52\u5C5E" })
		        ] }),
		        expanded && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ol", { className: "dsh-kb-nodes", children: (matched.length > 0 ? matched : view.tasks).map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("li", { className: `dsh-kb-node dsh-kb-node--${item.lineState}`, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(BoardCard, { view: item, onOpen: props.onOpenTask, onOpenView: props.onOpenView }) }, item.task.id)) })
		      ] }, view.chain.id);
		    }) }),
		    renamingChain && props.onRenameChain && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		      RenameModal,
		      {
		        title: "\u6539\u94FE\u6807\u9898",
		        initialValue: renamingChain.title,
		        onSave: (title) => {
		          props.onRenameChain?.(renamingChain.id, title);
		          setRenamingChainId(null);
		        },
		        onCancel: () => setRenamingChainId(null)
		      }
		    ),
		    reopeningView && props.onReopenChain && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-rename-overlay", onClick: (e) => {
		      e.stopPropagation();
		      closeReopen();
		    }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
		      "div",
		      {
		        className: "dsh-kb-rename-modal",
		        role: "dialog",
		        "aria-modal": "true",
		        "aria-label": "\u4EBA\u5DE5\u6062\u590D\u94FE\u8DEF",
		        onClick: (e) => e.stopPropagation(),
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-rename-modal__label", children: "\u4EBA\u5DE5\u6062\u590D\u94FE\u8DEF" }),
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-kb-delete-modal__text", children: [
		            "\u5C06\u300C",
		            reopeningView.chain.title || "\u672A\u547D\u540D\u9700\u6C42",
		            "\u300D\u4ECE blocked \u6062\u590D\u4E3A executing\uFF0C\u7F16\u6392\u5668\u7EE7\u7EED\u63A8\u8FDB\u540E\u7EED\u9636\u6BB5\u3002"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		            "input",
		            {
		              className: "dsh-kb-comment-input",
		              "aria-label": "\u6062\u590D\u7406\u7531",
		              placeholder: "\u6062\u590D\u7406\u7531\uFF08\u5FC5\u586B\uFF09",
		              autoFocus: true,
		              value: reopenReason,
		              onChange: (e) => {
		                setReopenReason(e.target.value);
		                if (reopenError) setReopenError(null);
		              },
		              onKeyDown: (e) => {
		                if (e.key === "Enter") void confirmReopen();
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-rename-modal__hint", children: "\u6062\u590D\u7406\u7531\u5FC5\u586B\uFF08\u5BA1\u8BA1\u7559\u75D5\uFF09\uFF1B\u586B\u5199\u540E\u70B9\u300C\u786E\u8BA4\u6062\u590D\u300D\u3002" }),
		          reopenError && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-delete-modal__error", role: "alert", children: reopenError }),
		          reopenOk && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-rename-modal__success", role: "status", children: "\u2713 \u5DF2\u6062\u590D\uFF0C\u7F16\u6392\u5668\u5C06\u7EE7\u7EED\u63A8\u8FDB\u540E\u7EED\u9636\u6BB5" }),
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-kb-rename-modal__actions", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-kb-rename-cancel", disabled: reopenBusy, onClick: closeReopen, children: "\u53D6\u6D88" }),
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-kb-rename-save", disabled: reopenBusy || reopenOk, onClick: () => void confirmReopen(), children: reopenOk ? "\u5DF2\u6062\u590D" : reopenBusy ? "\u6062\u590D\u4E2D\u2026" : "\u786E\u8BA4\u6062\u590D" })
		          ] })
		        ]
		      }
		    ) }),
		    deletingView && props.onDeleteChain && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-rename-overlay", onClick: (e) => {
		      e.stopPropagation();
		      setDeletingChainId(null);
		    }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
		      "div",
		      {
		        className: "dsh-kb-rename-modal",
		        role: "dialog",
		        "aria-modal": "true",
		        "aria-label": "\u5220\u9664\u9700\u6C42",
		        onClick: (e) => e.stopPropagation(),
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-rename-modal__label", children: "\u5220\u9664\u9700\u6C42" }),
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-kb-delete-modal__text", children: [
		            "\u5C06\u6C38\u4E45\u5220\u9664\u300C",
		            deletingView.chain.title || "\u672A\u547D\u540D\u9700\u6C42",
		            "\u300D\u53CA\u5176\u4E0B ",
		            deletingView.tasks.length,
		            " \u5F20\u89D2\u8272\u5361\uFF0C\u4E0D\u53EF\u6062\u590D\u3002\u786E\u8BA4\u5220\u9664\uFF1F"
		          ] }),
		          deleteError && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-kb-delete-modal__error", role: "alert", children: [
		            "\u5220\u9664\u5931\u8D25\uFF1A",
		            deleteError
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-kb-rename-modal__actions", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-kb-rename-cancel", onClick: () => setDeletingChainId(null), children: "\u53D6\u6D88" }),
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-kb-delete-confirm", onClick: () => void confirmDelete(), children: "\u5220\u9664" })
		          ] })
		        ]
		      }
		    ) })
		  ] });
		}
		
		// client/TaskDrawer.tsx
		var import_react5 = require("react");
		
		// client/timeline-model.ts
		var EXCEPTION_KINDS = /* @__PURE__ */ new Set([
		  "task/blocked",
		  "task/failed",
		  "task/gate-failed",
		  "task/gate-skipped",
		  "review/failed",
		  "review/gave-up",
		  "chain/audit-warning",
		  "chain/aborted"
		]);
		var STATUS_OF = {
		  "chain/created": "neutral",
		  "chain/executing": "running",
		  "chain/completed": "success",
		  "chain/aborted": "exception",
		  "chain/blocked": "exception",
		  "chain/root-task-set": "neutral",
		  "chain/audit-warning": "exception",
		  "chain/audit-confirmed": "neutral",
		  "chain/title-updated": "neutral",
		  "chain/im-delivery-failed": "exception",
		  // IM 投递失败留痕（非状态转换注记）
		  "chain/reopened": "running",
		  // 人工恢复（blocked → executing）
		  "review/waived": "success",
		  // 人工评审豁免（放行）
		  "spec-card/created": "neutral",
		  "spec-card/edited": "neutral",
		  "spec-card/approved": "success",
		  "task/created": "neutral",
		  "task/claimed": "running",
		  "task/heartbeat": "running",
		  "task/commented": "neutral",
		  "task/completed": "success",
		  "task/blocked": "exception",
		  "task/unblocked": "neutral",
		  "task/archived": "neutral",
		  "task/failed": "exception",
		  "task/gate-passed": "success",
		  // P1 实测闸
		  "task/gate-failed": "exception",
		  "task/gate-skipped": "exception",
		  // PR1 互证警报：闸本该跑却没跑
		  "task/renamed": "neutral",
		  "review/passed": "success",
		  "review/failed": "exception",
		  "review/gave-up": "exception",
		  "review/evidence-check": "neutral"
		  // PR2 证据核验汇总（differs 详情在 summary，事件本体中立）
		};
		function timelineStatusOf(kind) {
		  return STATUS_OF[kind] ?? "neutral";
		}
		var KIND_LABEL = {
		  "chain/created": "\u94FE\u8DEF\u521B\u5EFA",
		  "chain/executing": "\u94FE\u8DEF\u5F00\u59CB\u6267\u884C",
		  "chain/completed": "\u94FE\u8DEF\u5B8C\u6210",
		  "chain/aborted": "\u94FE\u8DEF\u4E2D\u6B62",
		  "chain/blocked": "\u94FE\u8DEF\u963B\u585E",
		  "chain/root-task-set": "\u8BBE\u4E3A\u6839\u4EFB\u52A1",
		  "chain/audit-warning": "\u8D8A\u6743\u8B66\u544A",
		  "chain/audit-confirmed": "\u8D8A\u6743\u5DF2\u786E\u8BA4",
		  "chain/title-updated": "\u94FE\u8DEF\u6539\u540D",
		  "chain/im-delivery-failed": "IM \u6295\u9012\u5931\u8D25",
		  "chain/reopened": "\u4EBA\u5DE5\u6062\u590D\u94FE\u8DEF",
		  "spec-card/created": "\u89C4\u683C\u5361\u521B\u5EFA",
		  "spec-card/edited": "\u89C4\u683C\u5361\u7F16\u8F91",
		  "spec-card/approved": "\u89C4\u683C\u5361\u6279\u51C6",
		  "task/created": "\u4EFB\u52A1\u521B\u5EFA",
		  "task/claimed": "\u4EFB\u52A1\u8BA4\u9886",
		  "task/heartbeat": "\u4EFB\u52A1\u5FC3\u8DF3",
		  "task/commented": "\u8BC4\u8BBA",
		  "task/completed": "\u4EFB\u52A1\u5B8C\u6210",
		  "task/blocked": "\u4EFB\u52A1\u963B\u585E",
		  "task/unblocked": "\u89E3\u9664\u963B\u585E",
		  "task/archived": "\u4EFB\u52A1\u5F52\u6863",
		  "task/failed": "\u4EFB\u52A1\u5931\u8D25",
		  "task/gate-passed": "\u5B9E\u6D4B\u95F8\u901A\u8FC7",
		  // P1 实测闸
		  "task/gate-failed": "\u5B9E\u6D4B\u95F8\u5931\u8D25",
		  "task/gate-skipped": "\u5B9E\u6D4B\u95F8\u8DF3\u8FC7\uFF08\u58F0\u660E\uFF09",
		  "task/renamed": "\u4EFB\u52A1\u6539\u540D",
		  "review/passed": "\u8BC4\u5BA1\u901A\u8FC7",
		  "review/failed": "\u8BC4\u5BA1\u9A73\u56DE",
		  "review/gave-up": "\u8BC4\u5BA1\u8D85\u9650\u653E\u5F03",
		  "review/waived": "\u8BC4\u5BA1\u8C41\u514D",
		  "review/evidence-check": "\u8BC1\u636E\u6838\u9A8C\uFF08\u91CD\u653E\uFF09"
		};
		var AUTHOR_NAME = {
		  v: "orchestrator",
		  p: "planner",
		  w: "wiki-bridge",
		  d: "fullstack-dev",
		  pt: "plan-review",
		  dt: "impl-review",
		  system: "\u7CFB\u7EDF",
		  human: "\u4F60"
		};
		function eventLabelOf(kind) {
		  return KIND_LABEL[kind] ?? kind;
		}
		function isExceptionEvent(e) {
		  return EXCEPTION_KINDS.has(e.kind);
		}
		function authorNameOf(author) {
		  return AUTHOR_NAME[author] ?? author;
		}
		function asRecord(value) {
		  return typeof value === "object" && value !== null ? value : {};
		}
		function strField(rec, key) {
		  const v = rec[key];
		  return typeof v === "string" ? v : "";
		}
		function truncate(text, max = 120) {
		  return text.length <= max ? text : `${text.slice(0, max)}\u2026`;
		}
		function eventSummary(e) {
		  const payload = asRecord(e.payload);
		  switch (e.kind) {
		    case "task/completed": {
		      const summary = truncate(strField(payload, "summary"));
		      return summary;
		    }
		    case "task/blocked":
		    case "task/failed":
		      return truncate(strField(payload, "reason"));
		    case "task/gate-passed":
		    case "task/gate-failed":
		      return truncate(strField(payload, "detail"));
		    case "task/gate-skipped":
		      return truncate(strField(payload, "reason"));
		    case "task/commented":
		      return truncate(strField(payload, "body"));
		    case "task/renamed":
		    case "chain/title-updated": {
		      const from = strField(payload, "from");
		      const to = strField(payload, "to");
		      return from || to ? `${from} \u2192 ${to}` : "";
		    }
		    case "review/passed":
		    case "review/failed":
		    case "review/gave-up": {
		      const evidence = asRecord(payload["evidence"]);
		      const verdict = strField(evidence, "verdict") || strField(payload, "verdict");
		      const issues = Array.isArray(evidence["issues"]) ? evidence["issues"].length : void 0;
		      const parts = [];
		      if (verdict) parts.push(`verdict: ${verdict}`);
		      if (issues !== void 0) parts.push(`issues: ${issues}`);
		      const reason = strField(payload, "reason");
		      if (reason) parts.push(reason);
		      return truncate(parts.join(" \xB7 "));
		    }
		    case "review/evidence-check": {
		      const results = Array.isArray(payload["results"]) ? payload["results"] : [];
		      const counts = results.reduce((acc, r) => {
		        const s = String(r["state"] ?? "?");
		        acc[s] = (acc[s] ?? 0) + 1;
		        return acc;
		      }, {});
		      return truncate(Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" \xB7 "));
		    }
		    default:
		      return "";
		  }
		}
		function foldTimeline(events) {
		  const sorted = [...events].sort((a, b) => b.seq - a.seq);
		  const items = [];
		  for (const e of sorted) {
		    if (e.kind !== "task/heartbeat") {
		      items.push({
		        seq: e.seq,
		        kind: e.kind,
		        label: eventLabelOf(e.kind),
		        author: authorNameOf(e.author),
		        at: e.at,
		        summary: eventSummary(e),
		        exception: isExceptionEvent(e),
		        status: timelineStatusOf(e.kind)
		      });
		      continue;
		    }
		    const prev = items[items.length - 1];
		    if (prev && prev.kind === "task/heartbeat") {
		      prev.count = (prev.count ?? 1) + 1;
		      prev.lastAt = e.at;
		    } else {
		      items.push({
		        seq: e.seq,
		        kind: e.kind,
		        label: eventLabelOf(e.kind),
		        author: authorNameOf(e.author),
		        at: e.at,
		        lastAt: e.at,
		        count: 1,
		        summary: "",
		        exception: false,
		        status: timelineStatusOf(e.kind)
		      });
		    }
		  }
		  return items;
		}
		
		// client/TaskDrawer.tsx
		var import_jsx_runtime4 = require("react/jsx-runtime");
		var ROLE_NAME = {
		  v: "orchestrator",
		  p: "planner",
		  w: "wiki-bridge",
		  d: "fullstack-dev",
		  pt: "plan-review",
		  dt: "impl-review"
		};
		var TABS = [
		  ["overview", "\u6982\u89C8"],
		  ["timeline", "\u8F68\u8FF9"],
		  ["handoff", "\u4EA4\u63A5"],
		  ["spec", "\u89C4\u683C"],
		  ["comments", "\u8BC4\u8BBA"]
		];
		function formatValue(value) {
		  if (Array.isArray(value)) return value.map(String).join(", ");
		  if (typeof value === "object" && value !== null) return JSON.stringify(value);
		  return String(value ?? "");
		}
		function formatTime(at) {
		  return new Date(at).toLocaleString();
		}
		function TaskDrawer(props) {
		  const { task, events, handoff, specCard, chain } = props;
		  const [tab, setTab] = (0, import_react5.useState)("overview");
		  const [pending, setPending] = (0, import_react5.useState)(null);
		  const [waiveError, setWaiveError] = (0, import_react5.useState)(null);
		  const [waiveBusy, setWaiveBusy] = (0, import_react5.useState)(false);
		  const [waiveOk, setWaiveOk] = (0, import_react5.useState)(false);
		  const timeline = events.filter((e) => e.taskId === task.id).toSorted((a, b) => a.seq - b.seq);
		  const comments = timeline.filter((e) => e.kind === "task/commented");
		  const reviewOutcome = task.mode === "review-plan" || task.mode === "review-impl" ? events.filter((e) => e.taskId === task.id && e.kind.startsWith("review/")).at(-1)?.kind ?? null : null;
		  const canWaive = reviewOutcome === "review/failed" || reviewOutcome === "review/gave-up";
		  const submitComment = (el) => {
		    const value = el.value.trim();
		    if (!value) return;
		    props.onComment(value);
		    el.value = "";
		  };
		  const arm = (kind) => {
		    setPending({ kind, value: "" });
		    if (kind === "archive") {
		      window.setTimeout(() => setPending((current) => current?.kind === "archive" ? null : current), 3e3);
		    }
		  };
		  const submitArchive = () => {
		    if (pending?.kind !== "archive") return;
		    setPending(null);
		    props.onAction({ type: "archive", taskId: task.id });
		  };
		  const submitWaive = async () => {
		    if (pending?.kind !== "waive") return;
		    const reason = pending.value.trim();
		    if (!reason) {
		      setWaiveError("\u8BF7\u586B\u5199\u8C41\u514D\u7406\u7531\uFF08\u5FC5\u586B\uFF0C\u7528\u4E8E\u5BA1\u8BA1\u7559\u75D5\uFF09");
		      return;
		    }
		    setWaiveError(null);
		    setWaiveBusy(true);
		    try {
		      await props.onAction({ type: "waive-review", taskId: task.id, reason });
		      setWaiveOk(true);
		      window.setTimeout(() => {
		        setPending(null);
		        setWaiveOk(false);
		      }, 800);
		    } catch (err) {
		      setWaiveError("\u8C41\u514D\u5931\u8D25\uFF1A" + String(err));
		    } finally {
		      setWaiveBusy(false);
		    }
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-kb-detail", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("header", { className: "dsh-kb-detail__header", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "aria-label": "\u8FD4\u56DE\u4EFB\u52A1\u5217\u8868", onClick: props.onClose, children: "\u2190" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `dsh-kb-profile dsh-kb-profile--${task.assignee}`, children: task.assignee.toUpperCase() }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-kb-detail__identity", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: task.title }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
		          task.id,
		          " \xB7 ",
		          task.mode,
		          " \xB7 attempt ",
		          task.attempts + 1
		        ] })
		      ] }),
		      props.unreadCount ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { type: "button", className: "dsh-kb-unread", onClick: () => setTab("timeline"), children: [
		        props.unreadCount,
		        " \u6761\u65B0\u66F4\u65B0"
		      ] }) : null,
		      !props.readOnly && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-kb-detail__actions", children: [
		        task.status === "blocked" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => props.onAction({ type: "unblock", taskId: task.id }), children: "\u89E3\u9664\u963B\u585E" }),
		        task.status === "failed" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => props.onAction({ type: "retry", taskId: task.id }), children: "\u91CD\u8BD5" }),
		        ["done", "failed", "blocked"].includes(task.status) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-confirming": pending?.kind === "archive" || void 0, onClick: pending?.kind === "archive" ? submitArchive : () => arm("archive"), children: pending?.kind === "archive" ? "\u786E\u8BA4\u5F52\u6863" : "\u5F52\u6863" }),
		        canWaive && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		          "button",
		          {
		            type: "button",
		            onClick: () => {
		              setPending({ kind: "waive", value: "" });
		              setWaiveError(null);
		              setWaiveOk(false);
		            },
		            children: "\u8C41\u514D\u8BC4\u5BA1"
		          }
		        )
		      ] })
		    ] }),
		    props.actionError?.taskId === task.id && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-kb-action-error", role: "alert", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
		        "\u64CD\u4F5C\u5931\u8D25\uFF1A",
		        props.actionError.message
		      ] }),
		      props.onRetry && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: props.onRetry, children: "\u91CD\u8BD5\u64CD\u4F5C" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { role: "tablist", "aria-label": "\u4EFB\u52A1\u8BE6\u60C5", children: TABS.map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", role: "tab", "aria-selected": tab === id, onClick: () => setTab(id), children: label }, id)) }),
		    tab === "overview" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { role: "tabpanel", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "Workflow \u4E0A\u4E0B\u6587" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
		        props.upstream.at(-1)?.title ?? "\u65E0\u4E0A\u6E38",
		        " \u2192 ",
		        task.title,
		        " \u2192 ",
		        props.downstream[0]?.title ?? "\u65E0\u4E0B\u6E38"
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dl", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Profile" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dd", { children: [
		          task.assignee.toUpperCase(),
		          " / ",
		          ROLE_NAME[task.assignee]
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u72B6\u6001" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: statusLabelOf(task.status) }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "Chain" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: chain.title }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u4F18\u5148\u7EA7" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: task.priority }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u5FC3\u8DF3" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: task.heartbeats.length }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u4F9D\u8D56" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: props.parentTasks && props.parentTasks.length > 0 ? props.parentTasks.map((p) => p.title).join(" \u2192 ") : "\u65E0" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: "\u91CD\u8BD5" }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("dd", { children: [
		          task.attempts,
		          " \u6B21",
		          task.status === "failed" ? " \xB7 \u53EF\u7ACB\u5373\u91CD\u8BD5" : task.status === "blocked" ? " \xB7 \u89E3\u9664\u963B\u585E\u540E\u53EF\u91CD\u8BD5" : ""
		        ] })
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: task.body || "\u65E0\u9644\u52A0\u4EFB\u52A1\u63CF\u8FF0" })
		    ] }),
		    tab === "timeline" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("section", { role: "tabpanel", children: (() => {
		      const items = foldTimeline(timeline);
		      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ol", { className: "dsh-kb-timeline", children: items.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
		        "li",
		        {
		          className: `dsh-kb-timeline__item dsh-kb-timeline__item--${item.status}${i === 0 ? " dsh-kb-timeline__item--latest" : ""}`,
		          "data-exception": item.exception || void 0,
		          children: [
		            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-kb-timeline__axis", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-kb-timeline__dot", "aria-hidden": "true" }) }),
		            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-kb-timeline__body", children: [
		              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-kb-timeline__row", children: [
		                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { className: "dsh-kb-timeline__label", children: item.count ? `${item.label}\uFF08${item.count} \u6B21\uFF09` : item.label }),
		                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("time", { dateTime: new Date(item.at).toISOString(), children: formatTime(item.at) })
		              ] }),
		              item.summary && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "dsh-kb-timeline__summary", title: item.summary, children: item.summary }),
		              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-kb-timeline__author", children: item.author })
		            ] })
		          ]
		        },
		        item.seq
		      )) });
		    })() }),
		    tab === "handoff" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { role: "tabpanel", children: [
		      props.parentTasks && props.parentTasks.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "\u7236\u4EFB\u52A1\u539F\u6587" }),
		        props.parentTasks.map((p) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: p.title }),
		          p.body ? `\uFF1A${p.body}` : "\uFF08\u65E0\u6B63\u6587\uFF09"
		        ] }, p.id))
		      ] }),
		      props.parentHandoffs.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "\u7236\u4EFB\u52A1\u4EA4\u63A5" }),
		        props.parentHandoffs.map((h, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: h.summary }),
		          " ",
		          formatValue(h.metadata)
		        ] }, i))
		      ] }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "\u5F53\u524D\u4EFB\u52A1\u4EA4\u63A5" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: handoff?.summary ?? "\u5F53\u524D\u4EFB\u52A1\u5C1A\u65E0\u4EA4\u63A5" }),
		      handoff && Object.entries(handoff.metadata).map(([key, value]) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: key }),
		        ": ",
		        formatValue(value)
		      ] }, key))
		    ] }),
		    tab === "spec" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { role: "tabpanel", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "Problem" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: specCard?.sections.problem ?? "\u65E0\u89C4\u683C\u5361" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "Solution" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: specCard?.sections.solution ?? "\u65E0" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "User stories" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: specCard?.sections.user_stories.join("; ") || "\u65E0" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "Implementation decisions" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: specCard?.sections.impl_decisions.join("; ") || "\u65E0" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "Testing" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: specCard?.sections.testing ?? "\u65E0" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "Out of scope" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: specCard?.sections.out_of_scope ?? "\u65E0" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "\u9644\u4EF6" }),
		      specCard && specCard.attachments.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { className: "dsh-kb-spec-attachments", children: specCard.attachments.map((a) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dsh-kb-spec-attachment__kind", children: a.kind }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: a.name }),
		        " ",
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: a.ref })
		      ] }, `${a.name}-${a.ref}`)) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u65E0\u9644\u4EF6" })
		    ] }),
		    tab === "comments" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { role: "tabpanel", children: [
		      comments.map((event) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: event.author }),
		        " ",
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("time", { dateTime: new Date(event.at).toISOString(), children: formatTime(event.at) }),
		        ": ",
		        String(event.payload["body"])
		      ] }, event.seq)),
		      !props.readOnly && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		        "input",
		        {
		          className: "dsh-kb-comment-input",
		          "aria-label": "\u6DFB\u52A0\u8BC4\u8BBA",
		          placeholder: "\u6DFB\u52A0\u8BC4\u8BBA\uFF0C\u56DE\u8F66\u53D1\u9001",
		          onKeyDown: (e) => {
		            if (e.key === "Enter") submitComment(e.target);
		          }
		        }
		      )
		    ] }),
		    !props.readOnly && pending?.kind === "waive" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-kb-rename-overlay", onClick: (e) => {
		      e.stopPropagation();
		      if (!waiveBusy) {
		        setPending(null);
		        setWaiveError(null);
		      }
		    }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
		      "div",
		      {
		        className: "dsh-kb-rename-modal",
		        role: "dialog",
		        "aria-modal": "true",
		        "aria-label": "\u8C41\u514D\u8BC4\u5BA1",
		        onClick: (e) => e.stopPropagation(),
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-kb-rename-modal__label", children: "\u8C41\u514D\u8BC4\u5BA1" }),
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-kb-delete-modal__text", children: [
		            "\u8C41\u514D\u300C",
		            task.title,
		            "\u300D\uFF08",
		            task.id,
		            "\uFF09\u7684\u8BC4\u5BA1\u7ED3\u8BBA\uFF1A\u88AB\u8BC4\u5BA1\u5361\u7F6E\u4E3A waived\uFF0C\u94FE\u8DEF\u6309\u8BC4\u5BA1\u901A\u8FC7\u7EE7\u7EED\u63A8\u8FDB\uFF08\u8BE5\u8BC4\u5BA1\u7684\u9057\u7559\u95EE\u9898\u4ECD\u4F5C\u4E3A\u975E\u963B\u585E\u5EFA\u8BAE\u4F20\u4E0B\u6E38\uFF09\u3002\u8BF7\u586B\u5199\u8C41\u514D\u7406\u7531\u3002"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		            "input",
		            {
		              className: "dsh-kb-comment-input",
		              "aria-label": "\u8C41\u514D\u7406\u7531",
		              placeholder: "\u8C41\u514D\u7406\u7531\uFF08\u5FC5\u586B\uFF09",
		              autoFocus: true,
		              value: pending.value,
		              onChange: (e) => {
		                setPending({ kind: "waive", value: e.target.value });
		                if (waiveError) setWaiveError(null);
		              },
		              onKeyDown: (e) => {
		                if (e.key === "Enter") void submitWaive();
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-kb-rename-modal__hint", children: "\u8C41\u514D\u7406\u7531\u5FC5\u586B\uFF08\u5BA1\u8BA1\u7559\u75D5\uFF09\uFF1B\u586B\u5199\u540E\u70B9\u300C\u786E\u8BA4\u8C41\u514D\u300D\u3002" }),
		          waiveError && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-kb-delete-modal__error", role: "alert", children: waiveError }),
		          waiveOk && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-kb-rename-modal__success", role: "status", children: "\u2713 \u5DF2\u8C41\u514D\uFF0C\u94FE\u8DEF\u5C06\u7EE7\u7EED\u63A8\u8FDB" }),
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-kb-rename-modal__actions", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "dsh-kb-rename-cancel", disabled: waiveBusy, onClick: () => {
		              setPending(null);
		              setWaiveError(null);
		            }, children: "\u53D6\u6D88" }),
		            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "dsh-kb-rename-save", disabled: waiveBusy || waiveOk, onClick: () => void submitWaive(), children: waiveOk ? "\u5DF2\u8C41\u514D" : waiveBusy ? "\u8C41\u514D\u4E2D\u2026" : "\u786E\u8BA4\u8C41\u514D" })
		          ] })
		        ]
		      }
		    ) })
		  ] });
		}
		
		// client/KanbanBoard.tsx
		var import_jsx_runtime5 = require("react/jsx-runtime");
		function defaultCollapsed() {
		  return /* @__PURE__ */ new Set();
		}
		function KanbanBoard(props) {
		  const { board } = props.snapshot;
		  const [collapsed, setCollapsed] = (0, import_react6.useState)(() => defaultCollapsed());
		  const [query, setQuery] = (0, import_react6.useState)("");
		  const [statusFilter, setStatusFilter] = (0, import_react6.useState)(/* @__PURE__ */ new Set());
		  const [selectedId, setSelectedId] = (0, import_react6.useState)(() => history.state?.kanbanTaskId ?? null);
		  const [failedAction, setFailedAction] = (0, import_react6.useState)(null);
		  const listRef = (0, import_react6.useRef)(null);
		  const saved = (0, import_react6.useRef)({ collapsed: [], scrollTop: 0 });
		  const snapshotRef = (0, import_react6.useRef)(props.snapshot);
		  snapshotRef.current = props.snapshot;
		  const detailOpenedSeq = (0, import_react6.useRef)(null);
		  (0, import_react6.useEffect)(() => {
		    const onPop = () => {
		      const id = history.state?.kanbanTaskId ?? null;
		      detailOpenedSeq.current = id ? snapshotRef.current.lastSeq : null;
		      setSelectedId(id);
		      if (!id) {
		        setCollapsed(new Set(saved.current.collapsed));
		        requestAnimationFrame(() => {
		          if (listRef.current) listRef.current.scrollTop = saved.current.scrollTop;
		        });
		      }
		    };
		    window.addEventListener("popstate", onPop);
		    return () => window.removeEventListener("popstate", onPop);
		  }, []);
		  (0, import_react6.useEffect)(() => {
		    const onKey = (e) => {
		      if (e.key === "Escape" && selectedId) history.back();
		    };
		    window.addEventListener("keydown", onKey);
		    return () => window.removeEventListener("keydown", onKey);
		  }, [selectedId]);
		  const views = (0, import_react6.useMemo)(
		    () => board ? deriveWorkflowBoard(board, { selectedTaskId: selectedId, now: Date.now(), statusFilter }) : [],
		    [board, selectedId, statusFilter]
		  );
		  const runAction = async (action) => {
		    try {
		      await props.postAction(action);
		    } catch {
		      const a = action;
		      setFailedAction({ taskId: a.taskId ?? "", action });
		    }
		  };
		  const toggleFilter = (f) => {
		    setStatusFilter((current) => {
		      const next = new Set(current);
		      if (next.has(f)) next.delete(f);
		      else next.add(f);
		      return next;
		    });
		  };
		  const toggleChain = (chainId) => {
		    setCollapsed((current) => {
		      const next = new Set(current);
		      if (next.has(chainId)) next.delete(chainId);
		      else next.add(chainId);
		      return next;
		    });
		  };
		  if (!board) {
		    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dsh-kb-loading", children: "\u52A0\u8F7D\u770B\u677F\u2026" });
		  }
		  const selectedView = selectedId ? views.flatMap((v) => v.tasks).find((v) => v.task.id === selectedId) ?? null : null;
		  if (selectedView) {
		    const task = selectedView.task;
		    const chain = board.chains.get(task.chainId);
		    const specCard = chain.specCardId ? board.specCards.get(chain.specCardId) ?? null : null;
		    const handoff = board.handoffs.get(task.id) ?? null;
		    const parentHandoffs = task.parents.map((id) => board.handoffs.get(id)).filter((h) => h !== void 0);
		    const parentTasks = task.parents.map((id) => board.tasks.get(id)).filter((t) => t !== void 0);
		    const chainTasks = views.find((v) => v.chain.id === task.chainId)?.tasks ?? [];
		    const selectedIndex = chainTasks.findIndex((v) => v.task.id === task.id);
		    const related = chainTasks.filter((v) => v.related).map((v) => v.task);
		    const upstream = related.filter((t) => chainTasks.findIndex((v) => v.task.id === t.id) < selectedIndex);
		    const downstream = related.filter((t) => chainTasks.findIndex((v) => v.task.id === t.id) > selectedIndex);
		    const unreadCount = board.events.filter((e) => e.taskId === task.id && e.seq > (detailOpenedSeq.current ?? props.snapshot.lastSeq)).length;
		    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		      TaskDrawer,
		      {
		        task,
		        chain,
		        events: board.events,
		        handoff,
		        parentHandoffs,
		        parentTasks,
		        specCard,
		        upstream,
		        downstream,
		        unreadCount,
		        actionError: props.snapshot.actionError,
		        readOnly: task.status === "archived",
		        onRetry: failedAction && failedAction.taskId === task.id ? () => void runAction(failedAction.action) : void 0,
		        onComment: (body) => void runAction({ type: "comment", taskId: task.id, body }),
		        onAction: (action) => runAction(action),
		        onClose: () => history.back()
		      }
		    );
		  }
		  const openTask = (taskId) => {
		    detailOpenedSeq.current = props.snapshot.lastSeq;
		    saved.current = { collapsed: [...collapsed], scrollTop: listRef.current?.scrollTop ?? 0 };
		    history.pushState({ ...history.state, kanbanTaskId: taskId }, "");
		    setSelectedId(taskId);
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-kb-tab-body", ref: listRef, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dsh-kb-toolbar", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		      "input",
		      {
		        "aria-label": "\u641C\u7D22\u94FE\u8DEF",
		        value: query,
		        onChange: (e) => setQuery(e.target.value),
		        placeholder: "\u641C\u7D22\u94FE\u8DEF/\u4EFB\u52A1"
		      }
		    ) }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		      WorkflowRail,
		      {
		        chains: views,
		        collapsedChainIds: collapsed,
		        query,
		        statusFilter,
		        onToggleFilter: toggleFilter,
		        onToggleChain: toggleChain,
		        onOpenTask: openTask,
		        onOpenView: props.onOpenView,
		        onConfirmAudit: (chainId) => void runAction({ type: "confirm-audit", chainId }),
		        onRenameChain: (chainId, title) => void runAction({ type: "rename", chainId, title }),
		        onReopenChain: (chainId, reason) => props.postAction({ type: "reopen-chain", chainId, reason }).then(() => void 0),
		        onDeleteChain: async (chainId) => {
		          await props.postAction({ type: "delete", chainId });
		          await props.onResync?.();
		        }
		      }
		    )
		  ] });
		}
		
		// client/ConnectionBanner.tsx
		var import_jsx_runtime6 = require("react/jsx-runtime");
		function ConnectionBanner(props) {
		  if (props.connection === "ready") return null;
		  const label = props.connection === "loading" ? "\u6B63\u5728\u52A0\u8F7D" : props.connection === "reconnecting" ? "\u6B63\u5728\u91CD\u8FDE" : "\u8FDE\u63A5\u9519\u8BEF";
		  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: `dsh-kb-banner dsh-kb-banner--${props.connection}`, role: "status", children: [
		    label,
		    props.connection === "error" && props.lastSuccessAt ? ` \xB7 \u6700\u540E\u6210\u529F ${new Date(props.lastSuccessAt).toLocaleTimeString()}` : "",
		    props.connection === "error" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "dsh-kb-banner__retry", onClick: props.onRetry, children: "\u91CD\u8BD5" })
		  ] });
		}
		
		// client/KanbanTab.tsx
		var import_jsx_runtime7 = require("react/jsx-runtime");
		function KanbanTab(props = {}) {
		  const own = (0, import_react7.useMemo)(() => props.store ?? createBoardStore(), [props.store]);
		  const snapshot = useKanbanBoard(own);
		  (0, import_react7.useEffect)(() => {
		    if (props.store) return;
		    void own.start();
		    return () => {
		      own.stop();
		    };
		  }, [own, props.store]);
		  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-kb-tab", role: "region", "aria-label": "\u770B\u677F", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ConnectionBanner, { connection: snapshot.connection, lastSuccessAt: snapshot.lastSuccessAt, onRetry: () => void own.retry() }),
		    snapshot.board ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(KanbanBoard, { snapshot, onOpenView: props.openView, postAction: (action) => own.postAction(action), onResync: () => own.retry() }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "dsh-kb-loading", children: "\u52A0\u8F7D\u770B\u677F\u2026" })
		  ] });
		}
		
		// client/ConfigSection.tsx
		var import_react9 = require("react");
		
		// client/config-store.ts
		var SWARM_CONFIG_NS = "swarm-config";
		function createConfigStore(fetchImpl) {
		  let state = { effective: { wikiVault: { baseUrl: "", pagePrefix: "" }, roles: { models: {} }, reviewEngine: { mode: "delegate", managed: { provider: "", model: "" } }, imDelivery: { fallbackBotId: "" } }, sources: {}, catalog: { providers: [], models: {} }, ocrStatus: null, install: { phase: "idle", log: "" }, saving: false, error: null };
		  const listeners = /* @__PURE__ */ new Set();
		  const setState = (patch) => {
		    state = { ...state, ...patch };
		    for (const l of [...listeners]) l();
		  };
		  const get = () => state;
		  const subscribe = (listener) => {
		    listeners.add(listener);
		    return () => {
		      listeners.delete(listener);
		    };
		  };
		  const load = async () => {
		    const [cfg, cat] = await Promise.all([
		      fetchImpl("/kanban/config").then((r) => r.json()),
		      fetchImpl("/kanban/llm-catalog").then((r) => r.json())
		    ]);
		    setState({ effective: cfg.effective, sources: cfg.sources, catalog: cat });
		  };
		  const save = async (snap) => {
		    setState({ saving: true, error: null });
		    try {
		      const r = await fetchImpl("/kanban/config", {
		        method: "PUT",
		        headers: { "Content-Type": "application/json" },
		        body: JSON.stringify(snap)
		      });
		      const d = await r.json();
		      if (!r.ok) {
		        setState({ error: (d.fields ?? []).join(", ") || "save failed" });
		        return false;
		      }
		      setState({ effective: d.effective, sources: d.sources });
		      return true;
		    } catch (e) {
		      setState({ error: String(e) });
		      return false;
		    } finally {
		      setState({ saving: false });
		    }
		  };
		  const loadOcrStatus = async () => {
		    try {
		      const r = await fetchImpl("/kanban/ocr/status");
		      if (!r.ok) {
		        setState({ ocrStatus: null });
		        return;
		      }
		      setState({ ocrStatus: await r.json() });
		    } catch {
		      setState({ ocrStatus: null });
		    }
		  };
		  const startInstall = async () => {
		    setState({ install: { phase: "running", log: "" } });
		    try {
		      const r = await fetchImpl("/kanban/ocr/install", { method: "POST" });
		      if (!r.ok && r.status !== 409) setState({ install: { phase: "failed", log: "POST /kanban/ocr/install \u2192 " + r.status } });
		    } catch (e) {
		      setState({ install: { phase: "failed", log: String(e) } });
		    }
		  };
		  const cancelInstall = async () => fetchImpl("/kanban/ocr/install/cancel", { method: "POST" }).then((x) => x.json());
		  const loadInstallState = async () => {
		    try {
		      const r = await fetchImpl("/kanban/ocr/install/state").then((x) => x.json());
		      const phase = r.running ? "running" : r.result === "ok" ? "done" : r.result === "failed" ? "failed" : r.result === "cancelled" ? "cancelled" : "idle";
		      setState({ install: { phase, log: String(r.log ?? "") } });
		      if (phase === "done") await loadOcrStatus();
		    } catch {
		    }
		  };
		  const wireOcr = async (provider, model) => {
		    try {
		      const r = await fetchImpl("/kanban/ocr/wire", {
		        method: "POST",
		        headers: { "Content-Type": "application/json" },
		        body: JSON.stringify({ provider, model })
		      });
		      const d = await r.json().catch(() => ({}));
		      return { ok: Boolean(d.ok), log: String(d.log ?? "") };
		    } catch (e) {
		      return { ok: false, log: String(e) };
		    }
		  };
		  return { get, subscribe, load, save, loadOcrStatus, startInstall, cancelInstall, loadInstallState, wireOcr };
		}
		
		// client/ConfigSelect.tsx
		var import_react8 = require("react");
		var import_jsx_runtime8 = require("react/jsx-runtime");
		function ConfigSelect({ value, options, placeholder, onChange, onCommit, disabled }) {
		  const [open, setOpen] = (0, import_react8.useState)(false);
		  const rootRef = (0, import_react8.useRef)(null);
		  (0, import_react8.useEffect)(() => {
		    if (!open) return;
		    const onDocDown = (e) => {
		      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
		    };
		    const onKey = (e) => {
		      if (e.key === "Escape") setOpen(false);
		    };
		    document.addEventListener("mousedown", onDocDown);
		    document.addEventListener("keydown", onKey);
		    return () => {
		      document.removeEventListener("mousedown", onDocDown);
		      document.removeEventListener("keydown", onKey);
		    };
		  }, [open]);
		  const current = options.find((o) => o.value === value);
		  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-kb-config__select", ref: rootRef, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
		      "button",
		      {
		        type: "button",
		        className: "dsh-kb-config__select-trigger",
		        "aria-haspopup": "listbox",
		        "aria-expanded": open,
		        disabled,
		        onClick: () => setOpen((v) => !v),
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: current ? void 0 : "dsh-kb-config__select-placeholder", children: current?.label ?? placeholder }),
		          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "dsh-kb-config__select-chevron", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("svg", { width: "12", height: "12", viewBox: "0 0 16 16", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		            "path",
		            {
		              d: "M6 3.5 10.5 8 6 12.5",
		              fill: "none",
		              stroke: "currentColor",
		              strokeWidth: "1.5",
		              strokeLinecap: "round",
		              strokeLinejoin: "round"
		            }
		          ) }) })
		        ]
		      }
		    ),
		    open && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("ul", { className: "dsh-kb-config__menu", role: "listbox", children: options.map((o) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
		      "button",
		      {
		        type: "button",
		        role: "option",
		        "aria-selected": o.value === value,
		        className: "dsh-kb-config__option",
		        "data-selected": o.value === value || void 0,
		        onClick: () => {
		          onChange(o.value);
		          setOpen(false);
		          onCommit?.();
		        },
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: o.label }),
		          o.value === value && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "dsh-kb-config__option-check", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 16 16", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		            "path",
		            {
		              d: "M3 8.5 6.5 12 13 4.5",
		              fill: "none",
		              stroke: "currentColor",
		              strokeWidth: "1.5",
		              strokeLinecap: "round",
		              strokeLinejoin: "round"
		            }
		          ) }) })
		        ]
		      }
		    ) }, o.value || "__empty__")) })
		  ] });
		}
		
		// client/ConfigSection.tsx
		var import_jsx_runtime9 = require("react/jsx-runtime");
		var ROLES = ["v", "p", "w", "d", "pt", "dt"];
		function ocrBanner(ocr, installing) {
		  if (installing) return null;
		  if (ocr === null) return "ocr \u72B6\u6001\u672A\u77E5\u2014\u2014\u59D4\u6258/\u6258\u7BA1\u8BC4\u5BA1\u53EF\u80FD\u4E0D\u53EF\u7528";
		  if (!ocr.installed) return "ocr \u672A\u5B89\u88C5\u2014\u2014\u59D4\u6258/\u6258\u7BA1\u8BC4\u5BA1\u5747\u4E0D\u53EF\u7528";
		  return null;
		}
		function ConfigSection({ fetchImpl, close }) {
		  const storeRef = (0, import_react9.useRef)(null);
		  if (!storeRef.current) storeRef.current = createConfigStore(fetchImpl ?? ((...args) => fetch(...args)));
		  const store = storeRef.current;
		  const state = (0, import_react9.useSyncExternalStore)(store.subscribe, store.get);
		  const [draft, setDraft] = (0, import_react9.useState)(null);
		  const [wireResult, setWireResult] = (0, import_react9.useState)(null);
		  (0, import_react9.useEffect)(() => {
		    void store.load().then(() => setDraft(store.get().effective));
		    void store.loadOcrStatus();
		  }, [store]);
		  const installing = state.install.phase === "running";
		  (0, import_react9.useEffect)(() => {
		    if (!installing) return;
		    const tick = () => {
		      void store.loadInstallState();
		    };
		    tick();
		    const timer = setInterval(tick, 1500);
		    return () => clearInterval(timer);
		  }, [store, installing]);
		  if (!draft) return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dsh-kb-config", children: "\u52A0\u8F7D\u4E2D\u2026" });
		  const commit = (next) => {
		    setDraft(next);
		    void store.save(next);
		  };
		  const setModel = (r, patch) => {
		    const prev = draft.roles.models[r] ?? { provider: "", model: "", reasoningEffort: "" };
		    commit({ ...draft, roles: { models: { ...draft.roles.models, [r]: { ...prev, ...patch } } } });
		  };
		  const commitReviewEngine = (mode, managed) => {
		    commit({ ...draft, reviewEngine: { mode, managed } });
		  };
		  const onBlur = () => {
		    void store.save(draft);
		  };
		  const ocr = state.ocrStatus;
		  const banner = ocrBanner(ocr, installing);
		  const ocrBlocked = installing || ocr === null || !ocr.installed;
		  const re = draft.reviewEngine;
		  const managedFieldsEnabled = !ocrBlocked && re.mode === "managed";
		  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "dsh-kb-config", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "dsh-kb-config__card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "\u77E5\u8BC6\u5E93" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("label", { className: "dsh-kb-config__label", children: "baseUrl" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		        "input",
		        {
		          value: draft.wikiVault.baseUrl,
		          onBlur,
		          onChange: (e) => setDraft({ ...draft, wikiVault: { ...draft.wikiVault, baseUrl: e.target.value } })
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-kb-config__help", children: "llm-wiki \u77E5\u8BC6\u5E93\u5916\u94FE HTTP \u5730\u5740\uFF08\u5982 http://192.168.122.111:3000\uFF09\uFF1B\u7559\u7A7A\u5219\u4F7F\u7528\u672C\u5730 llm-wiki \u515C\u5E95" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("label", { className: "dsh-kb-config__label", children: "pagePrefix" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		        "input",
		        {
		          value: draft.wikiVault.pagePrefix,
		          onBlur,
		          onChange: (e) => setDraft({ ...draft, wikiVault: { ...draft.wikiVault, pagePrefix: e.target.value } })
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-kb-config__help", children: "llm-wiki \u9875\u9762\u8DEF\u5F84\u524D\u7F00\uFF08\u5982 projects/\uFF09" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "dsh-kb-config__card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "\u6A21\u578B\u94FE" }),
		      ROLES.map((r) => {
		        const m = draft.roles.models[r] ?? { provider: "", model: "", reasoningEffort: "" };
		        const providerModels = state.catalog.models[m.provider] ?? [];
		        const efforts = providerModels.find((x) => x.id === m.model)?.efforts ?? [];
		        return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "dsh-kb-config__role", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("strong", { children: r }),
		          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		            ConfigSelect,
		            {
		              value: m.provider,
		              placeholder: "\u9009\u62E9 provider",
		              options: state.catalog.providers.map((p) => ({ value: p.id, label: p.name })),
		              onChange: (v) => {
		                if (v !== m.provider) setModel(r, { provider: v, model: "", reasoningEffort: "" });
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		            ConfigSelect,
		            {
		              value: m.model,
		              placeholder: "\u9009\u62E9\u6A21\u578B",
		              options: providerModels.map((x) => ({ value: x.id, label: x.name })),
		              onChange: (v) => {
		                if (v !== m.model) setModel(r, { model: v, reasoningEffort: "" });
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		            ConfigSelect,
		            {
		              value: m.reasoningEffort,
		              placeholder: "\u8DDF\u968F\u9ED8\u8BA4",
		              options: efforts.map((x) => ({ value: x.id, label: x.name })),
		              onChange: (v) => {
		                if (v !== m.reasoningEffort) setModel(r, { reasoningEffort: v });
		              }
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-kb-config__src", children: state.sources[`roles.models.${r}.model`] === "override" ? "\u5DF2\u8986\u76D6" : "\u7EE7\u627F" })
		        ] }, r);
		      })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "dsh-kb-config__card", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: "\u8BC4\u5BA1\u5F15\u64CE\uFF08ocr\uFF09" }),
		      installing && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "dsh-kb-config__installing", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-kb-config__installing-spinner", "aria-hidden": "true" }),
		        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: "\u6B63\u5728\u5B89\u88C5 ocr\u2026\uFF08npm \u5168\u5C40\u5B89\u88C5\uFF0C\u7EA6 1-2 \u5206\u949F\uFF09" }),
		        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", onClick: () => {
		          void store.cancelInstall();
		        }, children: "\u53D6\u6D88" })
		      ] }),
		      banner && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dsh-kb-config__error", role: "alert", children: banner }),
		      state.install.phase === "failed" && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "dsh-kb-config__error", children: [
		        "\u5B89\u88C5\u5931\u8D25\uFF1A",
		        state.install.log.slice(0, 200) || "npm \u5168\u5C40\u5B89\u88C5\u672A\u6210\u529F\uFF0C\u53EF\u91CD\u8BD5"
		      ] }),
		      state.install.phase === "cancelled" && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dsh-kb-config__error", children: "\u5B89\u88C5\u5DF2\u53D6\u6D88\uFF0C\u53EF\u91CD\u65B0\u53D1\u8D77" }),
		      ocr?.installed && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "dsh-kb-config__ocr-ok", children: [
		        "\u2713 ocr ",
		        ocr.version,
		        " \u5DF2\u5B89\u88C5"
		      ] }),
		      !installing && (!ocr || !ocr.installed) && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", onClick: () => {
		        void store.startInstall();
		      }, children: "\u5B89\u88C5 ocr" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("label", { className: "dsh-kb-config__label", children: "\u8BC4\u5BA1\u6A21\u5F0F" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		        ConfigSelect,
		        {
		          value: re.mode,
		          disabled: ocrBlocked,
		          placeholder: "\u9009\u62E9\u8BC4\u5BA1\u6A21\u5F0F",
		          options: [
		            { value: "delegate", label: "\u59D4\u6258\uFF08DT \u81EA\u5DF1\u7684\u6A21\u578B\u8BC4\u5BA1\uFF0C\u96F6 key\uFF09" },
		            { value: "managed", label: "\u6258\u7BA1\uFF08ocr \u7528\u4E0B\u9009\u6A21\u578B\u8BC4\u5BA1\uFF09" }
		          ],
		          onChange: (v) => {
		            if (v !== re.mode) commitReviewEngine(v, re.managed);
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-kb-config__src", children: state.sources["reviewEngine.mode"] === "override" ? "\u5DF2\u8986\u76D6" : "\u7EE7\u627F" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("label", { className: "dsh-kb-config__label", children: "\u63D0\u4F9B\u65B9" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		        ConfigSelect,
		        {
		          value: re.managed.provider,
		          disabled: !managedFieldsEnabled,
		          placeholder: "\u9009\u62E9\u63D0\u4F9B\u65B9",
		          options: state.catalog.providers.map((p) => ({ value: p.id, label: p.name })),
		          onChange: (v) => {
		            if (v !== re.managed.provider) commitReviewEngine(re.mode, { provider: v, model: "" });
		          }
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("label", { className: "dsh-kb-config__label", children: "\u6A21\u578B" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		        ConfigSelect,
		        {
		          value: re.managed.model,
		          disabled: !managedFieldsEnabled,
		          placeholder: "\u9009\u62E9\u6A21\u578B",
		          options: (state.catalog.models[re.managed.provider] ?? []).map((x) => ({ value: x.id, label: x.name })),
		          onChange: (v) => {
		            if (v !== re.managed.model) commitReviewEngine(re.mode, { ...re.managed, model: v });
		          }
		        }
		      ),
		      ocr?.managedReady === false && re.mode === "managed" && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dsh-kb-config__ocr-warn", children: "\u6258\u7BA1\u672A\u5C31\u7EEA\uFF1A\u9009\u597D\u63D0\u4F9B\u65B9\u4E0E\u6A21\u578B\u540E\u70B9\u300E\u5E94\u7528\u5230 ocr\u300F\u5199\u5165 ocr \u914D\u7F6E\uFF1B\u4E5F\u53EF\u5728\u7EC8\u7AEF\u624B\u52A8 ocr config provider\uFF08\u59D4\u6258\u6A21\u5F0F\u4E0D\u53D7\u5F71\u54CD\uFF09" }),
		      re.mode === "managed" && re.managed.provider && re.managed.model && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
		        "button",
		        {
		          type: "button",
		          disabled: ocrBlocked,
		          onClick: () => {
		            void store.wireOcr(re.managed.provider, re.managed.model).then(setWireResult);
		          },
		          children: "\u5E94\u7528\u5230 ocr"
		        }
		      ),
		      wireResult && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: wireResult.ok ? "dsh-kb-config__ocr-ok" : "dsh-kb-config__error", children: wireResult.ok ? "\u2713 \u5DF2\u5199\u5165 ocr\uFF08dsh-managed\uFF09" : "\u5199\u5165\u5931\u8D25\uFF1A" + wireResult.log.slice(0, 200) }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-kb-config__help", children: "\u6258\u7BA1\u8BC4\u5BA1\u7531 ocr \u8C03\u7528\u4E0A\u65B9\u9009\u5B9A\u7684\u63D0\u4F9B\u65B9/\u6A21\u578B\u6267\u884C\uFF1B\u63A5\u5165\u70B9\u7531\u7CFB\u7EDF\u81EA\u52A8\u5199\u5165 ocr \u81EA\u5B9A\u4E49\u914D\u7F6E\uFF08dsh-managed\uFF09\uFF0CAPI key \u4ECE dsh \u6A21\u578B\u914D\u7F6E\u89E3\u6790\uFF0C\u4E0D\u5728\u9762\u677F\u660E\u6587\u5C55\u793A" }),
		      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "dsh-kb-config__help", children: [
		        "\u5B98\u65B9\u6587\u6863\uFF1A",
		        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("a", { href: "https://open-codereview.ai/docs/installation", target: "_blank", rel: "noreferrer", children: "\u5B89\u88C5\u6307\u5357" }),
		        " \xB7 ",
		        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("a", { href: "https://open-codereview.ai/docs/configuration", target: "_blank", rel: "noreferrer", children: "\u6A21\u578B\u914D\u7F6E" }),
		        " \xB7 ",
		        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("a", { href: "https://open-codereview.ai/docs/delegate", target: "_blank", rel: "noreferrer", children: "\u59D4\u6258\u6A21\u5F0F\u8BF4\u660E" })
		      ] }),
		      ocr?.kbMode === "local" && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-kb-config__help", children: "\u672C\u5730\u77E5\u8BC6\u5E93\u6A21\u5F0F\u4E0B\u72EC\u7ACB\u8BC4\u5BA1\u62A5\u544A\u6682\u4E0D\u843D wiki\uFF0C\u8BF7\u76F4\u63A5\u7559\u5B58\u5BF9\u8BDD" })
		    ] }),
		    state.error && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dsh-kb-config__error", children: state.error })
		  ] });
		}
		
		// client/kanban.css
		var kanban_default = `/* T32\uFF1A\u5361\u7247/\u8FDE\u63A5\u7EBF\u7B49\u5C40\u90E8\u8FC7\u6E21\u4FDD\u6301 120-180ms\uFF1Bprefers-reduced-motion \u5168\u5C40\u5173\u95ED */
		.dsh-kb-tab {
		  /* DSH \u8BBE\u8BA1\u4EE4\u724C\uFF08\u6D45/\u6DF1\u8272\u968F body[data-ds-dark-theme] \u81EA\u52A8\u5207\u6362\uFF09\u2014\u2014\u7981\u6B62\u786C\u7F16\u7801\u989C\u8272 */
		  --dsh-kb-surface: var(--dsw-alias-bg-layer-1);
		  --dsh-kb-surface-elev: var(--dsw-alias-bg-layer-3);
		  --dsh-kb-text-primary: var(--dsw-alias-label-primary);
		  --dsh-kb-text-secondary: var(--dsw-alias-label-secondary);
		  --dsh-kb-text-tertiary: var(--dsw-alias-label-tertiary);
		  --dsh-kb-border: var(--dsw-alias-border-l2);
		  --dsh-kb-hover: var(--dsw-alias-interactive-bg-hover);
		  --dsh-kb-mask: var(--dsw-alias-bg-mask-3);
		  --dsh-kb-input: var(--dsw-specific-input-major);
		  --dsh-kb-inline-code: var(--dsw-alias-markdown-inline-code);
		  /* \u5927\u5706\u89D2\u5951\u7EA6\uFF08\u5BF9\u9F50 DSH \u5361\u7247 16px\uFF09\uFF0C\u540E\u7EED UI \u4E00\u5F8B\u590D\u7528 */
		  --dsh-kb-radius-lg: 16px;
		  --dsh-kb-radius-md: 10px;
		  --dsh-kb-radius-sm: 8px;
		  /* \u72B6\u6001\u8272 \u2192 DSH \u8BED\u4E49\u4EE4\u724C */
		  --dsh-kb-complete: var(--dsw-alias-state-success-primary);
		  --dsh-kb-active: var(--dsw-alias-state-business-primary);
		  --dsh-kb-blocked: var(--dsw-alias-state-error-primary);
		  --dsh-kb-pending: currentColor;
		  /* \u89D2\u8272\u8272\uFF1ADSH \u6709\u7B49\u4EF7\u4EE4\u724C\u5219\u590D\u7528\uFF1Bp/pt/dt \u65E0 DSH \u7B49\u4EF7\u8272\uFF0C\u4FDD\u7559\u539F\u503C */
		  --dsh-kb-v: var(--dsw-alias-state-business-primary);
		  --dsh-kb-p: #a855f7;
		  --dsh-kb-w: var(--dsw-alias-state-success-primary);
		  --dsh-kb-d: var(--dsw-alias-state-warn-primary);
		  --dsh-kb-pt: #6366f1; /* \u8BA1\u5212\u8BC4\u5BA1\uFF1A\u975B/\u6D45\u84DD */
		  --dsh-kb-dt: #ec4899; /* \u5B9E\u73B0\u8BC4\u5BA1\uFF1A\u73AB\u7EA2 */
		  height: 100%;
		  width: 100%;
		  /* \u63A5\u5165\u5BBF\u4E3B\u4F1A\u8BDD\u6D41\u5BBD\u5EA6\u7CFB\u7EDF\uFF1A\u81EA\u9002\u5E94 clamp + \u62D6\u62FD\u504F\u597D\uFF08--dsh-chat-content-width \u7531
		     \u5BBF\u4E3B ConversationRoot \u5B9A\u4E49\uFF0C\u62D6\u62FD\u624B\u67C4\u5B98\u65B9\u5DF2\u5B9E\u73B0\uFF09\uFF1B780px \u4EC5\u4E3A\u53D8\u91CF\u7F3A\u5931\u65F6\u7684\u515C\u5E95 */
		  min-width: 0;
		  max-width: var(--dsh-chat-content-width, 780px);
		  margin-inline: auto;
		  display: flex;
		  flex-direction: column;
		  color: inherit;
		  background: var(--dsw-alias-bg-base);
		  pointer-events: auto;
		  font-size: 13px;
		  line-height: 1.45;
		  overflow: hidden;
		}
		
		.dsh-kb-banner {
		  flex: 0 0 auto;
		  padding: 6px 12px;
		  font-size: 12px;
		  border-bottom: 1px solid var(--dsh-kb-border);
		}
		.dsh-kb-banner--reconnecting,
		.dsh-kb-banner--loading {
		  color: var(--dsh-kb-active);
		}
		.dsh-kb-banner--error {
		  color: var(--dsh-kb-blocked);
		}
		
		.dsh-kb-tab-body {
		  flex: 1 1 auto;
		  min-height: 0;
		  overflow: auto;
		  padding: 8px;
		}
		
		.dsh-kb-loading {
		  flex: 1 1 auto;
		  display: flex;
		  align-items: center;
		  justify-content: center;
		  color: currentColor;
		  opacity: 0.7;
		}
		
		.dsh-kb-toolbar {
		  position: sticky;
		  top: 0;
		  z-index: 1;
		  padding-bottom: 8px;
		}
		.dsh-kb-toolbar input {
		  width: 100%;
		  box-sizing: border-box;
		  padding: 6px 10px;
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-md);
		  background: var(--dsh-kb-input);
		  color: var(--dsh-kb-text-primary);
		}
		
		.dsh-kb-rail {
		  display: flex;
		  flex-direction: column;
		}
		/* \u72B6\u6001\u7B5B\u9009 chip \u7EC4\uFF1A\u6267\u884C\u4E2D/\u963B\u585E/\u5931\u8D25/\u5DF2\u5B8C\u6210\uFF08\u591A\u9009\u5E76\u96C6\uFF1B\u7A7A=\u9ED8\u8BA4\u89C6\u56FE\uFF09 */
		.dsh-kb-filters {
		  display: flex;
		  flex-wrap: wrap;
		  gap: 6px;
		  padding: 0 0 8px;
		}
		.dsh-kb-filter {
		  display: inline-flex;
		  align-items: center;
		  padding: 2px 10px;
		  border: 1px solid var(--dsw-alias-border-l2);
		  border-radius: 999px;
		  background: transparent;
		  color: currentColor;
		  font: inherit;
		  cursor: pointer;
		  user-select: none;
		  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
		}
		.dsh-kb-filter:hover {
		  background: var(--dsh-kb-hover);
		}
		.dsh-kb-filter--active {
		  border-color: var(--dsh-kb-active);
		  color: var(--dsh-kb-active);
		  background: color-mix(in srgb, var(--dsh-kb-active) 10%, transparent);
		}
		
		.dsh-kb-chain {
		  margin-bottom: 10px;
		}
		.dsh-kb-chain__title {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  box-sizing: border-box;
		  width: 100%;
		  padding: 6px 8px;
		  border: 0;
		  border-radius: var(--dsh-kb-radius-sm);
		  background: transparent;
		  color: var(--dsh-kb-text-primary);
		  font: inherit;
		  text-align: left;
		  cursor: pointer;
		  transition: background-color 150ms ease;
		}
		.dsh-kb-chain__title:hover {
		  background: var(--dsh-kb-hover);
		}
		/* \u6BCF\u6761\u94FE\u8DEF\u524D\u7684\u6298\u53E0\u7BAD\u5934\uFF08\u4E0E DSH \u6298\u53E0\u4EA4\u4E92\u4E00\u81F4\uFF1A\u7EC6 chevron\uFF0C\u5C55\u5F00\u65F6\u65CB\u8F6C\uFF0C150ms \u8FC7\u6E21\uFF09 */
		.dsh-kb-chain__chevron {
		  flex: 0 0 auto;
		  width: 7px;
		  height: 7px;
		  border-top: 1.5px solid currentColor;
		  border-right: 1.5px solid currentColor;
		  transform: rotate(45deg);
		  opacity: 0.7;
		  transition: transform 150ms ease;
		}
		.dsh-kb-chain__title[aria-expanded='true'] .dsh-kb-chain__chevron {
		  transform: rotate(135deg);
		}
		.dsh-kb-chain__name {
		  flex: 1 1 auto;
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-chain__meta {
		  flex: 0 0 auto;
		  white-space: nowrap;
		  opacity: 0.7;
		}
		.dsh-kb-chain__warning {
		  padding: 4px 8px;
		  margin: 2px 0 6px;
		  border-left: 3px solid var(--dsh-kb-blocked);
		  color: var(--dsh-kb-blocked);
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		/* D23\uFF1A\u94FE\u5B8C\u6210\u9A8C\u6536\u6838\u5BF9\u8B66\u544A\u884C\uFF08completed \u94FE\u672A\u786E\u8BA4\u524D\u963B\u585E\u6700\u7EC8\u6C47\u62A5\uFF09 */
		.dsh-kb-chain__audit {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  white-space: normal;
		}
		.dsh-kb-chain__audit span {
		  flex: 1 1 auto;
		  overflow: hidden;
		}
		.dsh-kb-audit-confirm {
		  flex: 0 0 auto;
		  border: 1px solid var(--dsh-kb-blocked);
		  border-radius: var(--dsh-kb-radius-sm);
		  background: transparent;
		  color: var(--dsh-kb-blocked);
		  padding: 2px 10px;
		  cursor: pointer;
		  font: inherit;
		  transition: background-color 150ms ease, color 150ms ease;
		}
		.dsh-kb-audit-confirm:hover {
		  background: var(--dsh-kb-blocked);
		  color: #fff;
		}
		
		.dsh-kb-nodes {
		  list-style: none;
		  margin: 0;
		  padding: 0 0 0 12px;
		  display: flex;
		  flex-direction: column;
		  gap: 0;
		}
		.dsh-kb-node {
		  position: relative;
		  padding-left: 12px;
		}
		.dsh-kb-node::before {
		  content: '';
		  position: absolute;
		  left: 0;
		  top: 0;
		  bottom: 0;
		  width: 2px;
		  background: var(--dsh-kb-pending);
		  transition: background-color 150ms ease;
		}
		.dsh-kb-node--complete::before { background: var(--dsh-kb-complete); }
		.dsh-kb-node--active::before { background: var(--dsh-kb-active); }
		.dsh-kb-node--pending::before {
		  background: repeating-linear-gradient(to bottom, currentColor 0 3px, transparent 3px 6px);
		}
		.dsh-kb-node--blocked::before {
		  background: repeating-linear-gradient(to bottom, var(--dsh-kb-blocked) 0 4px, transparent 4px 8px);
		}
		
		.dsh-kb-task {
		  display: grid;
		  grid-template-columns: 22px 1fr auto;
		  grid-template-rows: auto auto;
		  gap: 2px 8px;
		  width: 100%;
		  box-sizing: border-box;
		  padding: 6px 8px;
		  margin: 4px 0;
		  border: 1px solid transparent;
		  border-radius: var(--dsh-kb-radius-lg);
		  background: transparent;
		  color: var(--dsh-kb-text-primary);
		  font: inherit;
		  text-align: left;
		  cursor: pointer;
		  transition: border-color 150ms ease, background-color 150ms ease, opacity 150ms ease;
		}
		.dsh-kb-task:hover {
		  background: var(--dsh-kb-hover);
		}
		.dsh-kb-task[data-selected],
		.dsh-kb-task--active {
		  border-color: var(--dsh-kb-active);
		}
		/* T32\uFF1A\u5B8C\u6210\u4EFB\u52A1\u4FDD\u7559\u5728\u8F68\u9053\u4F46\u89C6\u89C9\u964D\u6743\uFF1B\u72B6\u6001\u8272\u4E0D\u53D8\u3001\u4E0D\u6574\u5361\u67D3\u8272 */
		.dsh-kb-task--complete {
		  opacity: 0.72;
		}
		.dsh-kb-task__title {
		  grid-column: 2;
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-task__status {
		  grid-column: 3;
		  color: currentColor;
		  opacity: 0.75;
		}
		.dsh-kb-task__meta {
		  grid-column: 2 / 4;
		  opacity: 0.6;
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-task__warn {
		  grid-column: 2 / 4;
		  display: inline-flex;
		  align-items: center;
		  gap: 4px;
		  color: var(--dsh-kb-blocked);
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-task__warn svg {
		  flex: 0 0 auto;
		}
		.dsh-kb-task__warn span {
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-task--complete .dsh-kb-task__status { color: var(--dsh-kb-complete); }
		.dsh-kb-task--blocked .dsh-kb-task__status { color: var(--dsh-kb-blocked); }
		/* D17\uFF1A\u9009\u4E2D\u4EFB\u52A1\u6240\u5728\u94FE\u8DEF\u7684\u4E0A\u6E38/\u5F53\u524D/\u4E0B\u6E38\u8DEF\u5F84\u5361\u9AD8\u4EAE\uFF1B\u4E0D\u6539\u53D8\u8FDE\u63A5\u7EBF\u8BED\u4E49\uFF0C\u9009\u4E2D\u5361\u4FDD\u6301\u5F3A\u8FB9\u6846 */
		.dsh-kb-task--related:not(.dsh-kb-task--active) {
		  border-color: color-mix(in srgb, var(--dsh-kb-active) 35%, transparent);
		  background: color-mix(in srgb, var(--dsh-kb-active) 6%, transparent);
		}
		
		.dsh-kb-empty {
		  padding: 24px 12px;
		  text-align: center;
		  color: var(--dsh-kb-text-secondary);
		  border: 1px dashed var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-lg);
		}
		
		.dsh-kb-profile {
		  grid-row: 1 / 3;
		  align-self: start;
		  width: 20px;
		  height: 20px;
		  border-radius: var(--dsh-kb-radius-sm);
		  display: inline-flex;
		  align-items: center;
		  justify-content: center;
		  font-size: 11px;
		  font-weight: 700;
		  color: #fff;
		}
		.dsh-kb-profile--v { background: var(--dsh-kb-v); }
		.dsh-kb-profile--p { background: var(--dsh-kb-p); }
		.dsh-kb-profile--w { background: var(--dsh-kb-w); }
		.dsh-kb-profile--d { background: var(--dsh-kb-d); }
		.dsh-kb-profile--pt { background: var(--dsh-kb-pt); }
		.dsh-kb-profile--dt { background: var(--dsh-kb-dt); }
		
		/* T27\uFF1A\u4EFB\u52A1\u5361\u5F39\u7A97\uFF08\u539F\u4F4D\u8BE6\u60C5\uFF09\u2014\u2014DSH \u9762\u677F\u98CE\u683C\uFF1A\u5927\u5706\u89D2 + \u62AC\u5347\u8868\u9762 + \u6D45/\u6DF1\u8272\u4EE4\u724C */
		.dsh-kb-detail {
		  display: flex;
		  flex-direction: column;
		  min-height: calc(100% - 16px);
		  margin: 8px;
		  padding: 12px 16px;
		  box-sizing: border-box;
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-lg);
		  background: var(--dsh-kb-surface);
		  color: var(--dsh-kb-text-primary);
		  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		}
		.dsh-kb-detail__header {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  padding-bottom: 8px;
		  border-bottom: 1px solid var(--dsh-kb-border);
		}
		.dsh-kb-detail__header > button:not(.dsh-kb-unread) {
		  flex: 0 0 auto;
		  width: 28px;
		  height: 28px;
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-md);
		  background: transparent;
		  color: var(--dsh-kb-text-primary);
		  cursor: pointer;
		  font: inherit;
		  line-height: 1;
		  transition: background-color 150ms ease;
		}
		.dsh-kb-detail__header > button:not(.dsh-kb-unread):hover {
		  background: var(--dsh-kb-hover);
		}
		.dsh-kb-detail__identity {
		  flex: 1 1 auto;
		  min-width: 0;
		}
		.dsh-kb-detail__identity strong,
		.dsh-kb-detail__identity span {
		  display: block;
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-detail__actions {
		  display: flex;
		  gap: 4px;
		  flex: 0 0 auto;
		}
		.dsh-kb-detail__actions button {
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-md);
		  background: transparent;
		  color: var(--dsh-kb-text-primary);
		  padding: 4px 10px;
		  cursor: pointer;
		  font: inherit;
		  white-space: nowrap; /* 2026-09-15\uFF1A\u6A2A\u5411\u7A7A\u95F4\u4E0D\u8DB3\u65F6\u6309\u94AE\u6587\u5B57\u66FE\u88AB\u9010\u5B57\u7AD6\u6392 */
		  transition: border-color 150ms ease, color 150ms ease, background-color 150ms ease;
		}
		.dsh-kb-detail__actions button:hover {
		  background: var(--dsh-kb-hover);
		}
		.dsh-kb-detail__actions button[data-confirming='true'] {
		  border-color: var(--dsh-kb-blocked);
		  color: var(--dsh-kb-blocked);
		}
		.dsh-kb-detail__actions button:disabled {
		  opacity: 0.5;
		  cursor: default;
		}
		.dsh-kb-action-form {
		  display: inline-flex;
		  align-items: center;
		  gap: 4px;
		}
		.dsh-kb-action-form input {
		  width: 140px;
		  padding: 3px 8px;
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-sm);
		  background: var(--dsh-kb-input);
		  color: var(--dsh-kb-text-primary);
		  font: inherit;
		  font-size: 12px;
		}
		/* \u8BC4\u8BBA\u8F93\u5165\uFF1A\u6309 DSH \u53D1\u9001\u6D88\u606F\u6846\u98CE\u683C\u7EDF\u4E00\uFF08\u5927\u5706\u89D2\u590D\u7528 16px \u5951\u7EA6\u4EE4\u724C\uFF09 */
		.dsh-kb-comment-input {
		  display: block;
		  width: 100%;
		  box-sizing: border-box;
		  margin-top: 8px;
		  padding: 10px 14px;
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-lg); /* \u5927\u5706\u89D2\u53D1\u9001\u6846\uFF1A\u590D\u7528 16px \u5951\u7EA6 */
		  background: var(--dsh-kb-input);
		  color: var(--dsh-kb-text-primary);
		  font: inherit;
		}
		.dsh-kb-comment-input:focus {
		  outline: none;
		  border-color: var(--dsh-kb-active);
		}
		.dsh-kb-comment-input::placeholder {
		  color: var(--dsh-kb-text-tertiary);
		}
		.dsh-kb-unread {
		  flex: 0 0 auto;
		  border: 1px solid var(--dsh-kb-active);
		  border-radius: 999px;
		  background: color-mix(in srgb, var(--dsh-kb-active) 12%, transparent);
		  color: var(--dsh-kb-active);
		  padding: 2px 8px;
		  font: inherit;
		  font-size: 12px;
		  white-space: nowrap;
		  cursor: pointer;
		}
		.dsh-kb-action-error {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  padding: 6px 8px;
		  margin: 4px 0;
		  border-left: 3px solid var(--dsh-kb-blocked);
		  color: var(--dsh-kb-blocked);
		  font-size: 12px;
		}
		.dsh-kb-action-error span {
		  flex: 1 1 auto;
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-action-error button {
		  flex: 0 0 auto;
		  border: 1px solid currentColor;
		  border-radius: var(--dsh-kb-radius-sm);
		  background: transparent;
		  color: inherit;
		  padding: 1px 6px;
		  cursor: pointer;
		  font: inherit;
		}
		.dsh-kb-detail [role='tablist'] {
		  display: flex;
		  gap: 4px;
		  padding: 8px 0;
		  border-bottom: 1px solid var(--dsh-kb-border);
		}
		.dsh-kb-detail [role='tab'] {
		  border: 0;
		  border-radius: var(--dsh-kb-radius-sm);
		  background: transparent;
		  color: var(--dsh-kb-text-secondary);
		  padding: 4px 10px;
		  cursor: pointer;
		  transition: background-color 150ms ease, color 150ms ease;
		}
		.dsh-kb-detail [role='tab']:hover {
		  color: var(--dsh-kb-text-primary);
		  background: var(--dsh-kb-hover);
		}
		.dsh-kb-detail [role='tab'][aria-selected='true'] {
		  background: var(--dsh-kb-hover);
		  color: var(--dsh-kb-text-primary);
		}
		.dsh-kb-detail [role='tabpanel'] {
		  padding: 8px 0;
		  overflow: auto;
		}
		.dsh-kb-detail h4 {
		  margin: 8px 0 4px;
		  font-size: 12px;
		  text-transform: none;
		  color: var(--dsh-kb-text-secondary);
		}
		.dsh-kb-detail code {
		  background: var(--dsh-kb-inline-code);
		  border-radius: var(--dsh-kb-radius-sm);
		  padding: 1px 4px;
		}
		.dsh-kb-detail dl {
		  display: grid;
		  grid-template-columns: auto 1fr;
		  gap: 4px 8px;
		  margin: 8px 0;
		}
		.dsh-kb-detail dt { opacity: 0.7; color: var(--dsh-kb-text-tertiary); }
		.dsh-kb-detail dd { margin: 0; }
		.dsh-kb-detail time { opacity: 0.6; font-size: 12px; margin-inline-end: 4px; }
		
		/* \u8F68\u8FF9 tab \u53EF\u8BFB\u5316\uFF1A\u7269\u6D41\u5F0F\u7EB5\u5411\u65F6\u95F4\u8F74\uFF08\u56DB\u6001\u914D\u8272 + \u6700\u65B0\u8282\u70B9\u9AD8\u4EAE\uFF1B\u5F02\u5E38\u6574\u884C\u6807\u7EA2\uFF09 */
		.dsh-kb-timeline {
		  list-style: none;
		  margin: 0;
		  padding: 0;
		  display: flex;
		  flex-direction: column;
		}
		.dsh-kb-timeline__item {
		  position: relative;
		  display: grid;
		  grid-template-columns: 16px 1fr;
		  gap: 8px;
		  padding: 0 0 14px;
		}
		.dsh-kb-timeline__item:last-child {
		  padding-bottom: 0;
		}
		/* \u7EB5\u5411\u65F6\u95F4\u7EBF\uFF1A\u8D2F\u7A7F\u8282\u70B9\uFF08\u6700\u65B0\u8282\u70B9\u4E0A\u65B9\u7EBF\u4E0D\u5EF6\u4F38\uFF0C\u6A21\u62DF\u7269\u6D41\u5934\u8282\u70B9\uFF09 */
		.dsh-kb-timeline__axis {
		  position: relative;
		}
		.dsh-kb-timeline__item:not(:last-child) .dsh-kb-timeline__axis::after {
		  content: '';
		  position: absolute;
		  left: 50%;
		  top: 14px;
		  bottom: -4px;
		  width: 2px;
		  transform: translateX(-50%);
		  background: var(--dsh-kb-border);
		}
		.dsh-kb-timeline__dot {
		  position: relative;
		  z-index: 1;
		  display: block;
		  width: 10px;
		  height: 10px;
		  /* \u6C34\u5E73\u5C45\u4E2D\u4E8E 16px \u8F74\u5217\uFF08\u4E2D\u5FC3=8px\uFF09\uFF0C\u4E0E left:50% \u8FDE\u63A5\u7EBF\u5BF9\u9F50 */
		  margin: 2px auto 0;
		  border-radius: 50%;
		  border: 2px solid var(--dsh-kb-surface);
		  box-sizing: border-box;
		  background: var(--dsh-kb-text-tertiary);
		}
		/* \u56DB\u6001\u914D\u8272\uFF1Aneutral \u7070 / running \u84DD / success \u7EFF / exception \u7EA2 */
		.dsh-kb-timeline__item--running .dsh-kb-timeline__dot {
		  background: var(--dsh-kb-active);
		}
		.dsh-kb-timeline__item--success .dsh-kb-timeline__dot {
		  background: var(--dsh-kb-complete);
		}
		.dsh-kb-timeline__item--exception .dsh-kb-timeline__dot {
		  background: var(--dsh-kb-blocked);
		}
		/* \u6700\u65B0\u8282\u70B9\u9AD8\u4EAE\uFF1A\u4E3B\u8272\u5706\u70B9\u653E\u5927 + \u67D4\u548C\u8F89\u5149 */
		.dsh-kb-timeline__item--latest .dsh-kb-timeline__dot {
		  width: 12px;
		  height: 12px;
		  margin-top: 0;
		  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsh-kb-active) 22%, transparent);
		}
		.dsh-kb-timeline__item--latest.dsh-kb-timeline__item--success .dsh-kb-timeline__dot {
		  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsh-kb-complete) 22%, transparent);
		}
		.dsh-kb-timeline__item--latest.dsh-kb-timeline__item--exception .dsh-kb-timeline__dot {
		  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsh-kb-blocked) 22%, transparent);
		}
		/* \u5F02\u5E38\u884C\uFF1A\u6D45\u7EA2\u5E95 + \u5DE6\u4FA7\u7EA2\u6761\uFF0C\u6458\u8981\u7EA2\u52A0\u7C97 */
		.dsh-kb-timeline__item--exception .dsh-kb-timeline__body {
		  background: color-mix(in srgb, var(--dsh-kb-blocked) 8%, transparent);
		  border-left: 3px solid var(--dsh-kb-blocked);
		  border-radius: var(--dsh-kb-radius-sm);
		  padding: 6px 8px;
		}
		.dsh-kb-timeline__body {
		  min-width: 0;
		}
		.dsh-kb-timeline__row {
		  display: flex;
		  align-items: baseline;
		  gap: 8px;
		  flex-wrap: wrap;
		}
		.dsh-kb-timeline__label {
		  font-size: 13px;
		  font-weight: 600;
		  color: var(--dsh-kb-text-primary);
		}
		.dsh-kb-timeline__item--success .dsh-kb-timeline__label {
		  color: var(--dsh-kb-complete);
		}
		.dsh-kb-timeline__item--exception .dsh-kb-timeline__label {
		  color: var(--dsh-kb-blocked);
		}
		.dsh-kb-timeline__summary {
		  margin: 2px 0 0;
		  font-size: 12px;
		  color: var(--dsh-kb-text-secondary);
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-timeline__item--exception .dsh-kb-timeline__summary {
		  color: var(--dsh-kb-blocked);
		  font-weight: 600;
		}
		.dsh-kb-timeline__author {
		  display: block;
		  margin-top: 2px;
		  font-size: 11px;
		  opacity: 0.7;
		  color: var(--dsh-kb-text-tertiary);
		}
		
		.dsh-kb-spec-attachments {
		  list-style: none;
		  margin: 4px 0;
		  padding: 0;
		  display: flex;
		  flex-direction: column;
		  gap: 4px;
		}
		.dsh-kb-spec-attachments li {
		  display: flex;
		  align-items: baseline;
		  gap: 6px;
		  overflow: hidden;
		  text-overflow: ellipsis;
		  white-space: nowrap;
		}
		.dsh-kb-spec-attachment__kind {
		  font-size: 11px;
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-sm);
		  padding: 0 4px;
		  opacity: 0.8;
		}
		
		@media (prefers-reduced-motion: reduce) {
		  .dsh-kb-tab * {
		    transition-duration: 0ms !important;
		  }
		}
		
		/* \u6574\u94FE\u5220\u9664\u6309\u94AE\uFF1A\u9ED8\u8BA4\u9690\u85CF\uFF0Chover \u9700\u6C42\u6807\u9898\u884C\u65F6\u51FA\u73B0\uFF08GUI \u4EC5 human\uFF0C\u4E8C\u6B21\u786E\u8BA4\uFF09 */
		.dsh-kb-chain__delete {
		  flex: 0 0 auto;
		  border: 0;
		  background: transparent;
		  color: currentColor;
		  opacity: 0;
		  font: inherit;
		  line-height: 1;
		  padding: 2px 4px;
		  cursor: pointer;
		  transition: opacity 150ms ease, color 150ms ease;
		}
		.dsh-kb-chain__title:hover .dsh-kb-chain__delete,
		.dsh-kb-chain__delete:focus-visible { opacity: 0.7; }
		.dsh-kb-chain__delete:hover { opacity: 1; color: var(--dsh-kb-blocked); }
		/* \u5220\u9664\u4E8C\u6B21\u786E\u8BA4\u5F39\u7A97\uFF08\u590D\u7528 rename \u5F39\u7A97\u5916\u58F3/\u5706\u89D2\u5951\u7EA6\uFF09 */
		.dsh-kb-delete-modal__text {
		  color: var(--dsh-kb-text-secondary);
		  font-size: 13px;
		  line-height: 1.5;
		}
		.dsh-kb-delete-modal__error {
		  color: var(--dsh-kb-blocked);
		  font-size: 12px;
		}
		.dsh-kb-rename-modal__actions .dsh-kb-delete-confirm {
		  border-color: transparent;
		  background: var(--dsw-alias-state-error-primary);
		  color: #fff;
		}
		/* T7\uFF1A\u94FE\u6807\u9898\u6539\u540D\u94C5\u7B14\u6309\u94AE + \u8F7B\u91CF\u5F39\u7A97\uFF08GUI \u4EC5 human\uFF1B\u89D2\u8272\u5361\u4E0D\u53EF\u6539\u540D\uFF09 */
		.dsh-kb-chain__rename {
		  flex: 0 0 auto;
		  border: 0;
		  background: transparent;
		  color: currentColor;
		  opacity: 0.55;
		  font: inherit;
		  line-height: 1;
		  padding: 2px 4px;
		  cursor: pointer;
		}
		.dsh-kb-chain__rename:hover { opacity: 1; }
		/* \u4EBA\u5DE5\u6062\u590D\u6309\u94AE\uFF082026-09-15\uFF09\uFF1A\u4EC5 blocked \u94FE\u663E\u793A\uFF0C\u5E38\u663E\uFF08\u4F4E\u9891\u9AD8\u4EF7\u503C\u573A\u666F\uFF0C\u660E\u786E\u6027\u4F18\u5148\u4E8E\u7D27\u51D1\u6027\uFF09 */
		.dsh-kb-chain__reopen {
		  flex: 0 0 auto;
		  border: 0;
		  background: transparent;
		  color: currentColor;
		  font: inherit;
		  font-size: 12px;
		  line-height: 1;
		  padding: 2px 6px;
		  border-radius: 4px;
		  cursor: pointer;
		  transition: background 150ms ease;
		}
		.dsh-kb-chain__reopen:hover { background: rgba(255, 255, 255, 0.12); }
		.dsh-kb-task__status-row {
		  display: flex;
		  align-items: center;
		  gap: 4px;
		}
		.dsh-kb-task__session {
		  flex: none;
		  padding: 0 6px;
		  font-size: 11px;
		  line-height: 18px;
		  border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
		  border-radius: 4px;
		  background: transparent;
		  color: inherit;
		  cursor: pointer;
		  opacity: 0.85;
		}
		.dsh-kb-task__session:hover {
		  opacity: 1;
		}
		.dsh-kb-rename-overlay {
		  position: fixed;
		  inset: 0;
		  z-index: 1000;
		  background: var(--dsh-kb-mask);
		  display: flex;
		  align-items: center;
		  justify-content: center;
		}
		.dsh-kb-rename-modal {
		  display: flex;
		  flex-direction: column;
		  gap: 8px;
		  min-width: 280px;
		  padding: 16px;
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-lg);
		  background: var(--dsh-kb-surface-elev);
		  color: var(--dsh-kb-text-primary);
		  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		}
		.dsh-kb-rename-modal__label {
		  color: var(--dsh-kb-text-primary);
		  font-size: 13px;
		  font-weight: 600;
		}
		.dsh-kb-rename-modal__input {
		  padding: 6px 10px;
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-md);
		  background: var(--dsh-kb-input);
		  color: var(--dsh-kb-text-primary);
		  font: inherit;
		}
		.dsh-kb-rename-modal__input:focus {
		  outline: none;
		  border-color: var(--dsh-kb-active);
		}
		.dsh-kb-rename-modal__actions {
		  display: flex;
		  justify-content: flex-end;
		  gap: 8px;
		}
		.dsh-kb-rename-modal__actions button {
		  border: 1px solid var(--dsh-kb-border);
		  border-radius: var(--dsh-kb-radius-md);
		  background: transparent;
		  color: var(--dsh-kb-text-primary);
		  font: inherit;
		  padding: 4px 14px;
		  cursor: pointer;
		  transition: background-color 150ms ease;
		}
		.dsh-kb-rename-modal__actions button:hover {
		  background: var(--dsh-kb-hover);
		}
		.dsh-kb-rename-modal__actions .dsh-kb-rename-save {
		  border-color: transparent;
		  background: var(--dsw-alias-button-primary-fill);
		  color: var(--dsw-alias-label-primary-foreground);
		}
		/* 2026-09-15\uFF1A\u5F39\u7A97\u64CD\u4F5C\u6309\u94AE\u7684\u7981\u7528/\u5728\u9014\u89C6\u89C9\uFF08\u6B64\u524D\u5B8C\u5168\u7F3A\u5931\u2014\u2014disabled \u65E0\u89C6\u89C9\u5DEE\u5F02\uFF0C\u70B9\u51FB\u50CF"\u6CA1\u53CD\u5E94"\uFF09 */
		.dsh-kb-rename-modal__actions button:disabled { opacity: 0.5; cursor: not-allowed; }
		.dsh-kb-rename-modal__hint {
		  color: var(--dsh-kb-text-secondary);
		  font-size: 12px;
		  line-height: 1.4;
		}
		.dsh-kb-rename-modal__success {
		  color: #2ea043;
		  font-size: 12px;
		  line-height: 1.4;
		}
		
		/* Swarm \u914D\u7F6E\u9762\u677F\u300C\u8BC4\u5BA1\u5F15\u64CE\uFF08ocr\uFF09\u300D\u5361\uFF1A\u5B89\u88C5\u4E2D spinner \u884C\u4E0E\u72B6\u6001\u884C\uFF08\u6210\u529F\u7EFF / \u8B66\u793A\u9EC4\uFF09 */
		.dsh-kb-config__installing {
		  display: flex;
		  align-items: center;
		  gap: 10px;
		  margin: 8px 0;
		}
		.dsh-kb-config__installing button {
		  margin-left: auto;
		  padding: 4px 12px;
		  border: 1px solid var(--dsh-kb-config-border, #333);
		  border-radius: 10px;
		  background: transparent;
		  color: inherit;
		  font: inherit;
		  cursor: pointer;
		}
		.dsh-kb-config__installing-spinner {
		  flex: 0 0 auto;
		  width: 14px;
		  height: 14px;
		  border: 2px solid var(--dsw-alias-border-l2, #666);
		  border-top-color: transparent;
		  border-radius: 50%;
		  animation: dsh-kb-ocr-spin 0.9s linear infinite;
		}
		@keyframes dsh-kb-ocr-spin {
		  to { transform: rotate(360deg); }
		}
		.dsh-kb-config__ocr-ok { color: var(--dsw-alias-state-success-primary, #2e9e5b); margin: 6px 0; }
		.dsh-kb-config__ocr-warn { color: var(--dsw-alias-state-warning-primary, #b8860b); margin: 6px 0; }
		.dsh-kb-config__installing button,
		.dsh-kb-config__card > button {
		  margin-top: 8px;
		}
		.dsh-kb-config__card > button {
		  padding: 6px 16px;
		  border: 1px solid var(--dsh-kb-config-border, #333);
		  border-radius: 10px;
		  background: transparent;
		  color: inherit;
		  font: inherit;
		  cursor: pointer;
		  transition: background-color 150ms ease;
		}
		.dsh-kb-config__card > button:hover:not([disabled]) { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
		.dsh-kb-config__card > button[disabled] { opacity: 0.5; cursor: not-allowed; }
		.dsh-kb-config__select-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
		`;
		
		// client/config.css
		var config_default = ".dsh-kb-config {\n  /* \u4E0E kanban.css \u5927\u5706\u89D2\u5951\u7EA6\u5BF9\u9F50\uFF08DSH \u5361\u7247 16px\uFF09 */\n  --dsh-kb-config-border: var(--dsw-alias-border-l2, #333);\n  --dsh-kb-config-radius-lg: 16px;\n  --dsh-kb-config-radius-md: 10px;\n  --dsh-kb-config-input: var(--dsw-specific-input-major, rgba(127, 127, 127, 0.12));\n  padding: 16px;\n  font-size: 13px;\n}\n.dsh-kb-config__card { border: 1px solid var(--dsh-kb-config-border); border-radius: var(--dsh-kb-config-radius-lg); padding: 20px; margin-bottom: 16px; }\n.dsh-kb-config__card h3 { margin: 0 0 14px; }\n\n.dsh-kb-config input,\n.dsh-kb-config select {\n  box-sizing: border-box;\n  width: 100%;\n  padding: 8px 12px;\n  border: 1px solid var(--dsh-kb-config-border);\n  border-radius: var(--dsh-kb-config-radius-md);\n  background: var(--dsh-kb-config-input);\n  color: var(--dsw-alias-label-primary, inherit);\n  font: inherit;\n  transition: border-color 150ms ease, background-color 150ms ease;\n}\n.dsh-kb-config input:focus,\n.dsh-kb-config select:focus {\n  outline: none;\n  /* \u7126\u70B9/\u9009\u4E2D\u5F3A\u8C03\u8272\u8DDF\u968F\u4E3B\u9898\u524D\u666F\uFF08\u6D45\u8272=\u6697\u3001\u6697\u8272=\u767D\uFF09\uFF0C\u4E0E dsh settings \u8272\u7CFB\u4E00\u81F4 */\n  border-color: var(--dsw-alias-label-primary, currentColor);\n}\n\n/* DSH \u98CE\u683C\u4E0B\u62C9\uFF1Atrigger \u884C\uFF08\u503C + \u203A chevron\uFF09+ \u5F39\u51FA\u83DC\u5355\uFF08\u9009\u4E2D\u6253\u52FE\u3001hover \u9AD8\u4EAE\uFF09 */\n.dsh-kb-config__select { position: relative; min-width: 0; }\n.dsh-kb-config__select-trigger {\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  width: 100%;\n  padding: 8px 12px;\n  border: 1px solid var(--dsh-kb-config-border);\n  border-radius: var(--dsh-kb-config-radius-md);\n  background: var(--dsh-kb-config-input);\n  color: var(--dsw-alias-label-primary, inherit);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  transition: border-color 150ms ease, background-color 150ms ease;\n}\n.dsh-kb-config__select-trigger:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }\n.dsh-kb-config__select-trigger[aria-expanded='true'] { border-color: var(--dsw-alias-label-primary, currentColor); }\n.dsh-kb-config__select-placeholder { color: var(--dsw-alias-label-tertiary, #999); }\n.dsh-kb-config__select-trigger > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-kb-config__select-chevron { flex: 0 0 auto; display: inline-flex; color: var(--dsw-alias-label-tertiary, #999); }\n.dsh-kb-config__menu {\n  position: absolute;\n  z-index: 30;\n  top: calc(100% + 6px);\n  left: 0;\n  right: 0;\n  margin: 0;\n  padding: 6px;\n  list-style: none;\n  border: 1px solid var(--dsh-kb-config-border);\n  border-radius: var(--dsh-kb-config-radius-lg);\n  background: var(--dsw-alias-bg-layer-3, #222);\n  color: var(--dsw-alias-label-primary, inherit);\n  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);\n  max-height: 260px;\n  overflow: auto;\n}\n.dsh-kb-config__option {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  width: 100%;\n  padding: 8px 10px;\n  border: none;\n  border-radius: var(--dsh-kb-config-radius-md);\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  transition: background-color 150ms ease;\n}\n.dsh-kb-config__option:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }\n.dsh-kb-config__option[data-selected='true'] { color: var(--dsw-alias-state-business-primary, #4b7bff); }\n.dsh-kb-config__option > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-kb-config__option-check { flex: 0 0 auto; display: inline-flex; }\n\n.dsh-kb-config__label { display: block; margin: 12px 0 6px; font-weight: 600; }\n.dsh-kb-config__help { color: var(--dsw-alias-label-secondary, #888); font-size: 12px; display: block; margin: 6px 0 0; }\n.dsh-kb-config__role { display: grid; grid-template-columns: 32px 1fr 1fr 1fr auto; gap: 10px; margin-bottom: 12px; align-items: center; }\n.dsh-kb-config__src { color: var(--dsw-alias-label-secondary, #888); font-size: 12px; white-space: nowrap; padding-left: 4px; }\n.dsh-kb-config__footer { display: flex; justify-content: flex-end; margin-top: 4px; }\n.dsh-kb-config__footer button {\n  padding: 6px 16px;\n  border: 1px solid var(--dsh-kb-config-border);\n  border-radius: var(--dsh-kb-config-radius-md);\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  cursor: pointer;\n  transition: background-color 150ms ease;\n}\n.dsh-kb-config__footer button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }\n.dsh-kb-config__error { color: var(--dsw-alias-state-error-primary, #e5484d); }\n";
		
		// client/index.ts
		var name = "kanban-board";
		var inject = ["slots", "sessions"];
		function apply(ctx) {
		  setSessionsService(ctx.sessions);
		  let style = null;
		  let configStyle = null;
		  if (typeof document !== "undefined") {
		    style = document.head.querySelector("style[data-dsh-swarm]");
		    if (!style) {
		      style = document.createElement("style");
		      style.setAttribute("data-dsh-swarm", "");
		      style.textContent = kanban_default;
		      document.head.appendChild(style);
		    }
		    configStyle = document.head.querySelector("style[data-dsh-swarm-config]");
		    if (!configStyle) {
		      configStyle = document.createElement("style");
		      configStyle.setAttribute("data-dsh-swarm-config", "");
		      configStyle.textContent = config_default;
		      document.head.appendChild(configStyle);
		    }
		  }
		  ctx.slots.inject(
		    "conversation.view",
		    () => ctx.slots.register(
		      { name: "conversation.view", id: "kanban", order: 20, label: "\u770B\u677F" },
		      KanbanTab
		    )
		  );
		  ctx.slots.inject(
		    "settings.section",
		    () => ctx.slots.register(
		      { name: "settings.section", id: SWARM_CONFIG_NS, order: 30, label: "Swarm \u914D\u7F6E" },
		      ConfigSection
		    )
		  );
		  return () => {
		    if (style) style.remove();
		    if (configStyle) configStyle.remove();
		    setSessionsService(null);
		  };
		}
		
		return module.exports;
	}
});
