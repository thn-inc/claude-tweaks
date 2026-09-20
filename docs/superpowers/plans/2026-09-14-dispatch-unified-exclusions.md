# Dispatch: unify ad hoc exclusion-list files into one mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dispatch's ad hoc per-reason exclusion-list JSON files with one `bin/lib/dispatch/exclusions.js` module and one session-scoped `dispatch-exclusions.json`, so a new exclusion reason is a one-line `appendExclusion` call instead of a new file + new filter logic.

**Architecture:** `readExclusions(path)` returns `{reason, records: number[], detail}[]` (`[]` on absent/unreadable). `appendExclusion(path, entry)` appends one entry, creating the file if absent. `excludedNumbers(entries, reasons)` flattens matching-reason entries into a `Set<number>`. `groupIsExcluded(group, entries, reasons)` is true when any group member's number is in that set. Producers (`queue-pull-script.md`, `SKILL.md`'s Loop) call `appendExclusion`; readers (`next-ranking.md`, the three report files) call `readExclusions` + `excludedNumbers`/`groupIsExcluded`, filtered to the reasons they care about.

**Scope note (materialize.md's Named-location drift; record filed against v6.113.0):** the record's Current State names four ad hoc files (`blocked`, `open-pr`, `oversized`, `firing`). Live `queue-pull-script.md` at build time also produces `dispatch-target-missing-excluded.json` (#1983) and `dispatch-shipped-excluded.json` (#1984) — two more instances of the exact ad hoc pattern this record exists to eliminate, shipped after the record was filed. AC1 ("`grep -rn \"excluded.json\" plugin/skills` returns no match") is a mechanical check against live code, not against the record's own stale enumeration, so it only passes if these two are migrated too. This plan migrates all six reasons (`blocked`, `open-pr`, `oversized`, `firing`, `target-missing`, `shipped`) into the one mechanism — classified as a Beneficial architecture-alignment deviation (Common Step 4.5), not scope creep: leaving either of the two newer files behind would fail AC1 and reproduce the exact bug this record fixes.

**Tech Stack:** Node.js (`node --test`), bash `node -e` blocks embedded in skill markdown (existing convention).

**Spec:** `.claude-tweaks/pipelines/2026-09-14T180935-record-1752/work/1752-spec.md` (GitHub record #1752)

## Global Constraints

- Reports render byte-identical lines for the same inputs (AC3) — only the storage/read mechanism changes, not report wording.
- Pool semantics unchanged (AC2): `blocked`/`open-pr`/`target-missing`/`shipped` still remove candidates from `dispatch-groups.json` inside `queue-pull-script.md`; `oversized`/`firing` still stay in the pool, filtered only at `next-ranking.md`.
- `dispatch-blocked-excluded-body.json` is a body-text-blocker intermediate, not an exclusion list (Gotchas) — untouched.
- Truncate-then-append: `dispatch-exclusions.json` is reset at the start of each `queue-pull-script.md` run, but a `firing`-reason entry (written by SKILL.md's Loop between queue-pull re-runs within the same firing) must survive that reset — the truncation reads, filters to `reason === 'firing'`, and rewrites, never a blind `[]` overwrite.
- Match surrounding style: heavy inline rationale comments, `#NNNN` issue references, in both the new module and the edited `.md` bash blocks.

---

### Task 1: `bin/lib/dispatch/exclusions.js` + unit tests

**Files:**
- Create: `plugin/bin/lib/dispatch/exclusions.js`
- Test: `tests/bin-lib/dispatch/exclusions.test.js`

**Interfaces:**
- Produces: `readExclusions(path) -> {reason, records: number[], detail}[]`, `appendExclusion(path, entry) -> void`, `excludedNumbers(entries, reasons: string[]) -> Set<number>`, `groupIsExcluded(group: {number}[], entries, reasons: string[]) -> boolean`.
- Consumes: `fs` only — no other project modules.

- [ ] **Step 1: Write the module and its unit tests together**

`plugin/bin/lib/dispatch/exclusions.js`:

```javascript
'use strict';

// #1752: one module owning dispatch's session-scoped exclusion-list shape and
// file, replacing four (now six, live at build time -- #1983/#1984 shipped
// after this record was filed) ad hoc per-reason JSON files each with their
// own shape/producer/reader/report. One array of {reason, records, detail}
// entries in one file: a new exclusion reason is one appendExclusion call
// site plus one report line, never a new file or filter derivation.

const fs = require('fs');

// path -> entries, or [] on absent/unreadable (malformed JSON, not an array,
// permission error) -- a read failure here must never throw and block a
// dispatch firing; an empty exclusion set is always a safe degrade.
function readExclusions(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Appends one {reason, records, detail} entry, creating the file (as [entry])
// if absent. Callers loop for multiple entries of the same reason (e.g. one
// per excluded candidate) -- there is no bulk variant, matching the record's
// "one appendExclusion call site" extensibility claim (AC5).
function appendExclusion(path, entry) {
  const entries = readExclusions(path);
  entries.push(entry);
  fs.writeFileSync(path, JSON.stringify(entries));
}

// entries whose reason is in `reasons`, flattened to the set of every
// excluded record number across all of them.
function excludedNumbers(entries, reasons) {
  const reasonSet = new Set(reasons);
  const numbers = new Set();
  for (const e of entries) {
    if (!e || !reasonSet.has(e.reason) || !Array.isArray(e.records)) continue;
    for (const n of e.records) numbers.add(n);
  }
  return numbers;
}

// True when ANY member of `group` (a file-overlap group -- {number}[]) is
// excluded under one of `reasons` -- a group is claimed/released as a unit,
// so one excluded member excludes the whole group (next-ranking.md's and
// firing-exclusion.md's existing semantics, preserved here, not changed).
function groupIsExcluded(group, entries, reasons) {
  const numbers = excludedNumbers(entries, reasons);
  return group.some((r) => numbers.has(r.number));
}

module.exports = {
  readExclusions, appendExclusion, excludedNumbers, groupIsExcluded,
};
```

`tests/bin-lib/dispatch/exclusions.test.js` — cover: absent-file read returns `[]`; `appendExclusion` creates the file on first call and appends on subsequent calls; `excludedNumbers` flattens multiple entries of the requested reasons and ignores other reasons; `groupIsExcluded` is true when any bundle member (not just the first) is excluded and false when none are; an unknown reason round-trips through `readExclusions` but is excluded by `excludedNumbers`/`groupIsExcluded` unless explicitly requested (AC5's "adding a fifth reason" demonstration — seed one `{reason: 'future-reason', records: [42]}` entry, confirm `readExclusions` returns it, `groupIsExcluded([{number: 42}], entries, ['oversized', 'firing'])` is `false`, and `groupIsExcluded([{number: 42}], entries, ['future-reason'])` is `true`).

Run: `node --test tests/bin-lib/dispatch/exclusions.test.js`
Expected: FAIL (module doesn't exist yet) before writing `exclusions.js`; write both files together and confirm PASS.

---

### Task 2: `queue-pull-script.md` — unify the five producer writes

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md`

**Interfaces:**
- Consumes: `exclusions.js`'s `readExclusions`/`appendExclusion` (new require inside the embedded `node -e` blocks, same pattern `session-tmp.js` is already loaded with).
- Produces: session-scoped `dispatch-exclusions.json` (replaces `dispatch-blocked-excluded.json`, `dispatch-open-pr-excluded.json`, `dispatch-oversized-excluded.json`, `dispatch-target-missing-excluded.json`, `dispatch-shipped-excluded.json`).

- [ ] **Step 1: Rewrite the script**

1. `files` map: replace the five `DISPATCH_*_EXCLUDED` entries with one `DISPATCH_EXCLUSIONS: 'dispatch-exclusions.json'`. Leave `DISPATCH_BLOCKED_EXCLUDED_BODY` alone (intermediate, not an exclusion list).
2. Immediately after the `files` map resolves (before the first `gh issue list` call), add the truncate-preserving-firing step:
   ```
   node -e "
     const { readExclusions } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
     const fs = require('fs');
     const kept = readExclusions(process.argv[1]).filter((e) => e.reason === 'firing');
     fs.writeFileSync(process.argv[1], JSON.stringify(kept));
   " "$DISPATCH_EXCLUSIONS"
   ```
3. `CACHE_HIT` block: replace the two `fs.writeFileSync` calls for blocked/oversized with `appendExclusion` loops writing reason `blocked` (from `persisted.excluded`, `detail: {blockedBy}`) and reason `oversized` (from the freshly recomputed `oversized` array, `detail: {size, threshold}`) into `$DISPATCH_EXCLUSIONS`.
4. Cache-miss blocked-by block (`partitionByOpenBodyBlockers` + native filtering): instead of `fs.writeFileSync($DISPATCH_BLOCKED_EXCLUDED, [...excludedBody, ...excludedNative])`, loop both arrays through `appendExclusion($DISPATCH_EXCLUSIONS, {reason: 'blocked', records: [number], detail: {blockedBy}})`.
5. Cache-miss oversized block (in the grouping `node -e`): same conversion as step 3's oversized case, appended into `$DISPATCH_EXCLUSIONS` instead of written to `$DISPATCH_OVERSIZED_EXCLUDED`.
6. Open-PR exclusion block: convert the `excluded.push({number, pr})` accumulator into `appendExclusion` calls (`reason: 'open-pr'`, `detail: {pr}`) against `$DISPATCH_EXCLUSIONS`, keeping the existing group-filtering logic (which still operates in-memory on `$DISPATCH_GROUPS`, unchanged) exactly as is.
7. Named-target (`target-missing`) block: same conversion — `appendExclusion` with `reason: 'target-missing'`, `detail: {path}`, keeping the existing staged-Close-proposal loop (which reads the `missing` array, still computed the same way, just also appended to the unified file) and the `AUTO` decision-log line unchanged.
8. Shipped-candidate block: same conversion — `appendExclusion` with `reason: 'shipped'`, `detail: {pr, signals}`, keeping the staged Close proposal and `console.error` lines unchanged.
9. Every downstream reference to the five old env var names inside this file becomes `$DISPATCH_EXCLUSIONS` (grep the file for each old name after editing to confirm zero remain).

Run: `node --test tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-tidy-named-target-coordination.test.js`
Expected: FAIL immediately after this task's edit (old anchors/env vars/entry shape) until Task 5 updates those two test files to match.

---

### Task 3: `next-ranking.md` — one derivation, no `keyOf`/member split

**Files:**
- Modify: `plugin/skills/dispatch/next-ranking.md`

- [ ] **Step 1: Replace the two-file read and `keyOf`/`firingExcludedSet` logic**

`files` map: `DISPATCH_OVERSIZED_EXCLUDED`/`DISPATCH_FIRING_EXCLUDED` → one `DISPATCH_EXCLUSIONS: 'dispatch-exclusions.json'`. In the ranking `node -e` block, replace the `oversizedKeys`/`keyOf`/`firingExcludedSet` machinery with:
```javascript
const { readExclusions, groupIsExcluded } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
const entries = readExclusions(process.argv[3]);
const eligibleGroups = groups.filter((g) => !groupIsExcluded(g, entries, ['oversized', 'firing']));
```
(argv indices shift by one since two file args collapse to one — renumber the trailing `"$DISPATCH_..."` argument list accordingly.)

Run: `node --test tests/dispatch-firing-exclusion.test.js`
Expected: FAIL immediately after this task's edit (test still seeds the two old files) until Task 4 updates it.

---

### Task 4: `firing-exclusion.md` + `tests/dispatch-firing-exclusion.test.js`

**Files:**
- Modify: `plugin/skills/dispatch/firing-exclusion.md`
- Modify: `tests/dispatch-firing-exclusion.test.js`

- [ ] **Step 1: Update the rule and the test fixtures**

`firing-exclusion.md`'s "The rule" section: replace "append that group's member issue number(s) to this run's session-scoped `dispatch-firing-excluded.json`" with "append one `{reason: 'firing', records: [number], detail: null}` entry per excluded member via `appendExclusion` (`bin/lib/dispatch/exclusions.js`) into this run's session-scoped `dispatch-exclusions.json`". Update the cross-reference to `next-ranking.md` to name `groupIsExcluded`/reason `'firing'` instead of "reads this file".

`tests/dispatch-firing-exclusion.test.js`'s `runRanking` helper: instead of writing `dispatch-oversized-excluded.json` and (conditionally) `dispatch-firing-excluded.json`, compose one `dispatch-exclusions.json` array from `oversizedExcluded.map((o) => ({reason: 'oversized', records: o.records, detail: {size: o.size, threshold: o.threshold}}))` plus (when `firingExcluded !== undefined`) `firingExcluded.map((n) => ({reason: 'firing', records: [n], detail: null}))`, written once via `fs.writeFileSync(sessionTmpPath(sessionId, 'dispatch-exclusions.json'), ...)`. Test bodies (the five `test(...)` blocks) stay unchanged — only the fixture-writing helper changes, per the record's own AC4 ("four scenarios ... pass against the new shape").

Run: `node --test tests/dispatch-firing-exclusion.test.js`
Expected: PASS (all 5 existing scenarios, unchanged assertions).

---

### Task 5: The three report files + the two #1983 tests

**Files:**
- Modify: `plugin/skills/dispatch/blocked-exclusion-report.md`
- Modify: `plugin/skills/dispatch/open-pr-exclusion-report.md`
- Modify: `plugin/skills/dispatch/oversized-group-report.md`
- Modify: `plugin/skills/dispatch/SKILL.md` (Loop paragraph; `#N`/`#N,#M,...` bullets; Shipped-candidate exclusion report paragraph)
- Modify: `tests/dispatch-tidy-named-target-coordination.test.js`
- Modify: `tests/dispatch-named-target-exclusion-fixture.test.js`

- [ ] **Step 1: Reports read the one file, filtered by reason**

Each of the three report `.md` files: replace "Read `dispatch-{reason}-excluded.json`" with "Read this run's session-scoped `dispatch-exclusions.json` (`bin/lib/dispatch/exclusions.js`'s `readExclusions`), filtered to `reason: '{reason}'` entries" — render the exact same line text as today from the filtered entries' `records`/`detail` fields (AC3: byte-identical output for the same inputs).

`SKILL.md`: Loop paragraph — "oversized and this-firing-excluded groups excluded — maintain per `firing-exclusion.md`" stays conceptually the same, update only the mechanism note if it names a filename. `#N` bullet and `#N,#M,...` bullet — replace "read this run's session-scoped `dispatch-open-pr-excluded.json`" with "read this run's session-scoped `dispatch-exclusions.json`, filtered to `reason: 'open-pr'`". Shipped-candidate exclusion report paragraph — same substitution for `dispatch-shipped-excluded.json`.

- [ ] **Step 2: Update the two #1983 tests for the unified file**

`tests/dispatch-tidy-named-target-coordination.test.js`: update the two assertions naming `dispatch-target-missing-excluded\.json` and the `--id "dispatch-target-missing-\$\{NUM\}"` staging id (staging id itself is unaffected by this record — only the exclusion *storage* changed — confirm it still reads `dispatch-target-missing-${NUM}` verbatim) to instead assert the new `appendExclusion`/`dispatch-exclusions.json` call shape and `reason: 'target-missing'` string literal.

`tests/dispatch-named-target-exclusion-fixture.test.js`: update `END_ANCHOR` to match the rewritten tail of the extracted snippet (now ending in the `appendExclusion`/unified-write call, not a bare `fs.writeFileSync($DISPATCH_TARGET_MISSING_EXCLUDED, ...)`), replace the `DISPATCH_TARGET_MISSING_EXCLUDED` env var with `DISPATCH_EXCLUSIONS`, and update the final read (`missing = JSON.parse(...)`) to read the unified file and filter/map for `reason === 'target-missing'` entries' `records[0]`/`detail.path` instead of `m.number`/`m.path`.

Run: `node --test tests/dispatch-tidy-named-target-coordination.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-firing-exclusion.test.js tests/bin-lib/dispatch/exclusions.test.js`
Expected: PASS, all four files.

---

### Task 6: `docs/plugin-structure.md` (conditional) + full suite

**Files:**
- Modify: `docs/plugin-structure.md` (only if a per-module `bin/lib/{name}/` list already exists there — check first; the record itself notes it may not)

- [ ] **Step 1: Check and add if applicable, then run the full suite**

`grep -n "queue-order.js\|artifact-verdict.js" docs/plugin-structure.md` — if either is individually named in a list, add `exclusions.js` alongside it with a one-line description; if the directory convention is stated without enumerating files, skip this edit (per the record's own Deliverables: "add a line only if a per-module list exists").

Run: `npm test`
Expected: PASS, full suite green (excluding pre-existing unrelated flake per CLAUDE.md's load-variance note — re-run any surprising failure in isolation before concluding a regression).
