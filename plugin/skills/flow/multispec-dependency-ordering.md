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

If record 159 depends on record 142 (not in the run list) — via `blocked-by:` — check 142's status:
- Status `complete` → fine, dependency satisfied
- Status `pending` or `in-progress` → hard fail with "159 depends on 142 which is not complete and not in this run"

The dependency check is the same regardless of whether the prerequisite is in-run or out-of-run, or which of the two representations declared it.
