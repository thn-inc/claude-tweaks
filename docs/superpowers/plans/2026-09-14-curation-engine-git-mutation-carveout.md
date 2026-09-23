# Curation-Engine Git-Mutation Carve-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the conflict between `curation-engine.md`'s dispatch-prompt git-mutation prohibition and `skill-curation.md`'s "Record the audit" step (`harness-health.js validate-findings`, which pushes to the dedicated `health-state` tracking branch) by adding an explicit, narrow carve-out to the prohibition, and pin the resolved contract with a conformance test.

**Architecture:** Direction (a) from record #1676's Deliverables: the git-mutation prohibition in `curation-engine.md` section 4 gets an explicit carve-out for a project skill's own sanctioned bookkeeping write to a dedicated tracking branch (distinct from the worktree's own feature branch and the integration branch), made via direct git object writes rather than `git add`/`git commit` against the worktree's own checkout. This matches the actual hazard the prohibition guards against (concurrent judges racing on the *shared worktree's* git index, #1140) — a `health-state` branch push via `git hash-object`/`mktree`/`commit-tree`/`push` never touches the worktree at all, so it was never actually the hazard the rule was written to prevent. Direction (b) (skip the write under a git-mutation-forbidding contract) was rejected: it would silently degrade the four health skills' cross-firing rotation optimization (`_shared/health-state.md`) for every future Skills-row judge dispatch, to work around a prohibition whose own scope was simply drawn too broadly.

**Tech Stack:** Markdown (skill prose), `node --test` conformance test.

