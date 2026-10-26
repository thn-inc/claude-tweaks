# Deriving `review-effort` — /claude-tweaks:review Step 2.5

Read from `code-mode-steps.md`'s Step 2.5 when no explicit effort token was passed. An explicit token
(Input resolution rule 8) always wins and resolves the tier without this file. The ambiguity rule
step 3 below cites as "below", and the line recording the resolved tier for Step 7's summary, both
stay in `code-mode-steps.md`'s Step 2.5, after its pointer to this file.

Resolution order — an explicit argument (step 1) resolves the tier on its own; otherwise steps 2-5 all run in order:

1. **Explicit argument.** If `$ARGUMENTS` contained an effort token (Input resolution rule 8), use it. Always wins — including over a high-risk record's own labels. A user who explicitly asks for `low` on a scary change, or `max` on a trivial one, gets what they asked for.

2. **Record risk/size labels.** Applies only when Input resolution resolved a spec/record number (rules 1-2) — file-path and no-argument reviews (rules 3, 7) have no record to read and go straight to step 3 below. Fetch the record's `risk:*`/`size:*` labels with a fresh, minimal read — independent of whether Step 1 ran (Step 1 is skipped under `ceremony-profile: fast-lane`, so this cannot assume a Step 1 fetch happened), per `work-backend`:

   **`github-issues`:** First mint the review's scratch dir if Step 3 hasn't yet. By default `mint` prints a one-line JSON object, `{"dir": "…"}` — take the `--print-dir` flag instead so the shell variable holds a bare path, reused as `{ctx-dir}` by Step 3's `build --dir {ctx-dir}` call:
   ```bash
   CTX_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/build-review-context.js" mint --print-dir --run "$PIPELINE_RUN_DIR")
   ```
   (append `--run "$PIPELINE_RUN_DIR"` when a run directory exists — as above; omit it otherwise). Never a fixed shared `/tmp` name — concurrent sessions reviewing the same record would clobber it. Against a build that predates the `--print-dir` flag, extract the path from the default JSON output instead: `CTX_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/build-review-context.js" mint --run "$PIPELINE_RUN_DIR" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).dir)")`. Then pipe the labels straight into the one-liner below; no file is written. Under `--run`, `{ctx-dir}` sits in the main checkout, where a worktree-isolated session is refused both a shell redirect and the `Write` tool.
   ```bash
   gh issue view {n} --json labels | node -e "const {parseRecordFacets}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js'); const d=JSON.parse(require('fs').readFileSync(0)); const {risk,size}=parseRecordFacets(d.labels); console.log(JSON.stringify({risk,size}))"
   ```

   **`local-files`:**
   ```bash
   node -e "const {readRecord}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
     const {risk, size}=readRecord(process.argv[1]).facets;
     console.log(JSON.stringify({risk, size}))" "{record-file-path}"
   ```

   Both resolve to the same `{risk, size}` shape. If either is `null`/`undefined` (record never scored) or the read fails (malformed labels, backend error), fall through to step 3 below — never default straight to `low`. Otherwise combine via this table:

   | risk ↓ / record size → | low | medium | high |
   |---|---|---|---|
   | **low** | low | low | medium |
   | **medium** | medium | medium | high |
   | **high** | high | xhigh | max |

   Risk (blast radius/safety) is the primary driver — `risk:high` always yields at least `high`. `risk:low` floors at `low` unless the record's own size (`size:*`) compounds it to `medium`. The result is the **label tier**, not yet the resolved tier — step 4 checks it against the diff.

