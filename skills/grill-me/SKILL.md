---
name: grill-me
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

## Plain language first (hard rule)

- Every question body must be plain language a non-expert can act on. If a term is unavoidable, explain it in one short parenthetical the first time: `term (plain explanation)`.
- Multiple-choice options are candidate answers, not jargon showcases: their labels and descriptions follow the same rule.
- The recommended-answer line follows the same rule; technical detail goes in parentheses.
- Self-check before sending any question: _could someone unfamiliar with this repo answer it directly?_ If not, rewrite it.

## Work in rounds

The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

If this round's answers surface a real risk or a non-blocking concern, append one line at the end of the round:

```
⚠️ **Risk/Concern**: <what could go wrong or what to watch> — source: <which decision it came from> — mitigation: <idea>
```

Optional: only when something real surfaced this round. Never invent entries to fill it. Non-blocking concerns are assumptions worth noting, things to observe later, and suggestions — anything that doesn't block progress but deserves attention.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

## Closing deliverable

The session is done when the frontier is empty and the user confirms you have reached a shared understanding. Do not act on the plan until the user confirms. Once they confirm, produce the closing deliverable:

Write `grill-<topic-slug>-plan.md` to the project root, using this exact template:

```markdown
# <Topic> 澄清计划清单 — <date>

## 1. 需求澄清清单
| # | 问题（人话版） | 最终答案/决定 |
|---|---|---|

## 2. 功能点
- <feature list distilled from the answers>

## 3. 事实
- <verified environment/code facts, each with its source file path>

## 4. 风险点
- <description + source decision + mitigation idea; write 无 if none>

## 5. 非阻塞关注点
- <assumptions / items to observe / suggestions; write 无 if none>
```

Then report the file path plus a one-line summary in the conversation. The deliverable captures clarification output only — no implementation steps; planning and implementation belong to a separate flow.
