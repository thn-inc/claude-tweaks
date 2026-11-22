# Packet Least-confident lists planning calls (#6054) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The acceptance packet's **Least confident** section lists every `Settled at planning:` line from the `## Planning Decisions` sections of the covered record's materialized spec, after the Review Console's low-confidence entries.

**Architecture:** A pure parser in `packet-gather.js` pulls the settled lines out of spec text; `lowConfidenceFindings` takes an optional `{ records, readSpec }` and appends one `{ n, text }` entry per line, numbered on from the console entries. Each entry becomes a `finding:{n}` fact exactly as console entries do, so the narration rule (one `least-confident` claim per `finding` fact, `wrap-up/verification-brief.md`) and the render screens (`inline()` on claim text, `screenedInline` on fact text) apply unchanged. The CLI (`bin/acceptance-packet.js`) supplies `readSpec(n)`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T171233-spec-6054/work/6054-spec.md` (materialized from GitHub issue #6054)

Scope keywords: Settled at planning, Planning Decisions, lowConfidenceFindings

## Global Constraints

- Parse the exact prefix `Settled at planning:` and the exact heading `## Planning Decisions` as `plugin/skills/_shared/planning-decisions.md` states them — never a paraphrase.
- A `Decided by the user at planning:` line is never listed.
- With no `## Planning Decisions` section, or a missing/unreadable spec, the packet is byte-identical to today's.
- `readSpec(n)` resolves `{run-dir}/work/{n}-spec.md`; when that does not read, the packet's own record falls back to the `--spec` file (decisions.md, Spec Step 3: in worktree mode the run dir anchored at `$RUN_ROOT` holds no `work/` until merge, and `--spec` already resolves the worktree copy first).
- Existing two-argument `lowConfidenceFindings(console, readStaged)` calls keep their exact output.

## Review Focus

1. A `Settled at planning:` line inside a fenced code block in the section (an example, not a call) — not listed (Task 1 test `settledPlanningLines ignores fenced lines`).
2. A `### Sub-heading` inside `## Planning Decisions` — does not end the section; only a `## ` heading does (Task 1 test `a deeper heading stays inside the section`).
3. Console findings unreadable (findingItems throws) but the spec has settled lines — the settled entries still list, numbered from 1, and the `review findings not read` partial note stays (Task 2 test).
4. A line with leading indentation or `* ` bullet — not the grammar; not listed (Task 1 test `only column-0 lines, bare or behind "- ", count`).
5. A gather with no `--run` but a `--spec` holding settled lines — the lines still list (Task 2 test).

---

### Task 1: Parse settled planning lines and append them to the low-confidence entries

**Files:**
- Modify: `plugin/bin/lib/wrap-up/packet-gather.js` (constants near the other `*_RE` constants; `lowConfidenceFindings` at ~line 195; `module.exports`)
- Test: `tests/bin-lib/wrap-up/packet-gather.test.js`
- Waived `plugin/skills/_shared/planning-decisions.md`: read only — the line grammar the pin test reads; no change.

**Interfaces:**
- Produces: `PLANNING_DECISIONS_HEADING = '## Planning Decisions'`, `SETTLED_PLANNING_PREFIX = 'Settled at planning:'` (exported strings); `settledPlanningLines(specText: string|null) -> string[]` (each entry is the line with its optional leading `- ` removed and trailing whitespace trimmed, prefix kept; non-string input → `[]`); `lowConfidenceFindings(console, readStaged, { records = [], readSpec = () => null } = {}) -> Array<{ n: number, text: string }>`.

Parsing rules: iterate `linesOutsideFences(specText)`; a line `trimEnd() === PLANNING_DECISIONS_HEADING` opens a section (every occurrence, so specify's and the build's sections are both read); any other line starting `## ` closes it; inside a section a line matching `/^(?:- )?Settled at planning:/` (built from the constant, regex-escaped) is one entry; nothing continues onto a following line.

