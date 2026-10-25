# Collision-free Review Console coordination item ids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every decisions.md STAGED coordination item a distinct, content-derived console id, so same-second lines sharing their first 58 characters no longer collide.

**Architecture:** `coordinationItems` in `plugin/bin/lib/console/resolve.js` keeps the readable `decision:` + `line.slice(2, 60)` lead and appends `#` + the first 8 hex chars of the sha256 of the full line. A `-{n}` suffix (n ≥ 2, log order) is added only when the full line repeats byte-identically. Stored ids are opaque strings to every reader, so old-shape `console.json` files read unchanged. No migration is needed.

**Tech Stack:** Node 18+, `node:crypto`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-23T213805-spec-3946-3949-3816-3950/spec-3816/work/3816-spec.md`

Scope keywords: coordinationItems

Check B disposition (reviewed, no edit): `docs/journeys/trust-a-defect-several-review-lenses-flagged-3604.md:38` and `plugin/skills/_shared/auto-decision-log.md:156` say which lines become items, not how items are id'd. `tests/review-tiebreak-step-conformance.test.js:1318` pins that sentence. `docs/superpowers/plans/2026-10-24-console-final-outcomes-3949.md` is #3949's plan. No repo prose states the old `slice(2, 60)` shape: `git grep -F "slice(2, 60)"` hits only `resolve.js:642` and `resolve.test.js:607`.

## Global Constraints

- Keep the `decision:` prefix: `plugin/bin/lib/console/residue.js` `itemLines` keys decision items on `item.id.startsWith('decision:')`.
- Leave the `tiebreak:{id}` items and the staged-file / engine-row ids unchanged.
- Commit subject style `{Verb} {what} — {detail}`; body says `refs #3816`; trailer `Claude-Session: https://claude.ai/code/session_01Xwnc1AGrBrRsCwDeFcbc4R`.

## Review Focus

1. Two STAGED lines that are byte-identical (a retried log write) must still get distinct ids. Covered by the `-2` suffix test.
2. Re-rendering the same run must give the same ids, because a PR console's ticks are keyed on the stored id. Covered by the determinism test.
3. A legacy `console.json` holding an old-shape id (`decision:` + 58 chars, no `#hash`) must still count as residue and re-render. Covered by the old-shape read test.
4. A line not first in log order that shares a prefix with an earlier one must not get a suffix from prefix equality. Only full-line equality may add one. Covered by the three-line test: no id ends in `-2`.
5. A STAGED line whose own text contains `#` (`spec #3412`) must still parse as one id. The hash is appended after the slice, never parsed back, so this needs no test beyond the fixture, which already contains `#3412`.

---

### Task 1: Content-derived coordination ids

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (the `require` block at the top; the comment above `findingKey`/`coordinationItems` at lines 606-616; the `out.push` at line 642)
- Test: `tests/bin-lib/console/resolve.test.js` (update line 607; add the new tests right after the `AC2.1 … (#3772)` test that ends at line 616)

**Interfaces:**
- Produces: the `decision:` item id shape `decision:${line.slice(2, 60)}#${sha256hex(line).slice(0, 8)}`, with `-${n}` appended for the n-th (n ≥ 2) byte-identical repeat of the same full line. #3950's backfill reads this shape.
- Consumers of the id (grep `decision:` / `.id` over `plugin/bin`), each classified. None needs a change:
  - `lib/console/residue.js` `itemLines`: `startsWith('decision:')` prefix only.
  - `renderStoredTable`: prints the stored id.
  - `lib/reconcile/console-execute.js`: ticks and `findingItem` keyed on the id stored in that run's console.json at render time. No recompute, so the old and new shapes never meet.
  - `console-filings.js --only`: matches only `tiebreak:` items, never `decision:`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/console/resolve.test.js`, add `const crypto = require('crypto');` beside the other top-level requires. Add a helper next to `lowItems`:

```js
const decisionId = (line) => `decision:${line.slice(2, 60)}#${crypto.createHash('sha256').update(line).digest('hex').slice(0, 8)}`;
```

Change line 607's expected value to `decisionId(SUPERSEDED.split('\n')[5])`, keeping its message.

Add these tests:

```js
const SAME_PREFIX = SUPERSEDED.split('\n').filter((l) => l.startsWith('- STAGED ')).join('\n') + '\n';

