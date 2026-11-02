# Recent-commit liveness screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace commit-subject word matching with a check of whether the code a record describes still exists, and hold a record with `needs:decision` only when a commit in the window really removed it.

**Architecture:** `plugin/bin/lib/issues/recent-commit-check.js` gets one new entry point, `screenRecordLiveness`, plus an exported anchor classifier that `findOpenPrOverlap` also uses. The five filing call sites keep citing `_shared/health-recent-commit-check.md`, which stamps a decision comment plus the label, and `/specify` runs the same procedure when it shapes a record. Dispatch drops any `needs:*` record through a new removing exclusion. A maintainer-side `tools/recent-commit-replay.js` measures precision over the historical records.

**Tech Stack:** Node 18+, `node --test`, real-git fixtures, `gh` CLI (replay tool and skill prose only).

**Spec:** `.claude-tweaks/pipelines/2026-11-02T045108-record-4851/work/4851-spec.md`

**Scope keywords:** findRecentCommitOverlap, deriveKeyTerms, findOpenPrOverlap, matchedTerms, health-recent-commit-check

## Global Constraints

- A failed screen never blocks filing: every git failure yields `null`, and skill prose logs and continues.
- A record with no anchors gets no comment. A weak or unprovable result posts nothing.
- Lookback window stays 14 days (`DEFAULT_LOOKBACK_DAYS`).
- Decision comment follows `_shared/work-record.md`'s template, with `{unit}` = `recent-commit-check`, comment posted before the label (`tidy/decision-markers.md`'s write order).
- The record's Decisions section governs every classification question: a weak or unprovable signal posts nothing.
- Commit style `{Verb} {what} — {detail}`; any issue reference is `refs #4851`, never a closing keyword.
- Run `pwd` and `git rev-parse --show-toplevel` before each commit, as separate calls; both must be `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4851`. Never `git stash`.
- Run targeted test files only (`node --test {file}`); the full suite runs centrally. Quote raw command output in your report.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

Governing skill `gh-api-module-pattern`, verbatim:

- "Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see." A literal key in the call's own options; a spread fails the scan.
- "For `git` the separator is **`--end-of-options`, not `--`**" ahead of a caller-supplied ref; "`--end-of-options` alone never resolves a revision — it needs `--verify` alongside it."
- "A `git` path-list read also needs `-z`." (`--name-status` here.)
- "A read whose output scales with a range the module does not bound owes `maxBuffer: LARGE_MAX_BUFFER_BYTES`." Import it, and `DEFAULT_GIT_TIMEOUT_MS`, from `plugin/bin/lib/shared-primitives.js`.
- "For patch text, pass every flag explicitly": `-c core.quotePath=false show --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/`.
- "The quiet posture is owed by any call the module catches and recovers from": `stdio: ['ignore', 'pipe', 'pipe']`.

## Review Focus

1. Anchors that look like options or regex (`-x`, `foo(bar)`, `a.b*`): literal handling, no flag injection. Test in Task 1.
2. A symbol moved to another file by the removing commit: the code still exists, so no flag. Test in Task 1.
3. A record that quotes something that never existed (an error phrase, "no `fooBar` exists"): absent at HEAD with no removing commit means no flag. Test in Task 1.
4. A path written partially (`_shared/foo.md`) or unsafely (`../x`, `/etc/passwd`): never resolved, never flagged. Test in Task 1.
5. A record a human already answered: `/specify` promotion resolves its decision comment, so re-screening at shaping must not re-hold it. Pinned in Task 3.

---

### Task 1: Liveness screen core

