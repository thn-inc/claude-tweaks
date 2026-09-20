---
files:
  - plugin/bin/lib/wrap-up/engine-verify.js
  - plugin/bin/wrap-up-engine.js
  - plugin/skills/wrap-up/execution-and-verification.md
  - plugin/skills/wrap-up/review-console.md
---

# Verify a Wrap-Up Run's Closure Checklist Through wrap-up-engine.js verify

**Persona:** the agent session running `/claude-tweaks:wrap-up` (an internal tooling user), at the point `execution-and-verification.md`'s "Verify execution" section gates the closure line — previously a ~9-item hand-run checklist (`ls` globs, `git log --grep`, `gh issue view`), now a single deterministic verb call.
**Goal:** get a verbatim pass/fail/skip/unknown table proving every closure condition actually landed, and BLOCK the closure line rather than emit it when one didn't — replacing "I ran the checks" narration with evidence.
**Entry point:** the wrap-up run directory (`$PIPELINE_RUN_DIR`) exists, its cleanup/curation steps have executed (or been explicitly deferred), and `execution-and-verification.md` reaches the "Verify execution" section.
**Success state:** a rendered markdown table with one row per check, exit code `0`, and the closure line emitted; or exit code `3` with `BLOCKED — {failing check row}` and the closure line withheld.

## Steps

### 1. Run the verb against the run directory
- **URL:** `node plugin/bin/wrap-up-engine.js verify --run-dir "$PIPELINE_RUN_DIR" --base {base-ref}`
- **Action:** Invoke it exactly as `execution-and-verification.md` instructs, once cleanup has run.
- **Should feel:** One command replacing a hand-run checklist — no more trusting the model's own narration that it checked `git log`, `gh issue view`, and a handful of `ls` globs.
- **Should understand:** `--run-dir` accepts either the run's original path or (the normal case — archival precedes verification) its archived copy under `.claude-tweaks/pipelines/archive/`; the verb resolves both. `--base` is consumed only by `carrier-commit` and `reference-repairs`, the two checks that walk `{base}..HEAD`. `plans-ledger`/`design-caches` scan the checkout the verb is actually invoked FROM (`cwd`, defaulting to `process.cwd()`), never always the main checkout — record #1222 fixed a structural blind spot where a worktree-local leftover (an execution plan, an SDD ledger workspace) was invisible to a scan pinned to `repoRoot`. This mostly matters when the verb runs against a still-live worktree — a `MULTISPEC_REVIEW_DEFER=1` run, or a standalone/manual invocation from inside one — since the mainline single-spec `worktree`/`pr-first` flow runs cleanup (including worktree removal) before verify, so `cwd` has usually already collapsed back to the main checkout by the time these two checks execute there.
- **Red flags:** Any check silently reporting `pass` for a condition that plainly doesn't hold on disk — the exact failure class three separate fix rounds in this feature's own build caught (a match-key bug, a vacuous slug match, an ISO-timestamp-stripping regression) before this journey's own files reached the state they're in now, and the class record #1222 caught later (a worktree-local leftover invisible to a `repoRoot`-only scan).

### 2. Read the table's four distinct states
- **URL:** the same command's stdout
- **Action:** Inspect a row of each kind — `pass`, `fail`, `skip (reason)`, `unknown (reason)`.
- **Should feel:** Each state means something different and none of them silently substitute for another.
- **Should understand:** `pass`/`skip`/`unknown` never change the exit code — only `fail` does (or a `null` run dir, which forces exit 3 even though every row renders `unknown`). `skip` means a real, known condition why the check doesn't apply here (e.g. `deferred to parent console`, `nothing recorded`). `unknown` means the check genuinely could not run (`gh` absent, `verify-expectations.json` missing) — visible, but not blocking, matching how the old checklist surfaced an un-runnable check rather than treating it as a failed action.
- **Red flags:** A multi-line or pipe-containing detail string breaking the table's column count (the renderer sanitizes this — collapsing whitespace and escaping `|` — so a broken table here means the sanitizer itself regressed).

