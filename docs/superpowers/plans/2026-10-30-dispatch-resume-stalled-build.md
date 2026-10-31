# Dispatch Resume for a Stalled Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:dispatch resume #N` restarts a dispatched build that stalled before the test gate, on its still-open draft PR, with no hand-run plumbing.

**Architecture:** One pure verdict module (`bin/lib/dispatch/resume-eligibility.js`) decides eligibility from the PR, claim blob, labels, prior-run-dir state and sibling liveness, and derives the resume-context block from the archived run's `decisions.md`. A thin gatherer CLI (`bin/dispatch-resume.js --issue <N>`) feeds it live inputs: it finds the PR by head branch `worktree-dispatch-record-{N}` (never from `dispatch-exclusions.json` — a `bot:in-progress` record is dropped by the queue's label pre-filter before the `open-pr` pass and has no exclusion entry), reads the record's labels and claim blob, and classifies the prior run directory archive-first. `claim-targets.js` gains a narrow `--resume-pr <url>` exception for a `'stale'` claim whose in-flight link is exactly that PR; `/flow` forwards it only when invoked with `RESUME_PR=<url>`. The dispatch procedure lives in a new lazy sub-file `dispatch/resume.md` because `dispatch/SKILL.md` has only ~1.5 KB of rail headroom.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T200217-spec-4588/work/4588-spec.md` (worktree copy; refreshed 2026-10-30 with the answered eligibility rules — issuecomment-6532612775 — and 2026-10-31 with the owner-process dead-owner rule and the open-pr-only remedy criterion — issuecomment-6533615614)

Scope keywords: staleClaimInFlightPr, already has an open PR, claimLogText

## Global Constraints

