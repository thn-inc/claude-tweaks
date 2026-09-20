---
files:
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/dispatch/ceremony-derive.js
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/wrap-up/ceremony-derivation.md
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/skills/dispatch/settle-and-merge.md
  - plugin/skills/dispatch/drain-pr-overlap.md
  - plugin/skills/flow/multispec-review-console.md
  - plugin/skills/_shared/autonomy-ceiling.md
  - tests/bin-lib/console/resolve.test.js
  - tests/bin-lib/console/cli.test.js
  - tests/console-resolve-conformance.test.js
  - tests/console-autoresolve-drain-overlap-carveout.test.js
---

# Resolve the Unattended Console in One Process

**Persona:** the agent session running `/claude-tweaks:wrap-up` at `autonomy: unattended` (an internal tooling user) with nobody to answer a prompt, and the operator who reads the run directory afterwards to see what was decided and why. A second, smaller persona: the same session in `auto` mode deciding how much reflect ceremony a small diff deserves.
**Goal:** resolve every staged item of the Review Console in one process instead of one turn each — one decisions block, one `console.json` the archiver can read (#1854), one rendered table — while the merge itself, the memory writes, and the upstream filings stay in the skill; and let a low-surface `auto`-mode run downgrade its reflect depth whether or not a human is watching.
**Entry point:** Phase 4 of wrap-up reaches `review-console.md`'s "Auto-resolution short-circuit" with `consoleAutoResolve` granted; or Phase 1 reaches `ceremony-derivation.md` on an `auto`-mode run whose `config.yml` still says `ceremony-profile: standard`.
**Success state:** `console-resolve.js` exits `0` and `{run-dir}/console.json` reads `{resolved: true, mode: 'auto-resolve', …}`, `decisions.md` carries a `Console auto-resolved {n} item(s)` header plus one line per item, and the printed table shows every row stamped `AUTO-RESOLVED`; or, for the ceremony persona, `config.yml` reads `ceremony-profile: fast-lane` after a test-and-docs-only diff under `mode: auto`, and is untouched under `confirm`/`hybrid`/`interactive`.

## Steps

### 1. Let the mode, not the presence of a human, gate the ceremony downgrade
- **URL:** `plugin/skills/wrap-up/ceremony-derivation.md`; `shouldDerive({mode, ceremonyProfile})` in `plugin/bin/lib/dispatch/ceremony-derive.js`
- **Action:** At the top of Phase 1, read `config.yml`'s `mode` and `ceremony-profile`; derive only when `mode` is `auto` and the profile is still `standard`, then write `fast-lane` through `set-config.js` when the diff touches zero production files.
- **Should feel:** The 12-minute full-mode reflect on a `size:low` one-file fix is gone; the downgrade fires because the lever was never a question in `auto` mode, not because a dispatch marker happened to be set.
- **Should understand:** Under `confirm`, `hybrid`, and `interactive` the Manifesto presented `ceremony-profile` as a real question, so its value may be a human's answer and is never clobbered; a standalone wrap-up has no `config.yml` and never derives. The escape hatch below Reflect is still the only path back up to `standard`.
- **Red flags:** A `DISPATCH_HEADLESS` check reappearing in `ceremony-derivation.md` (`tests/ceremony-derivation-mode-gate.test.js` pins its absence); a `confirm`-mode run whose `config.yml` changed under it.

### 2. Run the resolver once, and read its exit code before anything else
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --policy console-auto` (append `--dry-run` on a dry-run wrap-up)
- **Action:** Invoke it exactly where the short-circuit section places it, after the ceiling check.
- **Should feel:** One command replaces a loop of render-log-write turns; the table it prints is the console, every row already resolved.
- **Should understand:** The CLI re-checks the ceiling itself — run config over project policy, a missing or unreadable policy reads `supervised` — and exits `4` unless it is `unattended` — a resolver that would resolve a console at `supervised`/`trusted` would silence a stop the auto-mode contract lists as never silenced; exit `4` routes to the ordinary "Present a real stop", and so does exit `5`, which means a console was already rendered on the PR and is waiting for a human (the CLI never clobbers that file). Exit `2` (malformed invocation) and `3` (`--run` not anchored under the main checkout) are HARD-GATE failures: an unattended run has nobody to answer a real stop, so it stops and reports the CLI's stderr. Exit `0` means resolved; a second run on an already-resolved directory re-prints the stored table and writes nothing; `--dry-run` prints without writing anything, `console.json` included.
- **Red flags:** A `console.json` appearing after a `--dry-run`; a `supervised` run whose decisions block says `at unattended`; two `Console auto-resolved` headers in one `decisions.md`.

### 3. Read the resolutions the way the skill does — stance per section, merge computed but never executed
- **URL:** `plugin/bin/lib/console/resolve.js` (`SECTION_MAP`, `SECTION_STANCES`); the printed table; `jq .merge "$PIPELINE_RUN_DIR/console.json"`
- **Action:** Execute the returned resolutions through the normal "On approval" steps, per the map `review-console.md` states: `apply` on a Pending-review item (a patch via `git apply`, a staged `.md` proposal the same way) → the staged-items step; `apply` on a queue-write or memory item → the queue-write / memory steps (the refused-proposals check still runs first); `approve` → the skill, doc, journey, configuration and reference-repair steps; `filed` → the upstream-filing step; `stale` → the patch step's `Invariant:` re-derivation; `keep-staged`, `pending` and `refused` → retained, listed in the closing pointer, never applied; then the merge half per `merge.resolution`.
- **Should feel:** The same decisions a human's "Approve all" would have made, in one pass — with the one documented divergence that `unattended` files upstream feedback instead of leaving it unchecked (#347), and with refused proposals still untouched by any lever.
- **Should understand:** A staged patch is `git apply --check`ed first and resolves to `stale — re-derive from Invariant:` when it no longer applies, never applied blind. Low-confidence and Contested findings resolve to `keep-staged`: those rows have no Approve-all default, so the file is retained and nothing is applied. A proposal a `REFUSED` line in `decisions.md` names resolves `refused`; an unrecognized staged prefix (or a `.shadow-dup` collision copy) lands in Pending review as `pending`, never auto-approved, so a new producer cannot slip past the console. The merge half honours three carve-outs — a `merge-check` verdict of `needs-human` in `decisions.md` (both the auto-merge short-circuit and the dispatch auto-merge gate log it), any group member lacking both `auto:merge` and an `auto:merge-pending` matured past the project's `grant-veto-window-hours`, and (#2299) `dispatch/drain-pr-overlap.md`'s own Auto-merge-gate hold: when `decisions.md` carries a "held — overlaps drain PR #{pr}" line, the resolver re-checks that PR's *live* state (`gh pr view`) rather than trusting the line as permanent — still open resolves `leave-open`, and the same self-heal applies once it merges or closes, so this carve-out (unlike the other two) never persists past the overlapping PR's own lifetime. It resolves to `leave-open` when the grants cannot be read (`grants-unreadable`), the group cannot be resolved (`members-unresolved`), or a drain-overlap PR's state cannot be re-verified (fails closed, same posture as `grants-unreadable`). Members come from the fact pack's `inputs.records`, falling back to the run dir's materialized headers; the labels are always read live. For a dispatched bundle, this same set of carve-outs is mirrored in `flow/multispec-review-console.md` — the parent call's own `merge.resolution` is always discarded (`members-unresolved`, since a bundle's parent has no `work/` headers), so the bundle's actual merge decision is this mirrored prose, not the per-spec resolver call.
- **Red flags:** `merge.resolution: merge` on a run whose `decisions.md` mentions `needs-human`; a `staged/*.patch` reported `apply` while `git apply --check` fails on it; `staged/` files deleted after resolution (they are retained as revert artifacts); a bundle group merging while `decisions.md` still carries a "held — overlaps drain PR" line for a PR that `gh pr view` shows as still `OPEN`.

### 4. Confirm the archiver will see a rendered console
- **URL:** `plugin/bin/lib/reconcile/archive-merged.js` (`readConsoleState`); `tests/bin-lib/reconcile/archive-merged.test.js`
- **Action:** After the merge lands, let `bin/hooks.js reconcile`'s archival sweep read `console.json`.
- **Should feel:** The unattended run's directory finally archives like an interactive run's — #1854's `console-never-rendered` skip no longer fires.
- **Should understand:** `readConsoleState` accepts `resolved: true` regardless of `mode`, so the auto-resolve shape needs no reader change; the write is what was missing.
- **Red flags:** A merged unattended run still sitting under `.claude-tweaks/pipelines/` with `console-never-rendered` in the reconciler's report.
