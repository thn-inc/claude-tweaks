# Dispatch named-form exclusion reasons (#3084) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:dispatch #N` and `#N,#M` report every exclusion reason that removes a record from `dispatch-groups.json` by name — `not-spec-shaped` with its remedy, never as "already has an open PR".

**Architecture:** Prose-only change to `plugin/skills/dispatch/SKILL.md`'s two named-form bullets (Step 3), plus the one stale cross-reference in `open-pr-exclusion-report.md`. The per-reason line formats stay owned by their report sub-files; the bullets cite them instead of inlining them, keeping `SKILL.md` byte-neutral or smaller (it is already 46,346 bytes, past the 45 KB per-file soft ceiling). A new anchored prose-conformance test pins the bullets.

**Tech Stack:** Markdown skill prose; `node --test` with `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T081728-record-3084/work/3084-spec.md`

## Global Constraints

- Removing exclusion reasons (queue-pull-script.md lines 7-10): `open-pr`, `target-missing`, `shipped`, `not-spec-shaped`. `blocked`/`oversized`/`firing` do not remove a record from `dispatch-groups.json` and are out of scope.
- Not-spec-shaped line + remedy are owned by `plugin/skills/dispatch/not-spec-shaped-exclusion-report.md` — cite, never restate.
- `plugin/skills/dispatch/SKILL.md` must not grow (measure `wc -c` before/after).
- Commit style: `{Verb} {what} — {detail}`; end commit messages with the `Claude-Session:` trailer.

## Review Focus

