# Review Console SECTION_MAP has no prefix for staged/wrap-up-reflect-insights.md (#3926) Implementation Plan

**Goal:** Map the `wrap-up-reflect-` staged prefix to a Review Console section so an unattended wrap-up stops reporting its reflection-insights table as `pending (unmapped-prefix)`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T110840-spec-3926-3817-3945-3947/spec-3926/work/3926-spec.md` (materialized from GitHub issue #3926)

**Design decision:** a dedicated section, `Reflection insights`, rather than reusing an existing one. No existing section's stance routes to `review-console.md` "On approval" step 10, the step that applies this table: Queue writes (`apply` → step 7) only creates records and would skip "Implement now" and "Don't capture" rows, and the curation sections (`approve` → steps 2-5) apply engine rows, not this table. The new section's stance is `approve` ("Approve-all default — step 10 applies each row's recommended destination; D4/D5 rows informational"), and the appendix's Resolution-to-step mapping gains the line routing `approve` on a Reflection insights row to step 10, so no resolved row is left unrouted.

---

### Task 1: Add the wrap-up-reflect- prefix, its Reflection insights section and stance, and route it to step 10

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` — new `SECTIONS.INSIGHTS: 'Reflection insights'`; a `SECTION_MAP` row `[/^wrap-up-reflect-/, SECTIONS.INSIGHTS]`; a `CANONICAL_PREFIXES` entry `'wrap-up-reflect-'`; a `SECTION_STANCES[SECTIONS.INSIGHTS]` stance `{ resolution: 'approve', reason: 'Approve-all default — review-console.md step 10 applies each row\'s recommended destination; D4/D5 rows stay informational' }`
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` — the `approve` bullet of "Resolution-to-step mapping" names a Reflection insights row → step 10 (`staged/wrap-up-reflect-insights.md`)
- Test: `tests/bin-lib/console/resolve.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/console/resolve.test.js`: add `'wrap-up-reflect-insights.md': 'Reflection insights'` to the classify test's `expect` map; add the file to the `EVERY_SECTION` fixture and assert `resolveAll` resolves it `approve` with no `reason`; add a test that a run whose only staged file is `wrap-up-reflect-insights.md` yields no `pending`/`keep-staged` item (nothing under "Needs a human", i.e. the result's `unresolved`-equivalent set is empty); add `'Reflection insights'` to the `SECTION_STANCES` coverage list; add a test pinning that the appendix's Resolution-to-step mapping names `Reflection insights` and `step 10`. Run `node --test tests/bin-lib/console/resolve.test.js` — Expected: FAIL (`wrap-up-reflect-insights.md` classifies `Pending review`/`unmapped-prefix`).
- [ ] **Step 2: Implement** — the `resolve.js` and appendix changes listed under Files. The existing `CANONICAL_PREFIXES`-vs-`SECTION_MAP` twin tests (#3370) must stay green.
- [ ] **Step 3: Run the tests** `node --test tests/bin-lib/console/resolve.test.js` — PASS. Covers AC1.1 (classify test), AC2.1 (single-file run test). AC3.1 (`npm test`, no new skips) is covered by Common Step 5's full verification run.
- [ ] **Step 4: Commit** — one commit, "Map wrap-up-reflect- staged prefix to a Reflection insights console section — refs #3926".

---

## Self-review

- **Spec coverage:** Deliverable 1 (map `wrap-up-reflect-` to a section whose stance applies the rows as step 10 describes, add to `CANONICAL_PREFIXES`) — Files lines 1-2; Deliverable 2 (resolve under `console-auto` without a human, D4/D5 informational) — the `approve` stance and its reason text; Deliverable 3 (pin in `resolve.test.js`) — Step 1. AC1 (not `unmapped-prefix`) — classify test; AC2 (only-reflect-table run has nothing under "Needs a human") — the single-file run test; AC3 (`npm test`, no new skips) — Common Step 5.
- **Placeholders:** none.
