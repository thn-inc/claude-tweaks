---
name: release
description: Use to cut a release — reads the preflight pack, runs the whole-branch review before the bump, renders one console, drives the engine, verifies tag and hook, closes shipped records. Keywords - release, tag, changelog, release-please, release train, Release-As.
argument-hint: "[--dry-run] [--train] [--as <version>] [--allow-blocking]"
---

# Release — Drive a Release Through Whichever Engine the Project Uses

This skill **drives** a release; it never implements one. The bump, the changelog, the tag and the GitHub Release are produced by release-please (pr-first) or by `bin/release-local.js` (local-merge) — this skill reads the facts, runs the gate that must precede a bump, picks the engine, checks that what the engine claimed actually landed, and books the records that shipped.

Lifecycle: `/claude-tweaks:wrap-up` → **`/claude-tweaks:release`** (on demand, suggested, or the train)

## When to Use

- The integration branch carries unreleased conventional commits and you want them tagged and published
- `/claude-tweaks:wrap-up` or `/claude-tweaks:flow` recommended a release in its Next Actions (that recommendation is itself gated on a preflight pack showing unreleased work — never rendered from an unverified premise)
- The release train Routine fires on its schedule and invokes this skill with `--train`
- A `Release-As:` override is needed — a version the commits alone would not derive (`--as <version>`)
- The user says "cut a release", "ship it", or "tag a version"

## Input

`$ARGUMENTS` is parsed as `[--dry-run] [--train] [--as <version>] [--allow-blocking]`. All four are optional; a bare invocation with no arguments is the normal on-demand release.

