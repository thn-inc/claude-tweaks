# Multi-Spec — Dependency-Aware Ordering

Loaded from `multi-spec.md`'s "Dependency-aware ordering" section.

A target may declare prerequisite records — `blocked-by:` on the record (materialized header, or live via `materialize.md`'s Resolution). The user's order on `$ARGUMENTS` (`/flow #157,#159,#160`) may not match the dependency graph.

## Procedure

1. **Build the DAG** — for each target in the list, add edges from each prerequisite to the target itself, from its `blocked-by:` entries
2. **Detect cycles** — if any cycle exists across the listed specs, **hard fail**:
   ```
   Cycle detected in dependency graph:
     159 → blocked-by: 160
     160 → blocked-by: 159
   
   Resolve the circular dependency (edit the records' blocked-by) before running /flow.
   ```
3. **Topologically sort** the specs
4. **Compare against user order:**
   - **Match** → proceed silently with the user's order
   - **Mismatch** (user order violates a dependency edge) → surface:
     ```
     Spec order doesn't match dependencies:
       You requested: 159 → 160 → 157
       Topological:   157 → 159 → 160   (157 is depended-on by 159; 159 by 160)
     ```
     then call `AskUserQuestion`:
     - `question`: `"Spec order doesn't match dependencies — how do you want to proceed?"`, `header`: `"Dependency order"`, `multiSelect`: `false`
     - Option 1 — `label`: `"Use topological order (Recommended)"`, `description`: `"Re-order to 157 → 159 → 160"`
     - Option 2 — `label`: `"Keep my order"`, `description`: `"I know what I'm doing — run 159 → 160 → 157 as requested"`
     - Option 3 — `label`: `"Cancel"`, `description`: `"Stop; I'll fix the dependencies or the order myself"`

     In `auto` mode, **default to option 1** silently and log: `AUTO {time} — Step 1: re-ordered specs to match dependency graph. User order: 159,160,157. Topological: 157,159,160. Reversibility: high.`

## Targets with a dependency on a target NOT in the run

If record 159 depends on record 142 (not in the run list) — via `blocked-by:` — Validation step 3's `--blocker-landing` call has already judged 142: each record's `blockerLanding` lists `{blocker, verdict, commit, via}` for every blocker that is not one of the run's targets. A closed blocker is not enough — its closing commit must have reached `origin/{integration-branch}`, or the run builds on code the integration branch never received. Read the verdict (a call that carried no `--blocker-landing` — a multi-record resume whose step list has neither `build` nor `test`, as `validation.md`'s 2.7b skips — leaves no `blockerLanding` to read, and nothing here applies):

| Verdict | Outcome |
|---|---|
| `open` | hard fail — stop before Step 2.8 claims: "159 depends on 142 which is still open and not in this run" |
| `unlanded` | hard fail — stop before Step 2.8 claims, render the card below |
| `landed` | satisfied |
| `not-applicable` | satisfied (closed `NOT_PLANNED`/`DUPLICATE`, no code) |
| `undetermined` | proceed — the landing could not be judged for this blocker; once the run directory exists (after Step 3's Manifesto write, as `multispec-merge-gate.md` times its entries) write one `SKIP` per blocker |

```
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status SKIP --step "Step 2 blocker landing (undetermined)" --reversibility n/a --text-file "{text-file}"
```

`{text-file}` holds one line, `condition: #{blocker} blocker landing undetermined (via {via}) → fallback: proceeded without confirming its closing commit reached origin/{integration-branch}`, written per `_shared/auto-decision-log.md`'s Text from git or a user paragraph — the integration branch is git-derived, so the text never passes through shell quoting. With several blockers, write the file, log it, then rewrite it for the next blocker.

A failed blocker query is not `undetermined` — the call exits non-zero and the run stops before claiming (`multispec-preflight-failure.md`).

The `unlanded` stop card:

```
Blocker not landed — stopping before any claim.
  #{n} is blocked by #{blocker}, which is closed, but its closing commit {commit}
  is not on origin/{integration-branch}.

# Escape 1 — land it, then re-run (under pr-first, open a PR from a branch carrying that merge instead):
git fetch origin {integration-branch} {commit}
git switch {integration-branch}
git merge --ff-only origin/{integration-branch}
git merge {commit}
git push origin {integration-branch}
# To land only the fix (not the commit's whole history), cherry-pick it, then take escape 2

# Escape 2 — remove the edge, then re-run. work-links: native:
gh api -X DELETE "repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by/$(gh api repos/{owner}/{repo}/issues/{blocker} --jq .id)"

# Escape 2 — work-links: body-text: rewrite the record body without the "Blocked by #{blocker}" line:
gh issue view {n} --json body -q .body | grep -vE "^Blocked by #{blocker}([^0-9]|$)" | gh issue edit {n} --body-file -
```

A cherry-picked landing reads `unlanded` (different sha) — confirm by hand, then take escape 2.

The dependency check is the same regardless of whether the prerequisite is in-run or out-of-run, or which of the two representations declared it.
