# worktree-merge close-run ordering (#3809) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugin/skills/flow/worktree-merge.md`'s `local-merge` reconciliation closes a branch's run only after that branch's pre-merge checks pass, leaves skipped and aborted branches' runs untouched, and re-stamps a run after any failure that follows its `close-run`.

**Architecture:** Rewrite the `local-merge` half of the Merge Reconciliation section into the per-branch sequence `_shared/local-merge-auto-finish.md` already uses (read worktree → pre-merge fence → close-run → merge → re-protect on failure), adapted for several runs and a human at the conflict menu. Pin it by adding `worktree-merge.md` as a fourth `SITES` entry in the existing #3762 conformance suite, plus one text test for the skip/abort bullets.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T060308-spec-3809/work/3809-spec.md`

Scope keywords: Skip this branch, Abort remaining merges, closes only the newest run

## Global Constraints

- Commit style `{Verb} {what} — {detail}`, body line `refs #3809` (never `closes`/`fixes`), last line `Claude-Session: https://claude.ai/code/session_01VNe8TogqK1hEawnDY63oP1`.
- Stage files by explicit path; never `git stash`, `git reset`, or force.
- Read `docs/skill-authoring.md` before editing `plugin/skills/flow/worktree-merge.md`.
- Leave the `pr-first` paragraph (`worktree-merge.md` lines 28-38) byte-identical.
- Run only the named suites inside the task; the full suite runs centrally afterwards.

## Review Focus

Prose-only paths no test executes — the reviewer checks each against the new text:

1. A branch with no matching run dir (step 1 finds none): it still merges, and no `close-run` or re-stamp is attempted for it.
2. "Resolve now" when this session also owns a skipped branch's still-active run: E1 resolves the newest run this session owns, so the scratch-worktree commit can be denied naming that other run — the bullet says what to do.
3. A push failure after several merges: every run closed in this reconciliation is re-stamped, the local merge commits stay, and nothing is retried automatically.
4. A re-stamp whose run dir was archived underneath it: `record-worktree` prints something other than `worktree recorded`, and that line is logged, not dropped.
5. A composer failure or pre-check error on one branch: that branch is skipped with its run untouched; the remaining branches still reconcile.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 — no `close-run` instruction precedes a pre-merge check for the same branch (pinned by a test) | `worktree-merge.md: pre-merge checks, close-run, merge, re-protect appear in that order` + its go-red permutation (SITES loop) |
| AC2.1 — a skipped or aborted branch's run keeps its worktree assignment and `active` status (the procedure states it; a fence or text test pins it) | step 5's Skip / Abort bullets (Step 3 text), pinned by `AC2.1: worktree-merge.md's Skip and Abort bullets keep the run` + its go-red control |
| AC3.1 — any failure after a run was closed re-stamps it with `record-worktree --run` and logs a re-stamp that did not print `worktree recorded` | `worktree-merge.md: the re-protect fence restores the worktree assignment after close-run` + `…the fallback logs a re-stamp that does not print "worktree recorded"` (SITES loop) |

**Authoring self-check (inline self-consistency, go-red control).** Step 1's test and Step 3's text, placeholders resolved from the current file, were run together in a scratch copy of `plugin/` + `tests/` before dispatch: the four Step 4 suites, 92 tests, 0 fail. The same `local-merge-close-run-ordering` suite against the unchanged `worktree-merge.md`: 9 fail (the 8 `worktree-merge.md:` cases + `AC2.1`). Moved-prose pins: `git grep -F` over `tests/` for thirteen distinctive phrases from the rewritten blocks found none beyond the three suites Step 4 runs. The step-1 read fence was run once read-only against this run's own run dir and printed its worktree and branch.

---

### Task 1: Per-branch close-run ordering in worktree-merge.md, pinned

**Files:**
- Modify: `plugin/skills/flow/worktree-merge.md:40-106` (the `local-merge` paragraph through the Post-Merge Summary table)
- Test: `tests/local-merge-close-run-ordering.test.js` (SITES entry, header comment, one new test)

**Interfaces:**
- Consumes: the suite's existing helpers `collapse`, `posix`, `readText`, `ROOT`, `SUBJECT_DIR`, `WORKTREE`, and the per-site loop (`checkOrdering`, `extractFence`, `runFence`).
- Produces: a fourth `SITES` entry; `function skipAbortKeepsRun(text): string[]` (empty array = pass).

