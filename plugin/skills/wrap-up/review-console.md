# Wrap-Up Review Console — Phase 4 (CLOSE)

The Review Console is the **second bookend** of the pipeline (see `_shared/auto-mode-contract.md`). One consolidated batch surfaces everything that was auto-decided or staged during the pipeline, plus skill update proposals, leftover-work routing, queue writes, and end-of-pipeline cleanup — all the friction that used to live mid-flow now lands here.

## When to run

- **Every mode — `auto`, `hybrid`, interactive, standalone** — run whenever a pipeline run directory exists for this work, which is every run from Phase 1 onward (`SKILL.md`'s "Establish the run directory (unconditional)"). Mode is not a condition on this console; the run directory is.
- **`MULTISPEC_REVIEW_DEFER=1`** — the one exception: **skip**. The consolidated multi-spec Review Console at `/flow` end-of-run will read this spec's `decisions.md` + `staged/` and surface everything in one place. See `flow/multispec-review-console.md` in the `/claude-tweaks:flow` skill's directory, and the Multi-spec defer protocol below.

In interactive and standalone runs this console replaces the batch decision the report template used to present after it — same tables, same single terminal `AskUserQuestion` (Approve all / Override / Stop). Approve all now resolves `Q#`/`M#`/`U#` to their own stated defaults directly, with no further prompts; choosing Override is what still drills each item — `_shared/batched-item-drill.md` for `Q#`/`M#`, `_shared/upstream-feedback-batch.md` for `U#` (see `review-console-interactive.md`'s Hard requirements). `summary-template.md` now renders only the record of what was decided here, never a second decision point.

**Hard gate.** Check the response you are about to send: does it already contain the numbered console tables as literal rendered markdown, with a row for every item? If not, render them now, in this response, before the tool call.

## Dry-run mode (`--dry-run`)

When `--dry-run` was passed (see `SKILL.md`'s Phase 1 Flags subsection), run every analysis step normally — Phases 1-3, and the Auto-merge short-circuit's content-judgment verdict below — but treat everything from this point forward as preview-only:

- Skip the Auto-merge short-circuit's actual `git merge --no-ff` / `git push`, and that same branch's acceptance labeling (no `demo:pending` write, no Verification Brief comment — both are network writes to a live record) even when both layers pass — log the verdict and print the brief as a preview line instead, then fall through to rendering the console below as a normal (non-merging) run.
- Present the console tables exactly as usual, but every action under "On approval" and "On override" becomes a printed preview line instead of an executed one — no `git apply`, no `git revert`, no `git commit`, no `gh issue create` / `local-store.js` write, no cleanup deletion, no skill-file write.
- Queue writes (`Q#`), Memory updates (`M#`), and Upstream feedback (`U#`) all still render for visibility, but their `AskUserQuestion` call(s) are skipped — each item renders as "would create: {content}" instead. Under `--dry-run`, no memory file is ever written and `/claude-tweaks:feedback --pre-confirmed` is never invoked.
- Log to `decisions.md`: `AUTO {time} — Dry-run: {N} items would have been applied; 0 applied (--dry-run).`
- After presenting, stop — do not proceed to the phase-trace report or Phase 4's real execution step; report the preview as the run's final output.

## Auto-merge short-circuit

When this run's spec has a materialized header (`{run-dir}/wrap-up-pack.json`'s `inputs.records` is non-empty — Phase 3's fact pack, `pack.js`'s `resolveRecords` (own `work/`, then the worktree's mirror); when the pack file is absent, fall back to `cleanup-procedures-execution.md`'s Section C step 2 worktree-mirror glob instead)
AND EITHER the issue's **live** labels carry `auto:merge` or `auto:merge-pending` (re-fetch via
`gh issue view --json labels` — never the header's `grants:` snapshot) OR
`manifesto-authorized-merge.md`'s applicability check passes, read `auto-merge-short-circuit.md`
in this skill's directory and follow it in full — the single-record version of
`skills/dispatch/SKILL.md`'s group-scoped "Auto-merge gate." That file routes on
`_shared/integration-model.md`'s `pr-first`/`local-merge` split. Otherwise skip it entirely; do
not read the file. Full applicability-check rationale (why the grant read must stay live, and how
`pack.recordLabels` in `{run-dir}/wrap-up-pack.json` renders beside it as an audit snapshot only —
omitted when the pack file is absent or `ok: false`): `review-console-appendix.md`'s "Auto-merge
short-circuit — applicability detail" section.

## Multi-spec defer protocol

When `MULTISPEC_REVIEW_DEFER=1` is set (by `/flow` multi-spec orchestration), skip this console
entirely — see `review-console-appendix.md`'s "Multi-spec defer protocol" section for the full
6-step procedure (deferred-item logging, `verify-expectations.json`'s `deferred` shape, and the
phase-trace/archival handoff to the parent run). This is the *only* condition under which
`/wrap-up` skips the Review Console when a run directory exists — every single-spec run, in any
mode, always runs the per-spec console below.

## Locate the pipeline run directory

See `_shared/run-dir-resolution.md` for the resolution order and bash snippet; an empty result is
**unreachable after Phase 1**. If it happens anyway, do not skip the console — present the same
findings inline in this response, gathered from what this run itself produced, and take the same
terminal decision below.

## Read inputs

1. `decisions.md` — auto-decision log
2. `staged/` directory — patches and proposals awaiting decisions
3. `config.yml` — the Manifesto answers (for context)
4. `events.jsonl` — hook-recorded typed events; surface `wd-deny`, `wd-push-mismatch`, `contract-violation`, and `gate-denial` events
5. **Staged inventory reconciliation** — run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-staged-inventory --run "{run-dir}"`. On `MISMATCH`, surface it as a visible warning line (never a silent log entry) — a `STAGED` entry whose named `staged/` file is missing needs manual re-derivation from `decisions.md`'s prose before it can be applied here.
6. **Session-start residue check** — run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-session-residue --run "{run-dir}"`. On pending residue, render a "Still pending from earlier" informational line naming each item and its resolution command, above the console tables (see console-template.md) — informational only, never acted on here. Omit when it reports none.

## Ledger narrowing auto-file (runs before rendering)

Read `ledger-narrowing-auto-file.md` and follow it before building the tables below — when `_shared/autonomy-ceiling.md`'s `queueWriteAutoFile` capability is unlocked, a staged queue-write proposal is created directly and logged as `AUTO` instead of waiting for Queue writes' per-item approval.

## Pending-review branch durability

No separate step. Under `integration-model: pr-first`, `_shared/pr-early-run-lifecycle.md` opens
this run's draft PR at run start, and every phase-exit push since (`_shared/git-discipline.md`)
keeps it current — a run parking at `pending-review` already has a live, up-to-date PR with
nothing left to push. Under `local-merge`, nothing is populated here either — a parked run stays
resident in the session that built it.

## Auto-resolution short-circuit (`consoleAutoResolve`)

This is the tier split for headless firings: `supervised`/`trusted` keep today's resting state — the console below renders as a blocking prompt that a headless run never answers, landing on `pending-review`. `unattended` is the only tier that completes without a human.

Resolve the ceiling once — `CEILING=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" autonomy)` (the `--run` overlay is what makes this pre-check agree with the CLI below, which folds run config over project policy in its own resolve) — and check `bookkeepingPermissions(ceiling).consoleAutoResolve` (`bin/lib/issues/autonomy.js`, granted at `unattended` only — see `_shared/autonomy-ceiling.md`). When **not** granted, skip this section entirely and proceed to "Present a real stop" below — the ordinary `supervised`/`trusted`/interactive path, unchanged. When `--dry-run` was also passed, its preview-only behavior (above) takes precedence regardless of ceiling — nothing here executes a real write.

When granted, render the console as an **informational report**, not a prompt: every section below still appears (Auto-applied through Cleanup actions, `Q#`/`M#`/`U#`, Refused rows), each row stamped `AUTO-RESOLVED` — nothing dropped. Then resolve every item per its stated default, **zero** `AskUserQuestion` calls:

- Every batch-section item (Auto-applied through Cleanup actions) resolves as if "Approve all" had been chosen. **The merge half of that decision defaults to merge** (`integration-model: pr-first`'s "Approve all + merge" variant, never "leave PR open") — `unattended` authorizes full completion, not a park; `local-merge` proceeds to branch-finish the same way. **Needs-human carve-out (merge-check precedence):** when an `assess-agent-autonomy` `merge-check` verdict of `needs-human` exists for this run (any member's verdict, for a bundle — `dispatch/settle-and-merge.md`'s Auto-merge gate, Layer 2), the merge half instead resolves to **leave the PR open** (`pending-review`), never merge — `consoleAutoResolve`'s default-merge never overrides the more specific gate's routing to a human. **Ungranted-member carve-out (#1802):** the same leave-open resolution also applies when any group member's live labels lack both `auto:merge` and a matured `auto:merge-pending` — **"group member" here includes a solo, non-bundle record**: a singleton run's own single record is a one-member group, not an exemption, so an `auto:build`-only record with no `auto:merge` never merges under this carve-out regardless of whether it arrived alone or as part of a dispatch bundle (#1966 — the carve-out's original wording, phrased only in bundle terms, left this ambiguous). For a bundle, the Auto-merge gate's Layer 1 (`dispatch/settle-and-merge.md`) falls through before Layer 2's `merge-check` ever runs on a mixed-grant group, so no verdict exists to carry the precedence above; a withheld grant is itself a human decision and must never silently resolve to merge for want of a verdict that was never computed. **Drain-overlap-hold carve-out (#2299):** the same leave-open resolution also applies when
`dispatch/drain-pr-overlap.md`'s own Auto-merge-gate hold (#1985) logged this group as overlapping
a still-open PR from earlier in the same drain firing — `console-resolve.js`'s `mergeResolution()`
re-verifies that PR's *live* state (never trusting the historical `decisions.md` line as
permanent) and resolves `leave-open` only while it is still genuinely open; once that PR merges or
closes, this carve-out no longer applies and the group's merge decision resolves normally on its
next evaluation. Every non-merge item still auto-resolves exactly as this section states.
- Every `Q#`/`M#` item resolves to `Apply` — its pre-checked default in `_shared/batched-item-drill.md`. Refused rows are never auto-resolved (`refused-proposals.md`).
- Every `U#` item resolves to **filed unconditionally** — causal-tagged or not, unlike "Approve all"'s own conditional default (below) — `consoleAutoResolve` means "apply the Approve-all default to everything," not "apply the Override-drill defaults," and Thomas's explicit direction (#347's Decision Rationale) is that upstream feedback auto-files at `unattended` exactly like `M#`/`Q#`. At every other tier, "Approve all" resolves `U#` per its own narrower default instead: filed only when the item's staged draft carries a `**Causal:** systemic` tag, declined otherwise (#2551; see `review-console-interactive.md`'s Hard requirements).

Resolve every item in one process instead of one turn each (#1932): `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --policy console-auto` (append `--dry-run` when this wrap-up runs `--dry-run` — it then prints without writing). The CLI applies the stances above to every staged item, computes the merge half with both carve-outs above, logs one decisions block, writes `{run-dir}/console.json`, and prints the console table once — every row stamped `AUTO-RESOLVED`. For the full mechanics (`SECTION_STANCES`/`SECTION_MAP`, the stale/unmapped-prefix/refused classification, the decisions-block and `console.json` shapes), see `review-console-appendix.md`'s "Auto-resolution short-circuit — console-resolve.js execution detail" section. Render that table verbatim. The CLI ends its output with a `Needs a human` block (paste-ready `cat` lines plus a `node "${CLAUDE_PLUGIN_ROOT}/bin/console-residue.js" --ack --run …` line) whenever any item resolved `pending`/`keep-staged`; carry that block verbatim into the consolidated `PushNotification` below and into the run's final human-facing stop (`/flow`'s Pipeline Summary `### Needs a human`), never only `console.json`. Then execute every returned resolution through this file's own "On approval (option 1)" procedure below — the shared one `review-console-interactive.md` also defers to. Each resolution routes to exactly one step, per the appendix's "Resolution-to-step mapping" table; no row is left unrouted. The merge half is not one of those rows: run it separately per `merge.resolution` (`_shared/pr-first-merge.md` under `pr-first`, at "On approval" step 13 after step 12's commit; branch-finish under `local-merge`). **Retain `staged/` files** rather than deleting them, applied ones included.

Non-zero exits — full rationale in the appendix's "Non-zero exit codes" section: exit code 4 (ceiling not granted) → "Present a real stop" below; exit code 5 (already rendered on the PR and awaiting a human, or an unparseable `console.json`) → never ask: a console on the PR follows `_shared/console-on-pr.md`'s Headless conclusion (report `pending-review` with the PR URL), and an unparseable one stops and reports stderr like exits 2 and 3 (`[IL-167]`); exit codes 2 and 3 (malformed invocation / `--run` not anchored) → a HARD-GATE failure, stop and report stderr. Send one consolidated `PushNotification` summarizing the run, ending with the absolute path to `decisions.md`, `console.json`, and any retained `staged/*` files.

After resolving, proceed directly to the phase-trace report — skip "Present the console" (`review-console-interactive.md`) and its `AskUserQuestion` call entirely.

## Present a real stop

Reached only when the Auto-resolution short-circuit above did not resolve and return, and
`--dry-run` did not already stop. Read `review-console-interactive.md` in this skill's directory
and follow it in full: Console-on-PR routing, the Numbering rules, "Present the console"'s table
render + terminal `AskUserQuestion`, "On override," "On stop," and the full Hard requirements.
That file's "On approval" branch invokes this file's own "On approval" section below — the two
files share that one procedure since the Auto-resolution short-circuit above also depends on it.

## On approval (option 1)

1. Apply all staged items in `staged/` for items 5–7 per `_shared/staged-patch.md`: `git apply` while the diff still fits; a stale diff is re-derived from its `Target:`/`Invariant:` preamble, never dropped silently. Write back to the item's own ledger row (`_shared/staged-patch.md`'s Write-back to the ledger) — its Status is never left `open` for a finding this step just applied — an `sdd-ruling-*` item's write-back follows `review-console-appendix.md`'s `sdd-ruling-*` bullet (ratify → `accepted` here; reverse → `deferred` at step 7, once the reversal record exists), not the patch table
2. Apply skill updates and create new skills (items 11–12, from the Skills curation row)
3. Apply documentation updates (item 13, from the Docs curation row) — including any approved missing-doc scaffolding (D2) and restructural docs-health filings (D1)
4. Apply journey updates (item 14, from the Journeys curation row) — including any approved missing-journey scaffolding (J2) and self-review fixes (J1)
5. Apply config updates (item 15: CLAUDE.md, rules, ADRs) — including any CLAUDE.md findings staged by the CLAUDE.md & rules curation row, which are always offered, never auto-applied
6. Execute cleanup actions (items 18 onward — `cleanup-procedures.md`'s canonical list) — Phase 4's execution step picks these up. Under `pr-first`, the branch-finish (merge or leave-open) runs at step 13 below, after this procedure's commit. Under `local-merge`, cleanup routes through `_shared/local-merge-auto-finish.md`'s no-prompt path whenever `config.yml` exists; an `interactive`/standalone run (no `config.yml`) still gets Section C's original `/superpowers:finishing-a-development-branch` handoff
7. `Q#` queue writes: Approve all resolves to the pre-checked `Apply` default; Override resolves via the multiSelect chunk (or free-text Edit). On Apply/Edit: run `refused-proposals.md`'s check first, then create the record (`gh issue create` for `github-issues`, `local-store.js`'s `writeRecord` for `local-files`), reading `Title:`/`Type:`/`Labels:` and the body from the item's staged file. Skip (Override) drops the proposal — log the decline to `decisions.md` with the stated reason, or "declined, no reason given."
8. `M#` memory updates: same Apply/Edit/Override mechanic as step 7. On Apply/Edit: write the memory file and append its `MEMORY.md` index line per `_shared/learning-routing.md`'s "Memory write procedure (D4)", reading the proposed file/index line from the item's staged file — the memory directory comes from the invoking assistant's own system prompt, never derived or guessed; this write lands outside the repository, so it is not part of the wrap-up commit below. Skip drops the proposal — log the decline as in step 7.
9. For `U#` upstream feedback rows, Approve all resolves each per its own conditional default: **filed**, when the staged draft (`staged/wrap-up-upstream-{N}.md`) carries a `**Causal:** systemic` tag; **declined** otherwise (the Auto-resolution short-circuit above still files every `U#` row unconditionally at `unattended`, causal tag or not). Override instead presents them via `_shared/upstream-feedback-batch.md`'s shared batch contract; for each item checked: invoke `/claude-tweaks:feedback --pre-confirmed`, passing the staged-file path and approved snapshot for its drift check (Step 6's scrub always reruns regardless; on drift it falls back to its own `AskUserQuestion`). An unchecked or non-systemic-default item is declined per step 7's decline rule; a filed-default item is filed the same way step 7's Apply path creates a record, before moving to step 10.
10. **Reflection insights (#2547).** When `staged/wrap-up-reflect-insights.md` exists (reflect staged it under `--source wrap-up` instead of asking — `reflect/full-mode.md`'s Step 3), this is the one terminal decision that applies its rows; absent the file, skip this step entirely. Approve all applies each insight's own recommended destination exactly as reflect's own "Apply all" would have: "Implement now" edits CLAUDE.md/the named skill now (folding into step 12's commit); "Defer"/"Capture" creates its backlog record now (`specShapedBody` + the unified record contract, or `/claude-tweaks:capture`); "Don't capture" records its decline via `recordDecline`. **D4 (Memory) and D5 (Upstream) rows in this table are informational only** — approving this step never writes a memory file or files upstream feedback on its own; those two destinations resolve exclusively through this console's own separate `M#` (step 8) and `U#` (step 9) rows. Override drills this table via the same multiSelect-chunk mechanic `_shared/batched-item-drill.md` defines for `Q#`/`M#`; an unchecked row applies nothing and is not itself a "Don't capture" decline — only a resolved/edited "Don't capture" destination calls `recordDecline`.
11. Write `verify-expectations.json` in `$PIPELINE_RUN_DIR`. Under Approve all: `printf '%s' '{"memory":[...],"upstream":[...],"issues":[...],"ledger":[...]}' | node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" finish-console --run-dir "$PIPELINE_RUN_DIR" --approve-all` (#2544) writes it, logs the outcomes, and flips the named ledger rows in one call, with `issues` sourced exactly as the `--issues` call below sources it and the key omitted when no record resolves. On any other resolution path: write the `memory`/`upstream` keys to a scratch JSON file (never a direct Write into the run dir) and run `node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --file {scratch-file}` (#2764) — `memory` holds one `{file, indexFile}` entry per `M#` item resolved to Apply in step 8, empty when none; `upstream` holds one `{url}` entry per `U#` item resolved to filed in step 9, empty when none. Also include an `issues` array of this run's record number(s) — `{run-dir}/wrap-up-pack.json`'s `inputs.closingRecords` when non-empty (the records this run may close — `cleanup-procedures-execution.md`'s Section C step 2), else Phase 1's identified record(s) — recorded via `node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --issues {n}[,{m}]` after the write above: verify runs after cleanup, when the worktree mirror may already be gone, so this key is the fallback it reads then (a resolvable header still takes priority). Omit the `--issues` call when no record resolves either way (conversation-based work) — the CLI exits 2 on an empty value. Both writers read-modify-write, preserving any existing `oversightExempt` array and every other field this step doesn't own. Always write this file, even when `memory`/`upstream` are both empty. For the exit-2/3 writer-error handling and the absent-vs-empty-file distinction, see `review-console-appendix.md`'s "On approval — execution detail" section. Skipped entirely under `--dry-run`.
12. Commit with a wrap-up message
13. **Branch finish (`pr-first`, #3595).** Runs after step 12's commit, because steps 7 and 11 are the ledger's last writers. First cleanup item 2, when it survived the Condition filter (`cleanup-procedures.md`'s table — a non-final spec of an `interactive` multi-spec run skips it): re-check the ledger for `open` rows (steps 1 and 7 can reopen rows after Phase 3) — any `open` row leaves the ledger in place with one `SKIP` line via `log-decision.js` naming the rows; otherwise run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" delete-ledger --run "$PIPELINE_RUN_DIR"`, and on `deleted` commit only that tracked `docs/plans/*-ledger.md` path; any other report commits nothing (`cleanup-procedures.md`'s Item 2 paragraph: `not found` is a no-op, every other report logs a `SKIP` line). Then push the branch as its own Bash call — `git -C "{worktree-path}" push origin {branch}` — which also carries step 12's commit, so `gh pr merge` merges a head that holds both. A failed push skips the merge: land on `pending-review` as "leave PR open" does and log one `SKIP` line naming the push error — never merge a remote head that lacks step 12's commit. Then route on the Approve-all variant: "Approve all + merge" runs `_shared/pr-first-merge.md`'s procedure — read as one composed bundle: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-checklist-refresh.md"`, then read `$PIPELINE_RUN_DIR/context/merge.md` (source files directly if compose is unavailable); "leave PR open" skips the merge, landing on `pending-review`
14. Proceed to the phase-trace report

For "On override" and "On stop" (options 2 and 3 — reachable only from a real rendered stop), and
the full Hard requirements, see `review-console-interactive.md`.

## Empty-console fast path

If `decisions.md` holds no decision-bearing entries (`AUTO` / `STAGED` / `KEPT-PROMPT` / `REFUSED` / `FAILED` — `SCANNED` audit lines are excluded, see below; `SKIP` audit lines are also excluded, see below) AND `staged/` is empty AND there are no skill/config updates, cleanup actions, queue writes, memory updates, or upstream feedback proposals pending AND the Session-start residue check reports nothing pending, skip the console entirely. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR"` (creates an empty `verify-expectations.json` when none exists, leaves an existing one's fields intact — step 11's exit-3/exit-2 guidance applies here too). Log "Review Console: nothing to review" and proceed to the phase-trace report. When only the residue check reports something pending, do not take this fast path — render the console with only the "Still pending from earlier" line (still write `verify-expectations.json`, and still log that part to `decisions.md` as `SKIP`).

Three kinds of entry never count toward this test, alongside each other:

- **`SCANNED` audit lines** do not count as decision-bearing — the curation engine writes one `SCANNED` line per registry row at `plan`/`record` time, so `decisions.md` always holds at least one; `SCANNED` reports scan scope and outcome, never a decision. An **open** row with a real finding still writes its own separate `AUTO`/`STAGED`/`KEPT-PROMPT` line alongside it — this exclusion only widens the skip to an all-clean run, never one that also found something.
- **`SKIP` audit lines** do not count as decision-bearing either — `SKIP` traces a documented conditional action that was skipped or degraded, nothing to act on. A run that both skipped a step and found a real decision still writes its own separate decision-bearing line too, so this exclusion never masks a real finding.
- **Cleanup rows that are unconditional bookkeeping** — run-dir archival, `cleanup-procedures.md` item 8 — do **not** count as cleanup actions for this test; archival executes regardless, undisplayed. Without that carve-out the fast path could never fire, since item 8's condition now holds on every run.