**Role:** judgment. **Review risk:** high.

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js` (extract and export `currentStateText(body)`, which `extractCurrentStateAnchors` then uses, behavior unchanged)
- Modify: `plugin/bin/lib/issues/recent-commit-check.js`
- Test: `tests/bin-lib/issues/recent-commit-liveness.test.js` (create, real-git fixtures)
- Modify: `tests/bin-lib/issues/recent-commit-check.test.js` (delete the `findRecentCommitOverlap`/`deriveKeyTerms` tests; open-PR tests stay until Task 2)

**Interfaces:**
- Produces: `screenRecordLiveness({ root, body, ref = 'HEAD', since, lookbackDays = DEFAULT_LOOKBACK_DAYS }, execImpl = execFileSync)` returning `null` or `{ lookbackDays, rollup: boolean, flagged: [{ entry: string|null, anchor: string, kind: 'line'|'path'|'symbol', commit: { sha, subject, date } }] }`. `since`, when given, is an ISO date passed as `--since=` and overrides `lookbackDays`.
- Produces: `classifyAnchor(span)` returning `null` (dropped) or `{ kind: 'line', path, line }`, `{ kind: 'path', path }`, or `{ kind: 'symbol', symbol, file: string|null }`. Task 2 consumes it.
- Produces: `extractRecordAnchors(body)` returning `{ rollup: boolean, groups: [{ entry: string|null, anchors: [classified] }] }`.
- Produces: `formatDecisionComment(result, number)` returning the comment text.
- Removes: `findRecentCommitOverlap`. `deriveKeyTerms` stays until Task 2.

**Anchor rules:**

- Text source. A non-rollup record has one group (`entry: null`): the backticked spans from `extractCurrentStateAnchors`, plus bare `path:line` tokens in `currentStateText`. A rollup record (`/^Origin:.*\bdigest #\d+/m` in the body, and at least one `## Deliverables` line matching `/^- \[[\w-]+\] /`) has one group per such line (`entry` = the line text), reading that line's backticked spans and bare path tokens. Its Current State is not screened.
- `classifyAnchor`, first match wins:
  - Dropped: whitespace; contains `://`; fewer than 3 characters; `/^#?\d+$/`; `isGenericAnchor` (applied to rollup spans too).
  - `relfile#Symbol` (the part before `#` contains `/` or a `.`, the part after is non-empty): `kind: 'symbol'`, `symbol` = the part after, `file` = the part before. The file is never voted on its own; it is the symbol's scope.
  - `kind: 'line'`: `{path}:{n}`, `{path}:{n},{m}`, or `{path}:{n}-{m}` (a range tests its first line).
  - `kind: 'path'`: contains `/`, no line suffix. Dropped when absolute or containing a `..` segment.
  - A bare filename with no `/`: dropped. A plain word (`/^[a-z]+$/`, the `settle`/`digest`/`hooks` case): dropped.
  - Otherwise `kind: 'symbol'`, `file: null`.
- Cap each group at 40 anchors.
- Symbol scope: `file` when set, else the group's path and line files, plus (non-rollup only) `extractKeyFiles({ body })`. An empty scope drops the symbol.

**Verdicts**, each anchor tested at `ref`:

| Kind | `live` | `gone` (with commit) | ignored |
|---|---|---|---|
| symbol | `git grep -F -q -e {sym} {ref} -- {scope}` exits 0; or absent, but the newest `-S{sym}` commit in the window adds a line containing it anywhere in that commit (a move) | absent, and the newest `git log -S{sym}` commit in the window over the scope adds no line containing it | absent, no such commit |
| path | exists at `ref`: **no vote** (neither live nor gone). Deleted in the window but renamed by that commit (`show -M -z --name-status`) counts `live` | missing at `ref`, newest `--diff-filter=D --no-renames` commit in the window, not a rename | missing, no such commit |
| line | file exists at `ref` and `n` is at most its line count there. HEAD numbering: an in-range line is live whatever window commits did to it | file exists, `n` is past EOF at `ref`, and walking window commits touching the file newest first (at most 20) one has `n` in range in `C^:file` and past EOF in `C:file`: that commit removed the line. A missing file falls back to the path rule, as a path anchor. | `n` past EOF at `ref` with no such commit |

A group flags only when it has at least one `gone` and zero `live`. Every `gone` in a flagged group becomes one `flagged` row. All rows empty returns `null`. No git repo, an unresolvable `ref`, any unexpected git failure, or no groups returns `null`; a `git grep` exit status of 1 means absent, any other failure ends the whole screen as `null`. `git rev-parse --verify --end-of-options {ref}^{commit}` is the first call.

**Decision comment** (`formatDecisionComment`), literal shape:

```
<!-- needs-decision: recent-commit-check -->
## Decision needed
**Proposed:** Close this record as already fixed: `{short sha}` removed `{anchor}`.
**Why:** `{short sha}` {subject} ({date}) removed code this record cites; {n} cited item(s) are gone at HEAD.
**Command:** `/claude-tweaks:backlog refine #{number}`

