# Tidy Scan — Uncapped Rows and Main-Thread Reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy's scan agents return every finding as its own row (no 15-row cap, no "+N more" count row), and Step 4.5's mutating reconcile runs in the main thread before the scan batch so every scan agent is read-only.

**Architecture:** Two prose edits in the tidy skill — the inlined Template A variant in `scan-execution.md`, and the lead-in of Step 4.5's "Reconcile first" paragraph in `scan-procedures.md` plus a pre-dispatch sentence in `scan-execution.md`'s dispatch block — pinned by one new `node --test` conformance file.

**Tech Stack:** Markdown skill prose; Node 18+ `node:test` + `node:assert/strict`; `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T172234-spec-4468-4465-4423/spec-4468/work/4468-spec.md` (record #4468)

## Global Constraints

- AC: No tidy scan template instructs an agent to collapse findings into a count row.
- Do not touch `plugin/skills/_shared/subagent-dispatch-core.md`'s shared Template A — other skills keep its cap.
- Keep the reconcile command text `hooks.js" reconcile --checks mirror,red-tip,reap,release,archive,archive-branches,remote-prune,ledger-residue,console --json` byte-identical (`tests/reconcile.test.js:1299` pins it), and keep the sentence `A non-empty \`console.ready\` array names answered consoles … follow \`_shared/console-execution.md\`` (`tests/console-execution.test.js:121` pins it).
- Keep `scan-execution.md`'s existing phrases `only read — they write nothing` and `single-assistant-message rule` (`tests/worktree-forge-api-carve-out.test.js:100`, `tests/subagent-contract-clauses.test.js`).
- Commit messages: `{Verb} {what} — {detail}`, ending with the trailer `Claude-Session: https://claude.ai/code/session_01YPgdwTF5oxR7DnGFhhiX8r`.

## Review Focus

- A `--scope` run that excludes Step 4.5 (e.g. `--scope plans`) must not run the pre-dispatch reconcile — the new sentence ties it to "when Step 4.5 is in scope".
- The scan agent for Step 4.5 must not re-run reconcile itself — the Step 4.5 paragraph must say the agent starts at the shared probe and never runs it.
- `console.ready` close-out (`_shared/console-execution.md`) mutates too — it moves to the main thread with the reconcile, not left in the agent.
- The no-count-row rule must cover both shapes the lint rejects ("+N more" and "(and N more") — the template forbids any count/summary row, not just the literal.
- The `decisions.md` log of the reconcile JSON is a write — it is the main thread's, not the agent's.

---

### Task 1: Uncapped scan-agent output template

**Files:**
- Create: `tests/tidy-scan-dispatch-conformance.test.js`
- Modify: `plugin/skills/tidy/scan-execution.md:33`
- Modify: `plugin/skills/tidy/step-1-records.md:144` (inlined whole into the Work Records agent's prompt — `SKILL.md`:74 — so it must not keep citing the cap)

**Interfaces:**
- Produces: `tests/tidy-scan-dispatch-conformance.test.js` with a top-level `SCAN_EXECUTION` (`read('plugin/skills/tidy/scan-execution.md')`) and `SCAN_PROCEDURES` (`read('plugin/skills/tidy/scan-procedures.md')`) constant, built the way `tests/materiality-floor-conformance.test.js` builds its `read` helper. Task 2 appends tests to this file.

- [ ] **Step 1: Write the failing test** (covers AC1.1) — header comment naming record #4468; tests:
  - `scan-execution.md's scan template carries no row cap or count row (#4468)`: `assert.doesNotMatch(SCAN_EXECUTION, /\+N more/)`; `assert.doesNotMatch(SCAN_EXECUTION, /at most \d+ rows/i)`.
  - `scan-execution.md's scan template requires one row per finding (#4468)`: `assert.match(SCAN_EXECUTION, /Return every finding as its own row/)`; `assert.match(SCAN_EXECUTION, /never collapse findings into a count or summary row/)`.
  - `step-1-records.md no longer cites a scan-agent row cap (#4468)`: with `STEP1_RECORDS = read('plugin/skills/tidy/step-1-records.md')`, `assert.doesNotMatch(STEP1_RECORDS, /15-row/)`; `assert.match(STEP1_RECORDS, /the candidates file, not the table, carries the full repair list/)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tidy-scan-dispatch-conformance.test.js`
Expected: FAIL (both tests — the cap text is present, the new sentence absent)

- [ ] **Step 3: Replace line 33 of `plugin/skills/tidy/scan-execution.md`** with exactly (it must not itself contain the literal `+N more`, which Step 1's test forbids):
  `> Return every finding as its own row, highest severity first, with no row cap — never collapse findings into a count or summary row: the Step 6 report renders one row per record (\`step-6-auto.md\`'s Report rules), and the dispatcher holds only the rows you return.`
  Also in `plugin/skills/tidy/step-1-records.md:144`, replace `— this agent's 15-row table cap never truncates the repair list —` with `— the candidates file, not the table, carries the full repair list —`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tidy-scan-dispatch-conformance.test.js tests/worktree-forge-api-carve-out.test.js tests/materiality-floor-conformance.test.js tests/subagent-contract-clauses.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/tidy-scan-dispatch-conformance.test.js plugin/skills/tidy/scan-execution.md plugin/skills/tidy/step-1-records.md
git commit -m "Uncap tidy scan-agent rows — every finding its own row, no +N more count row (#4468)

Claude-Session: https://claude.ai/code/session_01YPgdwTF5oxR7DnGFhhiX8r"
```

### Task 2: Step 4.5 reconcile runs in the main thread before the scan batch

**Review risk:** high

Why high: ordering — a mutating reconcile must finish before the parallel scan batch dispatches; agents read the state it converges.

**Files:**
- Modify: `plugin/skills/tidy/scan-procedures.md:77` (lead-in only)
- Modify: `plugin/skills/tidy/scan-execution.md:14` (dispatch block) and `:8` (read-only note)
- Test: `tests/tidy-scan-dispatch-conformance.test.js` (append)

**Interfaces:**
- Consumes: `SCAN_EXECUTION`, `SCAN_PROCEDURES` from Task 1.

- [ ] **Step 1: Append failing tests**
  - `scan-procedures.md Step 4.5 reconcile runs in the main thread before the scan batch (#4468)`: slice `SCAN_PROCEDURES` from `'## Step 4.5:'` to `'## Step 4.6:'`; `assert.match(section, /\*\*Reconcile first — main thread, before the scan batch:\*\*/)`; `assert.match(section, /the Step 4\.5 scan agent never runs it/)`.
  - `scan-execution.md's dispatch block runs Step 4.5's reconcile before dispatching (#4468)`: `assert.match(SCAN_EXECUTION, /Before dispatching the batch, when Step 4\.5 is in scope, run its reconcile in the main thread/)`; `assert.match(SCAN_EXECUTION, /scan agents are read-only/)`; `assert.match(SCAN_EXECUTION, /inlined Step 4\.5 section starts at "Worktrees and merged remote branches — shared probe"/)`; `assert.match(SCAN_EXECUTION, /feed Step 6's \*\*Applied automatically\*\* section/)`; `assert.match(SCAN_EXECUTION, /Step 1's `\{release-note-candidates-file\}` is the one write/)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tidy-scan-dispatch-conformance.test.js`
Expected: FAIL (the two new tests)

- [ ] **Step 3: Edit prose**
  - `scan-procedures.md:77`: replace the lead `**Reconcile first:** before any probe below, run` with `**Reconcile first — main thread, before the scan batch:** the dispatcher runs this before it dispatches the scan batch (\`scan-execution.md\`), and the Step 4.5 scan agent never runs it — the agent starts at the shared probe below, reading converged state. Run`. Rest of the paragraph unchanged (the `decisions.md` log and the `console.ready` close-out stay in it, so they too are main-thread).
  - `scan-execution.md:14`: insert a new blockquote paragraph immediately before the `> **Parallel execution:** Dispatch the agent-backed steps…` line: `> **Before dispatching the batch, when Step 4.5 is in scope, run its reconcile in the main thread** (\`scan-procedures.md\` Step 4.5's "Reconcile first" paragraph, including its \`decisions.md\` log and \`console.ready\` close-out), so every agent reads converged state; its converged and skipped results feed Step 6's **Applied automatically** section directly from that JSON. The Step 4.5 agent's inlined Step 4.5 section starts at "Worktrees and merged remote branches — shared probe" — never the reconcile paragraph. The scan agents are read-only: none runs reconcile, a console, or a repo, forge, or run-dir write; Step 1's \`{release-note-candidates-file}\` is the one write, a dispatcher-substituted scratch output.` followed by a `>` blank line. A `--scope` run that excludes Step 4.5 runs no reconcile (the user's plan-review decision, Reading A).
  - `scan-execution.md:8`: append to the existing sentence's end `… only when Step 7's approved set holds a working-tree write.` → add a new sentence after it on the same paragraph: ` Step 4.5's reconcile is the one convergence write before the batch, and it runs in the main thread (below).` Keep `only read — they write nothing` verbatim.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/tidy-scan-dispatch-conformance.test.js tests/reconcile.test.js tests/console-execution.test.js tests/worktree-forge-api-carve-out.test.js tests/materiality-floor-conformance.test.js tests/subagent-contract-clauses.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/tidy-scan-dispatch-conformance.test.js plugin/skills/tidy/scan-procedures.md plugin/skills/tidy/scan-execution.md
git commit -m "Move tidy Step 4.5 reconcile to the main thread — scan agents stay read-only (#4468)

Claude-Session: https://claude.ai/code/session_01YPgdwTF5oxR7DnGFhhiX8r"
```
