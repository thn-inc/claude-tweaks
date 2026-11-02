# Recent-commit liveness screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace commit-subject word matching with a check of whether the code a record describes still exists, and hold a record with `needs:decision` only when a commit in the window really removed it.

**Architecture:** `plugin/bin/lib/issues/recent-commit-check.js` gets one new entry point, `screenRecordLiveness`, that classifies a record's anchors and tests each at a ref. `findOpenPrOverlap` is rewritten to need a shared Key File or anchor. The five filing call sites keep citing `_shared/health-recent-commit-check.md`, which now stamps a decision comment plus the label. A maintainer-side `tools/recent-commit-replay.js` measures precision over the historical records.

**Tech Stack:** Node 18+, `node --test`, real-git fixtures, `gh` CLI (replay tool and skill prose only).

**Spec:** `.claude-tweaks/pipelines/2026-11-02T043426-record-4851/work/4851-spec.md`

**Scope keywords:** findRecentCommitOverlap, deriveKeyTerms, findOpenPrOverlap, matchedTerms, health-recent-commit-check

## Global Constraints

- A failed screen never blocks filing: every git failure yields `null`, and skill prose logs and continues.
- A record with no anchors gets no comment. A weak or unprovable result posts nothing.
- Lookback window stays 14 days (`DEFAULT_LOOKBACK_DAYS`).
- Decision comment follows `_shared/work-record.md`'s template, with `{unit}` = `recent-commit-check`, comment posted before the label (`tidy/decision-markers.md`'s write order).
- Commit style `{Verb} {what} — {detail}`; any issue reference is `refs #4851`, never a closing keyword.
- Run `pwd` and `git rev-parse --show-toplevel` before each commit, as separate calls; both must be `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4851`. Never `git stash`.
- Run targeted test files only (`node --test {file}`); the full suite runs centrally. Quote raw command output in your report.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

Governing skill `gh-api-module-pattern`, verbatim:

- "Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see." A literal key in the call's own options; a spread fails the scan.
- "For `git` the separator is **`--end-of-options`, not `--`**" ahead of a caller-supplied ref; "`--end-of-options` alone never resolves a revision — it needs `--verify` alongside it."
- "A `git` path-list read also needs `-z`." (`--name-status` here.)
- "A read whose output scales with a range the module does not bound owes `maxBuffer: LARGE_MAX_BUFFER_BYTES`." Import it, and `GIT_TIMEOUT_MS`, from `plugin/bin/lib/shared-primitives.js`.
- "For patch text, pass every flag explicitly": `-c core.quotePath=false show --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/`.
- "The quiet posture is owed by any call the module catches and recovers from": `stdio: ['ignore', 'pipe', 'pipe']`.

## Review Focus

1. Anchors that look like options or regex (`-x`, `foo(bar)`, `a.b*`): literal handling, no flag injection. Test in Task 1.
2. A symbol moved to another file by the removing commit: the code still exists, so no flag. Test in Task 1.
3. A record that quotes something that never existed (an error phrase, "no `fooBar` exists"): absent at HEAD with no removing commit means no flag. Test in Task 1.
4. A path written partially (`_shared/foo.md`) or unsafely (`../x`, `/etc/passwd`): never resolved, never flagged. Test in Task 1.
5. A chained capture: `/specify --chained` removes `needs:*`, so a flagged filing must not chain. Pinned in Task 3.

---

### Task 1: Liveness screen core