Filed by the recent-commit liveness check.
```

The comment never claims that no anchors remain (a live bare path may still exist). A rollup's `**Proposed:**` stays one line: `Strike {k} entries as already fixed, first: {first 120 chars of the first flagged entry}.` Single-line readers (`backlog/attention-mode.md`, `refine-record.md`) read that line. The full list goes after `**Command:**`, one line per flagged entry: `- {first 120 chars of entry}: \`{short sha}\` removed \`{anchor}\``. Neutralize closing keywords in commit subjects with `plugin/bin/lib/flow/closing-links.js`'s `neutralizeClosingPhrases`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/recent-commit-liveness.test.js`. A `makeRepo()` helper builds a temp repo through real `git`, with `-c user.name=t -c user.email=t@t`, `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` set per commit (old = 40 days ago, recent = 3 days ago), and removes it with `t.after`. Tests, by name:
  - `AC1.1: an anchor still at HEAD yields null even when commit subjects share the title words`
  - `AC2.1: a line removed by a window commit is flagged naming that commit`, using the past-EOF shape (the commit truncates the file below `n`), asserting `flagged[0].commit.sha` equals the removing sha and `kind === 'line'`
  - `a line whose text changed but stays in range at HEAD is live`, a window commit having edited it: result `null`
  - a symbol removed by a window commit flags with `kind: 'symbol'`; a deleted path flags with `kind: 'path'`
  - `a relfile#Symbol anchor tests the symbol in that file`: present elsewhere but gone from that file, removed by a window commit, flags `kind: 'symbol'`
  - `a removal older than the window is not flagged`
  - `AC3.1: a rollup flags only the entries whose anchors are gone`, with two `- [hooks]` entries, one gone and one live, asserting `flagged` names only the gone entry
  - `AC4.1: the #4807 fixture produces no match`: #4807's verbatim title, body and Key Files (`Settle 4 digest findings in hooks`; `plugin/bin/lib/hooks/run-dir-resolve.js:257`, `plugin/bin/lib/hooks/resume-freshness.js:73`, `:187`, `tests/hooks-run-dir-resolve.test.js:641`); the repo holds those files with enough lines; window commits touching them are subjected `chore: Settle 3 below-floor digest findings in hooks`; result `null`
  - `AC5.1: a git failure yields null`, with a nonexistent `root`, and with an `execImpl` that throws
  - `AC5.2: an anchorless record yields null`, and an empty or non-string body yields `null`
  - Review Focus: an option-like symbol `-evil` and a regex-like `foo(bar)` test literally; a symbol moved to an unlisted file by the removing commit returns `null`; a never-existing symbol returns `null`; `../x.js`, `/etc/passwd.js` and `_shared/never.md` return `null`; a renamed path returns `null`
  - mixed verdicts: one gone symbol plus one live symbol returns `null`
  - `a bare path casts no vote`: a live path plus a gone symbol flags; a live path alone returns `null`
  - `formatDecisionComment` output matches `/^<!-- needs-decision: recent-commit-check -->$/m`, carries `**Proposed:**`, `**Why:**`, `**Command:**`, the short sha, the anchor, and `refine #{number}`, and does not match `/no anchors|none remain/i`
  - a rollup's comment has exactly one line starting `**Proposed:**`, naming the count and first entry, and the full list after `**Command:**`

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/recent-commit-liveness.test.js`
Expected: FAIL with "screenRecordLiveness is not a function"

- [ ] **Step 3: Implement** the exports above. Every spawn: `execImpl('git', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: DEFAULT_GIT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES })`. Rewrite the file header to describe the new screen, keeping the #1068 reason.

- [ ] **Step 4: Verify each new test can fail.** Revert each guard in turn (the moved check, the rename check, the zero-`live` rule, the plain-word drop, the in-range-is-live rule) and confirm its test goes red. Report which test went red for each.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/bin-lib/issues/recent-commit-liveness.test.js tests/bin-lib/issues/near-duplicate.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Commit**, staging by explicit path: `Replace the recent-commit title match with a liveness screen — refs #4851`