### 3. Trace a memory or upstream row back to the console that recorded it
- **URL:** `$PIPELINE_RUN_DIR/verify-expectations.json`, written by `review-console.md`'s "On approval" step 10
- **Action:** Open the expectations file the Review Console wrote when it resolved this run's `M#`/`U#` items, and match its `memory`/`upstream` arrays against the table's `memory-updates` and `upstream-feedback` rows.
- **Should feel:** The two checks covering writes that land *outside* the repository rest on something the console actually recorded at resolution time — not on the verb re-deriving intent afterwards from state it cannot see.
- **Should understand:** An absent file and an empty one are distinct states, and the row text says which one happened: no file renders `unknown (expectations file missing)` — the console's own write step never ran — while `{"memory": [], "upstream": []}` renders `skip (nothing recorded)`, meaning it ran and had nothing to record. The console writes the file on every path that reaches a resolution, the empty-console fast path included. Under `MULTISPEC_REVIEW_DEFER=1` it writes empty arrays plus a `deferred` list naming the cleanup items the parent console still owns; three of those names (`design-caches`, `worktree`, `run-dir-archival`) turn their rows into `skip (deferred to parent console)`, and the per-spec `memory-updates`/`upstream-feedback` rows read `skip (nothing recorded)` because this spec's own `M#`/`U#` resolution never ran — an accepted limit of per-spec verification under defer, not a clean bill of health.
- **Red flags:** `memory-updates` or `upstream-feedback` reporting `pass` when no expectations file exists at all; an absent file rendering as `skip (nothing recorded)`, which would erase the difference between "the console never wrote it" and "the console had nothing to write".

### 4. Hit a real fail row and watch closure get blocked
- **URL:** `execution-and-verification.md`'s Verify execution section, downstream of Step 1's table
- **Action:** Run the verb against a run where one approved cleanup action didn't actually execute (e.g. the worktree is still listed, or the archive path is missing).
- **Should feel:** The pipeline stops here, not three steps later when something downstream trips over the half-finished state.
- **Should understand:** Exit code `3` means "surface `BLOCKED — {failing check row, verbatim}` and stop" — never emit the closure line. This is a genuinely new exit code (`0` unchanged, `1`/`2` keep their existing "bad payload"/"malformed invocation" meanings from the verb's sibling `plan`/`record`/`render` commands).
- **Red flags:** The closure line emitting anyway despite a `fail` row in the table; a `BLOCKED` message that doesn't name which check failed.

### 5. Run it with `gh` unavailable
- **URL:** the same command, in an environment with no `gh` on `PATH`
- **Action:** Invoke the verb where `acceptance-labeling` (and any `carrier-commit`/`upstream-feedback` fallback needing `gh`) would otherwise need it.
- **Should feel:** Degrades visibly, never silently — a reader sees exactly which rows the environment couldn't evaluate.
- **Should understand:** The verb is deliberately `gh`-CLI-only (module header states this) — a `gh`-absent row always renders `unknown (gh absent)`, never a silent `pass`. Any MCP-path manual verification stays the skill prose's affair, outside this verb's scope.
- **Red flags:** A `gh`-dependent check reporting `pass` when `gh` never actually ran.

## Origin
- Created during build of #900 (wrap-up verify verb — mechanizes `execution-and-verification.md`'s hand-run closure checklist into a deterministic table), part of the shared #343+#900 `/flow` multi-spec run.
- Related: #343 (prerequisite — fixed the same skill file's circular gate condition on the same branch), #892/#891 (the sibling `bin/verify.js` deterministic-check-runner family — a different subsystem covering type/lint/test checks, not this feature's closure-gate checks).
- Updated for #1222 (`plans-ledger`/`design-caches` switched from scanning `repoRoot` to the verb's own invoking `cwd`, closing record #900 finding #3 — a worktree-local leftover was structurally invisible to a main-checkout-only scan under the default `worktree`/`pr-first` mode).
- Updated for #1841 (`acceptance-labeling`'s parent resolution migrated from `gh issue view --json parent` to GraphQL, since `gh` <2.96 rejects that field — the check's gather failure now actually renders `unknown` for this case, matching Step 2's always-documented `unknown` contract rather than the `fail` the old REST call produced on an incompatible `gh` version; the observable row vocabulary and Step 5's gh-absent behavior are unchanged).