- [ ] **Step 1: Write the failing tests**

In `tests/local-merge-close-run-ordering.test.js`:

1. Header comment: add one line after the first sentence — `#3809 adds the human-present multi-run reconciliation (flow/worktree-merge.md): each branch's run closes only after that branch's own pre-merge checks.`
2. Append a fourth `SITES` entry:

```js
  {
    label: 'worktree-merge.md',
    file: 'plugin/skills/flow/worktree-merge.md',
    readsWorktree: true,
    logNeedle: 'log any other line',
    worktreeVar: 'worktree-path',
    vars: {
      'base-branch': 'main',
      branch: 'feat',
      issue: '1',
      'second-issue': '2',
      'subject-dir': posix(SUBJECT_DIR),
      'worktree-path': posix(WORKTREE),
    },
  },
```

3. After the `for (const site of SITES)` loop, add the AC2.1 test. Positive and control share one function (go-red control check):

```js
const KEEPS_RUN = 'keeps its worktree assignment and `active` status';
function skipAbortKeepsRun(text) {
  const flat = collapse(text);
  const errors = [];
  for (const label of ['**Skip this branch** →', '**Abort remaining merges** →']) {
    const at = flat.indexOf(label);
    if (at < 0) { errors.push(`no ${label} bullet`); continue; }
    if (!flat.slice(at, at + 300).includes(KEEPS_RUN)) errors.push(`${label} does not keep its run`);
  }
  return errors;
}

test("AC2.1: worktree-merge.md's Skip and Abort bullets keep the run", () => {
  const live = readText(path.join(ROOT, 'plugin/skills/flow/worktree-merge.md'));
  assert.deepStrictEqual(skipAbortKeepsRun(live), []);
  const flat = collapse(live);
  const skipAt = flat.indexOf('**Skip this branch** →');
  const mutated = flat.slice(0, skipAt) + flat.slice(skipAt).replace(KEEPS_RUN, 'is closed');
  assert.ok(skipAbortKeepsRun(mutated).some((e) => /Skip this branch/.test(e)), 'go-red: a Skip bullet that closes the run must fail');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/local-merge-close-run-ordering.test.js`
Expected: FAIL — the `worktree-merge.md:` cases (no `git merge-tree --write-tree` fence, no re-protect fence, close-run is inline prose not a fence) and `AC2.1` (no `**Skip this branch** →` bullet); the three existing sites still pass.

- [ ] **Step 3: Rewrite the `local-merge` half of `plugin/skills/flow/worktree-merge.md`**

Replace from line 42 ("Before the merge/finish handoff begins…") through the end of the Post-Merge Summary table (line 106) with the text below; keep line 40, `### Merge Order`'s two items, and everything from `## Next Actions` on unchanged. The fences and the quoted clauses are pinned by the tests — copy them exactly; the other prose may be tightened if meaning is kept.

````markdown
Close each branch's run only when that branch is about to merge — never every run up front. `close-run` clears a run's worktree assignment and `active` status, the teardown protection an unmerged branch still needs, so a branch that is skipped, aborted, or stopped by a failed check keeps it. Only the runs of the branches this reconciliation merges are ever closed — never another session's unrelated run.

The working-directory hook (E1) gates `git commit` and `git push`, not `git merge`, so the merge itself needs nothing closed first. It matters on the conflict path: resolving a conflict ends in a commit, which E1 checks against the newest run this session owns — so a branch's run is closed before its conflict is resolved (step 5 below).

If the project also has `worktree-always: true` set (`.claude-tweaks/policy.yml`), a second, run-independent gate (`checkWorktreeRequired` in `pre-tool-use.js`) still applies, and `close-run` does nothing for it — it never reads run state, only whether the target is already inside a linked worktree. For exactly what that gate intercepts, read the `worktree-always` coverage block in `_shared/policy-schema-coverage.md`; it is the canonical list and this file deliberately does not restate it.

{line 46 — "Two consequences for the sequence below. …" — unchanged}

**Shell state does not survive between separate Bash calls** — read every value first and substitute it literally into the next call.

### Merge Order

{unchanged}

### Merge Procedure (`local-merge` only — `pr-first` uses `_shared/pr-first-merge.md` per above)

For each completed branch (in order):

