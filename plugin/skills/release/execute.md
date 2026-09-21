# Execute and Verify — Steps 5–6

Read by `/claude-tweaks:release` Steps 5 and 6. Every branch below routes on the `engine` value the preflight fact pack carries (`{run-dir}/release-preflight.json`, read once at Step 1) — `pr-first` dispatches to release-please's open PR, `local-merge` dispatches to `bin/release-local.js`. `_shared/integration-model.md` is canonical for that resolution and its Consumer table lists this file's Step 5/Step 6 dispatch; the value is **never** re-detected here, because a second probe mid-run can split one release across two engines.

Execution and verification live in one file because they are engine-specific in exactly the same way: what Step 5 ran decides what evidence Step 6 can look for.

## Inputs

- The pack's `engine`, `releasePr`, `branch`, `hook` and `lastTag` fields; the run directory resolved at Step 0; `$RUN_ROOT` (the main checkout, per `_shared/pipeline-run-dir.md`'s Anchoring section — never the worktree cwd).
- The arguments `--dry-run` and `--as {version}`, and Step 4's verdict that no HARD-GATE fired (a gated run never reaches this file).

### Two versions

**The gating version** is `--as` when given, otherwise `proposedVersion.value.version`. It is what Step 4 rendered and what the major-bump HARD-GATE measured. Nothing after Step 5 verifies it.

**The shipped version** is the engine's own, read back from the engine after it returns:

| Engine | Where the shipped version is read |
|---|---|
| `local-merge` | The `released v{version}` line on the engine's **stdout** (exit `0`). On exit `5` the same number is in the stderr line's `partial: v{version} is committed, tagged…` prefix. |
| `pr-first` | The `X.Y.Z` in the merged release PR's `chore(main): release X.Y.Z` title — re-read after the merge with `gh pr view {releasePr.value.number} --repo {owner}/{repo} --json title`, never carried over from Step 1's pack. |

The pack **proposes**; the engine **decides**. A sibling release landing between Step 1 and Step 5, or a `release-please-config.json` setting the pack does not read, can move the number.

**Validate the shipped version before anything consumes it.** Whatever its source, it must match `^\d+\.\d+\.\d+$` — a bare `X.Y.Z`, no `v` prefix, no suffix, nothing else on either side. Check that the moment it is read, before the reconciliation below and before Step 6 runs a single probe: every later step interpolates this value into a tag glob, a `gh release view` argument, a `Shipped in v{version}` record comment and a `shipped:` frontmatter facet, so a value that is not a version becomes a probe that can never match or a write nobody can undo by reading it back.

**pr-first — a post-merge title read that yields no version is its own named partial state.** The merge has already landed by the time this read runs, so its failure is never `failed`. Two shapes reach it: the `gh pr view` call fails (non-zero exit, unparseable JSON, no `title` field), or it returns a title from which no single unambiguous `X.Y.Z` can be taken — release-please's monorepo titles (`chore(main): release my-pkg 1.2.3`, and the multi-package variants naming several) and its component-less one (`chore(main): release main`) both fail the `chore(main): release X.Y.Z` shape the row above expects, and the pack selects the release PR by `headRefName`, so such a title reaches here rather than being filtered out upstream. Either shape resolves the same way, and it is evaluated **before** the three reconcile outcomes below, which need both versions to exist:

- The outcome is `PARTIAL` — the merge landed, and nothing about it is undone by an unreadable title.
- **Steps 6 and 7 do not run.** There is no version to probe for, and none to book against a record.
- Quote the raw title, or `gh`'s own error, **verbatim** in the summary. A paraphrase loses the one datum that separates a monorepo title from a broken read, and they want different fixes.

```
PARTIAL: PR #{n} merged but no shipped version could be read from its title ({the raw title, or gh's error, verbatim}); recover: gh pr view {n} --repo {owner}/{repo} --json title,mergedAt, then run Step 6's three probes by hand against the version that title names
```

**Reconcile the two once, immediately after the engine returns** (before Step 6 runs a single probe):

