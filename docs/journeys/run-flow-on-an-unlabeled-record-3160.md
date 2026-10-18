---
files:
  - plugin/skills/flow/manifesto.md
  - plugin/skills/flow/materialize.md
  - plugin/skills/flow/failure-cards.md
  - plugin/skills/_shared/ceremony-check-invocation.md
---

# Run `/flow` on a Record That Has No `ceremony:*` Label

**Persona:** A claude-tweaks maintainer whose `/claude-tweaks:dispatch` queue mostly holds records that never went through `/claude-tweaks:specify`. Examples are a `docs-health` one-line docs fix, or a follow-up `reflect` auto-filed at a Review Console. They expect a tiny record to get a fast-lane run and not full-depth review ceremony.
**Goal:** Run `/claude-tweaks:flow #{n}` on such a record and have the run's `ceremony-profile` reflect what the record's content actually warrants, from Step 3 onward.
**Entry point:** `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow #{n} build,test auto` (a dispatched call 1) or a direct `/claude-tweaks:flow #{n}`, on an open `ready` record whose labels carry no `ceremony:fast-lane`/`ceremony:standard`.
**Success state:**
- `config.yml`'s `ceremony-profile` matches a `ceremony-check` verdict that was judged once, before any build step ran.
- `decisions.md` carries one `Manifesto ceremony-check` line naming that verdict.
- The materialized `work/{n}-spec.md` header's `ceremony:` holds the same value.
- `/claude-tweaks:review` runs at that depth, and no `ceremony:*` label was written to the record.

## Steps

### 1. Read the Manifesto's Ceremony profile lever
- **URL:** the `### Pipeline Config (auto)` table `/flow` prints at Step 3, then `{run-dir}/config.yml`
- **Action:** Check lever 9 (Ceremony profile). For a single unlabeled record, it is that record's freshly judged `ceremony-check` verdict. In a multi-record run, the lever is `fast-lane` only when every record's label or verdict is `fast-lane`.
- **Should feel:** Proportionate. A one-line docs fix reads `fast-lane` right away, not `standard` pending wrap-up's after-the-fact correction.
- **Should understand:** The Manifesto runs before any materialized header exists, so before #3160 an unlabeled record could only fold as `standard`. The verdict is a fresh automated judgment and can still be overridden in `confirm` mode with `9=standard`.
- **Red flags:**
  - `ceremony-profile: standard` on a trivially small unlabeled record with no matching `Manifesto ceremony-check` line in `decisions.md`, which means the judgment never ran.
  - Two different `CEREMONY:` lines for the same record in one run directory.

### 2. Find the one verdict line
- **URL:** `{run-dir}/decisions.md` (a multi-spec run uses the parent run directory's), under `## /flow`
- **Action:** Look for `- AUTO {time} — Manifesto ceremony-check: #{n} carries no ceremony:* label -> CEREMONY: {verdict}. Reversibility: n/a.` It is written once per unlabeled record, right after the Manifesto writes `config.yml`.
- **Should feel:** Auditable. One greppable line per record explains where the lever came from.
- **Should understand:**
  - A labeled record gets no line; its label is the value.
  - A dispatched call 2 (`review,polish,wrap-up`) adopts the existing `config.yml` (case 1) and writes no second line.
  - `interactive` mode has no Manifesto, so materialize judges instead.
- **Red flags:**
  - The line written before the snapshot header.
  - A missing line on a `local-files` run, which suggests the old log-during-compute ordering.

### 3. Confirm materialize reused the verdict
- **URL:** the committed `.claude-tweaks/pipelines/{run-id}/work/{n}-spec.md` header on the run's branch
- **Action:** Check that `ceremony:` matches the verdict line. Step 4 passed it to `bin/materialize.js --ceremony` and did not invoke `ceremony-check` a second time.
- **Should feel:** Consistent. The lever, the log and the header all tell the same story.
- **Should understand:** `materialize.js` prefers a label over `--ceremony`. A record labeled between Step 3 and Step 4 can show a header that differs from the already-locked lever, and that difference is accepted.
- **Red flags:** A header that disagrees with the verdict on a record that is still unlabeled, which means materialize judged again.

### 4. If the judgment produced no verdict
- **URL:** `/flow`'s failure output
- **Action:** Read the generic failure card. It shows `Failed at: Manifesto ceremony-check` and its resume line re-runs `/claude-tweaks:flow #{n}` with the same step list, never `#{n} ceremony-check`.
- **Should feel:** Loud and recoverable. A missing `CEREMONY:` line stops the run before Step 4 and is never quietly treated as `standard`.
- **Should understand:** The claim from Step 2.8 is still held, so the card's claim-release offer applies.
- **Red flags:** A run that continued to build with `ceremony-profile: standard` after a callee failure.

## Origin
- Created during build of #3160 (the flow Manifesto's ceremony-profile fold defaulted to `standard` for health-sweep-filed records with no `ceremony:*` label).
- Live example: run `2026-10-17T212804-record-3160` judged its own unlabeled record before the Manifesto (`standard`, `risk:medium`, a two-fix-site design choice).
- Related: `docs/journeys/adopt-a-run-directory-from-one-preflight-pack-1931.md` (case-1 adoption, which skips the judgment); `docs/decisions/0006-ceremony-tiering-owned-by-specify.md`.
