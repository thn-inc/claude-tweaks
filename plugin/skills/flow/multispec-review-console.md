# Multi-Spec Consolidated Review Console

For multi-spec `/flow` runs in `auto` or `hybrid` mode, the per-spec Wrap-Up Review Consoles (`/wrap-up`'s Phase 4) are **deferred** so the user is not interrupted between specs. After the final spec's wrap-up completes, `/flow` runs **one consolidated Review Console** that aggregates decisions and staged items from every spec in the run.

This preserves the bookend architecture (Manifesto at start, one Review Console at end) even when N > 1 specs run sequentially.

**Scope:** this console belongs to a single `/flow` invocation and never aggregates across multiple invocations. `/claude-tweaks:dispatch` does not consolidate through here across firings or groups — each firing reports its one claimed group's outcome directly (see `dispatch/SKILL.md`'s Reporting section). A dispatched bundle's own `/flow "#A,#B"` call still lands here exactly like any other multi-spec run — this file's job doesn't change, only who aggregates across separate runs does (nobody, now).

## Run directory layout (multi-spec)

For the canonical run-directory layout, `manifest.yml` schema, and the environment variables `/flow` exports to each per-spec invocation (`PIPELINE_RUN_DIR`, `MULTISPEC_REVIEW_DEFER`, `MULTISPEC_PARENT_DIR`, `MULTISPEC_KEEP_GOING`), see `multi-spec.md`.

The single-spec path is unchanged: `PIPELINE_RUN_DIR` points to a top-level run dir, `MULTISPEC_REVIEW_DEFER` is unset.

## When to run the consolidated console

After every spec's pipeline reaches `/wrap-up`'s Phase 4 execution step (or stops at a HARD-GATE failure) AND the multi-spec run is in `auto` or `hybrid` mode:

