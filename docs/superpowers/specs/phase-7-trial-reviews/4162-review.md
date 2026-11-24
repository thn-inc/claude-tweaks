## Review: #4162 — Console backfill can file a twin for a same-claim pair after a crash and a plugin upgrade (PR #6217, branch `drive-record-4162`)

**Review effort:** low (derived from record labels: risk:low × size:low; the diff heuristic agrees — 4 files / 133 lines, no merge-sensitive path → low)

Standalone review (no `$PIPELINE_RUN_DIR`), code mode. Every step ran; `ceremony:fast-lane` skips apply only inside a pipeline run.

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| A filing for item A carries the item marker of every same-pass item planned `sameAs A` | done — `planBatch` appends the twin's `work-fingerprint` item marker to the owner's filing text, which `everyMarkerMap`/`filedRecordOf` read on the next pass |
| The matched-record branch records `fingerprint → record number`, so a later same-fingerprint item reuses it | done — `batchMatched`, set in both the verdict and the no-verdict (prefiled) branches |
| The same treatment for digest lines | done — a digest twin's `consolebackfill-item` marker is appended to the owner's line; `batchHeld` covers a twin of an already-posted held line |

| Acceptance Criterion | Status |
|---------------------|--------|
| A/B with one fingerprint, crash after A's record, B's claim changed, re-plan → B reuses A's record, nothing filed; the test fails before the fix | met — verified by revert: all five new tests ran red against `origin/main`'s `backfill-dispose.js` in an archive extract and green at HEAD (167/167 in the four console-backfill suites) |
| An existing record matches A, B shares A's fingerprint → B is `sameAs` that record, not a new filing | met |
| The digest equivalent of the first test: no second digest line for B | met |

Non-Goals: none listed. Risk markers: the Gotchas premise was probed and confirmed at HEAD; no unvalidated markers. Current-State outcome reached (the change is to `planBatch` itself, the named mechanism).

### Verification (from /test)
- Type check: n/a (no `types` check declared)
- Lint: n/a (no `lint` check declared; static checks included in scope)
- Tests: pass — gate at entry: runner stamp verified HEAD `8983497dd6` (scoped). Re-verified after the review's fix waves: `verify.js --scope` took `tests` from CI on HEAD `50286fb68e` (test.yml run 45450653375: tests 36570, pass 36544, fail 0); `--stamp-status` → `verifiedHead: true`. All PR checks green.

### QA Validation (from /test)
- **Status:** Skipped — no stories (no `stories/` directory; the fix wave touched no story `source_files`)

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| error | `plugin/bin/lib/console/backfill-dispose.js:491` — a digest twin's item marker was appended only to `out.digest.lines[i]`, so the line no longer matched the owner disposition's `d.digest.line`. `tidy/console-backfill.md:81`'s digest-chunk step maps each planned line to its owner by `d.digest.line` → `undefined`, so the owner never got its comment ref and its `sameAs` twin stayed unsettled — on every same-claim digest pair of findings, crash or not. | high | fixed — the marker now goes onto the owner's `digest.line` and the same string into `out.digest.lines`; a new test re-applies the procedure's line→owner mapping (red before the fix, green after) — `b98e3047ed` |
| convention | Two record-numbered test files (`backfill-dispose-4162-held-digest-twin.test.js`, `backfill-dispose-4162-prefiled-twin.test.js`) duplicated `backfill-dispose.test.js`'s fixtures byte-for-byte, had no precedent in `tests/bin-lib/console/`, and the record's Key Files places these tests in `backfill-dispose.test.js` (surfaced in Step 1, not by a dispatched lens) | low | fixed — both tests moved into `backfill-dispose.test.js` beside the other #4162 tests; the two files deleted — `b98e3047ed` |

> At `low` tier lenses 3b and 3c ran as single reads (3b: No findings; 3c: two findings), so both 3c findings went to the Step 3.7 tiebreak.

### Tiebreak
**Verdicts:** 1 confirmed · 1 dropped · 0 digest · 0 console