**Spec:** `.claude-tweaks/pipelines/2026-09-14T161949-record-1676/work/1676-spec.md` (record #1676)

## Global Constraints

- Edit `plugin/skills/wrap-up/curation-engine.md` in place — do not restructure or reformat unrelated prose (CLAUDE.md's Surgical changes rule).
- The new paragraph must not push `curation-engine.md` anywhere near the 45 KB skill-file ceiling (`plugin/bin/lib/skill-audit/context-cost.js`'s `CEILING_BYTES`) — current size 26,376 bytes; the addition below is ~1,150 bytes, leaving ~18.5 KB of headroom.
- Never restate a fact owned by `_shared/health-state.md` or `_shared/pipeline-run-dir.md` — cite them.
- `npm test` must pass (record #1676 Acceptance Criteria item 2).

---

### Task 1: Add the git-mutation carve-out to curation-engine.md and pin it with a conformance test

**Files:**
- Modify: `plugin/skills/wrap-up/curation-engine.md` (section 4, "No judge-side git mutations" paragraph)
- Test: `tests/curation-git-mutation-carveout.test.js`

**Interfaces:**
- Consumes: nothing (pure prose edit; no code interfaces).
- Produces: nothing other tasks depend on — this is the only task in the plan.

- [ ] **Step 1: Make the prose edit**

In `plugin/skills/wrap-up/curation-engine.md`, section 4 ("## 4. Parallel dispatch and the learning-capture singleton"), the paragraph beginning `**No judge-side git mutations — the controller's serial-commit pass.**` currently reads (verbatim, the anchor text to match on):

```
the controller commits.* The fan-out shares one worktree, so concurrent judge commits raced on the shared git index
```

Insert a new paragraph immediately after the sentence `...the controller commits.*` and before `The fan-out shares one worktree...` — i.e. split what is currently one paragraph into two, with the new carve-out paragraph in between. Use this exact replacement (old → new):

Old (exact substring to match, do not alter anything else in the file):
```
the controller commits.* The fan-out shares one worktree, so concurrent judge commits raced on the shared git index
```

New:
```
the controller commits.*

**Carve-out: a project skill's own sanctioned bookkeeping write to a dedicated tracking branch is not a git mutation for this rule's purposes.** The hazard this rule guards against is concurrent judges racing on *this run's own worktree* — its checked-out branch, its working tree, its git index (the #1140 incident below). A write that never touches that worktree at all is outside the rule's scope: specifically, a push to a durable-state branch distinct from both the worktree's feature branch and the integration branch, made through direct git object writes (`git hash-object`/`mktree`/`commit-tree`/`push` against a ref — never `git add`/`git commit` against the worktree's own checkout) and guarded by its own compare-and-swap retry loop against concurrent writers. The four health skills' durable cross-firing state is the standing example (`_shared/health-state.md`, `bin/lib/health-core/durable-state.js`'s `health-state` branch) — `wrap-up/skill-curation.md`'s "Record the audit" step (`harness-health.js validate-findings`) runs unmodified inside a judge dispatch under this carve-out, since it only ever pushes to `health-state`, never to the worktree's own branch. This is a narrow, named exception for one write shape, not a general git-mutation allowance — a judge dispatched under this contract still never runs `git add`, `git commit`, or `git push` against the worktree's own feature branch.

The fan-out shares one worktree, so concurrent judge commits raced on the shared git index
```

Use the Edit tool with that exact `old_string`/`new_string` pair against `plugin/skills/wrap-up/curation-engine.md`. Do not touch any other line in the file.

- [ ] **Step 2: Write the conformance test**

Create `tests/curation-git-mutation-carveout.test.js` with exactly this content:

```js
// tests/curation-git-mutation-carveout.test.js — pins record #1676's resolution of the
// curation-engine.md dispatch-contract vs. project-skill git-mutation conflict: section 4's
// "no judge-side git mutations" prohibition carries an explicit, narrow carve-out for a
// project skill's own sanctioned bookkeeping write to a dedicated tracking branch (the four
// health skills' `health-state` branch, `_shared/health-state.md`), since that write never
// touches the worktree the prohibition actually protects (the #1140 shared-git-index hazard).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const ENGINE = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'curation-engine.md'), 'utf8');
const CURATION = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'skill-curation.md'), 'utf8');

// Frozen pre-change excerpt of the "No judge-side git mutations" paragraph's opening two
// sentences, as they read before #1676's carve-out was inserted — a string literal, not a
// live read, so it stays stable across future edits to the live file [IL-80]. Proves the
// carve-out assertions below can actually go red [IL-105]: they must NOT match this text.
const PRE_CHANGE_NO_CARVEOUT = '**No judge-side git mutations — the controller\'s serial-commit pass.** '
  + 'Every dispatch prompt — the fan-out and the singleton alike — inlines this instruction '
  + 'verbatim: *never run `git add`, `git commit`, or any other git mutation; an '
  + 'auto-apply-eligible finding is made as a working-tree edit only, its payload names the '
  + 'edited file as `targetPath`, and its `commit` field is left absent — the controller '
  + 'commits.* The fan-out shares one worktree, so concurrent judge commits raced on the '
  + 'shared git index (#1140 — observed in run 2026-08-20T153031-spec-1065: a judge reported '
  + 'its edit "swept into a sibling\'s commit" with a fabricated hash while the edit sat '
  + 'uncommitted in the tree).';

function section4(text) {
  return text.slice(text.indexOf('## 4. Parallel dispatch'));
}

test('curation-engine.md section 4 carries the git-mutation carve-out heading', () => {
  const s4 = section4(ENGINE);
  assert.match(
    s4,
    /Carve-out: a project skill's own sanctioned bookkeeping write to a dedicated tracking branch is not a git mutation/,
    'carve-out heading present in section 4',
  );
  assert.doesNotMatch(
    PRE_CHANGE_NO_CARVEOUT,
    /Carve-out: a project skill's own sanctioned bookkeeping write/,
    'pattern must NOT match the pre-change text (proves it can go red)',
  );
});

test('carve-out names the hazard boundary: worktree branch vs. a distinct tracking branch', () => {
  const s4 = section4(ENGINE);
  assert.match(s4, /distinct from both the worktree's feature branch and the integration branch/);
  assert.doesNotMatch(
    PRE_CHANGE_NO_CARVEOUT,
    /distinct from both the worktree's feature branch and the integration branch/,
  );
});

test('carve-out names the write mechanism that qualifies (git plumbing, never git add/commit on the worktree)', () => {
  const s4 = section4(ENGINE);
  assert.match(s4, /git hash-object.*mktree.*commit-tree.*push/);
  assert.match(s4, /never `git add`\/`git commit` against the worktree's own checkout/);
});

test('carve-out cites the health-state branch and skill-curation.md\'s Record-the-audit step as the standing example', () => {
  const s4 = section4(ENGINE);
  assert.match(s4, /_shared\/health-state\.md/);
  assert.match(s4, /health-state.*branch/);
  assert.match(s4, /wrap-up\/skill-curation\.md.*Record the audit/);
  assert.match(s4, /validate-findings/);
});

test('carve-out is narrow — still forbids git add/commit/push against the worktree\'s own feature branch', () => {
  const s4 = section4(ENGINE);
  assert.match(
    s4,
    /still never runs `git add`, `git commit`, or `git push` against the worktree's own feature branch/,
  );
});

test('skill-curation.md\'s Record-the-audit step (the concrete instance the carve-out covers) is unchanged', () => {
  assert.match(CURATION, /\*\*Record the audit\.\*\*/);
  assert.match(CURATION, /harness-health\.js"\s+validate-findings/);
});
```

- [ ] **Step 3: Run the new test to verify it passes against the edited file**

Run: `node --test tests/curation-git-mutation-carveout.test.js`
Expected: all 6 tests PASS (the file was already edited in Step 1, so this is a green-first check — the go-red half of [IL-105] is proven in-test via the frozen `PRE_CHANGE_NO_CARVEOUT` fixture, not by running the suite against unedited content).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions — the edit only inserts a new paragraph and a new test file; nothing existing is restructured).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/curation-engine.md tests/curation-git-mutation-carveout.test.js
git commit -m "Add git-mutation carve-out to curation-engine.md for sanctioned bookkeeping writes — refs #1676"
```
