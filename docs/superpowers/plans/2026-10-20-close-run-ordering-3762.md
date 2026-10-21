# Close-run ordering in local-merge procedures (#3762) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every check in a local-merge auto-merge procedure that can fail without touching the tree runs before `close-run`. Any failure that can still happen after `close-run` re-stamps the run's worktree assignment before the fallback renders.

**Architecture:** This is a prose-only change to three skill procedures, with no code change. In each local-merge procedure the order becomes:
1. Read `{worktree-path}`/`{branch}`/`{integration-branch}` (the read moves ahead of `close-run`).
2. One **pre-merge checks** call from the main checkout: branch guard, `compose-subject.js`, and `git merge-tree --write-tree` (no tree mutation).
3. `close-run`.
4. The merge call: branch guard again as the race backstop, then `git merge --no-ff`.
5. Push.

A failure after `close-run` runs `hooks.js record-worktree --run … {worktree-path}`. That re-stamp already writes `{worktree, status: 'active', sessionId}` and so restores the worktree assignment and `active` status `close-run` cleared (`plugin/bin/hooks.js:698`, `plugin/bin/lib/hooks/close-run-state.js`), which is why no `reopen-run` verb is added. One new conformance suite pins the ordering and runs each site's pre-merge-checks fence and re-protect fence against fixture repos.

**Tech Stack:** Markdown skill prose; `node --test`; bash fences executed through `child_process.execFileSync('bash', ['-c', …])`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T173510-spec-3762/work/3762-spec.md`

## Global Constraints

- `grep -rn 'Not fixed here; there is no' plugin/` returns no matches.
- `plugin/skills/dispatch/settle-and-merge.md` is 47434 bytes against RAIL_BYTES 52500 (90% = 47250). Its edit must leave it **≤ 47434 bytes** (`wc -c`).
- Keep these existing pins green, without editing those test files:
  - `tests/auto-merge-short-circuit-verdict-backstop.test.js`:
    - regex ``local-merge`:\*\* run the Verdict backstop above first[\s\S]{0,300}?before merging, clear this run's worktree``
    - the literal `git merge --no-ff {branch} -F "{subject-dir}/message.txt"` in the short-circuit file
  - `tests/auto-merge-short-circuit-dispatch-call.test.js`: ``the branch guard aborts[\s\S]{0,200}?fall back to rendering the console normally``
  - `tests/merge-subject-composer-conformance.test.js`, in all three sites:
    - `LOCAL_COMPOSER_CALL` (composer line ends `--range {x}...{y} --out-dir "{subject-dir}" || exit 1` + newline)
    - `LOCAL_MERGE_FORM`
    - the sentence ``{subject-dir}` resolves per `_shared/pr-first-merge.md` Step 3``
- Each site keeps exactly one `bin/hooks.js" close-run --run` command occurrence.
- Bash fences stay plain enough for the worktree guard: no `&&`-chained merge-then-push. Push stays its own call.
- Commits: `{Verb} {what} — {detail}` + `refs #3762` + the `Claude-Session:` trailer. Stage by explicit path.

Waived AC4.1: the full suite runs once, centrally, at /claude-tweaks:build Common Step 5 through bin/verify.js — never per task.

## Review Focus

1. `git merge-tree` on a ref it cannot merge: the pre-check must abort, not merge. Probed on git 2.56 in a scratch repo (2026-10-20):
   - clean → exit 0, prints the tree OID
   - conflict → exit 1, prints the OID, the conflicted path, and a `CONFLICT (content)` line
   - unknown ref → **also exit 1** (`merge-tree: nope - not something we can merge`)
   - `git status --porcelain` empty after all three, so the tree is untouched

   Pinned in Task 1's "unknown branch" case.