### Task 2: Open-PR screen needs a shared Key File or anchor

**Role:** integration. **Review risk:** high.

**Files:**
- Modify: `plugin/bin/lib/issues/recent-commit-check.js`
- Test: `tests/bin-lib/issues/recent-commit-open-pr.test.js` (create; replaces what remains of `recent-commit-check.test.js`, which this task deletes)
- Modify: `plugin/skills/capture/SKILL.md` (lines 202-227 and 286)
- Modify: `docs/skill-graph.md` (line 139)
- Modify: `docs/journeys/catch-a-capture-that-duplicates-an-open-pr-3191.md`

**Interfaces:**
- Consumes: `extractKeyFiles` (`grouping.js`), `extractCurrentStateAnchors` (`near-duplicate.js`), Task 1's `classifyAnchor`.
- Produces: `findOpenPrOverlap({ body, prs })` returning `null` or `{ prs: [{ number, title, url, sharedFiles: string[], sharedAnchors: string[] }] }`, sorted by `sharedFiles.length + sharedAnchors.length` descending, then higher PR number first. `prs` entries carry `files: [{ path }]` and `body`.

A match needs a file in both the record's Key Files (plus its path and line anchors' files) and `pr.files`, or a symbol or path anchor appearing in `pr.title` or `pr.body`. Title words no longer count at all. Delete `deriveKeyTerms`, `STOPWORDS`, `DEFAULT_MIN_TERM_MATCHES`, and `MIN_TERM_LENGTH`.

Capture's list call becomes `gh pr list --state open --json number,title,url,files,body --limit 200` (run read-only during the prior attempt's authoring against this repo: 49 PRs returned). The snippet reads `body` from the payload file and calls `findOpenPrOverlap({ body, prs })`. The comment lines become `#{number} {title} (shared: {files or anchors})`; the comment text stops calling it a title match.

The journey is rewritten: a stub has no anchors, so capture's screen stays silent on it and `/specify` runs the open-PR screen at shaping (Task 3); a spec-shaped filing is screened at filing. Keep its `files:` frontmatter and add `plugin/skills/_shared/health-recent-commit-check.md` and `plugin/skills/specify/shaping-mode-stamping.md`. Keep the #3178/#3185/#3189 Origin line.

- [ ] **Step 1: Write the failing tests** in the new file, porting the old file's open-PR fixtures, then delete the old file. `AC4.2: title-word overlap alone never matches an open PR`, using the #3155 incident titles with no shared files. `a shared Key File matches`, using PR #3172's real shape: `plugin/bin/lib/verify/` file in both. `a shared anchor in the PR body matches`. Ranking and tie-break keep their tests, on counts. An anchorless body returns `null`. Unusable `prs` and a PR entry with no `files` do not throw. Assert the capture snippet's `--json` list names `files` and `body`: a fake cannot see that list shrink.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/recent-commit-open-pr.test.js`
Expected: FAIL

- [ ] **Step 3: Implement, and edit capture, skill-graph line 139 and the journey.**
- [ ] **Step 4: Run to verify it passes** (same command, plus `tests/journey-*` suites touching the 3191 journey found by `git grep -l catch-a-capture -- tests`). Expected: PASS
- [ ] **Step 5: Commit**: `Require a shared Key File or anchor in the open-PR screen — refs #4851`

### Task 3: Filing prose, shaping screen, and the hold

**Role:** integration. **Review risk:** high.