- Run-id shape: import `RUN_ID_SHAPE` from `plugin/bin/lib/issues/claim-store.js` — never a new regex literal. Any prose copy of the regex must equal `RUN_ID_SHAPE.source` (`tests/issue-claims-stale-open-pr-conformance.test.js`); prefer naming the constant in prose instead of copying it.
- Resume head branch: exactly `worktree-dispatch-record-{N}`; prior run-id slug: exactly `record-{N}` (run id ends `-record-{N}` and matches `RUN_ID_SHAPE`). The PR is always found from that head branch, never from `dispatch-exclusions.json`.
- Eligible claim states (`classifyClaimBlob`): a tombstone whose `reason` starts with `failed:` or `abandoned:`, or `'stale'`. Nothing else. `failed:`/`abandoned:` re-claim by the ordinary conditional write; `'stale'` re-claims through `--resume-pr`.
- Eligible labels: `auto:build` present and `bot:blocked` absent; `bot:in-progress` only together with a `'stale'` claim. Resume never adds, removes or restores a grant label — a human re-grants via `/claude-tweaks:backlog refine #N`.
- Prior run directory (main checkout's `.claude-tweaks/pipelines/`, resolved as `hooks.js resolve-run-dir --root-only` resolves `$RUN_ROOT` — never cwd): `archive/{runId}` checked first. Eligible when archived, absent, present holding only a `work/` entry, or present with a dead owner. **"Dead owner" is the owner-process probe alone** (spec D1, decided 2026-10-31): no `run-state.json`, a `run-state.json` with no `owner` block, an `owner.sessionId` equal to the resuming session's own `CLAUDE_CODE_SESSION_ID`, or `probeOwnerPid(owner, DEFAULT_PROBES)` (`bin/lib/run-liveness/owner-pid-probe.js`, `probes.js`) reading the process not live. Never `runLiveness`: heartbeat, worktree-lock and last-commit recency do not make an owner live here — the sibling-session check (run before the mint and repeated after entering the worktree) refuses a live session in that worktree. A live owner, or a probe that could not ask (an `error` result, an unreadable `run-state.json`), is refused. A present directory with a `run-state.json` and a dead owner is archived before the new run dir is minted (`close-run --run` first when its status is non-terminal, then `archive-run --run`).
- `--resume-pr` changes only the `'stale'` + in-flight-link-equals-flag branch of `claim-targets.js`. A `pr-opened:` tombstone, or an in-flight link that differs, still exits 3 unchanged. Without `--resume-pr`, stdout envelopes stay byte-identical to today.
- Resume adds no PR-body write — `pr-early-open.js` rebinds the reused PR (#4580).
- The resumable PR is an open **draft** (`isDraft: true`): the gatherer requests `isDraft` and the verdict refuses a non-draft PR (`not-draft`).
- Only `open-pr-exclusion-report.md`'s named-record line names `dispatch resume #N` (spec AC, decided 2026-10-31): `dispatch #N`'s "already claimed" refusal for a `bot:in-progress` + `'stale'` record is unchanged, and `dispatch/SKILL.md`'s `#N` bullet (Step 3) is not edited.
- Rail: `plugin/skills/**/*.md` ≤ 52,500 B (`RAIL_BYTES`). Headroom measured after the 2026-10-30 catch-up merge: `dispatch/SKILL.md` 50,928 (1,572 left), `flow/SKILL.md` 50,366 (2,134), `dispatch/task-prompt.md` 49,154 (3,346), `_shared/issue-claims.md` 46,992 (5,508), `flow/claim-targets.md` 35,436. Re-measure with `wc -c` after each prose edit.
- Skill references in actionable text use `/claude-tweaks:{skill}`.
- Intermediate commits say `refs #4588`, never `closes`.
- Scope and edit discipline: Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Review Focus

1. A stale claim whose marker sits on a *different* open PR than `--resume-pr` names must still stop in-flight (exit 3) — pinned in Task 1 (`resume-pr mismatched link`).
2. A `pr-opened:` tombstone with `--resume-pr` equal to its link must still stop (close-out owns it) — pinned in Task 1 and Task 2.
3. The widened claim-log line must still classify as a claim entry for `classifyDecisions` (preflight's fresh-mint test), or every resumed run's adoption breaks — pinned in Task 1.
4. A PR body whose marker run id is for another record (`-record-{M}`), or is malformed, is a foreign PR, not eligible — pinned in Task 2.
5. The dispatcher's own Worktree-resume sibling check (`sibling-session-check.md`) treats a resumed worktree as a sibling conflict; the resume procedure must state the exception or it refuses its own resume — pinned by Task 4's conformance assertion.
6. The prior-run-dir classification checks `archive/{runId}` before `{runId}`: a run that was archived and then had a late write recreate a `work/`-only stub at the root must read `archived`, not `residue` or `live` — pinned in Task 3.
7. `bot:in-progress` is accepted only with a `'stale'` claim; with a `failed:`/`abandoned:` tombstone it is refused (`label-drift`) — pinned in Task 2.
8. Dead owner is the owner-process probe alone: a fresh heartbeat or a held worktree lock with a gone owner pid still reads `dead-owner`; the resuming session's own session id reads `dead-owner`; a probe `error` reads `unknown-owner` (refused), never dead — pinned in Task 3.
9. A concurrent resume of the same record that entered the worktree first is caught by the sibling check repeated after this session enters and binds the worktree; the claim write stays the atomic boundary — pinned by Task 4's conformance assertion on step order.
10. A non-draft open PR on the head branch is refused (`not-draft`), not resumed — pinned in Tasks 2 and 3.

---

### Task 1: `claim-targets.js --resume-pr` and the claim-log line that names the adopted PR

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`parseArgs`, `USAGE`, the `'stale'` in-flight branch ~L500-512, final envelope ~L647)
- Modify: `plugin/bin/claim-targets.js` (header comment usage line)
- Modify: `plugin/bin/lib/log-decision/claim-log.js` (`claimLogText`, `SINGLE_FULL_SRC`)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`, `tests/bin-lib/log-decision/claim-log.test.js`

**Interfaces:**
- Produces: CLI flag `--resume-pr <url>`; envelope key `resumedPr: [{issue, link}]` present **only** when `--resume-pr` was passed; `claimLogText(n, transport, resumePr?)` → `claimed #N (bin/claim-targets.js, transport: {t})` or, with `resumePr`, `claimed #N (bin/claim-targets.js, transport: {t}, resume-pr: {url})`; `deps.appendClaimLog({runDir, issue, transport, resumePr})`.
- The `--resume-pr` value is the PR `url` as `gh pr list --json url` prints it (`https://github.com/{owner}/{repo}/pull/{n}`) — the same field `staleClaimInFlightPr` returns as `link`, so the equality is exact string equality with no normalization.

- [ ] **Step 1: Write the failing tests** (follow the file's existing fake-deps helpers for a stale blob + `gh pr list` returning a marked PR)
  - `resume-pr re-claims a stale blob whose in-flight link equals the flag`: stale blob, marked open PR `https://github.com/o/r/pull/7`, argv `--resume-pr https://github.com/o/r/pull/7` → exit 0, `claimed` includes the issue, `resumedPr` deepEquals `[{issue, link: 'https://github.com/o/r/pull/7'}]`, a claim write happened.
  - `resume-pr mismatched link still stops in-flight`: same blob, flag `.../pull/8` → exit 3, `inFlight[0].link === '.../pull/7'`, no write.
  - `resume-pr never overrides a pr-opened tombstone`: tombstone `reason: 'pr-opened: …'`, `link: .../pull/7`, PR state OPEN, flag `.../pull/7` → exit 3 `inFlight`.
  - `an abandoned: tombstone re-claims by the ordinary write`: tombstone `reason: 'abandoned: spec 4589'`, flag `.../pull/7` → exit 0, `claimed` includes the issue, `resumedPr` is `[]` (the flag was passed, but no stale branch ran).
  - `without resume-pr the stale in-flight stop is unchanged and the envelope has no resumedPr key`: existing #4423 shape, assert `!('resumedPr' in envelope)`.
  - `resume-pr with no value is malformed`: argv ending in `--resume-pr` → exit 2, USAGE on stderr.
  - `resume-pr with --run passes resumePr to appendClaimLog`: spy `appendClaimLog` receives `resumePr: '.../pull/7'` for the resumed issue only.
  - claim-log.test.js: `claimLogText(5, 'git', 'https://github.com/o/r/pull/7')` equals `claimed #5 (bin/claim-targets.js, transport: git, resume-pr: https://github.com/o/r/pull/7)`; a formatted `AUTO` Step 2.8 line with that text → `isClaimLogEntry` true, `classifyDecisions` of a file holding only that line (plus `## /flow`) → `'claim-log-only'`, `hasCanonicalClaimLogFor(body, 5)` true; `... resume-pr: not-a-url)` → `isClaimLogEntry` false.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/log-decision/claim-log.test.js`
  Expected: FAIL (unknown argument `--resume-pr`; `claimLogText` ignores 3rd arg)

- [ ] **Step 3: Implement**
  - `parseArgs`: `resumePr: null`; `--resume-pr` → `next()`; in `run()` reject `undefined`/blank/value starting `--` with USAGE exit 2 (same posture as `--run`). Add the flag to `USAGE` with one line: re-claims a stale claim whose in-flight PR is exactly `<url>` (dispatch resume, #4588).
  - In the `'stale'` branch: when `inFlight && opts.resumePr !== null && inFlight.link === opts.resumePr`, record `resumedPr.push({issue, link})` and fall through to the conditional-write re-claim instead of `stopOrSkip`. Tombstone branch untouched.
  - Envelope: spread `...(opts.resumePr !== null ? { resumedPr } : {})`.
  - Claim log: pass `resumePr` (the link, only for issues in `resumedPr`) into `deps.appendClaimLog`; `defaultAppendClaimLog` forwards it to `claimLogText`.
  - `claim-log.js`: `SINGLE_FULL_SRC` gains the optional suffix `(?:, resume-pr: https://github\\.com/[^\\s/()]+/[^\\s/()]+/pull/\\d+)?` before `\\)`. Update the module header comment's reader list unchanged in meaning.
  - Consumers of the widened shape (verified by grep `claimLogText\|isClaimLogEntry\|hasCanonicalClaimLogFor\|classifyDecisions` over `plugin/bin`): `lib/flow/preflight.js`, `lib/hooks/pre-tool-use.js`, `verify-run-bookends.js` — all read through `claim-log.js`, so no edit there; re-run their suites in Step 4.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/claim-targets/ tests/bin-lib/log-decision/ tests/bin-lib/flow/preflight.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/verify-run-bookends.test.js tests/issue-claims-stale-open-pr-conformance.test.js`
  Expected: all pass (quote the `# pass`/`# fail` lines).

- [ ] **Step 5: Commit** — `Add claim-targets --resume-pr — re-claim a stale claim on the PR it resumes (refs #4588)`

### Task 2: Resume eligibility verdict and resume-context derivation

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/dispatch/resume-eligibility.js`
- Create: `tests/fixtures/dispatch-resume/record-4589-decisions.md` — a byte copy of the real archived run `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-30T101632-record-4589/decisions.md`
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js`

**Interfaces:**
- Consumes: `classifyClaimBlob(content, now)` (`bin/lib/issues/claims.js`), `RUN_ID_SHAPE` (`bin/lib/issues/claim-store.js`), `parseEntry` (`bin/lib/log-decision/append.js`).
- Produces:
  - `runIdFromPrBody(body: string) -> string|null` — the run id from the first trimmed line equal to `claude-tweaks-run: {id}` or `<!-- claude-tweaks-run: {id} -->` whose id matches `RUN_ID_SHAPE`; else null.
  - `resumeEligibility({ issue: number, pr: {url, headRefName, body, isDraft}|null, claimContent: string|null, labels: string[], now: number, priorRunDir: 'archived'|'absent'|'residue'|'stateless'|'dead-owner'|'live-owner'|'unknown-owner', priorRunOpen: boolean, siblingLive: boolean }) -> { eligible: true, priorRunId, prUrl, priorRunDir, archivePriorRun: boolean, closePriorRun: boolean } | { eligible: false, reason, line }`
    - `priorRunDir` is echoed on the eligible result so `stateless` and `residue` (both unarchived) stay distinguishable downstream.
    - `stateless` (no `run-state.json`) is a dead owner per the spec, but it is eligible with `archivePriorRun` `false` — `archive-run` refuses a directory with no readable `run-state.json` (`hooks.js` `runArchiveRun`; reconcile's orphaned-mint sweep owns it), so the resume procedure logs it and proceeds.
    - `archivePriorRun` is `true` only for `dead-owner` (a `run-state.json` is present); `closePriorRun` is `dead-owner && priorRunOpen` (`priorRunOpen` = status in `NON_TERMINAL`; a non-terminal run must be closed before `archive-run` accepts it). `priorRunOpen` is ignored for every other class. There is no `closed` class: a terminal status never decides eligibility — only the owner probe does.
  - `resumeContext(decisionsText: string) -> { lastPhase: {section, step}|null, openDefects: string[] }`
  - `REFUSAL_REASONS` frozen: `no-pr`, `foreign-pr`, `not-draft`, `live-sibling`, `pr-opened`, `live-claim`, `claim-not-resumable`, `not-granted`, `label-drift`, `prior-run-live`.

Refusal order and `line` text (exact; `{N}`, `{pr}` = PR number from the url, `{url}`, `{runId}` = the PR marker's run id):
1. `pr` null → `no-pr`, line `#{N} has no open PR on worktree-dispatch-record-{N} — nothing to resume; run /claude-tweaks:dispatch #{N}`.
2. head ≠ `worktree-dispatch-record-{N}`, or `runIdFromPrBody` null, or run id not ending `-record-{N}` → `foreign-pr`, line = the existing open-pr line `#{N} already has an open PR (#{pr}) — not re-dispatch-eligible until that PR merges or closes`.
3. `pr.isDraft !== true` → `not-draft`, line `#{N}'s PR #{pr} is not a draft — dispatch resume only restarts a stalled build's draft PR; if it awaits review, run /claude-tweaks:dispatch close-out #{N}`.
4. `siblingLive` → `live-sibling`, same open-pr line.
5. claim tombstone with `reason` starting `pr-opened:` → `pr-opened`, line `#{N}'s PR #{pr} finished its build and awaits review — run /claude-tweaks:dispatch close-out #{N}`.
6. claim `live` → `live-claim`, line `#{N} is already claimed by a live run — not resumable`.
7. claim not (`stale`, or tombstone with `reason` starting `failed:` or `abandoned:`) → `claim-not-resumable`, line `#{N}'s claim is {state}{ (reason)} — dispatch resume needs a failed: or abandoned: tombstone, or a stale claim`.
8. `labels` lacks `auto:build` or holds `bot:blocked` → `not-granted`, line `#{N} {carries bot:blocked | lacks auto:build} — re-grant it with /claude-tweaks:backlog refine #{N}, then run /claude-tweaks:dispatch resume #{N}` (`carries bot:blocked` wins when both hold).
9. `labels` holds `bot:in-progress` and the claim is not `stale` → `label-drift`, line `#{N} carries bot:in-progress without a stale claim — remove that label (gh issue edit {N} --remove-label bot:in-progress), then run /claude-tweaks:dispatch resume #{N}`.
10. `priorRunDir` is `live-owner` or `unknown-owner` → `prior-run-live`, line `#{N}'s prior run {runId} has an owner that is not provably dead ({live | unknown}) — not resumable while it may still be running`.

`resumeContext` rules: pipeline sections are `/flow`, `/build`, `/test`, `/review`, `/design-wrapper` (`/dispatch`, `/wrap-up` record settle/teardown, not progress). `lastPhase` = `{section, step}` of the last entry, in file order, within the last pipeline section heading in the file; `step` = `parseEntry(line).location`. `openDefects` = the `action` text of every `KEPT-PROMPT` or `REFUSED` entry in pipeline sections, in file order, each truncated to 300 chars with `…`.

- [ ] **Step 1: Write the failing tests** — the spec's eligibility pins plus Review Focus lines 4, 7 and 10. Base every case on the real #4589 shapes: head `worktree-dispatch-record-4589`, `isDraft: true`, body with both marker forms naming `2026-10-30T101632-record-4589`, labels `['ready','auto:build','type:task']`, `priorRunDir: 'archived'`, `priorRunOpen: false`, `siblingLive: false`.
  - `own stalled PR with failed: tombstone → eligible` (claim `{"released":true,"runId":"2026-10-30T101632-record-4589","reason":"failed: plan-review-needs-human",…}`; `priorRunId`, `prUrl` and `priorRunDir: 'archived'` echoed; `archivePriorRun` and `closePriorRun` false).
  - `non-draft PR → not-draft` (`isDraft: false`, otherwise the eligible shape) → line contains `/claude-tweaks:dispatch close-out #4589`.
  - `own stalled PR with abandoned: tombstone → eligible` (`reason: "abandoned: spec 4589"`).
  - `own stalled PR with stale claim → eligible`, including with `bot:in-progress` in `labels` (a non-released claim whose `claimedAt`/TTL is past `now`; build it with `claimPayload` from claims.js).
  - Prior run dir: `residue`, `stateless`, `absent` → eligible with `archivePriorRun` false, each echoing its own `priorRunDir` (assert `residue` and `stateless` results differ); `dead-owner` + `priorRunOpen: true` → eligible, both true; `dead-owner` + `priorRunOpen: false` → eligible, `archivePriorRun` true, `closePriorRun` false; `live-owner` and `unknown-owner` → `prior-run-live`; `priorRunOpen: true` with `residue` → `closePriorRun` false.
  - `bot:blocked → not-granted` and `no auto:build → not-granted`, each line containing `/claude-tweaks:backlog refine #4589`.
  - `bot:in-progress with a failed: tombstone → label-drift`.
  - `no PR → no-pr`.
  - `foreign PR → refused` (head `worktree-dispatch-record-9999`; and separately marker `…-record-12` on the right head) → reason `foreign-pr`, line contains `already has an open PR`.
  - `live sibling run → refused` → `live-sibling`.
  - `pr-opened: tombstone → refused toward close-out` → line contains `/claude-tweaks:dispatch close-out #4589`.
  - `live claim → refused` → `live-claim`; `absent claim → claim-not-resumable`.
  - `runIdFromPrBody` ignores a substring mention and a malformed id.
  - `resumeContext on the real archived #4589 run`: exact pins — `lastPhase` deepEquals `{section: '/build', step: 'Common Step 1.5'}`; `openDefects.length === 1` and `openDefects[0].startsWith('plan review: 2 needs-human spec gap(s)')`. (Implementer: confirm these against the fixture with an independent `grep -n` before pinning; if the fixture disagrees, pin what the file actually holds and say so in the report.)

- [ ] **Step 2: Run to verify fail** — `node --test tests/bin-lib/dispatch/resume-eligibility.test.js` → FAIL (module not found)
- [ ] **Step 3: Implement** the three functions in `resume-eligibility.js` with a header comment citing #4588 and `exclusions.js` as its sibling.
- [ ] **Step 4: Run to verify pass** — same command, all pass.
- [ ] **Step 5: Commit** — `Add dispatch resume eligibility verdict — pure rule plus archived-run context (refs #4588)`

### Task 3: `bin/dispatch-resume.js` gatherer CLI

**Review risk:** high

**Files:**
- Create: `plugin/bin/dispatch-resume.js`
- Test: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
- Modify: `docs/plugin-structure.md` (CLI listing, next to the other `plugin/bin/*.js` entries)

**Interfaces:**
- Consumes: Task 2's `resumeEligibility`, `resumeContext`, `runIdFromPrBody`; `claimStore.readClaimBlob(deps, repoSlug, issue, null)` and `claimStore.resolveRepoSlugOrThrow(gh)`; `findConflictingSession(recordRef, {cwd})` (`bin/lib/hooks/sibling-sessions.js`); `probeOwnerPid(owner, probes)` (`bin/lib/run-liveness/owner-pid-probe.js`, `{result: 'positive'|'negative'|'error', detail}`) with `DEFAULT_PROBES` (`bin/lib/run-liveness/probes.js`) — **not** `runLiveness`; `NON_TERMINAL` (`bin/lib/hooks/run-integrity.js`).
- Produces: `node bin/dispatch-resume.js --issue <N> [--help]` exporting `run(argv, deps)` and `realDeps` (gh-api-module-pattern skill's CLI seam). Stdout one JSON line: eligible → `{eligible:true, issue, prUrl, prNumber, headRefName, priorRunId, priorRunDir, priorRunPath, archivePriorRun, closePriorRun, worktreePath, context:{lastPhase, openDefects}}`; refused → `{eligible:false, issue, reason, line}`. Exit 0 eligible, 3 refused, 2 malformed argv / gh absent / slug unresolved, 4 transient (PR list, label read or claim read failure).
- Inputs gathered:
  - PR: `gh pr list --repo {slug} --head worktree-dispatch-record-{N} --state open --json url,number,headRefName,body,isDraft,isCrossRepository`; keep entries with `isCrossRepository === false`; none → `pr: null` (`no-pr`); more than one → `foreign-pr` (ambiguous). `isDraft` is passed through to the verdict (`not-draft`). Verified shape 2026-10-30 against PR #4604: `headRefName: worktree-dispatch-record-4589`, `state: OPEN`, `isCrossRepository: false`, body carrying both marker forms (implementer: confirm `isDraft: true` there with `gh pr view 4604 --json isDraft`).
  - Labels: `gh issue view {N} --repo {slug} --json labels --jq '[.labels[].name]'`.
  - Claim: `readClaimBlob`; a `failure` result → exit 4.
  - Sibling: `siblingLive = findConflictingSession('#' + N, {cwd}) !== null`.
  - `priorRunDir`, with `root` = the main checkout's `.claude-tweaks/pipelines` (resolve `$RUN_ROOT` the way `hooks.js resolve-run-dir --root-only` does — reuse its helper, never cwd), checked in this order: `{root}/archive/{runId}` exists → `archived`; `{root}/{runId}` absent → `absent`; its entries are exactly `['work']` → `residue`; no `run-state.json` → `stateless`; `run-state.json` unreadable or not a JSON object → `unknown-owner`; otherwise the **owner-process probe alone** on its `owner` block: no `owner` object → `dead-owner`; `owner.sessionId` equal to `deps.sessionId` (`process.env.CLAUDE_CODE_SESSION_ID`, non-empty) → `dead-owner` (the resuming session never counts as a live owner); else `probeOwnerPid(owner, deps.probes)` — `positive`, or `negative` with detail `alive-no-start-time` → `live-owner` (the reading `hooks/context.js`'s `stampedOwnerProvablyAlive` makes); `error` → `unknown-owner`; any other `negative` (`gone`, `pid-reused`, `no-pid`, `other-host`) → `dead-owner`. `priorRunOpen` = the parsed `status` is in `NON_TERMINAL`. `priorRunPath` = `{root}/{runId}` when present, else null. Heartbeat, worktree lock and last commit are never read here.
  - `worktreePath` = `{main root}/.claude/worktrees/dispatch-record-{N}` (reported even when missing; the skill recreates it). `context` read from whichever of `{root}/archive/{runId}/decisions.md` / `{root}/{runId}/decisions.md` exists, else `{lastPhase:null, openDefects:[]}`.

- [ ] **Step 1: Write failing tests** with injected deps (fake `gh`, fake `readClaim`, fake fs existence/readdir/read, fake `findSibling`, fake `probes` for `probeOwnerPid`, `sessionId`): eligible JSON + exit 0, carrying `priorRunDir`; foreign head → exit 3 with the open-pr line; `isDraft: false` → exit 3 `not-draft`; the `gh pr list` argv's `--json` value includes `isDraft`; no open PR → exit 3 `no-pr`; `bot:blocked` label → exit 3 `not-granted`; archive-first: both `{root}/archive/{runId}` and a `work/`-only `{root}/{runId}` exist → `archived` (eligible, `archivePriorRun: false`); `work/`-only root dir with no archive → `residue`; no `run-state.json` → `stateless` (eligible, `archivePriorRun: false`, `priorRunDir: 'stateless'`); `run-state.json` with no `owner` block → `dead-owner`; non-terminal run-state whose owner pid is gone (`pidAlive` false) → eligible with `archivePriorRun` and `closePriorRun` true and `priorRunPath` set — **and** the same with a fresh `heartbeatAt` and a held worktree lock in the fixture, still `dead-owner` (Review Focus 8); terminal status + gone pid → `archivePriorRun` true, `closePriorRun` false; owner `sessionId` equal to `deps.sessionId` with a live pid → `dead-owner`; owner pid alive with a matching start time → exit 3 `prior-run-live` (`live`); `pidAlive` throwing → exit 3 `prior-run-live` (`unknown`); unparseable `run-state.json` → exit 3 `prior-run-live` (`unknown`); missing `--issue` → exit 2; gh throws on `pr list` → exit 4; claim read `failure` → exit 4.
- [ ] **Step 2: Run** `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js` → FAIL
- [ ] **Step 3: Implement**; executable bit (`chmod +x`), `windowsHide: true` on `execFileSync`, `--end-of-options`-safe argv per the gh-api-module-pattern skill.
- [ ] **Step 4: Run** → pass. **Real-input probe (read-only):** run `node plugin/bin/dispatch-resume.js --issue 4589` from the worktree and record the printed JSON in the task report; expected `eligible: true`, `priorRunId: 2026-10-30T101632-record-4589`, `priorRunDir: 'archived'`, `archivePriorRun: false` (that run is archived) — cross-check `priorRunId` against `gh pr view 4604 --json body` independently. (If a sibling session now holds #4589, a `live-sibling` refusal is the correct output — report it as observed.)
- [ ] **Step 5: Commit** — `Add dispatch-resume CLI — gather PR, labels, claim and run state for the resume verdict (refs #4588)`

### Task 4: Dispatch prose — `resume #N` form, resume sub-file, remedy line, first-call `RESUME_PR`

**Review risk:** high

**Files:**
- Create: `plugin/skills/dispatch/resume.md`
- Modify: `plugin/skills/dispatch/SKILL.md` (frontmatter `argument-hint`, one Input-table row — budget ≤ 900 B total growth)
- Modify: `plugin/skills/dispatch/open-pr-exclusion-report.md` (remedy)
- Modify: `plugin/skills/dispatch/task-prompt.md` (first call: `RESUME_PR` prefix decision + `{resume-context}` block — budget ≤ 1,500 B)
- Modify: `docs/plugin-structure.md` (dispatch sub-file table row for `resume.md`)
- Modify: `tests/dispatch-named-form-exclusion-reasons.test.js` (L83 pins the old open-pr named-record line verbatim, closing backtick included)
- Modify: `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md` (L33 quotes the open-pr named-record line verbatim — plan-audit Check B hit)
- Test (create): `tests/dispatch-resume-prose.test.js`

**Interfaces:**
- Consumes: Task 3's CLI and its JSON; Task 1's flag; Task 5's flow forwarding (`RESUME_PR=<url>` before `/claude-tweaks:flow`).

Content decisions:
- Input row: `resume #N` — a distinct mode like `close-out`: restart a dispatched build that stalled before the test gate on its own still-open draft PR. Read `resume.md` and follow it; Steps 2-3 (queue pull, selection) do not apply — the record is dispatched alone. No Step 3 bullet, and the existing `#N` bullet is **not edited** (spec AC, decided 2026-10-31: only the open-pr exclusion line names the resume remedy; `#N`'s "already claimed" refusal stays as it is).
- `resume.md` procedure, numbered: (1) Step 1's run-id rule as for `#N`; (2) run `bin/dispatch-resume.js --issue N` — exit 3 prints its `line` verbatim and stops (refusals: no PR → plain dispatch; foreign PR / live sibling → open-pr line; non-draft PR → close-out remedy; `pr-opened:` → close-out remedy; live claim → already claimed; `bot:blocked` / no `auto:build` → `/claude-tweaks:backlog refine #N`; `bot:in-progress` without a stale claim → remove the label; prior run's owner not provably dead (owner-process probe) → refused), exit 2/4 stop with the stderr; (3) when `archivePriorRun` is true: confirm the main checkout's index is empty (`git diff --cached --quiet`; `archive-run` commits whatever is staged), run `hooks.js close-run --run {priorRunPath}` first when `closePriorRun` is true, then `hooks.js archive-run --run {priorRunPath}`, and verify `{root}/archive/{priorRunId}` now exists — otherwise print `archive-run`'s line and stop before minting; a `stateless` prior dir (`priorRunDir: 'stateless'`) is logged and left to reconcile's orphaned-mint sweep, a `residue` one is logged as residue; (4) Step 4's mint as for `#N` (`resolve-run-dir --create`); (5) enter the existing worktree by path — `EnterWorktree(path:)` on `worktreePath`; when it is missing, `git -C {main} fetch origin {headRefName}` then `git -C {main} worktree add {worktreePath} {headRefName}` (branch exists locally) or `-b {headRefName} origin/{headRefName}`; **this deliberate re-entry is exempt from `sibling-session-check.md`'s Worktree-resume check** (a resumed worktree is the point here, not a conflict signal); (6) `record-worktree --dispatch` binding as Step 5 does; (6a) **repeat the sibling check** now that this session is in and bound to the worktree — `hooks.js check-sibling-sessions --record "$ISSUE"` (`findConflictingSession` skips worktrees this session's own run dirs record, so step 6's binding is what makes this session's own lock not read as a sibling; implementer: verify that against `ownedWorktreePaths` and state it in the report). A conflict line → `ExitWorktree(action: "keep")`, log it, stop without dispatching either call; this closes the window where two concurrent resumes both passed step 2's check, and the claim write inside call 1 stays the atomic boundary; (7) dispatch the normal two-call sequence with handoff continuations via `task-prompt.md`, adding `RESUME_PR="{prUrl}" ` before `/claude-tweaks:flow` on the first call and substituting `{resume-context}` from the CLI's `context`; the PR is reused — no PR-body write (`pr-early-open.js` rebinds it, #4580); (8) Step 6 settle and Step 1's close-out as for `#N`. Name the claim cases: a `failed:` or `abandoned:` tombstone re-claims normally; `'stale'` re-claims through `--resume-pr`. Name that resume never adds or removes a grant label.
- `open-pr-exclusion-report.md` named-record line becomes: `#{N} already has an open PR (#{pr}) — not re-dispatch-eligible until that PR merges or closes; if it is #{N}'s own stalled build, run /claude-tweaks:dispatch resume #{N}`.
- task-prompt.md: one paragraph next to the `DISPATCH_HEADLESS=1` decision — the dispatching session adds `RESUME_PR="{pr-url}" ` immediately before `/claude-tweaks:flow` on the first-call line **only** for `dispatch resume`, never otherwise, never in the second call or continuations (the claim is self-owned by then); and a `{resume-context}` placeholder (omitted entirely outside resume) rendered as: `Resuming stalled run {priorRunId} on PR {prUrl}; last logged phase: {section} {step}; open defects: {each}` — with fallbacks: a null `lastPhase` renders `last logged phase: none recorded`, an empty `openDefects` renders `open defects: none recorded`.

- [ ] **Step 1: Write failing conformance test** `tests/dispatch-resume-prose.test.js` (live-corpus reads, per skill-prose-conformance-tests skill): SKILL.md Input table has a `resume #N` row citing `resume.md`; SKILL.md's `#N` bullet (the Step 3 line starting ``**`#N`** — direct.``) does not contain `dispatch resume` and is not otherwise edited by this build (the implementer confirms with `git diff {merge-base} -- plugin/skills/dispatch/SKILL.md` showing no hunk on that line — a review-time check, not a committed `git` call in the test, since CI checkouts are shallow), and the phrase `dispatch resume` appears in SKILL.md only inside the Input-table row and `argument-hint`; `resume.md` names `bin/dispatch-resume.js`, `--issue`, `RESUME_PR`, `record-worktree --dispatch`, `Worktree-resume` exemption, `close-out`, `/claude-tweaks:backlog refine`, `close-run`, `archive-run`, `check-sibling-sessions`, and places the `archive-run` step before the `resolve-run-dir --create` mint and a `check-sibling-sessions` mention after the `record-worktree --dispatch` binding and before the two-call dispatch; contains no PR-body write instruction (`gh pr edit` absent) and no `dispatch-exclusions.json` eligibility requirement; open-pr report contains `/claude-tweaks:dispatch resume #{N}`; task-prompt.md states `RESUME_PR` is set only for `dispatch resume` and carries both `none recorded` fallbacks. Each assertion gets one go-red control (mutate the read string, assert it fails) per the skill.
- [ ] **Step 2: Run** `node --test tests/dispatch-resume-prose.test.js` → FAIL
- [ ] **Step 3: Write the prose**; `wc -c` SKILL.md and task-prompt.md — each must stay ≤ 52,500 B; report the numbers.
- [ ] **Step 4: Run** `node --test tests/dispatch-resume-prose.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/build-dispatch-subfile-table-completeness.test.js` plus every `tests/*rail*` / `tests/skill-size*` suite → pass.
- [ ] **Step 5: Commit** — `Add dispatch resume #N — restart a stalled build on its open draft PR (refs #4588)`

### Task 5: Flow and claims-contract prose — `RESUME_PR` forwarding and the in-flight exception

**Review risk:** high

**Files:**
- Modify: `plugin/skills/flow/SKILL.md` (Step 2.8 command: append `[--resume-pr "$RESUME_PR"]` and one clause "only when the invocation carries `RESUME_PR=<url>` (`dispatch resume`, #4588)" — budget ≤ 300 B)
- Modify: `plugin/skills/flow/claim-targets.md` (exit-3 in-flight section: the narrowed exception and `RESUME_PR` forwarding)
- Modify: `plugin/skills/_shared/issue-claims.md` ("In-flight detection at claim time" section, and "The lock" step 4's MCP-transport in-flight check — mirror the same exception there: when the run carries `RESUME_PR` and the stale claim's marked PR url equals it, reclaim)
- Test: extend `tests/dispatch-resume-prose.test.js`

- [ ] **Step 1: Failing assertions**: flow/SKILL.md Step 2.8 command contains `--resume-pr "$RESUME_PR"` and `RESUME_PR=`; claim-targets.md and issue-claims.md each state that a `pr-opened:` tombstone and a mismatched link still stop; issue-claims.md's MCP lock step names the same exception. Go-red controls as in Task 4.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Write the prose**; `wc -c` the three files, all ≤ 52,500 B.
- [ ] **Step 4: Run** `node --test tests/dispatch-resume-prose.test.js tests/issue-claims-stale-open-pr-conformance.test.js` and every flow claim-targets prose suite (`grep -ln "claim-targets.md" tests/*.test.js`) → pass.
- [ ] **Step 5: Commit** — `Forward RESUME_PR from /flow to claim-targets — narrow in-flight exception for dispatch resume (refs #4588)`

## Self-review notes

- Spec coverage: D1 (PR / claim / labels / prior run dir, dead owner = owner-process probe alone) → Tasks 2-3, procedure in Task 4; D2 → Task 4 (`resume.md` steps 3-7, sibling check repeated at 6a); D3 → Tasks 1, 5; D4 → Tasks 2-4 (`resumeContext` + `{resume-context}`, with `none recorded` fallbacks); D5 → Task 2 refusals + Task 4 remedy.
- Acceptance criteria: AC3 (`--resume-pr` unit) → Task 1; AC5 (`bot:blocked`/no `auto:build` refusal naming `/claude-tweaks:backlog refine #N`) → Task 2 unit, Task 3 CLI test, Task 4 conformance; AC6 (no `RESUME_PR` keeps the stop) → Task 1's no-flag test plus the existing #4423 suites; AC7 (`dispatch #N` unchanged, remedy named) → Task 4; AC8 (only the open-pr line names the remedy; `#N` bullet unedited) → Task 4's conformance assertion and its no-hunk review check; AC9 (eligibility unit pins) → Task 2, the dead/live-owner half derived in Task 3. AC1, AC2 and AC4 are end-to-end (a live `dispatch resume` of a real stalled record) — not runnable inside this build. Their in-build evidence: AC1 → Task 2's `failed:` pin + Task 3's live #4589 probe; AC2 → Task 1's stale re-claim + Task 2's stale + `bot:in-progress` pin; AC4 → Task 2's `abandoned:` + `dead-owner` pins, Task 3's dead-owner derivation test and Task 4's archive-before-mint conformance assertion. The gap is stated, not hidden.
- Plan judgments beyond the spec text, stated for review: (a) the owner-process probe's verdict is read the way `stampedOwnerProvablyAlive` (hooks/context.js) reads it — `alive-no-start-time` counts as live, and `other-host` counts as not live (the probe cannot see another machine's process; a live run there still holds a live claim, which `live-claim` refuses first); a probe `error` or an unreadable `run-state.json` refuses (`unknown-owner`) rather than reading dead; (b) a present prior dir with no `run-state.json` is a dead owner and eligible as the spec says, but is not archived — `archive-run` refuses a directory with no readable `run-state.json` by design (`hooks.js` `runArchiveRun`) and reconcile's orphaned-mint sweep owns it; (c) more than one same-repo open PR on the head branch is treated as `foreign-pr` (ambiguous) rather than guessed; (d) a non-draft open PR is refused as `not-draft` toward close-out — the spec's resumable PR is "an open draft PR", and a ready-for-review PR is close-out's; (e) a terminal status no longer makes a prior run eligible on its own (the former `closed` class): with the owner probe alone deciding, status only decides whether `close-run` runs before `archive-run`.
- Behavioral claim "`/flow` forwards the flag only with `RESUME_PR`" is produced by the Step 2.8 command text in `flow/SKILL.md` (Task 5); "a stale claim re-claims" is produced by the Task 1 branch.
- Scope sweep (plan-audit Check B, scope-creep `add-to-plan`): `learn-why-a-named-record-wont-dispatch-3084.md` added to Task 4; ruled out — `CHANGELOG.md` (release-please owns it), `docs/journeys/act-on-a-contested-claim.md` (Common Step 6's journey pass owns journey updates), the #4423 plan (historical), `claim-store.js` (read-only consumer here, `staleClaimInFlightPr` unchanged), `tidy/scan-procedures.md` (tidy's stale-claim scan never resumes, behaviour unchanged); `claim-log.test.js` and `issue-claims-stale-open-pr-conformance.test.js` were already in Tasks 1/5.
- Mirror surface: the MCP-transport claim path (`issue-claims.md` "The lock" step 4) is covered in Task 5.
- Amended 2026-10-30 after the plan-review HARD-GATE: the answered eligibility rules (abandoned: tombstones, labels, dead-owner/residue prior run dirs, archive-first), PR lookup by head branch (the `'stale'` case has no `open-pr` exclusion entry), and the missing `**Review risk:** high` lines on Tasks 1-3.
- Amended 2026-10-31 after the second plan-review HARD-GATE (answers on issuecomment-6533615614): dead owner is the owner-process probe alone (`probeOwnerPid`, not `runLiveness`; no owner block and the resuming session's own id count as dead; the `closed` class dropped); only the open-pr exclusion line names the resume remedy and the `#N` bullet is untouched; plus the second review's logged rows — `isDraft` requested and checked (`not-draft`), the sibling check repeated after entering and binding the worktree (resume.md step 6a), `**Review risk:** high` on Tasks 4 and 5, `priorRunDir` in the eligible JSON, and `none recorded` fallbacks in `{resume-context}`.
