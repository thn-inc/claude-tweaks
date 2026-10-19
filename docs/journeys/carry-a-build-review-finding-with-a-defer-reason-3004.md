---
files:
  - plugin/skills/build/dispatch.md
  - plugin/skills/build/SKILL.md
  - plugin/skills/ledger/SKILL.md
  - plugin/skills/_shared/deferral-gate.md
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/skills/wrap-up/SKILL.md
  - tests/bin-lib/wrap-up/pack.test.js
---

# Carry a Build Review Finding With a Defer-reason

**Persona:** the agent session running `/claude-tweaks:build`, whose SDD per-task reviews and whole-branch review return Minor (or higher) findings; later, the agent running `/claude-tweaks:wrap-up` on the same run, and the maintainer reading its output.
**Goal:** every review finding is fixed in this build, or reaches the open-items ledger only after `_shared/deferral-gate.md`'s fix-now check with exactly one valid `Defer-reason:` in the row's Resolution text — and a row that skipped this is visible at wrap-up, not one call later at review.
**Entry point:** a per-task reviewer or the final whole-branch review returns a Minor finding during `/build`'s Common Step 2 (SDD execution).
**Success state:** the finding is fixed with a commit, or its `build`-phase ledger row reads e.g. `| 4 | build | {finding} | deferred | Defer-reason: genuinely-larger — {origin; files; revisit trigger} |`, and wrap-up shows no missing-Defer-reason warning for it.

## Steps

### 1. Decide fix or defer when the finding arrives
- **URL:** `plugin/skills/build/dispatch.md` → "Review findings go through the deferral gate"
- **Action:** Run the fix-now check from `_shared/deferral-gate.md` on the finding. If it qualifies, fix it in this build (task fix loop, or the final review's fix wave; on a single-task fast-lane run, the last task review's fix loop). Otherwise write the `minor (deferred):` progress line with its `Defer-reason: {value}` attached at write time.
- **Should feel:** Small findings get fixed while the context is hot; a deferral costs one deliberate sentence, not a shrug.
- **Should understand:** Severity alone ("minor", "fine to defer") is never a reason. The final whole-branch review triages each deferred minor with its reason already attached.
- **Red flags:** A `minor (deferred):` line with no `Defer-reason:`; a finding parked as "triaged fine-to-defer by the whole-branch review".

### 2. Carry the row into the ledger with the reason inline
- **URL:** `plugin/skills/build/SKILL.md` → Common Step 4 item 3; `plugin/skills/ledger/SKILL.md` → Add Item
- **Action:** At SDD's Finish carry-forward, append a `build`-phase row (`deferred` for a carried minor, `open` for blocked work) whose Resolution text repeats the single `Defer-reason:`. Blocked work names `blocked-dependency` or `blocked-external`.
- **Should feel:** The ledger row explains itself — a reader can tell why it waited without opening the review transcript.
- **Should understand:** A `build`-phase `open`/`deferred` row is the one case where Add Item's Resolution is not `—`. SDD `Ruling:` rows (Item starting `SDD ruling —`) and rows naming a `staged/…` path or a filed record are exempt: their reason lives in the staged proposal or record.
- **Red flags:** `| build | … | open | — |` for blocked work; two `Defer-reason:` values in one Resolution; an out-of-vocabulary value like `Defer-reason: minor`.

### 3. See the backstop at wrap-up
- **URL:** `jq .ledger.value "$PIPELINE_RUN_DIR/wrap-up-pack.json"` → `missingDeferReason`, `missingDeferReasonItems`; `plugin/skills/wrap-up/SKILL.md` → "Missing Defer-reason warning"
- **Action:** Read the counts; when `missingDeferReason > 0`, wrap-up renders one non-blocking `⚠` line naming the rows (`docs/plans/{file}-ledger.md#N` or `ledger.md#N`).
- **Should feel:** A build that ignored the prose is caught at the end-of-run console, without the gate pretending the rows are blocking.
- **Should understand:** The warning never changes the gate's open condition; the Resolve Gate's Phase 1 fix-now check still runs on those rows. Only phase exactly `build` is checked — `build/skill`, `build/docs`, `build/ops` rows are other producers.
- **Red flags:** The warning firing on an SDD ruling row or on a row that names `staged/…`; the warning blocking completion; a valid single `Defer-reason: tangential` row being listed.

## Origin
- Created during the build of #3004 (build: review minors are carried into the ledger as deferred with no Defer-reason), run `2026-10-19T160543-record-3004`.
- All steps were built in this session.
- Related: `docs/journeys/close-a-run-whose-ledger-holds-an-incomplete-deferral-3327.md` (the sibling `deferredUnstaged` backstop for `deferred` rows with no staged path or record) and `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` (the `Ruling:` carry-forward path this backstop exempts).
