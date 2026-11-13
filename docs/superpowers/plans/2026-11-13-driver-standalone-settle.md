# Driver standalone settle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `drive.js` settles its own stops (comment, label, release, worktree/branch removal) by a fixed table in `plugin/bin/lib/driver/settle.js`, with a `--no-settle` opt-out, ceiling stops settled as escalations, a driver-escalation marker gate in admission, and a usage page.

**Architecture:** `settle.js` is a data table (`SETTLE_ROWS`) plus one runner, `settle(input, deps)`, that `run.js`'s `driveRecord` calls once a record halts, before the final line. Every call goes through the existing `deps` seam (`gh`, `git`, `node`, `writeFile`, `lstatType`, new `readFile`) and emits one event line through `run.js`'s sink. Steps in `steps.js` set `stop.reason` to a closed-set value the settle reads (`failing-test`, check's reason, `express-error`, `claim-exit-{code}`), so a caller passing `--no-settle` gets the same classification from the final line's `stop` object.

**Tech Stack:** Node 18+ CommonJS, `node --test`, the driver's injected-deps harness (`tests/bin-lib/driver/run.test.js`), real git for one test (`tests/helpers/git-fixtures.js`).

**Spec:** `.claude-tweaks/pipelines/2026-11-13T000400-spec-5219/work/5219-spec.md` (record #5219)

**Scope keywords:** settle, express-driver: escalated, no-settle, settleFailed

## Global Constraints

- No model call in any settle path: `settle.js` must not require `plugin/bin/lib/driver/worker.js` or `roles.js`, directly or by name in code (AC6).
- Settle calls are never retried. A failed call is an event line with status `fail` and its own `step`, and the remaining calls still run, except the one exception in the pre-push row (a failed `escalate` switches to the blocked row's remaining calls) (AC7, AC1).
- `release-claim.js` is never called with `--remove-grants`. Its exit 3 (already released) and exit 4 (held by another run) are not failures.
- No `gh pr close`, `gh pr merge` or `gh pr ready` anywhere in settle. The harness's AC8 refusal of `pr merge` and `pr ready` stays.
- Comment and detail-file text = fixed templates + closed-set fields (step name, outcome word, escalation reason, exit code) + `reduceDetail(detail)` only (AC10).
- Final-event fields are added, never renamed (events.js header; design "Event lines").
- Worktree removal and branch deletion use `git -C {mainRoot}` explicitly, never the driver's cwd.
- Governing skill `driver-step-addition`, quoted: "Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one". Settle step names live in `events.js` (`SETTLE_STEP_NAMES`) and `settle.js`, never as literals in `run.js`.
- Governing skill `driver-step-addition`, quoted: "A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else."
- Governing skill `driver-step-addition`, quoted: "Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3)." Settle comments go further: `reduceDetail` (AC10), never raw `stop.detail`.
- Governing skill `driver-step-addition`, quoted: "Event fields may be added but never renamed, because the settle unit reads the final line's `stop`".
- Governing skill `fact-validated-narration`, quoted: "Write down, up front, every string in the output that did not come from a validated ref, and neutralize all of them in one pass." Free-text channels into settle's forge writes, enumerated: `stop.detail` (worker/test/check/git/gh text), the escalation reason (closed set), the step name (closed set), the claim exit code (integer), the release `--reason` text (template only). Only `stop.detail` is free text, and it reaches the forge only through `reduceDetail`.
- Governing skill `bin-source-scan-conformance`, quoted: "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`. From a `tests/bin-lib/` suite the path is `../helpers/strip-comments`." and "A scan reports `misparsed` and `unparseable` as an offender". A new caller's test-file stem (`settle`) joins the roster in `tests/helpers/strip-comments.js`'s header, which `tests/strip-comments-callers-twin.test.js` pins.
- Governing skill `windows-checkout-test-parity`: the real-git test must not compare a path built with `path.join` against `git worktree list --porcelain` output. Assert removal with `lstatType`/`fs.existsSync` in the test and on the branch ref, not on a listed path string.
- Path-guard scan: no bare `fs.existsSync`/`fs.realpathSync` under `plugin/bin/`. Settle checks existence through `deps.lstatType`.

## Review Focus

1. **A locked worktree.** The worktree step creates the worktree with `--lock` (steps.js). A single `--force` refuses to remove a locked worktree, so settle must pass `--force --force` (Task 3's real-git test locks its fixture).
2. **A `check` escalation with `logged: false`.** The check step used to hand-log its own escalation line, and settle's `escalate` call would then write a second one. Task 5 removes the hand-log for the escalate branch only (the proceed branch keeps its hand-log). Tests in Tasks 2 and 6 pin that exactly one escalation line source runs.
3. **A later pre-push stop after a proceeding `check`** (a push HEAD mismatch with `checkLogged: true`). It must still call `escalate`: the skip applies only when the stop is the check step's own verdict (Task 2 test).
4. **A hostile detail.** An `@mention`, a markdown link, a home-directory path, a drive-letter path, a gh token, a 40-hex run, `closes #12`, an HTML comment opener. None may reach a comment or the escalate detail file (Task 1 test).
5. **A worktree or branch already gone** at settle time (removed by hand, or never created because a leftover refused the worktree step). This is not a failure, and nothing is removed that this run did not create (Tasks 2 and 3).

---

## File map

- Create `plugin/bin/lib/driver/settle.js`: `reduceDetail`, `commentFor`, `DRIVER_ESCALATION_MARKER`, `hasDriverEscalationMarker`, `toEscalationReason`, `selectRow`, `SETTLE_ROWS`, `settle`.
- Modify `plugin/bin/lib/driver/events.js`: add `SETTLE_STEP_NAMES`.
- Modify `plugin/bin/lib/driver/steps.js`: stop reasons, ceiling detail, `spendOverrun` on `ctx.worker`, remove check's escalate hand-log, `comments` field, admission marker fact. (Not in the spec's Key Files, but the record fetch and the admission step live here, not in `run.js`. This is a plan amendment.)
- Modify `plugin/bin/lib/driver/admission.js`: marker gate.
- Modify `plugin/bin/lib/driver/run.js`: `--no-settle`, settle call, final-event fields, `readFile` dep.
- Modify `plugin/bin/drive.js`: usage comment line for `--no-settle`.
- Create `tests/bin-lib/driver/settle.test.js`. Modify `tests/bin-lib/driver/admission.test.js` and `tests/bin-lib/driver/run.test.js`, plus `tests/helpers/strip-comments.js` (roster stem).
- Create `docs/driver.md`. Modify `docs/REGISTRY.md` and `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`.

Waived `plugin/bin/lib/express/cli.js`: read only, for `ESCALATION_REASONS` and the `escalate` contract (Task 2 imports the constant).
Waived `plugin/bin/release-claim.js`: read only, for its exit codes (Task 2).
Waived `plugin/bin/lib/express/sampling.js`: read only. Its comment-trust rule is reused through `plugin/bin/lib/issues/comment-trust.js`'s `isTrustedComment` (Task 1).
Waived `_shared/express-lane.md`: read only, for its Escalation and Outcomes rules, carried into `SETTLE_ROWS` (Task 2).
Waived `tests/helpers/git-fixtures.js`: read only, `gitRepo()` (Task 3).
Waived `plugin/bin/lib/driver/worker.js`, `plugin/bin/lib/driver/roles.js`: read only, for the ceiling envelope reasons (Task 5) and the worker rights `docs/driver.md` summarizes (Task 7). `settle.js` must never require them.

---

### Task 1: settle.js pure helpers (detail reduction, templates, marker)

**Files:**
- Create: `plugin/bin/lib/driver/settle.js`
- Create: `tests/bin-lib/driver/settle.test.js`
- Modify: `tests/helpers/strip-comments.js` (header roster: add `` `settle` `` between `` `run-liveness-callers` `` and `` `staged-id-producers` ``)

**Interfaces:**
- Produces:
  - `DRIVER_ESCALATION_MARKER = '<!-- express-driver: escalated -->'`
  - `reduceDetail(text: unknown) -> string`. Never longer than 200 characters; `'none'` when empty after reduction.
  - `commentFor(kind: 'escalated'|'blocked-record'|'blocked-pr'|'claim', fields: { step, outcome, reason?, exitCode?, detail, kept? }) -> string`. `detail` is passed through `reduceDetail` inside.
  - `escalateDetailText({ step, detail }) -> string`. The escalate `--detail-file` content, a fixed template.
  - `hasDriverEscalationMarker(comments: unknown) -> true|false|null`. `null` when `comments` is not an array.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/settle.test.js`:
  - `AC10.1, AC10.2: reduceDetail strips a hostile detail`. The input is `'@octocat see [here](https://evil.example/x) /Users/alice/.ssh/id_rsa ghp_' + 'a'.repeat(36) + ' C:\\Users\\bob\\x ' + 'f'.repeat(40) + ' closes #12 <!-- hi --> `code`'`. The output must contain none of `@`, `[`, `](`, `/Users/`, `ghp_`, `'f'.repeat(40)`, `#`, `<!--` (as a substring before placeholder insertion: assert `!/<!--/.test(out)`), `C:/Users`, or a backtick. It must include `at octocat`, `<path>` and `<redacted>`, and `out.length <= 200`.
  - `AC10.1: reduceDetail keeps only the allowed characters`: `reduceDetail('a\tb\nc$%^&*=+!?~|{}"\'é')` matches `/^[A-Za-z0-9 .,:;_()\/-]*$/`. Placeholders are added after filtering, so assert this on an input that yields none.
  - `AC10.1: reduceDetail caps at 200 and never ends in a partial placeholder`: `'x '.repeat(150) + '/abs/path'` → length ≤ 200, `!/<[a-z]*$/.test(out)`. `reduceDetail('')` and `reduceDetail(null)` → `'none'`.
  - `AC10.1: every comment kind is built from the template plus a reduced detail`: for each kind, `commentFor(kind, { step: 'push', outcome: 'blocked', reason: 'express-error', exitCode: 4, detail: HOSTILE })` contains no `@`, `/Users/`, `ghp_`, `#12`, and contains `reduceDetail(HOSTILE)`.
  - `AC11.1: the escalated comment ends with the marker` (`commentFor('escalated', …).endsWith(DRIVER_ESCALATION_MARKER)`), and no other kind contains it.
  - `AC11.1: hasDriverEscalationMarker trusts only OWNER/MEMBER/COLLABORATOR`: `[{ authorAssociation: 'MEMBER', body: 'x\n\n' + MARKER }]` → `true`. The same body with `'NONE'` → `false`; with the association absent → `false`. `[]` → `false`. `'x'`, `null`, `{}` → `null`. A trusted body that only quotes the marker mid-text (`MARKER + ' later text'`) → `false`.
  - `AC6.1: settle.js requires no model module`: read `plugin/bin/lib/driver/settle.js`, `const stripped = stripComments(raw)`, then `assert.equal(stripperVerdict(raw, stripped), 'ok', STRIPPER_VERDICT_MESSAGES[...])`, and assert `stripped` matches neither `/require\([^)]*\b(worker|roles)\b/` nor `/['"]\.\/(worker|roles)(\.js)?['"]/`. The go-red control: the same matcher run on a planted string `"const w = require('./worker');"` must match.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/driver/settle.test.js`
  Expected: FAIL (`Cannot find module '…/driver/settle'`).

- [ ] **Step 3: Implement the helpers in `plugin/bin/lib/driver/settle.js`.** The header comment names this module's `SETTLE_ROWS` as the settle table's source of truth and says that `docs/driver.md` and the design document copy it by hand. `reduceDetail` works in this fixed order (an algorithm the signature does not determine):
  1. `String(text ?? '')`, then `\` → `/`.
  2. `@` → `at `.
  3. Every character outside `[A-Za-z0-9 .,:;_()/-]` → a space.
  4. Tokens → `<redacted>`: `/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g` and `/[0-9A-Fa-f]{40,}/g`.
  5. Paths → `<path>`: a drive-letter path `/\b[A-Za-z]:\/\S*/g`, and an absolute path `/(^|[\s(:,;])\/{1,2}[A-Za-z0-9._-]\S*/g` → `$1<path>`. Because of the `:` delimiter, `https://evil/x` becomes `https:<path>`.
  6. Collapse whitespace, trim, `slice(0, 200)`, strip a trailing `/<[a-z]*$/`, trim; return `'none'` when empty.

  `hasDriverEscalationMarker` uses `isTrustedComment` from `../issues/comment-trust` and `body.trimEnd().endsWith(DRIVER_ESCALATION_MARKER)`. Exact template copy (`{detail}` is `reduceDetail`'s output):
  - `escalated`: ``The pipeline driver (drive.js) stopped this record before pushing, at step {step}: outcome express-escalated, reason {reason}. Detail: {detail}\n\nThe claim was released and the worktree and local branch this run created were removed. The driver will not take this record again while this comment stands; the standard path builds it. Delete this comment to let the driver take it again.\n\n<!-- express-driver: escalated -->``
  - `blocked-record`: ``The pipeline driver (drive.js) stopped this record at step {step}: outcome blocked. Detail: {detail}\n\nLabelled bot:blocked and the claim released. {kept}Clear bot:blocked to let the record be driven again.``, where `{kept}` is `'The draft PR, branch and worktree were kept for a human. '` when `kept` is true, else `''`.
  - `blocked-pr`: ``The pipeline driver (drive.js) stopped at step {step}: outcome blocked. Detail: {detail}\n\nThis draft PR, its branch and its worktree are kept for a human.``
  - `claim`: ``The pipeline driver (drive.js) could not claim this record: step {step} failed{ (claim-targets.js exit {exitCode})}. Detail: {detail}\n\nLabelled bot:blocked. Clear bot:blocked to let the record be driven again.``. The parenthetical appears only when `exitCode` is an integer.
  - `escalateDetailText`: `drive.js stopped at step {step}: {detail}`.

  Add `` `settle` `` to the `tests/helpers/strip-comments.js` roster.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/settle.test.js tests/strip-comments-callers-twin.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/driver/settle.js tests/bin-lib/driver/settle.test.js tests/helpers/strip-comments.js`, then `git commit -m "Add settle.js helpers — detail reduction, comment templates, escalation marker (#5219)"`.

### Task 2: the settle table and runner (fake runner)

**Files:**
- Modify: `plugin/bin/lib/driver/settle.js`
- Modify: `plugin/bin/lib/driver/events.js`
- Test: `tests/bin-lib/driver/settle.test.js`

**Interfaces:**
- Consumes: Task 1's helpers. `ESCALATION_REASONS` from `../express/cli`. `STOP_CLASSES` and `STEP` from `./events`. `LABELS.BOT_BLOCKED` (`'bot:blocked'`) from `../issues/record-vocabulary`.
- Produces:
  - `events.js`: `SETTLE_STEP_NAMES = Object.freeze(['settle-escalate', 'settle-comment-pr', 'settle-comment-record', 'settle-label', 'settle-release', 'settle-remove-worktree', 'settle-delete-branch'])`, exported. `STEP_NAMES` is unchanged (still 17 entries).
  - `toEscalationReason(reason: unknown) -> 'failing-test'|'out-of-bounds'|'gate-denial'|'express-error'`. A member of `ESCALATION_REASONS` passes through; anything else becomes `'express-error'`.
  - `selectRow(stop, { prRecorded: boolean }) -> { row: 'refused'|'claim-contested'|'claim'|'pre-push'|'blocked'|'none', unclassified: boolean }`:
    - `refused` → `refused`.
    - `claim` with `reason === 'claim-exit-3'` → `claim-contested`.
    - Any other `claim` → `claim`.
    - `pre-push` with `stop.pushed || prRecorded` → `blocked`.
    - Any other `pre-push` → `pre-push`.
    - `blocked` → `blocked`.
    - `none` → `none`.
    - Anything else → `blocked` with `unclassified: true`.
  - `SETTLE_ROWS`: frozen `{ [row]: string[] }` of settle step names in call order. `refused: []`, `'claim-contested': []`, `none: []`, `claim: ['settle-comment-record', 'settle-label']`, `'pre-push': ['settle-escalate', 'settle-comment-record', 'settle-release', 'settle-remove-worktree', 'settle-delete-branch']`, `blocked: ['settle-comment-pr', 'settle-comment-record', 'settle-label', 'settle-release']`.
  - `settle(input, deps) -> { row, settledClass, calls: [{ step, status, detail }], failed: string[], unclassified: boolean, note: string|null }`.
    - `input = { stop, record, runId, runDir, wt, branch, pr /* number|null */, claimed, mainRoot, ghRepo, emit(step, status, ms, detail) }`.
    - `deps` uses `gh`, `git`, `node`, `writeFile`, `readFile`, `lstatType`, `now`.
    - `settledClass` is the class the run was finally settled as: `blocked` when the row ended as `blocked` (the safety net or a failed escalate), else `stop.class`. For `claim-contested` and `claim` it is `claim`.

- [ ] **Step 1: Write the failing tests** (fake `deps` recording every call in order, as `run.test.js`'s harness does; `gh`/`git`/`node` answer from a script; `readFile` throws ENOENT by default):
  - `AC1.1: a pre-push stop check did not log runs escalate, comment, release, worktree removal, branch deletion in order`. Use stop `{ step: 'test', class: 'pre-push', pushed: false, created: { worktree: true, branch: true }, reason: 'failing-test', detail: 'red tests', checkLogged: null }`; `lstatType(wt)` → directory; the branch rev-parse succeeds. The recorded calls, in order:
    1. `node express-lane.js escalate --run {runDir} --issue 7 --reason failing-test --detail-file {runDir}/settle-escalate.txt`, with the file written beforehand and holding `escalateDetailText`.
    2. `gh issue comment --repo {ghRepo} --body {commentFor('escalated')} -- 7`.
    3. `node release-claim.js 7 --run {runDir} --reason "drive.js settle: express-escalated at test"`, with no `--remove-grants`.
    4. `git -C {mainRoot} worktree remove --force --force {wt}`.
    5. `git -C {mainRoot} branch -D --end-of-options drive-record-7`.

    Returns `row: 'pre-push'`, `failed: []`. `AC11.9`: no `gh issue edit` (no label) is recorded for this row.
  - `AC1.2: a check verdict that logged its own line skips escalate`: stop `step: 'check'`, `checkLogged: true`, `reason: 'out-of-bounds'`. No `express-lane.js` call; the other four run in order.
  - `AC1.3: check logged:false calls escalate with check's reason and detail`: `step: 'check'`, `checkLogged: false`, `reason: 'gate-denial'`, `detail: 'gate-denial: x'`. The escalate argv carries `--reason gate-denial`, and the detail file contains `reduceDetail('gate-denial: x')`.
  - `Review focus 3: a pre-push stop after a proceeding check still escalates`: `step: 'push'`, `checkLogged: true`, `reason: 'stop'` → escalate is called with `--reason express-error`.
  - `AC1.4: a failed escalate keeps the worktree and branch and settles by the blocked row`: escalate replies `{ code: 1 }`. The calls are escalate (`fail`), then `settle-comment-record` with the `blocked-record` body (no marker), `settle-label` (`gh issue edit --repo R --add-label bot:blocked -- 7`), `settle-release`. No `worktree remove`, no `branch -D`. Returns `row: 'blocked'`, `settledClass: 'blocked'`, `failed: ['settle-escalate']`. A thrown escalate takes the same path.
  - `AC2.1: a blocked stop after the push comments on PR and record, labels, releases, removes nothing`: stop `{ step: 'set-config', class: 'blocked', pushed: true }`, `pr: 9`. The calls are `gh pr comment --repo R --body {blocked-pr} -- 9`, the record comment with `kept: true`, the label, the release. No argv contains `pr close`, `worktree remove` or `branch -D`.
  - `AC2.2: a failed gh pr create (pushed, no PR) comments on the record only and keeps worktree and branch`: `{ step: 'pr', class: 'blocked', pushed: true }`, `pr: null`, `readFile` ENOENT → no `gh pr comment`, the other three run.
  - `AC2.3: a pre-push stop with pushed true is settled by the blocked row` (the safety net): `class: 'pre-push', pushed: true` → `row: 'blocked'`, no escalate, no removal.
  - `AC2.4: a record-pr failure after the PR was created comments on the PR, keeps the worktree and branch`: `{ step: 'record-pr', class: 'blocked', pushed: true }`, `pr: 9`.
  - `AC2.5: run-state.json recording a PR makes a pre-push stop blocked`, written by the real writer: `require('../../../plugin/bin/lib/hooks/context').writeRunState(tmpRunDir, { pr: { number: 11, url: 'https://github.com/acme/w/pull/11' } })` with `readFile: (p) => fs.readFileSync(p, 'utf8')` → `row: 'blocked'`, and `gh pr comment … -- 11`.
  - `AC3.1: a refusal makes no call`: `class: 'refused'` → zero recorded calls, `row: 'refused'`.
  - `AC3.2: a claim held by another run makes no call`: `class: 'claim', reason: 'claim-exit-3'` → zero calls, `row: 'claim-contested'`, `settledClass: 'claim'`.
  - `AC3.3: other claim failures write exactly the record comment and bot:blocked`: for each of `claim-exit-4`, `claim-exit-5`, `claim-exit-6`, `claim-exit-7` and a mint failure (`step: 'run-dir', reason: 'fail'`, `runDir: null`), the calls are exactly `gh issue comment` (with the `claim` body naming `exit {n}`, except for the mint failure) and `gh issue edit --add-label bot:blocked`, and no `release-claim.js`. `note` is non-null for `claim-exit-5` and for `claimed: true`, else null.
  - `AC3.4: a pre-push stop whose created says nothing was made removes nothing`: `created: { worktree: false, branch: false }` → no `worktree remove`, no `branch -D`, no rev-parse of the branch.
  - `Review focus 5: a worktree or branch already gone is not a failure`: `lstatType(wt)` → missing, and the branch rev-parse throws `{ status: 1 }`. Both calls report `ok` with detail `already gone`, and `failed: []`.
  - `AC7.1: a failing call does not stop the rest and is never retried`: `gh issue comment` throws → `settle-comment-record` is `fail`; the release, worktree and branch calls still run; each command is recorded exactly once; `failed` equals `['settle-comment-record']`; `input.emit` is called once per call, with status `fail` for the failed one.
  - `AC7.2: release exit 3 and exit 4 are not failures`: release `{ code: 3 }` → `ok`, detail `already released`; `{ code: 4 }` → `ok`, detail `held by another run`; `{ code: 1 }` → `fail`.
  - `AC8.1: a none stop makes no call` → `row: 'none'`, zero calls.
  - `AC8.2: an unknown class is settled by the blocked row and named unclassified`: `class: 'bogus'` → `row: 'blocked'`, `unclassified: true`, and the blocked calls run.
  - `AC6.2: settle never calls a launcher`: pass `deps.launchWorker = () => { throw new Error('launcher called') }` through every scenario above. None throws from it.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/driver/settle.test.js`
  Expected: FAIL (`settle is not a function`).

- [ ] **Step 3: Implement `SETTLE_STEP_NAMES` in `events.js`, and `toEscalationReason`, `selectRow`, `SETTLE_ROWS` and `settle` in `settle.js`.** `settle` reads `prRecorded` as `input.pr ?? run-state.json's pr.number` (via `deps.readFile(path.join(runDir, 'run-state.json'))`; unreadable means no PR). The PR comment uses that same number. Each call is wrapped: a throw or a non-zero exit is `fail`, with a `firstLine`/`errorText`-style detail passed through `neutralize`; the result is emitted via `input.emit(step, status, ms, detail)` and pushed to `calls`. Release runs only when `runDir` is set; with none it is a `fail` with detail `no run directory`. A call whose own precondition fails (worktree removal while `created.worktree` is false, the PR comment with no PR) is not made and not emitted. `settle-remove-worktree` checks `deps.lstatType(wt).type === 'missing'` first (→ `ok`, `already gone`). `settle-delete-branch` checks `git -C mainRoot rev-parse --verify --quiet --end-of-options refs/heads/{branch}`; exit 1 means `ok`, `already gone`. Release `--reason`: `drive.js settle: {outcome} at {step}` (outcome from `OUTCOME_BY_CLASS[settledClass]`). The claim-row note text: `a claim that may have been written lapses by its TTL`.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/settle.test.js tests/bin-lib/driver/run.test.js`
  Expected: PASS. `run.test.js` is unchanged so far (it pins `STEP_NAMES.length === 17`).

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/driver/settle.js plugin/bin/lib/driver/events.js tests/bin-lib/driver/settle.test.js`, then `git commit -m "Add the driver settle table and runner — fixed calls per stop row (#5219)"`.

### Task 3: real-git worktree and branch removal

**Files:**
- Test: `tests/bin-lib/driver/settle.test.js`
- Modify: `plugin/bin/lib/driver/settle.js` (only if the real run disagrees with the argv chosen in Task 2)

**Interfaces:**
- Consumes: `settle(input, deps)` from Task 2. `gitRepo()` from `tests/helpers/git-fixtures.js`.

- [ ] **Step 1: Write the test** `AC1.5: real git — a pre-push settle removes the locked worktree and the local branch`. Build a repo with `gitRepo()`. Run `git -C {repo} worktree add --lock --reason "drive.js record 7 (pid 1)" -b drive-record-7 {repo}/.claude/worktrees/drive-record-7`. Commit one file inside the worktree, so the branch has local work that `--force` must discard. Pin the commit's identity through `env` (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`), because CI exports its own `GIT_AUTHOR_*`. Call `settle` with real `git: (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })`, `lstatType` from `plugin/bin/lib/path-guard`, and fake `gh`/`node` returning success. The stop is `{ step: 'test', class: 'pre-push', pushed: false, created: { worktree: true, branch: true }, reason: 'failing-test' }`. Assert:
  - `failed` is `[]`.
  - `fs.existsSync(wt)` is false.
  - `git -C repo rev-parse --verify --quiet refs/heads/drive-record-7` exits 1.
  - `git -C repo worktree list --porcelain` has no `branch refs/heads/drive-record-7` line.

  Then run the same `settle` again: both calls are `ok` with detail `already gone`.

- [ ] **Step 2: Run it**
  Run: `node --test --test-name-pattern "AC1.5" tests/bin-lib/driver/settle.test.js`
  Expected: PASS. If git refuses `--end-of-options` on `branch -D`, or the double force on `worktree remove`, fix the argv in `settle.js` and in Task 2's argv assertions together.

- [ ] **Step 3: Prove it goes red.** Temporarily change `--force --force` to a single `--force` in `settle.js`. The test must fail (locked worktree) and the scratch change is then reverted. Run: `node --test --test-name-pattern "AC1.5" tests/bin-lib/driver/settle.test.js`, Expected: FAIL; after the revert: PASS.

- [ ] **Step 4: Commit**
  `git add tests/bin-lib/driver/settle.test.js plugin/bin/lib/driver/settle.js`, then `git commit -m "Pin worktree and branch removal against real git — locked worktree (#5219)"`.

### Task 4: admission refuses a record the driver escalated

**Files:**
- Modify: `plugin/bin/lib/driver/admission.js`
- Modify: `plugin/bin/lib/driver/steps.js` (fetch step `ISSUE_JSON_FIELDS`, admission step input)
- Test: `tests/bin-lib/driver/admission.test.js`, `tests/bin-lib/driver/run.test.js` (`issueFor` gains `comments: []`; the admission-input assertions)

**Interfaces:**
- Consumes: `hasDriverEscalationMarker` (Task 1).
- Produces:
  - `ADMISSION_REASONS.escalatedByDriver = 'already escalated by the driver'`, `ADMISSION_REASONS.commentsUnreadable = 'record comments unreadable'`.
  - `evaluateAdmission` takes a new fact, `driverEscalated: true|false|other`: `true` → `escalatedByDriver`; anything not a boolean → `commentsUnreadable`; `false` → nothing.
  - steps.js: `ISSUE_JSON_FIELDS = 'number,title,body,labels,state,comments'`. The admission step passes `driverEscalated: hasDriverEscalationMarker(ctx.issue.comments)` (null is turned into the unreadable reason by admission).

- [ ] **Step 1: Write the failing tests** in `admission.test.js`:
  - `AC11.2: a trusted marker refuses with its own reason`: the full admitting facts plus `driverEscalated: true` → `admitted: false`, `reasons` equals `['already escalated by the driver']`.
  - `AC11.3: an untrusted marker does not refuse`: `driverEscalated: hasDriverEscalationMarker([{ authorAssociation: 'NONE', body: MARKER }])` → `admitted: true`.
  - `AC11.4: an unreadable comment list fails closed`: `driverEscalated: null` and `undefined` → `reasons` includes `'record comments unreadable'`.
  - `AC11.5: the gate alone refuses`: with every other fact admitting, `driverEscalated: true` is the only reason. The go-red check: comment out the `escalatedByDriver` push in `admission.js`, see this test fail, then restore.

  The existing all-admitting fixture in `admission.test.js` gains `driverEscalated: false`.

  In `run.test.js`: `issueFor(n)` gains `comments: []`; the fetch assertion expects `--json number,title,body,labels,state,comments`; and one test, `AC11.6: run.js supplies the marker fact from the record fetch`, scripts `gh issue view` to return a trusted marker comment and asserts the admission input carries `driverEscalated: true`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/run.test.js`
  Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** the reasons and the gate in `admission.js` (update its header's closed-rule list of refusals), the field and the admission input in `steps.js`.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/run.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/driver/admission.js plugin/bin/lib/driver/steps.js tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/run.test.js`, then `git commit -m "Refuse driver admission for a record carrying the escalation marker (#5219)"`.

### Task 5: steps carry the settle's classification on the stop

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js`
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: `toEscalationReason` (Task 2).
- Produces (the final line's `stop.reason` values the settle reads):
  - test step, red tests → `reason: 'failing-test'`.
  - check step, escalate → `reason: toEscalationReason(envelope.reason)`.
  - worker step, `envelope.status !== 'ok'` → `reason: 'express-error'`; detail for `timeout`/`wall-clock-ceiling` is `timeout/wall-clock-ceiling: wall-clock ceiling of {minutes} minutes reached` plus `: {why}` when `why` is non-empty; for `fail`/`spend-ceiling` it is `fail/spend-ceiling: spend ceiling of {dollars} dollars reached` plus `: {why}`; other reasons keep today's detail.
  - claim step, non-zero exit → `reason: 'claim-exit-{code}'`.
  - `ctx.worker.spendOverrun = envelope.spendOverrun === true`.
  - check step, escalate with `logged: false`: no hand-logged escalation line any more (settle's `escalate` writes it). The proceed branch's hand-log is unchanged.

- [ ] **Step 1: Update and add tests** in `run.test.js`:
  - `AC5.1: a wall-clock ceiling stop carries reason express-error and names the ceiling and value`: worker envelope `{ status: 'timeout', reason: 'wall-clock-ceiling' }` with policy minutes 30 → `stop.reason === 'express-error'`, `stop.detail` starts `timeout/wall-clock-ceiling: wall-clock ceiling of 30 minutes reached`, class `pre-push`.
  - `AC5.2: a spend ceiling stop names the spend ceiling`: `{ status: 'fail', reason: 'spend-ceiling', detail: 'Reached maximum budget ($5)' }` → detail starts `fail/spend-ceiling: spend ceiling of 5 dollars reached`.
  - Update the existing worker-envelope detail table (the `'timeout/wall-clock-ceiling'` and `'fail/spend-ceiling: …'` rows) to the new strings.
  - `red tests carry reason failing-test`, `check escalate carries its reason` (`out-of-bounds` → `out-of-bounds`; `diff-too-large` → `express-error`), `a claim failure carries claim-exit-{code}` (exit 3 → `claim-exit-3`, exit 4 → `claim-exit-4`).
  - Rewrite `check escalate with logged:false hand-logs the escalation, neutralized, and keeps the stop` to assert no `log-decision.js` call carries `'Express lane'` and that `stop.checkLogged === false`, `stop.reason === 'gate-denial'`. Delete `a throwing hand-log of an escalation keeps the stop and its reason, noting the lost line` (its subject no longer exists) and keep the proceed-branch tests as they are.
  - Update the existing `stop.reason` pins (around lines 700, 717 and 1445) only where the step now sets a reason; leave the `'fail'`/`'stop'` defaults that steps still produce.

- [ ] **Step 2: Run to verify the new and changed tests fail**
  Run: `node --test tests/bin-lib/driver/run.test.js`
  Expected: FAIL on exactly the tests above.

- [ ] **Step 3: Implement** in `steps.js`. Import `toEscalationReason` from `./settle`. The minutes and dollars values are the ones the worker step already parsed.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/settle.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/driver/steps.js tests/bin-lib/driver/run.test.js`, then `git commit -m "Carry escalation reasons and ceiling details on driver stops — settle reads them (#5219)"`.

### Task 6: run.js calls settle, with the --no-settle flag

**Files:**
- Modify: `plugin/bin/lib/driver/run.js`
- Modify: `plugin/bin/drive.js` (usage comment block only)
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: `settle` (Task 2), `OUTCOME_BY_CLASS`/`outcomeFor` (events.js).
- Produces:
  - `parseArgs(argv) -> { records, settle: boolean }`: `--no-settle` anywhere → `settle: false`; default `true`; any other `-`-prefixed token still errors.
  - `USAGE` keeps its first line byte-identical and gains, after the `--help` line: `'       drive.js --no-settle #N [#M…]   (the caller settles stops: the final line carries settle: left-to-caller and the stop object)'`.
  - `realDeps.readFile = (p) => fs.readFileSync(p, 'utf8')`.
  - Final-event fields added (none renamed): `settle` (`'done'|'left-to-caller'|'none'`), `settleFailed` (string[]), `settleRow` (row name or null), plus `unclassified: true`, `settleNote: string` and `spendOverrun: true`, each only when it applies. When settle ran, `outcome` is `outcomeFor(result.settledClass)`, so a failed escalate or the safety net reads `blocked`.
  - `driveRecord`: after the loop, a halted record with `shared.settle === true` calls `settle({ stop: <the stop object finalEvent builds>, record, runId, runDir, wt, branch, pr: ctx.pr && ctx.pr.number, claimed: ctx.claimed, mainRoot, ghRepo, emit }, deps)`, where `emit` writes `eventFor(ctx, step, { status, detail, extra: {} }, ms, deps)` to the sink. `settle` is `done` when the row had calls, `none` when it had none. A halted record with `--no-settle` makes no settle call and gets `settle: 'left-to-caller'`. A record with no stop gets `settle: 'none'`. An interrupted record (`reportInterrupt`) settles nothing and gets `settle: 'left-to-caller'`.

- [ ] **Step 1: Write the failing tests** in `run.test.js`. First add `defaultScript` replies for every settle call (`gh issue comment`, `gh pr comment`, `gh issue edit`, `node release-claim.js` → `{ code: 0 }`, `node express-lane.js escalate` → `{ code: 0 }`, `git worktree remove`, `git branch -D`) and a harness `readFile` dep (`dispatch('readFile', [p])`, default reply: throw an `ENOENT` error):
  - `AC4.1: --no-settle makes no settle call and leaves the stop to the caller`: a red-test stop with `['--no-settle', '#7']` → no call whose argv names `issue comment`, `pr comment`, `issue edit`, `release-claim.js` or `escalate`, or a `git worktree remove`/`branch -D`; the final line has `settle: 'left-to-caller'`, `settleFailed: []`, and `stop` equal to `{ step: 'test', class: 'pre-push', pushed: false, created: { worktree: true, branch: true }, reason: 'failing-test', detail: 'red tests', checkLogged: null }`.
  - `AC4.2: a stop whose row has no calls has settle none`: an eligibility refusal → `settle: 'none'`, `settleRow: 'refused'`, and no gh call other than `issue view`.
  - `AC4.3: a settled stop has settle done and its events come before the final line`: a red-test stop → `settle: 'done'`, `settleRow: 'pre-push'`, and every `settle-*` event line sits after the `test` line and before the `final` line.
  - `AC4.4: parseArgs accepts --no-settle in any position and still refuses other options` (`['#7', '--no-settle']`, `['--no-settle', '#7', '#8']`; `['--settle']` → error).
  - `AC5.3: a ceiling stop is settled as an escalation`: a wall-clock timeout → the escalate argv carries `--reason express-error`, and its detail file names `wall-clock ceiling of 30 minutes`.
  - `AC5.4: an overspend after a normal return settles nothing and is named in the final event`: worker `{ status: 'ok', spendOverrun: true }` → no `settle-*` lines; the run reaches the commit step and beyond; the final line has `spendOverrun: true`.
  - `AC7.3: failed settle steps are listed on the final line`: script `gh issue comment` to throw → `settleFailed: ['settle-comment-record']`, plus a `settle-comment-record` event with status `fail`.
  - `AC1.6: a failed escalate makes the outcome blocked`: escalate `{ code: 1 }` → `outcome: 'blocked'`, `settleRow: 'blocked'`.
  - `AC3.5: a refusal before the claim makes no forge write`: admission refused → the only gh call is `issue view`. A claim exit 3 → no gh call other than `issue view`.
  - `interrupted record settles nothing`: extend the existing interrupt test → `settle: 'left-to-caller'`, and no `settle-*` lines.
  - Then run the whole file. Fix any existing test that pinned an exact call list or line list a settle call now extends, keeping its intent (assert on the steps it was about). Name each changed test in the commit body.

- [ ] **Step 2: Run to verify the new tests fail**
  Run: `node --test tests/bin-lib/driver/run.test.js`
  Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** in `run.js` (update the header's per-record paragraph to say a halted record is settled by `settle.js` unless `--no-settle`, and `USAGE`) and add the `--no-settle` line to `drive.js`'s usage comment.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/driver/`
  Expected: PASS (every driver suite).

- [ ] **Step 5: Commit**
  `git add plugin/bin/lib/driver/run.js plugin/bin/drive.js tests/bin-lib/driver/run.test.js`, then `git commit -m "Settle driver stops from the run loop — --no-settle leaves them to the caller (#5219)"`.

### Task 7: usage page, registry row, design table

**Files:**
- Create: `docs/driver.md`
- Modify: `docs/REGISTRY.md`
- Modify: `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md` (the "When a run stops" table)

- [ ] **Step 1: Write `docs/driver.md`** with these sections:
  - **Running it**: `drive.js #N [#M…]`, `--no-settle`, `--help`, the exit codes copied from `USAGE`.
  - **Outcome words**: pending-review, express-escalated, blocked, refused, and which stop class gives each.
  - **Event lines**: every field of a step line and of the final line, including `stop`, `settle`, `settleFailed`, `settleRow`, `unclassified`, `settleNote` and `spendOverrun`.
  - **When a run stops**: the settle table from the spec, with the sentence "The source of truth is `SETTLE_ROWS` in `plugin/bin/lib/driver/settle.js`; this table is copied by hand."
  - **Taking an escalated record again** (`AC11.8`): delete the comment carrying `<!-- express-driver: escalated -->`.
  - **Worker rights**: a summary of `roles.js`'s per-role tools, `--restricted`, the sandbox.

  The page is documentation, and no test reads it.
- [ ] **Step 2: Add the REGISTRY row** to the Tier 3 table: ``| docs/driver.md | Pipeline driver usage — running drive.js, outcome words, event-line fields, the settle table (settle.js's SETTLE_ROWS is the source of truth) and worker rights | `plugin/bin/drive.js`, `plugin/bin/lib/driver/**` |``.
- [ ] **Step 3: Amend the design table.** Replace the four-row table with the spec's six rows:
  - refused;
  - claim held by another run (exit 3): no writes;
  - other claim failures or a failed mint: record comment and `bot:blocked`, no release, the TTL note;
  - pre-push;
  - blocked;
  - pending-review.

  Add one sentence naming `settle.js`'s table as the source of truth.
- [ ] **Step 4: Verify**
  Run: `git grep -n "driver.md" -- docs/REGISTRY.md` and `grep -n "held by another run" docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`. `AC9.1`: both print one line. Run `grep -rln "driver.md" tests/ || true`. `AC9.2`: it prints nothing. Run `git grep -n "express-driver: escalated" -- plugin/skills || true`. `AC11.9`: it prints nothing (neither the prose express lane nor the standard path reads the marker).
- [ ] **Step 5: Commit**
  `git add docs/driver.md docs/REGISTRY.md docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`, then `git commit -m "Add the driver usage page and amend the design's settle table (#5219)"`.

## Spec coverage map

| Clause | Task |
|---|---|
| AC1 (order, check-logged skip, logged:false, escalate failure) | 2 (AC1.1–AC1.4), 3 (AC1.5), 6 (AC1.6) |
| AC2 (blocked after push; failed pr create; record-pr failure) | 2 (AC2.1–AC2.5) |
| AC3 (refusal, contested claim, other claim exits, nothing-created) | 2 (AC3.1–AC3.4), 6 (AC3.5) |
| AC4 (--no-settle, settle none) | 6 (AC4.1–AC4.4) |
| AC5 (wall clock, spend, overspend) | 5 (AC5.1, AC5.2), 6 (AC5.3, AC5.4) |
| AC6 (no model) | 1 (AC6.1), 2 (AC6.2) |
| AC7 (continue on failure, no retry, release 3/4) | 2 (AC7.1, AC7.2), 6 (AC7.3) |
| AC8 (none, unclassified) | 2 (AC8.1, AC8.2) |
| AC9 (page, registry, design amended) | 7 |
| AC10 (hygiene) | 1 (AC10.1) |
| AC11 (marker, admission gate, trust, unreadable) | 1 (AC11.1), 4 (AC11.2–AC11.6) |

Waived AC11.8: the spec's Non-Goals forbid any test reading `docs/driver.md`; Task 7 Step 1 writes the sentence.
