---
files:
  - plugin/bin/lib/flow/preflight.js
  - plugin/bin/flow-preflight.js
  - plugin/skills/flow/steps-and-gates.md
  - plugin/skills/flow/manifesto.md
  - plugin/skills/flow/SKILL.md
  - tests/bin-lib/flow/preflight.test.js
  - tests/bin-lib/flow/preflight-cli.test.js
  - tests/flow-preflight-conformance.test.js
  - docs/plugin-structure.md
  - docs/skill-graph.md
---

# Adopt a Run Directory From One Preflight Pack

**Persona:** the agent session running `/claude-tweaks:flow` as the second Task call of a `/claude-tweaks:dispatch` handoff (`review,polish,wrap-up` against a run directory the first call created) — an internal tooling user — and a maintainer reading `preflight.json` afterwards to see what the second call knew when it adopted the run.
**Goal:** replace a chain of separately-narrated reads (run-dir adoption cases, the resume-freshness probe, the staged-inventory check, the Manifesto levers, the materialized spec, the PR and its phase checklist, the runner stamp, the changed-file set — each its own tool call with a reasoning turn between) with one `flow-preflight.js` call whose JSON `steps-and-gates.md` branches on and `manifesto.md` renders from; and make the five adoption note lines live in one place.
**Entry point:** `PIPELINE_RUN_DIR` is set on entry and `flow/SKILL.md` Step 3 reaches `steps-and-gates.md`'s "Adopting an inherited run directory".
**Success state:** `{run-dir}/preflight.json` exists with `adoption`, `freshness`, `inventory`, `levers`, `spec`, `pr`, `stamp`, and `changedFiles` envelopes, exit code `0`; the adoption note printed matches the case's literal; a `BLOCKED` freshness verdict stopped the pipeline before Step 3 with the probe's own line; the `### Pipeline Config (auto)` table's values came from `preflight.levers`.

## Steps

### 1. Run the pack once, before branching on the adoption case
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/flow-preflight.js" --run "$PIPELINE_RUN_DIR" --steps "{steps}"`
- **Action:** Invoke it where the adoption section places it; branch on `adoption.value.case` and print `adoption.value.note` verbatim.
- **Should feel:** The 24 minutes the second call once spent before review's first judgment collapse into one process; the five case descriptions are still the contract, but their probe commands are field reads.
- **Should understand:** `--steps` is metadata (echoed in the pack); every field is computed regardless. The adoption case is computed by `bin/lib/flow/preflight.js` from the same predicates the prose states — anchored under `$RUN_ROOT`, `config.yml` present, other run content present, `work/*-spec.md` committed on the run's branch as seen from the main checkout's git — and its four note literals are constants there; `steps-and-gates.md` renders them and `tests/flow-preflight-conformance.test.js` pins the two equal. Case 5 (unset) has no note and never calls the pack. Exit `0` means a pack was produced; `2` malformed (an empty `{steps}` — fix the call, never adopt); `3` means `--run` (or `--json`'s directory) is missing or not anchored under the main checkout, nothing written — that IS case 4: print its note with the reason the CLI's stderr names and take case 5's creation path. On a multi-spec parent the pack reads the headers under `spec-*/work/` (`spec.value.records`).
- **Red flags:** A note line that differs from the constant by a word (the pin fails); a case-3 note whose backfill list names something `run-state.json` already carries; a pack written on a `BLOCKED` verdict is normal (a gitignored, diagnostic-only file — the pack's only write) but adoption after it is not.

### 2. Read the freshness verdict before adopting — a produced pack is not permission
- **URL:** `jq .freshness "$PIPELINE_RUN_DIR/preflight.json"`
- **Action:** If `freshness.value.verdict === 'BLOCKED'`, report `freshness.value.line` verbatim and stop the pipeline before Step 3; if `inventory.value.status === 'MISMATCH'`, note `inventory.value.line` (non-blocking).
- **Should feel:** The same gate as before, with the same words — the pack carries the verdict, the skill still stops.
- **Should understand:** `freshness.value.line` and `inventory.value.line` are byte-for-byte the lines `hooks.js check-resume-freshness` and `check-staged-inventory` print; `detail` carries the probe's own verdict word (`not-interrupted`, `own-session`, …). `BLOCKED` is data, never an exit code — the conformance test pins that the prose's check-and-stop follows the call.
- **Red flags:** A run adopted while `freshness.value.verdict` reads `BLOCKED`; an adoption note printed before the freshness read.

### 3. Render the Manifesto FYI from the pack's levers
- **URL:** `plugin/skills/flow/manifesto.md` "Present the Manifesto"; `jq .levers "$PIPELINE_RUN_DIR/preflight.json"`
- **Action:** Fill the `### Pipeline Config (auto)` table from `preflight.levers` (`value` + `source`) and lever 1 from the pack's `mode`; do not re-resolve levers.
- **Should feel:** Twelve values and their sources arrive together, in the resolver's own vocabulary — a case-1 adoption only; cases 2, 3 and 5 compute the levers fresh and write `config.yml` as before.
- **Should understand:** A lever present in the adopted `config.yml` carries `source: run-config`; one absent from it resolves from `policy.yml` (`policy`) or the schema default (`default`), with the same derived defaults `resolve-policy.js` applies (`merge-verification`, `integration-model`); `ceremony-profile`'s source is `header` — it is a Manifesto fold, not a policy key, so the pack reads it from `config.yml`. A lever that failed to resolve carries `error` and renders as `unresolved`, never guessed.
- **Red flags:** A `resolve-policy.js` call for a lever the pack already carries; a `source` value outside the resolver's vocabulary.

### 4. Read the rest of the second call's facts from their fields
- **URL:** `jq '{spec, pr, stamp, changedFiles}' "$PIPELINE_RUN_DIR/preflight.json"`
- **Action:** `spec` names the materialized header; `pr` carries the PR record and its phase checklist (`{phase, done}` rows from the body's phases span) or `value: null` when the run has no PR yet; `stamp` is `verify.js --stamp-status`'s object; `changedFiles` is `verify.js --changed-files`' set — against the run's own stamp anchor when one is usable, else the integration branch the pack passes.
- **Should feel:** Change analysis and the skip-if-recent decision start from facts already on disk.
- **Should understand:** `pr.ok === false` means the probe itself failed (`gh` absent while a PR number is recorded) — the `gh`-absent MCP/no-forge path; never fabricate checklist state. `stamp`/`changedFiles` run in the worktree `run-state.json` names, bounded like every pack subprocess.
- **Red flags:** `pr.ok: true, value: null` on a `pr-first` run that has pushed — `run-state.json` lost its `pr` field; a `changedFiles` probe erroring with "could not resolve a base" — the integration-branch policy is unset and no stamp anchors the run.