0. If `MULTISPEC_CURATION_DEFER=1`, run the batch pass first — `multispec-batch-curation.md`. It writes to the parent's `decisions.md`/`staged/`/`engine-state.json`, covered by steps 2-3.
1. Read `manifest.yml` to enumerate per-spec subdirectories, in spec execution order.
2. For each `spec-{N}/`: read `decisions.md` + `staged/` contents (including any `staged/leftover-*.md` queue-write proposals — see Queue writes below) for the prose-aggregated sections (Auto-applied, Pending review, Low-confidence findings, Contested findings, Cleanup actions, Issue closures, Translated briefs, Queue writes, Memory updates, Upstream feedback). This read is unconditional: a spec with no `engine-state.json` (its wrap-up never reached Phase 2 — e.g. it failed before that point) still contributes every prose-aggregated row and a Not run/Failed footer row; it simply contributes nothing to the engine call in step 3 below. ALSO read the parent run dir's own `decisions.md` + `staged/` (Manifesto-created — holds run-level items such as freeform-issue translations and any parent-level leftover proposals). Staged files are written via `bin/stage-item.js` (`_shared/auto-decision-log.md`'s "Staged proposal files" section) — this console is a reader, never a writer, of `staged/`.
3. Invoke the engine for the five engine-rendered sections — Skill updates, Documentation updates, Journey updates, Configuration updates, Reference repairs — using one repeated `--spec-state` flag per spec with an `engine-state.json` present, in the spec execution order from step 1:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" render --section console \
     --spec-state {id1}={path1} --spec-state {id2}={path2} [...] \
     --spec-state batch={parent}/engine-state.json \
     --start-at {n} [--strict]
   ```

   `{id}` is each spec's own id (`157`, `159`, …); `{path}` is that spec's `engine-state.json` path (`spec-{N}/engine-state.json`). `--spec-state batch=...` is present only when step 0's pass ran — `batch` is a reserved id. `{n}` is the next number in this console's global row sequence — see "Numbering rules" below. Insert the command's stdout verbatim into the console response — do not hand-expand it, exactly as `wrap-up/review-console-interactive.md` instructs for its own single-spec call.

   Skip this engine call entirely when no spec has an `engine-state.json` AND no batch pass ran — the five sections are then simply absent, and `{n}`'s only consumer becomes the first prose-aggregated section that follows.

   **If the call exits non-zero for any other reason** (a present-but-malformed `engine-state.json` for one spec aborts the whole invocation before producing any stdout, per `wrap-up-engine.js`'s own fail-loud contract — passing every spec's state in one call means one bad file blocks every spec's engine-rendered sections, not just the bad one's): do not silently omit the five engine-fed sections for the run. Drop only the offending spec's `--spec-state` flag and re-run the call with the remaining specs' flags — the same "engine failure is never permission to skip a row" principle `curation-engine.md` states for the single-spec engine path, applied per-spec here. Note the dropped spec in the console's Not run/Failed footer with the CLI's own error text as the reason.
4. Render the consolidated console (template below): the prose-aggregated sections from step 2's reads, then the engine's verbatim output from step 3 in its own position (see the template), then the remaining prose-aggregated sections in the order "Numbering rules" below states.
5. Apply the user's approval/override
6. Archive the parent run dir — the inline archive action in "On approval" step 9 / "On override" step 7 below (Shared teardown carries no archive row of its own; it reaches archival only inside step 7's `teardown-run`, which calls the same `archiveRunDir` — a second pass is a harmless no-op, per `wrap-up/cleanup-procedures-execution.md` Section C step 5).

In `interactive` mode (auto opted out), the per-spec consoles ran inline as usual — no consolidation step. Skip this entirely. (Default `auto`, `confirm`, and `hybrid` all consolidate.)

If the multi-spec run aborted early (one spec hit a HARD-GATE), still render the consolidated console with whatever was accumulated up to the failure point. Specs that didn't run appear as a row in the "Not run" footer.

## Locating the parent run directory

1. Resolve via `MULTISPEC_PARENT_DIR` env var if set by `/flow`
2. Else find the most recent directory in `.claude-tweaks/pipelines/` whose `spec-slug` is dash-joined with a single `spec-` prefix (e.g., `spec-157-159-160`)
3. Else fall back to interactive single-spec behavior (no consolidation)

## Numbering rules

**Canonical render order.** This is the one place this order is stated — every other reference to it (step 4 above, the template below) points here rather than restating the list: Auto-applied, Pending review, Low-confidence findings, Contested findings, then the five engine-rendered sections in their own position, then Cleanup actions, Issue closures, Translated briefs, Queue writes, Refused — no defer reason (`wrap-up/refused-proposals.md`), Memory updates, Upstream feedback.

Rows across Auto-applied through Translated briefs use a single global sequence starting at #1 (mirrors `wrap-up/review-console.md`). Three sections sit outside that global sequence and are never counted among the named batch sections, exactly as `wrap-up/review-console-interactive.md`'s own three non-batch sections (its Hard requirements explains why): **Queue writes** use a separate `Q`-prefixed sequence (`Q1`, `Q2`, …), one `AskUserQuestion` call per item — aggregated across every spec's staged record-proposal files (`staged/leftover-*.md`, `staged/ledger-record-*.md`, or any staged file carrying a `Title:`/`Type:`/`Labels:` header) plus the parent run dir's own. **Memory updates** use a separate `M`-prefixed sequence (`M1`, `M2`, …), one `AskUserQuestion` call per item — aggregated across every spec's `staged/wrap-up-memory-*.md` files plus the parent run dir's own. **Upstream feedback** uses a separate `U`-prefixed sequence (`U1`, `U2`, …), approved via `_shared/upstream-feedback-batch.md`'s chunked `multiSelect` calls instead of one call per item — aggregated across every spec's `staged/wrap-up-upstream-*.md` files plus the parent run dir's own. Do not restart any of the four sequences per spec or per section.

## Pending-review branch durability

No longer a separate step. Under `pr-first`, `_shared/pr-early-run-lifecycle.md` opens each spec's draft PR at run start, and every phase-exit push (`_shared/git-discipline.md`) keeps it current — a bundle parking at `pending-review` already has live PRs with nothing left to push.

<!-- local-merge-fallback --> `local-merge` never populated this either — the old procedure required a dispatch-only run-identity variable and a forge. A `local-merge` bundle that parks just stays resident in its session.

## Auto-resolution short-circuit (`consoleAutoResolve`)

Same mechanism as `wrap-up/review-console.md`'s own Auto-resolution short-circuit, aggregated across every spec — the path a dispatched bundle group reaches when `/claude-tweaks:dispatch` invokes `/flow "#A,#B"` under an `unattended` ceiling (`dispatch/SKILL.md` Step 5); without it this console would hang a headless firing the same way the single-spec console's tier split exists to prevent. Resolve the ceiling once and check `bookkeepingPermissions(ceiling).consoleAutoResolve` (`bin/lib/issues/autonomy.js`; `_shared/autonomy-ceiling.md`) — not granted → skip to "Present the consolidated console" below, unchanged. `--dry-run` still takes precedence when both apply.

When granted, resolve every member run dir in one process each (#1932, #2007) — never a hand-rolled per-item loop. Render every section below as an informational report (nothing dropped): for each `spec-{N}/` subdirectory named in `manifest.yml` (spec execution order from Step 1), plus once more over the parent run dir itself, invoke:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run {dir} --policy console-auto [--dry-run]
```