2. A conflict appears only at the real merge (race after the pre-check). The fallback must re-stamp before rendering. Pinned by the re-protect fence test in each task.
3. The re-stamp itself fails (run dir archived underneath). The prose must say a non-`worktree recorded` line is logged, never silently ignored. Pinned in Task 1 by a text assertion on each site's fallback.
4. A pre-check abort happens before `close-run`. The prose must not tell the agent to re-stamp there, since nothing was closed. Pinned in Task 1 by the ordering check (the re-stamp fence comes after the merge line).
5. A frozen pre-change excerpt (close-run first) must fail the ordering check. Go-red guard in Task 1.

---

### Task 1: Conformance suite + `wrap-up/auto-merge-short-circuit.md`

**Files:**
- Create: `tests/local-merge-close-run-ordering.test.js`
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md:187-191` (Fail-safe sentence), `:237-325` (local-merge branch through the failure paragraph)

**Interfaces:**
- Produces, in the test file:
  - `SITES`: an array of `{ label, file, vars }`. `vars` maps each `{placeholder}` and `$RUN_DIR`-style name to a fixture value.
  - `checkOrdering(text) -> string[]`: a list of ordering errors, empty when ordered.
  - `extractFence(text, needle) -> string`: the body of the unique ```` ```bash ```` fence containing `needle`.
  - `runFence(body, { cwd, env }) -> { code, stdout, stderr }`.
  - Tasks 2 and 3 append one `SITES` entry each and add nothing else.

- [ ] **Step 1: Write the failing test file (covers AC1.1, AC2.1, AC3.1).**

`checkOrdering(text)` finds these indices in collapsed text:
- `W`: the worktree-read line (`run-state.json').worktree`). Optional; settle-and-merge has none.
- `P`: the fence containing `git merge-tree --write-tree`.
- `C`: the single `bin/hooks.js" close-run --run`.
- `M`: `git merge --no-ff`.
- `R`: the first `bin/hooks.js" record-worktree --run` after `M`.

It returns an error for each of:
- `P` missing
- `C` count ≠ 1
- `!(P < C < M < R)`
- `W > C`

Tests, all looping over `SITES`:
- `${label}: pre-merge checks, close-run, merge, re-protect appear in that order` → `checkOrdering(live) === []`.
- `go-red: the frozen pre-change excerpt fails the ordering check`. Use a `PRE_CHANGE` const copied verbatim from the current short-circuit lines 237-242 + 283-289, where close-run precedes the guard. Assert `checkOrdering(PRE_CHANGE).length > 0`.
- `${label}: the pre-merge checks fence contains no close-run and no git merge --no-ff`.
- `${label}: pre-merge checks fence, run against a fixture repo`. Fixture:
  - `git init -b main`, commit `a.txt`, branch `feat` adding `b.txt`.
  - `CLAUDE_PLUGIN_ROOT` points at a temp dir whose `bin/compose-subject.js` stub writes `<--out-dir>/message.txt` and exits `process.env.STUB_EXIT || 0`.
  - A run-state.json fixture `{worktree:'/wt', status:'active'}` is checked unchanged after every case.

  Cases:
  - clean → `code === 0`, and `message.txt` exists
  - main checkout on `other` → `code === 1`, stderr matches `/Abort, do not merge/`
  - `feat` and `main` both edit `a.txt` line 1 → `code !== 0`
  - `STUB_EXIT=1` → `code !== 0`
  - branch var `nope` (unknown ref) → `code !== 0`
- `${label}: the re-protect fence restores the worktree assignment after close-run`. Fixture: a tmp project with `git init`, run dir `.claude-tweaks/pipelines/2026-10-20T000000-spec-1/` with an empty `decisions.md`.
  - Run real `plugin/bin/hooks.js record-worktree --run`, then `close-run --run`, and assert `worktree === null` and `status === 'clean'`.
  - Run the extracted re-protect fence with the real plugin root.
  - Assert `worktree === <fixture wt>` and `status === 'active'`. Follow `tests/hooks-dispatcher.test.js:24-55` for env (`PIPELINE_RUN_DIR: ''`, `CT_HOOKS_TEST_MODE: '1'`) and fixture layout.
