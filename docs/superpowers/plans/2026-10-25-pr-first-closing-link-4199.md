# pr-first closing-link guard (#4199) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pr-first merge never closes a record the run deliberately left open (a deferred or not-run `Refs #N` record, or any stray issue a closing-keyword phrase names), and `decisions.md` records whether the link was removed before the merge or the record was reopened after it.

**Architecture:** One pure module (`plugin/bin/lib/flow/closing-links.js`) finds and neutralizes GitHub closing-keyword phrases and reads the PR body's fixes span. One CLI (`plugin/bin/closing-links.js`) on `bin/pr-checklist.js`'s exit vocabulary runs it against the live PR in two modes. `pre-merge` reads `closingIssuesReferences`, rewrites every unwanted keyword phrase to `{keyword} issue {ref}` (which GitHub never links), writes the body, re-reads, and logs `unlinked` or `still linked`. `post-merge` reopens any keep-open record the merge closed and logs `reopened`. `composeFixesBlock` neutralizes keyword phrases in the reasons it writes, and three `_shared` files wire the CLI in.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI through an injected `deps.gh(args, input)` runner.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-25T085140-record-4199/work/4199-spec.md`

## Corrected premise (probe, 2026-10-25, logged as `premise reversed:` in decisions.md)

The record assumes GitHub keeps the closing link it made when the PR was opened with `Fixes #N`. A live probe on throwaway PR #4234 against throwaway issue #4233 disproved that:

| Body | `closingIssuesReferences` |
|---|---|
| `Fixes #4233` | `[4233]` |
| `Refs #4233 — deferred: pending a later manual step` | `[]` |
| `Refs #4233 — deferred: the reconcile pass that closes #4233 is pending elsewhere` | `[4233]` |
| same phrase wrapped as `` `closes #4233` `` | `[]` |
| `This change resolves thn-inc/claude-tweaks#4233 in a later pass.` | `[4233]` |
| `Fixed: https://github.com/thn-inc/claude-tweaks/issues/4233` | `[4233]` |
| plain-Refs body, `Fixes #4233` only in a branch commit's message | `[]` |
| `…the reconcile pass that closes (#4233) is pending…` | `[4233]` |
| `…the reconcile pass that closes issue #4233 is pending…` | `[]` |
| `resolves issue thn-inc/claude-tweaks#4233` + `Fixed: issue https://…/issues/4233` + `Fixes: issue #4233` | `[]` |

GitHub re-derives the link from the current body on every edit. PR #4144 closed #2724 because its body said "closes #2724" twice: in the Spec summary ("…the reconcile pass that closes #2724 still need the main checkout…") and inside the deferred reason itself ("Refs #2724 — deferred: Part B close/archive and the reconcile pass that closes #2724 via resolveResidue…"). Deliverable 2's Refs-at-open alternative is therefore unnecessary. Deliverable 1's check is the fix. The unlink mechanism is inserting `issue ` between the keyword and the reference (rows 8-10). Wrapping the phrase in a code span (row 4) also unlinks it, but it was dropped during Task 1. A stray backtick elsewhere in the block can re-pair with the wrapper, and modelling that correctly needs a CommonMark block parser, which three review rounds kept finding gaps in.

Merging into the published integration branch closes issues through two channels. One is `closingIssuesReferences`, from the PR body. The other is the squash commit's own message, which `compose-subject.js` writes with one `Fixes #n` per number it is given. The pre-merge check covers the first channel. The post-merge reopen covers both.

## Global Constraints

