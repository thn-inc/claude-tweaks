---
files:
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/wrap-up-pack.js
  - plugin/bin/pr-checks.js
  - plugin/skills/wrap-up/SKILL.md
  - plugin/skills/wrap-up/residue-sweep.md
  - plugin/skills/wrap-up/unblocked-records.md
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
  - plugin/bin/lib/wrap-up/engine-verify.js
  - plugin/skills/assess-agent-autonomy/merge-check.md
  - tests/wrap-up-pack-conformance.test.js
  - tests/bin-lib/wrap-up/pack.test.js
---

# Gather the Wrap-Up Fact Pack Once, Then Read Fields

**Persona:** the agent session running `/claude-tweaks:wrap-up` at the top of Phase 3 (an internal tooling user), and a maintainer reading a run directory afterwards who wants to know what facts the wrap-up actually had in hand.
**Goal:** replace eight separately-narrated gathering steps (residue sweep, state block, blast radius, PR state, record labels, claim state, ledger count, newly-unblocked records) with one CLI call whose output every later sub-step reads — and make a probe that could not gather show up as a visible `ok: false` field, never as a clean-looking empty value.
**Entry point:** the run directory (`$PIPELINE_RUN_DIR`) exists under the main checkout, `run-state.json` names the worktree and (under `pr-first`) the PR, and `wrap-up/SKILL.md` reaches "### Nothing left behind".
**Success state:** `{run-dir}/wrap-up-pack.json` exists with eight `{ok, value | error, durationMs}` envelopes plus `inputs` (with a `sources` map saying where each input came from), exit code `0`, and each sub-file reads its field; or exit `3` and nothing written when `--run` is not anchored under the main checkout.

## Steps

### 1. Run the pack once, before any Phase 3 sub-step
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR"`
- **Action:** Invoke it exactly where `wrap-up/SKILL.md`'s "**Fact pack first.**" paragraph places it — once, before `residue-sweep.md`.
- **Should feel:** One command, a few seconds, replacing a page of "now run X, now run Y" narration whose outputs the model used to paraphrase.
- **Should understand:** The eight probes run concurrently and each is bounded (a 30 s subprocess timeout, a 60 s per-probe race), so the pack's wall-clock is its slowest probe, not their sum. `residue` runs with `--no-suite`: the pack never re-runs the test suite — suite state is `/claude-tweaks:test`'s pass stamp, which `residue-sweep.md` names. Exit `0` means "a pack was produced", not "every probe succeeded". A subprocess killed by that 30 s timeout reports a field error naming it — `timeout after 30000ms: node residue.js (killed by SIGTERM)` — never Node's bare `Command failed: …`, which read as a crash and hid a probe running 0.5 s inside its limit (#3479); a probe outliving the 60 s race reads `timeout after 60000ms`.
- **Red flags:** A `residue` field failing with `timeout after 30000ms` in a many-worktree checkout — the blast-radius sweep should finish in a few seconds there since #3479 (`sweep-only-your-own-residue-at-close-time.md` step 1), so a timeout points at a regression or a hung git call, not at worktree count. Exit `3` — `--run` (or `--json`) resolves outside the main checkout's `.claude-tweaks/pipelines/` tree. A worktree-relative path is the usual cause (`[IL-127]`); nothing is written, so re-run with the anchored path rather than hunting for a half-written file.

