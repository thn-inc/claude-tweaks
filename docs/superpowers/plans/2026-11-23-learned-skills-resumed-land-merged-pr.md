# Resumed learned-skills land recognises a merged PR (#6110) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A resumed `land` (`plugin/bin/lib/learned-skills/land.js`) looks the run branch's PRs up whether or not the remote branch still exists, and records each still-captured entry whose verified commit is on a `MERGED` PR as `landed` against that PR, instead of opening a duplicate PR or staging an edit that already shipped.

**Architecture:** Hoist `listPrs()` out of the `if (line)` block in step 1 ("The base") so it runs on every land that has work. When the rows hold one or more `MERGED` PRs, fetch each one's `refs/pull/{n}/head` and read its commits through `gh api --paginate --slurp`, then match each commit to a todo entry with the same trailer + `git patch-id --stable` test the branch path already uses (`sameEdit`). Matched entries are marked landed against that PR; any failed read fails closed by staging every remaining todo entry. Entries left over keep today's `orphanReason` staging, naming the merged PR.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real git against a bare origin in tests, a fake `gh`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T073445-record-6110/work/6110-spec.md` (materialized from GitHub issue #6110)

Scope keywords: listPrs, orphanReason, sameEdit, was merged, not reused as a base, resumed run

## Global Constraints

- Lookup: `gh pr list --head learned-skills/{run-id} --state all` through the existing `listPrs` seam (`#5663`'s `listPrsForHead` has not landed: `grep -rn listPrsForHead plugin/bin` is empty at base).
- A failed PR lookup, commit read, or `git fetch origin refs/pull/{n}/head` fails closed: every remaining captured entry is staged with a reason naming the failed read; `land` never builds fresh commits or opens a PR on that path.
- The merged PR's commits are read through `gh`, never from `origin/learned-skills/{run-id}`; the read pages to completion.
- A commit matches an entry only when its trailers carry this run's id (`Learned-Skills-Run:`) and the entry's id (`Learned-Skills-Entry:`), and its diff's `git patch-id --stable` equals the entry's patch file's (reuse `sameEdit`, never a second matcher).
- When several PRs share the head name, the commits of every `MERGED` one count.
- Entries not on a merged PR (including ones captured after it merged) are staged with a reason naming the merged PR — today's text, `the earlier learned-skills PR #{n} was merged, so {branch} is not reused as a base`.
- Scope and edit discipline: Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Review Focus

