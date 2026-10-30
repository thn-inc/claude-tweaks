# Review Console settles nothing for a finding whose path holds characters outside [A-Za-z0-9_./-] (#4582) Implementation Plan

**Goal:** Key a finding by its whole path when the path holds `@`, `+`, `~`, `%`, `$`, `[id]` or `(group)`, so a later verdict settles that finding and only that finding.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T124227-spec-4582/work/4582-spec.md` (materialized from GitHub issue #4582)

**Premise correction (probed at build):** the record says such a path yields no key and fails safe. The old class is unanchored, so `findingKey` yields a truncated key: `packages/@scope/x.ts:4` keys `scope/x.ts:4`, and `app/[id]/page.tsx:9` and `blog/[id]/page.tsx:9` both key `/page.tsx:9`. A verdict on one therefore settles the other at the same lens and line. Only `DEBATE_CONVERGED_RE` and the debate entry regex fail to match. AC1 is green at base for that reason; the collision test below is the red that proves the fix.

---

### Task 1: Widen the finding-key path class

**Files:**
Modify: `plugin/bin/lib/console/resolve.js`
Test: `tests/bin-lib/console/resolve.test.js`
Waived `plugin/bin/lib/tiebreak.js`: read only, no change. Its verdict line carries the path through `\S+` and `.+` in resolve.js's own `TIEBREAK_*` regexes, and `EVIDENCE_RE` is `\S+`, so nothing there holds this class. The test below pins the round trip instead.
Waived `plugin/bin/lib/console/backfill.js`: read only, no change. `LOCATION_RE` has the same class, but its `itemId` hashes the path, so widening it re-ids stored backfill items. That is a separate record.

Add one shared source string above `DEBATE_CONVERGED_RE`, and use it at the three sites (`DEBATE_CONVERGED_RE`, the `entry` regex in `debateConvergedKeys`, the `loc` regex in `findingKey`):

```js
const FINDING_PATH = String.raw`(?:[A-Za-z0-9_./@+~%$-]|\[{1,2}[A-Za-z0-9_.@+~%$-]+\]{1,2}|\([A-Za-z0-9_.@+~%$-]+\))+\.[A-Za-z0-9]+`;
```

Brackets and parentheses count only as a closed group inside one path segment, so a citation wrapped in them (`[src/a.ts:4]`, `(src/a.ts:4)`) still keys `src/a.ts:4`. A space, `=`, and `,` stay outside the class, because each can join prose to a path.

- [ ] **Step 1: Failing test** — add these to `tests/bin-lib/console/resolve.test.js`, next to the #4563 debate tests, using that block's helpers:
  - AC1: a STAGED line for `packages/@scope/x.ts:4` followed by a `resolveTiebreak` confirmed verdict for the same lens and location produces no Low-confidence item.
  - AC2: a converged-positive debate line naming `app/[id]/page.tsx:9` supersedes that finding's STAGED line.
  - Collision: a confirmed verdict for `blog/[id]/page.tsx:9` does not supersede a STAGED line for `app/[id]/page.tsx:9` at the same lens and line. The same for `packages/@a/x.ts:4` against `packages/@b/x.ts:4`.
  - Wrapped citation: a STAGED line citing `[src/a.ts:4]` and a verdict for `src/a.ts:4` still settle.
  - Round trip: a `resolveTiebreak` confirmed line for `routes/$id.tsx:7` parses through `parseTiebreakLine` with `path` `routes/$id.tsx` and key `{lens}|routes/$id.tsx:7`.
- [ ] **Step 2: Implement** — the three sites above, plus a one-line comment on `FINDING_PATH` saying why groups must close.
- [ ] **Step 3: Run** `node --test tests/bin-lib/console/resolve.test.js` — PASS, every existing test included.
- [ ] **Step 4: Commit** — one commit, `Widen the finding-key path class — ...`, `Refs #4582`.

---

## Self-review

- **Spec coverage:** Deliverable 1 is the three sites, and Deliverable 2 is the round-trip test plus the Waived tiebreak.js line. AC1, AC2 and "existing tests still pass" are Steps 1 and 3.
- **Out of the class on purpose:** a path holding a space. The record's Current State names it, its Deliverables do not, and a space cannot join the class without capturing prose. Such a path still truncates (`my dir/x.ts:3` keys `dir/x.ts:3`).
- **Placeholders:** none.
