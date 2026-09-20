# Staged Patch — validate at staging, describe the invariant, fall back at the console

Canonical contract for every code-fix proposal that a pipeline phase stages under
`.claude-tweaks/pipelines/{run-id}/staged/` as a `.patch` for the Review Console to apply
later. Stated once here; the staging sites (`review/step3-routing.md`'s Auto-mode routing table,
`test/SKILL.md`'s Step 3 stage flow, `_shared/multi-agent-coordination.md`'s reproduction
staging, `deepen/SKILL.md`'s auto-mode collapse staging) and the console apply steps
(`wrap-up/review-console.md` "On approval", `flow/multispec-review-console.md` "On approval")
cite this file rather than restating it.

## Why

A patch is staged mid-pipeline, in a worktree whose HEAD advances several more times before the
console runs — `/simplify`, polish, `/test` fix waves, later specs in a multi-spec run. Staleness
is therefore structural, not an edge case: the literal diff bytes are the least durable part of
the proposal. Staleness isn't only a cross-phase, cross-run concern — `/claude-tweaks:review`'s own
`review/code-mode-steps.md` Step 5 (`/claude-tweaks:simplify`) runs after Step 3 Routing within the
same review pass, over the same diff scope a Step 3 patch may have just staged; a patch staged at
Step 3 can go stale before the console ever sees it. Re-validate any patch staged this run with
`git apply --check` after Step 5 runs, and re-derive it (same procedure as the console's own stale-diff
fallback below) if it no longer applies — cheaper to catch here, against the diff still in this
review's own context, than to leave it for the console's cold re-derivation later. This is `_shared/reverify-before-write.md`'s pattern applied to a staged diff
specifically: the console is a long-lived human-confirmation gate, so the console apply step
below never trusts the diff bytes as still-true — it re-derives from the `Invariant:` line
against the current tree instead of assuming the snapshot staging captured still holds. Two things went wrong in run 2026-08-16T164927 that this contract closes: a staged
diff was malformed and nobody noticed until `git apply` failed at the console ("No valid patches
in input"), and a well-formed diff went stale because `/simplify` legitimately restructured the
target lines after staging. Both surfaced only at the console, where the one-line fix had to be
re-derived by hand.

## Artifact format

One file per proposal, `staged/{slug}-{n}.patch` (`review-{n}.patch`, `test-fix-{n}.patch`,
`review-unconfirmed-{n}.patch` — each site keeps its existing filename). The file is a unified
diff **preceded by a description preamble** — free text before the first `diff --git` header,
which `git apply` skips (the same tolerance that lets it apply `git format-patch` output):

```
Target: {repo-relative path of the file the fix edits — one line per file when the diff touches several}
Invariant: {one sentence — the property the edit establishes, stated so it can be re-derived without the diff; e.g. "the `rel` assignment normalizes separators to posix before comparison" — one line per `Target:` line, in the same order, when the diff touches several files}
Finding: {severity} {category} — {the finding text as logged}
Staged-at: {short sha of the worktree HEAD at staging time}
Ledger: {docs/plans/{feature}-ledger.md}#{item-number}

diff --git a/{path} b/{path}
--- a/{path}
+++ b/{path}
@@ ... @@
```

`Target:` and `Invariant:` are the durable intent — the console's fallback (below) re-derives the
edit from them alone. `Finding:` ties the artifact back to its `decisions.md` entry. `Staged-at:`
lets the console show what moved (`git diff --stat {Staged-at}..HEAD -- {Target}`, or the literal
`{Staged-at} no longer resolves` when a rebase or gc removed that sha) when a diff has gone stale. The diff is the fast path, never the only path. A multi-spec console applies
patches "against the cumulative pipeline state," so `Target:` must be an explicit repo-relative
path — cumulative drift stays resolvable only when the fallback knows which file to open — and it
must resolve inside the worktree root: the console rejects an absolute path or a `..`-escaping
value (route to step 4) before opening anything.

`Ledger:` names the exact open items ledger row this finding was also appended to — the staging
site assigns the ledger item's number first (`_shared/ledger-format.md`'s Item Numbering), then
composes this preamble referencing it, so the two writes always agree on one number. Present
whenever the staging site also appends the finding to a ledger file (every current site does);
omitted only for a proposal that has no corresponding ledger row by design. The console apply
procedure below uses this field to write its outcome back to the named row — see "Write-back to
the ledger" — closing the gap `_shared/ledger-format.md`'s Resolve Gate documents for Phase 2/3
routing but that, before this field existed, the console's own apply step had no mechanical way to
honor for a staged finding it applies directly.

## Staging-time gate

Immediately after composing the file, and before logging it as staged, run — from the worktree,
the same tree the diff was composed against. `$STAGE_PATH` is the staged file's **absolute**
anchored path, per the staged-file invariant whose single owner is `_shared/pipeline-run-dir.md`'s
Anchoring section; the command runs with cwd = the **worktree root** the diff was composed
against — always the `-C` form below, never a bare `git apply --check` from whatever cwd happens
to be current (a bare form validates against the wrong tree silently):

```bash
git -C "$WORKTREE" apply --check "$STAGE_PATH"
```

- **Exit 0** — the artifact is well-formed and applies to the tree it was written against. Keep
  it; write the site's normal `STAGED {time} — … Stage path: staged/{slug}-{n}.patch.` entry.
- **Non-zero, tooling error** — decided by the patch file, not by stderr text: run
  `test -r "$STAGE_PATH"` first (and confirm `$WORKTREE` is a git worktree). An unreadable or
  missing `$STAGE_PATH` means the check could not run at all — a path or anchoring problem, not a
  composition error. Surface it — log `STAGED {time} — {step}: {finding} — gate could not run:
  {first stderr line} — path/anchoring problem, not a composition error. Reversibility: high.` —
  and keep the `.patch` as written, unvalidated. Never treat this as malformed and never delete
  the artifact. Do **not** classify by matching `No such file` in stderr: a hunk whose target path
  does not exist prints the same words, and that is a composition error (next branch).
- **Non-zero, malformed or doesn't apply** — every other non-zero exit on a readable patch file:
  the diff is malformed (`patch with only garbage`, `No valid patches in input`, `corrupt patch`),
  names a target that does not exist, or already doesn't apply to the tree it was just composed
  against. **Do not keep the `.patch`.** Recompose the diff once from the current tree
  and re-check. If it fails again, delete the `.patch`, write the description alone to
  `staged/{slug}-{n}.md` (the same `Target:`/`Invariant:`/`Finding:`/`Staged-at:`/`Ledger:` block, no diff),
  and log the composition error where it happened rather than at the console:

  `STAGED {time} — {step}: {finding} — patch failed \`git apply --check\` at staging ({first stderr line}); staged description-only at staged/{slug}-{n}.md. Reversibility: high.`

  The finding is not lost — the console applies a description-only stage through the same
  fallback it uses for a stale diff. Under `auto` this is a log line and a degraded artifact,
  never a mid-flow stop (`_shared/auto-mode-contract.md`).

## Console apply with description fallback

For each staged `.patch` (and each description-only `.md` written by the gate above), in the
order the console lists them:

1. **Fast path** — `git -C "$WORKTREE" apply --check "$STAGE_PATH"`; on exit 0, `git -C "$WORKTREE" apply "$STAGE_PATH"` and
   log `AUTO {time} — Review Console apply: staged/{slug}-{n}.patch applied. Reversibility: high (commit).`
2. **Stale diff (expected, not exceptional)** — on a non-zero check (`patch does not apply`,
   `patch failed`), read the preamble's `Target:` and `Invariant:` line(s) — pair them in order — open each
   target file in the *current* tree, and establish its invariant with a direct edit — the same Edit-based path the
   console already uses for `.md` proposals. Then re-read each target to confirm its invariant
   holds. Log `AUTO {time} — Review Console apply: staged/{slug}-{n}.patch stale ({first stderr line}; target moved since {Staged-at}: {git diff --stat summary}); re-derived from Invariant via direct edit. Reversibility: high (commit).`
   - **Scope floor:** the re-derivation establishes the stated `Invariant:` and nothing else — if
     the edit required is materially larger than the staged diff's own hunk(s), or the
     `Invariant:` admits more than one reading in the current tree, do NOT compose; route to step
     4 instead.
   - **Unattended floor:** under `autonomy: unattended` + `consoleAutoResolve`
     (`_shared/autonomy-ceiling.md`) — where the console's apply runs with no human approval — the
     re-derivation is never auto-applied at all. Only the fast path (a reviewed diff that still
     applies) executes unattended; a stale diff routes to step 4 (left `open`, surfaced) unless the
     invariant already holds. A re-derived edit is LLM-authored code nobody reviewed — the reviewed
     artifact was the diff bytes, and those no longer fit. A `staged/deepen-collapse-{n}.patch`
     (an architecture collapse staged by `/deepen`) additionally never executes unattended even on
     the fast path — depth refactors require an attended console; route it to step 4 (left `open`,
     surfaced) instead.
   - If the invariant **already holds** in the current tree (a later phase fixed the same thing),
     make no edit and log `AUTO {time} — Review Console apply: staged/{slug}-{n}.patch already satisfied by {commit or phase}; dropped. Reversibility: n/a (no edit).`
   - A `.patch` missing either `Target:` or `Invariant:` (no preamble at all — staged by an older
     installed build that predates this contract — or a partial one) that fails `git apply --check`
     has nothing complete to re-derive from — route straight to step 4 rather than attempting the
     re-derivation above (expand-contract read-side tolerance).
3. **Description-only stage** — no diff to try; go straight to step 2's re-derivation.
4. **Cannot re-derive** — the `Target:` file no longer exists or resolves outside the worktree root, the `Invariant:` no longer names
   anything in it (the code the finding was about was removed), the edit fails the scope floor
   above, or the staged `.patch` lacks a `Target:` or `Invariant:` to re-derive from. Do not guess and do not drop
   silently: leave the item's ledger entry `open`, render it in the console's "Not applied" footer
   with the reason, and log `STAGED {time} — Review Console apply: staged/{slug}-{n}.patch could not be re-derived ({reason}). Left open — see the console's "Not applied" footer. Reversibility: high (nothing applied).`

Both consoles' `--dry-run` modes (`wrap-up/review-console.md`, `flow/multispec-review-console.md`)
print each of these outcomes as a preview line and execute nothing — no `git apply`, no `--check`,
no edit — consistent with the consoles' own dry-run bullets.

### Write-back to the ledger

The console apply log entry above (`decisions.md`) is never the only record of an outcome — when
the preamble carries a `Ledger:` field, the same apply step also updates that exact row in
`docs/plans/{feature}-ledger.md` (`_shared/ledger-format.md`'s Ledger File Format), or its run-dir-scoped alternate — see that file's Location section, in the same
pass, before moving to the next staged item:

| Outcome (numbered above) | Ledger Status | Ledger Resolution |
|---|---|---|
| 1. Fast path applied | `fixed` | commit hash from the apply commit |
| 2. Stale diff re-derived | `fixed` | commit hash from the apply commit |
| 2. Invariant already held (dropped) | `fixed` | `{commit or phase} (already satisfied)` |
| 4. Cannot re-derive | `open` (unchanged) | `—` (unchanged) |

A `.patch` staged before this field existed carries no `Ledger:` line — the write-back step is
then a no-op for that item (expand-contract read-side tolerance; nothing to update, nothing
errors). This is what closes the gap: without it, an applied finding's resolution lived only in
`decisions.md`, and the ledger file's own Status column kept reporting `open` for work that was
actually done — the drift a manual audit of six pipeline runs' ledgers found in 2026-08-18 (19 of
20 `open`-marked items were already resolved elsewhere).

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Staging a diff without `git apply --check` | A malformed diff is first discovered at the console, hours later, by a different reader — the composition error belongs to the phase that composed it |
| Hand-retyping a diff's hunk body when composing the staged `.patch` instead of concatenating the preamble with `git diff`'s own output verbatim | A single dropped context line (a blank line rendered as a lone space, easy to lose in transcription) silently changes the actual line count against the `@@ -a,b +c,d @@` header, producing `corrupt patch` at `git apply --check` — compose by concatenating the preamble with the unmodified `git diff` output, never by retyping hunk lines |
| Staging only the diff, no `Invariant:` | Later phases legitimately move the target; with no description the console can only error out or hand-derive the fix from the finding text |
| Treating a stale diff as a failure | Staleness is the expected end state of a diff written mid-pipeline; the description is the durable intent, the diff bytes are a cache |
| Silently dropping an item that can't be re-derived | The finding was real when staged; a vanished target is a human decision, not a no-op |
| Restating this procedure at a staging site or console | The two consoles and three staging sites drifted apart once already — cite this file. A citing site may restate the preamble field names, the gate command, and its own `staged/…-{n}.patch` filename as anchors (what the conformance test pins) — never the branch logic (what happens on a failed check, the fallback steps) |