- `${label}: the fallback logs a re-stamp that does not print "worktree recorded"`. Text assertion: within 600 chars after `R`, the prose contains `worktree recorded`.
- `no plugin/ file still carries "Not fixed here; there is no"`. Walk `plugin/` with `fs.readdirSync(…, { recursive: true })`, `.md` files only.

`SITES` for this task has one entry, with label `auto-merge-short-circuit.md` and vars:
- `integration-branch: main`
- `branch: feat`
- `issue: 1`
- `tag: fast-lane`
- `subject-dir: <tmp>`
- `worktree-path: <fixture wt>`
- `RUN_DIR`: the run dir, passed as env

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/local-merge-close-run-ordering.test.js`
Expected: FAIL. The ordering test fails, the pre-merge-checks fence is not found, and the residual sentence is still present.

- [ ] **Step 3: Rewrite the short-circuit's local-merge branch.**

Order:
1. Verdict backstop sentence. Keep: "Then read the values and run the pre-merge checks below; only once both succeed, before merging, clear this run's worktree assignment …". It must stay within 300 chars of the opener.
2. The existing values block (unchanged commands), now ahead of `close-run`.
3. **Pre-merge checks — from the main checkout, nothing mutated.** One fence:
   - the existing guard
   - the existing composer line
   - `git merge-tree --write-tree --name-only {integration-branch} {branch} || exit 1`

   Add one sentence: any non-zero exit (a predicted conflict, or a ref it cannot merge) aborts, and the check never touches the tree.

   **Deictic re-resolution (plan-authoring check):** after the reorder, re-read every "above"/"below"/"the push below"/"two-call shape" reference in the moved blocks and in the text they move past, and fix each one in this same edit. For example, "Same two-call shape as `dispatch/settle-and-merge.md`'s local-merge fallback" now describes pre-merge checks → close-run → merge → push.
4. The `close-run` fence and its E1/worktree-always paragraphs (moved here).
5. **Merge — from the main checkout.** Fence: the guard again (one sentence calling it the race backstop), then `git merge --no-ff {branch} -F "{subject-dir}/message.txt"`.
6. The push call (unchanged).

Replace the failure paragraph with two cases:
- **A pre-merge check fails:** nothing was merged and the run was not closed. Fall back to rendering the console normally. It must keep `the branch guard aborts … fall back to rendering the console normally` within 200 chars.
- **The merge-call guard aborts or `git merge` fails:** `git merge --abort` if a merge is in progress, then re-protect with a fence `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "$RUN_DIR" "{worktree-path}"`. Verify it prints `claude-tweaks: worktree recorded for …`; log any other line. Then fall back to the console.

Delete the "One accepted residual … Not fixed here" sentences. In the Fail-safe sentence (lines 187-191), replace "though `close-run` has already run by then (the accepted residual in the merge-failure paragraph below)" with: the guard is a pre-merge check, so the run is still open when it aborts.

- [ ] **Step 4: Run the new suite and the pinned suites**

Run: `node --test tests/local-merge-close-run-ordering.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js tests/auto-merge-short-circuit-dispatch-call.test.js tests/merge-subject-composer-conformance.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit** both files: `Run local-merge pre-merge checks before close-run in the auto-merge short-circuit — refs #3762`.

### Task 2: `dispatch/settle-and-merge.md` local-merge fallback

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md:377-429`
- Modify: `tests/local-merge-close-run-ordering.test.js` (add one `SITES` entry)

**Interfaces:**
- Consumes: Task 1's `SITES`/`checkOrdering`/`extractFence`/`runFence`.

- [ ] **Step 1: Add the `SITES` entry** with label `settle-and-merge.md` and vars:
  - `integration-branch: main`
  - `branch: feat`
  - `issue: 1`
  - `second-issue: 2`
  - `subject-dir`
  - `group-worktree: <fixture wt>`
  - `run-dir: <run dir>`

  The composer here uses `--tag auto-merge`, so no `tag` var is needed. No `W` read applies: the worktree is session-held.

- [ ] **Step 2: Run it to verify the new entry fails**

Run: `node --test tests/local-merge-close-run-ordering.test.js`
Expected: FAIL on the `settle-and-merge.md` cases only.

- [ ] **Step 3: Reorder the section** the same way as Task 1 Step 3:
  - The integration-branch read first.
  - Pre-merge checks fence: guard + composer (`{issue} {second-issue} --tag auto-merge`) + `git merge-tree … {integration-branch} {branch} || exit 1`.
  - Then `close-run`.
  - Then the merge fence (guard + `git merge`).
  - Then the push.

  In the failure paragraph (line 429):
  - A pre-merge-check failure parks with the run still open.
  - A post-`close-run` failure runs `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{group-worktree}"` (verify `worktree recorded`) before parking.

  Delete the "One accepted residual … Not fixed here" sentences. Pay for the added fences by tightening this section's existing prose, so `wc -c` ≤ 47434.