- [ ] **Step 1: Write the failing tests** in `packet-gather.test.js` (import `settledPlanningLines`, `PLANNING_DECISIONS_HEADING`, `SETTLED_PLANNING_PREFIX`):
  - `settledPlanningLines lists the two settled lines of a section` — spec with `## Planning Decisions` holding `Settled at planning: a — chose x; not y` and `- Settled at planning: b — chose p; not q` → `['Settled at planning: a — chose x; not y', 'Settled at planning: b — chose p; not q']` (AC1).
  - `a Decided by the user line is not listed` — section holding one `Decided by the user at planning: c — chose m; not n` and one settled line → only the settled line (AC2).
  - `no section yields nothing` — spec with `## Overview` and a stray `Settled at planning: z` line outside any section → `[]` (AC3, prefixed line outside the section ignored).
  - `two sections are both read` — `## Planning Decisions` / settled `a` / `## Original request` / settled-looking `x` / `## Planning Decisions` / settled `b` → `['Settled at planning: a…', 'Settled at planning: b…']` (AC6).
  - `a deeper heading stays inside the section`, `settledPlanningLines ignores fenced lines`, `only column-0 lines, bare or behind "- ", count` (`  Settled at planning: i` and `* Settled at planning: j` not listed), `null spec yields nothing`.
  - `entries number on after the console entries` — `lowConfidenceFindings({ items: [{ id: 'review-unconfirmed-1.md', section: 'Low-confidence findings' }], findings: [], decisions: '' }, () => 'Title: console one', { records: [7], readSpec: (n) => (n === 7 ? twoSectionSpec : null) })` deep-equals `[{ n: 1, text: 'console one' }, { n: 2, text: 'Settled at planning: a…' }, { n: 3, text: 'Settled at planning: b…' }]` (AC6).
  - `several records read each spec, in record order` — `records: [7, 9]`, each spec one line → both listed, 7's first.
  - `a missing spec adds nothing` — `readSpec` returns `null` → output deep-equals the two-argument call's (AC5).
  - `the parser's prefix and heading are the shared contract's` — read `plugin/skills/_shared/planning-decisions.md`; assert it includes `` `${SETTLED_PLANNING_PREFIX} {finding} `` and `` `${PLANNING_DECISIONS_HEADING}` section `` (Deliverable 5). Go-red: mutate either constant by one character and confirm the test fails, then restore.
  - `a settled line carrying markdown renders neutralized` — gather facts with `gatherPacketFacts` from a minimal input whose `lowConfidence` comes from a spec line `Settled at planning: ## x [l](https://e.example) @octo #12 — chose a; not b`, render with `renderPacket` (`packet-render.js`) and a `least-confident` claim whose `text` is that fact's `text` and `refs: ['finding:1']`; the Least confident line contains no raw `## `, `[l](`, bare `@octo` or bare `#12` (each escaped or code-spanned per `acceptance-packet.md`'s Untrusted content).

- [ ] **Step 2: Run** `node --test tests/bin-lib/wrap-up/packet-gather.test.js` — Expected: FAIL (`settledPlanningLines is not a function`).

- [ ] **Step 3: Implement** the constants, `settledPlanningLines`, and the third parameter of `lowConfidenceFindings` in `packet-gather.js`: map the console entries as today, then `records.flatMap((n) => settledPlanningLines(readSpec(n)))`, numbering continues from the console count. Export the three new names.

- [ ] **Step 4: Run** `node --test tests/bin-lib/wrap-up/packet-gather.test.js` — Expected: PASS, every pre-existing test included.

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/wrap-up/packet-gather.js tests/bin-lib/wrap-up/packet-gather.test.js`, message `List settled planning lines as low-confidence entries — parse ## Planning Decisions in packet-gather (refs #6054)`.

### Task 2: Wire `readSpec` into the gather CLI and name the source in the contract

**Files:**
- Modify: `plugin/bin/acceptance-packet.js` (`readLowConfidence` ~line 602, its call ~line 702)
- Modify: `plugin/skills/_shared/acceptance-packet.md` (Sections item 6, line 22)
- Test: `tests/acceptance-packet-cli.test.js`