**Role:** judgment. **Review risk:** high.

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js` (extract and export `currentStateText(body)`, which `extractCurrentStateAnchors` then uses, behavior unchanged; export `isGenericAnchor` already exists)
- Modify: `plugin/bin/lib/issues/recent-commit-check.js`
- Test: `tests/bin-lib/issues/recent-commit-liveness.test.js` (create, real-git fixtures)
- Modify: `tests/bin-lib/issues/recent-commit-check.test.js` (delete the `findRecentCommitOverlap`/`deriveKeyTerms` tests; open-PR tests stay until Task 2)

**Interfaces:**
- Produces: `screenRecordLiveness({ root, body, ref = 'HEAD', since, lookbackDays = DEFAULT_LOOKBACK_DAYS }, execImpl = execFileSync)` returning `null` or `{ lookbackDays, rollup: boolean, flagged: [{ entry: string|null, anchor: string, kind: 'line'|'path'|'symbol', commit: { sha, subject, date } }] }`. `since`, when given, is an ISO date passed as `--since=` and overrides `lookbackDays`.
- Produces: `extractRecordAnchors(body)` returning `{ rollup: boolean, groups: [{ entry: string|null, anchors: [...] }] }`.
- Produces: `formatDecisionComment(result)` returning the comment text.
- Removes: `findRecentCommitOverlap`, and `deriveKeyTerms` once Task 2 lands.

**Anchor rules** (decisions the implementer cannot make alone):

- Text source. A non-rollup record has one group (`entry: null`): the backticked spans from `extractCurrentStateAnchors`, plus bare `path:line` tokens in `currentStateText`. A rollup record (`/^Origin:.*\bdigest #\d+/m` in the body, and at least one `## Deliverables` line matching `/^- \[[\w-]+\] /`) has one group per such line (`entry` = the line text), reading that line's backticked spans and bare path tokens. Its Current State is not screened.
- Classification. `kind: 'line'`: `{path}:{n}`, `{path}:{n},{m}`, or `{path}:{n}-{m}` (a range tests its first line). `kind: 'path'`: contains `/`, no whitespace, no line suffix. `kind: 'symbol'`: everything else with no whitespace. Dropped as unprovable: any span with whitespace; a plain word (`/^[a-z]+$/`, the `settle`/`digest`/`hooks` case); fewer than 3 characters; a path that is absolute or contains a `..` segment; a bare filename with no `/`. `isGenericAnchor` spans are already excluded for Current State; apply it to rollup spans too. Cap each group at 40 anchors.
- Symbol scope: the group's path and line files, plus (non-rollup only) `extractKeyFiles({ body })`. An empty scope drops the symbol.

**Verdicts**, each anchor tested at `ref`:

| Kind | `live` | `gone` (with commit) | ignored |
|---|---|---|---|
| symbol | `git grep -F -q -e {sym} {ref} -- {scope}` exits 0; or absent, but the newest `-S{sym}` commit in the window adds a line containing it (a move) | absent, and the newest `git log -S{sym}` commit in the window over the scope adds no line containing it | absent, no such commit |
| path | exists at `ref` is **context only: no vote**. Deleted in the window but renamed by that commit (`show -M -z --name-status`) counts `live` | missing at `ref`, newest `--diff-filter=D --no-renames` commit in the window, not a rename | missing, no such commit |
| line | file exists, no window commit removed the line, and `n` is at most the file's line count at `ref` | walking window commits touching the file newest first (at most 20): the line at `n` in `C^:file` is non-trivial (trimmed length at least 8), and its trimmed text is on no line of `C:file` or `ref:file`. A missing file falls back to the path rule. | `n` past EOF at `ref` with no removing commit |

A group flags only when it has at least one `gone` and zero `live`. Every `gone` in a flagged group becomes one `flagged` row. All rows empty returns `null`. No git repo, an unresolvable `ref`, any unexpected git failure, or no groups returns `null`; a `git grep` exit status of 1 means absent, any other failure ends the whole screen as `null`. `git rev-parse --verify --end-of-options {ref}^{commit}` is the first call.

**Decision comment** (`formatDecisionComment`), literal shape:

```
<!-- needs-decision: recent-commit-check -->
## Decision needed
**Proposed:** Close this record as already fixed: `{short sha}` removed `{anchor}`.
**Why:** `{short sha}` {subject} ({date}) removed the code this record describes; {n} anchor(s) are gone and none remain.
**Command:** `/claude-tweaks:backlog refine`

Filed by the recent-commit liveness check.
```

