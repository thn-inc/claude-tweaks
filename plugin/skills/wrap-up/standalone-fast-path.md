# Standalone Fast Path — cleanup for a no-record, no-worktree, non-multi-spec run

Referenced by `cleanup-procedures.md`'s own text (#797) as an alternative to reading
`cleanup-procedures-execution.md` in full at Phase 4's execution step, for the one run shape
that structurally can never need most of that file's content.

## Applicability

All three must hold for this run:

- **No record identity** — Phase 1 (`SKILL.md`'s "Identify the work context") determined
  conversation-based work, not record-based.
- **No worktree strategy** — this run committed directly on the current branch.
- **Not part of a multi-spec run** — `MULTISPEC_REVIEW_DEFER`/`MULTISPEC_PARENT_DIR` are unset.

Under this precondition, cleanup items 1 (record-based), 3 (design wrapper caches), 4 (git
worktree), 5 (record lifecycle), and 7 (issue claim release) can never hold their Condition —
each requires record identity, a worktree, or design-wrapper activity this run by construction
does not have (`cleanup-procedures.md`'s canonical table). Once cleanup planning filters the
list, this run's filtered list can only ever be a subset of **{2 (ledger), 6 (ephemeral dev
server), 8 (pipeline run directory)}**.

**If the filtered list contains anything outside {2, 6, 8}** — the precondition's own assumption
turned out false (a bug in this file, or a run shape this file didn't anticipate) — stop reading
this file and read `cleanup-procedures-execution.md` in full instead, exactly as a non-qualifying
run would. Never partially execute from here in that case.

## What this does NOT shortcut

The Review Console itself — `review-console.md`'s gate/empty-console logic, and, when a real
stop renders, `review-console-interactive.md`'s batch tables, Numbering rules, and Hard
requirements — applies identically regardless of record/worktree/multi-spec status: a queue
write, memory update, upstream-feedback proposal, or skill/doc/journey/config update can surface
on any run shape. Read those files normally; nothing here duplicates or replaces them. This
file's only scope is Phase 4's **cleanup execution** step, for the narrow item set above.

## Cleanup execution

**Item 2 (ledger)** — delete via `/ledger`'s delete operation, only after Phase 3's ledger gate
confirmed zero open items. Already "simple enough to execute inline" per
`cleanup-procedures.md` — no further procedure needed (a run-dir ledger is gitignored, so there is nothing to commit; `cleanup-procedures.md`'s Item 2 commit applies only to a tracked `docs/plans/` ledger).

**Item 6 (ephemeral dev server)** — only reachable if this conversation-based, no-worktree run
still triggered a frontend visual review that auto-started a dev server
(`${RUN_DIR}/ephemeral-server.txt` exists). Read `cleanup-procedures-execution.md`'s
"## D. Ephemeral dev server" section for the kill procedure — short (under 1.5 KB), not worth a
separate fragment. If `ephemeral-server.txt` does not exist, this item never applied; skip it.

**Item 8 (pipeline run directory)** — always applies (a run directory exists from Phase 1
onward). Execute directly, the same procedure as `cleanup-procedures-execution.md`'s
"## B. Pipeline run directory" section (both this file and that one cite the same two verbs —
never restate their internals a third way):

1. Verify the Review Console ran and applied/dismissed all staged items.
2. Mark the run terminal: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$RUN_DIR"`
   (idempotent — safe even if nothing closed the run already).
3. Archive it: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "$RUN_DIR"`. This
   archives the tracked `work/` directory and moves every other entry (`config.yml`,
   `decisions.md`, `events.jsonl`, `staged/`, and anything else present) in one call. The verb
   refuses a non-terminal run — step 2 above is what makes that refusal unreachable here.
4. Skipped staged items remain in the archive; they are NOT silently dropped. Do NOT delete the
   run directory outright — the auto-decision log is project history, not disposable pipeline
   state.

Proceed to `SKILL.md`'s "Execute approved actions" step and phase-trace report as normal —
nothing about the report, commit, or verification changes for this run shape.