**Interfaces:**
- Consumes: `lowConfidenceFindings(console, readStaged, { records, readSpec })` from Task 1.
- Produces: `readLowConfidence(runDir: string|null, deps, notes, { record: number, spec?: string }) -> Array<{n,text}>|null`.

Behavior: `readSpec(n)` = `runDir !== null ? readTextOrNull(deps, path.join(runDir, 'work', `${n}-spec.md`)) : null`, then, when that is `null` and `n === record` and `spec` is set, `readTextOrNull(deps, spec)`; `records = [record]`. With `runDir === null` the console part is empty (`{ items: [], findings: [], decisions: '' }`), no note. When `findingItems` throws: push `FINDINGS_NOT_READ` as today and return the settled entries alone (from the empty console). Return `null` only when there are no entries and the console was not read, so a gather with nothing new stays byte-identical.

- [ ] **Step 1: Write the failing tests** in `acceptance-packet-cli.test.js`, through the existing `gather(ws, args, overrides)` harness and `--record 7`:
  - `gather lists settled planning lines from the run dir's materialized spec` — write `{ws.runDir}/work/7-spec.md` with a section of two settled lines; `gather(ws, ['--run', ws.runDir])` → `idsOf(facts, 'finding')` is `['finding:1', 'finding:2']`, texts are the two lines (AC1).
  - `gather falls back to --spec for the record's own spec` — no `work/7-spec.md`; `--spec` file holds one settled line → one `finding` fact.
  - `gather with no run dir reads --spec` — no `--run`; `--spec` with one settled line → one `finding` fact (Review Focus 5).
  - `a spec with no Planning Decisions leaves the facts unchanged` and `a missing or unreadable spec leaves the facts unchanged` — compare the facts JSON against the same gather run without the spec content (AC3, AC5): identical `facts` and `partial`.
  - `unreadable console findings still list the settled lines` — make `staged/` unreadable the way the existing `FINDINGS_NOT_READ` test does; facts hold `finding:1` from the spec and `partial` includes `review findings not read — low-confidence findings not listed` (Review Focus 3).

- [ ] **Step 2: Run** `node --test tests/acceptance-packet-cli.test.js` — Expected: FAIL (no `finding` facts).

- [ ] **Step 3: Implement** the behavior above in `acceptance-packet.js`, passing `{ record: opts.record, spec: opts.spec }` from `gatherToFile`.

- [ ] **Step 4: Update** `acceptance-packet.md` item 6 to: `6. **Least confident** — claims citing `finding` facts: the Review Console's low-confidence items, then one per `Settled at planning:` line in a `## Planning Decisions` section of the covered record's materialized spec (`{run-dir}/work/{n}-spec.md`, else the `--spec` file), numbered on from them. Empty: `not applicable: no low-confidence review findings`.` — the empty text unchanged (Deliverable 2).

- [ ] **Step 5: Run** `node --test tests/acceptance-packet-cli.test.js tests/acceptance-packet-contract-conformance.test.js tests/bin-lib/wrap-up/packet-gather.test.js tests/bin-lib/wrap-up/packet-render.test.js tests/control-mode-packet-gather.test.js tests/risk-flags-packet-e2e.test.js` — Expected: PASS.

- [ ] **Step 6: Commit** — `git add plugin/bin/acceptance-packet.js plugin/skills/_shared/acceptance-packet.md tests/acceptance-packet-cli.test.js`, message `Read each covered record's materialized spec into the packet gather — readSpec seam, --spec fallback (refs #6054)`.

---

## Self-review

- **Spec coverage:** D1 → Task 1 (parser, ordering, numbering) + Task 2 (wiring); D2 → Task 2 Step 4; D3 → Task 1 tests (no section, two lines, Decided line, markdown neutralized); D4 → Task 2 (`readSpec`, missing/unreadable → nothing); D5 → Task 1 pin test. AC1-AC3, AC5, AC6 → named tests; AC4 → central `npm test`.
- **Return-shape widening:** `lowConfidenceFindings` returns the same `{ n, text }` shape; existing callers pass two arguments and get identical output (asserted by `a missing spec adds nothing`).
- **Placeholders:** none.