- AUTO 18:34:20 — Reproduction: lens "3c" finding plugin/bin/lib/console/backfill-dispose.js:491 confirmed by tiebreak:8579afc23dff. Confirmed. Reversibility: high.
- AUTO 18:34:20 — Tiebreak tiebreak:75bb0ff2841a: lens "3c" finding plugin/bin/lib/console/backfill-dispose.js:471 dropped: refuted by tiebreak (staged-kind proposals end in the same `work-fingerprint` marker pair the twin append adds; `extractFingerprint` still reads the first marker). Severity: low. Reversibility: high.

### Fan-out leftovers
None — no new untracked files, no leftover `agent-scratch/` files, no new listeners.

### Implementation Hindsight
No changes needed — approach is sound. (Approach: correct for all three paths the record names. Structural: mutating an already-emitted entry is what produced the Step 3 bug — two copies of one line drifting; both copies are now written together and pinned by a test that reproduces the consumer's mapping. Consolidation: handed to Step 5. Convention: the test-file split, fixed in Step 3. Skill-worthy: none.)

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| `tidy/console-backfill.md`'s digest-chunk step still maps planned lines to owners by line text, not by an explicit owner id | The plan now keeps both copies identical and a test pins the mapping; switching to an emitted owner id would change a cross-file plan contract with no current defect behind it |
| A twin settled against an existing record (`batchMatched`) or an already-posted held comment (`batchHeld`) does not get its own marker written there | Those artifacts already exist and are not rewritten by a plan; the twin settles with a concrete ref in the same pass, so only a crash before `apply` plus a further claim change could re-open it — narrower than the window the record closes |

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: "no frontend surface (surface: infra) and no UI trigger file in the diff"; journeys whose `files:` overlap the diff: `apply-a-reflect-observation-at-the-review-console-4168`, `settle-every-review-finding-at-the-console-3949`

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- `plugin/bin/lib/console/backfill-dispose.js` — `batchFiled` now holds the filing entry and `batchDigested` the owner's `{ itemId, index, digest }`, removing the `filingOf` and `lineOf` maps; `sameAs` values and the plan shape unchanged (-7/+7). Post-dispatch diff audit: every reader of both maps updated; 168/168 console-backfill tests pass — `50286fb68e`

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Digest twin marker kept on the owner disposition's `digest.line` so `/tidy`'s line→owner mapping resolves — `plugin/bin/lib/console/backfill-dispose.js`, regression test in `tests/bin-lib/console/backfill-dispose.test.js` | `b98e3047ed` |
| Convention fix | Two record-numbered test files folded into `tests/bin-lib/console/backfill-dispose.test.js` | `b98e3047ed` |
| Simplified | Folded `filingOf`/`lineOf` into `batchFiled`/`batchDigested` — `plugin/bin/lib/console/backfill-dispose.js` | `50286fb68e` |
| Pushed | Both commits pushed to `drive-record-4162` (PR #6217 left draft, not merged or marked ready) | `50286fb68e` |

Footer: Steps 6.6 / 6.65 / 6.66 skipped by their pre-checks (no client/route paths, no settings/policy files, no mobile signal). Lens 3i: `docs/plugin-structure.md` matched `plugin/bin/**/*.js`; its `backfill-dispose.js` entry is module-level and still accurate — no finding. Lens 3g-cov: no stories — skipped. No PR verdict comment (standalone; no run-state `pr` object).

### Key Learnings
1. A planner that emits the same value twice (here `out.digest.lines[i]` and the owner disposition's `digest.line`) and later edits one copy breaks every consumer that joins the two by value — `tidy/console-backfill.md:81` joins by line text. The single-read 3c lens found it by reading the consuming skill prose, not the module's own tests, which passed — for `bin/lib/console/*` plan outputs, a reviewer should trace each output field into the `/tidy` fence that reads it.
2. The driver's build left its review-fix tests in separate `{module}-{record}-*.test.js` files with copied fixtures; a review pass should fold such evidence files back into the module's own suite.
3. Trial note (outside this diff): the driver's branch commit subjects read `… — refs — refs #4162` and `… () — refs #4162` (a doubled `— refs` and an empty parenthetical), so its commit-subject composition has a defect — the squash merge title comes from the PR title, so this does not reach `main`.

### Next Actions
**`/claude-tweaks:wrap-up 4162`** — capture learnings and clean up (recommended)