- [ ] **Step 4: Verify**

Run: `node --test tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js tests/dispatch-settle-and-merge-lazy-read.test.js`
Expected: PASS. Then run `wc -c plugin/skills/dispatch/settle-and-merge.md` and expect ≤ 47434.

- [ ] **Step 5: Commit**: `Run local-merge pre-merge checks before close-run in dispatch's settle-and-merge fallback — refs #3762`.

### Task 3: `_shared/local-merge-auto-finish.md`

**Files:**
- Modify: `plugin/skills/_shared/local-merge-auto-finish.md:66-208`
- Modify: `tests/local-merge-close-run-ordering.test.js` (add one `SITES` entry)

**Interfaces:**
- Consumes: Task 1's helpers.

- [ ] **Step 1: Add the `SITES` entry** with label `local-merge-auto-finish.md` and vars:
  - `base-branch: main`
  - `feature-branch: feat`
  - `issue: 1`
  - `subject-dir`
  - `worktree-path: <fixture wt>`
  - `RUN_DIR`: the run dir, via env

  The composer uses `--tag auto-finish`.

- [ ] **Step 2: Run it to verify the new entry fails**

Run: `node --test tests/local-merge-close-run-ordering.test.js`
Expected: FAIL on the `local-merge-auto-finish.md` cases only.

- [ ] **Step 3: Renumber the procedure to this order:**
  1. resolve base branch
  2. read worktree path + feature branch (today's step 3, unchanged; it now runs while `worktree` is still set)
  3. pre-merge checks fence: guard + composer + `git merge-tree … {base-branch} {feature-branch} || exit 1`. Keep the existing "On abort" and "On a composer failure" text here and add predicted conflict. All of these park with the run still open.
  4. `close-run`, with the fail-open note kept
  5. merge fence (guard + `git merge`), keeping "On any failure"
  6. verify
  7. push
  8. log merged

  The Park branch replaces the "step 2's `close-run` already fired … re-run `record-worktree`/`close-run`'s counterpart" paragraph with this rule: a park reached after step 4 first runs `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "$RUN_DIR" "{worktree-path}"` as a fence and verifies `worktree recorded`. That covers a merge failure, a red merged-result verification, and a push failure. A park reached from step 3 runs no re-stamp.

  Renumbering completeness (plan-authoring check): search in three forms and repoint every hit to the new numbering.
  1. Number form: `git grep -n -i -E "local-merge-auto-finish[^ ]*'?s? step [0-9]" -- plugin docs tests`
  2. In-file self-references: `grep -n -i -E "step [0-9]" plugin/skills/_shared/local-merge-auto-finish.md`
  3. Cardinal form: `git grep -n -i -E "(six|seven|eight)[- ]step" -- plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/wrap-up/cleanup-procedures-execution.md`

- [ ] **Step 4: Verify**

Run: `node --test tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js`
Expected: PASS. Then run `git grep -n "Not fixed here; there is no" -- plugin/` and expect no output (exit 1).

- [ ] **Step 5: Commit** the procedure file, any repointed citation files, and the test: `Run pre-merge checks before close-run in local-merge-auto-finish and re-stamp on a late park — refs #3762`.
