# Fail closed when decideConsoleExecute runs without its ruling-text or merge-grant context (#4048) Implementation Plan

**Goal:** Make `decideConsoleExecute`'s ruling gate and merge-grant gate withhold for a human when a gated row is present but its `ctx` context is absent, instead of treating the absent context as "nothing to withhold".

**Spec:** `.claude-tweaks/pipelines/2026-10-24T121146-spec-4048/work/4048-spec.md` (materialized from GitHub issue #4048)

---

### Task 1: Fail closed on absent ruling-text / merge-grant context in decideConsoleExecute

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js`
- Modify: `plugin/skills/_shared/console-execution.md`
- Test: `tests/console-execute.test.js`

- [ ] **Step 1: Failing test** — in `tests/console-execute.test.js`:
  - Invert `decideConsoleExecute: no ctx.rulingTexts -> rulingGateGaps [] (legacy call shape unchanged)`: a console with one `isRulingRow: true` item `staged-1`, called with no `ctx` and with `{ prBody: 'x' }`, must return `rulingGateGaps` deep-equal to `[{ id: 'staged-1', reason: 'sdd-ruling-unclassified' }]`. Rename the test to describe the fail-closed behaviour.
  - Invert `decideConsoleExecute: isMergeRow present but no ctx supplied (legacy call shape) -> mergeGrantGap null, unchanged`: `decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, now)` must return `mergeGrantGap` deep-equal to `{ member: null, reason: 'grant-context-missing' }`; also assert the same gap when only `prBody` is supplied and when only `memberGrants` is supplied. Rename to describe the fail-closed behaviour.
  - Add one test: a console whose items carry neither `isRulingRow` nor `isMergeRow`, called with no `ctx`, returns `rulingGateGaps: []` and `mergeGrantGap: null`.
  Run: `node --test tests/console-execute.test.js` — Expected: FAIL (the two inverted tests).
- [ ] **Step 2: Implement** — in `plugin/bin/lib/reconcile/console-execute.js`'s `decideConsoleExecute`:
  - Ruling gate: drop the `if (ctx.rulingTexts && typeof ctx.rulingTexts === 'object')` guard; take `const rulingTexts = ctx.rulingTexts && typeof ctx.rulingTexts === 'object' ? ctx.rulingTexts : null;` and for every `isRulingRow: true` item call `sddRulingDeferralReason(rulingTexts ? rulingTexts[item.id] : null)` (that already returns `sdd-ruling-unclassified` for `null`), pushing any non-null reason.
  - Merge-grant gate: keep `hasMergeRow` as the outer condition; when `typeof ctx.prBody !== 'string'` or `ctx.memberGrants` is not an object, set `mergeGrantGap = { member: null, reason: 'grant-context-missing' }`; otherwise run today's `parseFixesMembers` / `evaluateMaturation` loop unchanged.
  - Rewrite the header comment above `decideConsoleExecute` (the `ctx:` block that says an absent ctx "always yields mergeGrantGap: null" / "always yields rulingGateGaps: []") and the `#3880` inline comment to state the fail-closed behaviour. `consoleExecuteDetect` is unchanged.
  - In `plugin/skills/_shared/console-execution.md`: in the "Mechanized, not re-derived per session (#1966)" paragraph, add that a merge row evaluated without its context withholds with `grant-context-missing`; in the "Third narrower exception (#3880)" paragraph, add that an absent ruling-text map withholds every ruling row as `sdd-ruling-unclassified`; next to the #1802 withheld-merge log line (`member #{m} lacks auto:merge`), add a null-member form: `AUTO {time} — Console execution: withheld branch-finish/merge on PR #{n} — {reason}. Reversibility: n/a (declined to act).` for a gap whose `member` is null (`grant-context-missing`, `members-unresolved`).
- [ ] **Step 3: Run** `node --test tests/console-execute.test.js` — PASS. Then confirm each inverted test discriminates: revert only the ruling-gate change and see the ruling test fail; revert only the merge-grant change and see the merge test fail; restore both.
- [ ] **Step 4: Commit** — one commit, `Fail closed when decideConsoleExecute runs without its ruling-text or merge-grant context — refs #4048`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item (ruling gate, merge-grant gate, no-gated-rows behaviour, comments, tests, `console-execution.md` reason + ruling withhold + null-member log line) and every `## Acceptance Criteria` item (the three return-shape assertions, existing tests unchanged, revert discrimination, the two greps, `npm test`) is covered by Task 1's Files/Steps above; `npm test` runs at Common Step 5.
- **Placeholders:** none.
