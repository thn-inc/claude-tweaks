---
files:
  - plugin/bin/lib/driver/plan-lane.js
  - plugin/bin/lib/driver/lane-bounds.js
  - plugin/bin/lib/issues/micro-plan-gate.js
  - plugin/bin/lib/issues/grouping.js
  - plugin/bin/lib/express/cli.js
  - plugin/skills/build/micro-plan.md
  - tests/bin-lib/driver/plan-lane.test.js
  - tests/bin-lib/express/cli-plan-lane.test.js
  - tests/build-micro-plan-code-twin.test.js
---

# Ask Whether a Record Needs a Plan

**Persona:** the maintainer shaping a backlog record who wants to know, before anyone writes an implementation plan for it, whether a lane that composes no plan will take it. Later, `/claude-tweaks:specify` asks the same question for each record it shapes; the specify record wires that call.
**Goal:** one answer, read only from the record's lane bounds: the pipeline driver, the express lane, `/build`'s micro-plan path, or none of them. It ignores grants, blockers, open PRs and `express-driver: split` parity, because none of those is settled when a record is shaped.
**Entry point:** `node plugin/bin/express-lane.js plan-lane --issue {n}` from a checkout of the project, or `--record-json {file}` with a `{number, body, labels}` record the caller already fetched.
**Success state:** one JSON line, `{"number": n, "lane": "driver"|"express"|"micro-plan"|null, "reason": "<code>"}`, exit 0 whatever the lane. A `null` lane means a plan gets written. A lane means the record is eligible by bounds, not admitted: a lane that later refuses it hands it back to `/build`, which composes its own plan.

## Steps

### 1. Ask about a live record
- **URL:** `plugin/bin/express-lane.js plan-lane --issue {n} [--repo owner/name]`; `plugin/bin/lib/express/cli.js` (`runPlanLane`)
- **Action:** The maintainer runs the verb against a record number. It fetches the record's fresh labels and body through `gh`, resolves exactly the policy keys the predicate reads (`POLICY_KEYS`: `express-driver`, `express-driver-max-size`, `express-driver-max-key-files`, `express-driver-max-risk`, `express-driver-review`, `express-driver-protected-paths`, `protected-paths`, `express-lane`, `integration-model`, `merge-sensitive-paths`), and prints the verdict.
- **Should feel:** Like asking one closed question and getting one line back. No claim, no label write, no run directory, nothing to clean up.
- **Should understand:** The answer follows this checkout's policy: a project with `express-driver: on` can read `driver` for a record that `off` would send elsewhere. Exit 1 means the fetch or the policy read failed; exit 2 is a usage error (both or neither of `--issue` and `--record-json`, `--repo` without `--issue`) or `gh` absent with `--issue`.
- **Red flags:** Any write to GitHub or the run directory. A verdict that changes when only `auto:build`, `auto:merge-pending`, `bot:*` or `parked` labels change, or when the record gains a `Blocked by #N` line.

### 2. Ask about a record you already fetched
- **URL:** `plugin/bin/express-lane.js plan-lane --record-json {file}`
- **Action:** The **agent** in a `gh`-absent sandbox (or a caller holding the record already) writes `{number, body, labels}` to a file and passes it. The verb reads it in place of the fetch.
- **Should feel:** Identical to step 1's answer for the same record and policy.
- **Should understand:** A file that is not one `{number, body, labels}` object is exit 2, never a guessed record. A `null` or absent body reads `body-unreadable`; any other non-string body is a malformed record, exit 2.
- **Red flags:** A malformed file that prints a lane.

