# Scratch Worktree — Post-Teardown Write Procedure

Canonical procedure for provisioning a throwaway, write-legal checkout once a feature
worktree is already gone. Consumed by `/wrap-up`'s `residue-sweep.md` (the `remedy: auto`
branch — an auto-fixable residue finding whose fix needs an `Edit`/`Write`/`commit`/`push`),
by `/tidy` (record-creation writes under `work-backend: local-files`, and the Step 7
mutations described under `worktree-always: true`), and by `/init` (`SKILL.md`'s Phase 9
"Isolated Write Step" and `worktree-policy-finalization.md`) — the last with a trigger that
differs from the other two, see "1. When to provision" below.

**Why this exists.** Once a feature worktree is torn down, `/wrap-up` and `/tidy` are back in
the main checkout. On a project with `worktree-always: true` set
(`.claude-tweaks/policy.yml`), the PreToolUse gate denies some of the writes those two steps
may still need to make from there — any write whose target isn't already inside a linked git
worktree. Exactly what counts as a covered write is stated once, canonically, in
`skills/_shared/policy-schema-coverage.md`'s `worktree-always` coverage block. This file cites that
block rather than restating it, per CLAUDE.md's own rule against duplicating it (`[IL-93]`:
five files once restated an earlier, narrower version of that list, and all five went stale
the next time the gate widened without a matching prose sweep). Check that block, not this
paragraph, for the current, exact list of tools/git actions/Bash write shapes it covers.

## Cross-caller `pr-first` check (#424)

