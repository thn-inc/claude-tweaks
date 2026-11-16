# Dispatch No-Agent-Tool Carve-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a dispatched `build,test` Task call with no `Agent` tool a defined path: execute the plan in-session (a carve-out to #491), distinguished in the core contract from a write-capable child abandoned at the bound.

**Architecture:** Prose-only change to four skill files plus conformance tests. The core file (`_shared/subagent-dispatch-core.md`) states the never-launched vs abandoned distinction once; `build/execution-mode-policy.md` states the carve-out; `dispatch/task-prompt.md` item 7 and the `build,test` template restate it because they are inlined into a Task prompt whose agent never reads the core file; `flow/multispec-parallel-waves.md` inlines the same text.

**Tech Stack:** Markdown skill files; `node --test` prose-conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T121435-record-3758/work/3758-spec.md`

## Premise conflict (must be settled before Task 1)

The spec was shaped 2026-10-24. #4555 (commit `7e570e7f46`, shipped v6.160.0, after this spec) decided the **opposite** for the same environment:

- `plugin/skills/build/execution-mode-policy.md` `## No-dispatch host (#4555)`: a host with no `Agent`/`Task` tool must **stop BLOCKED** — "never implement plan tasks inline, never switch to `batched` on the run's behalf"; "That file's self-judge fallback covers read-only lens and judge units, never plan implementation."
- Under `/claude-tweaks:dispatch` it reports `OUTCOME: build-test-blocked`, `ISSUE #{n}: failed:no-dispatch-host`; `dispatch/settle-and-merge.md` settles it as a pre-flight stop (no classification, no retry count) — this already fixes the #3690 failure mode (settled `transient`, retried forever) by a different route.
- `/claude-tweaks:flow` Step 2.4 and `/claude-tweaks:build` Common Step 1.5 already run the up-front probe (spec Deliverable 3's probe exists, but stops rather than carving out).
- `tests/no-dispatch-host-preflight-conformance.test.js` pins all of the above, including a sweep (`AC2.2: neither SKILL.md tells the agent to implement plan tasks inline`).
- #4555's spec Gotcha: "Reopening inline execution as a licensed fallback means revisiting #491 explicitly, not doing it as a side effect of this record."

Spec Deliverables 1, 2, 4 and AC1, AC2, AC6 therefore reverse a shipped, human-decided contract. This plan implements the spec as written (Tasks 1-4) **only if** a human confirms that #3758 is that explicit #491 revisit. The alternative reading is to close #3758 as superseded by #4555 (its Current State — "nothing says to stop" — is no longer true).

## Global Constraints

- Every relationship between skills is stated once, in `docs/skill-graph.md`.
- Bare `/{skill}` only in descriptive prose; actionable text uses `/claude-tweaks:{skill}`.
- No `plugin/skills/**/*.md` file may exceed `RAIL_BYTES` (`plugin/bin/lib/skill-audit/budgets.js`).
- The read-only self-judge Fallback keeps its `unconfirmed` marking unchanged.

## Review Focus

- A write-capable child that **was** launched and is still silent at the bound must still end `STATUS: BLOCKED` — the carve-out must not leak into that case.
- An interactive orchestrating session that has the `Agent` tool and chooses not to use it stays non-compliant.
- `flow/multispec-parallel-waves.md`'s inlined copy of item 7 must match the edited item 7 byte for byte.
- The canonical `AUTO` line is defined once (core file) and cited, not restated, by the template.
- `/build` Common Step 1.5's preflight is where the probe result must route to the carve-out instead of the stop, or the build stops anyway.

---

### Task 1: Core contract — never-launched vs abandoned

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (Foreground Execution Discipline, the **Fallback** paragraph, ~lines 80-101)
- Test: `tests/foreground-execution-instruction.test.js`

**Interfaces:**
- Produces: the canonical AUTO text `no nested Agent tool — plan executed in-session` (cited by Tasks 2-3).

- [ ] **Step 1: Write the failing test** `core names the no-nested-agent environment and distinguishes never-launched from abandoned`: asserts the core section matches `/never launched because no `Agent` tool exists/` and still matches `/still silent at the\s+bound is never redone in-session/`; plus a go-red case deleting the new sentence.
- [ ] **Step 2: Run** `node --test tests/foreground-execution-instruction.test.js` — Expected: FAIL on the new test.
- [ ] **Step 3: Implement** one paragraph after the Fallback naming the no-nested-agent environment class and the canonical AUTO line.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `Name the no-nested-agent environment in the dispatch core — refs #3758`.

### Task 2: Execution-mode carve-out

**Files:**
- Modify: `plugin/skills/build/execution-mode-policy.md` (`## No-dispatch host (#4555)`), `plugin/skills/build/SKILL.md` (Common Step 1.5 preflight sentence), `plugin/skills/flow/SKILL.md` (Step 2.4), `plugin/skills/dispatch/settle-and-merge.md` (No-dispatch-host special case)
- Test: `tests/no-dispatch-host-preflight-conformance.test.js`

- [ ] **Step 1: Rewrite the failing pins**: a dispatched Task call with no `Agent` tool executes the plan in-session; the interactive orchestrating session may never execute the plan directly.
- [ ] **Step 2: Run** `node --test tests/no-dispatch-host-preflight-conformance.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the carve-out text and its #491-rationale sentence; re-route the stop to non-dispatched hosts only.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Carve dispatched no-Agent calls out of the inline ban — refs #3758`.

### Task 3: Task-prompt item 7, build,test template, parallel-wave inline copy

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (Context pack item 7; `## First call — build,test`), `plugin/skills/flow/multispec-parallel-waves.md`, `docs/skill-graph.md` (`subagent-dispatch-core.md` row)
- Test: `tests/foreground-execution-instruction.test.js`, `tests/subagent-contract-clauses.test.js`

- [ ] **Step 1: Write failing tests**: item 7 and the template carry the never-launched distinction; the template's probe instruction precedes the execution-strategy choice; the template cites the core AUTO line.
- [ ] **Step 2: Run** both suites — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Restate the never-launched rule in the dispatch templates — refs #3758`.

### Task 4: Full verification

- [ ] Run `npm test -- --full` and confirm 0 failures.
