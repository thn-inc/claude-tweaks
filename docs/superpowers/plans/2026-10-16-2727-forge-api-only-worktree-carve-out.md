# #2727 — Forge-API-only worktree carve-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** State once, in shipped prose, that an invocation whose every write is a forge-API call needs no worktree under `worktree-always`. Cite it from the session-start banner and from each qualifying skill, so `/claude-tweaks:backlog refine`-class invocations stop paying for create → catch-up merge → hand-verified teardown.

**Architecture:** The canonical paragraph lives in `plugin/skills/_shared/worktree-setup.md`'s `## Adopt-or-create`, and `## Post-creation catch-up` gets one cross-reference sentence. The session-start banner's "Before making any edits" becomes "Before editing repository files" and names the carve-out. Four skill files each get a short note that cites the canonical paragraph by name and states that skill's own exceptions. No hook *logic* changes: the `worktree-always` PreToolUse gate already does not intercept `gh`.

**Tech Stack:** Markdown skill prose; one Node hook string; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T173115-spec-2702-2727-2776/spec-2727/work/2727-spec.md`

**Scope keywords:** before making any edits, worktree needed, requires an isolated worktree for all work

## Global Constraints

- **`ExitWorktree` is out of scope.** It is a harness tool, so the spec's Deliverable 2 is not implemented (spec Gotchas). AC1 is met through its "skips worktree creation entirely" disjunct.
- **Scope the carve-out to whole invocations.** It covers only invocations whose *entire* write surface is a forge-API call, a gate-exempt path, or a path outside the repository. A skill with a local-write branch states that branch as an exception; it never gets a blanket carve-out (spec Gotchas).
- **Cite, don't restate.**
  - `_shared/policy-schema-coverage.md`'s gate-coverage block is the single statement of what the gate intercepts. Cite it and never re-list it (`[IL-93]`).
  - The four skill notes cite the canonical paragraph by its bold anchor and never restate its test.
- **`CLAUDE.md` is not modified.** Its Key File premise was reversed at build time: no worktree-always paragraph exists there (logged in `spec-2727/decisions.md`).
- **Byte budgets:**
  - `_shared/worktree-setup.md` is 21,363 B, and the composed `worktree-setup` bundle is about 42.7 KB of 51,200 B. Task 1's two additions measure 955 B together (inline self-check: 22,318 B result, bundle about 43.7 KB).
  - `backlog/refine-mode.md` (41,810 B) and `capture/SKILL.md` (40,275 B) must stay under the 46,080 B warn band, so each note there is ~250–450 B.
- **Don't move #2702's paragraph.** Its anchor `**Resolve plugin-supplied values to literals once.**` must stay put; `tests/worktree-setup-plugin-root-literal.test.js` pins guard < anchor < "Unconditionally, before anything else runs".
- **Commit messages:**
  - Style: `{Verb} {what} — {detail} (refs #2727)`.
  - Trailer: `Claude-Session: https://claude.ai/code/session_01VLs2NeQT4MqaySGyzuPpAM`.

## Authoring checks (build/plan-authoring-checks.md)

- **Byte-pin:** the only file-specific pin is `tests/backlog-refine-resolve-lane.test.js:138-139` (`refine-mode.md` < 51,200 B; post-change 42,147 B, ~9 KB headroom). There is no per-skill ceiling for backlog/capture/tidy in `tests/bin-lib/skill-audit/context-cost.test.js`, and no `compose-context.js` bundle includes the four Task 3 files. Inline self-check sizes: refine-headless 35,577; refine-mode 42,147; capture/SKILL 40,663; scan-execution 6,664 — all under the 46,080 B warn band.
- **Behavioral claims:**
  - "the gate guards repository files": `plugin/skills/_shared/policy-schema-coverage.md`'s gate-coverage block / `pre-tool-use.js` `GATE_COVERAGE` — no `gh` entry.
  - "the `health-state` ref a `bin/` CLI pushes": `plugin/bin/lib/health-core/durable-state.js:327` (`git push origin {sha}:refs/heads/health-state`, run inside a node subprocess, so no Bash `git push` shape reaches the gate).
  - "`local-files` stops at Preflight": `refine-headless.md:63`.
  - "unsynced record → `writeRecord` + `git commit`": `refine-mode.md:363-372`.
  - "capture gh-failure fallback writes `specs/`": `capture/SKILL.md:253`.
  - "tidy provisions only Step 7.5's worktree": `tidy/step-7-5-worktree-always.md:11`, `tidy/SKILL.md:242`.
- **Moved-prose pin:** no prose moves. For the banner, the strings `Before making any edits` and `isolated worktree for all work` were grepped across `tests/`, `docs/`, `plugin/`, and `README.md`; the only hit is `session-start.js` itself.
- **Inline self-consistency:** Task 1 + Task 3's inlined tests were run against their inlined Step 3 text in a scratch copy (`scratchpad/selfcheck-2727.js`): 12/12 pass, including #2702's `tests/worktree-setup-plugin-root-literal.test.js`. Task 2's assertions were checked by inspection against the inlined banner string — every positive literal is present, and both negative literals are absent.

## Review Focus

1. **Mixed invocations.** A github-issues `/claude-tweaks:backlog refine` whose worklist includes a `facets.unsynced === true` record does write a local file (`writeRecord` + `git commit`). The refine-mode note must name that exception. Pinned in Task 3.
2. **Capture fallback.** Capture's gh-failure fallback writes a local `specs/` record, and its `brainstorm` route writes a design doc. The capture note must name both. Pinned in Task 3.
3. **Deferred entry, not "never".** The canonical paragraph must say the carve-out *ends* at the first working-tree write, and that Adopt-or-create runs at that point. It must not read as "these skills never need a worktree". Pinned in Task 1.
4. **Banner contradiction.** "requires an isolated worktree for all work" sitting next to a carve-out reads as self-contradictory, so the opener narrows to repository edits. Pinned in Task 2.
5. **Restated gate list.** A later edit that copies the gate's tool list into the canonical paragraph is the `[IL-93]` drift shape. Pinned by a negative assertion in Task 1.

---

### Task 1: Canonical carve-out paragraph + catch-up cross-reference

**Files:**
- Modify: `plugin/skills/_shared/worktree-setup.md:29-43`
  - Insert a paragraph after the first Adopt-or-create paragraph (which ends "(`docs/incident-log.md`).") and before `**Already isolated:**`.
- Modify: `plugin/skills/_shared/worktree-setup.md:109-111`
  - Insert one paragraph directly after the `## Post-creation catch-up` heading, before "For the rest of this session's lifetime".
- Create: `tests/worktree-forge-api-carve-out.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the anchor string `**Forge-API-only invocations need no worktree.**`, which Tasks 2–3 cite by name: `"Forge-API-only invocations need no worktree"`.

- [ ] **Step 1: Write the failing test**

Create `tests/worktree-forge-api-carve-out.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #2727: an invocation whose every write is a forge-API call (backlog refine,
// a github-issues capture, tidy's scan batch) was being pushed into a full
// worktree under worktree-always — create, catch-up merge, then a hand-proved
// ancestry check before teardown — for zero repository-file writes. The
// worktree-always PreToolUse gate never intercepted gh; only the prose did.

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const SETUP = readText(path.join(SKILLS, '_shared', 'worktree-setup.md'));
const ANCHOR = '**Forge-API-only invocations need no worktree.**';
const CITE = 'Forge-API-only invocations need no worktree';

function section(heading) {
  const start = SETUP.indexOf(heading);
  assert.notStrictEqual(start, -1, `${heading} heading missing`);
  const end = SETUP.indexOf('\n## ', start + 1);
  return SETUP.slice(start, end === -1 ? undefined : end);
}

function paragraph() {
  const s = section('## Adopt-or-create');
  const at = s.indexOf(ANCHOR);
  assert.notStrictEqual(at, -1, 'carve-out paragraph missing from Adopt-or-create');
  const end = s.indexOf('\n\n', at);
  return s.slice(at, end === -1 ? undefined : end);
}

test('worktree-setup.md: carve-out sits in Adopt-or-create, before the Already-isolated branch', () => {
  const s = section('## Adopt-or-create');
  const anchor = s.indexOf(ANCHOR);
  const isolated = s.indexOf('**Already isolated:**');
  assert.ok(anchor !== -1 && isolated !== -1, 'anchor or Already-isolated branch missing');
  assert.ok(anchor < isolated, `expected carve-out(${anchor}) before Already isolated(${isolated})`);
});

test('worktree-setup.md: carve-out names forge-API writes, cites the gate block, and ends at the first working-tree write', () => {
  const p = paragraph();
  assert.match(p, /forge-API call/, 'must name forge-API calls as the qualifying write');
  assert.match(p, /policy-schema-coverage\.md/, 'must cite the gate-coverage block for exemptions');
  assert.match(p, /first working-tree write/, 'carve-out must end at the first working-tree write');
  assert.match(p, /at that point/, 'Adopt-or-create runs at that point, not never');
  assert.match(p, /own exceptions/, 'each qualifying skill states its own exceptions');
});

test('worktree-setup.md: carve-out does not restate the gate coverage list', () => {
  const p = paragraph();
  assert.doesNotMatch(p, /NotebookEdit|`truncate`|`dd`|`update-ref`/, 'cite policy-schema-coverage.md, never re-list its tools (IL-93)');
});

test('worktree-setup.md: Post-creation catch-up cross-references the carve-out before the guard note', () => {
  const s = section('## Post-creation catch-up');
  const xref = s.indexOf('forge-API-only carve-out');
  const guard = s.indexOf("harness's Bash-shape guard");
  assert.ok(xref !== -1, 'catch-up must name the forge-API-only carve-out');
  assert.ok(xref < guard, `expected cross-reference(${xref}) before guard note(${guard})`);
  assert.match(s.slice(Math.max(0, xref - 200), xref + 200), /never reaches this section/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/worktree-forge-api-carve-out.test.js`
Expected: FAIL with "carve-out paragraph missing from Adopt-or-create". The first test fails on `anchor !== -1`.

- [ ] **Step 3: Write the minimal implementation**

In `plugin/skills/_shared/worktree-setup.md`, insert this immediately after the Adopt-or-create paragraph ending ``a `worktree-always` project (`docs/incident-log.md`).`` and before `**Already isolated:**`, with a blank line before and after:

```markdown
**Forge-API-only invocations need no worktree.** When every write an invocation makes is a
forge-API call (`gh issue`/`gh pr`/`gh api`, or their MCP equivalents), lands on a path the
`worktree-always` gate exempts (`_shared/policy-schema-coverage.md`'s gate-coverage block — the run
dir among them), or lands outside the repository (a session temp file), skip this whole decision:
no `EnterWorktree`, no catch-up merge, nothing to tear down — the gate guards repository files and
none are touched. The carve-out ends at the first working-tree write (a local record file, a design
doc, a commit): run this section at that point, the way `/claude-tweaks:tidy` provisions Step 7.5's
scratch worktree only for Step 7's mutations. Each qualifying skill states its own exceptions.
```

Then, directly under the `## Post-creation catch-up` heading (before "For the rest of this session's lifetime inside the new worktree"), insert, with a blank line after:

```markdown
An invocation Adopt-or-create's forge-API-only carve-out covers never reaches this section — it
creates no worktree, so there is no catch-up merge to run or later discard.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/worktree-forge-api-carve-out.test.js tests/worktree-setup-plugin-root-literal.test.js`
Expected: PASS (4 + 4 tests).

Byte check: `wc -c plugin/skills/_shared/worktree-setup.md`. Expect ≤ 22,400 (inline self-check measured 22,318).

- [ ] **Step 5: Run the neighboring worktree-setup suites**

Run: `node --test tests/worktree-setup-catchup-no-run-dir.test.js tests/worktree-adopt-or-create-consolidation.test.js tests/worktree-headless-ahead-of-origin.test.js tests/worktree-post-creation-longpaths.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/worktree-setup.md tests/worktree-forge-api-carve-out.test.js
git commit -m "Add forge-API-only worktree carve-out — worktree-setup.md Adopt-or-create (refs #2727)" -m "Claude-Session: https://claude.ai/code/session_01VLs2NeQT4MqaySGyzuPpAM"
```

### Task 2: Session-start banner names the distinction

**Files:**
- Modify: `plugin/bin/lib/hooks/session-start.js:366-371`
- Test: `tests/hooks-session-start.test.js:252-258`

**Interfaces:**
- Consumes: Task 1's canonical paragraph, which the banner cites as `_shared/worktree-setup.md`'s Adopt-or-create.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

In `tests/hooks-session-start.test.js`, extend the existing test `'worktree-always nudge appears when policy is on and session is not yet isolated'` (line 252). After its two existing `assert.match` lines, append:

```js
  // #2727: the nudge scopes itself to repository edits and names the
  // forge-API-only carve-out, so a gh-only skill isn't pushed into a worktree.
  const ctx = out.json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Before editing repository files/);
  assert.doesNotMatch(ctx, /Before making any edits/);
  assert.doesNotMatch(ctx, /isolated worktree for all work/);
  assert.match(ctx, /forge-API call/);
  assert.match(ctx, /Adopt-or-create/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="nudge appears when policy is on" tests/hooks-session-start.test.js`
Expected: FAIL on `/Before editing repository files/`.

- [ ] **Step 3: Write the minimal implementation**

In `plugin/bin/lib/hooks/session-start.js`, replace the `parts.push(...)` string inside `if (on && !isLinkedWorktree)` with:

```js
          parts.push(
            'claude-tweaks: this project requires an isolated worktree for repository edits ' +
              '(policy: worktree-always in .claude-tweaks/policy.yml). Before editing repository files, ' +
              'invoke /superpowers:using-git-worktrees to set one up, then follow ' +
              "`_shared/worktree-setup.md`'s post-creation catch-up before any other action. " +
              'An invocation whose every write is a forge-API call (gh issue/pr/api) needs no worktree — ' +
              "see that file's Adopt-or-create.",
          );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-session-start.test.js`
Expected: PASS (whole file — the linked-worktree and policy-off tests still assert the nudge is absent).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/session-start.js tests/hooks-session-start.test.js
git commit -m "Scope the worktree-always session banner to repository edits — name the forge-API-only carve-out (refs #2727)" -m "Claude-Session: https://claude.ai/code/session_01VLs2NeQT4MqaySGyzuPpAM"
```

### Task 3: Per-skill notes citing the carve-out

**Files:**
- Modify: `plugin/skills/backlog/refine-headless.md:14-15` (insert before `## Labeling-lanes preamble`)
- Modify: `plugin/skills/backlog/refine-mode.md:3-4` (insert after the one-line intro, before the `**`#N[,#M...]` filter (#1887).**` paragraph)
- Modify: `plugin/skills/capture/SKILL.md:47-48` (insert after the Workflow table, before `## Batch Mode`)
- Modify: `plugin/skills/tidy/scan-execution.md:7-8` (insert after the intro paragraph, before the `---` rule)
- Test: `tests/worktree-forge-api-carve-out.test.js` (append)

**Interfaces:**
- Consumes: the citation string `Forge-API-only invocations need no worktree` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to the end of `tests/worktree-forge-api-carve-out.test.js`:

```js
function skill(...parts) {
  return readText(path.join(SKILLS, ...parts));
}

function note(text, label) {
  const at = text.indexOf(CITE);
  assert.notStrictEqual(at, -1, `${label} must cite "${CITE}"`);
  const start = text.lastIndexOf('\n\n', at);
  const end = text.indexOf('\n\n', at);
  return text.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
}

test('backlog refine-headless.md: whole firing is covered (gh + run dir; local-files already stops)', () => {
  const n = note(skill('backlog', 'refine-headless.md'), 'refine-headless.md');
  assert.match(n, /worktree-setup\.md/);
  assert.match(n, /local-files/);
});

test('backlog refine-mode.md: names the unsynced-record and local-files exceptions', () => {
  const n = note(skill('backlog', 'refine-mode.md'), 'refine-mode.md');
  assert.match(n, /worktree-setup\.md/);
  assert.match(n, /unsynced/);
  assert.match(n, /local-files/);
  assert.match(n, /writeRecord/);
});

test('capture SKILL.md: names the gh-failure fallback and brainstorm route exceptions', () => {
  const n = note(skill('capture', 'SKILL.md'), 'capture/SKILL.md');
  assert.match(n, /worktree-setup\.md/);
  assert.match(n, /fallback/);
  assert.match(n, /brainstorm/);
  assert.match(n, /local-files/);
});

test('tidy scan-execution.md: scan batch is read-only; the only worktree is Step 7.5', () => {
  const n = note(skill('tidy', 'scan-execution.md'), 'tidy/scan-execution.md');
  assert.match(n, /worktree-setup\.md/);
  assert.match(n, /Step 7\.5/);
  assert.match(n, /only read/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/worktree-forge-api-carve-out.test.js`
Expected: FAIL with `refine-headless.md must cite "Forge-API-only invocations need no worktree"`. The 4 Task 1 tests still pass.

- [ ] **Step 3: Write the minimal implementation**

`plugin/skills/backlog/refine-headless.md` — insert before `## Labeling-lanes preamble`, with a blank line before and after:

```markdown
**No worktree.** Every write this posture makes is a `gh` call, a run-dir line, a session temp
file, or the `health-state` ref a `bin/` CLI pushes — and `work-backend: local-files` stops at
Preflight — so `_shared/worktree-setup.md`'s "Forge-API-only invocations need no worktree"
carve-out covers the whole firing.
```

`plugin/skills/backlog/refine-mode.md` — insert after the line beginning "The comprehensive "ensure every issue has the right labels" sweep" and before the `#N[,#M...]` filter paragraph, with a blank line before and after:

```markdown
**Worktree.** Under `work-backend: github-issues` every Step 5 write is a `gh` call or a run-dir
line, so `_shared/worktree-setup.md`'s "Forge-API-only invocations need no worktree" carve-out
applies — except a `facets.unsynced === true` record and the `local-files` driver, whose
`writeRecord` + `git commit` needs a worktree first.
```

`plugin/skills/capture/SKILL.md` — insert after the Workflow table's last row (Step 3) and before `## Batch Mode`, with a blank line before and after:

```markdown
**Worktree.** A `work-backend: github-issues` capture routed `keep` or `absorb:N` writes only
through `gh`, so `_shared/worktree-setup.md`'s "Forge-API-only invocations need no worktree"
carve-out applies. It does not cover the `local-files` driver, the gh-failure fallback (a local
`specs/` record), or the `brainstorm` route (a design doc) — each needs a worktree before that write.
```

`plugin/skills/tidy/scan-execution.md` — insert after the intro paragraph ending "also stays in `SKILL.md`." and before the `---` rule, with a blank line before and after:

```markdown
**No worktree for the scan batch.** The agent-backed scans only read — they write nothing — so
`_shared/worktree-setup.md`'s "Forge-API-only invocations need no worktree" carve-out covers them
outright; the only worktree `/claude-tweaks:tidy` provisions is Step 7.5's, for Step 7's mutations.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/worktree-forge-api-carve-out.test.js`
Expected: PASS (8 tests).

Byte check: `wc -c plugin/skills/backlog/refine-headless.md plugin/skills/backlog/refine-mode.md plugin/skills/capture/SKILL.md plugin/skills/tidy/scan-execution.md`. Expect every file < 46,080.

- [ ] **Step 5: Run the neighboring suites**

Run: `node --test tests/backlog-refine-headless.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/backlog/refine-headless.md plugin/skills/backlog/refine-mode.md plugin/skills/capture/SKILL.md plugin/skills/tidy/scan-execution.md tests/worktree-forge-api-carve-out.test.js
git commit -m "Cite the forge-API-only worktree carve-out from backlog refine, capture, and tidy — each with its own exceptions (refs #2727)" -m "Claude-Session: https://claude.ai/code/session_01VLs2NeQT4MqaySGyzuPpAM"
```
