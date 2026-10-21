# Dispatch Retry Adopts Its Own Prior Attempt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched retry whose first attempt failed after pushing (PR closed, branch left on origin) adopts that branch instead of stopping with `adopted-branch-collision`.

**Architecture:** Deliverable option **(b)**. `build/adopted-branch-collision-check.md` gains a fifth state, `prior-attempt`: a `foreign` remote tip that a new pure-ish helper `findPriorAttemptPr` matches to a CLOSED claude-tweaks PR on that branch, linked to a record of this run, whose head is an ancestor of origin's tip. The check adopts it with a plain `git merge`; the push then fast-forwards, and `_shared/pr-early-run-lifecycle.md` Step 1's existing CLOSED-reopen branch reopens the PR — which now also rebinds the body's run marker to this run, because `bin/pr-checklist.js` refuses (exit 4) every checklist update on a body naming another run. Why (b) over (a): `dispatch/settle-and-merge.md` Step 6 step 5 already leaves the branch in place and closes the PR as a tombstone with a resume command, and pr-early Step 1 already reopens a CLOSED PR "by construction, a retry" — the adopt path's collision check is the only piece contradicting that design; (b) also unsticks branches already stranded on origin, and deletes nothing. The "plan committed for the retry" wording is therefore **honored**, not removed.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git, gh CLI; markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T215830-record-3887/work/3887-spec.md`

## Global Constraints

- Never force-push, never delete a remote branch, never `git reset` (`_shared/git-discipline.md`).
- `prior-attempt` must never stop the build; `foreign` and `unreachable`-with-`remoteSha` keep their stop card and HARD-GATE posture unchanged (`_shared/auto-mode-contract.md`'s HARD-GATE row text "`foreign`, or `unreachable` with a `remoteSha`" stays true — do not edit it).
- `classifyRemoteBranch`'s return shapes are unchanged (the snippet-fixture stub overrides it by name).
- Byte rail: `RAIL_BYTES` = 52,500. `dispatch/settle-and-merge.md` is 47,433 B (90.3% — already `nearCeiling`); Task 3's addition there stays ≤ 400 B (headroom after ≈ 4,700 B). `_shared/pr-early-run-lifecycle.md` 30,122 B; `build/adopted-branch-collision-check.md` 6,327 B — both far under.
- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #3887` (never closes/fixes). End with `Claude-Session: https://claude.ai/code/session_01R6roff1nWwrZMVoQ9UTxH4`.

## Review Focus