- Equal → silent, no log line.
- Different, and `--as` was **not** given → log it, and the **shipped** version wins for Steps 6, 7 and 8. Step 8's summary names both.

  ```
  AUTO {HH:MM:SS} — Step 5: gating version v{gating} ≠ shipped version v{shipped} — the engine decided; v{shipped} is verified and booked. Reversibility: n/a.
  ```

- Different, and `--as` **was** given → the override did not take, but the release did. This comparison only ever runs **after** the merge landed, so the outcome is `PARTIAL`, never `failed` — `failed` asserts nothing landed, and a tag now exists. The named state is `override did not take — the engine shipped v{shipped}, not v{gating}`; Step 6 verifies and Step 7 books **v{shipped}**, because that is the number the tag carries and the number the records actually shipped in. Step 8's summary names both versions alongside the state:

  ```
  PARTIAL: override did not take — the engine shipped v{shipped}, not v{gating}; recover: check the Release-As: commit reached {branch}; if v{gating} is still the number you meant, ship it as a follow-up release (a fresh Release-As: commit, then /claude-tweaks:release --as {gating}) and correct the notes with gh release edit v{shipped} --repo {owner}/{repo} — never by re-tagging v{shipped}
  ```

  A follow-up release, never a re-tag: v{shipped} is published, and moving a tag a consumer may already have fetched rewrites a release that has shipped rather than superseding it.

Every `{version}` in Step 6, Step 7 and Step 8 below is the **shipped** version.

## Step 5: Execute

### `--dry-run`

**pr-first — a no-op.** Nothing is merged, nothing is tagged, no `Release-As:` commit is pushed. Log the line below, skip Steps 6 and 7, and go to Step 8 with the outcome `dry-run`:

```
AUTO {HH:MM:SS} — Step 5: dry-run — no merge, no tag. Effective version v{gating} would ship via pr-first. Reversibility: n/a.
```

**local-merge — run the engine's own dry run and render it.** The engine prints what only it knows: which manifest paths it would splice, the `release-hook` command it would run, a `manifest-drift:` warning when the manifest and the last tag disagree, and the full CHANGELOG section it would prepend. None of that is on Step 4's console, and a dry run that withholds it tells the operator less than the real run would:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/release-local.js" --root "$RUN_ROOT" --dry-run
```

Render its stdout verbatim below the console, then skip Steps 6 and 7 and go to Step 8 with the outcome `dry-run`. A non-zero exit here is classified by the same table as a live run (below), though only its `nothing written`, `2`, `3` and `4` rows are reachable — the engine returns before any write under `--dry-run` — and a dry run that cannot even plan is a real finding, not a formality.

### pr-first

**Precondition — the release PR.** `releasePr.value` must be a PR object. When it is the string `none`, stop before touching anything and report:

```
no open release PR — release-please has not rendered one; check the workflow
```

**Transport.** `command -v gh` absent: `_shared/github-write-transport.md`'s CRUD mapping covers issue operations only and has no merge row — there is no MCP equivalent for merging a PR. Do not improvise one. Stop at the console and print the merge as a paste-ready command, the same posture the Review Console takes for an unrunnable action:

```
gh pr merge {releasePr.value.number} --squash --repo {owner}/{repo}
```

The outcome is **`HELD`**, reason `no gh — merge rendered for a human`. Nothing was merged and nothing was tagged, which is exactly what `HELD` asserts — it is not `failed` (no merge was attempted and refused) and not `PARTIAL` (no release exists). Stage `release-held.md` carrying that reason, the effective version and its base, and the paste-ready command above, through the same writer the Step 4 gates use:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id release-held --file {composed .md file}
```

Steps 6 and 7 do not run — there is no tag to verify and nothing shipped to book. This is the one `HELD` that is not a Step 4 HARD-GATE; SKILL.md's Step 8 names it as the third reason for the word.

**`--as {version}` — push the override, then wait for the re-render.** release-please derives the PR from the commits it sees, so the override must reach the integration branch and be re-read before the PR is merged. Every git call is anchored to `$RUN_ROOT` — a bare `git commit` from a worktree cwd would put the override on the worktree's branch, where release-please will never see it. Assert three things about the anchor first — on the integration branch, clean, and exactly at the fetched `origin/{branch}` tip:

```bash
git -C "$RUN_ROOT" rev-parse --abbrev-ref HEAD    # must equal {branch}; anything else → failed, no commit
git -C "$RUN_ROOT" status --porcelain             # must print nothing; anything else → failed, no commit
git -C "$RUN_ROOT" fetch origin {branch}
git -C "$RUN_ROOT" rev-parse HEAD origin/{branch} # the two shas must be equal; anything else → failed, no commit
git -C "$RUN_ROOT" commit --allow-empty -m "chore: release {version}" -m "Release-As: {version}"
git -C "$RUN_ROOT" push origin {branch}
```

`{branch}` is the pack's own `branch` field. Each precondition is `failed` with **no commit made**, and each fails for its own reason:

1. **Wrong branch** — the override would land on some other branch, where release-please never reads it.
2. **Dirty anchor** — `status --porcelain` must be empty for staged *and* unstaged changes alike. `--allow-empty` means the commit needs no changes of its own, so it would silently absorb whatever is already staged in the main checkout (a sibling session's work-in-progress) into a commit whose whole purpose is to carry one trailer. Report the porcelain output verbatim; there is no recovery command to print — a human decides what to do with their own working tree.
3. **Tip not at `origin/{branch}`** — a local tip behind origin would push an old tree (or be rejected), and a diverged one would push a history nobody else has. `recover: git -C "$RUN_ROOT" pull --ff-only origin {branch}`, then re-run `/claude-tweaks:release`.

A **rejected push** (non-fast-forward, protected branch, permissions) is `failed`: report `git`'s stderr verbatim and stop with no poll — the override never reached origin, so there is nothing for release-please to re-render and waiting five minutes would only delay the same answer. The commit **has** been made by this point and is stranded locally on `{branch}` in `$RUN_ROOT`, so name its recovery in the same report:

```
recover: git -C "$RUN_ROOT" pull --rebase origin {branch} && git -C "$RUN_ROOT" push origin {branch}
```

Never `git -C "$RUN_ROOT" reset --soft origin/{branch}`: that unmakes the commit into a staged working tree and leaves the `Release-As:` trailer nowhere — the trailer is the entire payload — and in a shared main checkout it also mixes the staged residue into whatever a sibling session commits next.

Once the push lands, poll for the re-render — `gh pr view {n} --repo {owner}/{repo} --json title,headRefOid` every 20 seconds, at most 15 attempts (5 minutes). Re-rendered means the PR **title** carries `{version}`; `headRefOid` is read in the same call so a moved head is visible rather than inferred:

```bash
gh pr view {releasePr.value.number} --repo {owner}/{repo} --json title,headRefOid
```

Past the bound, **do not merge** — the open PR still renders the version the commits alone derived, and merging it would ship the wrong number. Log the line, report the named state, and stop:

```
override pushed, PR not re-rendered — release-please has not re-rendered PR #{n}; recover: wait for the release-please run, then re-run /claude-tweaks:release
```

The summary's outcome slot reads `failed`, not `PARTIAL`: `PARTIAL` asserts a release exists, and none does here. The `Release-As:` commit **is** on the integration branch, which is why the state is named rather than reported as a clean no-op — a second run must not push a second override commit.

**The PR-check gate — `_shared/pr-first-merge.md`'s Merge-verification gate, not a second implementation.** The console's `CI on tip` row does **not** cover this: `ciTip` is the integration branch's tip, and the console *renders* CI, it does not gate on it. The checks that matter here are the release PR's own. Resolve the lever and read the PR exactly as that gate's Step 2.5 does — its four-field read, its ordered classification, its bounded watch, its green-exit re-entry check — and apply only the four deltas below. The classification itself is not restated here; read it there:

```bash
MERGE_VERIFICATION=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "{run-dir}" --values merge-verification)
gh pr view {releasePr.value.number} --repo {owner}/{repo} --json state,mergeStateStatus,headRefOid,statusCheckRollup,title
```

An unreadable state is Step 2.5's own first row, unchanged in substance: never merge on a state this gate could not read — a read failure is not "no CI" — reported here as `failed`, reason `state-read-failed`. The five deltas, each a deliberate narrowing, substitution or addition for the release path:

1. **`state: MERGED` is resumable, not a stop.** Step 2.5 stops on any non-`OPEN` state (`pr-not-open`) and never merges. Here a merged release PR is a state a resumed run — or a hand-run merge — legitimately lands in: skip the merge, read the shipped version from the PR title per `## Inputs`, and go to Step 6, where the tag and Release probes are the real evidence either way. A deliberate narrowing of that blanket rule, and only for `MERGED`: `state: CLOSED` keeps Step 2.5's posture as `failed` — the release PR was closed unmerged, and release-please must render a new one.
2. **Red parks nothing.** Step 2.5's Red path applies `bot:parked` to the work-record issue(s) and comments on them; a release run holds no claimed record to park and has no dispatch resume to hand back to, so no label is applied and no park comment is posted. A red rollup — at the first read or during the watch — is simply `failed`, naming the failing check(s) by name. Everything else in that row is unchanged: under `off` the read still runs and the red classification is still logged (`off` skips the *wait*, not the read), and `off` still merges anyway.
3. **The release never arms `--auto`.** Step 2.5's `merge-when-green` arming path is deliberately not taken here: `--auto` returns before the merge happens, and Step 6 must verify the tag, the Release and the hook **inside this run**. A run that armed and returned would report on a release that had not occurred yet. Pending under `merge-when-green` or `wait` therefore always takes Step 2.5's bounded watch (15 minutes, fixed — `gh pr checks {n} --repo {owner}/{repo}`, keyed on its exit code) rather than the arming column, and the watch's green exit keeps its `headRefOid` re-entry check unchanged: the first read above is the baseline, a moved head is re-read from the top rather than merged on the stale rollup (a second move reports `failed`, reason `moving-target`), and still-pending at the bound is `failed`, reason `checks-pending-timeout`. Pending under `off` is Step 2.5's `off` column unchanged — today's behavior, no wait.
4. **`mergeStateStatus` is read for Step 2.5's classification only** — never to decide whether arming would hold, since delta 3 removes arming from this path entirely. It stays in the field list because that ordered classification reads it.
5. **`title` is read too, and the bump is re-gated on it.** Step 2.5 has no such field; the release path needs it because release-please re-renders its PR as commits land on `{branch}`, and Step 3's whole-branch review plus this gate's own bounded watch can put fifteen minutes or more between the console and this merge — long enough for the PR to re-render to a version Step 4's HARD-GATE never measured. Take the `X.Y.Z` from the title read above (the `chore(main): release X.Y.Z` shape `## Inputs` names; a title yielding no single unambiguous version is not a re-render signal — leave the gating version as it stands and let `## Inputs`' post-merge branch classify it after the merge). Compute its bump part against `lastTag.value.version` by digit comparison — major, minor or patch, or `>= 1.0.0` when `lastTag` is degraded. This necessarily stays a digit-diff rather than reading `proposedVersion.value.part` the way `console.md`'s no-`--as` gate now does (#2327): that field comes from the pack's own commit analysis at Step 1, and by re-render time the title is the only signal available, with no fresh pack run behind it. Compare the result to the part Step 4 gated on:
   - **Same part** — nothing re-rendered that the console did not already see; merge.
   - **Different, and not major** — the re-rendered version becomes the gating version for the rest of the run and the merge proceeds, logged.
   - **Different, and major** — re-run Step 4's major-bump HARD-GATE on the re-rendered version and it fires: **do not merge**. Stage `release-held.md` through the Step 4 writer, naming the reason `re-rendered to a major after the console`, the re-rendered version and its base; the outcome is `HELD` and nothing moved, which is exactly what `HELD` asserts. Under `interactive`, ask once first with `console.md`'s Gates question and stage the identical file on `Stop`; under `--train`, `auto` and headless there is no question, only the staged file.

   ```
   AUTO {HH:MM:SS} — Step 5: release PR re-rendered v{gated} → v{rerendered} ({part}) before the merge; re-gated, not major — v{rerendered} is the gating version. Reversibility: n/a (gate evaluation).
   STAGED {HH:MM:SS} — Step 5: HARD-GATE major bump — release PR re-rendered to v{rerendered} after the console; release held. Stage path: staged/release-held.md. Reversibility: high.
   ```

   The `--as` path above already polls this same title before merging, for the same reason. The two paths now agree: neither merges a release PR whose title it has not read since the gate ran.