| Flag | Effect |
|------|--------|
| `--dry-run` | Step 5 is a no-op — nothing is merged, nothing is tagged, no `Release-As:` commit is pushed. Step 3's whole-branch review **still runs** and still stages its findings (a dry run must surface what a real run would block on), and Step 4 still renders the console. Step 6 does **not** run either — there is no tag, Release or hook run to look for, and probing for one would render a false partial state. Step 7's bookkeeping does **not** run — nothing shipped, so there is nothing to book. Step 8's summary reads `dry-run`. |
| `--train` | The unattended path (see `## --train semantics`). Step 4's console is never interactive. The two HARD-GATEs — `review: blocking`, or a major bump on the effective version — stage `release-held.md` in the run directory before Step 5 and exit `HELD`. Refused unless policy `release-train` resolves `true` **and** `autonomy` resolves `unattended`; a refused `--train` behaves exactly as an on-demand invocation, never as an accepted one. |
| `--as <version>` | The `Release-As:` override. Validated against `^\d+\.\d+\.\d+$` — a strict three-part semver, no `v` prefix, no pre-release or build suffix; anything else is a usage error, printed and exited before Step 1. **Both engines.** Under pr-first the value becomes a pushed `Release-As:` commit release-please re-renders; under local-merge (#2326, ledger row 90 closed) it is passed straight through as `bin/release-local.js --release-as {version}`, which validates it is ahead of the derived base and exits `2` (naming both versions) if it is not. Either way the value becomes the **effective version** for every gate and render up to Step 5: Step 4's console row, the major-bump HARD-GATE, Step 5's engine invocation. Steps 6 and 7 use the **shipped** version the engine actually produced (Step 5's "Two versions, reconciled once") — under `--as` the two are expected to agree, and a disagreement is `PARTIAL`, never a `Shipped in` comment carrying the override. |
| `--allow-blocking` | A human who has read the finding overrides a `review: blocking` verdict from Step 3. It never skips the review — Step 3 runs, its findings stage, and the override is logged with the finding paths it overrode. **Never honoured under `--train`**: an unattended run has no human to have read anything, so the pair is an override without a reader. |

**Combinations.** `--train --dry-run` is refused as contradictory — the train exists to land a release unattended, and a dry run lands nothing, so the pair names no real outcome. Print the usage line and exit without resolving a run directory:

```
release: --train --dry-run is contradictory — the train lands a release; a dry run lands nothing. Pick one.
usage: /claude-tweaks:release [--dry-run] [--train] [--as <version>] [--allow-blocking]
```

`--train --allow-blocking` is not a usage error — it parses, and the `--allow-blocking` half is simply not honoured (logged as ignored at Step 3's verdict). Every other combination is legal.

## Step 0: Run directory and engine

Under `--train`, read `## --train semantics` first — its two policy levers are checked here, before anything else, and a refusal is logged from this step.

**Resolve `$RUN_ROOT` first.** Every later command in this skill that names it — `git -C "$RUN_ROOT"`, `--root "$RUN_ROOT"` — re-resolves it with exactly these two lines, because an `export` does not survive into the next Bash call. This is `_shared/pipeline-run-dir.md`'s Anchoring snippet, verbatim:

```bash
RUN_ROOT=$(git rev-parse --git-common-dir)
RUN_ROOT=$(cd "$(dirname "$RUN_ROOT")" && pwd)
```

Then resolve the run directory per `_shared/run-dir-resolution.md` (steps 1-2: `PIPELINE_RUN_DIR`, then the most-recent matching directory), anchored to that `$RUN_ROOT`. When neither resolves, create the standalone fallback and stamp it — `release` has its own every-mode clause under that file's step 4, the same shape as wrap-up's and not the `auto`-gated allowlist (which is why the snippet below omits `--mode`), and this stamp is the second of the two direct `run-state.json` writes it names:

```bash
RUN_DIR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug release 2>/dev/null)
if [ -z "$RUN_DIR" ]; then
  # Steps 1-2 found nothing (or step 1's adoption-time anchoring check rejected a
  # worktree-trapped PIPELINE_RUN_DIR, [IL-127]) — clear it for this second call so a
  # rejected value is never re-consulted, then mint the standalone fallback.
  RUN_DIR=$(PIPELINE_RUN_DIR= node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --spec-slug release --standalone release --create)
  printf '{"status":"active","createdBy":"release-standalone"}\n' > "$RUN_DIR/run-state.json"
fi
echo "$RUN_DIR"
```

`$RUN_ROOT` is the main checkout, never a worktree cwd — a bare relative path silently shadows the main copy (`[IL-127]`). An `export` inside this snippet does not survive into the next Bash call; re-resolve with the same snippet in any later step that needs the path, and carry the resolved path as a fact of this run.

**Determine inherited-vs-created here, once.** At this point — and only here — record which of the two branches above ran: `$PIPELINE_RUN_DIR` was already set at invocation, or an existing directory resolved at step 2 (whatever its `createdBy` — a prior standalone release run's directory counts) → **inherited**; this run minted the directory and wrote the `createdBy: "release-standalone"` stamp above → **created**. Carry that verdict as a run-scoped fact alongside the run dir path itself and **never re-read it from disk later** — the directory can be archived out from under a re-read, exactly as `wrap-up/SKILL.md`'s identical rule records.

**Pin the review's auto-apply ceiling to `none`, here.** Step 3 reviews history that is already merged, so it has nothing to fix in place: a finding applied automatically there would land an unreviewed commit on the integration branch between the gate and the bump, and ship in the very release the gate exists to hold. For a **created** run directory, write the lever once:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/set-config.js" --run "{run-dir}" --key review-auto-apply-ceiling --value none
```

For an **inherited** one, do **not** write it — the parent pipeline's Manifesto owns that directory's `config.yml`, and overwriting a lever mid-pipeline would change how the parent's own later steps route. Log instead that the parent's ceiling governs and that Step 3's findings stage regardless of its value (Step 3 states that as a rule, and it holds at every ceiling).

**Every log line this skill writes goes to `{run-dir}/decisions.md` under a `## /release` section**, appended through the canonical writer per `_shared/auto-decision-log.md`'s entry schema — never hand-appended:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --section "/release" --status AUTO --step "Step 1" --text "..." --reversibility n/a
```

**The engine is read from the fact pack's `engine` field in Step 1 — never re-detected here.** Do not call `resolve-policy.js`, do not probe for a remote, do not ask whether `gh` is installed: `_shared/integration-model.md` is canonical for which mechanism a project integrates through, and its Consumer table lists this skill's Step 5/Step 6 dispatch (pr-first `gh pr merge` vs. local-merge `bin/release-local.js`) as a consumer of that one resolution. A second, independent detection inside one run is exactly the ambient inference that file exists to replace, and a transient `gh` failure between two probes would split a single release across two engines.

## Step 1: Preflight fact pack

Run the fact pack once, anchored to the run directory:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/release-preflight.js" --run "{run-dir}"
```

Exit **2** (malformed invocation) or **3** (the run directory does not resolve under the main checkout, or the cwd is not inside a git checkout) is terminal: report the CLI's own stderr line verbatim and stop. Nothing is rendered, no console, no review — there are no facts to render from. Exit **1** (the pack crashed before it could decide) is terminal the same way. Exit **0** means the pack was produced; a degraded field inside it is data to act on, not a failure. Read `{run-dir}/release-preflight.json` and act on each field's `{ok, value | error}` envelope.

| Field | Value when `ok: true` | When `ok: false` |
|-------|----------------------|------------------|
| `engine` | `pr-first` or `local-merge` | **Stop.** Report: `integration-model unresolved — set it in .claude-tweaks/policy.yml` (`integration-model: pr-first` or `local-merge`). A guessed engine picks a release mechanism on a coin flip. |
| `lastTag` | `{tag, version, tipRef}` | **Continue** — this is the first release. The version base comes from `proposedVersion.value.base` (the pack resolves it from the highest `v*` tag, else the manifest); Step 3's review base is the root commit. |
| `unreleased` | `{since, tipRef, commits[]}` — each commit `{sha, type, scope, breaking, breakingNote, subject, description, unconventional}` | **Stop.** The shipped set, the bump and the review scope all derive from this list; without it every later step would be rendering a guess. |
| `proposedVersion` | `{version, part, base, baseSource, tipRef}` | Error beginning `nothing to release` → take **Step 2**'s path. Any other error → **stop**. |
| `releasePr` (pr-first only; `none` under local-merge) | `{number, state, mergeable, headRefName, title}`, or the string `none` | Steps 2, 3 and 4 still run — the review and the console are worth having. **Stop before Step 5** and report the error; a release PR that could not be identified (including the pack's `release PR search inconclusive` case) must never be resolved by picking one by eye. |
| `ciTip` | `{ref, headSha, localSha, tipBehind, state, total, success, failure, pending, truncated}`, or `n/a` under local-merge | Render the console's CI column as `unknown`. **Never green** — an unknown CI state is not a passing one. |
| `openReleasePrConflict` | `true` when any commit on the release PR has a human author | Treat as **`true`** and say so in the console (`human edit could not be ruled out — {error}`). A human edit that cannot be ruled out is a human edit for gating purposes. |
| `hook` | `true`/`false` — a `release: published` workflow exists (pr-first) or `release-hook` is set (local-merge) | Render the console's hook-configured column as `unknown`. This column is presence-only and pre-execution; Step 6's post-execution hook verification is a separate, independent check that never reads this field's value as evidence. |

Log the pack once:

```
AUTO {HH:MM:SS} — Step 1: pack at {run-dir}/release-preflight.json: engine {value}, lastTag {tag|none}, unreleased {n}, proposed {version|degraded: reason}. Reversibility: n/a (read-only).
```

## Step 2: Nothing to release

Take this path when `unreleased.value.commits` is empty, or when `proposedVersion.error` begins with `nothing to release`. Print exactly one line, log it, and stop. **No console renders** — there is no version to gate, nothing to review toward a bump, and nothing to book:

```
release: nothing to release since {lastTag|the first commit} ({n} commit(s), none feat/fix/breaking{; N unconventional})
```

The `; N unconventional` clause appears only when `N > 0` (count `unreleased.value.commits[].unconventional`). When **every** commit since the tag is unconventional, the line instead reads — with the same `{lastTag|the first commit}` fallback, because a first release has no tag to name in either sentence:

```
release: no conventional commits since {lastTag|the first commit} ({n} commit(s), none parseable as conventional)
```

Both are honest about the same fact from different directions: the first says the conventional commits present drive no bump, the second says there are no conventional commits to read. Reporting the second as the first would send a maintainer looking for a missing `feat:` in commits that carry no types at all.

Log it as `SCANNED`, then stop — this is a clean, successful outcome, not a failure:

```
SCANNED {HH:MM:SS} — Step 2: nothing to release since {lastTag|the first commit}: {n} commit(s), {c} conventional, {u} unconventional. No console rendered. Reversibility: n/a.
```

## Step 3: Whole-branch review (before any bump)

**This step has no skip path.** Not under `--dry-run`, not under `--train`, not under `--allow-blocking`, not for a patch bump, not because the last release was yesterday. Design stance 8 and `[IL-97]` are the same lesson from the same incident: a Critical finding surfaced twenty minutes after the v6.48.0 → v6.48.1 release it should have blocked. An unattended train that skipped this gate would reproduce that failure more often, not less.

Resolve the base, then invoke:

- `lastTag.ok` → base is `{lastTag.value.tag}`.
- `lastTag` degraded, but `proposedVersion.value.baseSource` is `manifest` → the project has released before without tagging, so the root commit would put its whole history under review. Base is the first-parent commit that last set the manifest to `{proposedVersion.value.base}` — `git log -1 --first-parent --format=%H -S'"version": "{base}"' {tipRef} -- {manifest path}`, the path the pack's own manifest probe read. Empty output falls through to the root commit below.
- `lastTag` degraded with no manifest version either (no `v*` tag reachable; `unreleased.value.since` is `null`) → base is the root commit: `$(git rev-list --max-parents=0 origin/{branch} | tail -1)`, where `{branch}` is the pack's own `branch` field.

Log which of the three resolved, and why — the review's scope is never a silent choice.

Invoke `/claude-tweaks:review base:{base}` (Input rule 9 — a whole-branch scope: every first-parent commit from the base to `origin/{integration-branch}`, spanning many already-merged PRs) with `$PIPELINE_RUN_DIR={run-dir}` set, so its findings stage into this run's own `staged/` directory per `_shared/staged-patch.md` and its decisions land in this run's `decisions.md`. Review is a component skill here: it renders no Next Actions of its own.

**Invoke it from `$RUN_ROOT`, standing at the fetched tip.** Assert all three first — `git -C "$RUN_ROOT" fetch origin {branch}`, then `git -C "$RUN_ROOT" rev-parse --abbrev-ref HEAD` equal to `{branch}` and `git -C "$RUN_ROOT" rev-parse HEAD` equal to `origin/{branch}` — and run the review with `$RUN_ROOT` as its working directory. `/claude-tweaks:review`'s own test gate verifies the tree it is standing in (`review/code-mode-steps.md`'s Step 1.5), so a review invoked from a feature-branch worktree would gate the release on a tree the reviewed range does not contain. Anything else stops the run here, before Step 4: nothing has moved, so report `stopped before the console: review tree is not origin/{branch}` and Step 8's summary reads `failed` with that same reason.

**This review stages; it never commits.** Whatever `review-auto-apply-ceiling` resolves to — Step 0 pins `none` on a created run directory, and an inherited one keeps the parent's value — this review's auto-apply tier is off at every ceiling: every finding is staged for a human, none is applied and committed. The range under review ends at `origin/{branch}`, the exact tip about to be tagged, so an auto-applied fix would ship inside the release it was meant to gate.

**Mark the `## /review` block before invoking.** `log-decision.js` appends each entry at the **end of its section**, so an inherited (or re-adopted) run directory's prior `## /review` lines sit above this run's inside the same block — and a prior run's `critical finding` line would otherwise be read as this run's verdict. Count that block's existing lines first (`0` when the block is absent) and log the count as this step's marker:

```
AUTO {HH:MM:SS} — Step 3: whole-branch review starting, base {base}..{branch}; ## /review marker: {k} existing lines. Reversibility: n/a (marker).
```

When it returns, read **only the lines this run appended after index `{k}`** in `{run-dir}/decisions.md`'s `## /review` block — never the whole block — and classify **against the log lines `/claude-tweaks:review` actually writes**, not against a severity field it does not emit. Its two routing shapes (`review/step3-routing.md`'s routing table) are:

```
KEPT-PROMPT {time} — Step 3 Routing: critical finding {category} at {file:line}. Surfaced inline. Reversibility: high.
STAGED {time} — Step 3 Routing: high-severity finding {category} at {file:line}. Stage path: staged/review-{n}.patch. Reversibility: high.
```

A critical finding's line carries **no** stage-path clause — it is surfaced inline, not staged — so a classifier keyed on `Routing:` plus a `review-{n}.patch` mention would miss the most severe finding there is. The `Reproduction:` lines (`review/step3-lens-dispatch.md`) carry no severity at all — `AUTO {time} — Reproduction: lens "{lens}" finding {path}:{line} reproduced. Confirmed. …` — so `Confirmed` is not a severity signal and must not be read as one.

| Verdict | Condition |
|---------|-----------|
| `review: blocking` | The lines after the marker contain one carrying the literal token `critical finding` or the literal token `high-severity finding` |
| `review: findings (n medium/low, staged)` | No such line, but they contain any other routed finding — a `Step 3 Routing:` line at `medium-severity finding` or `applied low-severity` |
| `review: clean` | They contain no `Step 3 Routing:` line at all |

A `## /review` block that is absent, empty, unparseable, or carrying no new lines at all after the marker is **not** `review: clean` — it means the review did not complete, which is a stop, not a pass. Report which of the three it was and stop before Step 4.

Log the verdict, and log the override separately when one applies:

```
AUTO {HH:MM:SS} — Step 3: whole-branch review base {base}..{branch}: review: {verdict}. Findings staged at {paths|none}. Reversibility: n/a (gate evaluation).
KEPT-PROMPT {HH:MM:SS} — Step 3: review: blocking overridden by --allow-blocking. Findings overridden: {paths}. Reversibility: low (the release proceeds over a confirmed critical/high finding).
SKIP {HH:MM:SS} — Step 3: --allow-blocking ignored under --train (no human has read the finding). Reversibility: n/a.
```

## Step 4: Console

Read `console.md` in this skill's directory now and render the console it defines: the shipped records, the proposed bump and the commit that drove it, this step's review verdict, the hook-configured column, and the two overrides. Two HARD-GATEs stop the run here for a decision regardless of mode (`console.md` says what each mode does with the stop: `--train` stages and exits `HELD`, interactive asks once) — `review: blocking` (not overridden), and a major bump on the **effective** version — and they are registered as such in `_shared/auto-mode-contract.md`'s HARD-GATE list; everything else renders read-only in `auto` and proceeds.

## Step 5: Execute

Read `execute.md` in this skill's directory now. It holds the engine dispatch: `gh pr merge {releasePr} --squash --repo {owner}/{repo}` under pr-first (with the `Release-As:` push and its bounded re-render poll when `--as` was given), `node "${CLAUDE_PLUGIN_ROOT}/bin/release-local.js" [--dry-run]` under local-merge (no `--as` — see the Input table), and the MCP-only-sandbox posture where the merge renders as a paste-ready command instead of executing. The engine value comes from Step 1's pack (`_shared/integration-model.md`'s Consumer table), never from a fresh detection here. Its pre-merge PR-check read also takes the release PR's **title**, because release-please re-renders that PR as commits land: a bump part that differs from the one Step 4 measured re-runs Step 4's major-bump HARD-GATE before the merge — a major nobody gated on is `HELD` with nothing merged, anything else proceeds on the re-rendered version, logged.

Under `--dry-run` this step is a no-op: no merge, no tag, no `Release-As:` commit, no engine invocation without its own `--dry-run`. Say so in the console and in Step 8's summary rather than reporting a version as released.

**Two versions, reconciled once.** The *gating* version — `--as` when given, otherwise `proposedVersion.value.version` — is what Step 4 rendered and the major-bump HARD-GATE measured. The *shipped* version — the one Step 6 verifies and Step 7 books — is the engine's own: the `released v{version}` line `bin/release-local.js` prints (its exit-5 stderr carries the same), or the `X.Y.Z` in the merged release PR's `chore(main): release X.Y.Z` title under pr-first. The pack proposes; the engine decides, and a sibling release landing between Step 1 and Step 5 or a release-please config the pack does not read can move the number. `execute.md` compares the two after the engine returns: equal is silent; different is logged and the shipped version wins for Steps 6–8 with the summary naming both; under `--as`, a shipped version that is not the `--as` value is `PARTIAL` (the override did not take) — the merge landed, so the shipped version is still verified and booked and the summary names both — never quietly booked as though the override had held.

## Step 6: Verify

Under `--dry-run` this step does not run — Step 5 landed nothing, so there is nothing to verify; go to Step 8. Otherwise read `execute.md` in this skill's directory now — Step 6 lives in the same file, because the verification is engine-specific in exactly the way the execution is. It checks that what Step 5 claimed actually landed: the tag on origin, the GitHub Release (pr-first), and the `release: published` workflow run or the `release-hook` exit (local-merge), on a bounded poll.

**A miss is never rendered as a clean release.** Missing, still running past the bound, and present-but-concluded-failed are three different misses and each is reported as a named partial state with its own recovery command — the same discipline `bin/release-local.js` already applies to its own exits (`5` = the hook failed after the tag landed and the tag is final; `1` = either nothing was written at all or a named partial state — the engine's own stderr says which; quote it, never infer). A hook run that cannot be found is an unverified hook, not a successful one.

## Step 7: Bookkeeping

Read `bookkeeping.md` in this skill's directory now: for each record in the shipped set, a `Shipped in v{version}` comment carrying the Release URL and a close if the record is still open (pr-first, through `_shared/github-write-transport.md` so MCP-only sandboxes work), or a `shipped: v{version}` frontmatter line on the record file (local-merge with local records). Every action logs per `_shared/auto-decision-log.md`.

**Skipped entirely under `--dry-run`** — nothing shipped, so there is nothing to book. Skipped too when Step 5 or Step 6 reported a state in which the tag has not reached origin — the local engine's exit-`1` `partial:` (tagged locally, not pushed) and Step 6's tag-missing probe are the two (`execute.md` and `bookkeeping.md` name them); when the tag landed and only the hook missed, the records did ship and the bookkeeping runs, with the partial state named in Step 8's summary.

## Step 8: Summary and Next Actions

Render one summary block:

```
release: {version} — {released | dry-run | HELD | PARTIAL | failed}
engine:  {pr-first | local-merge}
records: {n} {shipped | would ship}{, m unattributed commits}
{bookkeeping: {k} of {n} failed — #a (read), #b (close), when Step 7 reported k > 0}
{partial state and recovery command, when the outcome is PARTIAL}
{gate and staged path, when the outcome is HELD}
{the engine's or forge's own error line, when the outcome is failed}
```

The `records:` line varies with the outcome, because "shipped" is only true when something shipped:

- `released`, and `PARTIAL` where Step 7 ran (the tag reached origin, only the Release or the hook missed) — `records: {n} shipped{, m unattributed commits}`.
- `dry-run`, `HELD`, and `PARTIAL` where Step 7 did not run (the tag has not reached origin) — `records: {n} would ship{, m unattributed commits}`. Nothing was booked in any of these, and the same form is used for all: they name the set that *would* have been booked. The key is whether Step 7 ran, never the outcome word alone.
- `failed` — `records: 0 shipped`. Nothing landed, so there is no set to name.

**The `bookkeeping:` line renders only when `{k} > 0`, and is omitted entirely when `{k}` is `0`.** Its `{k}`, `{n}` and per-record entries come from Step 7's own tally — `bookkeeping.md`'s `{n} records commented, {m} closed, {k} failed` summary line and its per-record `FAILED` lines — with each failed record named by number and by the verb from its `FAILED` line (`read`, `comment`, `close`, `shipped`, or the step-level `commit`). Without it a run whose every record failed to book still renders `released` and nothing else, and the unbooked records are discoverable only by reading `decisions.md`.

The five outcomes are distinct and never folded together:

- **`released`** — Step 5 landed and Step 6 verified every check. It keeps that meaning exactly: the `bookkeeping:` line, when it renders, **qualifies** `released` rather than downgrading it — the release is real and verified, and some of its records are not yet booked.
- **`dry-run`** — Step 5 was a no-op by request. `{version}` is the version that *would* have been cut.
- **`HELD`** — a HARD-GATE fired at Step 4, **before** Step 5, in **any** mode — `--train`, `auto`, headless, or an interactive run whose gate question was answered `Stop`. Nothing was merged, nothing was tagged, nothing moved; `release-held.md` is staged in the run directory in every one of those cases (console.md's Gates section). An interactive `Proceed` answer is not `HELD` — the run continued to Step 5 and its outcome is whatever Steps 5–6 produced. A third reason carries the same word beside those two HARD-GATEs: pr-first with no `gh` on `PATH`, where Step 5 renders the merge as a paste-ready command for a human instead of executing it (`execute.md`'s Transport section) — nothing merged, nothing tagged, `release-held.md` staged, exactly the fact `HELD` asserts.
- **`PARTIAL`** — Step 5 landed and Step 6 found a miss. The release exists; something after it did not complete. Never reported as `HELD` (which means nothing landed) and never as `released`.
- **`failed`** — nothing landed and no HARD-GATE fired: either the run stopped before the console for a reason that is not a gate (a refused `--train` with no human present at Step 0; Step 3's review-tree assertion), or Step 5 was attempted and landed nothing — the engine exited `1` with nothing written or `4` on a tag collision; the release PR's own checks were red, still pending past the bound, unreadable, or the PR was closed; the forge refused the merge; or the `Release-As:` push was rejected or its re-render never arrived within its bound — that poll times out **before** the merge, so nothing landed. Nothing exists to verify or book; the error line is the engine's or forge's own, quoted verbatim. Never reported as `HELD` (no gate fired) and never as `PARTIAL` (nothing landed). A shipped version that is not the `--as` value is **not** in this list: that comparison runs after the merge, so it is `PARTIAL` with the named state `override did not take`, and the shipped version is verified and booked.

Then render the `## Next Actions` block below — unless Step 0's inherited-vs-created fact reads **inherited** (see `## Component-Skill Contract`), in which case omit it.

**Close the run directory when this run created it.** Once the summary (and the `## Next Actions` block, when it renders) is on screen, a **created** directory is closed so resume and reconcile paths classify it as terminal instead of `status: unknown` — the same call `/claude-tweaks:backlog`'s refine closing summary makes (`backlog/refine-closing-summary.md`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"
```

Always pass the explicit `--run` with the run *directory* — `close-run` rejects a file path outright, so never the `decisions.md` inside it. An **inherited** directory is never closed here: it is the parent pipeline's to close, and closing it mid-pipeline would stop the parent's own event logging (`docs/hooks.md`'s Ownership section). This runs in every outcome, `HELD` and `failed` included — a held run is still a finished run.

## Next Actions

- **`/claude-tweaks:backlog overview`** — pick the next build now that the shipped records are closed (recommended)
- `/claude-tweaks:help` — workflow status and what the lifecycle recommends next

When the outcome was `PARTIAL`, the recovery command from Step 6 leads this block instead, as a plain line above both — it is the only action that matters until the release is whole.

When Step 7 reported `{k} > 0`, the per-record recovery leads this block instead of the `backlog overview` line, one paste-ready line per failed record, in the form `bookkeeping.md`'s branch for this run's `work-backend` writes — `gh issue comment {N} …` / `gh issue close {N} --reason completed` under `github-issues`, the `markShipped` call under `local-files`. Every one of those writes is idempotent (`bookkeeping.md`: an already-commented, already-closed record is skipped), so re-booking a record that did land is safe. Re-running `/claude-tweaks:release` is **not** the recovery: the tag now exists, so Step 2 stops the run at `nothing to release` long before Step 7. The `backlog overview` line still renders below them, without its "now that the shipped records are closed" clause — it is not yet true.

## --train semantics

`--train` is how the release train Routine (#2258) invokes this skill on a schedule. It changes three things and nothing else.

**It is never interactive.** Step 4's console renders read-only; no `AskUserQuestion` fires anywhere in the run. There is no human in a scheduled firing, so a question would stall the run rather than resolve anything.

**Two HARD-GATEs stop it before Step 5.** Evaluated after Step 4 renders and before any merge or tag:

1. **A major bump**, measured on the **effective** version — the `--as <version>` value when one was given, otherwise `proposedVersion.value.version`. `release --train --as 7.0.0` on a repo whose commits alone justify only a minor is held, because the version that would ship is the major one.
2. **`review: blocking`** from Step 3. `--allow-blocking` does not lift this under `--train`; it is logged as ignored.

Either gate composes `release-held.md` — naming which gate fired, the effective version and its base, and the blocking findings' staged paths — and stages it. **This composition is not `--train`-specific**: the same two gates fire at Step 4 in every mode, and the file is staged in every mode (console.md's Gates section) — under `--train` and headless/auto it is the *only* record of why the release did not go out, and in interactive mode a `Stop` answer stages the identical file. What `--train` changes is only that there is no question to answer first.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id release-held --file {composed .md file}
```

It lands at `{run-dir}/staged/release-held.md`. The run then **exits 0** with `HELD` in Step 8's summary: a held run is a correct outcome, not an error, and a nonzero exit would read to the Routine kernel as a broken firing. `HELD` itself asserts one mode-independent fact — a HARD-GATE fired at Step 4 before Step 5, and nothing was merged or tagged — so it is exactly as correct a summary word for an interactive `Stop` as for a held train.

**A Step 6 miss after Step 5 has already landed is `PARTIAL`, never `HELD`.** `HELD` asserts that nothing was merged or tagged; reporting a landed release as `HELD` would be a false statement about the repository's state, and the recovery it implies (re-run the train) is the wrong action for a tag that already exists. `PARTIAL` carries Step 6's own named recovery command.

**Refusal.** Read both levers before anything else in the run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values release-train autonomy
```

`--train` is accepted only when `release-train` resolves `true` **and** `autonomy` resolves `unattended`. Otherwise it is refused: log the exact line and, **when a human is present** (interactive or hybrid mode), **continue as an ordinary on-demand invocation** — interactive console, HARD-GATEs presented to a human rather than staged. **When no human is present** — `auto` mode, or a Routine firing with no mode signal (the kernel's unattended-firing constraint) — a refused `--train` stops here, before Step 1: the outcome is `failed` with the refusal line as its reason, nothing is read and nothing moves, and the firing reports it as blocked. Without this stop a refused train whose history happens to trip no HARD-GATE would sail through Step 5 exactly as an accepted one — the console gates only what a gate catches. A refused `--train` must never proceed as though it had been accepted.

```
AUTO {HH:MM:SS} — Step 0: train: refused — autonomy {value}. {Proceeding as an on-demand invocation | Stopped before Step 1: no human present}. Reversibility: n/a. [lever: autonomy={value} ({source})]
AUTO {HH:MM:SS} — Step 0: train: refused — release-train {value}. {Proceeding as an on-demand invocation | Stopped before Step 1: no human present}. Reversibility: n/a. [lever: release-train={value} ({source})]
```

`--train` introduces no new autonomy lever of its own — it reads the existing ceiling. See `_shared/autonomy-ceiling.md`'s `train` row for what the train may do at `unattended` (merge and tag a minor or patch release whose review came back clean or non-blocking) and what it never does at any ceiling (a major bump, a blocking review, a failed hook).

## Component-Skill Contract

**Key the handoff on Step 0's inherited-vs-created fact, not on a fresh read of the environment.** **Inherited** means `/claude-tweaks:release` is running inside someone else's pipeline (invoked by `/claude-tweaks:wrap-up` at its suggested tier, by the release train Routine (#2258), or by another pipeline orchestrator): omit the `## Next Actions` block, because the parent owns the handoff. **Created** means this run minted its own standalone directory and there is no parent to hand off to: render `## Next Actions`. The summary block in Step 8 still renders in every case; only the handoff varies.

Step 3 sets `$PIPELINE_RUN_DIR={run-dir}` for the `/claude-tweaks:review` invocation. That **does not** change this fact: the fact was determined once at Step 0 and is carried forward, so a `created` run stays `created` and still renders Next Actions even though `$PIPELINE_RUN_DIR` is set by the time Step 8 is reached. Re-reading the environment here would silently suppress the handoff on exactly the standalone runs that need it.

Direct invocation may pass `--source <parent-skill>` as an explicit fallback when ambiguity exists (rare; `$PIPELINE_RUN_DIR` is the primary signal).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Bumping a version in a manifest by hand | The engine owns the bump, the changelog and the tag as one atomic artifact — a hand-edited manifest desynchronizes the three and makes the next release's base wrong (`docs/releasing.md`) |
| Running the engine without Step 3's review | The gate exists because a Critical finding once surfaced twenty minutes after the release it should have blocked (`[IL-97]`, design stance 8). There is no bump small enough to skip it for |
| Treating a missing hook run as success at Step 6 | Absence is not a passing result. Missing, still-running and concluded-failed are three named partial states, each with its own recovery command — never a clean release row |
| Rendering a release recommendation or a shipped-record row from an unverified premise | Record #680: a paste-ready release command was recommended for work a prior release had already carried. Every row this skill renders traces to a pack field or a verified check, or it is not rendered |
| Honouring `--allow-blocking` under `--train` | The flag means "a human read the finding and accepted it". An unattended firing has no reader, so the override would be a self-signed approval of a confirmed critical finding |
| Reading `integration-model` afresh instead of the pack's `engine` field | Recreates the ambient per-call-site inference `_shared/integration-model.md` exists to replace, and lets a transient `gh` failure split one release across two engines mid-run |
| Reporting a landed-but-unverified release as `HELD` | `HELD` asserts nothing was merged or tagged. Applied to a released tag it is a false statement about the repo, and it implies re-running the train — the wrong action for a tag that already exists |
| Continuing past a degraded `engine`, `unreleased` or `proposedVersion` field | These three are the facts every later step renders from. Proceeding on a guess produces a console that looks authoritative and is not |