1. Several `MERGED` PRs on one head name, each carrying a different entry's commit — both entries land, each against its own PR (test `two merged PRs on the head name each land their own entry`).
2. A paged commit read (`--slurp` returns more than one page) — commits on the second page still match (covered by the first test's fake returning two pages).
3. The `gh api` commit read throws — every todo entry staged, reason names the failed read, no push, no `pr create` (test `a failed merged-PR commit read stages every entry and builds nothing`).
4. `git fetch origin refs/pull/{n}/head` fails (ref absent) — same fail-closed outcome, reason names the fetch (test `a failed refs/pull fetch stages every entry and builds nothing`).
5. A commit on the merged PR whose run trailer is another run's, or whose patch-id differs, is not matched — covered by reusing `sameEdit` and the run-id check; the missing-entry test exercises the non-match → staged path.

---

### Task 1: Merged-PR reconciliation in `land`

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/learned-skills/land.js` (step 1 "The base", lines ~310-342; move `patchId`/`sameEdit` above it; step 5 logging factored so every return path writes the AUTO lines; header comment's Resume paragraph lines 11-21)
- Modify: `plugin/bin/learned-skills-pr.js` (header stdout contract, line ~39-40: a landed row may carry its own `pr`)
- Modify: `plugin/skills/wrap-up/learned-skills-pr.md` (line 57's "reuses the open one on a resumed run" sentence; Payload rewrite's **Landed** bullet). File is 12,879 B against the 52,500 B rail — ample headroom.
- Test: `tests/bin-lib/learned-skills/land.test.js`

Consumers of `land`'s output (grep `landed\[\]`, `\.landed`): only `learned-skills-pr.md`'s Payload rewrite reads `pr`; `engine-record.js`, `delivered.js`, `consolidated-pass.js` do not read land's `landed[]` rows' `pr` — no change. Behavior-change prose sweep: `grep -rn "was merged, so\|reuses the open one" plugin/ docs/` hits only `land.js` and `learned-skills-pr.md:57` — both listed above.

**Interfaces:**
- Produces: `land(...)` output — unchanged keys; a `landed[]` row recorded from a merged PR additionally carries `pr: { number, url }` (the merged PR). Top-level `pr` keeps its meaning (the PR this call confirmed open, else `null`). Manifest entries landed this way get `status: 'landed'`, `commit`, `pr: { number, url }`, and one AUTO line per finding (text: `applied additive update to {skill} ({summary}) on learned-skills PR #{n}`, the existing shape), written once (the existing `sansTime` de-dupe).
- Commit read argv (pinned by the fake): `['api', '--paginate', '--slurp', 'repos/{owner}/{repo}/pulls/{n}/commits?per_page=100']`; stdout is an array of pages, each an array of `{ sha, commit: { message } }`. `{n}` must be a positive integer from the `gh pr list` row, else the read counts as failed.
- Fetch argv: `git -C {worktree} fetch --end-of-options origin refs/pull/{n}/head` with `{ timeout: GIT_TIMEOUT_MS }`.
- New fail-closed reasons: `could not list the PRs of {branch} ({first stderr line})`; `could not fetch merged PR #{n}'s commits (refs/pull/{n}/head: {first stderr line})`; `could not read merged PR #{n}'s commits ({first stderr line})`.

- [ ] **Step 1: Extend the test fake and write the failing tests**

In `land.test.js`, extend `fakeGh` with a `prCommits = {}` option kept on `state.prCommits`: an `api` argv must equal exactly the Interfaces argv for some `n` (throw otherwise); return `JSON.stringify(state.prCommits[n])` (pages), throw `state.apiThrows` when set, throw when `n` has no entry. Add a helper `mergeAndDeleteBranch(f, gh, { number = 77, drop = [] })` that reads the branch tip from `remoteBranch(f)`, runs `sh(f.origin, ['update-ref', 'refs/pull/{number}/head', tip])` and `sh(f.origin, ['update-ref', '-d', 'refs/heads/' + BRANCH])`, builds pages from `sh(f.origin, ['log', '-z', '--format=%H%x09%B', 'main..' + tip])` as `{ sha, commit: { message } }` rows (excluding shas whose `Learned-Skills-Entry:` id is in `drop`), split into two pages, and sets `gh.state.prs = [{ number, url: 'https://github.com/o/r/pull/' + number, state: 'MERGED' }]`.

Tests (each: first `land` normally, then `loseManifest(f)` so every entry reads `captured`, then `mergeAndDeleteBranch`, then a second `land` with fresh `deps`):
- `a resumed land with no remote branch records every entry landed against the merged PR` — `res.landed.length === 2`, each row's `pr.number === 77` and commit equals the first land's commit for that entry; `res.staged` is `[]`; no push in the second call's git calls; no new `pr create`; `remoteBranch(f) === null` (no branch re-created); manifest statuses `['landed','landed']` with `pr.number === 77`; AUTO lines in `decisions.md` still number 2 (written once).
- `a merged PR missing one entry's commit lands the others and stages only that one` — `drop: ['1']` (entry id of X; read it from `readManifest`): landed targets `[Z]`, staged targets `[X]`, staged reason matches `/the earlier learned-skills PR #77 was merged/`; no push, no create.
- `with no remote branch and no PR, land builds fresh commits and opens a new PR` — first land on a fresh fixture: gh call sequence `['pr list', 'pr create', 'pr list']`, no `api` call, `res.pr.number === 77`, two commits on the new branch.
- `two merged PRs on the head name each land their own entry` — prs `[77 MERGED, 78 MERGED]`, `refs/pull/77/head` and `refs/pull/78/head` both at the tip, `prCommits[77]` holds only X's commit, `prCommits[78]` only Z's: X lands against 77, Z against 78, nothing staged.
- `a failed merged-PR commit read stages every entry and builds nothing` — `gh.state.apiThrows = 'HTTP 502'`: both staged, reason matches `/^could not read merged PR #77's commits \(HTTP 502/`, no push, no create, manifest `['staged','staged']`.
- `a failed refs/pull fetch stages every entry and builds nothing` — skip the `refs/pull/77/head` update-ref: both staged, reason matches `/^could not fetch merged PR #77's commits \(refs\/pull\/77\/head: /`, no push, no create.
- `a failed PR lookup with no remote branch stages every entry and builds nothing` — a gh wrapper that throws on `pr list`: both staged, reason matches `/^could not list the PRs of learned-skills\//`, no push, no create.

Update the existing `MERGED` row of the `CLOSED`/`MERGED` table test so the merged PR is readable: before the second land, `update-ref refs/pull/77/head` to `tip1` and set `prCommits[77]` from the branch log (X's commit, already landed — Z still stages with the merged reason, as today). Existing tests whose asserted gh call counts change only because `pr list` now runs before the build (e.g. `push failure stages every patch` asserts `gh.calls.length === 0`) are updated to assert the intent — no `create` call — not a new count.

- [ ] **Step 2: Run the new tests, see them fail**

Run: `node --test --test-name-pattern="merged PR|no remote branch and no PR|refs/pull fetch|PR lookup with no remote" tests/bin-lib/learned-skills/land.test.js`
Expected: FAIL — the no-branch resume opens a second PR (`pr create` called) instead of landing against #77, and the fail-closed tests see fresh commits built.

- [ ] **Step 3: Implement in `land.js`**

- Move `patchId`/`sameEdit` above step 1.
- Step 1: keep the integration fetch, `ls-remote`, branch fetch and moved-check in the existing `try` (its `could not read the remote base` reason unchanged). After it, call `listPrs()` once in its own `try` (failure → the `could not list the PRs` reason via `downgradeAll(todo, …)`); `existingPr = openOf(rows)`.
- Reconcile when `rows` has any `MERGED`: for every merged PR first fetch `refs/pull/{n}/head`, then read its commits (flatten pages); any failure → `downgradeAll(todo, …)` with the matching reason before anything is marked. Then for each commit whose `Learned-Skills-Run` is `runId` and whose `Learned-Skills-Entry` names an entry still in `todo` and `sameEdit(sha, entry)`: mark it landed against that PR (same fields and AUTO items as step 5), add the `landed[]` row with `pr`, and remove it from `todo`. If `todo` is then empty, return through the logging finish.
- Orphan rule: with no open PR, a merged PR (first in `rows`) sets `orphanReason` whether or not the branch exists; a closed PR sets it only when the branch exists (today's rule).
- Factor step 5's marking and the `sansTime`-deduped `appendEntries` tail into helpers used by both the merged path and step 5, and make `downgradeAll`/the early `finish` write any pending AUTO items, so a partial merged landing followed by orphan staging still logs its AUTO lines.
- Rewrite the header's Resume paragraph to state the new rule (lookup by head name regardless of the remote branch; merged-PR entries recorded landed by trailers + patch-id, reading commits through `gh` and `refs/pull/{n}/head`; failed reads fail closed; the rest stage naming the merged PR).
- `learned-skills-pr.js` header: note a `landed[]` row may carry its own `pr` (a merged PR this call recorded it against).
- `learned-skills-pr.md`: line 57 says a resumed run also recognises entries a merged learned-skills PR already shipped (landed against that PR, never re-opened or re-staged); Payload rewrite **Landed** bullet: `pr` is the row's own `pr.url` when it carries one, else the top-level `pr.url`.

- [ ] **Step 4: Run the whole land suite**

Run: `node --test tests/bin-lib/learned-skills/land.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Prove each new test discriminates**

Copy the new `land.js` aside, write the base version over it (`git show 449b4ef8f:plugin/bin/lib/learned-skills/land.js`, the commit before this task), run the Step 2 command, and confirm every new test fails; then copy the new `land.js` back and re-run Step 4. Quote the failing output in the report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/learned-skills/land.js plugin/bin/learned-skills-pr.js plugin/skills/wrap-up/learned-skills-pr.md tests/bin-lib/learned-skills/land.test.js
git commit -m "Let a resumed learned-skills land recognise edits a merged PR already shipped — refs #6110"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (lookup regardless of branch, fail closed, paging, every MERGED PR) → Step 3 bullets 2-3, tests 3/4/5/6/7. Deliverable 2 (landed against merged PR by trailers + patch-id, gh read, refs/pull fetch) → Step 3 bullet 3, tests 1/4. Deliverable 3 (leftovers staged naming merged PR) → test 2, orphan rule. Deliverable 4 (header + wrap-up doc) → Step 3 last three bullets. ACs: test 1 = AC1, test 2 = AC2, test 3 = AC3, Step 5 = AC4, `npm test -- --full` runs at Common Step 5 = AC5.
- **Placeholders:** none.
