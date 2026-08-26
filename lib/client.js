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
		  executing: { "chain/completed": "completed", "chain/aborted": "aborted" },
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
		    case "chain/aborted": {
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
		    // D23：audit 事件不改 Chain 状态，只写验收核对视图（auditWarnings）
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
		    // T7：链标题改名（非状态转换，只更新 title；快照重放可见）
		    case "chain/title-updated": {
		      const c = state.chains.get(ev.chainId);
		      if (!c) throw new Error("projection: unknown chain " + ev.chainId);
		      next.chains = new Map(state.chains).set(ev.chainId, { ...c, title: String(ev.payload["to"] ?? "") });
		      break;
		    }
		    // T7：任务标题改名（非状态转换，只更新 title）
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
		    case "review/gave-up": {
		      const targetId = String(ev.payload["targetTaskId"] ?? "");
		      const t = state.tasks.get(targetId);
		      if (!t) throw new Error("projection: unknown review target " + targetId);
		      const status = ev.kind === "review/passed" ? "passed" : ev.kind === "review/failed" ? "failed" : "gave-up";
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
		  const blocked = chainTasks.some((t) => t.status === "blocked");
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
		  let latest = null;
		  let latestSeq = -1;
		  for (const ev of state.events) {
		    if (ev.chainId !== chainId) continue;
		    if (ev.kind === "task/blocked" || ev.kind === "task/failed") {
		      if (ev.seq > latestSeq) {
		        latestSeq = ev.seq;
		        latest = String(ev.payload["reason"] ?? "");
		      }
		    }
		  }
		  return latest;
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
		
		// client/BoardCard.tsx
		var import_react3 = require("react");
		
		// client/RenameModal.tsx
		var import_react2 = require("react");
		var import_jsx_runtime = require("react/jsx-runtime");
		function RenameModal(props) {
		  const [value, setValue] = (0, import_react2.useState)(props.initialValue);
		  const save = () => {
		    const next = value.trim();
		    if (next) props.onSave(next);
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-kb-rename-overlay", onClick: props.onCancel, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
		    "div",
		    {
		      className: "dsh-kb-rename-modal",
		      role: "dialog",
		      "aria-modal": "true",
		      "aria-label": props.title,
		      onClick: (e) => e.stopPropagation(),
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-kb-rename-modal__label", children: props.title }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-kb-rename-modal__actions", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-kb-rename-cancel", onClick: props.onCancel, children: "\u53D6\u6D88" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-kb-rename-save", onClick: save, children: "\u4FDD\u5B58" })
		        ] })
		      ]
		    }
		  ) });
		}
		
		// client/BoardCard.tsx
		var import_jsx_runtime2 = require("react/jsx-runtime");
		function BoardCard(props) {
		  const { view } = props;
		  const { task } = view;
		  const [renaming, setRenaming] = (0, import_react3.useState)(false);
		  const blocked = view.lineState === "blocked" && view.dependencyLabel.length > 0;
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
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
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `dsh-kb-profile dsh-kb-profile--${task.assignee}`, children: task.assignee.toUpperCase() }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-kb-task__title", children: task.title }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-kb-task__status-row", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-kb-task__status", children: view.statusLabel }),
		          props.onRenameTask && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		            "button",
		            {
		              type: "button",
		              className: "dsh-kb-task__rename",
		              "aria-label": "\u6539\u4EFB\u52A1\u6807\u9898",
		              onClick: (e) => {
		                e.stopPropagation();
		                setRenaming(true);
		              },
		              children: "\u270E"
		            }
		          )
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-kb-task__meta", children: [
		          view.phase,
		          " \xB7 ",
		          view.activityLabel,
		          !blocked && view.dependencyLabel ? ` \xB7 ${view.dependencyLabel}` : ""
		        ] }),
		        blocked && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-kb-task__warn", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { viewBox: "0 0 16 16", width: "12", height: "12", "aria-hidden": "true", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M8 1.5 14.5 13.5h-13L8 1.5Z", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M8 6.2v3.6", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "8", cy: "11.6", r: "0.9", fill: "currentColor" })
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: view.dependencyLabel })
		        ] }),
		        renaming && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		          RenameModal,
		          {
		            title: "\u6539\u4EFB\u52A1\u6807\u9898",
		            initialValue: task.title,
		            onSave: (title) => {
		              props.onRenameTask?.(task.id, title);
		              setRenaming(false);
		            },
		            onCancel: () => setRenaming(false)
		          }
		        )
		      ]
		    }
		  );
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
		              props.onRenameChain && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		                "button",
		                {
		                  type: "button",
		                  className: "dsh-kb-chain__rename",
		                  "aria-label": "\u6539\u94FE\u6807\u9898",
		                  onClick: (e) => {
		                    e.stopPropagation();
		                    setRenamingChainId(view.chain.id);
		                  },
		                  children: "\u270E"
		                }
		              )
		            ]
		          }
		        ),
		        (blocked || view.blockedSummary) && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-kb-chain__warning", children: summary }),
		        view.audit && !view.audit.confirmed && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-kb-chain__warning dsh-kb-chain__audit", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
		            "\u26A0 \u4E3B agent \u7591\u4F3C\u8D8A\u6743\u5199\u5DE5\u4F5C\u533A\u4EA7\u7269\uFF08",
		            view.audit.evidenceCount,
		            " \u6761\u7EBF\u7D22\uFF09\uFF0C\u6700\u7EC8\u6C47\u62A5\u5DF2\u963B\u585E\uFF0C\u8BF7\u6838\u5BF9\u4EA7\u7269\u5F52\u5C5E"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dsh-kb-audit-confirm", onClick: () => props.onConfirmAudit?.(view.chain.id), children: "\u786E\u8BA4\u4EA7\u7269\u5F52\u5C5E" })
		        ] }),
		        expanded && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("ol", { className: "dsh-kb-nodes", children: (matched.length > 0 ? matched : view.tasks).map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("li", { className: `dsh-kb-node dsh-kb-node--${item.lineState}`, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(BoardCard, { view: item, onOpen: props.onOpenTask, onRenameTask: props.onRenameTask }) }, item.task.id)) })
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
		    )
		  ] });
		}
		
		// client/TaskDrawer.tsx
		var import_react5 = require("react");
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
		  const timeline = events.filter((e) => e.taskId === task.id).toSorted((a, b) => a.seq - b.seq);
		  const comments = timeline.filter((e) => e.kind === "task/commented");
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
		  const submitPayload = (kind) => {
		    if (pending?.kind !== kind || !pending.value.trim()) return;
		    const value = pending.value;
		    setPending(null);
		    if (kind === "block") props.onAction({ type: "block", taskId: task.id, reason: value });
		    else props.onAction({ type: "complete", taskId: task.id, summary: value });
		  };
		  const submitArchive = () => {
		    if (pending?.kind !== "archive") return;
		    setPending(null);
		    props.onAction({ type: "archive", taskId: task.id });
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
		        task.status === "running" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => arm("complete"), children: "\u5B8C\u6210" }),
		        task.status === "running" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => arm("block"), children: "\u963B\u585E" }),
		        task.status === "blocked" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => props.onAction({ type: "unblock", taskId: task.id }), children: "\u89E3\u9664\u963B\u585E" }),
		        task.status === "failed" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => props.onAction({ type: "retry", taskId: task.id }), children: "\u91CD\u8BD5" }),
		        ["done", "failed", "blocked"].includes(task.status) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", "data-confirming": pending?.kind === "archive" || void 0, onClick: pending?.kind === "archive" ? submitArchive : () => arm("archive"), children: pending?.kind === "archive" ? "\u786E\u8BA4\u5F52\u6863" : "\u5F52\u6863" }),
		        pending?.kind === "complete" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "dsh-kb-action-form", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { "aria-label": "\u4EA4\u63A5\u6458\u8981", value: pending.value, onChange: (e) => setPending({ kind: "complete", value: e.target.value }), placeholder: "\u4EA4\u63A5\u6458\u8981" }),
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", disabled: !pending.value.trim(), onClick: () => submitPayload("complete"), children: "\u786E\u8BA4\u5B8C\u6210" }),
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => setPending(null), children: "\u53D6\u6D88" })
		        ] }),
		        pending?.kind === "block" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "dsh-kb-action-form", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { "aria-label": "\u963B\u585E\u539F\u56E0", value: pending.value, onChange: (e) => setPending({ kind: "block", value: e.target.value }), placeholder: "\u963B\u585E\u539F\u56E0" }),
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", disabled: !pending.value.trim(), onClick: () => submitPayload("block"), children: "\u786E\u8BA4\u963B\u585E" }),
		          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: () => setPending(null), children: "\u53D6\u6D88" })
		        ] })
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
		    tab === "timeline" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("section", { role: "tabpanel", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ol", { children: timeline.map((event) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: event.kind }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
		        "seq ",
		        event.seq,
		        " \xB7 ",
		        event.author,
		        " \xB7 ",
		        event.at
		      ] })
		    ] }, event.seq)) }) }),
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
		          "aria-label": "\u6DFB\u52A0\u8BC4\u8BBA",
		          onKeyDown: (e) => {
		            if (e.key === "Enter") submitComment(e.target);
		          }
		        }
		      )
		    ] })
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
		        onAction: (action) => void runAction(action),
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
		        onConfirmAudit: (chainId) => void runAction({ type: "confirm-audit", chainId }),
		        onRenameChain: (chainId, title) => void runAction({ type: "rename", chainId, title }),
		        onRenameTask: (taskId, title) => void runAction({ type: "rename", taskId, title })
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
		    snapshot.board ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(KanbanBoard, { snapshot, postAction: (action) => own.postAction(action) }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "dsh-kb-loading", children: "\u52A0\u8F7D\u770B\u677F\u2026" })
		  ] });
		}
		
		// client/kanban.css
		var kanban_default = "/* T32\uFF1A\u5361\u7247/\u8FDE\u63A5\u7EBF\u7B49\u5C40\u90E8\u8FC7\u6E21\u4FDD\u6301 120-180ms\uFF1Bprefers-reduced-motion \u5168\u5C40\u5173\u95ED */\n.dsh-kb-tab {\n  --dsh-kb-complete: #22c55e;\n  --dsh-kb-active: #3b82f6;\n  --dsh-kb-blocked: #ef4444;\n  --dsh-kb-pending: currentColor;\n  --dsh-kb-v: #3b82f6;\n  --dsh-kb-p: #a855f7;\n  --dsh-kb-w: #22c55e;\n  --dsh-kb-d: #f97316;\n  --dsh-kb-pt: #6366f1; /* \u8BA1\u5212\u8BC4\u5BA1\uFF1A\u975B/\u6D45\u84DD */\n  --dsh-kb-dt: #ec4899; /* \u5B9E\u73B0\u8BC4\u5BA1\uFF1A\u73AB\u7EA2 */\n  height: 100%;\n  width: 100%;\n  min-width: 715px; /* \u770B\u677F\u6700\u5C0F\u5BBD\u5EA6 */\n  max-width: 780px; /* \u770B\u677F\u6700\u5927\u5BBD\u5EA6 */\n  margin-inline: auto;\n  display: flex;\n  flex-direction: column;\n  color: inherit;\n  background: var(--dsw-alias-bg-base);\n  pointer-events: auto;\n  font-size: 13px;\n  line-height: 1.45;\n  overflow: hidden;\n}\n\n.dsh-kb-banner {\n  flex: 0 0 auto;\n  padding: 6px 12px;\n  font-size: 12px;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n}\n.dsh-kb-banner--reconnecting,\n.dsh-kb-banner--loading {\n  color: var(--dsh-kb-active);\n}\n.dsh-kb-banner--error {\n  color: var(--dsh-kb-blocked);\n}\n\n.dsh-kb-tab-body {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow: auto;\n  padding: 8px;\n}\n\n.dsh-kb-loading {\n  flex: 1 1 auto;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: currentColor;\n  opacity: 0.7;\n}\n\n.dsh-kb-toolbar {\n  position: sticky;\n  top: 0;\n  z-index: 1;\n  padding-bottom: 8px;\n}\n.dsh-kb-toolbar input {\n  width: 100%;\n  box-sizing: border-box;\n  padding: 6px 8px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-base);\n  color: currentColor;\n}\n\n.dsh-kb-rail {\n  display: flex;\n  flex-direction: column;\n}\n/* \u72B6\u6001\u7B5B\u9009 chip \u7EC4\uFF1A\u6267\u884C\u4E2D/\u963B\u585E/\u5931\u8D25/\u5DF2\u5B8C\u6210\uFF08\u591A\u9009\u5E76\u96C6\uFF1B\u7A7A=\u9ED8\u8BA4\u89C6\u56FE\uFF09 */\n.dsh-kb-filters {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n  padding: 0 0 8px;\n}\n.dsh-kb-filter {\n  display: inline-flex;\n  align-items: center;\n  padding: 2px 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 999px;\n  background: transparent;\n  color: currentColor;\n  font: inherit;\n  cursor: pointer;\n  user-select: none;\n  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;\n}\n.dsh-kb-filter:hover {\n  background: var(--dsw-alias-bg-subtle, color-mix(in srgb, currentColor 6%, transparent));\n}\n.dsh-kb-filter--active {\n  border-color: var(--dsh-kb-active);\n  color: var(--dsh-kb-active);\n  background: color-mix(in srgb, var(--dsh-kb-active) 10%, transparent);\n}\n\n.dsh-kb-chain {\n  margin-bottom: 10px;\n}\n.dsh-kb-chain__title {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  padding: 6px 4px;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: currentColor;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  transition: background-color 150ms ease;\n}\n.dsh-kb-chain__title:hover {\n  background: var(--dsw-alias-bg-subtle, color-mix(in srgb, currentColor 6%, transparent));\n}\n/* \u6BCF\u6761\u94FE\u8DEF\u524D\u7684\u6298\u53E0\u7BAD\u5934\uFF08\u4E0E DSH \u6298\u53E0\u4EA4\u4E92\u4E00\u81F4\uFF1A\u7EC6 chevron\uFF0C\u5C55\u5F00\u65F6\u65CB\u8F6C\uFF0C150ms \u8FC7\u6E21\uFF09 */\n.dsh-kb-chain__chevron {\n  flex: 0 0 auto;\n  width: 7px;\n  height: 7px;\n  border-top: 1.5px solid currentColor;\n  border-right: 1.5px solid currentColor;\n  transform: rotate(45deg);\n  opacity: 0.7;\n  transition: transform 150ms ease;\n}\n.dsh-kb-chain__title[aria-expanded='true'] .dsh-kb-chain__chevron {\n  transform: rotate(135deg);\n}\n.dsh-kb-chain__name {\n  flex: 1 1 auto;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-kb-chain__meta {\n  opacity: 0.7;\n}\n.dsh-kb-chain__warning {\n  padding: 4px 8px;\n  margin: 2px 0 6px;\n  border-left: 3px solid var(--dsh-kb-blocked);\n  color: var(--dsh-kb-blocked);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n/* D23\uFF1A\u94FE\u5B8C\u6210\u9A8C\u6536\u6838\u5BF9\u8B66\u544A\u884C\uFF08completed \u94FE\u672A\u786E\u8BA4\u524D\u963B\u585E\u6700\u7EC8\u6C47\u62A5\uFF09 */\n.dsh-kb-chain__audit {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  white-space: normal;\n}\n.dsh-kb-chain__audit span {\n  flex: 1 1 auto;\n  overflow: hidden;\n}\n.dsh-kb-audit-confirm {\n  flex: 0 0 auto;\n  border: 1px solid var(--dsh-kb-blocked);\n  border-radius: 4px;\n  background: transparent;\n  color: var(--dsh-kb-blocked);\n  padding: 2px 8px;\n  cursor: pointer;\n  font: inherit;\n  transition: background-color 150ms ease, color 150ms ease;\n}\n.dsh-kb-audit-confirm:hover {\n  background: var(--dsh-kb-blocked);\n  color: #fff;\n}\n\n.dsh-kb-nodes {\n  list-style: none;\n  margin: 0;\n  padding: 0 0 0 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 0;\n}\n.dsh-kb-node {\n  position: relative;\n  padding-left: 12px;\n}\n.dsh-kb-node::before {\n  content: '';\n  position: absolute;\n  left: 0;\n  top: 0;\n  bottom: 0;\n  width: 2px;\n  background: var(--dsh-kb-pending);\n  transition: background-color 150ms ease;\n}\n.dsh-kb-node--complete::before { background: var(--dsh-kb-complete); }\n.dsh-kb-node--active::before { background: var(--dsh-kb-active); }\n.dsh-kb-node--pending::before {\n  background: repeating-linear-gradient(to bottom, currentColor 0 3px, transparent 3px 6px);\n}\n.dsh-kb-node--blocked::before {\n  background: repeating-linear-gradient(to bottom, var(--dsh-kb-blocked) 0 4px, transparent 4px 8px);\n}\n\n.dsh-kb-task {\n  display: grid;\n  grid-template-columns: 22px 1fr auto;\n  grid-template-rows: auto auto;\n  gap: 2px 8px;\n  width: 100%;\n  box-sizing: border-box;\n  padding: 6px;\n  margin: 4px 0;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  background: transparent;\n  color: currentColor;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  transition: border-color 150ms ease, background-color 150ms ease, opacity 150ms ease;\n}\n.dsh-kb-task[data-selected],\n.dsh-kb-task--active {\n  border-color: var(--dsh-kb-active);\n}\n/* T32\uFF1A\u5B8C\u6210\u4EFB\u52A1\u4FDD\u7559\u5728\u8F68\u9053\u4F46\u89C6\u89C9\u964D\u6743\uFF1B\u72B6\u6001\u8272\u4E0D\u53D8\u3001\u4E0D\u6574\u5361\u67D3\u8272 */\n.dsh-kb-task--complete {\n  opacity: 0.72;\n}\n.dsh-kb-task__title {\n  grid-column: 2;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-kb-task__status {\n  grid-column: 3;\n  color: currentColor;\n  opacity: 0.75;\n}\n.dsh-kb-task__meta {\n  grid-column: 2 / 4;\n  opacity: 0.6;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-kb-task__warn {\n  grid-column: 2 / 4;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  color: var(--dsh-kb-blocked);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-kb-task__warn svg {\n  flex: 0 0 auto;\n}\n.dsh-kb-task__warn span {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-kb-task--complete .dsh-kb-task__status { color: var(--dsh-kb-complete); }\n.dsh-kb-task--blocked .dsh-kb-task__status { color: var(--dsh-kb-blocked); }\n/* D17\uFF1A\u9009\u4E2D\u4EFB\u52A1\u6240\u5728\u94FE\u8DEF\u7684\u4E0A\u6E38/\u5F53\u524D/\u4E0B\u6E38\u8DEF\u5F84\u5361\u9AD8\u4EAE\uFF1B\u4E0D\u6539\u53D8\u8FDE\u63A5\u7EBF\u8BED\u4E49\uFF0C\u9009\u4E2D\u5361\u4FDD\u6301\u5F3A\u8FB9\u6846 */\n.dsh-kb-task--related:not(.dsh-kb-task--active) {\n  border-color: color-mix(in srgb, var(--dsh-kb-active) 35%, transparent);\n  background: color-mix(in srgb, var(--dsh-kb-active) 6%, transparent);\n}\n\n.dsh-kb-empty {\n  padding: 24px 12px;\n  text-align: center;\n  color: currentColor;\n  opacity: 0.7;\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: 8px;\n}\n\n.dsh-kb-profile {\n  grid-row: 1 / 3;\n  align-self: start;\n  width: 20px;\n  height: 20px;\n  border-radius: 4px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 11px;\n  font-weight: 700;\n  color: #fff;\n}\n.dsh-kb-profile--v { background: var(--dsh-kb-v); }\n.dsh-kb-profile--p { background: var(--dsh-kb-p); }\n.dsh-kb-profile--w { background: var(--dsh-kb-w); }\n.dsh-kb-profile--d { background: var(--dsh-kb-d); }\n.dsh-kb-profile--pt { background: var(--dsh-kb-pt); }\n.dsh-kb-profile--dt { background: var(--dsh-kb-dt); }\n\n.dsh-kb-detail {\n  display: flex;\n  flex-direction: column;\n  min-height: 100%;\n}\n.dsh-kb-detail__header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding-bottom: 8px;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n}\n.dsh-kb-detail__identity {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n.dsh-kb-detail__identity strong,\n.dsh-kb-detail__identity span {\n  display: block;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-kb-detail__actions {\n  display: flex;\n  gap: 4px;\n  flex: 0 0 auto;\n}\n.dsh-kb-detail__actions button {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: transparent;\n  color: currentColor;\n  padding: 4px 8px;\n  cursor: pointer;\n  font: inherit;\n  transition: border-color 150ms ease, color 150ms ease;\n}\n.dsh-kb-detail__actions button[data-confirming='true'] {\n  border-color: var(--dsh-kb-blocked);\n  color: var(--dsh-kb-blocked);\n}\n.dsh-kb-detail__actions button:disabled {\n  opacity: 0.5;\n  cursor: default;\n}\n.dsh-kb-action-form {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n.dsh-kb-action-form input {\n  width: 140px;\n  padding: 3px 6px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 4px;\n  background: var(--dsw-alias-bg-base);\n  color: currentColor;\n  font: inherit;\n  font-size: 12px;\n}\n.dsh-kb-unread {\n  flex: 0 0 auto;\n  border: 1px solid var(--dsh-kb-active);\n  border-radius: 999px;\n  background: color-mix(in srgb, var(--dsh-kb-active) 12%, transparent);\n  color: var(--dsh-kb-active);\n  padding: 2px 8px;\n  font: inherit;\n  font-size: 12px;\n  white-space: nowrap;\n  cursor: pointer;\n}\n.dsh-kb-action-error {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 6px 8px;\n  margin: 4px 0;\n  border-left: 3px solid var(--dsh-kb-blocked);\n  color: var(--dsh-kb-blocked);\n  font-size: 12px;\n}\n.dsh-kb-action-error span {\n  flex: 1 1 auto;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-kb-action-error button {\n  flex: 0 0 auto;\n  border: 1px solid currentColor;\n  border-radius: 4px;\n  background: transparent;\n  color: inherit;\n  padding: 1px 6px;\n  cursor: pointer;\n  font: inherit;\n}\n.dsh-kb-detail [role='tablist'] {\n  display: flex;\n  gap: 2px;\n  padding: 4px 0;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n}\n.dsh-kb-detail [role='tab'] {\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: currentColor;\n  padding: 4px 8px;\n  cursor: pointer;\n}\n.dsh-kb-detail [role='tab'][aria-selected='true'] {\n  background: var(--dsw-alias-bg-subtle, color-mix(in srgb, currentColor 10%, transparent));\n}\n.dsh-kb-detail [role='tabpanel'] {\n  padding: 8px 0;\n  overflow: auto;\n}\n.dsh-kb-detail h4 {\n  margin: 8px 0 4px;\n  font-size: 12px;\n  text-transform: none;\n}\n.dsh-kb-detail dl {\n  display: grid;\n  grid-template-columns: auto 1fr;\n  gap: 4px 8px;\n  margin: 8px 0;\n}\n.dsh-kb-detail dt { opacity: 0.7; }\n.dsh-kb-detail dd { margin: 0; }\n.dsh-kb-detail time { opacity: 0.6; font-size: 12px; margin-inline-end: 4px; }\n\n.dsh-kb-spec-attachments {\n  list-style: none;\n  margin: 4px 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.dsh-kb-spec-attachments li {\n  display: flex;\n  align-items: baseline;\n  gap: 6px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-kb-spec-attachment__kind {\n  font-size: 11px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 4px;\n  padding: 0 4px;\n  opacity: 0.8;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dsh-kb-tab * {\n    transition-duration: 0ms !important;\n  }\n}\n\n/* T7\uFF1A\u94FE\u6807\u9898/\u4EFB\u52A1\u5361\u6539\u540D\u94C5\u7B14\u6309\u94AE + \u8F7B\u91CF\u5F39\u7A97\uFF08GUI \u4EC5 human\uFF09 */\n.dsh-kb-chain__rename,\n.dsh-kb-task__rename {\n  flex: 0 0 auto;\n  border: 0;\n  background: transparent;\n  color: currentColor;\n  opacity: 0.55;\n  font: inherit;\n  line-height: 1;\n  padding: 2px 4px;\n  cursor: pointer;\n}\n.dsh-kb-chain__rename:hover,\n.dsh-kb-task__rename:hover { opacity: 1; }\n.dsh-kb-task__status-row {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n.dsh-kb-rename-overlay {\n  position: fixed;\n  inset: 0;\n  z-index: 1000;\n  background: rgba(0, 0, 0, 0.35);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.dsh-kb-rename-modal {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  min-width: 280px;\n  padding: 12px;\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-l1, #fff);\n  color: var(--dsw-alias-text-1, #111);\n  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);\n}\n.dsh-kb-rename-modal__input {\n  padding: 6px 8px;\n  border: 1px solid var(--dsw-alias-border-l2, #ccc);\n  border-radius: 4px;\n  background: transparent;\n  color: currentColor;\n  font: inherit;\n}\n.dsh-kb-rename-modal__actions {\n  display: flex;\n  justify-content: flex-end;\n  gap: 8px;\n}\n.dsh-kb-rename-modal__actions button {\n  border: 1px solid var(--dsw-alias-border-l2, #ccc);\n  border-radius: 4px;\n  background: transparent;\n  color: currentColor;\n  font: inherit;\n  padding: 4px 12px;\n  cursor: pointer;\n}\n.dsh-kb-rename-modal__actions .dsh-kb-rename-save {\n  border-color: transparent;\n  background: var(--dsh-kb-active, #2f6feb);\n  color: #fff;\n}\n";
		
		// client/index.ts
		var name = "kanban-board";
		var inject = ["slots"];
		function apply(ctx) {
		  let style = null;
		  if (typeof document !== "undefined") {
		    style = document.head.querySelector("style[data-dsh-swarm]");
		    if (!style) {
		      style = document.createElement("style");
		      style.setAttribute("data-dsh-swarm", "");
		      style.textContent = kanban_default;
		      document.head.appendChild(style);
		    }
		  }
		  ctx.slots.inject(
		    "conversation.view",
		    () => ctx.slots.register(
		      { name: "conversation.view", id: "kanban", order: 20, label: "\u770B\u677F" },
		      KanbanTab
		    )
		  );
		  return () => {
		    if (style) style.remove();
		  };
		}
		
		return module.exports;
	}
});