**Files:**
- Modify: `plugin/skills/_shared/health-recent-commit-check.md` (rewrite)
- Modify: `plugin/skills/capture/SKILL.md` (lines 64, 284)
- Modify: `plugin/skills/code-health/filing.md` (line 97)
- Modify: `plugin/skills/harness-health/filing.md` (line 102)
- Modify: `plugin/skills/docs-health/SKILL.md` (line 223)
- Modify: `plugin/skills/journey-health/SKILL.md` (line 219)
- Modify: `plugin/skills/specify/shaping-mode-stamping.md` (new paragraph ahead of the `github-issues` write at line 177)
- Modify: `plugin/skills/specify/shaping-mode-readback.md` (line 21 and line 98's outcome list)
- Modify: `plugin/skills/_shared/work-record.md` (Definition-family row, Decision-comment writer list and `{unit}` list, Worklist rule's filter list)
- Modify: `plugin/skills/_shared/work-record-permission-matrix.md` (Health skills, `/capture` and `/specify` Adds)
- Modify: `plugin/skills/_shared/autonomy-ceiling.md:171` (one added sentence: this stamp holds a record rather than advancing it, so no ceiling gates it; existing text unchanged, it is pinned)
- Modify: `plugin/skills/backlog/refine-lanes.md:53` (producer list gains `recent-commit-check`)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (reason bullet, the not-spec-shaped pass at lines 319-334)
- Create: `plugin/skills/dispatch/needs-label-exclusion-report.md`
- Modify: `plugin/skills/dispatch/SKILL.md` (report citation at line 150, `#N` bullet line 190, list bullet line 192)
- Modify: `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md` (`five reasons` becomes `six`, Success state and Step 2 name the new reason)
- Modify: `plugin/skills/intake/SKILL.md` (line 62; line 36's window citation stays valid)
- Modify: `docs/skill-graph.md` (line 405, plus a new `/specify` row for the shared doc, and the dispatch report if sibling reports are listed)
- Test: `tests/recent-commit-liveness-prose.test.js` (create)
- Test: `tests/dispatch-needs-label-exclusion-fixture.test.js` (create)

**Byte headroom** against `RAIL_BYTES` 52,500: `queue-pull-script.md` is 52,091 B with 409 B left, and this task adds about 500 B. Remedy, named up front: cut the `Placed ahead of the #1224 open-PR pass ... from the shipped pass.` sentence from the `#2829` comment at lines 310-314, which line 8's bullet already states; first grep `tests/` and `plugin/` for two phrases from it (Moved-prose pin check). `SKILL.md` is 51,407 B: its edit stays under 300 B. `capture/SKILL.md` is 44,490 B. Others are well clear.

**Dispatch hold.** The record's Decisions require that `dispatch/queue-pull-script.md`'s eligibility filter excludes a record with any `needs:*` label, with a report line naming the label. The first-pass filter at line 162 runs only on a cache miss and writes no exclusion entry, so `#N` would report "absent". The exclusion therefore goes in the unconditional not-spec-shaped pass, checked before `shapeGate` (the shape gate must not misreport a held record), and records `{ reason: 'needs-label', records: [c.number], detail: { labels } }`, using `normalizeLabelNames` from `record.js`. Bullet form (must match `tests/dispatch-named-form-exclusion-reasons.test.js`'s derivation, and be a removing reason): ``- `reason: 'needs-label'` (`detail: {labels}`, #4851) — every candidate carrying a `needs:*` label, unconditionally removed, no `#N` bypass: a human answers first.``

`needs-label-exclusion-report.md` follows `not-spec-shaped-exclusion-report.md`'s shape, one line per record: `` `#{number} excluded — held by {labels, comma-joined}. Run {remedy}.` `` Remedy: `/claude-tweaks:specify #{number}` when `labels` is exactly `["needs:definition"]`, else `/claude-tweaks:backlog refine #{number}`. The `#N` bullet renders it; the list bullet names `needs-label` in its parenthetical.

**Shaping screen** (the record's Decisions: a stub has no anchors at filing). `health-recent-commit-check.md` gets a `## At shaping` section, and `shaping-mode-stamping.md` cites it in one paragraph placed before the `gh issue edit` write, `github-issues` only, on the composed body file (`$SPECIFY_SHAPED_BODY`):

- Skip guard: a trusted-author comment on the record already carrying `<!-- needs-decision: recent-commit-check -->`, resolved or not, skips the liveness half. A filing-time screen already flagged it and a human is shaping it; the promotion resolves that comment (`shaping-mode-stamping.md` lines 89-96), and re-screening would hold it again forever. Use the same trusted-author `jq` select the file's line 105 uses, and print the skipped-lookalike line as line 106 does.
- Confirmed match: stop shaping the record as the near-duplicate refusal does (`shaping-mode.md` lines 172-192): no body write and no `ready`, comment first then `needs:decision`, Actions Performed row `refused — code already changed by {short sha}`. `next-mode-shape.md`'s headless path inherits this, since it runs this same file.
- Null or failed: shaping proceeds unchanged.
- Open-PR half: `gh pr list --state open --json number,title,url,files,body --limit 200`, `findOpenPrOverlap({ body, prs })`, and a non-null result posts capture's open-PR comment after the write. Skip when a trusted comment beginning `Possible overlap with an open pull request` already exists. It never blocks shaping.

**`health-recent-commit-check.md` content.** Keep the heading, the "Why" (#1068), and "When it runs", and keep a `**Lookback window.**` section (intake cites it). Replace the rest:

- What it is: asks whether the code still exists, per Task 1's rules in summary. A confirmed match holds the record; everything else posts nothing.
- Steps, each its own plain Bash call: `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value recent-commit-body-<N>.md` and likewise `recent-commit-comment-<N>.md` to get two paths; `gh issue view <N> --json body -q .body > "{body}"`; a `bin/node-eval-file.js` heredoc (not a multi-line `node -e`, which silently no-ops on Windows Git Bash) that reads the body file, calls `screenRecordLiveness({ root: process.cwd(), body })`, writes `formatDecisionComment(result, N)` to the comment path when non-null, and prints `JSON.stringify(result)`, in a try/catch that prints `null`.
- On non-null: bootstrap `needs:decision` per `_shared/label-bootstrap.md`, then `gh issue comment <N> --body-file "{comment}"`, then `gh issue edit <N> --add-label needs:decision`, comment first. A failed label add after a good comment is reported plainly, never a re-post. A human resolves through `/claude-tweaks:backlog refine`'s Resolve lane. With `gh` absent, the same CRUD goes through `_shared/github-write-transport.md`'s MCP path.
- On `null`: no comment, no label, continue. Any failure in a step is logged and filing continues.

The five call-site sentences drop "on a strong match, posts a triage comment rather than blocking" for: "on a confirmed removal, holds the record with `needs:decision`; a weak or failed screen posts nothing and never blocks filing." Capture line 284 drops `(title: "$TITLE")`. Capture line 64's "three exceptions" becomes "four" and names the screen's `needs:decision`. Journey-health's line 219 has no such sentence: add the same clause.

Intake line 62 drops `(_shared/health-recent-commit-check.md`'s matching discipline)`; subject-line matching stays intake's own rule. Skill-graph line 405 becomes "Step 1's `shipped` evidence set reuses this file's lookback window."

Retirement sweep, whose output decides any further file:
`git grep -n -i -e findRecentCommitOverlap -e deriveKeyTerms -e matchedTerms -e fileScoped -e "strong match" -e "triage comment" -e "Possible overlap with a recently-merged" -e "matching discipline" -e "title match" -e "key terms" -- plugin tests docs ":!docs/incident-log.md" ":!docs/superpowers/plans"`
Every hit is fixed or classified no-change in the report.

- [ ] **Step 1: Write the failing tests.**
  - `tests/recent-commit-liveness-prose.test.js`, with one assertion function per file so a go-red control can run it on mutated text:
    - the shared doc names `screenRecordLiveness`, `needs:decision`, `formatDecisionComment`, has its `gh issue comment` before its `gh issue edit`, has a `## At shaping` section with the skip guard, and no longer contains `findRecentCommitOverlap` or `triage comment`
    - each of the five call sites cites `_shared/health-recent-commit-check.md` and names `needs:decision`
    - `shaping-mode-stamping.md` cites the shared doc, and the citation sits before `gh issue edit {n}`
    - `work-record-permission-matrix.md`'s Health skills and `/capture` rows contain `needs:decision`
    - `work-record.md` names `recent-commit-check` and `queue-pull-script.md`'s pass
    - a go-red control runs the assertion function against text with the clause removed and expects a throw
  - `tests/dispatch-needs-label-exclusion-fixture.test.js`, extract-and-run as `tests/dispatch-not-spec-shaped-exclusion-fixture.test.js` does, on the real snippet: `a needs:decision record is removed and its entry names the label`; `a needs:definition record is removed`; `a clean record stays`; `a needs:decision record that also fails the shape gate reports needs-label, not not-spec-shaped`; a bundle keeps its other members. Plus an assertion that the report file carries the per-record line naming `{labels, comma-joined}` and both remedies.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/recent-commit-liveness-prose.test.js tests/dispatch-needs-label-exclusion-fixture.test.js`
Expected: FAIL

- [ ] **Step 3: Make the edits, and run the retirement sweep.**
- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/recent-commit-liveness-prose.test.js tests/dispatch-needs-label-exclusion-fixture.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js tests/work-record-needs-decision-conformance.test.js tests/bin-lib/dispatch/exclusions.test.js tests/comment-trust-conformance.test.js tests/skill-size-single-source.test.js`
Expected: PASS

- [ ] **Step 5: Commit**: `Hold a record the liveness screen confirms with needs:decision — refs #4851`

### Task 4: Replay tool and measured precision

**Role:** judgment.

**Files:**
- Create: `tools/recent-commit-replay.js` (maintainer-side, unshipped)
- Test: `tests/tools/recent-commit-replay.test.js`
- Modify: `plugin/bin/lib/issues/recent-commit-check.js` (only if the replay forces a tightening)

**Interfaces:**
- Consumes: `screenRecordLiveness` with `ref` and `since`.
- Produces: CLI `node tools/recent-commit-replay.js --records {records.json} [--verdicts {verdicts.json}] [--root {dir}] [--base origin/main]`, printing a report. `replay(records, { root, base, verdicts }, execImpl)` returns `{ total, skipped, flagged: [...], precision }`.

Per record: `ref` = `git rev-list -1 --before={createdAt} {base}`; `since` = `createdAt` minus 14 days. A record with no resolvable ref counts as `skipped`, and the report names it. `{records.json}` is a JSON array of `gh issue view --json number,title,body,createdAt,state,stateReason,comments`, kept to records with a comment whose body begins `Possible overlap with a recently-merged commit`.

The report states: records replayed; the old screen's count (every record, by construction); records the new screen flags, one line each with number, state, stateReason, sha, anchor; `precision`. `verdicts.json` maps number to `true` or `false`, hand-adjudicated by reading the flagged commit against the record. Without verdicts, precision prints `unadjudicated`. It also prints the count closed NOT_PLANNED among flagged, and recall against `#1970` and `#1776` (flagged or not).

Limits to state in the report: bodies are read as they are today, so a record shaped after filing replays with its later text. Hand-adjudicated verdicts are one reader's judgment.

- [ ] **Step 1: Write the failing test** `tests/tools/recent-commit-replay.test.js`: a real-git fixture with two records; a removal before one record's `createdAt` flags that record and a removal after it does not (`ref` is pinned to filing time); a `verdicts` map yields `precision: 0.5`; no verdicts yields `'unadjudicated'`; an unresolvable record lands in `skipped`.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tools/recent-commit-replay.test.js`
Expected: FAIL

- [ ] **Step 3: Implement, and run to pass** (same command).
- [ ] **Step 4: Fetch the real records** into the session scratchpad, by a scratch script, and reconcile against an independent count: `gh search issues "Filed by the recent-commit overlap check" --repo thn-inc/claude-tweaks --limit 120 --json number --jq length` printed 91 during authoring (mentions, including this record). The filtered count must be explained against both 91 and the spec's 82, by number.
- [ ] **Step 5: Run the replay**, read every flagged commit against its record, write `verdicts.json`, and re-run. Save output with `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T045108-record-4851/evidence"` then redirect to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T045108-record-4851/evidence/recent-commit-replay.txt`.
- [ ] **Step 6: Tune only from evidence.** If a false positive traces to a rule, tighten that rule, add a test built from the real record's shape, and re-run. Report before and after numbers. Never loosen to raise the flag count.
- [ ] **Step 7: Commit**: `Add a replay tool measuring the liveness screen's precision — refs #4851`

The controller, not the implementer, quotes the replay output in PR #4927's body (AC6.1) and writes the `AC evidence` decision line.

## Spec coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 1 test |
| AC2.1 | Task 1 test |
| AC3.1 | Task 1 test |
| AC4.1 | Task 1 test (commit screen); Task 2's AC4.2 test (open-PR side) |
| AC5.1 | Task 1 test |
| AC6.1 | Task 4 Step 5 plus the controller's PR body edit |

Waived AC6.1: no committed test can read a PR body; evidence is the `gh pr view` read-back and the decision line.