A rollup's `Proposed:` reads `Strike {k} entries as already fixed:` followed by one line per flagged entry, `- {first 120 chars of entry}: \`{short sha}\` removed \`{anchor}\``. Neutralize closing keywords in commit subjects with `plugin/bin/lib/flow/closing-links.js`'s `neutralizeClosingPhrases`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/recent-commit-liveness.test.js`. A `makeRepo()` helper builds a temp repo through real `git`, with `-c user.name=t -c user.email=t@t`, `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` set per commit (old = 40 days ago, recent = 3 days ago), and removes it with `t.after`. Tests, by name:
  - `AC1.1: an anchor still at HEAD yields null even when commit subjects share the title words`
  - `AC2.1: a line removed by a window commit is flagged naming that commit`, asserting `flagged[0].commit.sha` equals the removing sha and `kind === 'line'`
  - a symbol removed by a window commit flags with `kind: 'symbol'`; a deleted path flags with `kind: 'path'`
  - `a removal older than the window is not flagged`
  - `AC3.1: a rollup flags only the entries whose anchors are gone`, with two `- [hooks]` entries, one gone and one live, asserting `flagged` names only the gone entry
  - `AC4.1: the #4807 fixture produces no match`: the record's verbatim Current State, four entries and Key Files; the repo holds those files with enough lines; window commits touching them are subjected `chore: Settle 3 below-floor digest findings in hooks`; result `null`
  - `AC5.1: a git failure yields null`, with a nonexistent `root`, and with an `execImpl` that throws
  - `AC5.2: an anchorless record yields null`, and an empty or non-string body yields `null`
  - Review Focus: an option-like symbol `-evil` and a regex-like `foo(bar)` test literally; a symbol moved to an unlisted file by the removing commit returns `null`; a never-existing symbol returns `null`; `../x.js`, `/etc/passwd.js` and `_shared/never.md` return `null`; a renamed path returns `null`
  - mixed verdicts: one gone symbol plus one live symbol returns `null`
  - a path that still exists casts no vote: a live path plus a gone symbol flags
  - `formatDecisionComment` output matches `/^<!-- needs-decision: recent-commit-check -->$/m` and carries `**Proposed:**`, `**Why:**`, `**Command:**`, the short sha, and the anchor

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/recent-commit-liveness.test.js`
Expected: FAIL with "screenRecordLiveness is not a function"

- [ ] **Step 3: Implement** the exports above. Every spawn: `execImpl('git', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES })`. Rewrite the file header to describe the new screen, keeping the #1068 reason.

- [ ] **Step 4: Verify each new test can fail.** Revert each guard in turn (the moved check, the rename check, the zero-`live` rule, the plain-word drop) and confirm its test goes red. Report which test went red for each.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/bin-lib/issues/recent-commit-liveness.test.js tests/bin-lib/issues/near-duplicate.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Commit**, staging by explicit path: `Replace the recent-commit title match with a liveness screen — refs #4851`

### Task 2: Open-PR screen needs a shared Key File or anchor

**Files:**
- Modify: `plugin/bin/lib/issues/recent-commit-check.js`
- Test: `tests/bin-lib/issues/recent-commit-open-pr.test.js` (create; replaces what remains of `recent-commit-check.test.js`, which this task deletes)
- Modify: `plugin/skills/capture/SKILL.md` (lines 208-227 and 286)
- Modify: `docs/skill-graph.md` (line 139)

**Interfaces:**
- Consumes: `extractKeyFiles` (`grouping.js`), `extractCurrentStateAnchors` (`near-duplicate.js`), Task 1's classification.
- Produces: `findOpenPrOverlap({ body, prs })` returning `null` or `{ prs: [{ number, title, url, sharedFiles: string[], sharedAnchors: string[] }] }`, sorted by `sharedFiles.length + sharedAnchors.length` descending, then higher PR number first. `prs` entries carry `files: [{ path }]` and `body`.

A match needs a file in both the record's Key Files (plus its path and line anchors' files) and `pr.files`, or a symbol or path anchor appearing in `pr.title` or `pr.body`. Title words no longer count at all. Delete `deriveKeyTerms`, `STOPWORDS`, `DEFAULT_MIN_TERM_MATCHES`, and `MIN_TERM_LENGTH`.

Capture's list call becomes `gh pr list --state open --json number,title,url,files,body --limit 200` (run read-only during authoring against this repo: 49 PRs returned, first row `{number: 4926, files: 1, bodyLen: 1023}`). The snippet reads `body` from the payload file and calls `findOpenPrOverlap({ body, prs })`. The comment lines become `#{number} {title} (shared: {files or anchors})`; the comment text stops calling it a title match.