1. **Find the branch's run and read its worktree — before anything closes it.** `close-run` nulls `run-state.json`'s `worktree` field, so read it now. `{run-dir}` is the run directory under `.claude-tweaks/pipelines/` whose recorded worktree has `{branch}` checked out — run this pair per candidate run dir and keep the one whose second line prints `{branch}`:

   ```bash
   node -e "const w=require('{run-dir}/run-state.json').worktree; if(!w){console.error('claude-tweaks: run-state.json has no worktree field — cannot resolve the worktree to merge'); process.exit(1);} console.log(w)"   # -> {worktree-path}
   git -C "{worktree-path}" branch --show-current                       # -> must print {branch}
   ```

   No run dir matches → this branch has no run to protect: run steps 2 and 4 for it, with no `close-run` and no re-protect.

2. **Pre-merge checks, from the main checkout — nothing mutated.** Verify the main checkout is on `{base-branch}` — a concurrent session may have switched it underfoot (`[IL-05]`) — then compose the subject and predict the merge. For record-derived runs (any materialized file under `{run-dir}/work/` on the branch carries a `record:` field in its header — see `materialize.md`), the merge commit message carries the closing keywords — one line per issue (see "Close-via-merge" in `_shared/issue-claims.md`):

   ```bash
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "{base-branch}" ]; then
     echo "Main checkout is on '$CURRENT', not '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
     exit 1
   fi
   node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} {second-issue} --range {base-branch}...{branch} --out-dir "{subject-dir}" || exit 1
   git merge-tree --write-tree --name-only {base-branch} {branch} || exit 1
   ```

   `{subject-dir}` resolves per `_shared/pr-first-merge.md` Step 3. A branch with no record drops the composer line here and the `-F` in step 4. The issues close when the user pushes the base branch to the default remote branch. `git merge-tree` writes only unreferenced objects — never the working tree, the index, or a ref.

   Nothing is closed yet, so every way this fence stops leaves the run exactly as it was:
   - **The branch guard aborted** — stop the reconciliation; the checkout moved underneath it.
   - **The composer failed** (nothing merged): record the composer's stderr and stop the reconciliation for this branch — {the rest of today's step 2 composer-failure sentence, verbatim from "a record with no resolvable Type" to "in this fence."}
   - **A predicted conflict** — a `CONFLICT` line on `git merge-tree`'s stdout: go to step 5. An error on stderr with no `CONFLICT` line means git could not run the pre-check (git older than 2.38, an unknown ref): record it and skip this branch.

