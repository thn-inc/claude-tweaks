# Demo Step 1 — Entry Paths

Referenced by `skills/demo/SKILL.md` Step 1. `$ARGUMENTS` already selected which path runs before
this file is read — load only the branch that matches (no-arguments vs. `#N` given), never both. For a `#N[,#M...]` list, the `#N` branch is entered once per ref, in list order — each entry is a fresh, independent lookup.

## No arguments: session-recall

Recall this conversation's own history. For each distinct unit of implementation and/or
verification work done in this session, check whether it already correlates to a `#N` mentioned
anywhere in this conversation. Work with no correlating `#N` is a session-recall candidate —
compose its Verification Brief content now, directly from recall, into the same shape
`verification-brief.md` renders (`### The ask` / `### What shipped` / `### Confirmed` / `###
Observation plan` / `### Try it`):

- **The ask** — what was actually requested in this conversation, for this unit of work.
- **What shipped** — what was actually implemented, from recall.
- **Confirmed** — whatever was actually verified this session (a live browser walk, test runs,
  manual checks), described plainly, including what wasn't checked — not a checklist pretending
  completeness.
- **Observation plan** — compose the `### Observation plan` section directly from recall, per
  `_shared/observation-plan.md`'s schema, grammar, and per-kind semantics — picking the
  Surface kind by builder judgment from what this session actually did, never from a classifier.
  First recall which paths this unit of work actually touched this session — unlike the
  record-backed path there is no `{base}...HEAD` range to diff here (session-recall work rarely
  sits on a dedicated branch, and may be interleaved with unrelated commits in the same session),
  so this path list comes from the session's own memory of what it edited or created, not a git
  command.

  **If that recall yields no path list** — nothing was touched, or recall can't confidently name
  what was, or nothing about it resolves a confident Surface/Entry point — omit the Observation
  plan section entirely and compose the brief without it, straight to Step 2's verdict. Do not
  compose a plan from an empty or invented path list: an unconfident guess reads as authored
  evidence, which is worse than no section at all. This is the same omission rule that already
  applied under the pre-schema brief format (what was then called "See it yourself"), restated
  here for the Observation plan schema.
- **Try it** — compose the block from recall per `_shared/try-it.md` (its Sources and Rules; the Entry point from the Observation plan just composed). When the omission rule above dropped that plan, take the Entry point from what recall says shipped; when recall cannot name one there either, omit the Try it block by the same rule — an invented entry point is the same unconfident guess — and say so in one plain line where the block would render.

