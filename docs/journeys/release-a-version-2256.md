---
files:
  - plugin/skills/release/SKILL.md
  - plugin/skills/release/console.md
  - plugin/skills/release/execute.md
  - plugin/skills/release/bookkeeping.md
  - plugin/skills/release/routine-template.yml
  - plugin/bin/release-preflight.js
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
- **Red flags:** A console row rendered green from a degraded pack field; a `Records shipped` row that silently dropped a commit with no `(#N)` suffix instead of listing it as unattributed.

### 2. Nothing to release — a quiet stop
- **URL:** the same command on a `main` with only `chore:`/`docs:` commits since the tag
- **Action:** Step 2 prints one line — `release: nothing to release since v1.2.0 (…)` — and stops; no review, no console.
- **Should feel:** A non-event; the next-actions row that suggested a release would not have appeared in the first place (#680).
- **Should understand:** A history whose commits are all unconventional reads as `no conventional commits since v1.2.0`, not as a bug.
- **Red flags:** A console rendered for an empty release; a bump proposed from a `chore:`-only history.

### 3. Ship — the live run
- **URL:** `/claude-tweaks:release`
- **Action:** Steps 1–4 as before; Step 5 reads the release PR's own checks against the `merge-verification` lever (red or still pending past the bound is `failed`, nothing moves) and then merges release-please's open PR with `gh pr merge --squash` (or, on a `local-merge` repo, runs `bin/release-local.js`); the version Steps 6 and 7 use is the one the engine actually shipped, reconciled once against the console's proposal; Step 6 waits — bounded — for the tag on origin, the GitHub Release and the `release: published` workflow run, and names any miss as a partial state with its recovery command; Step 7 comments `Shipped in v1.3.0` on each shipped record and closes it.
- **Should feel:** Slow in the right places — the verify step visibly waits for the hook rather than declaring victory at the merge.
- **Should understand:** Five outcome words, never folded: `released`, `dry-run`, `HELD` (a Step 4 gate fired before Step 5 — in any mode, not only the train — nothing moved, and `release-held.md` names which gate), `PARTIAL` (the release exists, something after it did not land), `failed` (Step 5 attempted and landed nothing). Under `local-merge` the engine's own exit code is the verdict (`5` means the tag is final and only the hook failed — re-run the hook, never the release; `1` is either nothing written or a named partial state, and its stderr says which). `--as` is pr-first only: on a `local-merge` repo it is refused right after the preflight pack, before any review runs.
- **Red flags:** `released` printed while the publish workflow is still running or failed; a record closed without the `Shipped in` comment; `--as 7.0.0` accepted without the major-bump gate; a red release PR merged because the review was clean; `Shipped in v1.3.0` written when the engine shipped `v1.4.0`.

### 4. Unattended — `--train`
- **URL:** `/claude-tweaks:release --train` — by hand on an `unattended` repo, or as the scheduled firing `/claude-tweaks:routine create release` instantiates from `skills/release/routine-template.yml` (the release train Routine, #2258: daily on weekdays, a refused nothing-moved `failed` stop until `release-train: true` and `autonomy: unattended` are set)
- **Action:** Refused unless `release-train: true` and `autonomy: unattended` — with a human present the refusal falls back to an on-demand run, in a headless firing it stops before Step 1 as `failed` with nothing moved; when accepted, Steps 1–4 run without a console prompt, and a major bump (effective, after `--as`) or `review: blocking` stages `release-held.md` and exits with `HELD`; a Step 6 miss after the merge landed is `PARTIAL`, never `HELD`.
- **Should feel:** Trustworthy to leave alone — the two things it will never do on its own (ship a major, ship past a blocking review) are exactly the two a human would want to see.
- **Should understand:** `HELD` means nothing moved; `PARTIAL` means the tag landed and the hook did not — different recovery, different urgency.
- **Red flags:** `--allow-blocking` honoured under `--train`; a `HELD` summary on a run whose merge actually happened.

## Origin
- Created during build of #2256 (record: The `/claude-tweaks:release` skill)
- Steps 1-4 built in this session
- Related specs: #2254 (local engine), #2255 (preflight pack), #2257 (lifecycle wiring — will retire `release-a-plugin-version.md` in favour of this journey), #2258 (release train Routine), #2250 (design)