- Closing keywords are `CLOSING_KEYWORD_ALTERNATION` from `plugin/bin/lib/issue-branch-tracking.js` (`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`). Import it; never retype the set.
- Keyword grammar: word boundary before the keyword, case-insensitive, optional `:`, then `[ \t]+` (never `\s+`, so `Fixes\n#5` does not match), then one reference: `#N`, `owner/repo#N`, or `http(s)://host/owner/repo/issues/N`.
- No markdown masking (SDD ruling, Task 1 redesign). The matcher reports every keyword phrase, including one inside code. That is a superset of what GitHub links, which is the safe direction.
- Neutralize = insert the literal word `issue ` between the keyword's colon or whitespace and the reference, so `closes #2724` becomes `closes issue #2724`, `Fixes: #5` becomes `Fixes: issue #5`, and `Fixed: https://…/issues/N` becomes `Fixed: issue https://…/issues/N`. GitHub links none of these (probe rows 8-10). The matcher never matches the result, so neutralization is idempotent by construction. Every other byte of the body stays identical (CRLF included).
- Every real `execFileSync` call passes `windowsHide: true` and `timeout: GH_TIMEOUT_MS` (import from `plugin/bin/lib/shared-primitives.js`) in the call's own options literal (`tests/windows-hide-spawn-conformance.test.js`). The `gh` dep forwards `input` with `stdio: ['pipe','pipe','pipe']`, as `bin/pr-checklist.js` does.
- `require.main === module` sets `process.exitCode`, never `process.exit` (`tests/bin-lib/exit-code-conformance.test.js`).
- Exit vocabulary copies `bin/pr-checklist.js`: 0 done or status-as-data, 2 malformed invocation, 3 run dir missing or not anchored under the main checkout (`lib/log-decision/append.js`'s `resolveTarget`), 4 run-marker mismatch (pre-merge only, nothing written), 5 a required `gh` read or the body edit failed.
- Skill-file byte rail is `RAIL_BYTES` = 52,500. Measured base sizes: `pr-checklist-refresh.md` 13,839 B and `pr-first-merge.md` 38,369 B. `plan-audit.js` reports their composed merge bundle at **52,152 B worst case**, which leaves 348 B of headroom. That is less than Task 3's pre-merge paragraph needs, so Task 3 also moves `pr-first-merge.md`'s "Signatures (Task 0 …)" evidence block (lines 283-290, about 3 KB) into `pr-first-merge-appendix.md`. Remedy: move a genuinely lazy section. No test pins those lines; grep run at authoring: `git grep -n -F -e "probe PR #591" -e "Branch not protected" -e "26d1037664" -- tests plugin docs` hits only `pr-first-merge.md` itself. The appendix already exists for exactly this, "rare-branch content … read only when the head's own citation points here". `pr-early-run-lifecycle.md` is 31,991 B and `pr-first-merge-post-merge.md` is 10,396 B, neither composed into the merge bundle.
- Commit message style `{Verb} {what} — {detail}` with `refs #4199`, never `closes`/`fixes` (that is exactly the bug). End each commit message with `Claude-Session: https://claude.ai/code/session_014kynwBUBcb1BYy54Pdqu6S`.

## Review Focus

1. A keyword phrase for an *expected* record (`Fixes #3997`) must survive byte-for-byte. Neutralizing only `targets` and leaving the expected set alone is the whole correctness of pre-merge (Task 1 test `neutralize leaves expected Fixes lines untouched`).
2. Words that contain a keyword (`prefixes #5`, `suffixed #5`, `Fixes-ish`) must not match (Task 1 test `word boundary`).
3. GitHub closes the issue about 2 s *after* the merge, so post-merge reading `OPEN` right after merge confirmation is the normal case for a still-linked record. Post-merge must poll a will-close candidate and not stop at the first read (Task 2 test `post-merge polls a will-close candidate until it closes`).
4. A record a human closed *before* the merge must never be reopened. The discriminant is `closedAt >= mergedAt` (Task 2 test `post-merge leaves a record closed before the merge alone`).
5. A cross-repo reference (`other/repo#2724`, or a `closingIssuesReferences` entry from another repo with the same number) is never treated as this repo's record (Task 1 test `cross-repo`; Task 2 test `cross-repo closing reference is ignored`).

---

### Task 1: `lib/flow/closing-links.js` and reason neutralization in `composeFixesBlock`

**Files:**
- Create: `plugin/bin/lib/flow/closing-links.js`
- Modify: `plugin/bin/lib/flow/manifest.js` (`composeFixesBlock`, lines 263-277: neutralize the deferred reason)
- Create: `tests/fixtures/closing-links/pr-4144-body.md` (real input, captured with `gh pr view 4144 --repo thn-inc/claude-tweaks --json body --jq .body`. Write the command's stdout to the file byte-for-byte, with no trailing-newline normalization beyond what `--jq` emits.)
- Test: `tests/bin-lib/flow/closing-links.test.js`
- Test: `tests/bin-lib/flow/manifest.test.js` (add a case)

**Interfaces:**
- Produces (exact exports of `plugin/bin/lib/flow/closing-links.js`):
  - `findClosingRefs(text: string, { owner?: string, repo?: string } = {}) -> Array<{ number: number, start: number, end: number, phrase: string }>`: every closing-keyword phrase in document order, including any inside code (no masking, per the Task 1 redesign ruling). `start`/`end` are string offsets of the phrase (keyword through reference). With `owner`/`repo` given, `owner/repo#N` and URL forms count only when owner and repo match case-insensitively. A bare `#N` always counts. With neither given, every form counts.
  - `neutralizeClosingPhrases(text: string, { targets = null, owner, repo } = {}) -> { text: string, neutralized: Array<{ number: number, phrase: string }> }`: inserts `issue ` before the reference of each `findClosingRefs` phrase whose `number` is in `targets` (or of every phrase when `targets` is `null`).
  - `parseFixesSpan(body: string) -> { found: boolean, fixes: number[], refs: number[] }`: reads the lines between the first marker pair that has both ends, `[claude-tweaks-fixes-start]`/`[claude-tweaks-fixes-end]` or `<!-- fixes-start -->`/`<!-- fixes-end -->`. Lines matching `^Fixes #(\d+)\s*$` go to `fixes`, lines matching `^Refs #(\d+)\b` go to `refs` (trim `\r` first). With no pair, the result is `{found:false, fixes:[], refs:[]}`.
  - `prRepoFromUrl(url: string) -> { host: string, owner: string, repo: string } | null`, parsed from `https://{host}/{owner}/{repo}/pull/{n}`.
  - `sameRepoNumbers(refs: Array<{number, repository?: {name, owner?: {login}}}>, { owner, repo }) -> number[]`: the numbers of the `closingIssuesReferences` entries whose repository matches case-insensitively (an entry with no repository counts as not matching), ascending, deduplicated.
- `composeFixesBlock(specs, deferredClosures)` keeps its signature. Only the deferred `{reason}` text passes through `neutralizeClosingPhrases(reason).text` (all targets, any repo).

- [ ] **Step 1: Capture the real fixture.** Run the `gh pr view 4144 … --jq .body` command above with its stdout redirected to `tests/fixtures/closing-links/pr-4144-body.md`. Confirm with `grep -c 'closes #2724' tests/fixtures/closing-links/pr-4144-body.md`. Expected: `2`.

- [ ] **Step 2: Write the failing tests** in `tests/bin-lib/flow/closing-links.test.js` (`node:test` + `node:assert/strict`, CommonJS, sized like `tests/bin-lib/flow/pr-checklist.test.js`):
  - `findClosingRefs matches every probed form`: `'closes #2724'`, `'Fixes: #5'`, `'resolves thn-inc/claude-tweaks#4233'`, `'Fixed: https://github.com/thn-inc/claude-tweaks/issues/4233'` each return one entry whose `number` is the referenced id and whose `phrase` is the exact substring, when called with `{owner:'thn-inc', repo:'claude-tweaks'}`.
  - `findClosingRefs ignores non-links`: `'Refs #5'`, `` 'see `closes #5`' ``, a fenced block ```` "```\ncloses #5\n```" ````, and `'Fixes\n#5'` each return `[]`.
  - `word boundary`: `'prefixes #5'`, `'suffixed #5'`, `'unresolved #5'` return `[]`.
  - `cross-repo`: `'closes other/repo#5'` with `{owner:'thn-inc', repo:'claude-tweaks'}` returns `[]`. The same text with no owner/repo returns one entry.
  - `neutralize the real #4144 body`: on the fixture with `{targets:[2724], owner:'thn-inc', repo:'claude-tweaks'}`, `neutralized` has length 2 and both phrases equal `'closes #2724'`. `findClosingRefs(result.text, …)` returns only `[{number:3997…}]`. The result text equals the fixture with exactly the two substrings replaced by `` '`closes #2724`' ``, which you assert by building the expected string with `split('closes #2724').join('`closes #2724`')`.
  - `neutralize leaves expected Fixes lines untouched`: the `Fixes #3997` line is byte-identical in the output.
  - `neutralize is idempotent`: running `neutralizeClosingPhrases` on its own output changes nothing and reports `neutralized: []`.
  - `CRLF round-trips`: a CRLF body `'Fixes #1\r\nRefs #2 — deferred: closes #2\r\n'` with `targets:[2]` keeps every `\r\n`.
  - `parseFixesSpan reads Fixes and Refs lines`: on the fixture, the result is `{found:true, fixes:[3997], refs:[2724]}`. A body with no markers gives `{found:false, fixes:[], refs:[]}`. A CRLF span parses the same.
  - `sameRepoNumbers filters by repository`: given `[{number:2724, repository:{name:'claude-tweaks', owner:{login:'thn-inc'}}}, {number:7, repository:{name:'x', owner:{login:'y'}}}]`, the result is `[2724]`.
  - `prRepoFromUrl`: `'https://github.com/thn-inc/claude-tweaks/pull/4144'` gives `{host:'github.com', owner:'thn-inc', repo:'claude-tweaks'}`. `'not a url'` gives `null`.

  In `tests/bin-lib/flow/manifest.test.js` add `composeFixesBlock neutralizes a closing keyword in a deferred reason`: `composeFixesBlock([{id:2724,status:'complete'}], new Map([['2724','the pass that closes #2724 is pending']]))` deep-equals ``['Refs #2724 — deferred: the pass that `closes #2724` is pending']``.

- [ ] **Step 3: Run to verify they fail.** Run: `node --test tests/bin-lib/flow/closing-links.test.js tests/bin-lib/flow/manifest.test.js`. Expected: FAIL, with `Cannot find module '../../../plugin/bin/lib/flow/closing-links'` (or the repo's equivalent relative path) and the new manifest case failing on the unwrapped phrase.

- [ ] **Step 4: Implement.** Build one regex from `CLOSING_KEYWORD_ALTERNATION` (flags `gi`; iterate with `matchAll`, never `.test()` on a shared global instance). No masking: insert `issue ` at each targeted phrase's reference offset (Task 1 redesign ruling). Apply replacements right-to-left so earlier offsets stay valid. The module header comment states what each export is for, cites the probe table in this plan by PR number (#4234), and states that the module does no I/O.

- [ ] **Step 5: Run to verify they pass.** Run: `node --test tests/bin-lib/flow/closing-links.test.js tests/bin-lib/flow/manifest.test.js tests/deferred-closure-fixes-2686.test.js tests/bundle-fixes-reconciliation-2015.test.js`. Expected: all pass (the last two are existing `composeFixesBlock` consumers and their reasons carry no keyword).

- [ ] **Step 6: Commit.**
```bash
git add plugin/bin/lib/flow/closing-links.js plugin/bin/lib/flow/manifest.js tests/bin-lib/flow/closing-links.test.js tests/bin-lib/flow/manifest.test.js tests/fixtures/closing-links/pr-4144-body.md
git commit -m "Add closing-link matcher and neutralizer — keyword phrases in a PR body re-link a deferred record (refs #4199)"
```

### Task 2: `bin/closing-links.js`, pre-merge and post-merge modes

**Files:**
- Create: `plugin/bin/closing-links.js`
- Modify: `docs/plugin-structure.md`. Add one command-reference line directly after the `node plugin/bin/pr-checklist.js …` line (line 173) in the same shape: usage, what it does, the caller files, the envelope, the exit codes, the test files. Also add a `closing-links.js — …` clause to the `plugin/bin/lib/flow/` line (line 50) naming its exports and its consumers (`bin/closing-links.js`, and `manifest.js`'s `composeFixesBlock`).
- Test: `tests/bin-lib/flow/closing-links-cli.test.js`

**Interfaces:**
- Consumes: Task 1's exports. Also `firstLineRunId` from `plugin/bin/lib/flow/pr-checklist.js`, `resolveTarget`/`appendEntry`/`formatEntry` from `plugin/bin/lib/log-decision/append.js`, `readRunStateWithParent` from `plugin/bin/lib/hooks/context.js` (called as `bin/pr-checklist.js` does), `ghAvailable` from `plugin/bin/lib/repo-resolve.js`, and `GH_TIMEOUT_MS` from `plugin/bin/lib/shared-primitives.js`.
- Produces: `module.exports = { run, parseArgs }`. Signature: `run(argv: string[], overrides?: object) -> number` (exit code). The deps keys are those of `bin/pr-checklist.js`'s `realDeps` (`cwd`, `mainRoot`, `ghAvailable`, `gh(args, input)`, `readRunState`, `appendDecision`, `now`, `stdout`, `stderr`) plus `sleep(ms)`, whose real value is a synchronous `Atomics.wait` on a `SharedArrayBuffer`.
- Usage: `closing-links.js --run <run-dir> --mode <pre-merge|post-merge> [--settle-ms <n>] [--help]`. `--settle-ms` defaults to 15000 and must be a non-negative integer (`0` disables polling). A trailing bare value flag and an empty value are usage errors (exit 2).
- `gh` argv, exactly. These were run once read-only against PR #4144 on 2026-10-25. `--json state,mergedAt,url` returned `{"mergedAt":"2026-10-24T18:52:32Z","state":"MERGED",…}`, `--json mergeCommit` returned `{"mergeCommit":{"oid":"d36f5f6a…"}}`, the commits read returned the squash message ending `Fixes #3997`, and `gh issue view 2724 --json state,closedAt` returned `{"closedAt":null,"state":"OPEN"}`.
  - pre-merge read: `['pr','view',N,'--json','body,closingIssuesReferences,url']`
  - pre-merge write: `['pr','edit',N,'--body-file','-']` with the body as `input`
  - pre-merge re-read: `['pr','view',N,'--json','closingIssuesReferences']`
  - post-merge read: `['pr','view',N,'--json','state,mergedAt,body,closingIssuesReferences,url,mergeCommit']`
  - merge message: `['api','repos/{owner}/{repo}/commits/'+oid,'--jq','.commit.message']` (gh resolves the path placeholders)
  - issue state: `['issue','view',String(n),'--json','state,closedAt']`
  - reopen: `['issue','reopen',String(n),'--comment',body]`

**Pre-merge procedure** (the CLI owns the order):
1. Parse args and `--help`. Run the `resolveTarget` anchoring check (exit 3). Read run-state for `pr.number`; none gives `{action:'no-pr'}`. When `!ghAvailable()`, the result is `{action:'gh-absent', pr}`.
2. Read the PR (failure or a non-string body is exit 5). Parse `parseFixesSpan(body)`; `found:false` gives `{action:'no-fixes-span', pr}` with no write. `expected` = span `fixes`. `linked` = `sameRepoNumbers(closingIssuesReferences, prRepoFromUrl(url))`. `unwanted` = `linked` minus `expected`.
3. Empty `unwanted` gives `{action:'clean', …}`: no write and no decisions line.
4. Otherwise, `neutralizeClosingPhrases(body, {targets: unwanted, owner, repo})`. Refuse when `firstLineRunId(newBody) !== basename(runDir)` (exit 4, nothing written; same stderr shape as pr-checklist). Write the body when it changed (an edit failure is exit 5), then re-read (a failure is exit 5). `unlinked` = `unwanted` minus re-read linked; `stillLinked` = `unwanted` ∩ re-read linked.
5. Append one decisions.md entry per issue, step `Closing links`. For each unlinked issue: `unlinked #{n} from PR #{N} before merge (neutralized {k} closing-keyword phrase(s))`. For each still-linked issue: `#{n} still linked to PR #{N} after neutralizing — post-merge step reopens it if the merge closes it` (reversibility `high`). A logging failure sets `logFailed: true` and never changes the exit.
6. Print `{action: stillLinked.length ? 'still-linked' : 'unlinked', pr, expected, keepOpen: refs, linked, unwanted, unlinked, stillLinked, neutralized: k}`.

**Post-merge procedure:**
1. Steps 1-2 as in pre-merge, with the post-merge read. A `state` other than `MERGED` gives `{action:'not-merged', pr, state}`.
2. `expected` = span `fixes`. `keepOpen` = span `refs`. `linked` = same-repo closing refs. Read the merge commit message; a failure there degrades to an empty message and adds `messageUnread: true` to the envelope, never exit 5. `messageCloses` = the numbers `findClosingRefs(message, {owner, repo})` returns. `candidates` = the union of (`linked` minus `expected`) and `keepOpen`, minus `expected`, sorted. `willClose` = `candidates` ∩ (`linked` ∪ `messageCloses`).
3. For each candidate, read the issue. While it reads `OPEN`, it is in `willClose`, and fewer than `settleMs` ms have elapsed (step 3000 ms through `deps.sleep`), re-read it. If it ends `CLOSED` with `Date.parse(closedAt) >= Date.parse(mergedAt)`, reopen it with the comment `Reopened by claude-tweaks: PR #{N}'s merge closed this record, but the run left it open (not in the PR's Fixes block).` On success it goes to `reopened`, and a reopen failure goes to `failed:[{issue, error}]`. A record closed before the merge goes to `closedBefore`, and one still `OPEN` goes to `stillOpen`. An issue-read failure goes to `failed`.
4. Log one decisions.md entry per reopened issue: `reopened #{n} after PR #{N}'s merge closed it (closing link or merge-commit keyword)`, step `Closing links`, reversibility `high`. Log one per failure: `could not reopen #{n} after PR #{N}'s merge ({error}) — reopen it by hand`.
5. Print `{action: reopened.length ? 'reopened' : (failed.length ? 'reopen-failed' : 'nothing-closed'), pr, candidates, willClose, reopened, failed, stillOpen, closedBefore}`. Exit 0.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/flow/closing-links-cli.test.js`. Copy `tests/bin-lib/flow/pr-checklist-cli.test.js`'s fixture shape: a main-checkout run dir with `run-state.json` `pr`, and deps overrides. The fake `gh(args, input)` branches on the argv shape and throws `new Error('unexpected ' + args.join(' '))` on anything else. It records each call and its input, and assertions run after `run` returns. Build the PR bodies from a run-marker line for the fixture run id plus the Task 1 fixture's fixes span. Tests:
  - `AC2.1 pre-merge unlinks a stale closing reference`: the first view returns a body with `Fixes #3997` and `Refs #2724 — deferred: the pass that closes #2724 is pending`, with `closingIssuesReferences` [2724, 3997] (same repo, `url` on github.com/thn-inc/claude-tweaks). The re-read returns [3997]. The test asserts exit 0, `action:'unlinked'`, `unlinked:[2724]`, the edit input containing `` '`closes #2724`' `` with `'Fixes #3997'` unchanged, and decisions.md containing `unlinked #2724 from PR #`.
  - `AC2.1 pre-merge reports a link that survives neutralizing`: the re-read still returns [2724, 3997]. The test asserts `action:'still-linked'`, `stillLinked:[2724]`, and decisions.md containing `#2724 still linked to PR #` and `post-merge step reopens it`.
  - `AC3.1 a stale reference with no keyword phrase is still reported`: the body carries no phrase (as with a Development-sidebar link), the fake re-read returns [2724, 3997], and the test asserts `still-linked`. This is the pre-change failure mode. Under the old procedure nothing read `closingIssuesReferences`, so this test fails against the base tree because the CLI does not exist there.
  - `pre-merge clean`: `closingIssuesReferences` equals the Fixes set, so there is no `pr edit` call and no decisions.md line, and `action:'clean'`.
  - `cross-repo closing reference is ignored`: an entry `{number:2724, repository:{name:'other', owner:{login:'someone'}}}` gives `clean`.
  - `pre-merge refuses another run's PR`: the body's first line names another run, so the result is exit 4 with no edit call.
  - `pre-merge gh view failure`: the fake throws on view, so the result is exit 5.
  - `no-pr` and `gh-absent` envelopes give exit 0.
  - `unanchored run dir`: a worktree-local shadow `--run` gives exit 3 (the same fixture approach as pr-checklist-cli's anchoring case).
  - `usage errors`: a missing `--mode`, `--mode bogus`, a trailing bare `--settle-ms`, and `--settle-ms -1` each give exit 2.
  - `AC2.1 post-merge reopens a deferred record the merge closed`: the view returns `state:'MERGED'`, `mergedAt:'2026-10-24T18:52:32Z'`, the same body, [2724, 3997], and `mergeCommit.oid`. The message fake returns `'fix: x (#3997)\n\nFixes #3997'`, and issue 2724 returns `{state:'CLOSED', closedAt:'2026-10-24T18:52:34Z'}`. The test asserts a reopen call for 2724, `action:'reopened'`, and decisions.md containing `reopened #2724 after PR #`.
  - `post-merge polls a will-close candidate until it closes`: issue 2724 reads `OPEN` on the first read and `CLOSED` (closedAt after mergedAt) on the second. The fake `sleep` records its ms and `--settle-ms 15000` is passed. The test asserts the reopen happened and that `sleep` was called with 3000.
  - `post-merge leaves a record closed before the merge alone`: closedAt is `'2026-10-24T10:00:00Z'`, so there is no reopen call and `closedBefore:[2724]`.
  - `post-merge reopens a single-record deferral closed by the merge-commit keyword`: the body's span holds only `Refs #10 — deferred: x`, `closingIssuesReferences` is [], the message is `'…\n\nFixes #10'`, and 10 is `CLOSED` after `mergedAt`, so 10 is reopened.
  - `post-merge not-merged`: `state:'OPEN'` gives `action:'not-merged'` and no issue reads.
  - `post-merge reopen failure is data`: the reopen throws, so the result is exit 0, `action:'reopen-failed'`, and decisions.md containing `could not reopen #2724`.

- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js`. Expected: FAIL with `Cannot find module` for `plugin/bin/closing-links.js`.

- [ ] **Step 3: Implement `plugin/bin/closing-links.js`.** Shebang, `'use strict'`, and a header comment stating usage, both procedures in one line each, the envelope keys, and the exit codes, in `bin/pr-checklist.js`'s header style. `realDeps` follows pr-checklist's, with the two Global-Constraint options in the `gh` call's own literal. Use `require.main === module` → `process.exitCode = run(process.argv.slice(2))`.

- [ ] **Step 4: Run to verify they pass.** Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js`. Expected: all pass.

- [ ] **Step 5: Update `docs/plugin-structure.md`** (the two lines named in Files) and run `node --test tests/skill-graph-table-structure.test.js tests/skill-catalog-completeness.test.js`. Expected: pass.

- [ ] **Step 6: Commit.**
```bash
git add plugin/bin/closing-links.js tests/bin-lib/flow/closing-links-cli.test.js docs/plugin-structure.md
git commit -m "Add closing-links CLI — unlink stray closing references before a pr-first merge, reopen what the merge closed anyway (refs #4199)"
```

### Task 3: Wire the CLI into the pr-first procedures

**Files:**
- Modify: `plugin/skills/_shared/pr-checklist-refresh.md`. Add a paragraph inside the `<!-- when: integration-model=pr-first -->` fence, immediately after step 2's closing log sentence ("…there was nothing to rewrite.") and before `<!-- /when -->`. It must not renumber steps 3-4.
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md`. Add a new `### Step 4.0: Reopen what the merge closed by mistake` section before `### Step 4.1`.
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md`. Add one paragraph at the end of the "Deferred-closure decisions (#2686)" paragraph block, after the sentence ending "…stays unconditional."
- Modify: `plugin/skills/_shared/pr-first-merge.md`. Move lines 283-290 (the `**Signatures (Task 0, captured on this repo — literal, 2026-08-16, probe PR #591 against a throwaway base):**` heading line through the `- Also captured: …already merged…` bullet) verbatim into `pr-first-merge-appendix.md` as a new `## Signatures (Task 0 captures)` section, placed after `## Comment ordering`. In their place, leave one line: `**Signatures (Task 0 captures (a)-(e)):** the literal captured outputs behind the classification above live in `pr-first-merge-appendix.md`'s Signatures section — read them when a merge outcome needs its evidence.` Re-point the one deictic reference, line 412's `(see Signatures below)`, to `` (see `pr-first-merge-appendix.md`'s Signatures) ``. The `capture (a)`/`capture (b)` mentions at lines 278 and 296 stay as they are, since the pointer line names those letters.
- Modify: `plugin/skills/_shared/pr-first-merge-appendix.md` (receives the moved block)
- Test: `tests/closing-links-prose-conformance.test.js`

Text to add (exact):

`pr-checklist-refresh.md`, after step 2:

```markdown
   **Then check the forge's closing links (#4199).** GitHub links every closing-keyword phrase in the
   body, not only the `Fixes` lines, and re-derives the links on every edit (probe PR #4234), so a
   reason or summary reading "closes #{n}" re-links a `Refs` record. Run `node
   "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --run "{run-dir}" --mode pre-merge`: it reads
   `closingIssuesReferences`, rewrites every phrase naming a record outside the `Fixes` lines to
   `closes issue #{n}` (GitHub links no such phrase), writes the body, re-reads, and logs `unlinked #{n}` or `#{n} still linked` to `decisions.md`.
   A `still-linked` result is left for `pr-first-merge-post-merge.md`'s Step 4.0. Exit 4 or 5:
   warn and proceed (Step 4.0 is the backstop). `gh-absent`: one `SKIP` line, per "Merge-time
   gh-absent degrade" below.
```

`pr-first-merge-post-merge.md`, new section:

~~~markdown
### Step 4.0: Reopen what the merge closed by mistake (#4199)

Before Step 4.1, while `$PIPELINE_RUN_DIR` still exists (Step 4.2's reconcile may archive it):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --run "$PIPELINE_RUN_DIR" --mode post-merge
```

It reopens every record the PR's fixes block names on a `Refs` line, and every stray linked
record, that the merge closed after `mergedAt`. That covers a closing link that survived the
pre-merge check, and a squash message whose `Fixes #{n}` names a deferred single record. It polls a
will-close record up to 15 s, since GitHub closes it about 2 s after the merge, and logs `reopened
#{n}` per record to `decisions.md`. `reopen-failed` names each record to reopen by hand. Report it
in the closing summary, never as anything but `merged`. Exit 3-5 or `gh-absent`: one `SKIP` line,
then continue to Step 4.1.
~~~

`pr-early-run-lifecycle.md`, after "…stays unconditional.":

```markdown
`{reason}` may name the record freely: `composeFixesBlock` rewrites any closing-keyword phrase in it
("closes #{n}" to "closes issue #{n}"), since GitHub links such a phrase anywhere in the body and
re-derives every link on each edit (probe PR #4234, #4199; PR #4144 closed #2724 through one in its reason).
For the same reason the `Fixes` lines composed at run start never need to be withheld up front. The
pre-merge check in `_shared/pr-checklist-refresh.md` (`bin/closing-links.js`) catches a phrase
anywhere else in the body.
```

- [ ] **Step 1: Write the failing test** `tests/closing-links-prose-conformance.test.js` (read live skill prose, per the repo's prose-test convention). Factor one `assertWiring(text, file)` function per file and call it from both the positive test and a go-red control that runs it on the text with the added block removed and expects a throw:
  - `AC2.1 pre-merge refresh runs closing-links after the Fixes rewrite`: in `pr-checklist-refresh.md`, the index of `bin/closing-links.js" --run "{run-dir}" --mode pre-merge` is greater than the index of `rewrote Fixes block for PR #` and less than the index of `3. Read the record's current title`, and the match lies inside the `<!-- when: integration-model=pr-first -->` fence.
  - `AC2.1 post-merge Step 4.0 runs before release-status and reconcile`: in `pr-first-merge-post-merge.md`, `### Step 4.0` and `--mode post-merge` both appear before `### Step 4.1`.
  - `deferred-closure section states the keyword neutralization`: `pr-early-run-lifecycle.md` contains `composeFixesBlock` rewrites any closing-keyword phrase and `probe PR #4234`.
  - `go-red controls`: each `assertWiring` throws on its file's text with the added block sliced out.

- [ ] **Step 2: Run to verify it fails.** Run: `node --test tests/closing-links-prose-conformance.test.js`. Expected: FAIL on the missing `closing-links.js` literal in all three files.

- [ ] **Step 3: Make the edits.** First do the Signatures move (it frees the bytes). Then add the three new texts exactly as given above. Check the move: `git diff --stat` shows `pr-first-merge.md` shrinking by about as many bytes as the appendix grows, and every moved line appears byte-identical in the appendix. Confirm with `grep -c -F 'probe PR #591' plugin/skills/_shared/pr-first-merge-appendix.md`, which should print `1`. Before editing, run `git grep -n -F 'rewrote Fixes block for PR' -- tests plugin` and `git grep -n -F 'Step 4.1: Which release carried' -- tests plugin`. Any test that pins an adjacent sentence must stay green. List the hits in your report.

- [ ] **Step 4: Run to verify it passes, plus the byte and bundle rails.** Run: `node --test tests/closing-links-prose-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-size-single-source.test.js tests/wrap-up-merge-mode-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js tests/skill-prose-plugin-root-invocations.test.js`. Expected: all pass. Then run `wc -c` on the five edited `_shared` files and report each size (all under 52,500). Also run `node "{plugin-root}/bin/plan-audit.js" docs/superpowers/plans/2026-10-25-pr-first-closing-link-4199.md --repo-root .` and report `headroom.composed[].max` for the `merge` step, which must be under 52,500 now that the paragraph is in.

- [ ] **Step 5: Commit.**
```bash
git add plugin/skills/_shared/pr-checklist-refresh.md plugin/skills/_shared/pr-first-merge-post-merge.md plugin/skills/_shared/pr-early-run-lifecycle.md plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-first-merge-appendix.md tests/closing-links-prose-conformance.test.js
git commit -m "Wire closing-links into pr-first merge — pre-merge unlink, post-merge reopen backstop (refs #4199)"
```

## Live verification (controller, after Task 3, before review)

These are real-input probes against the live throwaway PR. They are not an implementer task.

1. Pure lib against the real #4144 body, from live `gh pr view 4144 --json body,closingIssuesReferences,url`. `sameRepoNumbers` must give [2724, 3997]. `parseFixesSpan` must give fixes [3997] and refs [2724]. `neutralizeClosingPhrases(…, {targets:[2724]})` must report 2 phrases. Independent count: `grep -o 'closes #2724' | wc -l` = 2.
2. CLI pre-merge end to end against probe PR #4234, which currently carries the keyword-in-reason body and links [4233]:
   - Mint a scratch run dir with `hooks.js resolve-run-dir --spec-slug probe-4199 --create`.
   - Record `pr 4234` in it with `record-pr --run`.
   - Prefix the probe body with that run's marker line.
   - Run `--mode pre-merge`. The expected result is `action:'unlinked'`, `unlinked:[4233]`, and a live re-read `gh pr view 4234 --json closingIssuesReferences` → `[]`.
   This is the AC1.1 linkage-level verification.
3. Clean up afterwards:
   - Close PR #4234 unmerged.
   - Delete `probe/closing-link-4199`.
   - Close issue #4233 as not planned.
   - Remove the scratch run dir.
   - Mark ledger row 1 fixed.

Waived AC1.1: (only the "merges" half; the linkage half is covered by live step 2) merging a throwaway PR would land a commit on the published `main` (`pr-first-merge.md`'s "Never rewrite the integration branch" makes that irreversible in practice). The merge-close outcome is verified instead at the input GitHub's merge-close keys on, `closingIssuesReferences` = `[]` after the check (live step 2), and by Task 2's post-merge tests. The next real bundle run with a deferred closure is the first live merge.
