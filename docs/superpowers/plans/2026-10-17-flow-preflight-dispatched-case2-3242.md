# flow preflight: a dispatched first call adopts as case 2 (fresh), not case 3 (repair) (#3242) Implementation Plan

**Goal:** `computeAdoption` currently returns case 3 (repair, with backfills) for a dispatched `/flow` call 1, because the Step 1.8 ledger line already sits in `decisions.md` when Step 3 runs. A dispatched call 1 should get case 2 (fresh, initialize in place).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T062703-spec-3242/work/3242-spec.md` (materialized from GitHub issue #3242)

---

### Task 1: Return case 2 for a dispatched call 1 (`dispatched: true`, no `pr`, no `config.yml`)

**Files:**
- Modify: `plugin/bin/lib/flow/preflight.js` (`computeAdoption`)
- Modify: `plugin/skills/flow/steps-and-gates.md` (the "Adopting an inherited run directory" case list: case 2 wording)
- Test: `tests/bin-lib/flow/preflight.test.js`

- [ ] **Step 1: Failing test.** Append new tests to `tests/bin-lib/flow/preflight.test.js`, reusing the existing `mainRoot()`, `deps()`, `NO_SPEC` and `CLAIM_ONLY` helpers. Build one shared fixture for a dispatched call 1 at the moment Step 3 runs. It writes a `decisions.md` holding the Step 2.8 claim line (`CLAIM_ONLY`) followed by a Step 1.8 ledger line, e.g. `- AUTO 18:42:10 — Step 1.8: flow: created open-items ledger docs/plans/2026-09-06-record-7-ledger.md. Reversibility: n/a.`. It writes a `run-state.json` with `{"worktree": "/w/tree", "status": "active", "dispatched": true}` and no `pr`. There is no `config.yml` and no materialize commit (use `NO_SPEC`). Add these tests:
  - AC 2: that fixture → `case === 2`, `backfills` deep-equals `[]`, and `note` equals `ADOPTION_NOTES[2]` with the realpath substituted.
  - AC 3: the same fixture plus `pr: { number: 1, url: 'u', branch: 'b' }` in `run-state.json` → `case === 3` (the #3226 call-2 repair path stays unchanged).
  - AC 4: the same fixture without `dispatched: true` → `case === 3` with the backfills `computeAdoption` returns today (`['PR-early lifecycle', 'materialize commit']`, since `worktree` is present).
  - AC 5: `run-state.json` unreadable or malformed (write the literal text `{not json` to it; also add one variant whose `readRunState` dep throws) → the same case as today, which is case 3.
  - A falsy-but-not-true `dispatched` value (`"true"` as a string, or `1`) → case 3. This pins strict `=== true`.

  Run only this file: `node --test tests/bin-lib/flow/preflight.test.js > {scratch}/red.txt 2>&1; echo "exit=$?" >> {scratch}/red.txt`. **Before touching `preflight.js`**, confirm that the AC 2 test FAILS with case 3 and that the AC 3, 4, 5 and string-`dispatched` tests PASS, because they pin today's behavior. Keep the raw red output file. It goes verbatim into the PR description, per AC 1.

- [ ] **Step 2: Implement.**
  - In `computeAdoption`, between the `hasConfig` (case 1) return and the `!hasOtherContent` (case 2) return / case-3 fallthrough, add one early return. When `state` (the value `deps.readRunState(real)` already returned; this is the existing deps reader, so don't add a second read) is a plain object with `state.dispatched === true` and no `state.pr`, and `config.yml` is absent (already guaranteed, because `hasConfig` returned earlier), return the same case-2 object shape the `!hasOtherContent` branch returns: `ADOPTION_NOTES[2]` note and `backfills: []`.
  - Key only on these structural fields. Don't match on Step 1.8 log text, and don't key on whether a claim line is present. `readRunState` already returns `null` on unreadable or malformed JSON, so that path falls through to today's logic untouched. Guard against a `readRunState` dep that throws as well: catch, then fall through.
  - Add a short comment that names #3242 and gives the reason: a compliant call 1 logs Steps 2.8 and 1.8 before Step 3, and a recorded `pr` is what separates the #3226 call-2 repair from a fresh call 1.
  - Update case 2 in `plugin/skills/flow/steps-and-gates.md` so it explicitly names the dispatched-call-1 shape: `run-state.json` has `dispatched: true`, no `pr`, and no `config.yml` → case 2 even when `decisions.md` already carries Step 1.8 or other pre-Step-3 lines. Also state that a recorded `pr` keeps it in case 3. Edit in place and keep it to a sentence or two. Then run `tests/flow-preflight-conformance.test.js` and every other test that pins `steps-and-gates.md` prose (`git grep -l "steps-and-gates" tests/`) to confirm nothing pinned broke. **No existing assertion may change** (AC 6).

- [ ] **Step 3: Run.** `node --test tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/preflight-cli.test.js tests/flow-preflight-conformance.test.js` must PASS. Quote the raw summary lines. Don't run the full suite; that runs centrally later.

- [ ] **Step 4: Commit.** Make one commit with only the three files above staged by explicit path. Message: `Return case 2 for a dispatched flow first call — dispatched marker, no pr, no config.yml` followed by a blank line, `refs #3242`, a blank line, and `Claude-Session: https://claude.ai/code/session_01LzjeBaJPYTntRsRJ2VHX8r`. Never use a closing keyword.

---

## Self-review

- **Spec coverage:** Deliverable 2 (the new case-2 rule) and Deliverable 3 (fail toward today's behavior) are covered by Step 2's first two bullets. Deliverable 4 (steps-and-gates wording) is Step 2's last bullet. Deliverable 1 (premise probe) was already done; its fixture lands as AC 2's test. AC 1 is the red output kept from Step 1, AC 2-5 are the Step 1 tests, and AC 6 is Step 3 with no existing assertion changed.
- **Placeholders:** `{scratch}` is the implementer's own scratch directory outside the repo. Nothing else is a placeholder.