**Merge.** One call, the immediate `--squash` form of `_shared/pr-first-merge.md`'s Step 3:

```bash
gh pr merge {releasePr.value.number} --squash --repo {owner}/{repo}
```

`{owner}/{repo}` is resolved the way `_shared/pr-first-merge.md` does it, and every `gh` call site in this file — the merge, the reads, the probes, and the recovery commands the summary prints — passes it explicitly, exactly as that procedure pins its own read sites. Not because a worktree's remote differs: a linked worktree shares the main checkout's `.git/config`, so its `origin` is the same remote. The honest reason is that `gh`'s base-repo resolution depends on the **remote layout** rather than on a single remote — a fork checkout carrying both `origin` and `upstream`, a `gh repo set-default` value, or a `GH_REPO` in the environment each redirect it — and a release must never be merged, tagged or verified against whichever repository that inference happens to pick. Pinning `--repo` makes the target a fact of the command instead of a fact of the environment.

No `-t`/`-b`: the release PR's subject is release-please's own `chore(main): release X.Y.Z`, and `bin/compose-subject.js` is not involved — this is the one pr-first merge site whose subject the engine owns.

| Result | Meaning |
|---|---|
| exit `0` | Merged → read the shipped version from the PR title, reconcile per `## Inputs`, then Step 6. |
| exit `0`, stderr `! Pull request … was already merged` | A no-op on an already-merged PR, not an error → same path as above. |
| exit `0`, but the post-merge title read fails or yields no `X.Y.Z` | Merged, version unreadable → `## Inputs`' post-merge title-read branch: outcome `PARTIAL`, Steps 6 and 7 skipped, the raw title or `gh`'s error quoted verbatim with its recovery command. Never `failed` — the merge landed. |
| non-zero exit | Nothing merged, nothing tagged. Report `gh`'s stderr **verbatim** and stop; the summary outcome is `failed`. Never retry blind — a failure whose cause is unread can be a protected branch, a moved head, or an org-owned required check, and each wants a different fix. |

