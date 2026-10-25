---
files:
  - plugin/skills/release/SKILL.md
  - plugin/skills/release/console.md
  - plugin/skills/release/execute.md
  - plugin/skills/release/bookkeeping.md
  - plugin/skills/release/disposition.md
  - plugin/skills/release/routine-template.yml
  - plugin/bin/release-preflight.js
  - plugin/bin/lib/release-preflight/pack.js
  - plugin/bin/release-local.js
  - plugin/skills/review/SKILL.md
---

# Release a Version

**Persona:** Maintainer of a GitHub-backed TypeScript service on `integration-model: pr-first` whose last three releases were cut by hand-merging release-please's PR after skimming CI, once shipping a Critical that a review would have caught (`[IL-97]` is that story in this repo) — now wants one command that reviews before it bumps and refuses to call a release clean until the tag, the GitHub Release and the publish workflow have all landed.
**Goal:** Ship the unreleased conventional commits on `main` as one version, with the whole-branch review run first, the shipped records commented and closed, and every miss named rather than hidden.
**Entry point:** `/claude-tweaks:release --dry-run` after `/claude-tweaks:wrap-up` suggests a release (its Next Actions row appears only when the preflight pack shows unreleased work).
**Success state:** The console named the records, the bump and the review verdict before anything moved; `gh release view v1.3.0` exists; the `release: published` workflow concluded `success`; each shipped record carries `Shipped in v1.3.0` and is closed; the summary reads `release: 1.3.0 — released`.

## Steps