This path has no fetch step — there is no comment or record body to read from. A fresh `/claude-tweaks:demo`
session with no memory of any unrecorded work naturally finds nothing here; that's expected, not
a bug (session-recall never discovers *other* sessions' unrecorded work). Report "Nothing
awaiting sign-off." and stop — do not call `AskUserQuestion` — when recall finds nothing.

Almost always this yields exactly one candidate — skip straight to Step 2 with it. On the rare
occasion this session did 2+ genuinely distinct, uncorrelated units of work, walk each through
Step 2 in sequence — no batch table, no bulk-decision question, since session-recall entries
never carry the `risk:*`/`size:*` data a pre-fill would need.

## `#N` given: single-record lookup

**`work-backend: github-issues`:**

```bash
gh issue view {n} --json number,title,body,labels,url,state
```

If the result carries the `demo:pending` label, fetch its Verification Brief: the last issue
comment **containing** `## Verification Brief`. Fetch every comment (`gh issue view {n} --json
comments`) and take the last one carrying that heading — test the heading, never assume the
position. A `.comments[-1]` shortcut holds only when the brief happens to be the most recent
comment, which nothing about the record predicts: any later reply or bot notification displaces
it, and a decomposition parent whose gate was completed by the Parent-Gate Procedure's
already-posted-brief branch (`wrap-up/verification-brief.md`'s **Apply the gate**) received its
label with no comment posted at all, leaving its brief arbitrarily far from last. Count only a
comment from a trusted author (`_shared/pr-run-comments.md`'s Trusted authors — `gh issue view
--json comments` returns `authorAssociation`); an untrusted comment carrying the heading reads as
no matching comment, and each one skipped is named in that section's skip notice, one line above
the verdict. Go straight to Step 2 with it.

**Under `pr-first` the brief lives on the PR** (`wrap-up/verification-brief.md` Step 4's `pr`
object present branch), and the issue carries only the unmarkered pointer line `Verification Brief
posted to PR #{pr-number}: {pr-url}`. When no issue comment carries the heading but one carries
that pointer, take `{pr-number}` from the last such comment — counting only Trusted authors' comments,
with the skip notice, as above — and run the **PR run-comment lookup** below for its `brief` comment —
that comment, minus its marker line, is the Verification Brief; go
straight to Step 2 with it. A lookup that finds no `brief` comment, or fails, falls through to the
closing-commit recovery below, as the no-heading case does.

**No comment anywhere carries the heading or the pointer** (`#205`): the label write landed but the brief post
did not — a near-unreachable state, since every acceptance-labeling path posts the comment before
the label (`verification-brief.md`'s Step 4, `verification-brief-parent-gate.md`'s Apply the
gate), but not one this lookup should treat as an error. Fall through to the closing-commit
recovery below exactly as the label-absent case does — do not surface this as a failure just
because the label happens to be present.

This `#N` may itself be a decomposition parent gated by the Parent-Gate Procedure
(`wrap-up/verification-brief.md`) rather than a single build, in which case its Verification
Brief covers the whole parent issue's primary path rather than one diff, but resolves and renders
through this same branch exactly like any other label-backed entry. Two things can have applied
that gate: `/claude-tweaks:wrap-up`'s own eager path (closing the parent's last sub-issue), or `/claude-tweaks:tidy`'s
`Open parent gate` action backstopping a parent issue that missed it (surfaced by
`_shared/github-pr-scan-acceptance.md`'s `parent-gate` scope under `work-backend: github-issues`, or by
`tidy/step-1-records.md`'s Shape 7 under `local-files`) — all of them write the identical
`demo:pending` + brief, so this branch never needs to know or care which one ran.

If the result does **not** carry `demo:pending` (e.g. it was built ad hoc in some other session
and closed by a `Fixes #N` commit, never reaching `/claude-tweaks:wrap-up`'s Phase 4 execution step
— **or it reached Phase 4 and simply didn't clear the oversight floor, per `#367`** — a normal,
common case now, not an anomaly), recover that **closing
commit** before reaching for session recall. This is the population `/claude-tweaks:tidy`'s
`acceptance-gap` sweep surfaces — its `github-pr-scan-acceptance.md` scope under `work-backend:
github-issues`, `tidy/step-1-records.md`'s Shape 8 under `local-files` — and it is by construction
*other* sessions' work. Recall will have nothing, but the commit that closed the record is still
on disk, and this recovery reads git rather than the backend, so it is identical on both drivers:

```bash
git log --perl-regexp -i \
  --grep='(?m)\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#{n}(?!\d)(\s*,\s*(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d+(?!\d))*\s*$' \
  --max-count=1 --format='%H' origin/main HEAD
```

Search `origin/main` and `HEAD` together, and nothing wider. A closing keyword only closes a
record once its commit reaches the **default branch**, so that ref is where the closure actually
happened; `HEAD` additionally covers a close made on the current branch that has not been pushed
yet. `--all` would sweep abandoned and unmerged branches, whose commits closed nothing — a brief
built from one of those would describe work that never shipped. Substitute the repo's own default
branch when it is not `main`, drop `origin/` when there is no remote, and `git fetch origin` first
if the remote-tracking ref may be behind.

`--grep` searches the whole commit message with no positional restriction, so prose that merely
quotes a closing phrase — a commit *documenting* the convention rather than invoking it — satisfies
a bare keyword-plus-ref match exactly as well as a real closer, and because `--max-count=1` returns
the newest hit first, one illustrative quote permanently shadows the true closer for as long as it
stays the newest match. A real GitHub closer is structural, not buried mid-sentence: it ends the
commit subject (`… — closes #144`) or stands alone as a body line (`Fixes #14`); prose quoting the
same phrase has more sentence after it on the same line. The `(?!\d)` lookahead is the same
digit-boundary guard the original pattern had (keeps `#14` from matching inside `#141`). The new
part is `(?m)…\s*$` plus the optional `, keyword #M` repeat group: the match must reach the end of
a line, with nothing but whitespace or further comma-joined closing references in between — so a
ref followed by a closing quote and more sentence fails to match, while `closes #138, closes #139`
still resolves each of its two refs. `--perl-regexp` is what makes `(?m)`, the lookahead, and the
repeat group available; it is not reused from `bin/lib/hooks/post-tool-use.js`'s own closing-keyword
matcher (`checkClosingKeyword`) — that check only tests whether a keyword immediately precedes a
ref, with no line-position anchor at all, because a false positive there just skips a non-blocking
warning. Here a false positive silently returns the *wrong* commit, so the anchor is load-bearing
and new. The keyword vocabulary itself is unchanged and still mirrors `ISSUE_REF_SOURCE`
(`bin/lib/issue-branch-tracking.js`) so the two can't drift on which keywords GitHub recognizes.

**Found** — one command reads both halves of the brief:

```bash
git show --name-only --first-parent --format='%H%n%s%n%n%b' {sha}
```

(`--first-parent` so a merge commit lists its files rather than nothing.) Compose the brief in the
same shape as the no-arguments path, sourced like this:

- **The ask** — the record's own title and body, from the `gh issue view` above. The commit
  subject says what shipped, not what was asked for.
- **What shipped** — the commit subject and body, plus its changed-path list.
- **Confirmed** — this brief is a **reconstruction**: it was composed after the fact from a
  commit, by an agent that did not watch the work run. Open the section by saying exactly that,
  then report only what the commit itself evidences — verification its own message claims, and
  the test files in its path list. Assert nothing past that boundary. The standing `### Confirmed`
  rule binds harder here, not less: describe what was actually verified, including what wasn't
  checked, never a checklist pretending completeness.
- **Observation plan** — run the commit's changed-path list through `verificationSurface`
  (`bin/lib/issues/acceptance.js`) as the floor classification, then compose the `### Observation
  plan` section per `_shared/observation-plan.md`'s schema from what it returns: `interactive`
  → compose a best-effort `app-route` plan, resolving the entry point via
  `_shared/dev-url-detection.md`. `non-interactive` → compose the manual steps exactly as
  before — concrete commands, file paths, or behavior the commit's own message or path list
  evidences — presented as a `cli` plan when those steps name a runnable command, else a `diff`
  plan (Entry point: `{sha}^..{sha}`). That changed-path list is a real `git` result here, so the
  "recall can't produce a path list" omission case does not arise. **Parent-linked records:** also
  run the Full verification pointer sub-procedure below, and append its block to the composed plan
  when it resolves one.
- **Try it** — a below-floor record or a parent-linked sub-issue had its walkthrough posted alone,
  as its PR's `<!-- run-comment: try-it -->` (or `try-it:{n}`) comment: run the **PR run-comment
  lookup** below against the record's closing PR first, and render what it returns verbatim — the
  same text the Pipeline Summary and the PR showed. Only when it returns nothing, compose the block
  per `_shared/try-it.md` from the record's Acceptance Criteria and the Observation plan's Entry
  point; a reconstruction asserts nothing past what the commit shows.

Go to Step 2 with it.

**Not found** — fall back to session-recall for this specific `#N`: does this conversation have
memory of building and/or verifying it? If yes, compose a Verification Brief exactly as the
no-arguments path does above, scoped to this one record — also running the Full verification
pointer sub-procedure below and appending its block when it resolves one — and go straight to
Step 2. If this session has no memory of it either, report plainly: "`#N` has no Verification
Brief, no closing commit in git history, and no memory in this session — nothing to show." and
stop.

**When the no-arguments path's omission rule fires here** (recall yields no confident path list)
**but** the Full verification pointer sub-procedure below resolves a block, do not drop the block
along with the rest of the plan: render an `### Observation plan` section carrying only the `Full
verification:` block — no Surface, Entry point, Prepare, or Inspect. The omission rule exists to
stop this path from inventing evidence for a Surface/Entry point/Prepare/Inspect the session
doesn't actually have; the Full verification pointer isn't invented in that sense — it comes from
live parent/sibling API state read at demo time, not from recall, so the reason to omit it never
applies to this block specifically.

**`work-backend: local-files`:** `readRecord(filePath)` for the single record
(`bin/lib/issues/local-store.js`); the Verification Brief is the record's own `## Verification
Brief` body section. Same `demo:pending` → closing-commit → session-recall fallback order as
above, keyed on `facets.acceptance === 'pending'` instead of the label. The closing-commit step is
identical — it reads git, not the backend, so a local record closed by a `Fixes #N` commit
reconstructs the same way.

### PR run-comment lookup (`pr-first` records)

Cited by the `demo:pending` pointer case and the closing-commit reconstruction's Try it step, both
above — stated once, run from either. `work-backend: github-issues` only; a `local-files` record
has no PR and skips it.

1. **Resolve the PR.** The pointer case already holds `{pr-number}`. Otherwise read the record's
   closing PR from the issue side — `gh issue view {n} --json closedByPullRequestsReferences`, the
   native field `tidy/issue-claims-backstops.md`'s parked-restoration backstop already reads. It
   lists only PRs whose body carries a closing keyword; empty → nothing to read. More than one →
   use the one step 2 reports `"state": "MERGED"`; several merged → the last in the list; none
   merged → nothing to read, since no unmerged PR delivered the record.
2. **Read its comments by marker** — `_shared/pr-run-comments.md`'s Find step (its `{host}/{owner}/{repo}`
   resolution, `gh pr view {pr-number} --repo {host}/{owner}/{repo} --json state,comments`, first-line
   `startswith` marker test — the same PR read `bin/lib/wrap-up/engine-verify.js`'s
   acceptance-labeling check runs on a pointer), selecting comment bodies rather than ids and only
   from trusted authors (that file's Trusted authors; an untrusted marker comment reads as no
   matching comment, and the skipped marker comment is named in its skip notice, one line above the
   verdict, the shape step 3 uses for a failed lookup):
   - **Try it** — `<!-- run-comment: try-it:{n} -->` (a multi-spec run), else
     `<!-- run-comment: try-it -->`, else the `### Try it` section of the
     `<!-- run-comment: brief:{n} -->` comment (a multi-spec run, this record's own), else of the
     `<!-- run-comment: brief -->` comment.
   - **Brief** (pointer case only) — `<!-- run-comment: brief:{n} -->` (a multi-spec run, this
     record's own), else `<!-- run-comment: brief -->` (single-spec, or a brief posted before
     #3333), that also carries `### Confirmed` — `engine-verify.js`'s own read order and test; a
     sibling's `brief:{m}` never counts.

   Two comments of one kind → take the one whose second line reads `Supersedes {url}` naming the
   other: the MCP transport cannot edit, so its newer post is the current one
   (`_shared/pr-run-comments.md`'s **MCP transport**). With no such line, the pair is the Find
   step's race case — take the **first**, as that step does. Drop the marker line, and a
   `Supersedes …` line after it, and use the rest verbatim.
3. **Fail open, visibly.** No PR, or no matching comment, returns nothing and the caller's own
   fallback runs. A `gh` failure in step 1 or 2 does the same and also states so in one plain line
   above the verdict, naming which lookup failed — never a silent omission.

### Full verification pointer (parent-linked records)

Cited by both the closing-commit reconstruction's Observation plan step and the `#N`-scoped
session-recall fallback, both above — stated once, run from either.

1. **Resolve the parent** — the same resolution `review/cross-spec-promise-check.md` uses:
   `work-backend: local-files` → `facets.parent`; `github-issues` + `work-links: body-text` →
   this record's own `Parent: #N` body line; `github-issues` + `work-links: native` → one
   `buildNativeParentQuery([n])` call (`bin/lib/issues/record.js`), run via
   `gh api graphql -f owner="{owner}" -f repo="{repo}" -f query="$(node -e "…buildNativeParentQuery([n])…")"`
   — `-f` for `owner`/`repo` here, not `-F`: both are `String!` GraphQL variables. `-F` is for
   substituting gh's literal `{owner}`/`{repo}` placeholder syntax inside a field *value* — a
   different mechanism a GraphQL variable never uses (`gh-api-module-pattern` skill). **No parent
   resolvable** — omit the block entirely; nothing renders.
2. **Enumerate siblings and their state**, from the parent side — reusing
   `wrap-up/verification-brief-parent-gate.md`'s "Enumerate the parent's sub-issues"
   enumeration: `native` — `gh api "repos/{owner}/{repo}/issues/$PARENT_NUM/sub_issues"`, whose
   response already carries every sibling's `number`, `title`, and `state`, so no per-sibling
   fetch is needed here (normalize its lowercase `open`/`closed` to `OPEN`/`CLOSED` —
   `_shared/github-pr-scan-acceptance.md`); `body-text` — one `gh issue view {n} --json
   state,title` per `parseSubIssues` number; `local-files` — the `queryRecords` result already
   carries `facets.closed` and the title. This enumeration is the parent's **full** sub-issue
   list, the record in hand included — do not filter it down yet. Also fetch the parent's labels
   (`gh issue view $PARENT_NUM --json labels`, or the parent record's `facets.acceptance`).

   Two different lists are then in play, built from this same enumeration for two different
   purposes: `Pending:` (Step 3 below) is built with the record in hand **excluded** — it never
   lists itself as pending. `parentGateState({subIssues, parentLabels})`
   (`bin/lib/issues/acceptance.js`) must instead be called with the **full** list, record in hand
   **included**: it returns `'due'` only when every sub-issue in the list it's given is `CLOSED`,
   so calling it with the record-in-hand excluded would wrongly report `due` whenever every
   *other* sibling has closed but the record in hand is itself still open — a real case (a
   session-recall entry may run on one still-open record). Bounded by decomposition size —
   `/specify`'s sizing keeps a parent to a handful of sub-issues, so nothing here paginates or
   fans out.
3. **Compose the block** per `_shared/observation-plan.md`'s schema and grammar rules.
4. **Extend `### Confirmed`** with one sentence — end-to-end behavior was not observable at this
   slice; see the plan's Full verification block — in whichever composer produced this brief:
   the reconstruction's opening reconstruction sentence above, or the no-arguments path's
   `### Confirmed` bullet above, which the `#N`-scoped session-recall fallback reuses.

**Fail open, visibly.** Any `gh` failure in steps 1-2 above omits the block and states so in
one plain line above the verdict, naming which lookup failed — never a silent omission. `/demo`
has no run directory and no `decisions.md`, so this one line is the only trace.