### 2. Read `inputs.sources` before trusting any record-scoped field
- **URL:** `jq .inputs "$PIPELINE_RUN_DIR/wrap-up-pack.json"`
- **Action:** Check `sources.records` and `sources.workBackend`.
- **Should feel:** The pack tells you where it found the record list — `headers` (the run dir's own `work/`), `worktree-headers` (the branch's committed mirror of the run dir, the normal case), `manifest` (a multi-spec parent's `manifest.yml` plus `spec-*/work/`), or `worktree-manifest` (that same manifest rung read from the worktree mirror) — instead of leaving you to guess why a field is empty.
- **Should understand:** The main-checkout run dir never holds the materialized headers; they are committed on the feature branch, so the worktree mirror is the path that resolves on a real run. When none resolves, `records` is `[]` and every record-scoped probe (`recordLabels`, `claim`, `ledger`, `unblocked`) is `ok: false` with `records unresolved` — by design, not by accident. Which records a run may close is decided once, in `pack.js`'s `closingRecords`, and surfaced as `inputs.closingRecords`: equal to `records` on a header source (`headers` or `worktree-headers`), `[]` on a manifest rung, whose ids include specs that never ran, whose PR line is `Refs`, not `Fixes` (#3365, #3399). Every closing-keyword reader reads that field — wrap-up's carrier-commit stamp (`cleanup-procedures-execution.md` Section C step 2), the current-branch `Fixes` set, the Review Console's `verify-expectations.json` `issues` write (step 11), and `wrap-up-engine.js verify`'s `carrier-commit` row. `inputs.parkedAtShaping` (record number → the header's `parked-at-shaping` flag) is what Section E's restore-on-abandon reads, so it never re-reads a header from a worktree that cleanup may already have removed; a `cleanup-only` run, which skips Phase 3, produces the pack (`--only claim`) before item 4. `work-backend` is read from CLAUDE.md's `## Work records` block (it is deliberately not a `policy.yml` key); an undeclared value is `unconfigured` and the forge-gated probes refuse rather than assuming a backend.
- **Red flags:** `sources.records: "unavailable"` on a run that plainly has a materialized header — the mirror path did not resolve; check `run-state.json`'s `worktree` value. A `ledger` field reporting `open: 0, total: 0` while this run's own `docs/plans/*-ledger.md` visibly has rows was exactly the silent-clean shape this feature's own whole-branch review caught before the records-unresolved guard existed. Check `ledger.files` against `ledger.unattributedFiles` before calling it that: since #2887 a ledger counts only when this branch added or changed it against the merge base, or it sits untracked in the worktree. Ledgers inherited from the integration branch (other runs' finished ledgers) are listed under `unattributedFiles` and never summed, so `0/0` beside a non-empty `unattributedFiles` is correct. A missing merge base or a failing git call makes `ledger` `ok: false` rather than a guessed count. One known false reading: a pack gathered after this branch already merged sees the merge base equal HEAD, so the run's own committed ledger lands under `unattributedFiles` too.

### 3. Let each sub-step read its field — and take the failure path on `ok: false`
- **URL:** `plugin/skills/wrap-up/residue-sweep.md`, `unblocked-records.md`, `cleanup-procedures.md`, `review-console.md`, `auto-merge-short-circuit.md`, `summary-template.md`, `review-console-interactive.md`
- **Action:** Follow each file's one pack sentence: read `pack.{field}` from `wrap-up-pack.json`; run the file's own command only when the pack file is absent.
- **Should feel:** The gathering happened once; the sub-steps are now pure reads plus the judgment they always carried.
- **Should understand:** Three rules, stated once in SKILL.md and applied everywhere: an `ok: false` field takes that sub-step's existing failure path (the residue sweep's `unknown`, the unblocked check's "skip this run" warning, merge-check's `could-not-gather` → `needs-human`); a key missing from a present file counts as `ok: false`; only an absent file lets a sub-step gather for itself. Two fields are informational by design — `pack.recordLabels` is the console's audit snapshot, while the authorization grant read stays a live `gh issue view` fetch, because a Phase 3 snapshot must never authorize a merge; and `pack.state.value.rendered` is pasted verbatim, because `summary-template.md` forbids composing the State block from JSON fields. `pack.pr.value.ci` is the `bin/pr-checks.js --pr` verdict for the run's PR head (#3469): the Review Console recommends merging only on `green`/`no-ci`/`pending`/`stale`, and a missing `ci` key or a `read-failed` verdict is a failed read, never green. The rollup alone is never the source, because it reads a partial CI run as green.
- **Red flags:** A sub-step that reads `ok: false` and reports a clean result. Any prose that names a `pack.*` field the code does not produce — `tests/wrap-up-pack-conformance.test.js` pins the call count, its Phase 3 position, the eight names, and each sub-file's `wrap-up-pack.json` + absent-file sentence, so a drift here should fail that test before it reaches a run.

### 4. Hand merge-check the blast radius instead of letting it re-probe
- **URL:** `Skill(skill: "claude-tweaks:assess-agent-autonomy", args: "merge-check #{n} --pack {run-dir}/wrap-up-pack.json")`
- **Action:** The auto-merge short-circuit passes `--pack`; merge-check Step 1 takes `{mergeBase, config, summary}` from `pack.blastRadius` and skips `blast-radius.js`.
- **Should feel:** The same blast radius the residue sweep scoped on is the one the merge decision is judged against — one measurement, two consumers.
- **Should understand:** An `ok: false` blast radius is merge-check's existing `could-not-gather` → `needs-human`; it never triggers a fresh probe, because the pack's failure already is the freshest attempt. Without `--pack` (no pack file), merge-check runs its CLI exactly as before.
- **Red flags:** merge-check re-running `blast-radius.js` while a pack exists — a stale prose path; or a `needs-human` verdict on a run whose pack shows `blastRadius.ok: true`, which means the args were not threaded through.