### 1. Preview — `--dry-run`
- **URL:** `/claude-tweaks:release --dry-run`
- **Action:** Step 1 runs the preflight fact pack into the run directory; Step 3 runs `/claude-tweaks:review base:v1.2.0` over the first-parent history since the last tag; Step 4 renders the console — records shipped, the driving commit, the review verdict, CI on the tip, whether a publish hook is configured, the overrides — and stops before Step 5.
- **Should feel:** Like reading the release before it exists — nothing merged, nothing tagged, but every finding the real run would block on is already staged.
- **Should understand:** The review is not optional and not skippable by `--dry-run`, `--train` or `--allow-blocking`; a Critical or High finding marks the run `review: blocking` and only a human who has read it can override.
- **Red flags:** A console row rendered green from a degraded pack field; a `Records shipped` row that silently dropped a commit with no `(#N)` suffix instead of listing it as unattributed; the console reporting no publish hook on a Windows (CRLF) checkout of a repo whose workflow fires on `release: published` — the verify step would then skip the hook check silently (#3040).

### 2. Nothing to release — a quiet stop
- **URL:** the same command on a `main` with only `chore:`/`docs:` commits since the tag
- **Action:** Step 2 prints one line — `release: nothing to release since v1.2.0 (…)` — and stops; no review, no console. Step 8's close-out still runs for the run directory this invocation minted: it is closed and archived, so it is not left `active` for the next release to pick up (#3898).
- **Should feel:** A non-event; the next-actions row that suggested a release would not have appeared in the first place (#680).
- **Should understand:** A history whose commits are all unconventional reads as `no conventional commits since v1.2.0`, not as a bug.
- **Red flags:** A console rendered for an empty release; a bump proposed from a `chore:`-only history; this run's directory still `active` under `.claude-tweaks/pipelines/` after the one-line stop.

### 3. Ship — the live run
- **URL:** `/claude-tweaks:release`
- **Action:** Steps 1–4 as before; Step 5 reads the release PR's own checks against the `merge-verification` lever (red or still pending past the bound is `failed`, nothing moves) and then merges release-please's open PR with `gh pr merge --squash` (or, on a `local-merge` repo, runs `bin/release-local.js`); the version Steps 6 and 7 use is the one the engine actually shipped, reconciled once against the console's proposal; Step 6 waits — bounded — for the tag on origin, the GitHub Release and the `release: published` workflow run, and names any miss as a partial state with its recovery command; Step 7 comments `Shipped in v1.3.0` on each shipped record and closes it; Step 8 gives every finding Step 3 staged exactly one disposition before the run closes: filed as a record, digested below the materiality floor, or declined with a reason. The summary's `findings:` line counts them, and then the run directory is closed and archived (#3898).
- **Should feel:** Slow in the right places — the verify step visibly waits for the hook rather than declaring victory at the merge.
- **Should understand:** Five outcome words, never folded: `released`, `dry-run`, `HELD` (a gate stopped the run before the merge — at Step 4, or at one of Step 5's no-merge stops such as `integration branch kept moving` — in any mode, not only the train; nothing moved, and `release-held.md` names which gate), `PARTIAL` (the release exists, something after it did not land), `failed` (Step 5 attempted and landed nothing). Under `local-merge` the engine's own exit code is the verdict (`5` means the tag is final and only the hook failed — re-run the hook, never the release; `1` is either nothing written or a named partial state, and its stderr says which). `--as` works under both engines (#2326): under `local-merge` it is passed through as `bin/release-local.js --release-as {version}`, which exits `2` (naming both versions) if the value is not ahead of the derived base.
- **Red flags:** `released` printed while the publish workflow is still running or failed; a record closed without the `Shipped in` comment; `--as 7.0.0` accepted without the major-bump gate; a red release PR merged because the review was clean; `Shipped in v1.3.0` written when the engine shipped `v1.4.0`; review findings left in `staged/` of a closed or archived run directory with no disposition line in `decisions.md`; the run directory archived while a filing failed; a `staged/` or `decisions.md` that could not be read (any error but "does not exist") reported as "no staged review findings" and the run archived with whatever it held; a release whose review touched UI left unarchived because Step 8 called a `design-decision-*` file (or another prefix the review stages) unrecognised. Every prefix the review's producers stage has a row in `disposition.md`'s review staging roster: `visual-review-*` skip notes are archived as non-findings, and the rest are filed or declined like any other finding (#4156).

### 4. Unattended — `--train`
- **URL:** `/claude-tweaks:release --train` — by hand on an `unattended` repo, or as the scheduled firing `/claude-tweaks:routine create release` instantiates from `skills/release/routine-template.yml` (the release train Routine, #2258: daily on weekdays, a refused nothing-moved `failed` stop until `release-train: true` and `autonomy: unattended` are set)
- **Action:** Refused unless `release-train: true` and `autonomy: unattended` — with a human present the refusal falls back to an on-demand run, in a headless firing it stops before Step 1 as `failed` with nothing moved; when accepted, Steps 1–4 run without a console prompt, and a major bump (effective, after `--as`) or `review: blocking` stages `release-held.md` and exits with `HELD`; a Step 6 miss after the merge landed is `PARTIAL`, never `HELD`.
- **Should feel:** Trustworthy to leave alone — the two things it will never do on its own (ship a major, ship past a blocking review) are exactly the two a human would want to see.
- **Should understand:** `HELD` means nothing moved; `PARTIAL` means the tag landed and the hook did not — different recovery, different urgency.
- **Red flags:** `--allow-blocking` honoured under `--train`; a `HELD` summary on a run whose merge actually happened.

### 5. Release again — a fresh run directory
- **URL:** `/claude-tweaks:release` a day later, after the previous release finished (or stopped early)
- **Action:** Step 0 finds the previous release's directory and refuses it. It does this whether that directory is `clean`/`closed` or still `active` from a run that stopped early, because a release's own directory never belongs to a parent pipeline. It mints a fresh standalone directory, logs `Step 0: {dir} is a prior release run's directory (status {status}) — not adopted; minted {new dir}`, and pins its own review ceiling.
- **Should feel:** Each release is its own run; yesterday's review findings and verdict never leak into today's.
- **Should understand:** Only a parent pipeline's directory, handed in through `$PIPELINE_RUN_DIR` (for example by `/claude-tweaks:wrap-up`), is ever inherited. An inherited directory is never closed, archived or disposed of by release; its parent owns it.
- **Red flags:** Today's `## /review` verdict read from yesterday's lines; a standalone run that skipped its ceiling pin or suppressed its Next Actions; a second, stray directory minted mid-run because a later step re-ran the Step 0 fence.

### 6. Release from a main checkout reconcile has touched
- **URL:** `/claude-tweaks:release` while local `main` carries unpushed `[reconcile] archive run …` commits from earlier pipeline archival
- **Action:** Step 3 fetches and runs its review-tree check. The checkout is on `main`, 0 commits behind `origin/main`, and its tree differs only under `.claude-tweaks/pipelines/`, so the whole-branch review runs. The check's first call resolves `origin/main` once and prints it; its second compares `HEAD` against that sha, pasted in literally. The marker's reviewed tip is the printed sha, never a second read (#4157). Because `HEAD` and that tip differ, the marker line records both shas. A checkout that fails the check stops before the console with a line starting `stopped before the console: review tree is not origin/main`, and one recovery chosen by what failed:
  - Behind: the line names the ahead/behind counts, and the recovery is `git -C "$RUN_ROOT" pull --rebase origin main`, then a bare `git push origin main` only once nothing outside run dirs is still ahead.
  - Wrong branch: the line names the current branch, and the recovery is `git -C "$RUN_ROOT" switch main`.
  - Changes outside run dirs: the line lists the files that differ and points to a PR, with no push command.
  - A failed fetch, or another git error: git's own stderr in place of that line (#4012).
- **Should feel:** Archive bookkeeping never blocks a release; a real divergence stops it with the one command that fixes it.
- **Should understand:** Commits ahead are fine only when they touch nothing outside run directories. The review's test gate runs against the tree it stands in, so that tree must match the range being tagged everywhere that ships.
- **Red flags:** A release refused over `[reconcile] archive run` commits alone; a checkout behind `origin/main` let through; a stop line advising `git push` for local commits that change shipped files; a review run after a fetch that failed; a marker whose reviewed tip differs from the sha the check compared against (a sibling fetch landed between them).

### 7. `main` moves while the release is in flight
- **URL:** `/claude-tweaks:release` (pr-first) on a busy repo where teammates keep merging PRs during Step 3's review or the release PR's check watch
- **Action:** Step 3's marker line records the tip it reviewed (`at reviewed tip {sha}`). Immediately before `gh pr merge`, Step 5 fetches and compares `origin/main` with that tip:
  - **Unmoved:** the merge proceeds.
  - **Only run-dir archive commits arrived:** the reviewed tip advances, and nothing else happens.
  - **Real commits arrived:** Step 5 asserts the main checkout is on `main` and pulls it to the new tip, which it takes from the re-run review-tree check's printed sha. It runs a delta review over just the arrived commits, then re-enters the PR-check gate. That re-entry re-gates the bump on the arrived commits as well as the PR title.
  - **Blocking delta finding:** the release is held, the same `review: blocking` gate as Step 4.
  - **Bound passed:** once more moves arrive than `release-tip-moves` allows (default 2), the run stops `HELD — integration branch kept moving`. It prints the arrived commits under the HELD line and suggests pausing merges (#4041).
- **Should feel:** The release never ships a commit nobody reviewed, and a quiet repo never notices the check.
- **Should understand:** `HELD` here means nothing merged. Re-run once merges pause. A run with `--as` already pushed its `Release-As:` commit, so re-run without a second override.
- **Red flags:**
  - A release merged after `main` moved, with no delta-review lines in `decisions.md`.
  - A delta review or a counted move triggered by archive commits alone.
  - `pull --rebase` run on a main checkout that is not on `main`.
  - A `HELD — integration branch kept moving` summary with no commit list under it.
  - A breaking change that arrived after the console shipping as a minor.

## Origin
- Created during build of #2256 (record: The `/claude-tweaks:release` skill)
- Steps 1-4 built in this session
- Renamed from `release-a-version-2256.md` by #2257 (lifecycle wiring) — this is the payload's own release journey, for any consuming project using `/claude-tweaks:release`. It originally did **not** replace `release-a-plugin-version.md`: this repo's own release ran through a separate `plugin/bin/release.js <minor|patch>` mechanism until #2259 migrated this repo onto the shipped path. `release-a-plugin-version.md` was retired as part of that migration; this journey now covers this repo's own releases too.
- Related specs: #2254 (local engine), #2255 (preflight pack), #2258 (release train Routine), #2250 (design)
- Step 1 red flags updated for #3040 (the preflight pack's publish-hook probe now reads CRLF workflow files)
- Steps 2-3 updated and Step 5 added for #3898 (release run-dir lifecycle: Step 0 refuses a prior release's directory, every exit closes out, Step 8 disposes of staged findings and archives the created directory)
- Step 6 added for #4012 (Step 3's review-tree check accepts run-dir-only commits ahead, stops on a failed fetch, and names counts plus a recovery chosen by the failing clause)
- Step 7 added for #4041 (Step 5 compares `origin/main` with Step 3's reviewed tip before the merge, delta-reviews arrived commits, and holds past `release-tip-moves`)
- Step 3 red flags updated for #4156 (Step 8's disposition routes every review staging prefix through one roster, so `design-decision-*` and the other review-pass producers no longer fail archival as unrecognised)
- Step 3 red flags updated for #4155 (Step 8 disposition treats an unreadable `staged/` or `decisions.md` as a failure that blocks archival, never as an empty inventory)
- Steps 6-7 updated for #4157 (the review-tree check resolves the tip once, in its own first call, prints it as the recorded reviewed tip, and compares the trees against that pasted sha; Step 5's delta takes the new tip from that same printed sha)
