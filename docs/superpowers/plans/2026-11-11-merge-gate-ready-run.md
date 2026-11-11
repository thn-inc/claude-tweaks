# Merge gate waits for the ready-for-review run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pr-first merge gate stops reading draft-time results as green. It waits for the CI run that `gh pr ready` starts, and it parks a PR whose CI skips drafts but has no `ready_for_review` trigger. A shipped "CI skips draft PRs" convention documents the supported setup.

**Architecture:** There are three code layers and one prose layer.
- `merge-verification.js` gains a line-based workflow reader that returns trigger `types`, a draft reference and an `unparsed` signal.
- `classify.js` gains a pure ready-run rule, `readyRunVerdict`, and two optional `classifyRollup` inputs.
- A new reader, `lib/pr-checks/ready-run.js`, and a new status-as-data CLI, `bin/ready-run.js`, do the reads. The reads are the PR timeline's last `ReadyForReviewEvent`, the REST runs listing with `created_at`/`event`/`path`, and the workflow files at `{headRefOid}` from the local object store. The CLI then classifies them with that rule.
- `pr-checks.js` feeds the same inputs to `classifyRollup`, so `/test`'s gate stays in step.

The prose layer is `_shared/pr-first-merge.md` Step 2.5. It calls the CLI once before classifying and again inside the bounded watch's `0)` branch. Its existing `gh run list` read stays byte-identical. Dispatch close-out and the resume confirmation make the same read. Rationale blocks move to the appendix first, to pay for the new prose in the `merge` composed bundle.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh api` (GraphQL + REST), git plumbing (`ls-tree -z`, `cat-file blob`), bash/zsh fences in skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-11T005324-spec-5153/work/5153-spec.md`

Scope keywords: classifyRollup, readyRunVerdict, readySince, readyWorkflows, awaitingReadyRun, draft-skip-without-ready-trigger, ready-run.js, readPullRequestWorkflow, readyRequirement, workflowHasPullRequestTrigger, ReadyForReviewEvent, ready_for_review, ci-skips-drafts

## Global Constraints

**Spec values (verbatim):**
- New classifier inputs: `readySince` ("the `createdAt` of the PR's latest `ReadyForReviewEvent`") and `readyWorkflows` ("the PR-triggered workflows that declare `ready_for_review` in their `types`"). "Both inputs absent means today's behaviour, byte for byte." "Red still wins over pending."
- Matching rule: "each workflow in `readyWorkflows` must have a head run with a `pull_request`/`pull_request_target` event created at or after `readySince`. Until one exists the verdict is **pending**, with the missing workflows named (`awaitingReadyRun`)."
- New Red-path reason: `draft-skip-without-ready-trigger`, "naming the workflow file and the one-line fix (add `ready_for_review` to `types`)". "Under an explicit `off` it is logged, not acted on."
- `unparsed` "resolves conservatively: the workflow is treated as requiring a ready run, and the requirement is named in the park reason if it is never met. It is never silently read as 'no requirement'."
- Ready timestamp: from the PR timeline, last `ReadyForReviewEvent`. "If there is no such event, the PR was never a draft, so the requirement does not apply. A failed read is `state-read-failed`, never 'no requirement'." "Always take the last one."
- Workflow identity: "Match head runs to workflows by the workflow file path, not the display name." This plan uses the REST runs listing's `path` field.
- "Do not change the fixed 15-minute bounded watch." The literal `DEADLINE=$(( $(date +%s) + 900 ))` and the heading's "— 15 minutes, fixed." stay byte-identical.
- Out of scope: `_shared/github-pr-scan.md`'s `NON_BLOCKING` set and `/tidy`'s Arm-ready-PR reuse. Detecting a `ci` declaration that conflicts with a draft skip is #5154's.