test('AC1.1: three STAGED lines sharing their first 58 characters yield three distinct item ids (#3816)', () => {
  const lines = SAME_PREFIX.trim().split('\n');
  assert.strictEqual(new Set(lines.map((l) => l.slice(2, 60))).size, 1, 'fixture: the three lines share their first 58 characters');
  const ids = lowItems(SAME_PREFIX).map((i) => i.id);
  assert.strictEqual(ids.length, 3);
  assert.strictEqual(new Set(ids).size, 3);
  assert.deepStrictEqual(ids, lines.map(decisionId), 'each id is the readable lead plus the hash of its own full line; no -n suffix');
});

test('a byte-identical repeated STAGED line gets a -2 suffix, the first keeps the bare hash (#3816)', () => {
  const line = SUPERSEDED.split('\n')[5];
  const ids = lowItems(`${line}\n${line}\n`).map((i) => i.id);
  assert.deepStrictEqual(ids, [decisionId(line), `${decisionId(line)}-2`]);
});

test('coordination ids are deterministic across two resolutions of the same run (#3816)', () => {
  const runDir = fixture({ decisions: SAME_PREFIX, headers: [7] });
  const once = () => resolveAll({ runDir, policy: 'console-auto', deps: deps() }).items.map((i) => i.id);
  assert.deepStrictEqual(once(), once());
});

test('AC2.1: a console.json written with the old 58-character id shape still reads and re-renders (#3816 expand-contract)', () => {
  const oldId = `decision:${SUPERSEDED.split('\n')[1].slice(2, 60)}`;
  assert.strictEqual(oldId, 'decision:STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reprod', 'the archived 2026-10-17T192303-spec-3412 shape');
  const stored = { resolved: true, at: '2026-10-17T23:50:00Z', items: [0, 1, 2].map(() => ({ id: oldId, section: 'Low-confidence findings', resolution: 'keep-staged', reason: 'r' })), merge: { resolution: 'leave-open', reason: 'x' } };
  assert.strictEqual(unresolvedItems(stored).length, 3);
  const table = renderStoredTable(stored);
  assert.strictEqual(table.split('\n').filter((l) => l.includes(oldId)).length, 3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "3816|AC1.1: a STAGED low-confidence" tests/bin-lib/console/resolve.test.js`
Expected: FAIL. The new AC1.1 test, the `-2` test and the updated #3772 AC1.1 assertion fail because ids are still bare 58-character slices. The determinism and AC2.1 tests pass already: they pin behavior that must survive the change.

- [ ] **Step 3: Implement the id in `coordinationItems`**

In `plugin/bin/lib/console/resolve.js`, add `const crypto = require('crypto');` beside `const path = require('path');`. In `coordinationItems`, keep a `Map` from full line to its occurrence count. Build each pushed item's id as `` `decision:${line.slice(2, 60)}#${crypto.createHash('sha256').update(line).digest('hex').slice(0, 8)}` `` plus `` `-${n}` `` when this is the n-th (n ≥ 2) occurrence of the same full line among the lines that produce an item. Count only lines that push an item, so a superseded twin never shifts a survivor's suffix. Extend the comment block above `findingKey` with two sentences: the id is the readable lead plus a hash of the full line, so same-second lines sharing a lead-in stay distinct (#3816). Stored ids are opaque to every reader, so consoles written with the old 58-character id read unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/residue.test.js tests/bin-lib/console/residue-cli.test.js tests/bin-lib/console/console-filings-cli.test.js`
Expected: PASS, with 0 failures.

- [ ] **Step 4b: Real-input probe over every recorded run**

Run (the controller runs this; the script lives in the session scratchpad): `node /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-findings-tiebreak-design/b93c593c-d1ae-41e3-ae57-8ba4e51c3c77/scratchpad/run2/probe-3816-all.js "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow-spec-3946-3949-3816-3950" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines"`. It is read-only and resolves `findingItems` fresh for every run dir and `spec-*` subdir.

Baseline on the pre-change code (2026-10-24): `runsScanned 2037, decisionItems 249, distinctIds 186, collidingRuns 18`.

Expected after the change: `decisionItems 249` (the same item count, which is the independent count, since the id change must not add or drop items), `distinctIds 249`, `collidingRuns 0`. Record the printed numbers in the commit body.

- [ ] **Step 5: Commit**

```bash
git -C "$WORKTREE" add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve.test.js
git -C "$WORKTREE" commit -m "Give Review Console coordination items content-derived ids — readable lead plus a hash of the full line, -n only for byte-identical repeats" -m "refs #3816" -m "Claude-Session: https://claude.ai/code/session_01Xwnc1AGrBrRsCwDeFcbc4R"
```