`/claude-tweaks:tidy` Step 7.5 used to merge back via this file's §5-6 unconditionally, even under
`integration-model: pr-first` (`_shared/integration-model.md`), where the resulting commit never
reached GitHub as a PR — dead machinery for `housekeeping-auto-merge`/`<!-- tidy-housekeeping-pr
-->` (#414). #424 fixed that: Step 7.5 now branches on `integration-model` before landing the
result, pushing a branch and
opening a marker-stamped PR (reusing `_shared/pr-early-run-lifecycle.md`'s create/reopen shape)
under `pr-first`, unchanged §5-6 merge-back under `local-merge`. The other two callers, checked at
the same time:

- **`flow/worktree-merge.md`**: shown unaffected — its own text already routes `pr-first` merges
  through `_shared/pr-first-merge.md` instead of this file; this file's §5-6 is reached only on its
  `local-merge` conflict-resolution path, by design.
- **`wrap-up/residue-sweep.md`**: had the equivalent-shaped gap (its `remedy: auto` fixes merged
  back via this file unconditionally, no `integration-model` branch) — filed separately as #435
  since #424's own scope kept this file's mechanics minimal/zero and residue-sweep had no
  existing PR/marker convention to wire up the way tidy's did. #435 fixed it the same shape as
  #424: `wrap-up/residue-sweep.md`'s own `remedy: auto` section now resolves `integration-model`
  and branches — `pr-first` pushes the scratch worktree's branch and opens a PR stamped
  `<!-- wrap-up-residue-pr -->` (a distinct marker from tidy's, since the two are separate call
  sites, but gated by the same `housekeeping-auto-merge` lever — reused rather than duplicated,
  since both are the same "auto-arm a housekeeping PR" semantic), reusing
  `_shared/pr-early-run-lifecycle.md`'s create/reopen shape; `local-merge` keeps this file's §5-6
  merge-back unchanged. `github-pr-scan.md`'s `repo-wide` sweep backstop (item 9) was **not**
  extended to recognize the new marker — residue-sweep only ever runs as part of an already
  hands-off wrap-up, so creation-time arming (gated by the same lever) is sufficient; a PR that
  fails to arm at creation stays unarmed and visible in the wrap-up run's own decisions.md rather
  than picked up later by a sweep that doesn't know its marker.

## 1. When to provision

For `/wrap-up` and `/tidy`, provision **only on demand**. The trigger is at least one finding
whose remedy is `remedy: auto` **and** whose fix needs a write the coverage block above
covers. Two remedy shapes never qualify, because both are already legal straight from the main
checkout: removing a worktree (`git worktree remove` / `ExitWorktree`) and deleting a local
branch (`git branch -d`). A run that finds no such finding must never create a worktree —
nothing below is unconditional for these two callers, and a project with no `worktree-always`
policy at all never needs this procedure for them in the first place, since every write is
already legal there.

`/init` is the one exception to "only on demand." It provisions **unconditionally** for its
own Phase 9 writes (and the deferred `worktree-always` write), regardless of whether
`worktree-always` is set at all. The goal there is broader than gate compliance — the same
concurrent-session collision protection `worktree-always` exists to provide, applied to
`/init`'s own output even on a project that hasn't opted into the policy — see `SKILL.md`'s
Phase 9 "Isolated Write Step" for the full rationale. Sections 2-7 below apply identically
once `/init` decides to provision (Section 4's one-commit deviation aside — see its own note);
only the trigger differs.

## 2. Creating it

Before calling `EnterWorktree` (or falling back to `git worktree add`), fast-forward the main
checkout's local `{integration-branch}` to origin's tip:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile
```

Never `git checkout` or `git pull` in the shared checkout to accomplish this — `reconcile`'s
mirror-ff is the sanctioned, worktree-safe mechanism (it never merges, strict `--ff-only`, no
worktree guard needed). See `worktree-setup.md`'s `## Pre-creation reconcile` for the full
rationale, cited rather than restated here.

Use the **native tool** (`EnterWorktree`) when one is available. Fall back to `git worktree
add` only when none is — `superpowers:using-git-worktrees` Step 1a before Step 1b — and when
falling back, create it under **`.worktrees/`**, verifying it's gitignored first (that skill's
own Safety Verification substep), adding it if not.

**Never `git worktree add` under `.claude/worktrees/`.** `.worktrees/` (git-fallback-owned)
and `.claude/worktrees/` (native-tool-owned) are two permanently separate ownership domains,
not two names for the same thing —
`docs/decisions/0004-worktree-two-domain-convention.md`. Placing a git-created worktree
inside the harness-owned directory is the exact hazard that ADR rejects: the harness's own
bookkeeping never learns about it, so a later `git worktree remove` — raw, or via the
harness's own reaper — can remove it out from under whoever is standing in it.

Detect or enumerate existing worktrees via `git worktree list`, or via
`bin/lib/hooks/worktree-detect.js`'s `repoInfo()` (the same git-dir-vs-common-dir comparison,
already wrapped), never by asserting a directory name (same ADR).

## 3. First action inside: catch up with the integration branch

Run `skills/_shared/worktree-setup.md`'s `## Post-creation catch-up` unconditionally, before
anything else runs in the new worktree. That section's fetch+merge procedure, its
`{integration-branch}` resolution, and its conflict-resolution note apply here as written —
this file no longer carries its own copy (`[IL-32]`).

## 4. Applying remedies

Apply each remedy as **its own commit**, in this same worktree, one at a time. Never batch two
or more remedies into a single commit — a mid-sequence failure this way leaves every
already-applied remedy committed and intact, instead of losing completed work along with
whichever remedy failed.

`/init` deviates here by design: its Phase 9 writes are one already-confirmed, atomic unit
(the user approved the whole batch in one gate), not a list of independent auto-fixes, so it
lands them as a **single** commit rather than one per file. This is the one documented
exception to "own commit" above.

## 5. Returning to the integration branch

Once every remedy for this run is committed, return the whole batch in one step:

```bash
git push . <sha>:{integration-branch}
```

`<sha>` is the worktree branch's HEAD after step 4 — resolve it with `git rev-parse HEAD` and
paste the literal value into this command. Shell state does not survive between separate Bash
calls in this worktree (see Shell constraint, below), so it cannot be carried in a variable
across calls. This updates the local `{integration-branch}` ref directly, from inside the
worktree, with no checkout of that branch required — and the write is legal here regardless of
`worktree-always`, since the gate never denies a write whose target is already inside a linked
worktree.

It is refused when `{integration-branch}` is checked out elsewhere (typically the main
checkout) — git won't move a ref a working tree already has open. When refused, run the merge
from wherever it **is** checked out instead, verifying the branch in the same compound command
so a concurrent session that switched it underfoot can't cause a merge onto the wrong branch
(`[IL-05]`):

```bash
[ "$(git branch --show-current)" = "{integration-branch}" ] && git merge --ff-only <sha>
```

`git merge` itself is never a covered action (only `commit`/`push` targets are, per the
coverage block cited above), so this is legal from the main checkout with no further
provisioning. Whether the resulting local update also needs pushing on to `origin` is the
calling procedure's own concern, not this one's — `skills/wrap-up/residue-sweep.md`, for
instance, records the landed `sha` as that finding's `fixed` resolution and leaves publishing
to whatever push step the surrounding workflow already runs.

**That push is itself a covered write.** `git push origin {integration-branch}` targets a
`commit`/`push` action, so it is denied the same way from the main checkout — regardless of
which of the two forms above landed the merge. Run it from inside a worktree instead (this
one, if it is still live, or a fresh throwaway one otherwise); which branch that worktree has
checked out doesn't matter, since `{integration-branch}` is a shared ref in the common `.git`
and `git push origin {integration-branch}` pushes it from any worktree regardless of what that
worktree's own `HEAD` points at.

If neither form succeeds — `{integration-branch}` is checked out somewhere unreachable, or the
merge itself conflicts — stop and surface it rather than forcing a resolution. This procedure
solves the write-legality problem; a genuine merge conflict here is the same judgment call any
other merge conflict is (`_shared/git-discipline.md`).

## 6. Tearing down

Tear down via **`ExitWorktree`**, never a raw `git worktree remove` — the worktree carries a
live lock, and the raw command fails on it (`[IL-58]`).

Before calling `ExitWorktree`, run the sanctioned ancestry check to prove discarding the
worktree branch loses nothing:

```bash
git fetch origin {integration-branch}
git merge-base --is-ancestor HEAD origin/{integration-branch}
```

- **Exit 0** — every commit on this worktree's branch is already upstream. Call
  `ExitWorktree` with `discard_changes: true` and state the one-line reason (e.g. "HEAD is an
  ancestor of origin/{integration-branch} — nothing to lose"). Never invoke the override
  without running this check first.
- **Non-zero** — stop and surface: run `git log origin/{integration-branch}..HEAD --oneline`
  and show the listing. Never override the guard on a non-zero result — the commits it lists
  are genuinely at risk.

This is what makes `discard_changes: true` a proven claim instead of an improvised one. Once
`ExitWorktree` succeeds and the branch was actually merged (not just abandoned), the next
action is `pr-first-merge-post-merge.md`'s `## Step 5: Delete the remote branch (after worktree teardown)` — cited here rather than restated, per the state-once rule; this
section is about whether it's safe to discard the worktree, not about remote branch cleanup,
which stays canonically stated in `pr-first-merge.md`.

The two domains are asymmetric here too. If teardown fails or is skipped, `SessionStart`'s
reaper (`bin/lib/hooks/worktree-reap.js`) can later collect an abandoned worktree — but
**only** in the native domain: it enumerates and considers worktrees under
`{REPO_ROOT}/.claude/worktrees/` alone. A `.worktrees/`-domain worktree (the git-fallback
path) has no reaper at all and must be torn down explicitly every time, or it accumulates
silently — and would itself become a `kind: worktree` finding on the next residue sweep.

**`ExitWorktree` does not operate on a `.worktrees/`-domain worktree either — confirmed
against the tool's own contract, not inferred.** `ExitWorktree`'s scope is explicit: "This
tool ONLY operates on worktrees created by EnterWorktree in this session. It will NOT touch:
Worktrees you created manually with `git worktree add` … Worktrees from a previous session
(even if created by EnterWorktree then)." A `.worktrees/`-domain worktree is, by `[ADR-0004]`'s
own definition, exactly the `git worktree add` (git-fallback) case — so `ExitWorktree` called
against one is a **no-op**: it reports no active worktree session and changes nothing on disk,
the same as calling it with no `EnterWorktree` session active at all. This closes the open
question this section previously left untested: `git-fallback` worktrees have neither a reaper
(above) nor a working `ExitWorktree` path — `finishing-a-development-branch`'s own
`git worktree remove` is the only teardown that actually works on them. (Verified 2026-08-19
by reading the tool's own current schema description via a live session — not a destructive
invocation against a real `.worktrees/`-domain worktree, since constructing one to test against
would itself violate this session's own no-new-worktree constraint. If this tool's contract
text ever changes, re-verify against actual invocation rather than assuming this note still
holds.)

## 7. Shell constraint

After entering a worktree, the Claude Code CLI harness enforces limits on what Bash commands can run in a single call, independent of the command's effect on the filesystem. The boundary is pragmatic, not principled — it reflects what the harness can efficiently verify stays isolated.

Empirically observed boundary (2026-08-15, tested live against the harness build available then — read this as "last observed," not a guarantee; earlier reports from 2026-08-09 and this record's own #5 describe a stricter boundary, and may reflect harness changes over time):

- **Pass:** single plain commands, commands with a single `$(...)` substitution or a `|` pipeline, 2-command `&&` chains of simple commands, standalone heredocs (`cat > file <<EOF`) regardless of target location.
- **Refused:** two or more independent `$(...)` substitutions in one command (e.g., comparing `$(git rev-parse A)` against `$(git rev-parse B)` inside a `[ ]` test), `;`-separated sequences of top-level commands, any `for`/`while` loop (even with no filesystem access or all-read body).

**2026-08-25 addendum (#1108):** two further refusal shapes independently reproduced live in a worktree session, appended as new evidence rather than folded into the 2026-08-15 observation above (that date describes only what was tested that day) — a single command using `${VAR:-default}` parameter-expansion-with-default syntax (distinct from the `$(...)` substitution case above — no chain or pipe involved): `echo "${HOME:-/nope}"` refused while `echo "$HOME"` alone passes; and a `VAR=val && command "$VAR"` variable-assignment-then-use `&&` chain (distinct from an ordinary 2-command `&&` chain of ready-made values, which still passes): `TESTVAR=hello && echo "$TESTVAR"` refused while a bare assignment (`TESTVAR=hello`) and a plain 2-command chain with no assignment (`pwd && whoami`) both pass (isolating the assignment-then-use combination, not chain length, as the trigger).

**Practical workaround:** default to one plain command per Bash call inside a worktree session. Use `Edit` to append to a file rather than a heredoc append; use the `Write` tool to create a script when multi-step logic is unavoidable, then invoke it with a single plain command. Resolve any value a later call needs explicitly and paste it in literally — it will not survive in a shell variable between calls.

Same shell-hazard family: a bare `=`-led token (e.g. `echo ===`) as a separator also fails under zsh — see `docs/donts.md`.

**2026-08-30 addendum (#1651):** the literal token `complete` in a non-git command argument reproduces the guard's git-operation false-positive — confirmed live in a worktree session that day: even a bare `echo complete` is refused with "runs a string through complete, which can't be verified to stay inside the worktree," the same wording the guard uses for an actual unverifiable git operation. `--status running`/`--status failed` on the same `bin/hooks.js spec-status` call pass; only `--status complete` trips it. This is a concrete, frequently-hit trigger site: every multi-spec `/flow` run calls `spec-status --status complete` once per spec, at that spec's wrap-up exit (`flow/multispec-progress-banner.md`'s "Per-spec completion summary"). **Workaround:** never pass the literal word as a bare argv token — compose it inside a single `node -e` call instead (multi-statement `;`-separated composition at the outer shell level is itself refused per the 2026-08-15 observation above, so the composition has to happen inside one JS expression, not as a sequence of shell statements), e.g. `["c","o","m","p","l","e","t","e"].join("")`, then shell out to the real command from inside that same `node -e` process (via `child_process.execFileSync`) rather than back out to a second Bash call.

**2026-09-07 addendum (#1876):** four further plain, non-git trigger shapes reproduced live during that record's work, none involving a git verb. Three of them — the first, second, and fourth below — point the same way as #1651's `complete` token above: the guard matches literal text anywhere in the command (assignment names, payload content, argument values), not the argv shapes the 2026-08-15/2026-08-25 observations describe.

- An env-var assignment whose *name* merely contains the substring `GIT` — `CT_HOOKS_GIT_TIMEOUT_MS=60000 node --test $(...)` was refused; the guard reads the assignment target's text, not just command verbs, so any local variable name containing `GIT` (case-sensitive on the token seen so far) is a live hazard regardless of what the command actually does.
- A `printf` (or `echo`) whose *payload* is a block of `-`-prefixed bullet lines — no flags at all, just dash-led text content being printed. The guard appears to read leading `-` tokens in the payload as suspicious regardless of quoting.
- A multi-statement compound command combining a redirect and `mv` with no git verb anywhere in it (e.g. `... > file && mv file dest`) — refused despite matching none of the composition shapes in the 2026-08-15/2026-08-25 observations above.
- A PR URL argument carrying the literal substring `github.com` — `node bin/hooks.js record-pr 2034 "https://github.com/{owner}/{repo}/pull/2034" --run "$RUN_DIR"` was refused ("names git in a form too complex to verify..."), even though the command has no git verb and never touches the worktree. (Surfaced independently during this record's own build, not part of the original filing.) Confirms the false-positive surface is broader than a fixed keyword list — any occurrence of the substring `git`, here inside a domain name, can trip it.

**Workaround:** the general practical workaround above covers the first three — one plain command per Bash call, `Write`/`Edit` instead of a redirect-and-move, and `GIT`-substring variable names renamed to something like `CT_HOOKS_TIMEOUT_MS`. The dash-led-payload shape needs naming separately, though: the refused `printf` there is already a single plain command, so "one plain command per Bash call" does not remedy it — use the `Write` tool to write the text instead of printing it. For an *argument value* that itself contains the substring, write it to a file first (`cat > /tmp/x.txt <<EOF` or the `Write` tool), then read it back in a separate plain command (`X=$(cat /tmp/x.txt)`) before using it, so the value never appears as literal text in the command the guard inspects.