**Live probes run while authoring (2026-11-11, read-only; Verbatim-command run-once check):**
- `gh api graphql -f owner=thn-inc -f name=claude-tweaks -F number=5156 -f query='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){timelineItems(itemTypes:[READY_FOR_REVIEW_EVENT],last:1){nodes{...on ReadyForReviewEvent{createdAt}}}}}}'` printed `{"data":{"repository":{"pullRequest":{"timelineItems":{"nodes":[{"createdAt":"2026-11-11T00:45:28Z"}]}}}}}`. The same query for never-draft PR #5132 printed `"nodes":[]`. An unknown number (5152 is an issue) exits 1 with `"pullRequest":null` and `errors[].type NOT_FOUND`.
- `gh api "repos/{owner}/{repo}/actions/runs?head_sha=95d5d61553092f53f7ef72e322dfeb8d312b507b&per_page=100"` (PR #5156's head) printed 2 `workflow_runs`. The `test` run had `"path":".github/workflows/test.yml"`, `"event":"pull_request"` and `"created_at":"2026-11-11T00:29:06Z"`; the push run had `"path":".github/workflows/track-issue-fixes.yml"`. No `@ref` suffix appeared. The payload is 25,171 B for 2 runs, about 12.5 KB per run, so a 100-run page exceeds `execFileSync`'s 1 MiB default `maxBuffer`.
- Empty-value probe: `gh api "repos/{owner}/{repo}/actions/runs?head_sha=&per_page=1" --jq .total_count` printed `2500`. An empty sha widens the query to every run, so the CLI rejects any `--sha` that is not 40 lowercase hex with exit 2.
- `git ls-tree --name-only 18c73c625 -- .github/workflows/` listed the 8 workflow files. An absent commit (`1111…1111`) exits 128 with `fatal: not a tree object`.
- Not probed live, from GitHub's documented behaviour (research file, `#5153` verification): a `ready_for_review` run carries `event: pull_request`, and a re-run keeps its original `created_at`. AC1.3's fixture encodes the second. These are a stated risk, not verified coverage (Blocking-verification-downgrade check).

**Governing project skills: rules quoted verbatim.**

`gh-api-module-pattern` (`SKILL.md`, `cli-wrapper-contract.md`, `status-as-data.md`, `batching-failure-posture.md`). Applies to Tasks 3 and 4:
- "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.** […] A spread — `{ ...QUIET, timeout }` with the flag inside `QUIET` — satisfies neither and fails the full suite"
- "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.** […] Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it"
- "**Bound every remote-contacting call on the seam; a local-only call owes no bound.** […] **`GH_TIMEOUT_MS` is a resolved value, not a literal — import it, never retype its default at a new call site.**"
- "**A read whose output scales with a range the module does not bound owes `maxBuffer: LARGE_MAX_BUFFER_BYTES` too, not only a push.**"
- "**An argv array stops shell injection, not flag injection.** […] For `git` the separator is **`--end-of-options`, not `--`**"
- "**A `git` path-list read also needs `-z`.** An argv that asks git for a path list (`--name-only` / `--name-status`, `ls-files`, `ls-tree`, `--numstat`, `status --porcelain`) passes `-z` and splits on NUL via `plugin/bin/lib/git-z.js`, besides `--end-of-options` before any ref."
- The three `gh api` value mechanisms table: "| An **already-resolved** string bound to a GraphQL `String!` variable | `-f` | `-F` type-coerces an all-numeric name (`2048`) to an Int and GraphQL rejects it (#610) |", and "`gh api graphql` is where two of these rows collide: a `String!` variable needs `-f`, and `-f` never expands `{owner}`/`{repo}`, so the placeholder mechanism is unavailable to a GraphQL variable. Resolve the slug locally instead — `plugin/bin/lib/hooks/git-exec.js`'s `repoTargetOf` […] and pass it split as `-f owner=…`/`-f name=…`."
- "**Any `-f`/`-F` field flips `gh api`'s default method from `GET` to `POST`.** […] `per_page` goes in the path, never in `-f`"
- "**Relay-style cursor pagination direction is a footgun** […] `first:N` fetches the OLDEST N nodes; `last:N` fetches the NEWEST N"
- "**A paged REST list that reports `total_count` is whole only when one page holds it all — paginate, or compare and fail closed.**"
- "**A run list for one sha is a history, not a state — keep each workflow's newest run before reading a failure as current.**"
- "**A single GraphQL query that errors exits non-zero, but its body is still on stdout — classify absence from that body, never from stderr.**"
- "Logic lives in an exported `run(argv, deps)`; every side effect […] goes through `deps` so tests inject fakes. **Every** `deps` call that can throw […] is try/caught into the documented exit-code contract"
- "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
- "**A read-only *status* verb is status-as-data: it exits 0 in every state, and the JSON on stdout is the answer.** […] malformed invocation of the status verb still throws into the vocabulary's usage code" and "(a) The `reason` enum is exported and frozen"
- "**A value-taking flag given as the last argv element reads `undefined`** […] pin both the trailing bare flag and the empty-string value with their own test cases."
- "Tests never touch real `gh`: fake runners branch on the `args` shape […] and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled […] Record values inside the runner, assert after it returns"
- "**A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too.** […] add the fake to every consuming test's deps object in the same commit."
- "**A CLI whose result an in-process caller consumes as data splits into a core that returns an object and a `run` that only prints it.**"

`parse-signal-discipline`. Applies to Tasks 1, 2 and 3:
- "**Give 'couldn't parse' its own return shape**, distinguishable at the type level from 'doesn't apply' […] Never reuse the same `null`/`undefined`/`[]` for both."
- "**A comparison between two fallibly-read values owes the 'couldn't read' guard on every operand, not just one.** […] pin the one-side-unreadable case with its own test assertion"
- "Pin each invalid input with its own assertion: `NaN`, `undefined` and `null` all slip past a `>=` comparison."
- "**A shell-out check owes a branch on the exit code when the tool's 'no result' and 'could not run' both print nothing.**"
- "**A positive recogniser owes a whole-input match, not a prefix match.** […] pin a truncated copy and a tail-carrying copy of an accepted input with their own assertions."
- "**An unanchored extractor with a narrow character class truncates instead of failing** […] pin two inputs that differ only in the part it would drop"
- "**A lenient reader in front of a strict validator turns 'couldn't parse' into 'not configured'.**"
- "**An all-of guard passes vacuously on an empty set** […] state the empty-set answer and make it the fail-closed one"
- "Key the check on whether the gated row is present, never on whether its context arrived. […] pin a partial context (one of two required keys) with its own assertion"
- "Decide a read failure in the caller that attempted the read, never inside the pure classifier"

`windows-checkout-test-parity`. Applies to every test task:
- "When code parses text it reads from a tracked file (a workflow, a skill's markdown, a decisions log), add a CRLF case beside the LF one. Build it from the same string with `.replace(/\n/g, '\r\n')` […] `pack.js`'s `ON_LINE_RE` […] never matched `on:\r`"
- "A test reads a tracked text file through `tests/helpers/read-skill.js`'s `readText`, never a raw `fs.readFileSync(p, 'utf8')`"
- "| Passing a POSIX literal such as `'/tmp'` as a spawn `cwd` or `repoRoot` | […] Take a real directory from the OS: `os.tmpdir()` (#3506)."
- "A path the code shows or compares as an ID […] is a repo-display ID and uses `/` on every OS."

`skill-prose-conformance-tests`. Applies to Tasks 5–9:
- "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
- "Slice with `tests/helpers/conformance-asserts.js`'s `sectionOf(text, '## Heading')` and `lineStartingWith(text, prefix)`"
- "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** […] preceded by `assert.notEqual(mutated, original)`"
- "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** […] `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`)"
- "Build the control by **permutation, not deletion**: take the live text, splice the later block above the earlier one, and assert the same helper *throws* on the permuted string — one `assert.throws` per ordered pair"
- "Extract the fence from the doc with a structurally-anchored regex and execute exactly that string"
- "**Run a snippet the Bash tool executes under both `bash --noprofile --norc` and `zsh -f`.** […] Skip the zsh case with a visible reason when zsh is not on PATH, never silently"
- "**A fence that calls `gh` runs against a shell-function stub, not a PATH shim.**" and "**A `node -e` fence that spawns a plugin CLI runs against a stub CLI, with the plugin root passed through the environment.**"
- "**A go-red control for a fence that branches on a `node -e` exit status has to flip that exit outcome.**"
- "Put that suite [`tests/skill-fence-guard-shapes.test.js`] in the targeted set for any change that adds or edits a fence"
- "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.**"
- "**The silent direction: new prose inside another suite's slice.** […] keep the new text outside the slice, or re-prove that suite's go-red controls on the edited slice."
- "Pinning a skill file's size against a byte literal […] Import `RAIL_BYTES` from `budgets.js`". This plan adds no size assertion. The `rail:` suites (`tests/wrap-up-merge-mode-conformance.test.js:378`, skill-audit `rail.js`) already hold the bundle.

`prose-code-twin-pin`. Applies to Tasks 3 and 7:
- "a status-as-data CLI's `state` vocabulary is closed, but left alone its code side is no constant […] export them as a frozen `STATES`, which its own `USAGE` is built from […] `deepEqual`s the list against the state words parsed from the routing bullets"
- "Accepting a citation-sweep test (a plain string `includes()`) as equivalent to a vocabulary-equality pin | […] only a full `assert.deepEqual` over both sides (imported, or parsed from prose) catches that"
- "Writing a pinning test that only checks one direction […] | Assert set equality both ways"

`shared-contract-extraction`. Applies to Tasks 5 and 6:
- "**Update the edges, once.** […] A new `_shared` file means adding its consumer edges there and adding nothing to any `SKILL.md`'s relationship prose."
- "**A new `_shared/*.md` file's `docs/skill-graph.md` edge is mandatory; a `docs/plugin-structure.md` mention is a judgment call**". Ruling: no `plugin-structure.md` row for `ci-skips-drafts.md`. That doc carries one curated row for `_shared/`, not a per-file table.
- "**A pointer stub's read condition must cover every path that used to fall through to the moved text.**" Every stub this plan writes is unconditional ("…: `pr-first-merge-appendix.md`'s "{section}"").
- "Measure every composed bundle a touched file is a source of as well, not only the file's own `wc -c`".

**Source-scan suites the new `plugin/bin` files must satisfy (Source-scan lint check):**
- `tests/windows-hide-spawn-conformance.test.js`: `windowsHide: true` as a literal key in every spawn's options.
- `tests/gh-host-seam-conformance.test.js`: every `gh` spawn goes through `ghOptions(args, {…})`. Do not call `gateOriginRepo(` or `parseRepo`. Use `repoTargetOf`, as `bin/lib/reconcile/pr-state.js:177` does.
- `tests/bin-lib/exit-code-conformance.test.js`: `process.exitCode = run(...)` under `require.main === module`, never `process.exit`.
- `tests/git-path-read-conformance.test.js`: `ls-tree` carries `-z` and `--end-of-options` on the same argv line.
- `tests/path-guard-conformance.test.js`: zero `existsSync`/`realpathSync` tokens. `tests/bin-lib/repo-resolve.test.js:116`: never write `'--version'`; call `ghAvailable()`.
- `tests/helpers-strip-comments.test.js`: no regex literal right after `)` or `}`. `tests/payload-boundary.test.js`: string-literal relative requires only.

**Composed-bundle rail (Byte-pin check).** Measured 2026-11-11 with `node plugin/bin/context-cost-report.js --plugin-root plugin`:
- The `merge` bundle (`pr-first-merge.md` + `pr-checklist-refresh.md`, `bin/lib/compose-context/phases.js:26`) composes to **52,498 B**, against `RAIL_BYTES` 52,500. That leaves 2 B.
- Every byte added to `pr-first-merge.md` must first be paid for. Task 5 moves rationale blocks to `pr-first-merge-appendix.md`, which is in no bundle.
- A scratch simulation of this plan's exact moves and inserts, plan-review amendments included, gives 49,001 after Task 5, 50,407 after Task 7 and 51,320 after Task 8.
- Gates:
  - After Task 5, merge max ≤ 49,400 B.
  - After Task 7, merge max ≤ 50,600 B.
  - After Task 8, merge max ≤ 51,500 B, which keeps ≥ 1,000 B of headroom for the neighbouring #5106 and #3467.
- On a miss, trim this plan's own new prose. Never cut existing operative text.

Waived plugin/skills/_shared/github-pr-scan.md: out of scope per the spec's Gotchas (`NON_BLOCKING` reuse). Task 6's convention states the pending-status pattern that covers it.

**Behavior-change prose sweep, no-change classifications.** These come from `git grep -n -i -e "both of Step 2.5" -e "Step 2.5's head-run" -e "Step 2.5's state read" -e "head-run read" -e "both reads" -- plugin docs .claude/skills`, plus plan-audit Check B's keyword walk. Each hit that no task edits is listed here with its reason:
- `plugin/skills/tidy/actions-github-issues.md:131`: `/tidy`'s Arm-ready-PR reuse is out of scope per the spec's Gotchas. Its `gh run list` re-verify stays, as `tests/merge-verification-gate-conformance.test.js` pins it.
- `plugin/skills/release/execute.md:134-140`: release-please PRs are opened ready, so they carry no `ReadyForReviewEvent`, and the ready-run read is `not-applicable`. Its restated read list stays accurate.
- `plugin/skills/dispatch/close-out-update.md:134`: the post-push watch re-enters Step 2.5's head-run read on an already-ready PR. The new head's `synchronize` runs postdate `readySince`.
- `plugin/skills/wrap-up/merge-mode.md:50`: the `CLEAN` branch re-enters Step 2.5 from the top, so it inherits the ready-run read.
- `plugin/skills/wrap-up/review-console-interactive.md:42` and `plugin/bin/lib/wrap-up/pack.js:715`: their CI verdict comes from `bin/pr-checks.js --pr`, which Task 4 updates. `pack.js` reads `state`/`failing`/`pending`, so the added optional `awaitingReadyRun` key is ignored.
- `tests/bin-lib/console/backfill.test.js:87`: the Check B `classifyRollup` hit is a quoted decision-log line inside a fixture string, not a reader of the classifier.
- `plugin/skills/_shared/github-pr-scan.md` item 9 also gates on `pr-checks.js --pr` (`tests/display-ci-readers-conformance.test.js:96`). With Task 4 the outcome depends on the PR:
  - A PR that was undrafted and whose ready workflow has not run since reads `pending`. That is stricter, not looser, and this plan accepts it.
  - A PR that was never a draft, or is still a draft, has no `ReadyForReviewEvent`. The reader stops after the timeline read and touches no workflow file, so its verdict is unchanged, even when the session's clone lacks the PR head's objects (plan review, amendment 3).
  - An undrafted PR whose head is not local is read through the contents API at that ref. It is `read-failed` only when both sources fail.
- `plugin/bin/lib/verify/ci-source.js`: the coexistence ruling is prose (Task 6), and conflict detection is #5154's.
- Check B keyword hits with no behavior to change:
  - `CHANGELOG.md` and `docs/superpowers/plans/2026-10-31-derived-off-pending-wait-4550.md`: history.
  - `tests/bin-lib/console/backfill.test.js:87`: `classifyRollup` inside a decisions-log string fixture.
  - `tests/session-tmp-root-migration.test.js`, `tests/wrap-up-merge-mode-conformance.test.js` and `tests/wrap-up-leave-open-mergeability-conformance.test.js`: run as targeted suites, not modified.

## Design decisions against the spec's text

- **The head-runs read stays byte-identical, and a new read is added beside it.** Deliverable 4 asks for `createdAt,event` plus workflow identity on the head-runs read. This plan keeps Step 2.5's `gh run list … --json name,workflowName,status,conclusion,url` unchanged, together with its pins and its restatements in `release/execute.md`, `resume-confirmation.md`, `close-out.md` and `tidy/actions-github-issues.md`. It adds `bin/ready-run.js`, whose own REST read carries `created_at`/`event`/`path`. `gh run list` has no workflow path field. Comparing ISO timestamps across up to 100 runs is code's job, not prose's. The CLI is also what the shell loop needs.
- **A ready workflow is `met` only when its newest post-ready run has completed without failing.** Existence alone is not enough. The CLI's REST snapshot is taken after the prose's `gh run list` snapshot, so a run that appears between the two reads must still hold the merge. `classifyRollup` keeps the spec's existence rule (`awaitingReadyRun`), because there the post-ready run sits in the same `headRuns` the general pending/red rules read.
- **Workflow files come from git objects at `{headRefOid}`, else the contents API at that ref, and only once a ready event exists.** Git objects yield the same bytes as the worktree when its HEAD is `headRefOid`, which Step 2.5 already relies on. Linked worktrees share one object store, so dispatch close-out can run from the main checkout. The timeline is read first, so with no ready event no workflow file is read at all. When the head object is absent, `gh api repos/{o}/{r}/contents/.github/workflows?ref={sha}` and per-file contents serve instead. Only both failing is `read-failed`, with a runnable `git fetch origin pull/{n}/head` (plan review, amendment 3).
- **A draft-skip workflow without `ready_for_review` parks only while it has no post-ready run.** This is Reading B, decided by the user and recorded in the spec's `## Plan Review Clarifications`. A later `synchronize` push that really runs CI clears it, and from then on it is judged like any ready workflow.
- **The GraphQL variables are `-f owner=… -f name=…` from `repoTargetOf`, plus `-F number=…`.** The spec's `…` left them open. This follows `bin/lib/reconcile/pr-state.js`'s precedent and gh-api-module-pattern's #610 rule.
- **`pr-checks.js` folds draft-skip workflows into `readyWorkflows`.** `/test`'s gate then reads them `pending` with no new state, so `_shared/pr-check-gate.md`'s routing and its "every state is routed" twin pin stay unchanged. Only the merge gate parks with the dedicated reason.

## Review Focus

- **A PR re-drafted and re-readied.** The Red path's label-failure fallback re-drafts, and a human later readies the PR again. Only runs after the *last* `ReadyForReviewEvent` count. Task 3 asserts the query carries `last:1`. Task 2 pins a run created between two ready events (before the last one) as not counted.
- **A workflow committed with CRLF line endings.** The `on:` reader must not read `pull_request:\r` as absent. Task 1 runs every reader case on an LF and a CRLF copy built from the same string.
- **A ready run slower than 15 minutes.** The watch must park with `checks-pending-timeout` and name the workflow still awaited, not merge. Task 8's executed loop test drives an `awaiting` CLI past the stubbed deadline and asserts `RC=124`.
- **A checkout without the PR head's objects** (close-out, or a `--pr` reader in another clone). With no ready event the verdict must be unchanged. With one, the requirement must still be read through the contents API, and the result is `read-failed` with a runnable remedy only when both sources fail. Task 3 pins all three cases (amendment 3 a/b/c), and Task 4 pins (a) and (c) through the CLI.
- **A numeric-only owner or repo name.** GraphQL `String!` variables must go in via `-f`, never `-F` (#610). Task 3 asserts the exact recorded argv: `-f owner=…`, `-f name=…`, `-F number=…`.

---

### Task 1: Workflow reader — trigger `types`, draft reference, `unparsed`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/merge-verification.js` (append after `hasPullRequestCi`, export alongside it; `workflowHasPullRequestTrigger` stays unchanged)
- Test: `tests/merge-verification.test.js` (append after the `readWorkflowFiles` test at :97)

**Interfaces:**
- Produces: `DEFAULT_PR_TYPES` = `Object.freeze(['opened', 'synchronize', 'reopened'])`.
- Produces: `readPullRequestWorkflow(text: string) -> { prTrigger: boolean, types: string[], typesDeclared: boolean, draftReference: boolean, unparsed: boolean }`. Notes:
  - `types` is the union of the effective types of every `pull_request`/`pull_request_target` trigger. An undeclared trigger contributes `DEFAULT_PR_TYPES`.
  - `typesDeclared` is true when any PR trigger declares `types:`.
  - `unparsed` is true when any PR trigger's `types:` value is present but unreadable. `types` then holds whatever was readable from the other triggers.
  - A non-string or empty input returns `{ prTrigger: false, types: [], typesDeclared: false, draftReference: false, unparsed: false }`.
- Produces: `readyRequirement(workflows: Array<{ file: string } & ReturnType<readPullRequestWorkflow>>) -> { readyWorkflows: string[], draftSkipWithoutReadyTrigger: string[], unparsed: string[] }`. It considers only `prTrigger` rows and keeps input order. The rules:
  - `unparsed` → `readyWorkflows` and `unparsed`.
  - `types` includes `'ready_for_review'` → `readyWorkflows`.
  - Otherwise, `draftReference` → `draftSkipWithoutReadyTrigger`.

- [ ] **Step 1: Write the failing tests** in `tests/merge-verification.test.js`. Each fixture runs through a shared `bothEndings(text, fn)` helper, which calls `fn(text)` and then `fn(text.replace(/\n/g, '\r\n'))` (the WCTP CRLF rule).
  - `test('AC5.1: readPullRequestWorkflow reads a flow-list types: [opened, ready_for_review]', …)`: block `on:` → `pull_request:` → `types: [opened, ready_for_review]` yields `types` `['opened','ready_for_review']` and `typesDeclared: true`. A second case uses `pull_request_target`.
  - `test('AC5.1: readPullRequestWorkflow reads a block-list types:', …)`: `types:` followed by `- opened` / `- ready_for_review` lines (and the indentless `types:\n- opened` form) yields the same two values. A quoted item `- 'ready_for_review'` reads the same.
  - `test('AC5.1: readPullRequestWorkflow reads a bare pull_request: as default types', …)`: three cases, `on:\n  pull_request:\n`, `on: [push, pull_request]` and `on: pull_request`. Each yields `types` deep-equal to `[...DEFAULT_PR_TYPES]`, `typesDeclared: false` and `prTrigger: true`. A `pull_request:` with only `branches:` beneath reads the same.
  - `test('AC5.2: readPullRequestWorkflow detects a draft reference in if: == false and ${{ !… }} forms', …)`:
    - A job line `    if: github.event.pull_request.draft == false` → `draftReference: true`.
    - `    if: ${{ !github.event.pull_request.draft }}` → `true`.
    - The same token only in a whole-line comment (`# github.event.pull_request.draft`) or a trailing ` # …` comment → `false`.
    - A lookalike `github.event.pull_request.drafted` → `false`, which pins the word boundary.
  - `test('AC5.3: readPullRequestWorkflow returns unparsed for a types: value it cannot read', …)`: three cases each return `unparsed: true`. They are an alias `types: *defaults`, an unclosed flow list `types: [opened,` with the rest on the next line, and an expression `types: ${{ fromJSON(x) }}`.
  - The recogniser tests (parse-signal item 6/25):
    - `types: [opened, ready_for_review_x]` does not count as `ready_for_review` (`readyRequirement` puts it in neither list when there is no draft ref).
    - `types: [ready_for_review]` does count.
  - `test('readPullRequestWorkflow: a push-only workflow has no PR trigger and is ignored by readyRequirement', …)`.
  - `test('readyRequirement: ready_for_review → readyWorkflows; unparsed → readyWorkflows and unparsed; draft ref without ready_for_review (default or declared types) → draftSkipWithoutReadyTrigger; ready_for_review without a draft ref still requires a ready run; neither → nothing', …)`: one assertion per row. The expected `file` strings are `.github/workflows/{name}` built with a `/` template.
  - `test('readPullRequestWorkflow: non-string or empty input is all-false, never throws', …)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "readPullRequestWorkflow|readyRequirement" tests/merge-verification.test.js`
Expected: FAIL after Step 1 — `mv.readPullRequestWorkflow is not a function`.

- [ ] **Step 3: Implement `readPullRequestWorkflow` and `readyRequirement` in `plugin/bin/lib/merge-verification.js`**

The reader stays line-based with no YAML library (the file header's rule). Work through the text in this order:
1. Strip a BOM and split on `/\r?\n/`.
2. Locate the col-0 `on:` line with the existing regex.
3. Reuse the trigger-level indent walk that `workflowHasPullRequestTrigger` performs to find each PR trigger, in all three forms: scalar, flow list `[..]` and block.
4. For a block-form trigger key, scan its sub-block (lines indented deeper than the trigger) for a `types:` key at the sub-block's first indent.
5. Read the `types:` value:
   - A one-line `[a, b]`: `stripComment`, then split on `,` and `stripQuotes` each item.
   - A plain identifier `/^[A-Za-z_]+$/` becomes one item.
   - An empty value followed by `- item` lines at an indent ≥ the key's indent.
   - Anything else is `unparsed`. That covers `*alias`, `&anchor`, `{`, `${{`, a `[` without its `]` on the same line, and a `- ` line whose item fails `/^['"]?[A-Za-z_]+['"]?$/`.

`pull_request: {}`, `pull_request: null` and `pull_request:` with an empty inline value all read as the default types. In the flow-mapping `on:` form, a PR key whose value contains `types` is read only from a one-line `types: [..]` inside it; any other shape is `unparsed`.

For `draftReference`, test `/\bgithub\.event\.pull_request\.draft\b(?!\w)/` on each line after dropping whole-line comments (trimmed line starts with `#`) and `stripComment`. Item matching is exact, by `===`, against `'ready_for_review'`.

Export `DEFAULT_PR_TYPES`, `readPullRequestWorkflow` and `readyRequirement`. Add a header comment. It states that a miss from a reusable workflow (`uses:`) leaves today's behaviour, and that a false hit parks with a named reason (spec Gotcha 3).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/merge-verification.test.js`
Expected: PASS. The existing `workflowHasPullRequestTrigger`/ladder tests are unchanged.

- [ ] **Step 5: Discrimination.** Delete the `unparsed` branch and rerun the file. AC5.3 must go red. Restore it, then delete the comment skip and rerun. The comment-only draft case must go red. Restore it.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/merge-verification.js tests/merge-verification.test.js
git commit -m "Add workflow trigger-types reader — types, draft reference, unparsed (#5153)"
```

---

### Task 2: `classifyRollup` ready-run inputs and `readyRunVerdict`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/pr-checks/classify.js:55-79` (`classifyRollup`), plus a new exported `readyRunVerdict` and `PR_EVENTS`, and the header comment's twin list
- Test: `tests/bin-lib/pr-checks/classify.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 1. Paths are plain strings.
- Produces: `PR_EVENTS` = `Object.freeze(['pull_request', 'pull_request_target'])`.
- Produces: `readyRunVerdict({ readySince: string, readyWorkflows: string[], headRuns: object[] }) -> { awaiting: string[], pending: string[], failing: Array<{ name, url }> }`. It is pure and never throws.
  - A row counts for workflow `W` when three things hold:
    - `String(row.path ?? '').replace(/@.*$/, '') === W` (REST rows carry `path`; `gh run list` rows carry none, so they never count).
    - `PR_EVENTS.includes(row.event)`.
    - `Date.parse(row.createdAt ?? row.created_at) >= Date.parse(readySince)`. A `NaN` either side is not counted, which fails closed toward awaiting.
  - The newest counted row decides each `W`. It is chosen by `Date.parse`, then by a numeric `databaseId ?? id`.
  - The newest row puts `W` in a list as follows:
    - Status not `COMPLETED` after uppercasing → `pending`.
    - `conclusion` uppercased (`String(row.conclusion || '').toUpperCase()`, the same normalization as `normalizeHeadRun`) in `FAILING_CONCLUSIONS` → `failing`. REST and `gh run list` rows carry lowercase conclusions such as `failure`. The entry is `{ name: row.workflowName || row.name || W, url: row.html_url || row.url || null }`.
    - No counted row at all → `awaiting`.
- Produces: `classifyRollup({ …existing, readySince?, readyWorkflows? })`.
  - Active iff `typeof readySince === 'string' && readySince !== '' && Array.isArray(readyWorkflows) && readyWorkflows.length > 0`.
  - Validation, after the existing `headRuns` check and before `stale`:
    - `readyWorkflows` present and neither `undefined`, `null` nor an array → `read-failed`, reason `malformed-ready-workflows`.
    - Active with `Number.isNaN(Date.parse(readySince))` → `read-failed`, reason `malformed-ready-since`.
  - After the red check, an active call computes `awaiting = readyRunVerdict(…).awaiting`.
  - The existing pending line becomes: pending when `pending.length > 0 || awaiting.length > 0`. A pending result adds `awaitingReadyRun: awaiting` only when `awaiting` is non-empty, so every inactive call's result object is unchanged byte for byte (AC4).

- [ ] **Step 1: Write the failing tests.**
  - Fixture constants: `READY = '2026-11-11T00:45:28Z'`, `W = '.github/workflows/ci.yml'`, and a REST-shaped row builder `rest(path, event, created_at, status, conclusion, id)`.
  - `test('AC1.1: draft-time head runs and rollup entries all completed SKIPPED/SUCCESS are pending with awaitingReadyRun', …)`:
    - Rollup: `SKIPPED` ci entry and `SUCCESS` `label-fix-branch`.
    - headRuns: `rest(W,'pull_request','2026-11-11T00:29:06Z','completed','skipped',1)`.
    - Expect `state: 'pending'`, `awaitingReadyRun: [W]` and `pending: []`.
  - `test('AC1.2: readySince set and a ready workflow with no head run at or after it is pending with awaitingReadyRun', …)`: headRuns `[]` and a green rollup → `pending`, `awaitingReadyRun: [W]`.
  - `test('AC1.3: a pre-ready run, including a re-run that keeps its original createdAt, does not satisfy the requirement', …)`: a completed `success` row with `run_attempt: 2` and `created_at` one second before `READY` → `pending`, `awaitingReadyRun: [W]`.
  - `test('AC2.1: a matching post-ready run in progress is pending', …)` → `pending`, with no `awaitingReadyRun` key (`assert.equal('awaitingReadyRun' in r, false)`).
  - `test('AC2.1: a matching post-ready run that fails is red', …)` → `red`, naming it.
  - `test('AC2.1: a matching post-ready run that succeeds is green', …)` → `green`.
  - `test('AC3.1: a red head run still returns red while a ready run is awaited', …)`: a failing non-ready run plus no post-ready run for `W` → `red`.
  - `test('AC4.1: with readySince/readyWorkflows absent or empty every existing classify case returns its current verdict, unchanged', …)`:
    - Build an array of the existing suite's input objects, written out in the test: the red, pending, stale, empty-rollup (`hasPrCi` both ways), green, StatusContext and headRuns cases already in this file.
    - For each, `assert.deepStrictEqual(classifyRollup({ ...input, ...extra }), classifyRollup(input))` for `extra` in `{}`, `{ readySince: null, readyWorkflows: [] }`, `{ readySince: READY, readyWorkflows: [] }`, `{ readySince: undefined, readyWorkflows: [W] }` and `{ readySince: '', readyWorkflows: [W] }`.
  - Guard tests, one per guard. Deleting that guard turns its test red (Guard-branch discrimination check):
    - (a) A `push`-event post-ready row does not count.
    - (b) `path: W + '@refs/heads/x'` counts, and `path: W + '2'` does not (two inputs differing only in the dropped part).
    - (c) A row with `created_at: 'garbage'` does not count, so the result stays awaiting.
    - (d) `readySince: 'garbage'` with active workflows → `read-failed`, `malformed-ready-since`.
    - (e) `readyWorkflows: 'ci.yml'` → `read-failed`, `malformed-ready-workflows`.
    - (f) Of two post-ready rows for `W`, the older `failure` and the newer `success`, `readyRunVerdict` reports no failing. This test calls `readyRunVerdict` directly, because `classifyRollup`'s general red rule still sees the older row, a pre-existing history-not-state behaviour this record does not change.
    - (g) A row created after the first of two ready events but before `READY` (the last) does not count.
    - (h) Call `readyRunVerdict` directly with a lowercase `failure` post-ready REST-shaped row (`rest(W,'pull_request',after,'completed','failure',3)`). It lands in `failing` as `[{ name, url }]`. Deleting the uppercase normalization turns this test red, because the row then reads neither failing nor pending.
  - `test('readyRunVerdict is exported and pure: no input mutation', …)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: FAIL after Step 1 — the AC1/AC2 cases fail (`awaitingReadyRun` undefined), and `readyRunVerdict is not a function`.

- [ ] **Step 3: Implement `readyRunVerdict(...)` and the `classifyRollup` inputs in `plugin/bin/lib/pr-checks/classify.js`**, per the Interfaces block. Then extend the header comment's "Shared with the merge gate" list with one bullet. It names `readyRunVerdict` as the code twin of Step 2.5's ready-run bullet (#5153).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js tests/pr-check-gate-conformance.test.js`
Expected: PASS. Every pre-existing case is untouched.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/pr-checks/classify.js tests/bin-lib/pr-checks/classify.test.js
git commit -m "Add ready-run rule to classifyRollup — readySince, readyWorkflows, awaitingReadyRun (#5153)"
```

---

### Task 3: Ready-run reader and `bin/ready-run.js` CLI

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/pr-checks/ready-run.js`
- Create: `plugin/bin/ready-run.js`
- Test: `tests/bin-lib/pr-checks/ready-run.test.js`
- Modify: `docs/plugin-structure.md:47` (extend the `plugin/bin/lib/pr-checks/` row with `ready-run.js`) and the Commands list near :213 (one `node plugin/bin/ready-run.js --pr <n> --sha <sha> [--root <dir>]` line)

**Interfaces:**
- Consumes: `readPullRequestWorkflow` and `readyRequirement` (Task 1); `readyRunVerdict` and `FAILING_CONCLUSIONS` (Task 2); `parseLsTreeZ` (`plugin/bin/lib/git-z.js`); `repoTargetOf` (`plugin/bin/lib/hooks/git-exec.js`); `ghOptions` and `ghAvailable` (`plugin/bin/lib/repo-resolve.js`); `GH_TIMEOUT_MS`, `GIT_TIMEOUT_MS` and `LARGE_MAX_BUFFER_BYTES` (`plugin/bin/lib/shared-primitives.js`).
- Produces in `lib/pr-checks/ready-run.js`:
  - `STATES` = `Object.freeze(['not-applicable', 'met', 'awaiting', 'red', 'draft-skip-without-ready-trigger', 'read-failed'])`.
  - `READY_EVENT_QUERY`, the literal `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){timelineItems(itemTypes:[READY_FOR_REVIEW_EVENT],last:1){nodes{...on ReadyForReviewEvent{createdAt}}}}}}`.
  - `defaultDeps(root) -> { gh(args) -> string, git(args) -> string, repoTarget() -> object|null, ghAvailable() -> boolean }`.
    - `gh` runs `execFileSync('gh', args, ghOptions(args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true }))`.
    - `git` runs `execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true })`.
  - `readReadyRun(deps, { pr: number, sha: string }) -> { readySince: string|null, workflows: Array<{file,…}>, headRuns: object[] } | { reason: string }`. It never throws. The order is fixed, and it reads the ready event **first**: with no ready event no workflow file is read, so a head missing from the local object store cannot demote a verdict (plan review, amendment 3).
    1. `deps.ghAvailable()` false gives reason `gh absent`.
    2. `deps.repoTarget()` that is null or a refusal gives reason `repo unresolvable from origin`.
    3. The timeline read, with argv `['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${pr}`, '-f', `query=${READY_EVENT_QUERY}`]`. Read the body from `stdout` even on a throw (`err.stdout`). The result is one of three:
       - An empty `nodes` means the PR was never a draft, or is still a draft (`/test`'s gate before undraft). Return `{ readySince: null, workflows: [], headRuns: [] }` with no workflow or runs read. This is "no requirement", so `not-applicable`.
       - A failed or malformed read (a missing `data.repository.pullRequest`, unparseable stdout) goes to the step-4 local read alone, with no contents API. If the local objects are present and `readyRequirement` is empty, no ready-run rule could apply, so return `{ readySince: null, workflows, headRuns: [] }`. Otherwise give reason `ready-event read failed: {err}`. This keeps a GraphQL blip from parking merges on repos that use no draft skip and no `ready_for_review`. It never loosens a repo that does.
       - Otherwise `readySince = nodes[nodes.length - 1].createdAt`.
    4. Workflows at `sha`, local objects first. `git ls-tree -z --end-of-options {sha} -- .github/workflows/` is parsed with `parseLsTreeZ`. Keep `type === 'blob'` rows whose path is `.github/workflows/{name}`, where the name matches `/\.ya?ml$/i` and holds no further `/`. Read each with `git cat-file blob {blobSha}`. An empty listing is `workflows: []`.
    5. Any throw in step 4 (typically `ls-tree` exit 128 for an absent commit) falls back to the contents API at that ref:
       - The listing is `['api', `repos/${owner}/${name}/contents/.github/workflows?ref=${sha}`]` (GET, no `-f`/`-F`).
       - Each `type === 'file'` entry whose name matches `/\.ya?ml$/i` is read with `['api', `repos/${owner}/${name}/contents/${entry.path}?ref=${sha}`]`, decoding `content` from base64 (`encoding: 'base64'`).
       - A 404 on the listing, where GraphQL has resolved owner and name and `sha` is the PR head GitHub reported, is `workflows: []`.
       - Only when both sources fail: reason `workflows unreadable at ${sha}: local objects ({err}); contents API ({err}) — run: git fetch origin pull/${pr}/head`. This fails closed with a named reason.
    6. `readyRequirement(workflows)`. When both `readyWorkflows` and `draftSkipWithoutReadyTrigger` are empty, return `{ readySince, workflows, headRuns: [] }` with no runs read. That is `not-applicable`.
    7. The REST runs read, with argv `['api', `repos/${owner}/${name}/actions/runs?head_sha=${sha}&per_page=100`]` (no `-f`/`-F`, so it stays GET).
       - `workflow_runs` not an array gives reason `runs read failed: not a list`.
       - `total_count > workflow_runs.length` gives reason `runs read truncated: {len} of {total}`, failing closed.
  - `readyRunState({ readySince, workflows, headRuns }) -> { state, readySince, readyWorkflows, awaitingReadyRun, pending, failing, draftSkipWithoutReadyTrigger, unparsed }`. It is pure. Reading B, the user's decision at plan review: a draft-skip workflow parks only while it has no post-ready run, and once it has one it is judged like any ready workflow.
    - `not-applicable` when there is no `readySince`, or no requirement.
    - Otherwise let `req = readyRequirement(workflows)` and `v = readyRunVerdict({ readySince, readyWorkflows: [...req.readyWorkflows, ...req.draftSkipWithoutReadyTrigger], headRuns })`. Then `parked = req.draftSkipWithoutReadyTrigger.filter((w) => v.awaiting.includes(w))` and `awaitingReadyRun = v.awaiting.filter((w) => !parked.includes(w))`.
      - `red` when `v.failing.length`, which includes a draft-skip workflow whose newest post-ready run failed.
      - Else `draft-skip-without-ready-trigger` when `parked` is non-empty.
      - Else `awaiting` when `awaitingReadyRun.length || v.pending.length`.
      - Else `met`.
    - The envelope's `draftSkipWithoutReadyTrigger` is `parked`, meaning only the workflows with no post-ready run. `readyWorkflows` is `req.readyWorkflows`, and `pending = v.pending`.
  - `resolveReadyRun(deps, { pr, sha }) -> envelope` is the core. A `{ reason }` becomes `{ state: 'read-failed', reason, readySince: null, readyWorkflows: [], awaitingReadyRun: [], pending: [], failing: [], draftSkipWithoutReadyTrigger: [], unparsed: [] }`.
- Produces in `plugin/bin/ready-run.js`: `run(argv, deps) -> exitCode`, `parseArgs(argv)` and `USAGE`, which is built from `STATES` and carries the line `state: ${STATES.join(' | ')}`. The JSON line printed is `{ ...envelope, pr, sha }`.
  - Exit 0 in every state.
  - Exit 2 on a malformed invocation: `--pr` not `/^[1-9]\d*$/`, `--sha` not `/^[0-9a-f]{40}$/`, `--root` empty or starting with `-`, a trailing bare flag, an unknown argument, or a missing `--pr`/`--sha`.
  - `--root` defaults to `deps.cwd()`.
  - `--help` exits 0 before any probe.
  - `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps)`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/pr-checks/ready-run.test.js`.
  - A fake `gh` branches on `args[1] === 'graphql'`, on `args[1].includes('/actions/runs?')` and on `args[1].includes('/contents/')`, and throws `unexpected …` on anything else. A contents fake can also be set to throw. It records argv inside the runner and asserts after the call.
  - A fake `git` serves `ls-tree`/`cat-file` from an in-memory `{path: text}` map, built through `parseLsTreeZ`'s input shape (`<mode> blob <sha>\t<path>\0`).
  - The test list:
    - `test('readReadyRun: a ready event but no workflow requiring a ready run → not-applicable with no runs read', …)`.
    - `test('readReadyRun: the timeline argv passes owner/name with -f and number with -F, and the query asks last:1', …)`. This pins the exact argv array.
    - `test('readReadyRun: no ready event (never a draft, or still a draft) → no requirement with zero git calls and no runs read', …)`. This is amendment 3(a) at the reader: the fake `git` throws on any call, so the test proves no workflow read happens.
    - `test('readReadyRun: the runs read is a GET path with head_sha and per_page=100 and no -f/-F', …)`.
    - `test('readReadyRun: a ready event and a non-local head read the workflows through the contents API at the ref', …)`. This is amendment 3(b). The fake `git` throws `Object.assign(new Error('fatal: not a tree object'), { status: 128 })`. The contents fake serves the listing and a base64 `ci.yml` with a default-types draft skip. Expect `draftSkipWithoutReadyTrigger: ['.github/workflows/ci.yml']`, and both recorded contents argv carry `?ref={sha}` with no `-f`/`-F`.
    - `test('readReadyRun: a ready event with neither local objects nor the contents API is read-failed naming both causes and git fetch origin pull/{n}/head', …)`. This is amendment 3(c).
    - `test('readReadyRun: a contents-API 404 on the workflows listing is no workflows, never read-failed', …)`.
    - `test('readReadyRun: a failed timeline read is read-failed unless the local workflows show no requirement', …)`. Two cases: local objects showing a draft skip give `read-failed` with `ready-event read failed:`, and local objects with only a bare `pull_request:` workflow give `not-applicable`.
    - `test('readReadyRun: a truncated runs page, a non-list runs body, gh absent and an unresolvable repo are each read-failed with their own reason', …)`: one assertion per cause.
    - `test('AC6.1: a draft-skip workflow with default types gives draft-skip-without-ready-trigger naming the file', …)`: the workflow is `.github/workflows/ci.yml` with `on:\n  pull_request:\n` and a job `if: github.event.pull_request.draft == false`, under a ready event. Expect state `draft-skip-without-ready-trigger` and `draftSkipWithoutReadyTrigger: ['.github/workflows/ci.yml']`.
    - `test('AC6.2: a workflow declaring ready_for_review never gives draft-skip-without-ready-trigger', …)`: `types: [opened, synchronize, reopened, ready_for_review]` plus the same draft skip. Expect `awaiting` with no post-ready run, `met` with a completed success post-ready run, and never the draft-skip state.
    - `test('readyRunState: red wins over draft-skip and awaiting; an unparsed workflow is awaited and listed in unparsed', …)`.
    - `test('AC6.1 (Reading B): a draft-skip workflow without ready_for_review parks only while it has no post-ready run', …)`. Use the same default-types draft-skip workflow twice:
      - With no head run at or after `readySince`, expect `draft-skip-without-ready-trigger` and `draftSkipWithoutReadyTrigger: ['.github/workflows/ci.yml']`.
      - With a completed `success` REST row `{ path: '.github/workflows/ci.yml', event: 'pull_request', created_at: <after readySince> }` from a later `synchronize` push, expect `met`, an empty `draftSkipWithoutReadyTrigger`, and not parked.
      - Further cases with the same workflow: an `in_progress` post-ready run gives `awaiting`, and a `failure` one gives `red`.
    - `test('real git: workflows are read at the sha from a committed fixture repo', …)`: uses `tests/helpers/git-fixtures.js`'s `gitRepo` (under `os.tmpdir()`). It commits the AC6.1 workflow and runs `readReadyRun` with `defaultDeps(repo)`'s real `git` and a fake `gh`, asserting the file's `draftReference: true`. This is the Real-writer fixture check.
    - `test('CLI: malformed --pr/--sha/--root, a trailing bare flag, an empty value and an unknown arg each exit 2 with no gh or git call', …)`.
    - `test('CLI: --help prints USAGE built from STATES and exits 0 without probing', …)`: every `STATES` member appears in `USAGE`, and `Object.isFrozen(STATES)`.
    - `test('CLI: run prints exactly the core envelope plus pr and sha on one line, exit 0 in every state', …)`: for each of the 6 states, the printed JSON deep-equals `{ ...resolveReadyRun(sameDeps, args), pr, sha }`.
    - `test('CLI: the states its cases emit cover STATES exactly', …)`: collect `state` across the suite's CLI cases and compare as a set (prose-code-twin-pin's Emitted-status instance).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/ready-run.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/pr-checks/ready-run'` (or the test file is absent before Step 1).

- [ ] **Step 3: Implement `plugin/bin/lib/pr-checks/ready-run.js` and `plugin/bin/ready-run.js`** per the Interfaces block. Header comments:
  - The lib's header names the reads in order: the timeline first, then workflows from local objects or else the contents API, then runs. It also states the fail-closed rule: a read failure is `read-failed`, never `not-applicable`. The one exception is a failed timeline read where the local workflows show no requirement, since no ready-run rule can apply there.
  - The CLI's header copies `pr-checks.js`'s status-as-data paragraph shape: "Status is data: exit 0 in every state … 2 malformed invocation".
- Name each `catch`'s direction in a comment beside it.
- The CLI reads no run dir, so no anchoring guard is owed (`cli-wrapper-contract.md` L39–L41).

- [ ] **Step 4: Update `docs/plugin-structure.md`**:
  - The `pr-checks/` row gains `ready-run.js — readReadyRun/readyRunState: the merge gate's ready-run read (#5153)`.
  - The Commands block gains one line: `node plugin/bin/ready-run.js --pr <n> --sha <sha> [--root <dir>]   # ready-run read — waits for the run gh pr ready starts (#5153)`.
  - Escape any `|` inside a code span, because `tests/skill-graph-table-structure.test.js` counts cells.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/pr-checks/ready-run.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/git-path-read-conformance.test.js tests/path-guard-conformance.test.js tests/helpers-strip-comments.test.js tests/payload-boundary.test.js tests/bin-lib/repo-resolve.test.js tests/skill-graph-table-structure.test.js`
Expected: PASS.

- [ ] **Step 6: Real-input probe (read-only).** Run `node plugin/bin/ready-run.js --pr 5156 --sha 95d5d61553092f53f7ef72e322dfeb8d312b507b`. It must print `"state":"not-applicable"`, because this repo's `test.yml` is a bare `pull_request:` with no draft reference. The independent count: `git ls-tree --name-only 95d5d61553092f53f7ef72e322dfeb8d312b507b -- .github/workflows/` lists the same files the reader parsed. Log the printed line as `AC evidence` per the AC-evidence persistence check (`log-decision.js --section "/build" --status AUTO --step "AC evidence"`), with output in `$PIPELINE_RUN_DIR/evidence/ready-run-probe.txt`.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/pr-checks/ready-run.js plugin/bin/ready-run.js tests/bin-lib/pr-checks/ready-run.test.js docs/plugin-structure.md
git commit -m "Add ready-run reader and CLI — timeline ready event, REST runs by path, workflows at the head sha (#5153)"
```

---

### Task 4: `pr-checks.js` feeds the ready-run inputs to `classifyRollup`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/pr-checks.js`: a `realDeps.readyRun`, `classifyPr` at :185-221, `gateEntry` at :143-155, and the `USAGE` and header envelope key lists
- Modify: `plugin/skills/_shared/pr-check-gate.md:76`. This is the prose twin of `gateEntry`'s pending text, which the agent writes itself on `logged: false`. Its `({pending names, … 'no check reported yet' when pending})` gains `'no run since ready: {files}' when only \`awaitingReadyRun\` holds it`.
- Test: `tests/bin-lib/pr-checks/cli.test.js` (`makeDeps` default at :35-59, plus new tests)

Dependency-caller enumeration: `git grep -l -e "pr-checks.js" -e "bin/pr-checks'" -- tests` returns eight files. Only `cli.test.js` calls `run()` in-process, and its `makeDeps` gets the stub. `tests/bin-lib/wrap-up/pack.test.js` fakes `deps.execFile`, and `tests/display-ci-readers-conformance.test.js` writes a stub `bin/pr-checks.js`, so neither reaches the real `readyRun`. The other five only read the source or the prose.

**Interfaces:**
- Consumes: `readReadyRun`, `defaultDeps` (Task 3); `readyRequirement` (Task 1).
- Produces:
  - `deps.readyRun({ pr, sha, root }) -> readReadyRun result`. Its real form is `(a) => readReadyRun(defaultDeps(a.root), a)`.
  - The envelope gains `awaitingReadyRun?`, present only on a pending verdict that has one.
  - `USAGE`'s `prints {…}` line gains `awaitingReadyRun?`. Its `state:` line is unchanged, so `tests/pr-check-gate-conformance.test.js`'s "every state … is routed" twin is untouched.

- [ ] **Step 1: Write the failing tests.**
  - First, add `readyRun: () => ({ readySince: null, workflows: [], headRuns: [] })` to `makeDeps`'s defaults, so every existing test stays byte-identical (cli-wrapper L37).
  - Then grep the file for any `run(` whose deps do not come from `makeDeps`/`prDeps`. There is none today: every call site at :78–756 passes `h.deps`.
  - New tests:
    - `test('ready-run: a green rollup with a ready workflow and no post-ready run is pending with awaitingReadyRun', …)`.
    - `test('ready-run: a completed successful post-ready REST run makes it green', …)`.
    - `test('ready-run: a draft-skip workflow without a ready trigger is folded into readyWorkflows and reads pending, never a new state', …)`.
    - `test('ready-run (Reading B): a draft-skip workflow with a completed successful post-ready synchronize run is green, the same verdict the merge gate\'s met gives', …)`.
    - `test('ready-run: no ready event and a head absent from the local object store leave the verdict unchanged', …)`. This is amendment 3(a) end to end. `readyRun` is the real `readReadyRun` wired to fakes: a GraphQL fake answering `nodes: []`, and a `git` that throws exit 128. Assert the envelope deep-equals the one the default stub gives (green), and assert zero `git` calls.
    - `test('ready-run: a ready event, a non-local head and both workflow sources unavailable is read-failed on a green rollup', …)`. This is amendment 3(c) through the CLI.
    - `test('ready-run: a readyRun reason on a non-red verdict is read-failed with reason prefix "ready-run read failed:"; on a red verdict it stays red', …)`.
    - `test('ready-run: a stale head never calls readyRun', …)`.
    - `test('ready-run: --pr mode passes the PR head sha and the git toplevel as root', …)`.
    - `test('ready-run: the pending gate line names "no run since ready: {files}" when only awaitingReadyRun holds it', …)`.
    - `test('USAGE names awaitingReadyRun? among the envelope keys', …)`.
    - `test('the pending gate-line phrase "no run since ready" appears in _shared/pr-check-gate.md (prose twin of gateEntry)', …)`, read through `readText`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/cli.test.js`
Expected: FAIL after Step 1 — the new `ready-run:` tests fail, because `readyRun` is never called.

- [ ] **Step 3: Implement in `plugin/bin/pr-checks.js`.**
  - In `classifyPr`, inside the existing `headRefOid === compareHead` branch and after the runs read, call `deps.readyRun({ pr: n, sha: headRefOid, root: repoRoot })` in a `try`. Move the `repoRoot` resolution above it.
  - A `{ reason }`, or a throw, sets `readyFailure`. It is handled exactly like `runsFailure` at :219: it demotes only a non-red verdict (batching L33).
  - Otherwise compute `req = readyRequirement(ready.workflows)`. When `ready.readySince` is set and `[...req.readyWorkflows, ...req.draftSkipWithoutReadyTrigger]` is non-empty, pass `readySince`, that list as `readyWorkflows`, and `headRuns: [...rows, ...ready.headRuns]`. Otherwise pass today's arguments unchanged.
  - Fold the draft-skip workflows in, which is consistent with Reading B. `classifyRollup`'s existence rule then treats a draft-skip workflow exactly as `readyRunState` does:
    - With no post-ready run it is in `awaitingReadyRun`, so `pending`.
    - Once a post-ready run exists (for example a later `synchronize` push with `draft == false`), the general rules judge it: pending while in progress, red on a failing conclusion, green when it succeeds.

    The two gates therefore agree on every head. Only the merge gate names the no-post-ready-run case with the dedicated park reason. Record this folding in the header comment.
  - `gateEntry`'s pending text falls back to `no run since ready: ${out.awaitingReadyRun.join(', ')}` before `'no check reported yet'`. `_shared/pr-check-gate.md:76` gets the same phrase, so the hand-written fallback entry matches the CLI's.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/pr-checks/cli.test.js tests/pr-check-gate-conformance.test.js tests/bin-lib/wrap-up/pack.test.js tests/display-ci-readers-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/pr-checks.js plugin/skills/_shared/pr-check-gate.md tests/bin-lib/pr-checks/cli.test.js
git commit -m "Feed ready-run inputs to pr-checks.js — /test's gate and the merge gate agree (#5153)"
```

---

### Task 5: Pay for the merge-bundle bytes — move rationale blocks to the appendix

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (blocks named below)
- Modify: `plugin/skills/_shared/pr-first-merge-appendix.md` (new `## Rationale notes` and `## Resume-to-merge` sections; new capture (f) in `## Signatures`)
- Test: `tests/merge-verification-gate-conformance.test.js:99-101` (retarget the resume slice to the appendix)

**Interfaces:**
- Produces: the appendix sections `## Rationale notes`, `## Resume-to-merge` and `## Signatures` capture (f). Tasks 7 and 9 edit `## Resume-to-merge`.

Moved blocks. Each move is a verbatim cut and paste, and each pointer is the exact text given here. Moved-prose pin check: `git grep -n -F` over `tests` and `plugin` for distinctive phrases of each block found pins only for the Resume block. The phrases checked were `harmless no-op`, `Why \`--auto\` alone is not a wait`, `one-lever decision`, `This is the exact check Phase 2`, `Dispatch hub run #9`, `serializes them one at a time`, `on a non-default integration branch they close nothing`, `Supersedes and closes`, `There is no distinguishing signature` and `read-then-decide`. The only other hits are the same-file reference at :370 and an unrelated `wrap-up/ceremony-derivation.md` sentence. The Resume pin is `tests/merge-verification-gate-conformance.test.js:100`, retargeted below. The frozen copy in `tests/pr-first-merge.test.js:361` is a fixture and stays.

1. **Header history (:6-9):** move `Supersedes and closes #335 (…) and #299 (… at all).` to `## Rationale notes`. The sentence now ends at `` `release/execute.md` Step 5. `` and gets no pointer.
2. **Step 1.5 incident and rationale:** move the sentence `One occurrence (Dispatch hub run #9, …) … before it.` (:48-49) and the paragraph `This is the exact check Phase 2's own Step 3 … already does.` (:60-68). Replace the paragraph with `Exit \`0\` → continue to Step 2: every worklist row Phase 2 opened has a recorded result (why that suffices: \`pr-first-merge-appendix.md\`'s "Rationale notes").`
3. **Step 2 aside (:106-109):** move the `(Empirically, \`gh pr ready\` …)` paragraph and give it no pointer.
4. **Why `--auto` alone is not a wait (:195-203):** move the paragraph. Replace it with: `` **`--auto` waits only when the forge holds the merge** — `mergeStateStatus: BLOCKED` while checks are pending; anywhere else arming *is* an immediate merge, which is why the pending column below keys on `mergeStateStatus` (capture and reasoning: `pr-first-merge-appendix.md`'s "Why `--auto` alone is not a wait"). `` Repoint Step 3 item 1's reference (:370) from `the Step 2.5 "Why \`--auto\` alone is not a wait" mechanism` to `the appendix's "Why \`--auto\` alone is not a wait" mechanism`.
5. **Bounded-watch rationale (:212-214):** move the sentence `Not a policy key: … the timeout's own rationale).` Replace it with `(Fixed by design, not a policy key — \`pr-first-merge-appendix.md\`'s "Rationale notes".)` The heading line `**Bounded watch (…) — 15 minutes, fixed.**` stays byte-identical.
6. **Forge-cooperation capture (:293-294):** replace `(Task 0 capture (b): not captured — … never on a stderr string)` with `(classified from the state read, never a stderr string — appendix capture (b))`.
7. **Resume-to-merge (:300-305):** move the whole paragraph to the appendix's `## Resume-to-merge`. Leave the stub `` **Resume-to-merge is one-shot.** `dispatch/resume-confirmation.md` applies this gate once, as a read-then-decide with no bounded watch — the rule lives in `pr-first-merge-appendix.md`'s "Resume-to-merge". `` The stub keeps the bold label that `resume-confirmation.md` and `docs/journeys/recover-a-ci-parked-run.md` cite as "Step 2.5's resume rule".
8. **Merge-message rationale (:332-337, starting mid-line 332):** move `So the message's \`Fixes\` lines are the PR body's … — #4599).` Replace it with `(Why the \`Fixes\` lines are restated: \`pr-first-merge-appendix.md\`'s "Rationale notes".)` The operative sentence ending `omit \`--keep-open {keep-open}\` when none.` stays.
9. **Sequential multi-branch merges (:473-476):** replace the paragraph with `` **Sequential multi-branch merges** are serialized one at a time (`flow/worktree-merge.md`'s reconciliation) — why each later branch's update-from-base sees real current state: `pr-first-merge-appendix.md`'s "Rationale notes". ``
10. **Armed-outcome trigger list (:433-435):** `(\`_shared/pr-run-comments.md\`'s consumer table;\n     session-start, dispatch queue-pull, routine kickoffs, tidy, all converge on this\n     eventually).` becomes `(\`_shared/pr-run-comments.md\`'s consumer table).`. The list moves to `## Rationale notes`. `**Do not poll or wait**`, which `tests/pr-first-merge.test.js:72` pins, stays.

11. **Step 3 eval-guard rationale (:348-349):** move the sentence ` Why: the worktree Bash guard refuses \`eval\` and a \`gh\` argument computed at runtime, and every pr-first merge runs from a worktree session (#3522).` to `## Rationale notes`, with no pointer. The operative instructions before it, "Run each fence as its own Bash call" and "paste the path inside the printed quotes", stay. `git grep -n -F 'worktree Bash guard refuses \`eval\`' -- tests plugin` finds no pin.

The simulated effect of moves 1–11 on a scratch copy (`node {scratch}/simulate.js`, 2026-11-11) is −3,497 B raw, which puts the composed merge bundle at 49,001.

Capture (f) is appended to `## Signatures` as one bullet. It records PR #5156 (2026-11-11): `ReadyForReviewEvent` `createdAt` `2026-11-11T00:45:28Z`, and the head's only `pull_request` run, `test.yml` run 42931704440, created `2026-11-11T00:29:06Z`. This repo's bare `pull_request:` (default types) starts no run on ready, so every run on that head predates `readySince`. The ready-event window the gate waits through is the same not-yet-registered shape as capture (e).

- [ ] **Step 1: Retarget the test.** In `tests/merge-verification-gate-conformance.test.js`, the slice `section.slice(section.indexOf('**Resume-to-merge is one-shot.**'))` becomes a slice of the appendix's `## Resume-to-merge` section via `sectionOf(read('_shared', 'pr-first-merge-appendix.md'), '## Resume-to-merge')`. Add an assertion that the Step 2.5 section still carries the stub `**Resume-to-merge is one-shot.**` and the pointer text `"Resume-to-merge"`. Assertion inventory verdicts: `gh run list` retargeted; `not-yet-completed head run reads pending` retargeted; nothing retired.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/merge-verification-gate-conformance.test.js`
Expected: FAIL after Step 1 — `sectionOf` throws "## Resume-to-merge" not found.

- [ ] **Step 3: Make the eleven moves and the capture**, verbatim, in file order. Re-resolve deictics (Deictic-reference check). Stub 4 says "the pending column below" and stays above the table, and stub 9 sits where its paragraph sat.

- [ ] **Step 4: Run the tests and measure**

Run: `node --test tests/merge-verification-gate-conformance.test.js tests/pr-first-merge.test.js tests/pr-check-gate-conformance.test.js tests/session-tmp-root-migration.test.js tests/wrap-up-merge-mode-conformance.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS.

Run: `node plugin/bin/context-cost-report.js --plugin-root plugin`
Expected: every `"step":"merge"` row's `max` ≤ 49,400, against 52,498 before the moves; the simulation gave 49,001. Record the number in the commit body.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-first-merge-appendix.md tests/merge-verification-gate-conformance.test.js
git commit -m "Move pr-first-merge rationale and the resume rule to the appendix — merge bundle headroom for #5153"
```

---

### Task 6: "CI skips draft PRs" convention, its citers and its graph edges

**Role:** judgment

**Files:**
- Create: `plugin/skills/_shared/ci-skips-drafts.md`
- Modify: `plugin/skills/_shared/git-discipline.md:86-88` (the per-phase push paragraph)
- Modify: `plugin/skills/test/ci-source.md` (a new `## CI that skips draft PRs` section after `## Fallback reasons`)
- Modify: `docs/skill-graph.md` (one row under `## dispatch`, one under `## test`)
- Test: `tests/ci-skips-drafts-conformance.test.js`

**Interfaces:**
- Produces: `_shared/ci-skips-drafts.md`. Task 7's park-reason bullet cites it.

Content of `ci-skips-drafts.md`. The spec fixes these facts. Write them as compact operative prose, one `##` section each:
- `# CI that skips draft PRs`. Intro: under `pr-first`, every phase exit pushes to a draft PR (`_shared/git-discipline.md`). A project whose `pull_request` CI runs on drafts pays Actions minutes for each push. This file is the supported way to skip drafts and still have the merge gate (`_shared/pr-first-merge.md` Step 2.5) verify the head.
- `## Workflow shape`: a fenced YAML example with `on: pull_request: types: [opened, synchronize, reopened, ready_for_review]` and a job-level `if: github.event.pull_request.draft == false`. State the two rules:
  - Declare `ready_for_review` only alongside a draft skip. A workflow that declares it without skipping drafts pays one extra wait per merge for a second run on the same sha.
  - A draft skip whose `types` lack `ready_for_review` never runs after undraft, so the gate parks it as `draft-skip-without-ready-trigger`. The fix is adding `ready_for_review` to `types`.
- `## Pending-status pattern`: the draft-time run sets a commit status to `pending`, and the ready-time run flips it to `success` as its first step. This is defence in depth for readers other than this gate, such as `_shared/github-pr-scan.md`'s `NON_BLOCKING` set, and for adopters on older plugin versions.
- `## Path filters`: a workflow-level `paths:` filter leaves a docs-only PR with no checks reported when no other workflow reports on that head. The bounded watch reads that as pending and parks after 15 minutes. When another workflow does report (for example the generated tracking workflow's `label-fix-branch`), the rollup is non-empty and the filtered-out CI simply never appears. Use job-level conditions behind a small always-run job instead, so the CI workflow always reports.
- `## Coexistence with the \`ci\` verification source`: a project picks one of two shapes.
  - **CI on drafts plus a `ci` declaration:** full-suite verdicts come from draft-PR CI, there are no local full-suite runs, and every phase push costs Actions minutes.
  - **CI skips drafts and no `ci` declaration:** verification runs locally during the pipeline, and CI runs once at ready, which the gate waits for.

  Declaring both is a misconfiguration. With a job-level skip it degrades harmlessly: every verify falls back on `ci-job-skipped` after one poll. With a workflow-level gate it costs a `waitSeconds` stall per verify. Detecting the conflict is #5154's.
- `## Why projects skip drafts`: the Actions-minute cost of per-phase pushes. A private project measured 176 of 312 pull-request CI runs in 30 days on superseded commits, which billed 3,120 minutes, 35% of its Actions usage. Do not name the project.

`git-discipline.md` replacement paragraph (keeps `≥50× headroom`):

```markdown
Ship at every phase exit, not batched — measured at ≥50× headroom against the GitHub API budget
(spike #405; `git push` itself costs zero REST/GraphQL calls, so the API cost of per-phase cadence
is free regardless of phase count). Actions minutes are the cost that does scale: under `pr-first`
every push to the draft PR runs the project's `pull_request` CI unless the project follows
`_shared/ci-skips-drafts.md`'s convention. That convention is the mitigation; the cadence stays
per-phase for durability and visibility.
```

`ci-source.md` section: two sentences of the coexistence ruling (the two shapes, "Declaring both is a misconfiguration", the `ci-job-skipped` and `waitSeconds` costs), linking `_shared/ci-skips-drafts.md`.

`docs/skill-graph.md` rows. Escape any `|` in code spans.
- Under `## dispatch`: `` | `_shared/ci-skips-drafts.md` | The "CI skips draft PRs" convention (#5153). `_shared/pr-first-merge.md` Step 2.5 — this skill's merge gate via its shared row — names it in the `draft-skip-without-ready-trigger` park reason, and `_shared/git-discipline.md`'s per-phase push rationale cites it as the Actions-minute mitigation. | ``
- Under `## test`: `` | `_shared/ci-skips-drafts.md` | `ci-source.md` states the coexistence ruling — CI on drafts with a `ci` declaration, or CI that skips drafts with none — and links the convention (#5153). | ``

- [ ] **Step 1: Write the failing test** in `tests/ci-skips-drafts-conformance.test.js`. All reads go through `readText`, and every fact is checked with `missingFactsOf` plus `assertEachPatternGoesRed` from `tests/helpers/conformance-asserts.js`.
  - `test('AC9.1: plugin/skills/_shared/ci-skips-drafts.md exists', …)`.
  - `test('AC9.2: the convention states each of Deliverable 6\'s four points', …)`. One pattern per point, each scoped by `sectionOf` to its own `##` section:
    - Workflow shape: `/types: \[opened, synchronize, reopened, ready_for_review\]/` and `/if: github\.event\.pull_request\.draft == false/`.
    - Pending status: `/commit status to `pending`[\s\S]*?flips it to `success` as its first step/` and `/NON_BLOCKING/`.
    - Path filters: `/workflow-level `paths:` filter/`, `/parks after 15 minutes/` and `/always-run job/`.
    - Coexistence: `/Declaring both is a misconfiguration/`, `/ci-job-skipped/` and `/waitSeconds/`.
    - Why: `/Actions-minute cost of per-phase pushes/`.
    - Each pattern goes red when stripped, and `assertEachPatternGoesRed` proves exactly itself.
  - `test('AC9.2: git-discipline.md and test/ci-source.md cite _shared/ci-skips-drafts.md', …)`. The `pr-first-merge.md` citer is pinned in Task 7.
  - `test('AC10.1: git-discipline.md\'s per-phase push paragraph names Actions minutes and cites the convention', …)`. The paragraph is selected by `lineStartingWith(text, 'Ship at every phase exit')` through the blank line. It must contain `Actions minutes` and `_shared/ci-skips-drafts.md`.
  - `test('AC10.2: the ≥50× headroom phrase survives', …)`. Assert `/≥50× headroom/` inside that same paragraph. The go-red control mutates only that phrase in memory and expects the shared helper to throw with its own message.
  - `test('ci-source.md states the coexistence ruling', …)`: `Declaring both is a misconfiguration` inside `sectionOf(text, '## CI that skips draft PRs')`.
  - `test('docs/skill-graph.md carries the ci-skips-drafts edge under dispatch and under test', …)`. Slice each skill section and find a row whose first cell is `` `_shared/ci-skips-drafts.md` ``.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ci-skips-drafts-conformance.test.js`
Expected: FAIL — the test file or `ci-skips-drafts.md` is absent.

- [ ] **Step 3: Write the convention, the two citer edits and the two graph rows** as specified above. Measure `wc -c` on `git-discipline.md` (24,423 B before) and `ci-source.md` (4,973 B before). Both stay far under `RAIL_BYTES` 52,500, and neither is a composed-bundle source.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ci-skips-drafts-conformance.test.js tests/pr-early-run-lifecycle.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/skill-catalog-completeness.test.js`
Expected: PASS. `tests/pr-early-run-lifecycle.test.js:127`'s `/≥50× headroom/` still matches.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/ci-skips-drafts.md plugin/skills/_shared/git-discipline.md plugin/skills/test/ci-source.md docs/skill-graph.md tests/ci-skips-drafts-conformance.test.js
git commit -m "Add the CI-skips-drafts convention — git-discipline counts Actions minutes, ci-source states the coexistence ruling (#5153)"
```

---

### Task 7: Step 2.5 — the ready-run read, its classification and the park reason

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` Step 2.5: after the head-runs paragraph (:162-163), at "Classify from both reads" (:167), after the red bullet (:174-179), at Red path items 2–3, and at the Outcome vocabulary `pending-review` row
- Modify: `plugin/skills/dispatch/settle-parked.md:37` and `:56` (Behavior-change prose sweep)
- Test: `tests/pr-first-merge.test.js` (append)
- Test: `tests/pr-check-gate-conformance.test.js` (append the twin pin)

**Interfaces:**
- Consumes: `bin/ready-run.js`'s `STATES` and envelope (Task 3); `classify.js`'s `readyRunVerdict` (Task 2); `_shared/ci-skips-drafts.md` (Task 6).

Text to insert. The spec fixes these strings, so keep them; trim only surrounding words if the bundle gate fails.

(a) After the paragraph ending `which applies the same order.`:

````markdown
Then the ready-run read (#5153: the last `ReadyForReviewEvent`'s `createdAt`, the head's runs with `createdAt`, `event` and workflow `path`, and the head's workflow triggers):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ready-run.js" --pr {pr-number} --sha {headRefOid}
```
````

(b) `Classify from both reads, in this order:` becomes `Classify from the three reads, in this order:`.

(c) Directly after the red bullet, before `- Any entry with \`status\` not \`COMPLETED\``:

```markdown
- The ready-run read's `state` (code twin: `classify.js`'s `readyRunVerdict`): `read-failed` →
  `state-read-failed`; `red` → **red** (its `failing`); `draft-skip-without-ready-trigger` →
  **Red path**, reason `draft-skip-without-ready-trigger:{files}` — the workflow skips drafts but its
  `types` lack `ready_for_review`, so nothing runs after `gh pr ready`; fix: add `ready_for_review` to
  `types` (`_shared/ci-skips-drafts.md`); an explicit `off` logs it and merges; `awaiting` → **pending**
  (`awaitingReadyRun` names the workflows with no finished run since ready); `met`, `not-applicable` →
  no change.
```

(d) Red path item 2's park-comment template (:263) becomes the following, where `{reason}` is the existing braces text plus one alternative:

```markdown
`Parked by merge-verification ({value}): {failing check names — or "checks still pending after 15m" for checks-pending-timeout, or "{files} skips drafts with no ready_for_review trigger — add ready_for_review to its types (_shared/ci-skips-drafts.md)" for draft-skip-without-ready-trigger} on PR #{n}. {resume}`
```

The line after it adds ` \`{resume}\`: \`Resume once green.\`; for draft-skip-without-ready-trigger, \`Resume once its workflow is fixed or a post-ready run lands.\``. A draft-skip park never says "Resume once green". The fence that writes the comment carries `{resume}` as its own `printf` argument. That edit is in Task 8, because it re-keys two existing fence pins.

The `$REASON` sentence gains: ` A timeout whose last ready-run read named \`awaitingReadyRun\` appends \` (no run since ready: {files})\`.` An `unparsed` workflow is in `awaitingReadyRun`, so this names it as the spec requires.

(e) Red path item 3's `{reason: check-failed:{names} | checks-pending-timeout}` becomes `{reason: check-failed:{names} | checks-pending-timeout | draft-skip-without-ready-trigger:{files}}`.

(f) The Outcome vocabulary `pending-review` row's `reason check-failed:{names} or checks-pending-timeout` becomes `reason check-failed:{names}, checks-pending-timeout or draft-skip-without-ready-trigger:{files}`.

(g) `settle-parked.md:37`: `Step 2.5's state read plus its head-run read` becomes `Step 2.5's state read, its head-run read and its ready-run rule`. `:56`: `` `reason: check-failed:{names} | checks-pending-timeout` `` gains ` | draft-skip-without-ready-trigger:{files}`.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/pr-first-merge.test.js`, use one helper `assertReadyRunStep25(section)` over `step25Section()`, which throws a per-clause message. Each needle is matched against the bullet after collapsing whitespace (`.replace(/\s+/g, ' ')`), because the bullet wraps.
    - `test('AC6.1: Step 2.5 routes draft-skip-without-ready-trigger to the Red path with the fix and the convention citation', …)`: the bullet contains `` `draft-skip-without-ready-trigger` → **Red path** ``, `` fix: add `ready_for_review` to `types` `` and `_shared/ci-skips-drafts.md` (AC9's third citer).
    - `test('AC6.1: the park comment names the fix and never says "Resume once green" for a draft skip', …)`. This pins three things:
      - The template line carries the literal `{files} skips drafts with no ready_for_review trigger — add ready_for_review to its types (_shared/ci-skips-drafts.md)`.
      - The `{resume}` sentence maps draft-skip-without-ready-trigger to `Resume once its workflow is fixed or a post-ready run lands.`
      - The template's tail is `on PR #{n}. {resume}`, not `Resume once green.`

      It has mutation controls per clause.
    - `test('AC6.2: only the draft-skip state parks on that reason — met and not-applicable change nothing', …)`: `` `met`, `not-applicable` → no change `` is present, and the Red-path log line's reason alternation lists the new reason exactly once.
    - `test('AC11.1: the Step 2.5 reads carry the ready-run read after the head-run read, and the head-run read is byte-identical', …)`:
      - The existing `gh run list --repo {owner}/{repo} --commit {headRefOid} --limit 100 --json name,workflowName,status,conclusion,url` line is present unchanged.
      - The `node "${CLAUDE_PLUGIN_ROOT}/bin/ready-run.js" --pr {pr-number} --sha {headRefOid}` fence follows it.
      - `Classify from the three reads` is present.
      - Use a `requireOrder` helper with a permutation control: swap the two fences in memory and expect the helper's ordering message.
    - `test('AC11.1: the ready-run bullet sits after the red bullet and before the pending bullet', …)`: `requireOrder` over the three bullet anchors, with one permutation control per adjacent pair.
    - `test('AC3.1 (prose): red still wins — the ready-run bullet\'s awaiting row is pending and its red row is red', …)`.
    - Mutation controls: for each clause above, `assert.notEqual(mutated, section)`, then `assert.throws(() => assertReadyRunStep25(mutated), { message })`.
    - `test('settle-parked names the ready-run rule and the new park reason', …)`.
  - In `tests/pr-check-gate-conformance.test.js`:
    - `test('the ready-run bullet\'s state words equal bin/ready-run.js STATES (code twin, both directions)', …)`: collapse the bullet's whitespace, then parse it with `/((?:`[a-z-]+`, )*`[a-z-]+`) →/g`, the same shape as this file's StatusContext parser, and take every backticked token in each match. Then `assert.deepEqual(new Set(parsed), new Set(STATES))`. The bullet starts `- The ready-run read's \`state\``. A control drops one state from the bullet in memory, expects the helper to throw with its message, and runs the same extractor.
    - `test('the ready-run bullet names readyRunVerdict and classify.js exports it', …)`: `typeof require(…classify).readyRunVerdict === 'function'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pr-first-merge.test.js tests/pr-check-gate-conformance.test.js`
Expected: FAIL after Step 1 — the ready-run bullet is absent.

- [ ] **Step 3: Insert (a)–(g).** Keep every new line outside existing suites' slices, or re-prove them:
  - `tests/pr-first-merge.test.js`'s `currentRedBullet` slice (:557-559) ends at `\n- Any entry with \`status\``. It will now include bullet (c). Rerun that file's AC7.1 test. It must still throw on the frozen pre-#4550 red bullet.
  - `tests/merge-verification-gate-conformance.test.js` pins the three head-run clauses, which stay intact.

- [ ] **Step 4: Run the tests and measure**

Run: `node --test tests/pr-first-merge.test.js tests/pr-check-gate-conformance.test.js tests/merge-verification-gate-conformance.test.js tests/display-ci-readers-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS.

Run: `node plugin/bin/context-cost-report.js --plugin-root plugin`
Expected: merge `max` ≤ 50,600. The simulation at authoring time gave 50,407.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/dispatch/settle-parked.md tests/pr-first-merge.test.js tests/pr-check-gate-conformance.test.js
git commit -m "Step 2.5 reads the ready run and parks a draft skip with no ready trigger (#5153)"
```

---

### Task 8: Bounded watch — the `0)` branch re-applies the ready-run rule

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md`, in six places:
  - The scratch-path resolve line (:149) and its substitution sentence (:144-145).
  - The watch loop's `0)` arm (:225-230).
  - The `RC=0` bullet (:241-247).
  - A new `RC=3` bullet after `RC=1`.
  - The `RC=124` bullet (:250-251).
  - The Red path's park-comment fence (:268). Its `printf` carries `{resume}` as an argument; this is amendment 4, paired with Task 7(d).
- Test: `tests/merge-verification-gate-conformance.test.js` (extend `the gate cross-checks head-sha workflow runs…`, plus one new test)
- Create: `tests/merge-watch-ready-run.test.js` (extracts and runs the loop fence)
- Modify: `tests/skill-fence-guard-shapes.test.js:104`. Re-key the `_shared/pr-first-merge.md` `gh-computed-input` ratchet anchor to the new first line of the same fence. This is the same fence with the same one violation, so the count stays unchanged: a re-key, not growth.
- Modify: `tests/session-tmp-root-migration.test.js:194`. The live regex `/printf .* "\$VALUE" "\$REASON" "\$PR" > "\{park-comment-path\}"/` becomes `/printf .* "\$VALUE" "\$REASON" "\$PR" "\$RESUME" > "\{park-comment-path\}"/`. The frozen `PRE_CHANGE_PARK_FENCE` and its path-ban go-red control stay as they are.

**Interfaces:**
- Consumes: `bin/ready-run.js` (Task 3). The `{pr-ready-path}` placeholder is the session-tmp file `pr-ready-{n}.json`.

Loop text. Insert these four lines between the existing `PENDING_RUNS=$(…)` line and the `[ "${PENDING_RUNS:-x}" = 0 ] && break` line. The rest of the loop stays byte-identical, including `DEADLINE=$(( $(date +%s) + 900 ))`.

```bash
       node "${CLAUDE_PLUGIN_ROOT}/bin/ready-run.js" --pr {pr-number} --sha {headRefOid} > "{pr-ready-path}" || { RC=2; break; }
       READY=$(node -e "console.log(require(process.argv[1]).state)" -- "{pr-ready-path}") || { RC=2; break; }
       [ "$READY" = red ] || [ "$READY" = draft-skip-without-ready-trigger ] && { RC=3; break; }
       [ "$READY" = read-failed ] && { RC=2; break; }
       [ "$READY" = awaiting ] && PENDING_RUNS=1             # awaitingReadyRun: keep watching
```

Prose edits:
- The resolve line appends ` PR_READY=pr-ready-{n}.json`. The substitution sentence lists `PR_READY`/`{pr-ready-path}`.
- The `RC=0` bullet: after `a head run not yet \`completed\` resumes the bounded watch at the same \`DEADLINE\`` add `, as does a ready-run read still \`awaiting\` (\`awaitingReadyRun\` non-empty); its \`red\` or \`draft-skip-without-ready-trigger\` takes the Red path`.
- New bullet: `` - `RC=3` (ready-run `red` or `draft-skip-without-ready-trigger`) → **Red path**, reason from `{pr-ready-path}`: `check-failed:{names}` or `draft-skip-without-ready-trigger:{files}`. ``
- `RC=124`: `checks or head runs still running at the bound` becomes `checks, head runs or an awaited ready run still pending at the bound`.
- Park-comment fence: `printf 'Parked by merge-verification (%s): %s on PR #%s. Resume once green.\n' "$VALUE" "$REASON" "$PR" > "{park-comment-path}"` becomes `printf 'Parked by merge-verification (%s): %s on PR #%s. %s\n' "$VALUE" "$REASON" "$PR" "$RESUME" > "{park-comment-path}"`. The `(\`$REASON\` holds …)` parenthetical gains `; \`$RESUME\` holds \`{resume}\``. Both are `printf` arguments, never expanded inside the format string.

- [ ] **Step 1: Write the failing tests.**
  - `tests/merge-watch-ready-run.test.js` is the extract-and-run binding.
    - Extract the fence that contains `DEADLINE=` from `readText(…pr-first-merge.md)` with a regex anchored on the `**Bounded watch (` heading and the next `` ```bash `` … `` ``` `` (`\r?\n`).
    - Substitute every `{placeholder}` literally: `{pr-number}`→`7`, `{owner}/{repo}`→`o/r`, `{headRefOid}`→40×`c`, and the three paths→files under a `fs.mkdtempSync(os.tmpdir())` dir, forward-slashed.
    - Prepend shell-function stubs and append `echo "RC=$RC"`:
      - `gh() { case "$1 $2" in "pr checks") return 0;; "run list") echo '[]';; esac; }`
      - `sleep() { :; }`
      - A `date` stub driven by a counter file in `$STUB_DIR`. It answers `1000` on its first call, then `1000` or `5000` per the `DATE_MODE` env.
    - `CLAUDE_PLUGIN_ROOT` points at the temp dir's stub `bin/ready-run.js`. The stub prints `{"state": "<next from READY_SEQ>"}` from a comma list in the env, advances a counter file and logs one line per call.
    - Run under `bash --noprofile --norc -c`. Also run under `zsh -f -c` when `zsh` is on PATH; otherwise skip with a visible reason.
    - The cases:
      - `test('AC7.1: an awaiting ready-run read resumes the watch until met (RC=0 after two ready-run calls)', …)` with `READY_SEQ=awaiting,met`. Expect `RC=0` and a stub call count of 2.
      - `test('AC7.1: awaiting past the deadline ends RC=124 (checks-pending-timeout)', …)` with `READY_SEQ=awaiting,awaiting,…` and `DATE_MODE=jump`.
      - `test('red and draft-skip-without-ready-trigger end RC=3', …)`.
      - `test('read-failed ends RC=2', …)`.
      - `test('met and not-applicable end RC=0 on the first pass', …)`.
    - Go-red control: delete the `[ "$READY" = awaiting ]` line from the extracted fence in memory and rerun the AC7.1 case. The observable outcome must change, from 2 stub calls to 1. Assert that it changed.
  - In `tests/merge-verification-gate-conformance.test.js`:
    - Extend the `#3405` test's `zeroBranch` assertions:
      - It includes `bin/ready-run.js`.
      - It includes `[ "$READY" = awaiting ] && PENDING_RUNS=1` and `awaitingReadyRun`.
      - The awaiting line sits before the `"${PENDING_RUNS:-x}" = 0 ] && break` line (`requireOrder`).
      - The existing `zeroBranch` slice (`'0)'`…`'1)'`) still bounds the arm. Assert that `1)` is not found inside the four new lines.
    - New `test('AC7.2: the RC=0 bullet resumes the bounded watch on awaitingReadyRun and the 15-minute deadline literal is unchanged', …)`:
      - The `RC=0` slice contains `awaitingReadyRun` and `resumes the bounded watch` (the existing clause the new text extends).
      - The section contains `DEADLINE=$(( $(date +%s) + 900 ))` exactly once and the heading line ending `— 15 minutes, fixed.**`.
      - The `RC=3` bullet names `draft-skip-without-ready-trigger`.
      - The park-comment fence's format string has no `Resume once green` and ends `%s\n'`, followed by `"$VALUE" "$REASON" "$PR" "$RESUME"`. The fence is run in `tests/merge-watch-ready-run.test.js` with a `gh()` stub that records the `--body-file` content, using `RESUME='Resume once its workflow is fixed or a post-ready run lands.'`. The test asserts the written body ends with that sentence and does not contain `Resume once green`.
      - Mutation controls for each clause go through one helper with per-clause messages.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/merge-watch-ready-run.test.js`
Expected: FAIL — the file is absent before Step 1. After Step 1, AC7.1 ends after one stub call (the `0)` arm breaks green). `node --test tests/merge-verification-gate-conformance.test.js` fails on the Step 1 additions too.

- [ ] **Step 3: Apply the loop lines and the four prose edits.**

- [ ] **Step 4: Run the tests and measure**

Run: `node --test tests/merge-watch-ready-run.test.js tests/merge-verification-gate-conformance.test.js tests/session-tmp-root-migration.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/node-e-snippet-syntax.test.js tests/pr-first-merge.test.js tests/wrap-up-merge-mode-conformance.test.js`
Expected: PASS. `session-tmp-root-migration`'s `COMBINED_RESOLVE` is an `includes` over the unchanged prefix.

Run: `node plugin/bin/context-cost-report.js --plugin-root plugin`
Expected: merge `max` ≤ 51,500 (the hard gate). The simulation at authoring time gave 51,320. On a miss, trim this plan's new prose in Tasks 7–8, never existing operative text.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md tests/merge-verification-gate-conformance.test.js tests/merge-watch-ready-run.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-root-migration.test.js
git commit -m "Bounded watch re-applies the ready-run rule on gh pr checks exit 0; park comment carries its resume sentence — 15-minute deadline unchanged (#5153)"
```

---

### Task 9: Close-out re-reads CI after Mark ready; the resume rule reads the ready run

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/close-out.md`: step 1 at :34-41, and step 3 after the Mark-ready sentence at :77-79
- Modify: `plugin/skills/_shared/pr-first-merge-appendix.md` (`## Resume-to-merge`, moved in Task 5)
- Modify: `plugin/skills/dispatch/resume-confirmation.md:44` (its CI-status read list)
- Modify: `docs/journeys/recover-a-ci-parked-run.md:37` ("both of Step 2.5's reads" becomes the three reads)
- Test: `tests/close-out-ready-run-conformance.test.js`

**Interfaces:**
- Consumes: `bin/ready-run.js` (Task 3); the appendix section (Task 5).

Text:
- **close-out step 1:** after the head-run sentence, add `, plus Step 2.5's ready-run read (\`bin/ready-run.js\`: \`awaiting\` reads \`pending\`, \`red\` or \`draft-skip-without-ready-trigger\` reads \`failing\`, and \`read-failed\` stops this candidate as \`stopped: CI unreadable\`)`.
- **close-out step 3:** a new paragraph after `…would already be stale by the time a human reads it otherwise.`:

```markdown
   **Re-read CI after Mark ready.** When Mark ready ran, re-run step 1's read — the rollup, the
   head-run read and the ready-run read — against the now-ready PR before the confirmation gate,
   with step 1's stop rules (#5153). Right after `gh pr ready`, a workflow that declares
   `ready_for_review` has no run since the undraft yet, so this read is `pending` and stops the
   candidate; a later `close-out #{number}` reads the finished ready run.
```

- **Appendix `## Resume-to-merge`:** `(the state read and the head-run \`gh run list\` read; a not-yet-completed head run reads pending, a failing one red)` becomes `(the state read, the head-run \`gh run list\` read and the ready-run read; a not-yet-completed head run reads pending, a failing one red, an \`awaiting\` ready run pending, \`draft-skip-without-ready-trigger\` red)`. Keep `not-yet-completed head run reads pending` verbatim, since Task 5's retargeted pin needs it.
- **resume-confirmation.md:44:** after `a head run not yet completed reads \`pending\`` add `; and Step 2.5's ready-run read, \`bin/ready-run.js\` — \`awaiting\` reads \`pending\`, \`red\` or \`draft-skip-without-ready-trigger\` reads \`failing\``.
- **Journey:** `"Green" means both of Step 2.5's reads agree` becomes `"Green" means Step 2.5's three reads agree`. Add one clause: the ready-run read has no `awaiting` workflow.

- [ ] **Step 1: Write the failing test** in `tests/close-out-ready-run-conformance.test.js`. All reads go through `readText`.
  - `test('AC8.1 AC8.2: close-out performs a CI read after its Mark-ready call and before the confirmation gate', …)`:
    - `requireOrder(text, ['3. **Convert draft to ready', "run \`_shared/pr-first-merge.md\`'s Step 2 (Mark ready) now", '**Re-read CI after Mark ready.**', '4. **Confirmation gate.**'])`. The helper asserts that each index is not `-1`, each with its own message, before comparing.
    - One permutation control per adjacent pair: splice the later block above the earlier one in memory and match the helper's ordering message.
    - One deletion control for the new marker, matched to the existence message.
  - `test('the post-Mark-ready re-read names the ready-run read and stops on pending', …)`: inside the paragraph, `ready-run read` and `step 1's stop rules`.
  - `test('close-out step 1 and resume-confirmation name bin/ready-run.js; the appendix resume rule names the ready-run read and keeps its pinned clause', …)`.
  - `test('the recover-a-ci-parked-run journey names three reads and quotes the park comment with {resume}', …)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/close-out-ready-run-conformance.test.js`
Expected: FAIL — the test file is absent before Step 1. After Step 1, `**Re-read CI after Mark ready.**` is not found.

- [ ] **Step 3: Apply the five text edits.** Step-position check: close-out may run from the main checkout with no run worktree. `bin/ready-run.js` reads the head's workflows from the shared object store. A missing head object falls back to the contents API at that ref. Only both failing is `read-failed`, with a `git fetch origin pull/{n}/head` remedy, which this step reports as `stopped: CI unreadable`.

Also update the journey's park-comment template quote (`docs/journeys/recover-a-ci-parked-run.md:14`) to the `{resume}` form from Task 7(d).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/close-out-ready-run-conformance.test.js tests/close-out-pr-state-contract-conformance.test.js tests/merge-verification-gate-conformance.test.js tests/dispatch-resume-prose.test.js tests/acceptance-labeling-landed-check.test.js tests/verify-json-acceptance-guard-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/close-out.md plugin/skills/_shared/pr-first-merge-appendix.md plugin/skills/dispatch/resume-confirmation.md docs/journeys/recover-a-ci-parked-run.md tests/close-out-ready-run-conformance.test.js
git commit -m "Close-out re-reads CI after Mark ready; the resume rule reads the ready run (#5153)"
```

---

### Task 10: Verification

**Files:**
- Waived (read only): every file above.

- [ ] **Step 1: Full-suite verification through the repo's runner.** The orchestrator runs this centrally.

Run: `node /Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.164.0/bin/verify.js`
Expected: PASS (a full run; this change touches `plugin/bin/` and shared skill contracts, so no `--scope` subset applies).

- [ ] **Step 2: Final bundle measurement**

Run: `node plugin/bin/context-cost-report.js --plugin-root plugin`
Expected: every `"step":"merge"` row's `max` ≤ 51,500. Record the number in the run's `decisions.md` as `AC evidence` (`log-decision.js --section "/build" --status AUTO --step "AC evidence"`), with output in `$PIPELINE_RUN_DIR/evidence/merge-bundle-bytes.txt`.

---

## Acceptance-criterion traceability

| AC | Clause(s) | Task(s) | Test |
|---|---|---|---|
Clause ids are the ones `plan-audit.js --spec` derives (Check E: 22 clauses, 0 uncovered).

| AC | Clause(s) | Task(s) | Test |
|---|---|---|---|
| AC1 | AC1.1 draft-time results, AC1.2 no run since ready, AC1.3 pre-ready run or re-run | 2 | `classify.test.js` `AC1.1`/`AC1.2`/`AC1.3` |
| AC2 | AC2.1 in progress → pending, fail → red, success → green | 2 | `classify.test.js`, three `AC2.1` tests |
| AC3 | AC3.1 red wins while a ready run is awaited | 2, 7 | `classify.test.js` `AC3.1`; `pr-first-merge.test.js` `AC3.1 (prose)` |
| AC4 | AC4.1 absent/empty inputs leave every verdict unchanged | 2, 4 | `classify.test.js` `AC4.1`; `cli.test.js`'s default `readyRun` stub keeps every existing CLI case byte-identical |
| AC5 | AC5.1 types (flow, block, default), AC5.2 draft reference, AC5.3 `unparsed`, AC5.4 one unit test per case | 1 | `merge-verification.test.js` `AC5.1`/`AC5.2`/`AC5.3`; AC5.4 by construction (each case its own test) |
| AC6 | AC6.1 parks on a draft skip with default types, AC6.2 `ready_for_review` does not | 3, 7, 8 | `ready-run.test.js` `AC6.1`/`AC6.2`; `pr-first-merge.test.js` `AC6.1`/`AC6.2`; `merge-watch-ready-run.test.js` `RC=3` case |
| AC7 | AC7.1 `RC=0` branch re-applies the rule, AC7.2 conformance pin plus unchanged deadline | 8 | `merge-watch-ready-run.test.js` `AC7.1` (both); `merge-verification-gate-conformance.test.js` `AC7.2` |
| AC8 | AC8.1 CI read after Mark ready and before the gate, AC8.2 the ordering is pinned | 9 | `close-out-ready-run-conformance.test.js` `AC8.1`/`AC8.2` |
| AC9 | AC9.1 file exists, AC9.2 three citers and four points | 6, 7 | `ci-skips-drafts-conformance.test.js` `AC9.1`/`AC9.2`; `pr-first-merge.test.js` `AC6.1` (the `pr-first-merge.md` citer) |
| AC10 | AC10.1 Actions minutes plus citation, AC10.2 `≥50× headroom` survives | 6 | `ci-skips-drafts-conformance.test.js` `AC10.1`/`AC10.2` |
| AC11 | AC11.1 byte-pinned tests updated deliberately, AC11.2 full suite passes | 5, 7, 8, 10 | `pr-first-merge.test.js` `AC11.1` (two tests); `merge-verification-gate-conformance.test.js` retarget (Task 5) and extension (Task 8); `pr-check-gate-conformance.test.js` twin (Task 7); AC11.2 is Task 10's full `verify.js` run |

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (classifier inputs, `awaitingReadyRun`) | 2 (and 4 for `pr-checks.js`) |
| Deliverable 2 (draft skip without ready trigger, explicit `off` logs) | 1 (detection), 3 (state), 7 (park and the `off` rule), 8 (`RC=3`) |
| Deliverable 3 (workflow reader, `unparsed`) | 1 |
| Deliverable 4 (Step 2.5 reads, classification, `RC=0`) | 3 (reads), 7, 8 |
| Deliverable 5 (close-out ordering) | 9 |
| Deliverable 6 (convention) | 6 |
| Deliverable 7 (`git-discipline.md` rationale) | 6 |
| Deliverable 8 (`ci-source.md` ruling) | 6 |
| Key Files: `pr-first-merge-appendix.md` capture note | 5 (capture (f)) |
| Technical Approach: timeline read, path identity, head workflow files, coexistence ruling, `pr-checks.js` parity | 3, 3, 3, 6, 4 |
| Gotchas: fixed watch, extra wait trade, heuristic fails closed, out-of-scope readers, last ready event, neighbours | 8, 6, 1, Waived lines, 3, risk |
