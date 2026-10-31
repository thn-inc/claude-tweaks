# Console backfill records a truncated path for a finding at a path holding @ or [id] (#4631) Implementation Plan

**Goal:** `plugin/bin/lib/console/backfill.js` keeps the old path class in `LOCATION_RE` and the `firstLocation` `loc` regex, so a backfilled finding at `app/[id]/page.tsx:9` records `/page.tsx` — adopt the shared `FINDING_PATH` class without re-iding any item.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T102359-record-4631/work/4631-spec.md` (materialized from GitHub issue #4631)

---

### Task 1: Adopt FINDING_PATH in the backfill's location regexes while keeping item ids on the legacy location key

**Files:**
- Modify: `plugin/bin/lib/console/backfill.js`
- Modify: `plugin/bin/lib/console/resolve.js` (add `FINDING_PATH` to `module.exports` only — premise reversal: the spec says it is exported, it is not)
- Test: `tests/bin-lib/console/backfill.test.js`

**Design (the idempotency deliverable):** a split item's id is `backfillItemId({ runId, sourceKey: line, findingKey: '{lens}|{path}:{line}@{occurrence}' })`. A filed record is found again by its claim fingerprint (lens, path, claim) or by its item marker (`fingerprintFromBasis('consolebackfill', [itemId])`, `backfill-dispose.js` `filedRecordOf`). Widening the path class changes both for a path holding `@`/`[`/`(`/`~`/`+`/`%`/`$`, so an interrupted earlier pass's record (filed, apply never ran) would be filed a second time, and a legacy persisted `bf:` sibling with only `backfillSource` would stop matching its re-split and degrade to `split-drift`. Fix: the *reported* path (`finding.path`, `locations[].path`) uses the widened class; the *id key* keeps the legacy-class location. In `splitPoints`, also run the legacy regex (`/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/g`, kept as a named `LEGACY_LOCATION_RE` used for the id key only) over the whole line with its own per-`m[0]` occurrence count, index those matches by end offset, and give each widened token an id-key location of the legacy match ending at the same offset (`{legacyPath}:{line}@{legacyOccurrence}`) — else, when no legacy match ends there (a path the old class never matched at all, e.g. `app/[id].tsx:3`), its own widened `{path}:{line}@{occurrence}`. `findingKeyOf` reads that key; nothing else about ids changes. The `firstLocation` regex (line 337) only feeds `finding.path` for staged-file and split-drift items, whose ids never include a path — it just switches to `FINDING_PATH`.

- [ ] **Step 1: Failing test** — in `tests/bin-lib/console/backfill.test.js`, add:
  - AC1: a staged line naming `app/[id]/page.tsx:9` yields one finding with `path` `app/[id]/page.tsx`, line 9; one naming `packages/@scope/x.ts:4` yields `packages/@scope/x.ts`, line 4.
  - AC2 (ids): each of those items' `itemId` equals its pre-change id, pinned as literals `bf:92e55a23cd85de94` (bracket line) and `bf:8ea985962726eda2` (scoped line) — computed from the base derivation before this change.
  - AC2 (stored legacy sibling): a stored `{ ...KEEP('bf:92e55a23cd85de94'), backfillSource: <bracket line> }` lists under that same id as a `finding` (no `noClaimReason`), path `app/[id]/page.tsx`.
  - AC2 (no second record): a record an interrupted earlier pass filed for the old item (compose it with `planBatch` from `backfill-dispose.js` over an item with `path: '/page.tsx'` and id `bf:92e55a23cd85de94`, confirmed verdict; feed its text back as `existingIssues`) — `planBatch` over the re-run's work list for the same console files nothing and reuses that record.
  - Orthogonal: the existing `R14a`/`I1` pinned ids stay byte-identical (already covered by existing tests — they must stay green).
- [ ] **Step 2: Implement** — export `FINDING_PATH` from `resolve.js`; in `backfill.js` build `LOCATION_RE` from `FINDING_PATH` (global), add `LEGACY_LOCATION_RE` for the id key, carry the id-key location on each split token/finding, key `findingKeyOf` on it, and build the `firstLocation` regex from `FINDING_PATH`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/console/backfill.test.js tests/bin-lib/console/backfill-dispose.test.js tests/bin-lib/console/backfill-apply.test.js tests/bin-lib/console/backfill-cli.test.js tests/bin-lib/console/resolve.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4631`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (FINDING_PATH in `LOCATION_RE` and the line 337 `loc` regex) and Deliverable 2 (re-run idempotent for an item stored under its old truncated-path id) are Task 1 Step 2; AC1 and AC2 are Task 1 Step 1's tests.
- **Placeholders:** none.