3. **Close this branch's run — only now, once its pre-merge checks passed**, as its own Bash call:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"
   ```

   Only this branch's run, never a sweep of `.claude-tweaks/pipelines/*/`. Fail-open: it never blocks the merge below.

4. **Merge, from the main checkout.** The guard repeats step 2's check as the race backstop:

   ```bash
   CURRENT=$(git branch --show-current)
   if [ "$CURRENT" != "{base-branch}" ]; then
     echo "Main checkout is on '$CURRENT', not '{base-branch}' — a concurrent session switched it. Abort, do not merge." >&2
     exit 1
   fi
   git merge --no-ff {branch} -F "{subject-dir}/message.txt"
   ```

   - **Merged** — record the merge commit (`git rev-parse {base-branch}`) and continue to the next branch.
   - **Failed** — if a `MERGE_HEAD` exists, run `git merge --abort`. Then re-protect this branch's run (**Re-protect** below). A conflict goes to step 5; any other failure is recorded as `merge aborted: {first stderr line}` and the branch is skipped.

5. **On a conflict** (predicted at step 2, or hit at step 4) — present the conflicts:
   {today's conflict-file block and AskUserQuestion call with its three options, unchanged}

   - **Resolve now** → this branch's run is closed first: the resolution ends in a commit E1 checks against this session's newest run. Run step 3's fence if it has not run for this branch yet. If E1 still denies the commit naming another branch's run, that run is a skipped branch this session owns — close it with step 3's fence too, and re-protect it once this fast-forward lands. {today's "If `worktree-always: true` is set, don't resolve…" paragraph, the `git merge --ff-only <sha>` fence, and the `<sha>`/teardown paragraph, unchanged — it ends "…surfaces inside the run's own real worktree, not the main checkout."} Once the fast-forward lands, record the merge commit and continue. If the resolution is abandoned before it lands, re-protect this branch's run.
   - **Skip this branch** → this branch's run keeps its worktree assignment and `active` status: never closed when step 2 predicted the conflict, re-protected already when step 4 hit it. Merge the remaining branches, then return to this one from step 1.
   - **Abort remaining merges** → stop. This branch's run, and every remaining branch's, keeps its worktree assignment and `active` status — none is closed, and a run step 4 closed was re-protected already. Report the branches left.

6. **Push the base branch once, after every branch is merged or skipped** — from inside a linked worktree (the `worktree-always` gate) and as its own Bash call: `git -C "{worktree-path}" push origin {base-branch}`, with any reconciled branch's worktree that still exists. **On push failure**, every merge in this reconciliation is local-only: re-protect every run step 3 closed, once per run, leave the local merge commits for a human to push, and report it. Once the base branch is pushed, run `_shared/pr-first-merge-post-merge.md` Step 4.1 against each recorded merge commit with `--ref {integration-branch}` — same outcomes and staged file, closing-report line only (no PR to comment on).

### Re-protect

After any failure that follows a branch's `close-run` — a step 4 merge failure, a step 5 resolution abandoned before it lands, or a step 6 push failure — re-stamp that branch's run with the `{worktree-path}` step 1 read (`run-state.json` no longer holds it), one Bash call per run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"
```

`record-worktree` restores the worktree assignment and `active` status. It prints `claude-tweaks: worktree recorded for …` when it worked; any other line (the run dir may have been archived underneath) is not ignored — log any other line to that run's `decisions.md` and name it in the Post-Merge Summary:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status AUTO --section "/flow" --step "worktree-merge reconciliation" --text 'Re-stamp of {branch} after {failure} did not print worktree recorded: {output line}' --reversibility high
```

### Post-Merge Summary

```markdown
### Merge Results

| Branch | Spec | Merge Status |
|--------|------|-------------|
| {branch} | {spec} | Merged cleanly |
| {branch} | {spec} | Merged with conflict resolution |
| {branch} | {spec} | Skipped (conflict) — run still active |
| {branch} | {spec} | Merge failed — run re-protected |
| {branch} | {spec} | Merged locally, push failed — run re-protected |
| {branch} | {spec} | Skipped (pipeline failed) |
```
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/local-merge-close-run-ordering.test.js tests/merge-subject-composer-conformance.test.js tests/pr-first-merge.test.js tests/merge-verification-gate-conformance.test.js`
Expected: PASS, every case. In particular every `worktree-merge.md:` case and `AC2.1` pass, and the composer suite's `worktree-merge.md: the --no-ff merge sources -m from the composer` stays green.

- [ ] **Step 5: Record the go-red proof**

Step 2's run is the pre-change proof: it ran the new `SITES` entry and the AC2.1 test against the unchanged `worktree-merge.md`. Quote its `not ok` lines for the `worktree-merge.md:` cases and `AC2.1` in the task report (raw output, not a summary) — 9 expected: the 8 per-site cases plus AC2.1.

- [ ] **Step 6: Renumbering sweep**

The Merge Procedure grows from four steps to six plus a `### Re-protect` subsection. Search for references to its old numbering in three forms and fix any hit:
- `git grep -n "worktree-merge.md[^)]*step [0-9]" -- plugin docs tests`
- `git grep -n -i "merge procedure step\|conflict branch of the Merge Procedure" -- plugin docs`
- `git grep -n -i "four steps\|step 4 of the merge" -- plugin/skills/flow`
Expected: no reference to a renumbered step outside `worktree-merge.md` itself (line 46's "conflict branch of the Merge Procedure" still resolves — step 5 is that branch).

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/flow/worktree-merge.md tests/local-merge-close-run-ordering.test.js
git commit -m "Close each worktree-merge run only before its own merge — skip, abort and late failures keep the run protected" -m "flow/worktree-merge.md's local-merge reconciliation closed every non-clean run before the first merge, so a skipped, aborted or failed branch lost its worktree assignment while unmerged. Each branch now reads its worktree, runs the pre-merge fence (guard, composer, git merge-tree), and only then closes its own run; a merge, abandoned resolution or push failure after close-run re-stamps it with record-worktree --run and logs a re-stamp that did not print worktree recorded. Pinned as a fourth SITES entry plus an AC2.1 skip/abort text test. refs #3809" -m "Claude-Session: https://claude.ai/code/session_01VNe8TogqK1hEawnDY63oP1"
```
