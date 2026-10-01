# Catch-up Log With No Run Directory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `_shared/worktree-setup.md`'s Post-creation catch-up logging obligation a stated home when no pipeline run directory exists, and point `/specify` at it.

**Architecture:** Option (b) from the spec. The caller reports the advance in its own user-facing output, and writes the `decisions.md` entry late if a run dir resolves later in the same session.

The branch lives in a new `_shared/worktree-catchup-no-run-dir.md`. `worktree-setup.md` gains only a short parenthetical pointer in its existing sentence, because the composed `worktree-setup` bundle (`build/SKILL.md:174`) sits at 46,011 of 46,080 B. A `<!-- when: -->` fence would not help: `context-cost.js` measures every combination, including `mode=interactive` and `unresolved`.

Option (a), a durable standalone log, is not chosen. A gitignored log under `.claude-tweaks/` would in fact be permitted by the `worktree-always` PreToolUse gate (`_shared/policy-schema-coverage.md`'s coverage block), but no skill or reconciler reads such a file, so an advance written there is as invisible as one left unlogged, and a copy inside the worktree is deleted when the worktree itself is torn down. Minting a run dir just for one line leaves reconcile residue.

**Tech Stack:** Markdown skill files; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-09-30T172437-spec-2669-2692-2704-2693-2685-2684-2706-2707-2709/spec-2704/work/2704-spec.md`

## Global Constraints

- The composed `worktree-setup` bundle stays ≤ 46,080 B (today 46,011 B; this plan adds ≤ 60 B to `_shared/worktree-setup.md`, which leaves roughly 10-20 B).
- `specify/SKILL.md` stays under 46,080 B (37,532 B today).
- A skill reference in actionable instruction text uses the fully-qualified `/claude-tweaks:{skill}` form.
- Edit in place; don't reformat adjacent prose.

## Authoring checks

- Degrade-clause convention: `_shared/auto-decision-log.md:171` ("No-run-dir carrier") already covers "no run dir → report in the handoff" for skips. The new file cites it.
- Behavioral claim ("the gate exempts only `.claude-tweaks/pipelines/` and `.claude-tweaks/policy.yml`"): `plugin/bin/lib/hooks/pre-tool-use.js:42-76` (`PIPELINE_STATE_DIR`, `POLICY_FILE`).
- Byte pins: `plan-audit.js` headroom reported `composedNearCeiling: worktree-setup, build/SKILL.md:174, max 46011, ceiling 46080`. No file-specific pin in `tests/` names either file.
- Callers verified: `session-start.js:370` and `pre-tool-use.js:976` (SessionStart instruction and deny message), `init/isolated-write-step.md:35-37` (scratch worktree + catch-up), `routine/create-and-update.md:19` (Step 0 adopt-or-create), `_shared/scratch-worktree.md:103-108` (Section 3).

## Review Focus

- The headroom breach. Pinned by Task 1 Step 4 running `plan-audit.js` and reading `headroom.composed[0].max`.
- A reader of the no-run-dir file must be able to tell which callers it covers. Pinned by the test asserting the caller names.
- The no-op rule (unchanged tip → nothing) must hold on this branch. Pinned by the test.
- A run dir resolving later in the same session must still receive the entry. Pinned by the test.
- `/specify`'s Next Actions must carry the line. Pinned by the third test.

---

### Task 1: No-run-dir branch for the catch-up log, cited from `/specify`

**Files:**
- Create: `plugin/skills/_shared/worktree-catchup-no-run-dir.md`
- Modify: `plugin/skills/_shared/worktree-setup.md:230` (one parenthetical in the existing "Log the correction when it changes anything" sentence)
- Modify: `plugin/skills/specify/SKILL.md:140` (append one paragraph after the existing `## Next Actions` paragraph)
- Test: `tests/worktree-setup-catchup-no-run-dir.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: the file `_shared/worktree-catchup-no-run-dir.md`, cited by path from both `worktree-setup.md` and `specify/SKILL.md`.

- [ ] **Step 1: Write the failing test**

Create `tests/worktree-setup-catchup-no-run-dir.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #2704: _shared/worktree-setup.md's Post-creation catch-up told the caller to log a
// branch-advancing merge to "the run's decisions.md" — but interactive worktree-always
// sessions, /specify, /init's scratch worktree, and /routine create-and-update all run
// the catch-up before any pipeline run directory exists, so the advance was silently
// unlogged. These tests pin the no-run-dir branch and its two citations.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SETUP = read('plugin', 'skills', '_shared', 'worktree-setup.md');
const NO_RUN_DIR = read('plugin', 'skills', '_shared', 'worktree-catchup-no-run-dir.md');
const SPECIFY = read('plugin', 'skills', 'specify', 'SKILL.md');

test('worktree-setup.md: the catch-up log sentence points at the no-run-dir branch', () => {
  const start = SETUP.indexOf('**Log the correction when it changes anything.**');
  assert.notStrictEqual(start, -1, '"Log the correction" paragraph missing — this test has lost its anchor');
  const end = SETUP.indexOf('## Pre-flight divergence check', start);
  assert.notStrictEqual(end, -1, '## Pre-flight divergence check heading missing');
  assert.match(SETUP.slice(start, end), /worktree-catchup-no-run-dir\.md/, 'the log obligation must point at its no-run-dir branch');
});

test('worktree-catchup-no-run-dir.md: routes the advance line to the caller\'s own output', () => {
  assert.match(NO_RUN_DIR, /user-facing output/i, 'must name the caller\'s user-facing output as the home');
  assert.match(NO_RUN_DIR, /later in the same session/i, 'must cover a run dir that resolves later in the same session');
  assert.match(NO_RUN_DIR, /decisions\.md/, 'must still route to decisions.md once a run dir exists');
  assert.match(NO_RUN_DIR, /no-op/i, 'the no-op rule (unchanged tip writes nothing) must still apply');
  assert.match(NO_RUN_DIR, /No-run-dir carrier/, 'must cite auto-decision-log.md\'s existing No-run-dir carrier convention');
});

test('worktree-catchup-no-run-dir.md: names its callers and why no standalone log', () => {
  assert.match(NO_RUN_DIR, /SessionStart/, 'must name worktree-always sessions entered via the SessionStart instruction');
  assert.match(NO_RUN_DIR, /\/claude-tweaks:specify/, 'must name /claude-tweaks:specify');
  assert.match(NO_RUN_DIR, /\/claude-tweaks:init/, 'must name /claude-tweaks:init');
  assert.match(NO_RUN_DIR, /\/claude-tweaks:routine/, 'must name /claude-tweaks:routine');
  assert.match(NO_RUN_DIR, /scratch-worktree\.md/, 'must name _shared/scratch-worktree.md callers');
  assert.match(NO_RUN_DIR, /\.claude-tweaks\/pipelines\//, 'must state why a standalone log is not used: the gate exempts only pipelines/');
});

test('specify/SKILL.md: Next Actions carries a catch-up advance per the no-run-dir branch', () => {
  const start = SPECIFY.indexOf('## Next Actions');
  assert.notStrictEqual(start, -1, '## Next Actions heading missing');
  const end = SPECIFY.indexOf('\n## ', start + 1);
  const region = SPECIFY.slice(start, end === -1 ? undefined : end);
  assert.match(region, /_shared\/worktree-catchup-no-run-dir\.md/, 'must cite the no-run-dir branch file');
  assert.match(region, /advanced/i, 'must say the advance line is reported');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/worktree-setup-catchup-no-run-dir.test.js`
Expected: FAIL — `ENOENT` reading `worktree-catchup-no-run-dir.md` (the file does not exist yet)

- [ ] **Step 3: Write minimal implementation**

Create `plugin/skills/_shared/worktree-catchup-no-run-dir.md`:

```markdown
# Worktree Catch-up Log — No Run Directory

Referenced by `_shared/worktree-setup.md`'s Post-creation catch-up ("Log the correction when it
changes anything") — read only when that catch-up's merge advanced the branch and no pipeline run
directory resolves (`_shared/run-dir-resolution.md`'s Resolution order steps 1-4 all miss).

## Who reaches the catch-up with no run directory

- An interactive session entering a worktree because the SessionStart `worktree-always`
  instruction pointed it at the catch-up (`bin/lib/hooks/session-start.js`, and the gate's own
  deny message in `bin/lib/hooks/pre-tool-use.js`) — which covers every `/claude-tweaks:specify`
  entry path (shaping, decomposition, the `needs:definition` brainstorming redirect), since none
  of them creates a run directory before the session is isolated.
- `/claude-tweaks:init`, and any other `_shared/scratch-worktree.md` Section 3 caller running
  without a run directory.
- `/claude-tweaks:routine`'s create-and-update Step 0.

## Where the advance line goes

Report the same advance line the run-dir path would log — `Post-creation catch-up: worktree
branch advanced from {before short} to {after short} ({N} commit(s) from {ref})` — in the caller's
own user-facing output: the next reply to the user, and the skill's completion summary or Next
Actions block when it renders one. Never defer it to a run directory that may never exist. This is
`_shared/auto-decision-log.md`'s No-run-dir carrier convention applied to this entry.

If a run directory does resolve later in the same session, also append the entry to that run's
`decisions.md` under the resolving skill's own heading at that point. A no-op merge (branch tip
unchanged) still writes and reports nothing.

## Why not a standalone log file

The `worktree-always` gate exempts only `.claude-tweaks/pipelines/` and
`.claude-tweaks/policy.yml`, so the very worktree session running this catch-up cannot create a
new log file elsewhere under `.claude-tweaks/`. Minting a run directory just to hold one line
leaves reconcile residue.
```

In `plugin/skills/_shared/worktree-setup.md`, replace exactly:

```
procedure appends an entry to the run's `decisions.md` under its own heading:
```

with:

```
procedure appends an entry to the run's `decisions.md` under its own heading (no run dir:
`_shared/worktree-catchup-no-run-dir.md`):
```

In `plugin/skills/specify/SKILL.md`, after line 140 (the paragraph beginning `Rendered for both modes — this is the one block that straddles them`), insert a blank line followed by:

```markdown
When this session's worktree catch-up merge advanced the branch and no pipeline run directory resolved, the rendered Next Actions block also carries that advance line — `_shared/worktree-catchup-no-run-dir.md` names `/specify` among its callers.
```

- [ ] **Step 4: Run test to verify it passes, and re-check the composed ceiling**

Run: `node --test tests/worktree-setup-catchup-no-run-dir.test.js`
Expected: PASS (4 tests)

Run: `node "${CLAUDE_PLUGIN_ROOT:-plugin}/bin/plan-audit.js" docs/superpowers/plans/2026-09-30-2704-catchup-log-no-run-dir.md`
Expected: `headroom.ok: true`, and the `worktree-setup` composed max at or below 46080

- [ ] **Step 5: Commit**

```bash
git add tests/worktree-setup-catchup-no-run-dir.test.js plugin/skills/_shared/worktree-catchup-no-run-dir.md plugin/skills/_shared/worktree-setup.md plugin/skills/specify/SKILL.md
git commit -m "Give the catch-up log a home when no run dir exists — report in the caller's output (refs #2704)"
```