### local-merge

**`--as` back-stop.** `/claude-tweaks:release` Step 1 owns this check and stops the run there. Should a run nevertheless reach this step with `--as` under `local-merge`, refuse with the same message, log it as `SKIP`, and stop — never invoke the engine:

```
--as is pr-first only (release-local.js derives the version from history); use a breaking commit or a manual tag
```

```
SKIP {HH:MM:SS} — Step 5: --as {version} refused under local-merge (back-stop; Step 1 owns the check) — release-local.js has no version override. Reversibility: n/a.
```

A `--release-as` flag on the local engine is an open follow-up, recorded as ledger row 90 of `docs/plans/2026-09-11-release-skill-ledger.md`.

**Invoke the engine.** One call, no flags the CLI does not define — its own are `--dry-run`, `--root <dir>` and `--branch <name>`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/release-local.js" --root "$RUN_ROOT"
```

Map its exit code, which is the whole verdict — do not re-derive state from the repository:

| Exit | State | Action |
|---|---|---|
| `0` | Released: the manifest bump, the CHANGELOG section, the `chore(release): v{version}` commit, the annotated tag, the push (when `origin` exists) and the `release-hook` all landed. | Read the shipped version from the `released v{version}` stdout line, reconcile per `## Inputs`, → Step 6. |
| `1` | **Two different states — the stderr prefix says which, and it is never inferred.** `release-local: … — nothing written` → nothing was written at all. `partial: …` → a named partial state (edits on disk uncommitted, or the commit/tag landed and the push did not), with its own recovery command. | `nothing written` → outcome `failed`, stderr quoted verbatim, Step 6 does not run. `partial:` → quote the stderr line **verbatim** into the summary as `PARTIAL` and stop; Step 6 does not run either, because the stderr line already names the exact state and what to do, and **Step 7 does not run either** — the tag has not reached origin, so nothing is booked until the recovery push named in that stderr line lands (bookkeeping.md's "Never when the tag has not reached origin"). |
| `2` | Usage, a missing `release-please-config.json` (the project was never bootstrapped), or a malformed/unsupported config. Nothing was written. | Report the stderr line verbatim and stop; outcome `failed`. |
| `3` | Nothing to release. Step 2 should have caught this from the pack. | Report the engine's stdout line verbatim and stop; outcome `failed`, with the reason named: the pack and the engine disagree about the unreleased set. |
| `4` | Version collision (a sibling worktree or a plan claim holds the candidate version). | Report the engine's stderr **verbatim** — it names each conflicting claim and a suggested renumber — and stop; outcome `failed`. Never pick a different version here. |
| `5` | The `release-hook` failed **after** the tag (and its push) fully landed. The tag is final. | Read the shipped version from the stderr line's `partial: v{version} is committed, tagged…` prefix, reconcile per `## Inputs`, quote the stderr line verbatim into the summary as `PARTIAL`, and continue to **Step 6** — the release exists, so Step 7's bookkeeping still applies. |

### Logging

Log every subprocess this step ran, one line each, through the writer `/claude-tweaks:release` Step 0 names (`bin/log-decision.js --section "/release"`) — never hand-appended:

```
AUTO {HH:MM:SS} — Step 5: {command} → exit {code}. Reversibility: low (a merged release PR / a pushed tag is not undone by re-running).
```

## Step 6: Verify

Runs only after Step 5 landed: a pr-first merge, or a local-merge engine exit `0` or `5`. Three probes, each bounded at **15 attempts × 20 seconds** (5 minutes). A probe that does not land is a **named partial state with a recovery command** — never folded into a clean release, and never left as silence. Missing, still-running past the bound, and present-but-concluded-failed are three different misses and each says which it was.

The outcome is `released` only when all three probes that apply to this engine land; any miss makes it `PARTIAL`. `{version}` throughout is the **shipped** version reconciled at the end of Step 5.

### pr-first

**1. Tag on origin.** release-please tags on the merge, so this is a poll, not a single read:

```bash
git ls-remote --tags origin "v{version}*"
```

Keep only the lines whose ref is exactly `refs/tags/v{version}` or `refs/tags/v{version}^{}` — the glob also matches `v{version}0`-style neighbours, which are not this tag. A surviving line → `tag found`. **Keep the output** — probe 3 reads the commit sha from it: the `*` glob is what makes an annotated tag print two lines (an exact pattern suppresses the peeled ref), so an annotated tag prints two lines, and the sha probe 3 needs is the one on the peeled `refs/tags/v{version}^{}` line (the plain `refs/tags/v{version}` line names the tag object, not the commit); a lightweight tag prints only the plain line and that sha is the commit. Do not reach for `git rev-list -n 1 "v{version}"` here — under pr-first the tag was created on origin and no local tag exists unless `git fetch --tags origin` has been run.

Empty after the bound:

```
PARTIAL: PR #{n} merged but v{version} is not on origin after 5 min — release-please has not tagged the merge; recover: gh run list --workflow release-please.yml --repo {owner}/{repo} --limit 5
```

The recovery is a *different* command from the probe, deliberately: re-running `git ls-remote` only re-asks the question this step already answered. The tagging is release-please's own workflow run, so the recovery looks at that run — substitute the repo's actual release-please workflow name for `release-please*` (the workflow this project wires to `release-please-action`) — and, when it shows a failed run, re-runs it with `gh run rerun {databaseId} --repo {owner}/{repo}`.

**2. GitHub Release.** Polled on the same bound, because release-please creates the Release from the tag:

```bash
gh release view "v{version}" --repo {owner}/{repo} --json url,isDraft
```

A non-zero exit (no such release) past the bound is a miss. `isDraft: true` is a miss reported on the **first** read that returns it — a draft Release is not published, and polling a draft only waits for a human to press a button:

```
PARTIAL: v{version} is tagged but no GitHub Release exists; recover: gh release create v{version} --repo {owner}/{repo} --generate-notes
PARTIAL: the GitHub Release for v{version} is a draft; recover: gh release edit v{version} --repo {owner}/{repo} --draft=false
```

**3. The `release: published` hook.** Skip only when the pack's `hook.value` is `false` — there is no hook wired up, so there is nothing to verify and the row reads `hook n/a`. When `hook.value` is `true` **or** the field is degraded, run the probe: a hook whose presence could not be determined is not a hook that can be assumed absent.

```bash
gh run list --event release --repo {owner}/{repo} --json databaseId,status,conclusion,name,url,headSha --limit 20
```

`databaseId` is in the field list because the recovery command below needs the run id to be runnable. Keep the runs whose `headSha` is the tag's commit — the sha probe 1 already read out of `git ls-remote`. That is the precise form of "created after the merge", and the only filter that cannot pick up an older release's run. Poll on the same bound and classify:

| Evidence | Verdict |
|---|---|
| A matching run with `conclusion: success` | `hook: ok ({name}, {url})` |
| A matching run concluded anything else (`failure`, `cancelled`, `timed_out`, `action_required`) | `hook: failed ({name}, {url})` |
| A matching run still `queued`/`in_progress` past the bound | `hook: still running after 5 min ({name}, {url})` |
| No matching run within the bound | `hook: missing after 5 min` |

The last three are partial states:

```
PARTIAL: v{version} is tagged and released but the release: published hook failed; recover: gh run rerun {databaseId} --repo {owner}/{repo}
PARTIAL: v{version} is tagged and released but the release: published hook is still running; recover: gh run watch {databaseId} --repo {owner}/{repo}
PARTIAL: v{version} is tagged and released but the release: published hook did not run; recover: check the workflow's release: published trigger, then gh run list --event release --repo {owner}/{repo} --limit 20
```

**Transport.** Step 5's `gh`-absent branch stops before merging, so this step is normally unreachable without `gh`. It is reachable in one case: a resumed run whose merge was performed by hand. There, probes 2 and 3 are unrunnable — `_shared/github-write-transport.md` has no Release or workflow-run row, and states plainly that PR- and run-backed reads degrade per item rather than being skipped wholesale. Probe 1 still runs (`git ls-remote` needs no forge CLI). Report probes 2 and 3 as `unverified (gh absent)` — a named partial state, not a pass — and pair that state with the two commands a human on a machine that *has* `gh` can paste to finish the verification, each on its own line:

```
gh release view v{version} --repo {owner}/{repo} --json url,isDraft
gh run list --event release --repo {owner}/{repo} --json databaseId,status,conclusion,name,url,headSha --limit 20
```

`unverified` without them tells the operator only that something was not checked; with them, the check is one paste away on the next machine. They are the same two probes this section could not run, quoted so they are runnable rather than described.

### local-merge

The engine's own exit code is the verdict for the hook; the tag is still checked against the repository rather than assumed from the exit:

- **Tag.** Immediate, not polled — the engine committed, tagged and pushed synchronously before returning. Probe origin when there is a remote, and locally when there is not; key the choice on `git -C "$RUN_ROOT" remote get-url origin` failing, not on the engine's stdout (the engine prints its no-origin line only when a remote exists but the branch is not on it yet, so a repository with no remote at all prints nothing to read):

  ```bash
  git -C "$RUN_ROOT" remote get-url origin   # succeeds → git ls-remote --tags origin "v{version}*"
                                             # fails    → git -C "$RUN_ROOT" tag --list "v{version}"
  ```

  Empty either way is a miss, and the recovery differs by branch — never the probe re-run, which would only re-ask the question this step already answered:

  ```
  PARTIAL: the engine exited 0 but v{version} is not on origin; recover: git -C "$RUN_ROOT" push origin v{version}
  PARTIAL: the engine exited 0 but v{version} does not exist locally; recover: read the engine's own stdout for what it claims it wrote, then re-run node "${CLAUDE_PLUGIN_ROOT}/bin/release-local.js" --root "$RUN_ROOT" --dry-run to see what a re-run would do
  ```

  The first is the `origin` branch: the tag was created locally and the push did not land, so pushing the tag alone completes the release. The second is the no-remote branch, where there is nothing to push and an exit that claims more than the repository shows is the one case worth catching here.
- **GitHub Release.** `release n/a` — a `local-merge` project has no forge to publish one to.
- **Hook.** Exit `0` means the `release-hook` (if one is configured) ran and exited `0`; exit `5` **is** the hook failure, and its stderr already carries the recovery command (`re-run the hook alone: {hook}`). Quote it verbatim as the partial state; never re-run the engine to "retry" a hook, because the tag is final and a second run would bump again.

### Logging

```
AUTO {HH:MM:SS} — Step 6: tag {found|missing}, release {url|n/a}, hook {ok|failed|missing|n/a}. Reversibility: n/a (verification only).
```

## Summary lines

Step 8 renders the block; these are the values this file produces for it.

```
release: {version} — PARTIAL
engine:  {pr-first | local-merge}
records: {n} {shipped | would ship}{, m unattributed commits}
{the named partial state, verbatim}
{the recovery command, on its own line, paste-ready}
```

```
release: {version} — failed
engine:  {pr-first | local-merge}
records: 0 shipped
{the engine's or gh's own line, verbatim}
{the recovery command, when the failure named one}
```

When the shipped version differed from the gating version, the `release:` line names both — `release: {shipped} — {outcome} (gating version was {gating})` — so a reader never has to reconcile the console's number against the tag by hand.

`HELD` is only ever a **pre-merge** word here — the `gh`-absent Transport stop and delta 5's re-rendered-major re-gate, both of which move nothing — alongside the Step 4 HARD-GATEs that fire before this file runs at all. In any mode, `--train` and interactive alike, it asserts that nothing was merged or tagged, so applying it to anything this file did **after** the merge would be a false statement about the repository and would recommend re-running the train against a tag that already exists. Once Step 5 has landed, the only two outcomes are `released` and `PARTIAL`; when Step 5 did not land, the outcome is `failed`.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Verifying or booking the gating version instead of the engine's own | The pack proposes and the engine decides; a sibling release or a config the pack does not read can move the number, and Step 6 would then poll for a tag nobody created |
| Merging the release PR after the `Release-As:` poll times out | The open PR still renders the commit-derived version — merging it ships a number the operator explicitly overrode |
| Merging the release PR on the console's `CI on tip` row | `ciTip` is the integration branch's tip, not the PR, and the console renders CI rather than gating on it. The PR's own `statusCheckRollup` is the only read that answers "are this merge's checks green" |
| Arming `gh pr merge --auto` for the release PR | `--auto` returns before the merge happens, so Step 6 would verify a release that has not occurred — the release path waits or fails instead |
| Inferring which exit `1` it was instead of reading the stderr prefix | `release-local: … — nothing written` and `partial: …` are opposite states with opposite recoveries; treating both as "something landed" would leave a clean tree looking un-recoverable, and treating both as "nothing landed" would invite a second bump |
| Re-running `bin/release-local.js` after a `partial:` exit `1`, or after exit `5` | Both mean something already landed on disk or in git; a second run bumps again. The stderr line names the exact recovery, and it is never "re-run" |
| Reporting a missing hook run as success | Absence is not a passing result. `missing`, `still running` and `concluded failed` are three named states, each with its own recovery |
| Reading `integration-model` afresh instead of the pack's `engine` field | `_shared/integration-model.md` resolves it once per run; a second probe can split one release across two engines mid-run |
| Passing `--as` through to `bin/release-local.js` | The flag does not exist there; the engine would exit `2` on an unknown argument and the operator would read a usage error instead of the real refusal |
| Composing a merge subject for the release PR | release-please owns `chore(main): release X.Y.Z`; a composed subject would desynchronize the merge commit from the changelog the engine generated |
| Running the `Release-As:` commit from the worktree cwd | `$RUN_ROOT` is the integration checkout; an unanchored commit lands the override on the worktree's branch, where release-please will never see it |