- [ ] **Step 1: Write the failing tests** in the new file, porting the old file's open-PR fixtures, then delete the old file. `AC4.2: title-word overlap alone never matches an open PR`, using the #3155 incident titles with no shared files. `a shared Key File matches`, using PR #3172's real shape: `plugin/bin/lib/verify/` file in both. `a shared anchor in the PR body matches`. Ranking and tie-break keep their tests, on counts. An anchorless body returns `null`. Unusable `prs` and a PR entry with no `files` do not throw. Assert the capture snippet's `--json` list names `files` and `body`: a fake cannot see that list shrink.
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/recent-commit-open-pr.test.js`
Expected: FAIL

- [ ] **Step 3: Implement, and edit capture lines 208-227 and 286 and skill-graph line 139.**
- [ ] **Step 4: Run to verify it passes** (same command). Expected: PASS
- [ ] **Step 5: Commit**: `Require a shared Key File or anchor in the open-PR screen — refs #4851`

### Task 3: Filing prose and the hold

**Files:**
- Modify: `plugin/skills/_shared/health-recent-commit-check.md` (rewrite)
- Modify: `plugin/skills/capture/SKILL.md` (lines 64, 167-177, 284)
- Modify: `plugin/skills/code-health/filing.md` (line 97)
- Modify: `plugin/skills/harness-health/filing.md` (line 102)
- Modify: `plugin/skills/docs-health/SKILL.md` (line 223)
- Modify: `plugin/skills/journey-health/SKILL.md` (line 219)
- Modify: `plugin/skills/_shared/work-record.md` (Definition-family row, Decision-comment writer list and `{unit}` list, Worklist rule's filter list)
- Modify: `plugin/skills/_shared/work-record-permission-matrix.md` (Health skills and `/capture` Adds)
- Modify: `plugin/skills/_shared/autonomy-ceiling.md:171` (one added sentence: this stamp holds a record rather than advancing it, so no ceiling gates it; existing text unchanged, it is pinned)
- Modify: `plugin/skills/backlog/refine-lanes.md:53` (producer list gains `recent-commit-check`)
- Modify: `plugin/skills/dispatch/queue-pull-script.md:162` (see below)
- Modify: `plugin/skills/intake/SKILL.md` (line 62; line 36's window citation stays valid)
- Modify: `docs/skill-graph.md` (line 405)
- Test: `tests/recent-commit-liveness-prose.test.js` (create)

Byte headroom against `RAIL_BYTES` 52,500: `queue-pull-script.md` is 52,091 B with 409 B left, so its edit stays under 60 B. `capture/SKILL.md` is 44,490 B. Others are well clear.

**Why the dispatch edit.** The spec requires that the record does not build until a human answers. `grant-gate.js` Gate 1c refuses a machine grant on `needs:*`, but `queue-pull-script.md`'s eligibility filter reads only `facets.grants.build` and `bot.*`, so a record with `auto:build` and `needs:decision` still dispatches. The filter gains `&& !normalizeLabelNames(i.labels).some((n) => n.startsWith('needs:'))`, importing `normalizeLabelNames` in the same heredoc, and the Worklist rule names this filter. The cache-hit path reuses persisted groups, keyed on a freshness signal; verify a label change invalidates it (`queue-pull-notes.md`) and state the result in your report.

**Why the capture chain edit.** `specify/shaping-mode-stamping.md` removes every `needs:*` on promotion, so `/specify --chained` would silently undo the hold. Capture line 167's chain gains: a filing whose screen set `needs:decision` does not chain, and stays a plain capture.

**`health-recent-commit-check.md` content.** Keep the heading, the "Why" (#1068), and "When it runs", and keep a `**Lookback window.**` section (intake cites it). Replace the rest:

- What it is: asks whether the code still exists, per Task 1's rules in summary. A confirmed match holds the record; everything else posts nothing.
- Steps, each its own plain Bash call: `node bin/session-tmp-resolve.js --value recent-commit-body-<N>.md` and likewise `recent-commit-comment-<N>.md` to get two paths; `gh issue view <N> --json body -q .body > "{body}"`; a `node -e` that reads the body file, calls `screenRecordLiveness({ root: process.cwd(), body })`, writes `formatDecisionComment(result)` to the comment path when non-null, and prints `JSON.stringify(result)`, in a try/catch that prints `null`.
- On non-null: bootstrap `needs:decision` per `_shared/label-bootstrap.md`, then `gh issue comment <N> --body-file "{comment}"`, then `gh issue edit <N> --add-label needs:decision`, comment first. A failed label add after a good comment is reported plainly, never a re-post. A human resolves through `/claude-tweaks:backlog refine`'s Resolve lane.
- On `null`: no comment, no label, continue. Any failure in a step is logged and filing continues.

The five call-site sentences drop "on a strong match, posts a triage comment rather than blocking" for: "on a confirmed removal, holds the record with `needs:decision`; a weak or failed screen posts nothing and never blocks filing." Capture line 284 drops `(title: "$TITLE")`. Capture line 64's "three exceptions" becomes "four" and names the screen's `needs:decision`.

Intake line 62 drops `(_shared/health-recent-commit-check.md`'s matching discipline)`; subject-line matching stays intake's own rule. Skill-graph line 405 becomes "Step 1's `shipped` evidence set reuses this file's lookback window."

Retirement sweep, whose output decides any further file:
`git grep -n -i -e findRecentCommitOverlap -e deriveKeyTerms -e matchedTerms -e fileScoped -e "strong match" -e "triage comment" -e "Possible overlap with a recently-merged" -e "matching discipline" -- plugin tests docs ":!docs/incident-log.md" ":!docs/superpowers/plans"`
Every hit is fixed or classified no-change in the report.

- [ ] **Step 1: Write the failing test** `tests/recent-commit-liveness-prose.test.js`, with one assertion function per file so a go-red control can run it on mutated text:
  - the shared doc names `screenRecordLiveness`, `needs:decision`, `formatDecisionComment`, posts `gh issue comment` before `gh issue edit`, and no longer contains `findRecentCommitOverlap` or `triage comment`
  - each of the five call sites cites `_shared/health-recent-commit-check.md` and names `needs:decision`
  - capture's chain paragraph says a filing whose screen set `needs:decision` does not chain
  - `work-record-permission-matrix.md`'s Health skills and `/capture` rows contain `needs:decision`
  - `work-record.md` names `recent-commit-check` and `queue-pull-script.md`'s filter
  - the eligibility filter in `queue-pull-script.md` contains `startsWith('needs:')`, and evaluating that exact filter expression over `{labels:[{name:'needs:decision'}], ...}` excludes the record
  - a go-red control runs the assertion function against text with the clause removed and expects a throw
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/recent-commit-liveness-prose.test.js`
Expected: FAIL

- [ ] **Step 3: Make the edits, and run the retirement sweep.**
- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/recent-commit-liveness-prose.test.js tests/work-record-needs-decision-conformance.test.js tests/bin-lib/dispatch/exclusions.test.js tests/comment-trust-conformance.test.js tests/skill-size-single-source.test.js`
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
- [ ] **Step 4: Fetch the real records** into the session scratchpad, by a scratch script, and reconcile against an independent count: `gh search issues "Filed by the recent-commit overlap check" --repo thn-inc/claude-tweaks --limit 100 --json number --jq length` printed 91 during authoring (mentions, including this record). The filtered count must be explained against both 91 and the spec's 82, by number.
- [ ] **Step 5: Run the replay**, read every flagged commit against its record, write `verdicts.json`, and re-run. Save output with `mkdir -p "$PIPELINE_RUN_DIR/evidence"` then redirect to `$PIPELINE_RUN_DIR/evidence/recent-commit-replay.txt`, where `$PIPELINE_RUN_DIR` is `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T043426-record-4851`.
- [ ] **Step 6: Tune only from evidence.** If a false positive traces to a rule (most likely the `line` pre-image check, since a record citing current numbering can land on an edited old line), tighten that rule, add a test built from the real record's shape, and re-run. Report before and after numbers. Never loosen to raise the flag count.
- [ ] **Step 7: Commit**: `Add a replay tool measuring the liveness screen's precision — refs #4851`

The controller, not the implementer, quotes the replay output in PR #4926's body (AC6.1) and writes the `AC evidence` decision line.

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
