# Review Console: a contested-pair partner re-staged after its own earlier verdict never inherits the pair's later verdict (#4583) Implementation Plan

**Goal:** Let a settled contested pair's verdict settle a partner finding whose own verdict predates its latest STAGED line.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T134359-spec-4583/work/4583-spec.md` (materialized from GitHub issue #4583)

---

### Task 1: Key inheritance on the partner's latest STAGED line

**Files:**
Modify: `plugin/bin/lib/console/resolve.js`
Test: `tests/bin-lib/console/resolve.test.js`

In `tiebreakModel`, index each key's latest STAGED line, using the same filter `naming` uses (`/^- STAGED /` and not `parseTiebreakLine`) and `lineKeys`. Then replace the inheritance guard at the `contestedPositionKeys` loop:

```js
const own = settledByKey.get(key);
const stagedAt = latestStaged.get(key);
if (!own || (own.index < stagedAt && chosen.index > stagedAt)) settledByKey.set(key, { ...chosen, key, inheritedFrom: name });
```

`own.index < undefined` is false, so a key with no STAGED line keeps its verdict. The `chosen.index > stagedAt` half keeps a pair verdict that also predates the re-stage from replacing the partner's own: neither settles the re-flagged line, and that line must stay open. Update the block comment above the loop, which says a partner inherits "only where no verdict names its key at all".

- [ ] **Step 1: Failing test** — add these next to the #4563 partner tests, using that block's `tbFinding`, `tbVerdict`, `tbDebate`, `positions`, `partner`, `stagedLow` and `findings` helpers, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
  - AC1 (red at base): partner STAGED, partner's own verdict, partner re-STAGED, then the contested pair's confirmed verdict naming it in Positions: no keep-staged item for the partner.
  - Order guard: partner's own verdict, partner re-STAGED, then the pair's verdict logged before that re-stage is impossible to arrange with one `tbVerdict` per finding unless the pair's verdict comes first. So log the pair's verdict, then the partner's own verdict, then the partner's re-STAGED line: the re-STAGED line stays keep-staged, because no verdict follows it.
  - AC2: the existing "a partner with its own later verdict keeps it over the inherited one" and "a partner's own verdict logged BEFORE the pair's verdict still wins over inheritance" tests stay unchanged and green.
- [ ] **Step 2: Implement** — the index, the guard and the comment above.
- [ ] **Step 3: Run** `node --test tests/bin-lib/console/resolve.test.js` — PASS, every existing test included.
- [ ] **Step 4: Commit** — one commit, `Let a re-staged partner inherit the pair's verdict — ...`, `Refs #4583`.

---

## Self-review

- **Spec coverage:** the Deliverable is the guard. AC1 and AC2 are Steps 1 and 3.
- **Placeholders:** none.
