# Stop flipLedgerRow dropping a duplicate-numbered ledger row on write-back (#3834) Implementation Plan

**Goal:** `plugin/bin/lib/wrap-up/ledger-write.js`'s `parseLedgerTable` keys rows by item number in a `Map`, so two rows sharing a number collapse on parse and `serializeLedgerTable` writes only the survivor back — make the write-back refuse loudly instead of dropping a row.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T132803-record-3834/work/3834-spec.md` (materialized from GitHub issue #3834)

**Approach (chosen branch of the spec's "preserve or refuse" deliverable):** refuse. `parseLedgerTable` records every item number it saw more than once as a new `duplicates` array on the returned table (the `rows` Map and every other field keep their current shape, so `plugin/bin/lib/stage-item/ledger.js`'s `appendLedgerRow` — the other caller, which already refuses duplicates itself with `LEDGER_UNSAFE` before it serializes — is untouched). `serializeLedgerTable` throws when `table.duplicates` is non-empty, naming the duplicated number(s) and `_shared/ledger-format.md`'s Item Numbering section, so no write-back path can emit a table that silently lost a row. `flipLedgerRow` therefore throws for a ledger holding a duplicate number whichever item it flips; its one caller, `wrap-up-engine.js finish-console`, already turns a `flipLedgerRow` throw into `ledger pre-flight failed at ledger[i]: … — nothing written` and exit 1 — the same refusal posture as the existing raw-`|` row refusal. Refusing (rather than preserving) matches the ledger contract: item numbers are never reused, so a duplicate means a hand-corrupted ledger, and `stage-item.js --ledger` already refuses it with "fix the ledger by hand".

---

### Task 1: Refuse the ledger write-back when the table holds duplicate-numbered rows

**Files:**
- Modify: `plugin/bin/lib/wrap-up/ledger-write.js`
- Test: `tests/bin-lib/wrap-up/ledger-write.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/wrap-up/ledger-write.test.js`, add a fixture with two contiguous rows numbered `| 1 |` plus a `| 2 |` row, and assert: (a) `flipLedgerRow(fixture, { item: 2, status: 'fixed', resolution: 'x' })` throws naming the duplicate number `#1`; (b) `flipLedgerRow(fixture, { item: 1, … })` throws the same way; (c) `parseLedgerTable(fixture).duplicates` deep-equals `['1']`, and a duplicate-free table's `duplicates` is `[]`. Run: `node --test tests/bin-lib/wrap-up/ledger-write.test.js` — Expected: FAIL (today the flip returns text with one `| 1 |` row dropped).
- [ ] **Step 2: Implement** — in `ledger-write.js`, have `parseLedgerTable` collect `duplicates` (each repeated item number once, in first-repeat order) and have `serializeLedgerTable` throw when it is non-empty; update the `parseLedgerTable` header comment to name the new field.
- [ ] **Step 3: Run** `node --test tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/stage-item/ledger.test.js` — PASS (the stage-item suite's `I3b` duplicate refusal must still report its own `duplicate row numbers in the ledger table` message, since its check runs before serialization).
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3834`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (refuse the write-back instead of dropping a row) → Step 2; Deliverable 2 (two-row `| 1 |` fixture, no row lost across a `flipLedgerRow` round-trip) → Step 1; Acceptance Criterion (fails loudly without writing; the new test fails when the fix is reverted) → Steps 1 and 3 (the test asserts a throw, which the unfixed code does not produce).
- **Placeholders:** none.