3. **Diff heuristic.** Runs on every non-explicit resolution: alone when step 2 produced no label tier (no record, unscored, or the label read failed), alongside it otherwise. Its result is the **diff tier**. Derive proxies from Step 2's change analysis and feed the same table above:
   - Risk proxy = **high** if the diff touches a path matching the `merge-sensitive-paths` config key (the same key `assess-agent-autonomy`'s `merge-check` verdict mode already reads for the identical "elevated risk from touched paths" purpose), a schema/migration file, infra/CI-CD config, or introduces a new dependency (Step 2 already flags all of these for its ops-ledger check); **medium** if it touches public API surface or a cross-package interface; **low** otherwise.
   - Record-size proxy (the record's own `size` facet — not the `review-effort` tier being derived here): **high** at 10+ files or 300+ lines changed; **medium** at 3-9 files or 50-299 lines; **low** otherwise. These thresholds were the `review-diff-heuristic-thresholds` policy lever until its retirement in #331 (removal trail: `_shared/policy-deprecations.md`) — stated constants now, not configurable. Both counts come from Step 2's `git diff --stat` totals — this proxy never needs the full diff.
   - If `git diff --stat` produces no output to classify, default to `high` directly (skip the table) — see the ambiguity rule below. This holds when a label tier exists too: the diff tier is still `high`, so step 4 resolves upward per that rule.

4. **Take the higher.** No label tier → the diff tier is the resolved tier. Both → the resolved tier is the higher of the label tier and the diff tier; labels never lower a tier the diff already earns. A label far below the measured diff is the ambiguity `code-mode-steps.md`'s rule names, and it resolves upward. When the two agree, the recorded source stays `record labels: risk:{x} × size:{y}`. When they differ in either direction, Step 7's summary records both as `label {a}, diff heuristic {b} (risk:{x} × size:{y}; {reasoning})`, where `risk:{x} × size:{y}` are the record's labels. Worked example, #4028: labels `risk:low` × `size:medium` → `low`. Its diff was 142 files and 5,733 lines, including a PreToolUse hook that rewrites commands in every worktree session: a cross-package interface gives risk proxy `medium`, and 10+ files gives size proxy `high`, so the diff tier is `high`. Resolved `high`, recorded `label low, diff heuristic high`. This step reuses step 3's proxies and table unchanged and adds no new diff-shape signal (contrast the #361 decision below).

5. **Project-level floor (non-explicit resolutions only).** After step 4 above resolves a tier, resolve `review-effort-floor` — `EFFORT_FLOOR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values review-effort-floor)` — mirroring `review-auto-apply-ceiling`'s existing lookup precedent (`step3-routing.md`). If set, raise the resolved tier to at least the floor — never lower it (e.g. `review-effort-floor: high` turns a diff-heuristic `low` into `high`, but leaves an already-`xhigh` record-label resolution untouched). This step never applies when step 1 (explicit argument) already set the tier — an explicit token always wins, per step 1's rule above. Unset by default — no floor, current behavior unchanged.

## Decision: no independent UI-surface risk signal (#361)

A UI-only spec (table rendering/sorting, no schema/API/infra surface) once resolved `risk:low ×
size:medium` → `review-effort: low`, whose Step 3 lens set at that tier is 3b/3c only (Security +
Error Handling — `step3-lens-dispatch.md`'s scope table). The concrete run's own live visual
review (Step 6) and Impeccable critique/audit (Step 6.5) — both **effort-independent**, running
at every tier regardless of the resolved `review-effort` — surfaced a P0 UX bug, a WCAG 4.1.2
ARIA-validity violation, and a WCAG 1.4.10 reflow failure that the `low`-tier lens set was never
scoped to catch (3h UX Analysis, the lens that would, is gated to `high`+ regardless of any
UI-specific bump).

**Declined:** weighting "adds new interactive DOM elements" as an independent signal that bumps
`review-effort` for UI-surface specs. Rationale:

- The cited incident is not a miss — it is defense-in-depth working as designed. The layer
  scoped to catch UI/accessibility issues (Steps 6/6.5) caught them; the layer that didn't
  (Step 3's low-tier lens set) was never the one responsible for that class of finding.
- Bumping `review-effort` to pull 3h (or the full high-tier lens set) into scope for UI-surface
  specs would run a second, redundant pass over exactly what Steps 6/6.5 already cover
  end-to-end, at real cost (broader lens dispatch, reproduction pairs at `medium`+) on every
  UI-touching spec regardless of actual risk.
- The evidence base is a single case. A calibration change to a shared risk table should not
  ride on n=1 without a repeat signal — re-open this decision if a second, independent
  instance surfaces where Steps 6/6.5 also miss (not just where the code-review lens set alone
  would have).

If a future case shows Steps 6/6.5 themselves failing to catch a UI-surface defect that a
broader Step 3 lens set would have, that is the trigger to re-litigate this decision — the prior
reasoning above is the starting point, not a reason to avoid revisiting it.
