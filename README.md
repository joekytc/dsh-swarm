# dsh-swarm

[简体中文](README.zh-CN.md) · [English](README.md)

---

**Say one requirement, reply one confirmation — six specialist agents take it from planning to verified delivery. No commands to memorize.**

dsh-swarm is a DSH plugin that turns one requirement into a strict, evidence-verified delivery pipeline. An orchestrator (V) decomposes an approved spec into a strictly ordered phase chain (`p → (pt?) → w2 → d → dt → w3 → summary`); six single-purpose roles (V / P / W / D / PT / DT) run each phase with isolated, permission-gated tool faces; every handoff is machine-verified against an evidence contract; failures recover through idempotent retry and human-gated reviews; and a live Workflow kanban tab streams all state to the browser via SSE. Design inspired by the [Hermes Agent kanban](https://github.com/NousResearch/hermes-agent).

![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![npm](https://img.shields.io/npm/v/@joekytc/dsh-swarm)

---

## Swarm mode (recommended)

Swarm mode turns your main session into a **team lead**: **you state the requirement, it clarifies, plans, confirms, delegates and follows through** — entirely in natural language, no commands to remember.

- **No commands to memorize** — just state your requirement; no `/plan:` or `/openspec:` prefixes needed.
- **Automatic intent recognition** — development requests → clarify/plan and build a chain; lessons & retrospectives → persist to memory; group notifications → deliver to WeCom; Q&A / chit-chat → answered directly.
- **Free delivery** — `/sms <intent>` (e.g. "post current progress to the group"): facts are grounded via kanban lookup, then the body is composed per intent and delivered; `-s` or wording like "private chat" targets the DM. Group and private-chat targets must each be exactly one (0 or 2+ targets error out; clean up in dsh-im settings or set `imDelivery.dmTargetId`).
- **Confirmation gate against accidental chains** — after the checklist is saved, a chain is only built once you reply with an explicit affirmative (`确认` / `开干` / `开跑` / `开始` / `go`, etc.); vague replies, topic switches, or edit-only feedback count as *not confirmed*.
- **The lead is read-only** — the main session cannot write/edit repo sources, nor run git mutations (push/commit/checkout…); writing code is done by the executor (D) in an isolated workspace by design.
- **Progress is always actually queried** — ask "how is it going?" anytime and the lead reports from real kanban lookups, never fabricated.

### Why it's designed this way

Coordinating several agents on one task typically fails in three ways:

- **Role drift** — the "planner" starts writing code, the "executor" reviews its own work, and nobody owns the outcome.
- **Unverifiable handoffs** — an agent claims "done" with no reproducible evidence, and the next agent builds on sand.
- **Silent deadlocks** — an agent stops without finishing and the pipeline hangs, or bad code is merged before anyone reviewed it.

dsh-swarm encodes a *contract* against all three: one machine-enforced responsibility per role;
every handoff must carry structured evidence or the phase will not close; every stall or review
failure lands in a visible, recoverable state — with you (the human) as the final trust anchor.
It is built correctness-first: deterministic state machines, append-only event sourcing, idempotent
schedulers, and a red-team test suite that replays the event log and rejects any illegal transition
(mechanics in [Advanced](#advanced--developers)).

### Two modes

| Mode | How you use it | Notes |
|---|---|---|
| **Swarm mode** (recommended) | Just say the requirement in natural language | No commands to memorize, intent auto-recognized, runs on confirmation |
| **Command mode** (compatible) | `/plan: <requirement>` → clarify → `/openspec: confirm` | Kept for compatibility, functionally equivalent; may be removed in the future — new users should use swarm mode |

---

## Quickstart

### 1. Install

Prerequisites: a working DSH runtime (`@deepseek-ai/*`), Node.js ≥ 22.19 and npm. Optional: a wiki-vault HTTP service (KB features, see [Configuration](#configuration)).

```bash
npm install
npm run build        # tsc -p tsconfig.build.json + client bundle (lib/client.js)
dsh plugin --profile web add @joekytc/dsh-swarm
```

> From GitHub source: `dsh plugin --profile web add github:joekytc/dsh-swarm`

### 2. Switch your main-session preset

Switch the main session's agent preset to **Swarm (蜂群模式)** — it is installed at `$DSH_HOME/.agent-presets/swarm` once the plugin is installed.

### 3. Say → confirm → watch progress

Example conversation:

```
You: Add a role-management page to the admin project with CRUD and permission checkboxes

Lead: Let me confirm a few things first —
  · Which role fields do you need (name/description/status/…)?
  · Permission source: the existing menu tree, or custom?
  · Any acceptance requirements, e.g. "deleting a role must not affect linked users"?

You: Fields are name and description, permissions from the existing menu tree, acceptance via TDD

Lead: Checklist saved (six spec sections + repo facts). Reply "confirm" to launch —
      I'll spin up the p → (pt) → w2 → d → dt → w3 pipeline.

You: confirm

Lead: Chain created (ch_…), live progress on the kanban tab (Conversation → Trajectory → Kanban).
      First phase: Planning (P)…
```

- **Kanban**: the third tab of the conversation center (Conversation → Trajectory → Kanban). Click a card for Overview / Trajectory / Handoff / Spec / Comments.
- **Completion**: when a chain completes, the system audits the workspace and (for D chains) automatically merges the feature branch into the spec-declared target branch; if an audit warning fires, confirm ownership in the GUI first.
- **Progress**: just ask "how is it going?" — the lead reports from real kanban lookups and relays blocking reasons faithfully.

---

## What it does for you

Six roles, one job each, machine-enforced boundaries — no role creep:

| Role | One-line responsibility | What it never does |
|---|---|---|
| **V** Orchestrator | Creates phase cards, drives the pipeline, gives guidance on stalls | Never executes |
| **P** Planner | Reads the spec + repo facts, writes the implementation plan | Never writes code |
| **PT** Plan reviewer | Read-only review of P's plan (on demand) | Never changes anything |
| **W** Knowledge officer | Syncs the KB in planning/completion phases | Never touches code/git |
| **D** Executor | The only role that writes code: implement → verify → commit → push feature branch | Never merges into the target branch itself |
| **DT** Implementation reviewer | Empirically verifies D's delivery (tests/build/typecheck/diff) | Read-only against the repo |

The pipeline (strictly serial within a chain, parallel across chains):

```text
p ──> (pt?) ──> w2 ──> d ──> dt ──> w3 ──> summary
plan   plan rev.  KB    impl  impl rev.  KB    wrap-up
```

- `pt` appears only when P decides a plan review is needed; `d` is **always** followed by an implementation review (`dt`).
- Chain completion is decided by a mechanical rule (W3 done + D done with delivery evidence + no open tasks), not by an agent's self-assessment.

---

## Configuration

All keys are optional; schema lives in `src/config.ts`. **Most users only need the first three** — keep the rest at their defaults.

| Key | Default | Description |
|---|---|---|
| `storageDir` | `$DSH_HOME/storages/kanban` | Event log (`events.jsonl`), orchestration state, per-task workspaces, `dispatcher.log`. Value must use the unquoted `!!js dshHomePath("storages/kanban")` form — quoting degrades it into a literal string |
| `wikiVault.baseUrl` | `''` (empty) | wiki-vault HTTP service for KB reads/writes — required for KB features; set to your own server |
| `roles.models.<role>` | `{}` | Per-role model: `{ provider, model, reasoningEffort?, fallbacks?[] }` |
| `roles.models.<role>.reasoningEffort` | `high` | Default reasoning effort for all roles |
| `roles.models.<role>.fallbacks` | `[]` | Silent fallback candidates (audited via `[model-fallback]` comment) |
| `dispatcher.staleTimeoutSeconds` | `14400` | Heartbeat timeout; running task without heartbeat is reclaimed |
| `dispatcher.maxRetries` | `3` | Failure retries before circuit → `blocked(gave_up)` |
| `dispatcher.heartbeatIntervalSeconds` | `300` | Watchdog heartbeat period |
| `dispatcher.maxProtocolViolations` | `2` | Protocol-violation guardrail: after this many consecutive violations the next one is final (`gave_up`) |
| `dispatcher.maxReworksPerRole` | `{ pt: 2, dt: 3 }` | Max review rework rounds before `review/gave-up` + `[review-final]` |
| `prefixRoutes.plan` | `/plan:` | Command-mode planning prefix |
| `prefixRoutes.openspec` | `/openspec:` | Command-mode approve-and-execute prefix |
| `ui.enabled` | `true` | Enable the kanban web tab |
| `ui.contentMinWidth` | `715` | Minimum kanban content width (px) |
| `ui.contentMaxWidth` | `780` | Maximum kanban content width (px) |
| `ui.sseHeartbeatSeconds` | `20` | SSE heartbeat interval |

---

## Review engine (ocr)

Implementation reviews (the in-chain DT phase and standalone reviews) are powered by
[open-code-review](https://open-codereview.ai) (ocr), with two modes switchable in the
web config panel under "Swarm config → Review engine (ocr)":

| Mode | How it works | Notes |
|---|---|---|
| **Delegate** (default) | ocr only outputs the review scope and rules; DT reviews each file with its own model | Zero API keys, works out of the box |
| **Managed** | ocr runs the full review with your chosen provider/model and returns normalized findings in one shot | For large change sets; delegate mode hints at switching past 50 files (a hint only, never auto-switched) |

### Install

- When ocr is missing, the config panel shows a red banner — click "Install ocr" for a one-click global install (async, cancellable);
- or run `npm install -g @alibaba-group/open-code-review` in a terminal, then verify with `ocr --version`.

### Standalone review (no chain needed)

1. Switch the session to "Delivery Reviewer (DT)" at the top of the dsh web UI and just talk;
2. State the review target: a local directory / branch range (from…to) / a single commit / uncommitted workspace diff / a public repo URL (auto-cloned into a temp dir, discarded afterwards);
3. The report is first fully output to the conversation;
4. Only after you confirm is it written to the wiki at `projects/<repo>/reviews/<topic>-<date>/`. Read-only throughout — reviewed code is never modified.

### Configuration notes

- Mode, provider and model are all chosen on the "Review engine (ocr)" card; the provider/model dropdowns share the same catalog as the model chain;
- After picking, click "Apply to ocr" — the system writes the wiring into ocr's custom config (`dsh-managed`); the API key is resolved from the dsh model config and written into ocr, never shown in plain text in the panel; if resolution fails it degrades gracefully and points you to a manual `ocr config provider` in a terminal;
- When managed is not ready, reviews silently fall back to delegate mode — nothing is blocked.

Official docs: [Installation](https://open-codereview.ai/docs/installation) · [Model configuration](https://open-codereview.ai/docs/configuration) · [Delegate mode](https://open-codereview.ai/docs/delegate)

---

## Trust & guardrails (user's view)

- **Read-only hard gate for the lead** — in swarm mode, main-session writes to sources and git mutations are blocked by a system gate; if blocked, just let the lead explain — execution is done by the D role.
- **Confirmation gate** — no chain is ever built without your explicit confirmation.
- **TDD hard gate** — implementations must ship with tests (or an explained skip); reviews machine-verify "tests really ran, and were written first".
- **Human trust anchors** — spec approval, unblock, audit confirmation and chain deletion are human-only; neither the main session nor role agents can create chains or approve specs.
- Full mechanics (permission matrix, delivery contract, review chain, rework, failure recovery) live under [Advanced / Developers](#advanced--developers).

---

## Advanced / Developers

> Mechanics and implementation details below — regular users can skip.

### Roles & the execution pipeline (full table)

Six roles are dispatched by the scheduler as one-shot agent sessions (deterministic session id `kbn-<taskId>`, resumed on retry/rework via `resumeSessionId`). Each role-agent session is bound to exactly one task (`boundTaskId`) and gets a trimmed tool face. V is the exception: a chain-scoped orchestrator session (`kbn-v-<chainId>`) with no `boundTaskId`.

| Role | Alias | Responsibility | Tool face (highlights) |
|---|---|---|---|
| **V** | Orchestrator | Drives the phase machine, creates one card per phase, posts `[blocked-review]` guidance on stalls. Never executes. | `kanban_create` + task tools + spec view |
| **P** | Planner | Reads spec + repo facts (incl. read-only self-checks), writes an OpenSpec implementation plan, opts into PT via `pt_decision.needed`. Never executes. | Task tools + spec view, read-only (writes only `openspec/changes/`) |
| **PT** | Plan reviewer | Read-only review of P's plan (requirements alignment, completeness, logic). Outputs verdict + issues. | Task tools + spec view, **read-only ToolGuard** |
| **W** | Knowledge officer | W2/W3 KB sync (`w:kb`). Never touches code/git. | Task tools + `wiki_search/read/write` (remote) / `skill`→llm-wiki (local) + read-only spec view |
| **D** | Executor | The *only* role that writes code: worktree → implement → verify → `[AI-GEN]` commit → push feature branch (merging into the spec-declared target branch is done by the system only after DT passes). | Task tools + wiki read + bash/fs/run_code (full dev) + subagent (spawn/fork/list-agents) + goal |
| **DT** | Implementation reviewer | Empirically verifies D's work (test/build/typecheck/diff/git + open-code-review), writes review page to KB. Read-only against the repo. | Task tools + wiki read/write (review namespace) + bash/fs/run_code, **read-only ToolGuard** |

### Guardrails in detail

#### Permission matrix

`can(action, actor, task, { boundTaskId })` in `src/domain/permissions.ts`.
"Bound" means the actor is the role agent session spawned for *that exact task*
(`boundTaskId === task.id` and, for `complete`, also `actor === task.assignee`).

| Action | V | P | W | D | PT | DT | Human | System |
|---|---|---|---|---|---|---|---|---|
| create-chain / create-task | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| claim | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| complete | ❌ | bound | bound | bound | bound | bound | ✅ (GUI) | ✅ |
| block | ❌ | bound | bound | bound | bound | bound | ✅ | ✅ |
| heartbeat | ❌ | bound | bound | bound | bound | bound | ❌ | ❌ |
| comment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| unblock | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| archive | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| spec-approve | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| spec-edit | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| spec-attach | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| update-title | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| delete-chain | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| wiki-write | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ (review ns) | ❌ | ❌ |
| wiki-read | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| prefetch | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| audit-confirm | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| create-rework-task | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

Key guarantees (two):

- **The main session cannot execute.** It only gets `kanban_show`/`kanban_list`/
  `kanban_comment` + `spec_card_view` + `kanban_route` — never
  `kanban_create`/`kanban_complete`/`kanban_block`. Chains/specs are created only
  via swarm-mode intents or `/plan:`+`/openspec:`; the GUI observes and mutates task state but never
  creates chains or tasks — "who decided to run what" stays explicit and auditable.
- **Session binding prevents cross-task escalation** (a W agent bound to task A
  cannot complete/block task B even though both are W tasks); DT writes are
  confined to the `projects/<repoSlug>/<chain>/review/` namespace by a ToolGuard on top of
  the matrix; and no role agent can approve specs, unblock, or confirm audits —
  those are human trust anchors; `system` handles only mechanical bookkeeping.

#### Delivery contract (upstream owes downstream)

Each phase's handoff must carry the keys its downstream actually reads
(`src/domain/delivery-contract.ts`). Missing keys block the current role's card
immediately (and the orchestrator never builds a downstream card on a blocked
parent):

| Card | Required handoff keys |
|---|---|
| W2 / W3 (`w:kb`) | `kb_url` + `page_path` |
| P (`p:openspec`) | `artifacts_path` + `pt_decision` (`needed` boolean required; when `needed: true`, `reason` is required) |
| D (`d:execute`) | `changed_files` + (`commit_hash` or `push`) — `hasDeliveryEvidence`; `branch` (feature branch) is expected for the merge gate, not a hard-complete blocker; `tdd` (`test_files` or `skipped.reason`, XOR) |
| PT / DT | `review_evidence` (schema-valid) — `validateReviewEvidence` |

#### TDD hard gate (evidence threshold)

D completes only with `tdd` — `test_files` (with `test_first`) or `skipped.reason`
(XOR, `delivery-evidence.ts`). DT's `review_evidence` must carry `tdd`; on a
`pass` verdict the runner must be `vitest` (`test.runner`) and `test_first === true`
must hold (`review-evidence.ts`). This makes "tests actually ran, and were written
first" a machine-checked property rather than a claim.

#### Phase-0 planning checklist

Planning runs a read-only planning session (`grill-me` → `planning_prefetch` →
`planning_checklist_save`, `planning-driver.ts`). The checklist carries a structured
manifest (repo facts + file baseline, `prefetch-manifest.ts`); an invalid manifest
blocks the save, and chain creation mounts the checklist as the `file-prefetch` +
`kb` attachments on the spec card (`prefix-router.ts`).

#### Review quality chain

- After **P** completes, **PT** is created only when P's handoff delivers
  `pt_decision.needed = true`; the orchestrator never overrides the decision
  (V only creates the card).
- After **D** completes, a **DT** card is *always* created.
- **PT/DT are read-only**: a ToolGuard mechanically denies writes to the repo
  sources, git mutations, and (for DT) wiki writes outside the review namespace.
- **DT** review engine: `open-code-review` (ocr, dual mode: delegate/managed, see
  [Review engine (ocr)](#review-engine-ocr)); a pre-start probe blocks
  `review-tool-unavailable` when ocr is missing (reason notes GUI install),
  without burning retries.
- `review_evidence` must pass `validateReviewEvidence` or the review card cannot
  complete: PT needs verdict + issues + plan ref; DT additionally needs
  test (exit 0 on pass), build/typecheck, lint, non-empty diff, git,
  ocr/fallback conclusion, and `tdd`.

#### Rework (review failure)

A failed review never mutates a `done` card. Instead the system records
`review/failed`, creates a **rework task** (`[返工] ...`) that inherits the source's
session (`resumeSessionId`), `reviewAttempt + 1`, and starts as `todo`
(`reviewStatus: 'pending'`), then re-dispatches a fresh review card for the rework.
When `reviewAttempt` reaches `maxReworksPerRole` (PT 2 / DT 3), the system records
`review/gave-up` and posts a `[review-final]` evidence-chain comment; the pipeline
stalls at the review stage for human intervention.

#### Failure recovery

Two orthogonal failure paths, both human-recoverable:

- **Protocol violation** (agent idle without `complete`/`block`): role agent →
  `blocked(protocol_violation)` → V posts idempotent `[blocked-review]` guidance →
  human unblocks → same-session resume (NOT a fresh start). After
  `maxProtocolViolations` (2) recoverable cycles, the next violation →
  `blocked(gave_up)` + system posts `[blocked-final]` evidence chain (block
  timeline + review/comment timeline + final reason).
- **Hard failures & circuit**: `task/failed` increments `attempts`; the dispatcher
  re-dispatches (same-session resume) while `attempts < maxRetries`, then circuits
  to `blocked(gave_up: max retries)`. The watchdog reclaims `running` tasks that
  stop heartbeating after `staleTimeoutSeconds` (heartbeats are a *status* signal,
  never a business mutation; SSE heartbeats never carry board state). Per-role
  model candidates (primary + fallbacks, `reasoningEffort: high` default) fall
  back silently (audited via `[model-fallback]` comment); if *all* candidates fail
  it blocks `model-unavailable` for the human. A single hanging V wake cannot
  stall the scheduler — every dispatch is wrapped in a timeout.

#### Chain completion: audit gate + merge gate

When the mechanical chain-complete rule fires, two gates run in the
`chain/completed` hook:

1. **Completion audit gate**: the `ChainAuditor` cross-checks the chain
   workspace for artifacts written outside the known task outputs. Orphaned writes
   emit `chain/audit-warning`; the UI shows a warning banner and blocks the final
   summary until the human confirms ownership (`chain/audit-confirmed`, human-only).
2. **Merge gate (post-DT system merge)**: D never merges to the target branch and
   never pushes it — it only commits to (and optionally pushes) its feature branch,
   carrying `branch` in its handoff. The target branch is the one declared in the
   spec (written by V into the D task body). After DT approves and the chain
   completes, `merge-gate.ts` performs, as `system`: `git checkout <target-branch>
   → git merge --no-ff <feature-branch> → git push`. Outcomes are recorded as
   idempotent comments: `[merge-done]` (with hash), `[merge-skip]` (merge input
   unresolvable), or `[merge-failed]` (checkout/merge/push failed, e.g. a conflict).
   Failures never throw — a bad merge is never performed, which is the safe
   direction; humans can repair afterwards.

### Event sourcing & domain model

Every state change is appended to `<storageDir>/events.jsonl`, one JSON event per
line. The `seq` is assigned by the store (re-read from the file tail on every
append, so concurrent instances never collide). The **trajectory is the event log
itself**; restart replays it to rebuild the board.

```jsonc
// one line in events.jsonl
{ "seq": 12, "chainId": "ch_x_...", "taskId": "t_y_...",
  "kind": "task/completed",
  "payload": { "summary": "...", "metadata": { /* handoff evidence */ } },
  "author": "w", "at": 1760000000000 }
```

Event families: `chain/*` (created, executing, completed, aborted, root-task-set,
audit-warning, audit-confirmed, title-updated), `spec-card/*` (created, edited,
approved), `task/*` (created, claimed, heartbeat, commented, completed, blocked,
unblocked, failed, archived, renamed), and `review/*` (passed, failed, gave-up).

Replay is **strict**: the projection applies every event through the state machine
and throws on any illegal transition, so a corrupted or tampered log fails loudly
instead of silently producing an inconsistent board (covered by
`tests/redteam/anti-escalation.test.ts` and `tests/domain/projection.test.ts`).

The service emits events through a serialized queue (append-then-publish), and
subscribers (SSE) receive every event exactly once in order. UI and dispatcher both
consume the same persisted events — there is no secondary source of truth.

### Web client (Workflow kanban tab)

A browser-half React tab registered as the third `conversation.view` slot
(`id=kanban`, `order=20`, after Conversation and Trajectory). It registers **no
shell-level overlays, sidebars, or detail panes**.

- **Data path**: initial snapshot (`GET /kanban/board`) → SSE stream
  (`GET /kanban/events?after=<seq>`) → board-store applies events incrementally,
  deduplicates by `seq`, and re-pulls the full snapshot on any gap. **No business
  polling.**
- **Layout**: multi-chain vertical rails; fixed content width 715–780 px, full
  height; the active chain is expanded, blocked chains always show a warning
  summary. In-page rename/delete use a lightweight modal (no shell overlays);
  no drag-and-drop, no width memory.
- **Cards**: compact two-line cards with profile-colored nodes; status lines are
  green solid (done) / blue solid (current) / gray dashed (pending) / red broken
  (blocked).
- **Detail drawer**: five sections — Overview / Trajectory / Handoff / Spec /
  Comments; `Esc` or back returns to the list.
- **Actions** (`POST /kanban/action`): block / unblock / retry / complete /
  archive / comment, plus chain-level `confirm-audit`, `rename` (chain or task),
  and `delete` (chain, human-only, double-confirmed in the GUI). Human actions
  apply optimistic updates with rollback; the store reconciles against the
  authoritative snapshot on any divergence.
- **Build**: `npm run build:client` produces `lib/client.js` in the
  `window.__ModuleLoader__.load()` format (identical convention to `dsh-client-*`).
  Adding dsh-swarm to a web profile auto-embeds it into `__DSH_BOOT__`.

### Architecture

Five layers, with the domain layer kept **free of any DSH dependency** so it can be
fully unit-tested and replayed in isolation.

```mermaid
flowchart TB
    subgraph Client
        Tab["conversation.view tab (id=kanban, order=20)"]
        Store["board-store: snapshot + SSE + seq gap resync"]
        Model["workflow-model: pure view projection"]
    end

    subgraph Domain ["domain/ (pure TS, zero DSH deps)"]
        ES["event-store (JSONL append-only, monotonic seq)"]
        SM["state-machine (task/chain/spec transitions)"]
        PJ["projection (events → BoardState)"]
        PM["permissions (actor × session-bound matrix)"]
        KS["kanban-service (three-interface facade)"]
        EC["delivery-contract / delivery-evidence / review-evidence / prefetch-manifest"]
    end

    subgraph Integration ["integration (cordis)"]
        TOOLS["tools: kanban_* / spec_card_* / wiki_* / prefetch_* / kanban_route"]
        ROUTES["prefix-router + planning-driver (/plan: /openspec: + intent)"]
        HTTP["kanban-http + kanban-sse (/kanban/board, /kanban/events, /kanban/action)"]
    end

    subgraph Dispatcher ["dispatcher/"]
        WAKER["event-waker (events → wake V)"]
        VORCH["v-orchestrator (phase machine)"]
        RUNNER["agent-runner (one-shot role sessions, presets, ToolGuards)"]
        WD["watchdog (heartbeat / stale reclaim / circuit)"]
        AUDIT["chain-auditor (completion audit)"]
        MG["merge-gate (post-DT system merge)"]
    end

    subgraph Roles ["roles/ + personas/"]
        PRESETS["preset-installer (6 role presets + swarm)"]
        TOOLSETS["toolsets (per-role tool faces + write guards + swarm hard gate)"]
        WK["wiki-worker (W prefetch worker)"]
    end

    subgraph Wiki ["wiki/"]
        WVC["wiki-vault-client (search/read/write)"]
    end

    Store <-->|HTTP/SSE| HTTP
    Tab --> Store --> Model
    ROUTES --> KS
    TOOLS --> KS
    HTTP --> KS
    WAKER --> VORCH
    VORCH --> KS
    VORCH --> RUNNER
    RUNNER --> TOOLSETS --> PRESETS
    RUNNER --> WVC
    WK --> WVC
    AUDIT --> KS
    MG --> KS
    KS --> ES --> PJ --> SM --> PM
    EC --> KS
```

#### Layer responsibilities

- **Domain** (`src/domain/`) — the entire business model as pure TypeScript:
  event store, state machines, projection, permission matrix, delivery/review/
  manifest validators, and the `KanbanService` facade that routes every write from
  tools, CLI, and UI through one authority. Extensively unit-tested.
- **Integration** (`src/tools/`, `src/routes/`) — cordis tools and routes:
  the role tool faces, main-session tools (`kanban_route` + read-only subset), and
  the `/kanban/*` HTTP/SSE bridge.
- **Dispatcher** (`src/dispatcher/`) — event wake, phase orchestration, one-shot
  agent runner (persona preset mounting, model candidate chain, ToolGuard
  installation), watchdog, chain auditor, and merge gate.
- **Roles** (`src/roles/`, `personas/`) — trimmed agent presets installed into
  `$DSH_HOME/.agent-presets/` (including the swarm preset), per-role tool
  assembly, write-guard logic, and the swarm-session hard gate.
- **Wiki** (`src/wiki/`) — thin HTTP client for wiki-vault.

### Development

Quality gates (see `AGENTS.md`):

```bash
npm run typecheck   # tsc -p tsconfig.json --noEmit  (0 errors)
npm test            # npx vitest run  (all green)
npm run build       # tsc -p tsconfig.build.json + build:client (lib/client.js)
```

GUI verification (only when a dsh web instance is already running on port 3080;
do **not** start a second instance):

```bash
python tests/e2e/gui-check.py --url http://127.0.0.1:3080/
```

> Deploying to a running DSH instance requires a plugin reload/restart; building
> alone does not hot-reload the running plugin.

### Implemented & known limitations

#### Implemented (v0.1.0)

- [x] **Swarm mode**: natural-language intent recognition (plan/openspec/learning/send) + confirmation gate + read-only main-session hard gate
- [x] Event-sourced domain + deterministic state machines (red-team replay)
- [x] 6-role phase pipeline with trimmed presets and session-bound permissions
- [x] Delivery contract + review evidence gates + rework lifecycle
- [x] TDD hard gate (D `tdd` handoff + DT `test_first` / `runner=vitest` verification)
- [x] Protocol-violation recovery, heartbeat watchdog, failure circuit
- [x] Chain completion audit gate + human confirm
- [x] Post-DT merge gate (D pushes feature branch only)
- [x] Phase-0 planning checklist + `file-prefetch` attachment
- [x] GUI chain/task rename + chain delete (human-only)
- [x] Model candidate chain with silent fallback + high reasoning effort
- [x] Live SSE kanban tab (Conversation → Trajectory → Kanban)

#### Known limitations

- **Swarm-mode intent recognition relies on model self-judgment**: misjudgments are caught by the confirmation gate (no confirmation, no chain), but the risk is non-zero.
- **Write guards are string-heuristic, not hard isolation.** PT/DT ToolGuards
  rely on path/command regex and reviewers get no git credentials; a soft
  constraint plus audit trail, not a mount-level sandbox.
- **`open-code-review` (ocr) is optional per machine**: when missing, in-chain
  reviews block `review-tool-unavailable` before DT starts, with install guidance
  (one-click GUI install available) — no retries burned.
- **Review evidence is existence-checked, not replay-proven.** Fields must be
  present and well-formed; proving the tests actually ran is not yet supported.
- **Single default wiki-vault host** in the config default — point
  `wikiVault.baseUrl` at your deployment.
- **PT creation depends on P's self-reported `pt_decision.needed`** —
  system-assisted detection from repo signals is not yet implemented.

---

## License

[MIT](LICENSE)