### 3. Read the verdict
- **URL:** `plugin/bin/lib/driver/plan-lane.js` (`needsNoPlan`, `PLAN_LANE_REASONS`); `plugin/bin/lib/driver/lane-bounds.js`; `plugin/bin/lib/issues/grouping.js` (`extractKeyFileEntries`, which reads the `### Key Files` section the verdict's key-files reasons come from)
- **Action:** The maintainer reads `lane` and `reason`. Lanes are tried in precedence order: `driver` (`inside-driver-bounds`), then `express` (`inside-express-bounds`), then `micro-plan` (`passes-micro-plan-gate`). A record inside none reads `null`, `outside-every-lane`.
- **Should feel:** Trustworthy in the safe direction: when the answer is uncertain, it says `null` and a plan gets written.
- **Should understand:** The driver lane uses the driver's own admission helpers (`eligibilityOptions`, `evaluateRecordEligibility`, `reviewRequired`, `evaluateAdmission`), with grants, blockers, open PRs, state, escalation and parity neutralised, so a change to the driver's bounds moves this answer with it. That includes #6018's two widenings, read from policy as the driver reads them: `express-driver-max-risk` is the highest risk label the driver lane takes, and `express-driver-review: on` also admits any recognised `ceremony:*` label; a widened record reads `driver` only when the reviewer is on for it, so with `express-driver-review: off` a risk-widened record reads past the driver lane. `express-driver: off` means the driver lane never matches; `split` reads like `on`. Every input is checked before any lane runs: a missing `### Key Files` section (`key-files-missing`), an unparseable or unfilled-template one (`key-files-unreadable`), a malformed `Risk-flags:` line (`risk-flags-unreadable`), or a policy value resolve-policy marked invalid (`policy-unreadable`) reads `null` and never falls through to a later lane.
- **Red flags:** A `null` record that reads a lane after an unrelated policy key is mistyped (an unreadable bound must stop the answer). A health-origin record with no `### Key Files` section that reads a lane.

### 4. Keep `/build` and the predicate on one micro-plan rule
- **URL:** `plugin/skills/build/micro-plan.md` ("## Applicability gate"); `plugin/bin/lib/issues/micro-plan-gate.js` (`MICRO_PLAN_CONDITIONS`, `MAX_IMPLEMENTATION_FILES`, `countImplementationFiles`, `evaluateMicroPlanGate`); `tests/build-micro-plan-code-twin.test.js`
- **Action:** A **maintainer changing the micro-plan rule** edits `micro-plan-gate.js`. `/build`'s Spec Step 3 reads `micro-plan.md`, which names the four conditions by their `MICRO_PLAN_CONDITIONS` ids and cites the module for the count and for which Key Files count (tests, non-prompt docs, top-level `docs/plans/*.html` diagrams and read-only entries do not).
- **Should feel:** Like one rule with one home: the predicate and `/build` cannot disagree about which records skip a plan.
- **Should understand:** A Key Files note marks an entry read-only only through `read only` / `read-only`, or a `no change(s)` that ends the note or a clause; `(modify — no change to callers)` counts the file. `MAX_IMPLEMENTATION_FILES` is its own constant, never an import of the express lane's `EXPRESS_MAX_KEY_FILES`: the express lane counts every Key File, tests included, while this gate counts implementation files only (#5463). The twin test parses `micro-plan.md`'s numbered gate items against `MICRO_PLAN_CONDITIONS` and fails if the prose restates the count.
- **Red flags:** `micro-plan.md` stating a number of implementation files again, or a condition added to the code with no numbered item in the prose (the twin test goes red).

## Origin
- Created during `/claude-tweaks:build` of record #6053 (2026-11-22). The `/specify` call that consumes the verdict is a separate record (#6053's Non-Goals).
- Updated during the build of #6019 (run `2026-11-22T163434-record-6019`): the verb also resolves `express-driver-protected-paths`, and under `reviewer` a record whose protected Key Files are all merge-time families reads `driver` only with the reviewer step on for it.
- Updated during the build of #6020: the verb also resolves protected-paths
- Updated during the build of #5463 (run `2026-11-25T095255-record-5463`): the micro-plan gate's implementation-file limit rose from one to three, so a fast-lane, low-size record with up to three implementation Key Files reads `micro-plan` instead of `null`, and a merge-sensitive Key File, which only refuses the driver and express lanes, now falls through to `micro-plan`.
- Related journeys: `ship-a-small-record-on-the-express-lane-4025.md` (the express lane this answers for), `drive-a-named-record-to-a-draft-pr-5218.md` (the driver lane), `give-an-agent-filed-record-a-key-files-list-2975.md` (the `### Key Files` section all three lanes read).