`{dir}` is `{parent}/spec-{N}` for each manifest member, then `{parent}` itself, in that order — N+1 calls, never a single call over the whole tree: `bin/lib/console/resolve.js`'s `readMembers`/`readSnapshot` both operate on one flat run dir, and there is no parent-manifest-aware mode (rejected — the multi-spec skill file already owns manifest-reading, and duplicating it in the resolver would create a second place that can drift). Append `--dry-run` to every call when the run itself is `--dry-run`.

**Per-call isolation** mirrors Step 3's engine-call precedent above: a call that exits non-zero for one `spec-{N}/` — a malformed `engine-state.json`, or any of the CLI's own non-zero exits (2 malformed invocation, 3 `--run` not anchored under the main checkout, 4 `consoleAutoResolve` not granted for that directory's own resolved policy, 5 its `console.json` is already a rendered-on-PR console or unparseable) — does not abort the fan-out for the remaining directories. Note the dropped directory in the console's Not run/Failed footer with the CLI's own stderr text as the reason, and continue with the rest. The parent-level call failing is reported the same way, attributed to the parent run dir rather than a spec.

Insert each surviving call's stdout table verbatim into the console response, one render per spec-dir plus the parent's, in the same manifest order — do not hand-expand it. Each call already appends its own `AUTO` decisions block to that directory's own `decisions.md` and writes that directory's own `console.json` (`{resolved: true, mode: 'auto-resolve', items, merge, ...}` — the write `archive-merged.js`'s `readConsoleState` needs, per spec dir and the parent, closing the same gap #1854 closed for the single-spec path) — there is no separate per-item logging step here; the CLI already did it.

Then execute every returned resolution, across every surviving call, through this file's own "On approval" procedure below (each item routes back to the spec-dir it was resolved from) — batch sections and `Q#`/`M#` as if Approve all had been chosen; `U#` resolves to **filed**, the one exception to its usual declined default (same rule the single-spec short-circuit states).

**The bundle-level branch-finish/merge decision is never read from any individual call's own `merge.resolution` field.** Each `console-resolve.js` invocation computes `merge` from only its own `--run` directory's members and grants — a spec-dir call cannot see the bundle's other members, and the parent-level call has no members at all (`readMembers` finds no `work/` directory at the parent, so its `merge.resolution` always reads `leave-open, reason: members-unresolved` — expected, and discarded either way). The bundle decision is computed independently, exactly as before: **the merge half of the terminal decision defaults to merge** (`integration-model: pr-first`'s "Approve all + merge" variant) — `unattended` authorizes full completion, not a park; `local-merge` proceeds to branch-finish the same way. **Needs-human carve-out (merge-check precedence):** when an `assess-agent-autonomy` `merge-check` verdict of `needs-human` exists for this run (any member's verdict, for a bundle — `dispatch/settle-and-merge.md`'s Auto-merge gate, Layer 2), the merge half instead resolves to **leave the PR open** (`pending-review`), never merge — `consoleAutoResolve`'s default-merge never overrides the more specific gate's routing to a human; mirrors the single-spec carve-out in `wrap-up/review-console.md`. **Ungranted-member carve-out (#1802):** the same leave-open resolution also applies when any group member's live labels lack both `auto:merge` and a matured `auto:merge-pending` — the Auto-merge gate's Layer 1 falls through before Layer 2's `merge-check` ever runs on a mixed-grant bundle, so no verdict exists to carry the precedence above; a withheld grant is itself a human decision and must never silently resolve to merge for want of a verdict that was never computed; mirrors the single-spec carve-out in `wrap-up/review-console.md`. Every non-merge item still auto-resolves exactly as this section states.

Retain every `staged/` file as a revert artifact rather than consuming it (applied ones included), and send **one** consolidated `PushNotification` for the whole run — not per spec, not per item, not per call — at the same point the single-spec short-circuit sends its own FYI. Then proceed straight to Cleanup actions execution (Shared teardown below) and archive the parent run dir — skip only the `AskUserQuestion` prompt; already rendered above. End this paragraph's execution by printing the absolute path to every touched `decisions.md` and `console.json` (the parent's, plus each spec's own) and any retained `staged/*.md` files, so the operator has a concrete pointer even though nothing prompted at `unattended`.

## Console-on-PR (`integration-model: pr-first` only)

Bundle analog of `wrap-up/review-console-interactive.md`'s Console-on-PR section (rationale there). Past the short-circuit: `local-merge` (`_shared/integration-model.md`) → "Present the consolidated console" below.

`pr-first` + `pr` on the parent `run-state.json` (one bundle PR — `_shared/pr-early-run-lifecycle.md`): read `_shared/console-on-pr.md`, compose the content below would, post, write `console.json` to the parent run dir. Live: also ask `AskUserQuestion` (`_shared/console-execution.md`). Headless: report `pending-review` + URL. Never both. No `pr` yet: fall through below.

## Present the consolidated console

Read `multispec-console-template.md` (this skill's directory) and render that exact shape — every section's column layout, the engine-vs-prose-fallback distinction, and the `[{genre}-convention]` row's three-way prompt. Worked example rows there are fictional; substitute this run's own per-spec `decisions.md`/`staged/` content, aggregated per "Numbering rules" above.

Immediately after presenting the console tables above, call `AskUserQuestion` with `question`: `"How do you want to handle the Multi-Spec Review Console items?"`, `header`: `"Review Console"`, `multiSelect`: `false`. The Shared teardown's branch-finish row (below) is what makes the merge decision real — folding it into these options is what keeps that row from becoming its own improvised stop (`_shared/auto-mode-contract.md`'s bookend rule).

**`integration-model: pr-first`** — four options:
- Option 1 — `label`: `"Approve all + merge (Recommended)"`, `description`: `"Apply pending items, accept auto-applied, apply skill + config updates, execute cleanup incl. merging the shared branch (items {N}-{M}); resolve every Q#/M# to Apply and every U# to declined."`
- Option 2 — `label`: `"Approve all, leave PR open"`, `description`: `"Same as above, but skip the branch-finish merge — the shared PR stays open for manual merge later."`
- Option 3 — `label`: `"Override specific items"`, `description`: `"Reply with #s to skip/modify (e.g., \"skip 6, modify 8, revert 2\"); also the only path that drills Q#/M#/U# individually."`
- Option 4 — `label`: `"Stop and re-engage"`, `description`: `"Pause; resume after manual review."`

**`integration-model: local-merge`** — no PR to leave open, so the merge decision isn't split; unchanged three options: `"Approve all (Recommended)"` (apply pending items and execute cleanup, incl. branch-finish), `"Override specific items"`, `"Stop and re-engage"`, same descriptions as above minus the merge clause.

If "Override specific items" is chosen, the skip/modify list is ordinary free-text chat in the next message, per docs/skill-authoring.md's Multi-item decisions convention — not the tool's `Other` field.

Queue writes (Q1, Q2, …), Memory updates (M1, M2, …), and Upstream feedback (U1, U2, …) all resolve as part of the terminal decision now, mirroring `wrap-up/review-console.md`'s single-spec stance exactly: choosing Approve all resolves every `Q#`/`M#` item to `Apply` and every `U#` item to declined — their own stated defaults — with no further prompt. Choosing Override is what still drills them individually, below.

After the user selects Override (option 2):

**Queue writes and Memory updates** — prompt each remaining per-item row individually: one small `AskUserQuestion` call per `Q#`/`M#` item, issued separately (never batched into a single call, and never batched across specs or across sections). For each `Q#` or `M#` item, call `AskUserQuestion` with `question`: the item's own line (e.g. for a queue write, `"Queue write Q1 → new record, parked (trigger: /auth provider docs land), spec 157: \"Add OAuth refresh edge case\" — blocked on /auth provider docs."`), `header`: `"Queue write {Q#}"` (or `"Memory update {M#}"`), `multiSelect`: `false`:
- Option 1 — `label`: `"Apply"`, `description`: `"Create the record: \"{content}\""` for a queue write, `"Write the memory file: \"{name}\""` for a memory update
- Option 2 — `label`: `"Skip"`, `description`: `"Drop this proposal"`
- Option 3 — `label`: `"Edit"`, `description`: `"Modify before creating"`

None of these three options carries `(Recommended)` — the source text requires explicit per-item attention, mirroring `wrap-up/review-console-interactive.md`'s Queue writes / Memory updates sections exactly (see that file for the full worked examples and the `Other`-field override note). Approve all (option 1) never reaches this drill — it already resolved every item to its default above.

**Upstream feedback**, under Override, calls into `_shared/upstream-feedback-batch.md`'s shared batch contract with this run's aggregated `U#` rows (across every spec plus the parent run dir): render each item's full scrubbed draft, then issue the contract's chunked `multiSelect` `AskUserQuestion` call(s) (unchecked by default; checking is the explicit approval, per that file's own rule), never batched across specs beyond the contract's own chunking. Approve all never reaches this drill — every `U#` row resolves to declined by default instead (the Auto-resolution short-circuit below is the one path where `U#` resolves to filed without it).

## Preflight

Before "On approval" or "On override" below runs any `gh` command, run the Detection Ladder
from `_shared/forge-detection.md` (checks 1-3). A ladder failure is a hard gate here, matching
`wrap-up/cleanup-procedures-execution.md` Section E's own posture — this console's entire approval path
writes GitHub state (releases, grant removal), so there is no fail-open degraded mode.

## On approval (option 1)

1. For each `spec-{N}/staged/` patch: apply per `_shared/staged-patch.md` against the cumulative pipeline state — a stale diff (expected once later specs' phases have run) is re-derived from its `Target:`/`Invariant:` preamble
2. For each `Q#` queue write: Approve all resolves it to `Apply` directly, no prompt; Override prompts per item (above). On Apply/Edit: run `wrap-up/refused-proposals.md`'s check first (a refused item is never created), then create the record — `gh issue create` (`work-backend: github-issues`) or `local-store.js`'s `writeRecord` (`work-backend: local-files`), reading `Title:`/`Type:`/`Labels:` and the body from the item's staged file — same mechanism `wrap-up/review-console.md`'s create step uses. Skip (Override only) drops the proposal — log the decline to the originating spec's `decisions.md` (or the parent's, for a parent-level leftover) with the user's stated reason, or "declined, no reason given."
3. For each `M#` memory update: same Approve all / Override handling as `Q#`. On Apply/Edit: write the memory file and append its `MEMORY.md` index line per `_shared/learning-routing.md`'s D4 procedure, at batch approval or auto-resolution (the write lands outside the repo, not in this commit). Skip (Override only) drops the proposal — log the decline the same way as `Q#`.
4. For `U#` upstream feedback rows: Approve all resolves every row to declined directly, no prompt, nothing filed (the Auto-resolution short-circuit above is the one exception); Override presents them via `_shared/upstream-feedback-batch.md`'s shared batch contract (above) — the rendered draft **is** the approved snapshot. For each item checked: invoke `/claude-tweaks:feedback --pre-confirmed` with the staged-file path and that snapshot for its drift check (Step 6 scrub always reruns regardless; on drift it falls back to its own confirm). An item left unchecked (Override) or resolved by the Approve all default is declined per the shared contract's rule — log the decline the same way as `Q#`/`M#`.
5. Apply skill updates and create new skills (from each spec's Skills curation row)
6. Apply config updates (docs, CLAUDE.md, rules)
7. Commit with a multi-spec wrap-up message that lists which specs contributed which changes
8. Execute Cleanup actions rows in order — dev-server teardown (no dependency) may run any time; branch-finish (row 16 in this example) must complete before any per-spec claim-release/grant-removal/label-cleanup row runs, since those rows read branch-finish's outcome for the release reason and `$LINK`. Under `pr-first`, "Approve all, leave PR open" skips the branch-finish merge attempt entirely (the PR stays as-is) and every per-spec row below waits for `merged` evidence instead, same as any other `pending-review` outcome (`_shared/pr-first-merge.md`'s Outcome vocabulary — the reconciler completes cleanup later). This is "Shared teardown" below, gated on the visible rows above rather than running unconditionally.
9. Archive the parent run dir to `.claude-tweaks/pipelines/archive/{run-id}/` (subdirs included) — routes through `bin/lib/reconcile/archive-merged.js`'s `archiveRunDir` (or `wrap-up/cleanup-procedures-execution.md` Section B's manual equivalent, applied once per `spec-{N}/` subdirectory rather than once at the top level), never a plain recursive move: every git-tracked `spec-{N}/work/` subtree moves via `git mv` before the gitignored rest (`spec-{N}/config.yml`, `decisions.md`, `staged/`) moves via plain `mv` into its own `archive/{run-id}/spec-{N}/`, then the parent-level `manifest.yml`/`config.yml`/`decisions.md` move the same way (#593 — a multi-spec parent whose `spec-{N}/work/` subtrees skip `git mv` resurrects those tracked files at the pre-archive path on the next checkout, the same failure mode the single-spec path already guards against)

## On override (option 2)

1. Parse the user's overrides — `#`s map to consolidated table rows; resolve back to the originating spec's subdirectory for each
2. Apply (per step 1), skip, or modify per item
3. **If the branch-finish row (Cleanup actions) is skipped or reverted:** auto-skip every per-spec claim-release/grant-removal/label-cleanup row for this run, and the shared worktree-removal row (Shared teardown step 6) — render each as "skipped — depends on branch-finish" rather than executing it against a branch-finish outcome that never happened, and rather than leaving it pending or orphaned. Log the auto-skip to the parent run dir's `decisions.md`. Dev-server teardown is unaffected — it has no dependency on branch-finish and executes (or is skipped) per the user's own choice for that row alone.
4. Queue writes (`Q#`) and Memory updates (`M#`) resolve via a per-item prompt under override — the one path where they resolve individually instead of by their Approve-all default; Upstream feedback (`U#`) resolves via the shared batch contract under override, the same way — see "Present the consolidated console" above; the user can Skip or Edit any of them, but none of the three can be bulk-resolved across specs either
5. For items the user wants reverted: `git revert {commit}` (one revert commit per item)
6. Execute the Cleanup actions rows the user did not skip, respecting the dependency order established in step 3 above. "Shared teardown" below documents these steps' mechanics.
7. Archive the parent run dir — same inline archive action as "On approval" step 9 above (routes through `bin/lib/reconcile/archive-merged.js`'s `archiveRunDir`, per-`spec-{N}/` `git mv`-then-`mv` sequencing, `#593` guard, and all).

### Shared teardown (dev server, branch finish, claim release, grants, worktree removal)

These steps appear as visible, numbered Cleanup actions rows in the console template above — what the user sees, approves, or overrides. This section documents only their mechanics, which apply identically after both "On approval" step 8 and "On override" step 6; only what triggered them differs:

1. **Tear down the shared ephemeral dev server** if one was started (`{parent-run-dir}/ephemeral-server.txt` — see `wrap-up/cleanup-procedures-execution.md` Section D). It was kept up across all specs (per-spec wrap-ups deferred it under `MULTISPEC_REVIEW_DEFER=1`); kill it once here.
2. **Finish the shared branch.** `integration-model: pr-first` (`_shared/integration-model.md`): run
   `_shared/pr-first-merge.md`'s procedure now — `tag: fast-lane`, `issue-list` the manifest's
   `complete` specs only (#2015 — never the full `specs[].id` list; a `not-run`/`failed` spec must
   never close on this merge, and step 3 below already releases that set separately with its own
   `never-started:`/`abandoned:` reason, so it needs no `Fixes`/`Refs` line here), `summary` a
   bundle one-liner — no checkout needed and no prompt, the same split `flow/worktree-merge.md`'s
   own reconciliation already states. Which of the
   terminal decision's two Approve-all variants was chosen (above) governs the outcome: "leave PR
   open" skips the merge attempt entirely (Step 3), landing on `pending-review` with the PR left
   ready. `integration-model: local-merge`: complete it via `/superpowers:finishing-a-development-branch`
   (merge / PR / discard) — tell it explicitly **not** to remove the worktree; step 6 below
   (`ExitWorktree`, per the Teardown ordering invariant in `wrap-up/cleanup-procedures-execution.md` Section C)
   owns that, never that skill's own git mechanics (its bundled script's `cd`-then-`git worktree
   remove` is exactly the raw-removal shape the invariant forbids) — reserved for `local-merge`
   only, mirroring the same split. Either way, the outcome decides each spec's release reason and
   `$LINK` (merge commit sha or PR URL) for the next step.
3. Release each issue claim this run holds — enumerate via `manifest.yml`'s `specs[].id` list (every record targeted by this run, regardless of status), not by globbing `spec-*/work/*-spec.md` alone — a record-mode spec whose build never started (e.g. `status: not-run` under default failure handling, per `multi-spec.md`) has no `work/` file to glob and would otherwise be silently left un-enumerated. For each `id` whose `spec-{id}/work/{id}-spec.md` exists (materialized from a record via `materialize.md`), read its header `record:` field to confirm the issue number. The materialized file is never deleted before this point — only archived once the run dir is archived — so it's read directly here; there is no separate pre-deletion capture. For an `id` with `status: not-run` and no `work/` file, the manifest's own `id` IS the record/issue number — release it with the same `bin/release-claim.js` command below, reason `never-started: spec {spec} not run` and no `--link` (the same `never-started:` reason vocabulary `dispatch/SKILL.md`'s partial-claim abort uses), since it never reached a mergeable/abandonable state. Every other status uses the outcome-mapped reason from `wrap-up/cleanup-procedures-execution.md` Section E (merged → `merged: spec {spec}`, PR → `pr-opened: spec {spec}`, discarded → `abandoned: spec {spec}`) and its one-command release — `node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" "$ISSUE" --run "$MULTISPEC_PARENT_DIR" --reason "$REASON" --link "$LINK" --remove-in-progress [--remove-grants] --section "/flow"` — which ownership-checks (a successor's claim is never deleted), writes the tombstone, posts the comment, and logs one `AUTO` line to the parent's `decisions.md`. `$LINK` is the branch-finish outcome's merge commit sha or PR URL. **`--run` is `$MULTISPEC_PARENT_DIR`, never a per-spec `$PIPELINE_RUN_DIR`.**
4. **Remove grants** — pass `--remove-grants` for each issue released with a `merged:` or `pr-opened:` outcome (strips `auto:build`/`auto:merge-pending`/`auto:merge`, best-effort per label); omit it for `abandoned:` (the grant is the standing retry request). See "Grant revocation" in `_shared/issue-claims.md`.
5. **Remove `bot:in-progress`; restore `parked` if applicable** — see "Per-issue label cleanup" below.
6. **Remove the shared worktree** — `wrap-up/cleanup-procedures-execution.md` Section C step 4; the run occupies exactly one (`multi-spec.md`'s "Shared worktree"). Per that Section's Teardown ordering invariant: only once steps 2-5 above have completed — step 3's claim release reads each spec's materialized header from inside this worktree — and only via `ExitWorktree`, never a raw `git worktree remove` nor a `cd`-then-remove compound. Run `close-run` first (Section C step 3.6) if the parent run dir is not already closed. Skip when the branch-finish outcome left work pending: `pr-first`'s "leave PR open" (no merge attempted) or `local-merge`'s "kept as-is" — the worktree stays for that continued work, mirroring Section C step 3's own skip.
7. **Branch + remote-ref cleanup, once the shared worktree is gone (#594).** Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" teardown-run --run "$MULTISPEC_PARENT_DIR" \
     --merged  # or --abandoned when the branch was discarded, not merged
   ```

   `teardown-run` composes the archival + local-branch-delete + remote-branch-delete mechanics
   `cleanup-procedures-execution.md` Section C uses for a single-spec run — target
   `$MULTISPEC_PARENT_DIR` (the run occupies exactly one worktree/branch for the whole multi-spec
   run, recorded on the parent, never a per-spec `$PIPELINE_RUN_DIR`). Called after step 6 above,
   not before: `teardown-run`'s own worktree-removal step would otherwise skip (the worktree is
   still locked to this session at that point) — harmless either way, but the local branch delete
   would fail outright if attempted while the branch is still checked out in the (not-yet-removed)
   worktree, since git refuses to delete a checked-out branch. Skip when step 6 itself skipped
   (work left pending).

### Per-issue label cleanup

Applies identically from "Shared teardown" step 5 above, regardless of whether it ran after "On approval" or "On override" — only what triggered it differs. Per `wrap-up/cleanup-procedures-execution.md` Section E: `bot:in-progress` is removed by `--remove-in-progress` in the release command above (best-effort). Then, only when the release reason was `abandoned: spec {spec}` (not `merged:`/`pr-opened:`) AND that record's materialized header (`spec-{spec}/work/{issue}-spec.md` — read directly; per the release item above, the file is never deleted before this point) carries `parked-at-shaping: true` (`materialize.md`'s field for exactly this restore-on-abandon case), restore `parked` (bootstrap if missing per _shared/label-bootstrap.md, LABELS_JSON = [['parked', 'Deferred backlog entry, waiting on a trigger condition']], then `gh issue edit "$ISSUE" --add-label parked`) — best-effort, log and continue on failure either way. Log each removal/restoration to `decisions.md`.

## On stop (option 3)

Halt before applying. Leave the parent run dir intact. User resumes with `/claude-tweaks:flow {specs} review-console` (a dedicated resume step that re-reads the same parent dir and re-presents the console).

**Logging the terminal decision:** At the consolidated terminal-decision point (when Approve all + merge / Approve all, leave PR open / Override / Stop is chosen), log the same `AUTO {time} — Review Console: terminal decision {…}. Reversibility: n/a.` line (per `wrap-up/review-console-interactive.md`'s format) to the parent run's `decisions.md`.

## Empty-console fast path

If every per-spec `decisions.md` passes `wrap-up/review-console.md`'s Empty-console fast path decision-bearing-entries test (no `AUTO`/`STAGED`/`KEPT-PROMPT`/`REFUSED`/`FAILED` entries — that file's `SCANNED`-exclusion rule applies per spec, cited rather than restated here) AND every per-spec `staged/` is empty AND the parent `staged/` is empty AND there are no skill or config updates across the run AND no cleanup actions apply across any spec AND no queue writes are pending across any spec, skip the console entirely. Log "Multi-spec Review Console: nothing to review" and archive silently.

## Sort order

Within each section: reversibility:low first (highest-stakes revert), then reversibility:med, then reversibility:high. Within the same reversibility, severity:high first. **Tiebreaker: spec ID ascending** — so the user sees consistent spec ordering across sections.

## Hard requirements

- The console MUST present every entry from every per-spec `decisions.md` AND the parent run dir's `decisions.md` (auto-applied + staged + kept-prompt + scanned), every file in every per-spec `staged/` directory and every file in the parent run dir's `staged/`, every Low-confidence and Contested finding surfaced by any spec's `/review`, and every Cleanup actions row that would otherwise run at teardown. Silently dropping any item is forbidden.
- The `Spec` column is mandatory in every table — the user must be able to trace any row to its originating spec for context.
- The `Not run` footer is mandatory when any spec was skipped due to a HARD-GATE earlier in the pipeline — those specs' contexts are explicit, not buried.
- **Queue writes, Memory updates, and Upstream feedback are covered by the terminal Approve all / Override / Stop decision**, mirroring `wrap-up/review-console-interactive.md`'s single-spec stance exactly (see that file's Hard requirements for the full rationale). Approve all resolves every `Q#`/`M#` item to `Apply` and every `U#` item to declined with zero additional `AskUserQuestion` calls; Override is what still drills per item — one call each for `Q#`/`M#` (never batched across specs or sections), `_shared/upstream-feedback-batch.md`'s chunked `multiSelect` calls for `U#` (aggregated across specs). This enforces `_shared/auto-mode-contract.md`'s not-silenced rules for work-record creation, memory writes, and upstream filing.

## Anti-Patterns

| Pattern | Why it fails |
|---|---|
| Running per-spec consoles inline AND a consolidated one at the end | Double approval. If `MULTISPEC_REVIEW_DEFER=1` is set, the per-spec console MUST skip — the consolidated one is the single approval point. |
| Aggregating across runs (e.g., yesterday's spec + today's spec in one console) | Each `/flow` invocation has its own parent run dir. The consolidated console is scoped to one `/flow` invocation only. |
| Omitting the `Spec` column to keep the table narrow | Spec attribution is the whole point of the consolidated view. Wide tables wrap; the column stays. |
| Replacing per-spec audit trails with a merged `decisions.md` | The per-spec subdirectories are the audit trail. Merging discards the spec attribution and makes archive review harder. The consolidated console *reads* multiple per-spec files; it does not *replace* them. |
| Treating a different table's "Apply all" as satisfying Q#/M#/U#'s own decision | Work-record creation, memory writes, and upstream filing are never silenced by `auto` (`_shared/auto-mode-contract.md`) — but they ARE covered by the terminal Approve all / Override / Stop decision now, resolving to their own stated default (Apply for Q#/M#, declined for U#) with zero extra prompts; only Override still drills them per item, the same contract `wrap-up/review-console-interactive.md`'s three sections enforce for a single-spec run. |