1. Origin's tip **ahead of** the closed PR's head (the failed attempt pushed its plan after closing — observed on #3885: closed head `25c8df8` is 2 behind branch tip `04948b8`) → must still be `prior-attempt` (ancestry, not equality). Task 1 test.
2. A **MERGED** PR on the branch for the same record → stays foreign (never re-adopt shipped work). Task 1 test.
3. A closed PR for the same record whose body has **no `claude-tweaks-run` marker** (a human's PR) → foreign. Task 1 test.
4. PR lookup failed (`ok: false`) or `git merge-base` errors (object missing) → not a match, fail closed to foreign. Task 1 test.
5. The snippet's `{records}` placeholder left unsubstituted → no records → never `prior-attempt` (fail closed). Task 2 test.

## Verified facts (probes run at authoring time)

- `gh pr list --repo thn-inc/claude-tweaks --head worktree-dispatch-record-3630 --state all --json number,url,state,isDraft,headRefOid,closingIssuesReferences,body` (the exact argv Task 1 adds) → `[{number: 3689, state: "CLOSED", headRefOid: "6a9d5ff3…", closing: [3630], firstLine: "<!-- claude-tweaks-run: 2026-10-20T022848-record-3630 -->"}]` — `closingIssuesReferences` is populated on a closed PR.
- `bin/pr-checklist.js:163-167` — `firstLineRunId(final) !== runId` → stderr "run marker mismatch" and `return 4`, nothing written. `firstLineRunId` is exported by `plugin/bin/lib/flow/pr-checklist.js` (pure, requires only `path` and `./pr-body`).
- Unverified-live (no safe read-only form): GitHub's `gh pr reopen` on a PR whose head branch exists at a commit ahead of its frozen head, and `gh pr edit --body-file` on a reopened PR. `gh pr edit N --body-file` is already used by `bin/pr-checklist.js`.

---

### Task 1: `findPriorAttemptPr` in the collision module

**Files:**
- Modify: `plugin/bin/lib/worktree/remote-branch-collision.js`
- Test: `tests/bin-lib/worktree/remote-branch-collision.test.js`

**Interfaces:**
- Produces: `findPrsForBranch({ branch, repo, gh })` — unchanged return `{ ok, prs, error? }`; its `--json` field list becomes `number,url,state,isDraft,headRefOid,closingIssuesReferences,body` (additive).
- Produces: `findPriorAttemptPr({ remoteSha, prLookup, records, git = defaultGit }) -> { number, url } | null`, exported. Returns the first PR in `prLookup.prs` meeting **all** of: `prLookup.ok`; `pr.state === 'CLOSED'`; `firstLineRunId(pr.body)` (required from `../flow/pr-checklist`) non-null; its linked records — `pr.closingIssuesReferences[].number` ∪ every `^Fixes #(\d+)\s*$` line of `pr.body` (multiline) — intersect `records` (array; non-integer entries ignored); `pr.headRefOid` matches `SHA_RE`; and `git(['merge-base', '--is-ancestor', pr.headRefOid, remoteSha])` returns without throwing. Any throw from that git call → that PR does not match. `remoteSha` failing `SHA_RE`, or `records` empty after filtering → `null` without calling git. Header comment: one paragraph naming #3887 and why ancestry (Review Focus 1).

- [ ] **Step 1: Write the failing tests** (append; reuse the file's `SHA_A`/`exitWith`; add `SHA_B = 'b'.repeat(40)`; a helper `closedPr(over)` returning `{ number: 9, url: 'https://example.test/pr/9', state: 'CLOSED', headRefOid: SHA_B, closingIssuesReferences: [{ number: 42 }], body: '<!-- claude-tweaks-run: 2026-10-21T000000-record-42 -->\nclaude-tweaks-run: 2026-10-21T000000-record-42\n\nFixes #42\n', ...over }`; fake `git` that asserts args `['merge-base','--is-ancestor',SHA_B,SHA_A]` and returns `''`):
  - `AC4.1: findPriorAttemptPr matches this record's closed claude-tweaks PR whose head is an ancestor of origin's tip` → `deepEqual(result, { number: 9, url: 'https://example.test/pr/9' })` with `records: [42]`.
  - `AC2.1: a closed PR for a different record stays foreign` → `records: [43]` → `null`, and git never called.
  - `AC2.1: a closed PR with no claude-tweaks-run marker (a human's PR) stays foreign` → body `'Fixes #42\n'` → `null`.
  - `AC2.1: an open or merged PR never matches` → `state: 'OPEN'` and `state: 'MERGED'` → both `null`.
  - `AC2.1: a PR head that is not an ancestor of origin's tip, or an ancestry error, never matches` → git throws `exitWith(1)` → `null`; throws `exitWith(128)` → `null`.
  - `findPriorAttemptPr: a failed or absent lookup, or no records, is null` → `prLookup: { ok: false, prs: [] }`, `prLookup: null`, `records: []`, `records: ['{records}']` → all `null`.
  - `findPriorAttemptPr: links by a Fixes line when closingIssuesReferences is absent` → `closingIssuesReferences: undefined`, body keeps `Fixes #42` → matches.
  - `findPrsForBranch: requests the fields findPriorAttemptPr reads` → fake `gh` captures args; assert the `--json` value is `'number,url,state,isDraft,headRefOid,closingIssuesReferences,body'`.
  - Real git, `AC1.1: a retry's fresh branch is foreign by ancestry but prior-attempt by PR, and adopting it lets the push fast-forward`: with `originWithTwoClones`: in `r.other` checkout `-b worktree-dispatch-record-42`, commit `plan`, push; record `closedHead = rev-parse HEAD`; commit `post-close-plan`, push (Review Focus 1: tip ahead of PR head); in `r.work` fetch nothing, checkout `-b worktree-dispatch-record-42` from main; `classifyRemoteBranch` → `state: 'foreign'`; `findPriorAttemptPr({ remoteSha, prLookup: { ok: true, prs: [closedPr({ headRefOid: closedHead })] }, records: [42], git: r.gitIn(r.work) })` → `{ number: 9, … }`; then `r.run(r.work, ['merge', '--no-edit', remoteSha])`, `classifyRemoteBranch` → `state: 'mine'`, and `r.run(r.work, ['push', '-q', 'origin', 'worktree-dispatch-record-42'])` does not throw.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision.test.js`
Expected: FAIL after Step 1 — `findPriorAttemptPr is not a function` (and the field-list assertion).

- [ ] **Step 3: Implement** `findPriorAttemptPr` and the widened `--json` list in `plugin/bin/lib/worktree/remote-branch-collision.js`; export it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision.test.js`
Expected: PASS, all tests (old + new).

- [ ] **Step 5: Go-red proof (AC4.1 "goes red when that distinction is removed").** Temporarily replace the record-intersection check with `true` → the "different record" test must fail; restore. Temporarily make the function `return null` → the AC4.1 positive test and the AC1.1 real-git test must fail; restore. Quote both failing outputs in the report. Do not commit the mutations.

- [ ] **Step 6: Real-input probe.** Run once: `gh pr list --repo thn-inc/claude-tweaks --head worktree-dispatch-record-3630 --state all --json number,url,state,isDraft,headRefOid,closingIssuesReferences,body > {scratch}/pr3630.json`, then a `node -e` that loads it as `prs` and calls `findPriorAttemptPr({ remoteSha: 'c'.repeat(40), prLookup: { ok: true, prs }, records: [3630], git: () => '' })` and again with `records: [3631]`. Expected: `{ number: 3689, url: 'https://github.com/thn-inc/claude-tweaks/pull/3689' }` then `null`. Independent count: `jq '[.[] | select(.state=="CLOSED")] | length'` on the same file → `1`. Record both outputs in the report.

- [ ] **Step 7: Commit** — `git add plugin/bin/lib/worktree/remote-branch-collision.js tests/bin-lib/worktree/remote-branch-collision.test.js`; message `Add findPriorAttemptPr to the adopted-branch collision module — own prior attempt vs foreign, refs #3887`.

### Task 2: `prior-attempt` state in the collision-check prose and snippet

**Files:**
- Modify: `plugin/skills/build/adopted-branch-collision-check.md`
- Modify: `plugin/skills/build/worktree-setup.md:9` (the skip-path summary sentence only)
- Test: `tests/adopted-branch-collision-snippet-fixture.test.js`, `tests/adopted-branch-collision-prose-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `findPriorAttemptPr`, `findPrsForBranch`.
- Produces: snippet JSON gains `state: 'prior-attempt'` with `pr: { number, url }` and no `card`.

- [ ] **Step 1: Write the failing tests.**
  - Snippet fixture: extend `stubPluginRoot(t, result)` with an optional `prs` argument so the stub can override **only** `findPrsForBranch` (`classifyRemoteBranch` stays real when `result` is null). New test `AC1.1: the snippet adopts this record's own prior attempt instead of carding it`: fixture as Task 1's real-git test (other clone pushes `worktree-record-1`, work checks out a fresh same-name branch); stub `findPrsForBranch` → `{ ok: true, prs: [closed claude-tweaks PR, closingIssuesReferences [{number:1}], headRefOid = other's first pushed commit] }`; run the extracted snippet with `'"{records}"'` replaced by `'"1"'` and a non-empty repo arg (replace `"$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"` with `"o/r"`) → `state === 'prior-attempt'`, `pr.number` matches, `card === undefined`. Same run with records `"2"` → `state === 'foreign'` with a `card` (AC2.1). And the verbatim snippet (placeholder unsubstituted) → `foreign` with `card` (Review Focus 5). Assert the extracted snippet contains `"{records}"` exactly once.
  - Prose conformance, new test `AC1.1: prior-attempt adopts by merge and never stops`: `norm(CHECK)` matches `/`prior-attempt`/`, `/git merge --no-edit \{remoteSha\}/`, `/never stop on it/i`, `/findPriorAttemptPr/`, `/dispatch\/settle-and-merge\.md/`; and `norm(WORKTREE_SETUP)`'s skip-creation region matches `/prior attempt/i`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/adopted-branch-collision-snippet-fixture.test.js tests/adopted-branch-collision-prose-conformance.test.js`
Expected: FAIL after Step 1 — snippet lacks `{records}`; prose lacks `prior-attempt`.

- [ ] **Step 3: Edit the prose.** In `adopted-branch-collision-check.md`:
  - Snippet: add a third argv `"{records}"` after the repo arg (the start anchor `node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$(git branch --show-current)"` must stay byte-identical); destructure `[branch, repo, recordList]`; inside the existing `foreign || (unreachable && remoteSha)` branch compute `prLookup` once, `records = String(recordList || '').split(',').map(Number).filter(Number.isInteger)`, `prior = r.state === 'foreign' ? m.findPriorAttemptPr({ remoteSha: r.remoteSha, prLookup, records }) : null`; if `prior` set `out.state = 'prior-attempt'` and `out.pr = prior`, else emit `out.card` exactly as today. Body stays free of `$` and backticks.
  - After the snippet, one sentence: `{records}` is this run's record numbers, comma-joined (`3887`, or `3887,3890` for a bundle) — the targets the run was invoked with.
  - Append item **5** (do not renumber 1-4): `prior-attempt` — origin's tip is not in HEAD's history, but `findPriorAttemptPr` matched it to this record's own failed earlier attempt (CLOSED, not merged, PR on this branch whose body opens with the `claude-tweaks-run:` marker, linking a record of this run by `closingIssuesReferences` or a `Fixes #{n}` line, whose head is an ancestor of origin's tip — the shape `dispatch/settle-and-merge.md` Step 6 step 5 leaves: branch kept, PR closed as a tombstone). Adopt it, never stop on it: `git merge --no-edit {remoteSha}` as its own Bash call (conflict → `_shared/git-discipline.md`'s Merge conflict resolution), log `AUTO {time} — Adopted-branch collision check: adopted prior attempt {short sha} from closed PR #{number} for {branch}. Reversibility: high (merge commit on an unpushed branch).`; the push then fast-forwards and `_shared/pr-early-run-lifecycle.md` Step 1 reopens and rebinds that PR. Anything else — another record's PR, a human's, an open or merged PR, a failed lookup — stays `foreign` (item 4).
  - "Out of scope" sentence: keep "does not delete anything"; replace "this check reports the collision" with "it reports an unrelated collision and adopts this record's own prior attempt".
  - `worktree-setup.md:9`: extend the classification list with "this record's own failed prior attempt (adopt — proceed)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/adopted-branch-collision-snippet-fixture.test.js tests/adopted-branch-collision-prose-conformance.test.js tests/node-eval-file-heredoc-syntax.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — the four files; message `Adopt a record's own prior attempt in the adopted-branch collision check — prior-attempt state, refs #3887`.

### Task 3: Reopen rebinds the body; Settle states the retry adopts the branch

**Files:**
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md` (Step 1 "Reopen succeeds" paragraph; the "Why a stale-branch collision can't reach this step" paragraph's last sentence)
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (Step 6 step 5, the sentence "Leave the branch and worktree in place; nothing else in this step tears them down.")
- Test: Create `tests/dispatch-retry-prior-attempt-conformance.test.js`

**Interfaces:**
- Consumes: Task 2's `prior-attempt` state name and file path.

- [ ] **Step 1: Write the failing test** (`readText` from `./helpers/read-skill`, `norm` whitespace collapse). One assertion function per file, each called by its positive test and by a go-red control that deletes the new sentence from the live text and expects the same function to throw (plan-authoring Go-red control check):
  - `assertRebind(text)`: matches `/Rebind a retry's body/`, `/gh pr edit \{number\}/`, `/--body-file/`, `/bin\/pr-checklist\.js/`, `/exit 4/`, `/prior-attempt/`, and `/PR-early run lifecycle: rebound reopened PR #\{number\} to run \{run-id\}/`. Test `AC1.1: a reopened retry PR is rebound to this run before any checklist update`.
  - `assertSettle(text)` on settle-and-merge.md: matches `/A retry adopts that branch/`, `/build\/adopted-branch-collision-check\.md/`, `/prior-attempt/`, `/plan commit/`. Test `AC3.1: the failure comment's plan-for-retry claim matches what the retry does`.
  - `pr-early-run-lifecycle.md`'s collision paragraph still matches `/That holds on the creation path only/` and now `/own failed earlier attempt/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-retry-prior-attempt-conformance.test.js`
Expected: FAIL — rebind and settle sentences absent.

- [ ] **Step 3: Edit the prose.**
  - pr-early Step 1, right after the Reopen-succeeds log line: **Rebind a retry's body (#3887).** When the reopened body's first line names a different run than this one — a retry that adopted a prior attempt's branch (`build/adopted-branch-collision-check.md`'s `prior-attempt` state) — compose this run's body per Step 3 and write it with `gh pr edit {number} --repo {host}/{owner}/{repo} --body-file "$PR_EARLY_BODY"` before Step 2's push: `bin/pr-checklist.js` refuses every phase-checklist update on a body naming another run (exit 4), which would freeze this run's checklist. Log `AUTO {time} — PR-early run lifecycle: rebound reopened PR #{number} to run {run-id}. Reversibility: high.`
  - pr-early collision paragraph's final sentence: append that the check adopts the record's own failed earlier attempt, so a retry also reaches the CLOSED-match reopen above.
  - settle-and-merge Step 6 step 5: after "Leave the branch and worktree in place; nothing else in this step tears them down." add: "A retry adopts that branch (`build/adopted-branch-collision-check.md`'s `prior-attempt` state), so the failure reason may say a plan commit is kept for the retry — name its sha." Measure: `wc -c plugin/skills/dispatch/settle-and-merge.md` ≤ 47,833.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-retry-prior-attempt-conformance.test.js tests/adopted-branch-collision-prose-conformance.test.js tests/pr-early-run-lifecycle-step1-logging-conformance.test.js tests/hooks-bookkeeping-stamps-gate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — three files; message `Rebind a reopened retry PR and state that a retry adopts its branch — reopen + Settle prose, refs #3887`.

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 | Task 1 real-git test; Task 2 snippet test; Task 3 rebind test |
| AC2.1 | Task 1 different-record / no-marker / open-merged / non-ancestor tests; Task 2 records "2" case |
| AC3.1 | Task 3 settle test |
| AC4.1 | Task 1 AC4.1 test + Step 5 go-red proof |

Deliverable 2 ("honor or remove"): honored — Task 2 makes the retry adopt the kept branch; Task 3 says so in Settle. `dispatch/two-call-gate.md` needs no change: §5's teardown removes only the local worktree and never the remote branch (`wrap-up/cleanup-procedures-execution.md` deletes the remote ref only under `--merged`).
