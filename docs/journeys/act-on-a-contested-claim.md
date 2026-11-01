---
files:
  - plugin/skills/flow/claim-targets.md
  - plugin/bin/claim-targets.js
  - plugin/bin/lib/claim-targets/claim-targets.js
  - plugin/bin/lib/issues/claim-store.js
  - plugin/bin/lib/issues/claims-git-cas.js
  - plugin/skills/_shared/issue-claims.md
  - plugin/bin/stale-claim-pr.js
  - plugin/bin/lib/issues/mcp-pr-shape.js
  - plugin/bin/pr-resume-line.js
  - plugin/bin/lib/flow/pr-body.js
---

# Act on a Contested Claim at the Start of a Run

**Persona:** claude-tweaks user typing `/claude-tweaks:flow #{n}` on a repo where another session — their own second terminal, a teammate's machine, or a scheduled dispatch firing — may already be building the same record.
**Goal:** When the run stops before it starts because the record is already claimed, learn within one screen whether the holder is actually alive, and take the one next step that fits — rather than guessing between waiting, reclaiming, and re-running.
**Entry point:** Typing `/claude-tweaks:flow #{n}` (or `/claude-tweaks:flow "#{n},#{m}"`) in a project whose work records live on GitHub.
**Success state:** The run either claims every named target and proceeds to the Config Manifesto, or stops with a card that names why — a contest card carrying the holder and a live / stale / remote verdict, an in-flight card carrying the open PR a prior build already produced, a claim-unverified card when this run's own write reported success but the post-write read-back didn't confirm it (#2073), or a claims-branch-missing card when the repository has no `claims-registry` branch and this run was not allowed to create it (#4495) — and in either case gives exactly one next step, leaving no worktree and no empty run directory behind.

## Steps

### 1. Start the run — terminal
- **URL:** `/claude-tweaks:flow #{n}` (or `/claude-tweaks:flow "#{n},#{m}"`)
- **Action:** Name the record(s) to build. The claim happens before any policy questions, so nothing has been configured or created yet when it decides.
- **Should feel:** Instant and quiet on the happy path — claiming is not something the user should have to think about.
- **Should understand:** Every named target is claimed together or none is — a partial claim is released before the run stops, so a second target is never left locked by a run that never started. On a repository's very first run, when its remote has no `claims-registry` branch yet, the claim step creates that branch once from the default branch's tip and then claims — silently, with no card (#4495).
- **Red flags:** The Config Manifesto rendering before the claim outcome is known; a multi-target run proceeding with one of its targets unclaimed; on a `gh`-absent (MCP) run, a claim stopped or released because its `bot:in-progress` label did not land — the label is best-effort, retried once through `mergeLabelNames`, and a second absence is a `SKIP` degrade line in `decisions.md`, never a stop (#3131).

### 2. Read the overlap note, if one appears — terminal
- **URL:** the same run output, immediately before the claim
- **Action:** Read any `Note: #{target} overlaps open #{other}` line and decide whether to cancel and re-run naming both records.
- **Should feel:** Like a tip, not an obstacle — the run continues either way.
- **Should understand:** This is informational only; the explicitly named list is never auto-expanded.
- **Red flags:** The note stopping the run, or a record the user never named being added to the run.

### 3. Read the contest card's verdict — terminal
- **URL:** the `## Flow: Claim contested` block, rendered in place of the Config Manifesto
- **Action:** Read the holder line (run id, session, host, claimed-at, expiry), then the paragraph beneath it — exactly one of Live sibling, Remote holder, or Stale holder.
- **Should feel:** Diagnosed, not stonewalled — the card answers "is anyone actually working on this?", not merely "it is locked".
- **Should understand:** The verdict is evidence-based and read-only — a host comparison, a match against the existing worktrees, and how recently the holding session last wrote its transcript. A missing artifact counts as evidence, so a verdict always renders and the lookup never blocks.
- **Red flags:** The *contest* card rendering with no verdict (the in-flight card of Step 3b legitimately has none); the run hanging while it gathers evidence; a Stale-holder verdict recommending a reclaim even though a worktree for the holding run still exists; the card asking the user to choose something when there is nothing to choose between.

### 3b. Distinguish an in-flight build from a contest — terminal
- **URL:** the `## Flow: Claim in-flight` block, rendered in place of the Config Manifesto
- **Action:** When a human is present (this run was not a headless `next`-form firing), the card's own routing resolves the linked PR's run identity and offers a "Confirm before resuming" prompt — answer it (Resume re-enters that run's Review Console; Cancel leaves it parked and this run stops as before). Under a headless firing, or when the PR carries no resolvable run identity, or its Resume line is missing or fails `bin/pr-resume-line.js`, the card is the terminal output — open the PR and resolve or merge it manually.
- **Should feel:** Like being told the work already exists and offered the one next step to reach it, not like being locked out.
- **Should understand:** The card fires in two cases. In the first, the record's claim blob is a released `pr-opened:` tombstone and its linked PR is still open: a prior build finished and is awaiting merge. In the second (#4423), the claim's 72h TTL expired mid-pipeline (`'stale'`) while an open PR in this repo still carries that claim's own run marker (`claude-tweaks-run: {runId}` on its own line). In both cases, reclaiming would start a second build racing that PR, so the run stops instead. Any other tombstone reason, a missing or foreign-repo `link`, a malformed stale `runId`, a marker that only appears inline in other text, or a failed liveness check all fall through to the ordinary reclaim (fail open). A failed stale-claim listing reclaims with one stderr warning. With `gh` absent, the manual MCP claim path runs the same match through `bin/stale-claim-pr.js` over the agent-fetched PR listing (#4596): a match stops the same way, and a failed check — a malformed listing entry, a non-github.com repo, any non-zero exit — reclaims after one line saying the check failed, never silently. This stop only fires on positive evidence of an open PR for this same repo. The resume-confirmation prompt makes no freshness judgment of its own — its own check tells a genuinely still-running build apart from one that only looks in-flight. One narrow exception (#4588): a `/claude-tweaks:dispatch resume #N` first call carries `RESUME_PR=<url>`, which Step 2.8 forwards as `--resume-pr`. A `'stale'` claim whose in-flight link is exactly that URL is then re-claimed by the ordinary conditional write instead of stopping, and the claim log line ends `, resume-pr: {url})`. A `pr-opened:` tombstone, or a `'stale'` claim whose link differs from the URL, still renders this card.
- **Red flags:** An in-flight card for a PR that is already merged or closed; a `link` pointing at another repository being followed at all; the run reclaiming and rebuilding a record whose PR is still open — including one whose claim merely expired while its draft PR waited, unless the invocation's `RESUME_PR` names exactly that PR; a resume re-claiming a stale claim whose link differs from `RESUME_PR`, or stopping at this card when the link matches; a stale claim this run already owns rendering the in-flight card instead of proceeding as already-owned; a failed stale-claim check reclaiming silently with no stderr line; the resume routing firing under a headless invocation with nobody present to answer it; a malformed Resume line (one carrying `!` or a control byte) routing into resume confirmation.

### 3c. Recognize a claim-unverified stop, distinct from a contest — terminal
- **URL:** the `## Flow: Claim unverified` block, rendered in place of the Config Manifesto
- **Action:** Read the one line: this run's own claim write reported success, but re-reading it did not confirm a live claim under this run's `runId` — nobody else necessarily holds the target.
- **Should feel:** Different from a contest, and said so plainly — this is "I can't confirm I actually got it," not "someone else has it."
- **Should understand:** The claim store's write and its post-write read-back can disagree (a slow-to-replicate contents-API read, or a genuine loss) — `claim-targets.js` (#2073) never proceeds on an unconfirmed write. On the contents-API path the read-back is retried a bounded number of times with backoff (#2329) before this card renders, so a transient replication lag does not surface here; the git-CAS path reads at the exact commit it pushed and is checked once. On the default all-or-abort path the run also attempts to release this target's own unconfirmed write — tombstoned when a fresh read still finds its blob, named in `releaseFailed` when that read fails or finds nothing, or the tombstone write itself fails — so a landed-but-unconfirmed claim never silently rides out its TTL. Under `--keep-going` the per-target skip does not attempt that release. `Next:` re-run the claim step (a lag that outlasted the retry window usually clears on a fresh attempt), or use `/claude-tweaks:tidy` to inspect the blob directly and repair it if warranted.
- **Red flags:** This card rendering with a `holder` line (there is no holder to report — that's the contest card's shape, not this one); the abort path leaving this target's own write neither released nor named in `releaseFailed`; the same target failing verification on every retry with no escalation path offered.

### 3d. Recognize a missing claims branch the run could not create — terminal
- **URL:** the `## Flow: Claims branch missing` block, rendered in place of the Config Manifesto
- **Action:** Read the quoted reason (the git push and contents-API refusal text, verbatim), then create `claims-registry` on origin from the default branch — the card's `Next:` — and re-run.
- **Should feel:** Like a setup step the repository is missing, named precisely — never like someone else is building the record.
- **Should understand:** The claim step already tried to create the branch once (`claim-targets.js` exit 6, #4495) and was refused — a permission error or a ruleset blocking ref creation — so retrying the run unchanged will stop the same way. The card names no holder because there is none. A branch that is still missing right after a creation that reported success, or a rate-limited creation, is instead a transient retry (the `## Flow: Claim failed` card), not this card. Under `/claude-tweaks:dispatch` this is a pre-flight stop: no retry attempt is counted and no failure comment is posted, and the drain moves on to its next record.
- **Red flags:** This card rendering with a `holder` line; the run reporting `contested` (exit 3) for a repository that simply has no claims branch — the false first-run contest this card replaced; the card recommending a retry with nothing changed; a "Released by run" comment appearing on the record after this stop.

### 4. Follow the verdict's own next step — terminal, or another session
- **URL:** the `Next:` clause of whichever verdict rendered
- **Action:** Live sibling — wait for that session to finish or release. Remote holder — inspect the session on the named host, or wait for the claim to expire. Stale holder — run `/claude-tweaks:tidy` to sweep and reclaim, unless the card pointed at a worktree that still exists, in which case inspect that worktree first.
- **Should feel:** Like one obvious action, not a menu of maybes.
- **Should understand:** Nothing was created by the stopped run — no worktree, and a run directory this invocation minted for itself is removed on the way out, so re-running later starts clean.
- **Red flags:** An empty run directory left behind after the stop; a sweep-and-reclaim recommended against a holder that is still live.

### 5. Re-run once the claim clears — terminal
- **URL:** `/claude-tweaks:flow #{n}` again
- **Action:** Re-invoke the same command; the claim now reads as released or expired and the run proceeds to the Config Manifesto.
- **Should feel:** Ordinary — the second attempt behaves exactly like a first attempt on an unclaimed record.
- **Should understand:** A run that was interrupted mid-build and is resumed under its own run directory is not a contest — it recognizes its own claim and continues rather than blocking itself.
- **Red flags:** A resumed run contesting against itself; a transient network failure (the `## Flow: Claim failed` card, which names no holder and just asks for a retry) being read as a competing claim.

## Origin
- Created during build of #722 (holder-liveness verdict in the claim-contest card) — the claim stop and its card already existed, but the card's only guidance was "wait for the claim to expire", so there was no decision to document; the live / stale / remote verdict and its per-verdict next step are what this journey covers.
- Extended during build of #315 (in-flight claim detection) — a `pr-opened:` tombstone with a still-open PR became a fourth claim-time outcome alongside live / stale / remote, with its own card and next step.
- Extended during build of #958 (in-flight claim routing) — the in-flight card's next step now routes into a resume confirmation when a human is present, instead of always requiring manual PR resolution.
- Extended during build of #4423 (stale-claim open-PR check) — a TTL-expired `'stale'` claim whose run marker sits on an open same-repo PR now stops with the same in-flight card and resume routing as the `pr-opened:` tombstone case (`claim-store.js`'s `staleClaimInFlightPr`); Step 3b's Should understand and Red flags name the second trigger.
- Extended during build of #4596 (one stale-claim matcher CLI) — Step 3b names the gh-absent MCP path's `bin/stale-claim-pr.js` call and its loud fail-open; `stale-claim-pr.js` and `mcp-pr-shape.js` added to `files:`.
- Extended during wrap-up of #4588 (`dispatch resume #N`) — Step 3b names the `RESUME_PR` / `--resume-pr` exception: a stale claim whose in-flight link is exactly the resumed PR re-claims instead of stopping; Red flags name both directions of a wrong match.
- Extended during build of #4659 (tombstone Resume-line read through the shared parser): Step 3b's resume routing now reads the PR body's `### Resume` line through `bin/pr-resume-line.js`. A Resume line that is missing or fails `parseResumeLine`, for example one carrying `!`, leaves the card terminal. A new red flag pins that case. `pr-resume-line.js` and `pr-body.js` were added to `files:`.
- Extended during wrap-up of record #2073 (post-write claim verification in `claim-targets.js`) — added step 3c documenting the new `## Flow: Claim unverified` card, and updated the Success state to name it as a third possible stop alongside the contest and in-flight cards.
- Extended during wrap-up of record #3131 (MCP `bot:in-progress` read-back in `flow/claim-targets.md`) — added a Step 1 red flag: a label that never lands is traced and retried once, never a reason to stop or release the claim.
- Extended during build of #4183 (post-write read-back retry and release-on-abort for #2329 in `claim-targets.js`) — step 3c now describes the contents-API read-back retry that runs before the card renders, and that the default all-or-abort path releases this target's own unconfirmed write, with `--keep-going` skipping that release.
- Extended during build of #4495 (claims-registry bootstrap) — Step 1 notes the first-run branch creation, step 3d documents the new `## Flow: Claims branch missing` card (`claim-targets.js` exit 6), and the Success state names it as a fourth stop; `claims-git-cas.js` added to `files:`.
- Related specs: #720, #721, #722, #723, #315, #958, #2073, #2329, #4495