- A named record excluded as `not-spec-shaped` — must report the not-spec-shaped line and remedy, never the open-PR line (pinned by the test's `never as an open PR` assertion).
- A named record excluded as `target-missing` or `shipped` — must be named by reason, not reported as a generic absence (pinned by the reason-list assertions).
- An `#N,#M` list where one member is not-spec-shaped — that member is reported in `notFound`, the rest proceed (the existing "do not abort the rest" clause must survive the edit; pinned).
- The `#N` bullet must stop after reporting the reason (the existing "and stop" must survive; pinned).
- `open-pr-exclusion-report.md` must not keep claiming the named forms filter to `open-pr` only (pinned).

---

### Task 1: Name every removing exclusion reason in dispatch's `#N` and `#N,#M` forms

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md:178` (`#N` bullet) and `:180` (`#N[,#M,#O...]` bullet)
- Modify: `plugin/skills/dispatch/open-pr-exclusion-report.md:17-21` (closing sentence)
- Test: `tests/dispatch-named-form-exclusion-reasons.test.js` (create)

**Interfaces:**
- Consumes: none.
- Produces: none (prose).

- [ ] **Step 1: Write the failing test** — create `tests/dispatch-named-form-exclusion-reasons.test.js`:

```js
// tests/dispatch-named-form-exclusion-reasons.test.js — #3084.
//
// Anchored prose-conformance: dispatch/SKILL.md's `#N` and `#N[,#M,#O...]` bullets must explain a
// record missing from dispatch-groups.json by EVERY reason queue-pull-script.md removes candidates
// for — not only `open-pr`. Before #3084 both bullets filtered dispatch-exclusions.json to
// `reason: 'open-pr'`, so a record #3073's not-spec-shaped pass dropped was misreported as having an
// open PR (or not explained at all). Sibling: tests/dispatch-not-spec-shaped-exclusion-fixture.test.js
// (the queue-pull pass itself).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const DISPATCH = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch');
const SKILL = readText(path.join(DISPATCH, 'SKILL.md'));
const OPEN_PR_REPORT = readText(path.join(DISPATCH, 'open-pr-exclusion-report.md'));

const REMOVING_REASONS = ['open-pr', 'not-spec-shaped', 'target-missing', 'shipped'];

function bullet(anchor) {
  const line = SKILL.split('\n').find((l) => l.startsWith(anchor));
  assert.ok(line, `${anchor} bullet not found in dispatch/SKILL.md -- anchor out of sync with the live file`);
  return line;
}

const SINGLE = bullet('**`#N`** — direct.');
const LIST = bullet('**`#N[,#M,#O...]`**');

test('dispatch #N names every removing exclusion reason and reports not-spec-shaped with its own remedy, never as an open PR (#3084 AC1)', () => {
  for (const reason of REMOVING_REASONS) {
    assert.ok(SINGLE.includes(`\`${reason}\``), `#N bullet does not name the \`${reason}\` exclusion`);
  }
  assert.ok(SINGLE.includes('not-spec-shaped-exclusion-report.md'), '#N bullet must cite the not-spec-shaped report for its line and remedy');
  assert.ok(SINGLE.includes('never as an open PR'), '#N bullet must rule out the open-PR misreport explicitly');
  assert.ok(!SINGLE.includes("filtered to `reason: 'open-pr'`"), '#N bullet still filters dispatch-exclusions.json to open-pr only');
  assert.ok(SINGLE.includes('and stop'), '#N bullet must still stop after reporting the reason');
});

test('dispatch #N,#M reports a not-spec-shaped member in notFound by name and keeps the rest of the list (#3084 AC2)', () => {
  for (const reason of REMOVING_REASONS) {
    assert.ok(LIST.includes(`\`${reason}\``), `#N,#M bullet does not name the \`${reason}\` exclusion`);
  }
  assert.ok(!LIST.includes("filtered to `reason: 'open-pr'`"), '#N,#M bullet still filters dispatch-exclusions.json to open-pr only');
  assert.ok(LIST.includes('do not abort the rest of the named set'), '#N,#M bullet must still proceed with the rest of the list');
});

test('open-pr-exclusion-report.md no longer says the named forms read only open-pr entries (#3084)', () => {
  assert.ok(
    !OPEN_PR_REPORT.includes("filtered to `reason: 'open-pr'`, to report the specific reason"),
    'open-pr-exclusion-report.md still describes the named forms as open-pr-only',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-named-form-exclusion-reasons.test.js`
Expected: FAIL — all three tests fail on today's text (no `not-spec-shaped` in either bullet; the `filtered to \`reason: 'open-pr'\`` phrase is present in both bullets and in the report).

- [ ] **Step 3: Measure, then edit `SKILL.md`**

Run `wc -c plugin/skills/dispatch/SKILL.md` and note the number (46346 at plan time).

In the `#N` bullet, replace exactly:

```
A record that clears those label checks but is absent from Step 2's `dispatch-groups.json` was dropped by the open-linked-PR exclusion (#1224), which removes candidates from that file before any selection form reads it: read this run's session-scoped `dispatch-exclusions.json`, filtered to `reason: 'open-pr'`, report that reason by name — `#{N} already has an open PR (#{pr}) — not re-dispatch-eligible until that PR merges or closes` — and stop.
```

with:

```
A record that clears those label checks but is absent from Step 2's `dispatch-groups.json` was dropped by a removing exclusion in `queue-pull-script.md`: report its reason from this run's session-scoped `dispatch-exclusions.json` by name, and stop — `open-pr` as `#{N} already has an open PR (#{pr}) — not re-dispatch-eligible until that PR merges or closes`; `not-spec-shaped` as `not-spec-shaped-exclusion-report.md`'s line and remedy, never as an open PR; `target-missing`/`shipped` as their Step 3 report lines.
```

In the `#N[,#M,#O...]` bullet, replace exactly:

```
or already covered by an open linked PR (#1224 — name the PR from this run's session-scoped `dispatch-exclusions.json`, filtered to `reason: 'open-pr'`, the same file the Open-PR exclusion report reads)
```

with:

```
or dropped by a removing exclusion (`open-pr`, `not-spec-shaped`, `target-missing`, `shipped`), named as the `#N` bullet above names it
```

Run `wc -c plugin/skills/dispatch/SKILL.md` again — must be ≤ the Step 3 number.

- [ ] **Step 4: Edit `open-pr-exclusion-report.md`'s closing sentence**

Replace exactly:

```
then reads this same
`dispatch-exclusions.json`, filtered to `reason: 'open-pr'`, to report the specific reason
(`SKILL.md`'s `#N` / `#N,#M,...` bullets, refs #1973) instead of a generic not-found.
```

with:

```
then reads this same
`dispatch-exclusions.json` to report the specific reason — `open-pr` or any other removing
exclusion (`SKILL.md`'s `#N` / `#N,#M,...` bullets, refs #1973, #3084) — instead of a generic
not-found.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js`
Expected: PASS (all tests in both files).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/open-pr-exclusion-report.md tests/dispatch-named-form-exclusion-reasons.test.js
git commit -m "Report every removing exclusion reason in dispatch #N forms — not-spec-shaped no longer misreported as an open PR (#3084)"
```
