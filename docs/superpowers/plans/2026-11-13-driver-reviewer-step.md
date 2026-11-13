# Driver Reviewer Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one read-only reviewer worker to the pipeline driver between `check` and `push`, whose findings count only when the driver runs their evidence test and it fails, with one fix round for confirmed findings.

**Architecture:** A new `plugin/bin/lib/driver/review.js` holds the pure rules (on/off decision, finding and path validation, TAP classification) and the step function; `steps.js` wires it in as one `STEPS` entry after `check`, passing in its own commit, test and check steps and an implementer-launch function, so `review.js` never requires `steps.js`. `run.js` gains one generic loop case (a `skip: true` result emits no event line) and the new `realDeps` members; `worker.js` gains the `array` schema type and exports its existing `superviseChild` kill primitive for the evidence run.

**Tech Stack:** Node 22 (CI Node 20), `node:test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T093607-spec-5222/work/5222-spec.md` (record #5222)

## Global Constraints

- The driver never executes a command string a reviewer supplies; the evidence run is spawned without a shell, as an argument list: the test command's own words plus the validated path (AC3).
- The reviewer launches with role `reviewer` through `launchWorker`: `--restricted`, no `Bash`, no `--dangerously-skip-permissions`, no `bypassPermissions` (AC1). `roles.js`'s `ROLES.reviewer` is not changed.
- Every pre-push stop of this step has class `pre-push` (outcome `express-escalated`), except a propagated `check` result, which keeps the class the check step returned (a non-zero `check` exit is `blocked`, as today).
- Event status per stop (spec table): reviewer envelope `fail`/`timeout`, result not valid, unparseable → `fail`; evidence write/remove failure, tree changed outside the evidence files → `fail`; fix-round worker `fail`/`timeout`, commit fails → `fail`; kept evidence test still red, scoped tests red, `check` escalate, fix round changed nothing outside the evidence files → `stop`.
- Stop `reason`: a still-red kept evidence test → `failing-test`; a propagated test/check result keeps its own reason; every other stop → the status (`fail`/`stop`), which settle maps to `express-error`.
- Named bounds (stated in `review.js`'s header, each pinned at its edge by a test): `MAX_FINDINGS = 5`, `EVIDENCE_PATH_MAX_CHARS = 200`, `EVIDENCE_CONTENT_MAX_BYTES = 65536`, `EVIDENCE_RUN_TIMEOUT_MS = 45000` (must be below one minute, the `min: 1` of `express-driver-wall-clock-minutes`), `EVENT_TEXT_MAX_CHARS = 200`, `DIFF_PROMPT_MAX_BYTES = 100000`.
- Policy key `express-driver-review`: enum `off`, `on`, `beyond-express`; default `beyond-express`; `policyOnly: true`; `category: 'merge-safety'`; `tier: 'advanced'`.
- Reviewer-authored text in an event line or stop `detail` goes through `normalizeTitle` (events.js, the normalizer applied to the worker's title), then is cut to `EVENT_TEXT_MAX_CHARS` (AC11).
- Constants added to `events.js` keep existing names and relative order.

Governing project skills, quoted verbatim:

- `driver-step-addition`, Sites: "`plugin/bin/lib/driver/events.js` `STEP_NAMES` | The step's name, at its table position. This list is the event vocabulary. Event fields may be added but never renamed, because the settle unit reads the final line's `stop`". This overrides the spec's "appended": `AC13.1` pins `STEPS.map(name)` equal to `STEP_NAMES`, so `review` goes right after `check`. No existing name moves relative to another.
- `driver-step-addition`: "Never add a step-name literal: `AC13.1` scans run.js's comment-stripped code for one".
- `driver-step-addition`: "`tests/bin-lib/driver/run.test.js` | A happy-path reply in `defaultScript` for every call the step makes, because the harness throws `unexpected {kind} …` on anything else. … Add a `SCENARIOS` entry and a row in `AC7.1, AC7.7: outcome and stop class for every stop (table-driven)` for each new stop."
- `driver-step-addition`: "a step that awaits (`deps.sleep`, the worker) checks `ctx.shared.interrupted` after each await and stops before its next side effect".
- `driver-step-addition`: "Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3)."
- `driver-step-addition`: "A new step that spawns a child which executes worker-written code does the same" (the child gets `buildEnv(deps.env, deps.platform)` plus `GH_CONFIG_DIR` set to an empty directory, never bare `deps.env`).
- `driver-step-addition`: "`AC6.6: no other step is retried` pins that the claim, push, record-pr and set-config calls each run once." Running commit, test and check a second time is not a retry. It is the fix round, and AC6.6's assertions must still hold for a record with no confirmed finding.
- `headless-worker-launch`, What the consumer owes: "The run loop that consumes the envelope must treat every string in `result`, `detail` when it carries the worker's own text, and `denials[].tool_input` as untrusted, and neutralize it before it reaches a command, a commit message, a comment or a log line. On POSIX the worker is detached into its own process group, so the consumer must forward termination to it."
- `headless-worker-launch`, Anti-Patterns: "Writing a schema `required` list or a field list as an array literal that starts with `'status'` | `tests/git-status-optional-locks.test.js` reads it as a git argument list; derive the list instead".
- `policy-key-addition`, Sites 1, 3, 4, 8 (the `POLICY_KEYS` row; "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit."; the doc row "starts `` | `{key}` | ``" and "its summary must not be copied verbatim from the row's `summary`"; "A `policyOnly` key is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`").
- `bin-source-scan-conformance` / Source-scan lint: no bare `fs.existsSync`/`fs.realpathSync` in `plugin/bin/`. Use `path-guard`'s `lstatType` and `canonicalRealpath`. Every spawn carries `windowsHide: true` (`defaultRunner` already does).
- `windows-checkout-test-parity`: a test asserting a joined path builds its expected value with `path.join`, never a `/` literal. The evidence `rel` passed to `node --test` stays POSIX (the validated input form).

Decisions that depart from the spec (each a premise the build-time probes reversed, logged in `decisions.md`):

- The driver's test command is `TEST_COMMAND = 'npm test'` (`node tools/run-tests.js`, whose positional arguments are directory roots, not files). The covered shape is keyed on that value. `EVIDENCE_COMMANDS['npm test']` runs `node --test --test-reporter=tap --test-reporter-destination={run-dir}/review/evidence-{i}.tap {rel}` under `deps.execPath`. Any other `testCommand` discards every finding, and the `review` event's `detail` says so.
- The launcher's schema subset gains `type: 'array'` (no `items`), so `findings` is checked as an array by the launcher and each finding is validated by `review.js` (AC2: one bad finding is discarded, not the whole result).
- The `review` event carries its counts as top-level extra fields (`returned`, `reproduced`, `discarded`, `usage`, `denials`), not as an object `detail`. A stop's `detail` must stay a string, because settle reduces it into a comment.

## Review Focus

1. An evidence path under `.git/` (`.git/info/a.test.js`): no listed rule refuses it. Add a rule: any segment equal to `.git`, case-insensitive, is discarded (Task 3).
2. A reviewer result whose `findings` holds non-objects (`null`, a string, an array): each is discarded and counted, never thrown on (Task 3).
3. An evidence test that passes on load but writes outside the worktree's tracked set mid-run, for example a lockfile beside it: the tree check stops the record (Task 4).
4. A worktree not clean before the review starts (a stray untracked file the earlier steps left): the step refuses to write evidence (`fail`). Otherwise the tree check would blame the reviewer (Task 4).
5. A fix-round implementer that deletes a kept evidence file and also fixes the code: the rewrite restores it before the commit, and the regression run decides (Task 7).

## Single-commit assumptions (AC15 plan-time grep)

`git grep -n -E "ctx\.(changedFiles|worker|check|testMode|checkLogged)\b" -- plugin/bin/lib/driver` lists these places:
- `ctx.changedFiles` (commit step sets it, summary step reads it): **revisited**. After the fix-round commit it becomes the union of both commits' paths, in first-seen order (Task 7).
- `ctx.worker` (the worker step sets it; the commit step reads `title`, the pr step `summary`, finalEvent `costUsd`/`turns`/`denials`/`spendOverrun`): **revisited**. After the fix round, `title` is the fix-round title (the second commit's message, same `normalizeTitle` form), `summary` is `{first summary} Review fix: {fix summary}`, `costUsd` and `turns` are summed, `denials` concatenated, `spendOverrun` OR-ed (Task 7).
- `ctx.check` (check sets it, the push guard reads `head`, set-config reads `configSet`, ci reads `head`): **revisited**. The second `check` overwrites it, which is how the push guard sees the second head (Task 8).
- `ctx.testMode`, `ctx.checkLogged`: unaffected (re-set to the second run's values, which is correct).
- `commit-msg.txt`, `check-proceed.txt`, `record.json` in the run dir: unaffected (rewritten per call).
- PR title (`ctx.issue.title`): unaffected.

---

### Task 0: Capture `node --test` outcomes and fix the classification rule

**Role:** judgment

**Files:**
- Create: `plugin/bin/lib/driver/review.js` (header + constants + `classifyEvidenceRun` + `evidenceArgs` only)
- Create: `tests/bin-lib/driver/fixtures/review-evidence/{assert-fail,nested-fail,syntax,load-throw,no-test,pass,hang,exit1,fake-tap}.js.txt` (evidence sources; `.js.txt` so `tools/run-tests.js` never collects them)
- Create: `tests/bin-lib/driver/fixtures/review-evidence/{name}.tap` (frozen TAP output of each, absolute paths replaced by `<DIR>`)
- Create: `tests/bin-lib/driver/review.test.js`

**Interfaces:**
- Produces: `classifyEvidenceRun({ code, signal, timedOut, tap, file }) -> { verdict: 'reproduced'|'passed'|'load-failure'|'timeout'|'unplaceable', fail: number|null, pass: number|null }`; `evidenceArgs(testCommand: string, rel: string, dest: string) -> string[] | null`; `EVIDENCE_COMMANDS` (frozen map, single key `'npm test'`).

- [ ] **Step 1: Capture.** In a `fs.mkdtempSync(os.tmpdir())` directory (removed in a `finally`), write each fixture source as `{name}.test.js`. Run `process.execPath --test --test-reporter=tap --test-reporter-destination={dir}/{name}.tap {name}.test.js` (cwd = dir, `hang` with a 3 s timeout) and record exit code, signal and TAP. Paste the literal results with `process.version` into `review.js`'s header as a table. Build-time probe on v22.23.2 found: assertion failure → exit 1, a `not ok` point with `failureType: 'testCodeFailure'` and no `code: 'ERR_TEST_FAILURE'`; syntax error, throwing `require`, `process.exit(1)` and a file printing `not ok 1 - fake` → exit 1, one file-level `not ok` point whose YAML block holds `code: 'ERR_TEST_FAILURE'` and `exitCode: 1`, with stdout and stderr of the child folded into `#` comment lines; no test case → exit 0, one file-level `ok` point; pass → exit 0; hang → no summary, killed. `nested-fail` is a `describe` with one failing `it`: confirm that the parent point carries `ERR_TEST_FAILURE` (`subtestsFailed`) while the child's does not.
- [ ] **Step 2: Write the failing tests.** In `review.test.js`:
  - `Task0: frozen TAP fixtures classify per the rule`: for each `.tap` fixture with its recorded `{code, timedOut}`, assert the verdict: `assert-fail`/`nested-fail` → `reproduced`; `syntax`/`load-throw`/`exit1`/`fake-tap` → `load-failure`; `pass`/`no-test` → `passed`; `hang` (`timedOut: true`) → `timeout`; `{ code: 1, tap: '' }` → `unplaceable`; `{ code: 1, tap: 'garbage' }` → `unplaceable`; `{ code: 0, tap: assert-fail fixture }` → `unplaceable` (exit and stream disagree).
  - `Task0: the real node --test still classifies the fixtures (a reporter change turns this red)`: run the real command (`evidenceArgs('npm test', …)` under `process.execPath`, `spawnSync`, `windowsHide: true`) on each fixture source copied into a temp dir as `{name}.test.js`, except `hang`, and assert the same verdicts.
  - `Task0: evidenceArgs covers npm test only`: `evidenceArgs('npm test', 'tests/a.test.js', '/d/e.tap')` deep-equals `['--test', '--test-reporter=tap', '--test-reporter-destination=/d/e.tap', 'tests/a.test.js']`; `evidenceArgs('node --test', …)`, `evidenceArgs('pytest', …)` and `evidenceArgs(undefined, …)` are `null`.
- [ ] **Step 3: Run to verify they fail.** Run: `node --test tests/bin-lib/driver/review.test.js`. Expected: FAIL with `Cannot find module` for `review.js`.
- [ ] **Step 4: Implement** `classifyEvidenceRun` and `evidenceArgs`. Rule: `timedOut` → `timeout`. Otherwise parse the TAP text: test points are lines matching `/^\s*(not ok|ok) \d+ - /`, each point's YAML block runs from its `---` line to its `...` line. Read the summary's `# fail N` and `# pass N` from the last occurrence at column 0. `reproduced` iff `code === 1`, the summary exists with fail ≥ 1, and at least one `not ok` point's block lacks `code: 'ERR_TEST_FAILURE'`. `load-failure` iff `code === 1`, the summary exists, and every `not ok` point carries `ERR_TEST_FAILURE`. `passed` iff `code === 0` and the summary exists with fail 0. Anything else → `unplaceable`. The parse must stay linear in the TAP length (one pass, no nested quantifiers).
- [ ] **Step 5: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 6: Commit.** `git add plugin/bin/lib/driver/review.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/fixtures/review-evidence`, then commit `Add the reviewer step's evidence classification rule — node --test TAP outcomes captured (#5222)`.

### Task 1: Launcher accepts `type: 'array'`; reviewer result schema; `superviseChild` exported

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/worker.js` (`assertSupportedSchema`, `conformsTo`, `module.exports`; header's "The schema." paragraph)
- Modify: `plugin/bin/lib/driver/roles.js` (add `REVIEW_RESULT_SCHEMA`)
- Modify: `tests/bin-lib/driver/worker.test.js:430` (the `[{ type: 'array' }, /type "array"/]` refusal row)
- Test: `tests/bin-lib/driver/review.test.js`

**Interfaces:**
- Produces: `REVIEW_RESULT_SCHEMA = { type: 'object', properties: { findings: { type: 'array' } }, required: ['findings'], additionalProperties: false }` (deep-frozen, from `roles.js`); `superviseChild({ handle, runner, platform, env, wallClockMs, timers }) -> Promise<{ timedOut, timeoutDetail?, spawnError?, code?, signal?, stdout?, stderr? }>` exported from `worker.js`, unchanged in behavior.

- [ ] **Step 1: Write the failing tests.** In `worker.test.js`, replace the array refusal row with `conformsTo covers type array`: `conformsTo({ type: 'array' }, [])` and `conformsTo({ type: 'array' }, [1, 'x'])` are true, `conformsTo({ type: 'array' }, {})` and `conformsTo({ type: 'array' }, 'a')` are false, and `conformsTo({ type: 'array', items: {} }, [])` throws `/items/`. Keep the `integer` refusal row. In `review.test.js`, add `AC1: the reviewer launch has --restricted, no Bash, no bypass flag and no settings file`: for `platform` in `darwin`, `linux`, `win32`, `composeArgs({ role: 'reviewer', schema: REVIEW_RESULT_SCHEMA, platform })` includes `--restricted`; the `--tools` value split on `,` excludes `Bash`; no arg matches `/dangerously-skip-permissions|bypassPermissions/`; `--settings` is absent; `ROLES.reviewer.settings === false`. Also assert `conformsTo(REVIEW_RESULT_SCHEMA, { findings: [] })` is true, and false for `{}`, `{ findings: {} }` and `{ findings: [], extra: 1 }`, and that `typeof superviseChild === 'function'`.
- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/bin-lib/driver/worker.test.js tests/bin-lib/driver/review.test.js`. Expected: FAIL (`unsupported schema keyword: type "array"`; `REVIEW_RESULT_SCHEMA` undefined).
- [ ] **Step 3: Implement.** Allow `'array'` beside `'object'`/`'string'` in `assertSupportedSchema`. `items` stays unsupported (it is not in `SCHEMA_KEYWORDS`, so it already throws). Add `if (schema.type === 'array' && !Array.isArray(value)) return false;` to `conformsTo`. Build `REVIEW_RESULT_SCHEMA` with `required: Object.keys(properties)` (derived, per the `'status'` rule). Add `superviseChild` to `worker.js`'s exports and name the `array` type in the header's schema sentence.
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `Accept type array in the worker launcher's schema subset — reviewer result schema (#5222)`.

### Task 2: Policy key `express-driver-review`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (one row after `express-driver-spend-ceiling-dollars`, line 94)
- Modify: `plugin/skills/_shared/policy-schema.md` (one row after the `express-driver-spend-ceiling-dollars` row, line 102)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:101` (`policyOnly` bullet)
- Modify: `plugin/bin/lib/driver/steps.js:86-90` (`POLICY_KEYS`: append `'express-driver-review'`)
- Modify: `tests/policy-schema.test.js:149-151` (count 103 → 104 with a comment line), `:952-958` (express-driver table row), plus the AC16 tests
- Modify: `tests/bin-lib/driver/run.test.js:251-260` (`POLICY`: `'express-driver-review': 'beyond-express'`)

**Interfaces:**
- Produces: the resolved value at `ctx.shared.policy['express-driver-review'].value`.

- [ ] **Step 1: Write the failing tests.** In `policy-schema.test.js`: bump the pin to `104` with `// 103 -> 104, #5222: express-driver-review — enum off|on|beyond-express, default beyond-express, policyOnly`; add `{ id: 'AC16.1', key: 'express-driver-review', def: 'beyond-express', other: 'on', policyVal: 'off' }` to the express-driver table (that table's loop already pins `policyOnly`); add `AC16: express-driver-review resolves its default from resolve-policy.js in a fresh project` (spawn `DRIVER_CLI` the way `AC7.1` does: `{ value: 'beyond-express', source: 'default' }`); add `AC16: express-driver-review values resolve and a malformed one falls back`: `off`, `on` and `beyond-express` each give `source: 'policy'`, and `express-driver-review: sometimes` gives `{ value: 'beyond-express', source: 'default', invalid: true }`.
- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/policy-schema.test.js`. Expected: FAIL (count 103 ≠ 104; unknown key).
- [ ] **Step 3: Implement.** The `POLICY_KEYS` row: `{ key: 'express-driver-review', type: 'enum', values: ['off', 'on', 'beyond-express'], default: 'beyond-express', policyOnly: true, summary: "Whether the pipeline driver runs its evidence reviewer: off, on, or only for records beyond the express bounds.", category: 'merge-safety', tier: 'advanced' }`, with its line in the existing #5216 comment block naming #5222. The doc row: `` | `express-driver-review` | `policy.yml` | `bin/drive.js` (#5222) | `beyond-express` | `` plus a description in other words than the summary: the three values; `beyond-express` runs the reviewer only for a record whose size label is missing or not `low`, or that has more than `EXPRESS_MAX_KEY_FILES` Key Files; unset or malformed (`invalid: true`) gives `beyond-express`; `policyOnly`, because it decides whether autonomous machinery runs, so a `--run` config never switches it. Measure `wc -c plugin/skills/_shared/policy-schema.md` before and after: it must stay under `RAIL_BYTES` (52500; 47136 at base). Add `express-driver-review` to the coverage bullet's list. Append to the steps.js `POLICY_KEYS` and to the harness `POLICY`.
- [ ] **Step 4: Run to verify they pass.** Run: `node --test tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/resolve-policy-control-mode.test.js tests/bin-lib/driver/run.test.js`. Expected: PASS. AC2.1's call signature is unchanged: `policy` is one call whatever the key list holds.
- [ ] **Step 5: Commit.** `Register the express-driver-review policy key — the reviewer step's three settings (#5222)`.

### Task 3: Pure rules — on/off decision, finding shape, evidence shape, path rules, content rules, cap

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/review.js`
- Test: `tests/bin-lib/driver/review.test.js`

**Interfaces:**
- Consumes: `extractKeyFiles` (`../issues/grouping`), `parseRecordFacets` (`../issues/record`), `EXPRESS_MAX_KEY_FILES`, `isProtectedPath` (`../express/eligibility`), `classifyDiffFiles` (`../issues/blast-radius`; its `isTest` is `isTestPath` and its `isSensitive` the merge-sensitive check), `isAncestorOrSelf` (`../path-guard`).
- Produces:
  - `reviewRequired({ issue, policyValue }) -> { on: boolean, reason: string }`: `'off'` → off; `'on'` → on; any other value → the beyond rule: on when `parseRecordFacets(issue.labels).size !== 'low'` or `extractKeyFiles({ body, labels }).length > EXPRESS_MAX_KEY_FILES`. `reason` names the value or the bound that decided.
  - `findingShapeViolation(f) -> string | null`: f is a plain object with exactly the keys `path`, `line`, `claim`, `evidence`; `path` is a string; `line` is a safe integer ≥ 1; `claim` is a string, non-empty after trim, with no `\r` or `\n`; `evidence` is a plain object.
  - `evidenceShapeViolation(evidence) -> string | null`: exactly the keys `path` and `content`, both strings. Anything else is discarded: a `command`/`cmd` key, any extra key, a missing `content`.
  - `pathRuleViolation(p, { wt, sensitivePaths, deps }) -> string | null`, using `deps.lstatType` and `deps.canonicalRealpath`.
  - `contentViolation(content) -> string | null`: non-empty, `Buffer.byteLength(content, 'utf8') <= EVIDENCE_CONTENT_MAX_BYTES`.
  - `PATH_RULES`: a frozen ordered array of `{ name, test(p, opts) -> boolean /* true = violates */ }` that `pathRuleViolation` walks, returning the first violating rule's `name`.

- [ ] **Step 1: Write the failing tests** (in `review.test.js`; fake `deps` with `lstatType`/`canonicalRealpath` answering from a map, so no real file system):
  - `AC13: reviewRequired`. Under `beyond-express` (and `undefined`, and a junk value), `size:low` with 3 Key Files → `on: false`; `size:medium` → on; no size label → on; `size:low` with `EXPRESS_MAX_KEY_FILES + 1` Key Files (count derived from the constant, never the literal 3) → on. `off` with `size:medium` → off. `on` with `size:low` → on. `reason` is a non-empty string in each case.
  - `AC2: finding shape`: one case per violation (missing key, extra key, `line` 0, `line` 1.5, `line` `'3'`, empty claim, a claim holding `\n`, `evidence` a string, `evidence` null, the finding itself `null`/`'x'`/`[]`) → a non-null reason; a valid finding → `null`.
  - `AC3: evidence shape`: `{ command: 'touch marker' }`, `{ cmd: 'x', path, content }`, `'tests/a.test.js'`, `{ path }`, `{ path, content, run: 'x' }`, `{ path: 5, content }` → non-null; `{ path, content }` → null.
  - `AC4: each path rule refuses its own case` (table-driven; each row names one input that violates only that rule; a mutation of `PATH_RULES` that drops the rule turns its row red): `''` (empty), a 201-char `tests/…a.test.js` (length), `/abs/a.test.js`, `C:/a.test.js`, `c:\\a.test.js`, `file:///a.test.js`, `FILE:a.test.js`, `https://x/a.test.js` (absolute or scheme, every letter case), `tests\\a.test.js` (backslash), `tests/%2e%2e/a.test.js` and `tests%2Fa.test.js` (percent-encoded dot or separator, either case), `tests/../a.test.js`, `tests/./a.test.js`, `tests//a.test.js` (dot segment, or a path that `path.posix.normalize` changes), `tests/` (trailing slash), `-a.test.js` (flag-shaped), `src/latest/widget.js` and `src/contest.js` (not a test path by `isTestPath`), `.github/x.test.js`, `hooks/a.test.js` and a path matching a configured merge-sensitive glob (protected or merge-sensitive), `.git/info/a.test.js` and `x/.GIT/a.test.js` (a `.git` segment, Review Focus 1), and an existing leaf for each `lstatType` answer `file`, `directory`, `symlink` (dangling included), `unreadable` (exists). Every row returns that rule's `name`, and `tests/new/a.test.js` with a missing leaf returns `null`.
  - `AC4: the resolved parent must stay inside the worktree`: parent `tests/link` is `lstatType` `symlink` → violation. Parent `tests/sub` is a directory whose `canonicalRealpath` lies outside `canonicalRealpath(wt)` → violation. `canonicalRealpath` returning `null` → violation. A missing parent whose nearest existing ancestor is inside → `null`.
  - `AC5: content rules at the edge`: `''`, `5`, `null`, and a string of `EVIDENCE_CONTENT_MAX_BYTES + 1` bytes → violation; exactly `EVIDENCE_CONTENT_MAX_BYTES` bytes (multi-byte characters included) → `null`.
  - `AC5: named bounds`: `EVIDENCE_PATH_MAX_CHARS === 200`, `EVIDENCE_CONTENT_MAX_BYTES === 65536`, `MAX_FINDINGS === 5`, `EVENT_TEXT_MAX_CHARS === 200`, and `EVIDENCE_RUN_TIMEOUT_MS < 60000 * min`, with `min` read from `policy-schema.js`'s `express-driver-wall-clock-minutes` row.
- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/bin-lib/driver/review.test.js`. Expected: FAIL (`reviewRequired is not a function`).
- [ ] **Step 3: Implement** the six exports. Rule order in `PATH_RULES`: empty-or-too-long, absolute-or-scheme (`/^\//`, `/^[A-Za-z][A-Za-z0-9+.-]*:/`), backslash, percent-encoded (`/%(2e|2f|5c)/i`), dot-segment-or-not-normal, trailing-slash, flag-shaped, git-segment, not-test-path, protected-or-sensitive, exists (`lstatType(path.join(wt, ...p.split('/'))).type !== 'missing'`), parent-escapes. For parent-escapes, walk up from the parent while `lstatType` is `missing`, stopping at `wt`. The first existing ancestor must be type `directory`, and `canonicalRealpath` of it must be non-null and lie within `canonicalRealpath(wt)` (`isAncestorOrSelf`).
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `Add the reviewer step's finding, evidence and path rules (#5222)`.

### Task 4: Evidence write, run, remove, and the tree check

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/review.js`
- Test: `tests/bin-lib/driver/review.test.js`

**Interfaces:**
- Consumes: Task 0's `classifyEvidenceRun`/`evidenceArgs`, Task 1's `superviseChild`, `buildEnv` (`./worker`), `parseStatusPorcelainZ` (`../git-z`).
- Produces:
  - `writeEvidence({ wt, rel, content, deps }) -> { abs, createdDirs: string[] }`: creates the missing parent components one at a time (`deps.mkdirSync(dir)`, non-recursive), then `deps.writeFileExclusive(abs, content)` (create-only). Throws on any failure.
  - `removeEvidence({ abs, createdDirs, deps }) -> void`: `deps.rmFile(abs)`, then `deps.rmdir` on each created dir, deepest first. `ENOTEMPTY`/`EEXIST` from rmdir is not a failure; any other error throws.
  - `runEvidence({ wt, rel, dest, testCommand, deps, wallClockMs }) -> Promise<{ verdict, timedOut }>`: `args = evidenceArgs(…)`. Run `handle = deps.runner({ file: deps.execPath, args, options: { cwd: wt, env: { ...buildEnv(deps.env, deps.platform), GH_CONFIG_DIR } }, input: '', platform: deps.platform })` with `GH_CONFIG_DIR` = `{runDir}/gh-config-empty`. Await `superviseChild({ handle, runner: deps.runner, platform: deps.platform, env: deps.env, wallClockMs, timers: deps.timers })`, set `ctx.shared.activeWorker = handle` for its length, then read `dest` (`deps.readFile`; unreadable → empty) and classify. `wallClockMs` defaults to `EVIDENCE_RUN_TIMEOUT_MS`.
  - `treeDelta({ wt, expected: Set<string>, deps, isRunArtifact }) -> string[]`: `git -C wt --no-optional-locks status --porcelain -z --untracked-files=all`. Returns every path that is not run-artifact and not in `expected`, plus every expected path not reported as untracked (`??`).

- [ ] **Step 1: Write the failing tests** (fake runner returning `{ pid, kill, exited }`, fake git answering porcelain, recorded calls):
  - `AC7: a confirmed run needs the reproduced verdict`: the runner's exit is 1 and `dest` holds the `assert-fail` fixture → `reproduced`. Each of the `pass`, `no-test`, `syntax`, `load-throw` fixtures, plus a `timedOut` supervise outcome and an unplaceable stream, gives a not-reproduced verdict. One test per case.
  - `AC7: the test command is spawned without a shell, in the worktree, with the relative path as one argument`: the recorded runner call has `file === deps.execPath`, `args` exactly `evidenceArgs('npm test', rel, dest)`, `options.cwd === wt`, no `shell` key, and `options.env` without `GH_TOKEN` (deps.env carries one) but with `GH_CONFIG_DIR`.
  - `AC3: reviewer strings never reach a spawn`: across a full review over a fake launcher (Task 5's `reviewRecord`, added to this test in Task 5), the findings carry `evidence.path` holding `;`, `$(touch x)`, a backtick, a space, a newline, and an evidence object with `command: 'touch marker'`. Every runner call after the reviewer returned has `args` equal to `evidenceArgs(TEST_COMMAND, validatedRel, dest)`, and no argument equals any other reviewer-supplied string. Write this test in Task 5.
  - `AC7: a run past the bound kills the child tree`: `wallClockMs: 50` with a `{ type: 'hang' }` runner whose `exited` never settles until `kill`. The handle's `kill` is called with `SIGTERM` (POSIX) and the verdict is `timeout`. Also run it with `platform: 'win32'`: the runner receives a `taskkill` call with `['/T', '/F', '/PID', String(pid)]`.
  - `AC7: writeEvidence creates parents and removeEvidence takes back only what it created` (real temp dir): `tests/new/deep/a.test.js` in a dir holding `tests/` gives `createdDirs` = `[join(wt,'tests','new'), join(wt,'tests','new','deep')]`. After remove, `tests/` still exists and `tests/new` does not. A pre-existing file at the target makes `writeEvidence` throw (create-only).
  - `AC7: treeDelta`: `expected` `{a}` with porcelain `?? a` → `[]`; ` M src/x.js` → `['src/x.js']`; `?? lock.json` → `['lock.json']`; `?? .claude-tweaks/pipelines/r/x` → `[]` (run artifact); expected `a` missing from porcelain → `['a']`.
- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/bin-lib/driver/review.test.js`. Expected: FAIL (`runEvidence is not a function`).
- [ ] **Step 3: Implement** the four functions as the Interfaces block states. `runEvidence` checks `ctx.shared.interrupted` after its await (it is passed `shared`) and returns `{ verdict: 'unplaceable', interrupted: true }` when set.
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `Add the reviewer step's evidence run and tree check (#5222)`.

### Task 5: The reviewer launch and the review pass (no fix round yet)

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/review.js`
- Test: `tests/bin-lib/driver/review.test.js`

**Interfaces:**
- Consumes: Tasks 0–4; `neutralize`, `normalizeTitle`, `STOP_CLASSES` (`./events`); `fenceFor` (`../markdown-blocks`); `REVIEW_RESULT_SCHEMA` (`./roles`).
- Produces:
  - `normalizeEventText(s) -> string`: `normalizeTitle(String(s))` cut to `EVENT_TEXT_MAX_CHARS`.
  - `buildReviewerPrompt(ctx, { diff, changedFiles }) -> string`. It contains: the record number and title; Key Files with "A fix must stay inside these Key Files."; the changed files; the evidence contract ("each finding carries `evidence: { path, content }`: a new `node:test` test file, path relative to the repository root, a path that does not exist yet, whose test fails on the current code"); at most `MAX_FINDINGS` findings; the diff, fenced and truncated to `DIFF_PROMPT_MAX_BYTES` with a `[diff truncated]` line; the record body last, fenced, labelled as untrusted data (as `workerPrompt` does).
  - `reviewPass(ctx, deps, { testCommand, isRunArtifact }) -> Promise<{ result: StepResult|null, confirmed: Array<{ path, line, claim, content, abs, createdDirs }>, counts: { returned, reproduced, discarded }, extra }>`. `result` is non-null only for a stop.

- [ ] **Step 1: Write the failing tests** (fake `deps.launchWorker` answering per `opts.role`, fake runner and git):
  - `AC1: the reviewer is launched with role reviewer and its result schema`: the recorded `launchWorker` opts have `role: 'reviewer'`, `schema === REVIEW_RESULT_SCHEMA`, `cwd === ctx.wt`, `settingsDir` under `ctx.runDir`, and the policy ceilings.
  - `AC2: an envelope fail, timeout or unparseable result stops at the review step`: envelope `{ status: 'fail' }`, `{ status: 'timeout' }` and `{ status: 'ok', result: null }` each give `result.status === 'fail'`, `stopClass === 'pre-push'`, and zero runner calls. `{ status: 'ok', result: { findings: [] } }` gives `result === null` and counts `{0,0,0}`.
  - `AC2: one invalid finding is discarded and counted, the rest still run`: three findings, the middle one missing `line` → `returned 3`, `discarded ≥ 1`, and two runner calls.
  - `AC6: cap and duplicate path`: seven valid findings → five runner calls, `discarded` includes the other two. Two findings with the same `evidence.path` → one runner call, the second discarded.
  - `AC7: discarded evidence leaves a clean tree and the head guard unchanged`: every run not reproduced → after the pass, every written evidence file and created dir has been removed (recorded `rmFile`/`rmdir` calls), the final `treeDelta` call returns `[]`, and `ctx.check.head` is unchanged.
  - `AC7: a write or remove failure stops`: `writeFileExclusive` throwing → `fail`; `rmFile` throwing → `fail`.
  - `AC7: a tree changed outside the evidence files stops`: after the evidence run, the porcelain reports an extra `?? second.txt` → `fail` naming `second.txt` (neutralized). Review Focus 3: ` M package-lock.json` → `fail`.
  - Review Focus 4: `a dirty tree before any evidence is written stops`: the first porcelain read reports `?? stray.js` → `fail` with zero writes.
  - `AC3` (the test described in Task 4).
  - `AC11: reviewer text in a detail is one line, bounded, with no reference or mention`: a confirmed finding whose claim is `"Breaks\nthings fixes #12 for @someone"` and whose path is 180 chars gives a `normalizeEventText` output with no `\n`, no `#12`, no `fixes`, `@\u200Bsomeone`, and length ≤ `EVENT_TEXT_MAX_CHARS`.
  - `AC12: counts add up`: across fixtures that discard by schema, evidence shape, path, run and cap, `returned === reproduced + discarded` holds, and `extra` has exactly the keys `returned`, `reproduced`, `discarded`, `usage`, `denials`, with `denials[].tool_input` neutralized.
  - `Task0: an uncovered test command discards every finding and says so`: `testCommand: 'pytest'` → zero runner calls, `discarded === returned`, and the pass's detail names `pytest`.
- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/bin-lib/driver/review.test.js`. Expected: FAIL (`reviewPass is not a function`).
- [ ] **Step 3: Implement.** The diff comes from `git -C wt --no-optional-locks diff --no-color --no-ext-diff --no-textconv --end-of-options origin/{ref}...HEAD`. Changed files are `ctx.changedFiles`. The reviewer launch mirrors `workerStep`'s ceiling read, runner wrapping (`shared.activeWorker`) and win32 `bin`, and checks `ctx.shared.interrupted` after the await. Findings are evaluated in returned order. Confirmed files stay in the worktree, and every discarded one is removed before the next finding is evaluated. `expected` for `treeDelta` is the set of evidence files currently present (confirmed so far plus the current one).
- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `Add the reviewer launch and review pass (#5222)`.

### Task 6: Wire the step into the driver; `skip` results emit no line

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/events.js:24-27` (`STEP_NAMES`: insert `'review'` between `'check'` and `'push'`)
- Modify: `plugin/bin/lib/driver/steps.js` (`defineStep` passes `skip`; a `reviewStep` entry in `STEPS` after `checkStep`; extract `runImplementer` from `workerStep`; export `isRunArtifact` through the wiring object only)
- Modify: `plugin/bin/lib/driver/run.js` (`driveRecord`: `if (result.skip !== true) sink.emit(…)`; `realDeps`: `execPath`, `timers`, `writeFileExclusive`, `rmFile`, `rmdir`, `canonicalRealpath`; header sentence on skip)
- Modify: `plugin/bin/lib/driver/review.js` (`reviewRecord(ctx, deps, wiring) -> Promise<StepResult>`)
- Modify: `tests/bin-lib/driver/run.test.js` (pins at 163-165 and 793; harness `runner`/`execPath`/`timers`/new seams; a size label in `issueFor`; new tests)

**Interfaces:**
- Consumes: Task 5's `reviewPass`, Task 3's `reviewRequired`.
- Produces:
  - `reviewRecord(ctx, deps, { commit, test, check, launchImplementer, testCommand, isRunArtifact })`. When `reviewRequired` is off it returns `{ status: 'ok', skip: true }`. Otherwise it returns the pass's stop, or with no confirmed finding `{ status: 'ok', detail: '{reproduced} reproduced of {returned}', extra }`. Confirmed findings take Task 7's fix round. Until Task 7 lands, a confirmed finding returns `{ status: 'stop', detail: 'fix round not built' }`, so no task leaves a half-wired path.
  - `runImplementer(ctx, deps, { extraPrompt = '' }) -> Promise<StepResult>` in `steps.js`: today's `workerStep` body, with `workerPrompt(...) + extraPrompt` as the prompt. `workerStep = defineStep(STEP.worker, STOP_CLASSES.PRE_PUSH, (ctx, deps) => runImplementer(ctx, deps, {}))`.
  - `StepResult.skip` (boolean): run.js emits no event line and does not halt.

- [ ] **Step 1: Write the failing tests** (`run.test.js`):
  - Update the `STEP_NAMES` pins: length 18, first `policy`, last `ci`, and `STEP_NAMES.indexOf('review') === STEP_NAMES.indexOf('check') + 1`.
  - `AC13: with the default and a record inside the express bounds, the review step starts no worker and emits no line`. With `issueFor` carrying `size:low` and `eligibility` keyFiles `['a.js']`, the AC2.1 call signature is unchanged (no `worker` call beyond the implementer's, no `runner` call), and the event steps deep-equal the pre-unit list (`STEP_NAMES` without `review`, then `final`).
  - `AC13: with the default, size:medium (or EXPRESS_MAX_KEY_FILES + 1 Key Files) starts the reviewer`: one `worker` call with `role: 'reviewer'` and one `review` event line.
  - `AC13: with express-driver-review off, no reviewer starts even for size:medium`; `with on, a size:low record starts it`.
  - `AC12: the review event line carries returned, reproduced, discarded, usage and denials`: on a reviewer returning `[]`, the line has `returned: 0, reproduced: 0, discarded: 0`, and `usage` and `denials` arrays/objects.
  - `AC2: a reviewer envelope fail stops before the push`: no `git push` call; final `stop.step === 'review'`, `class 'pre-push'`, outcome `express-escalated`, and the settle `pre-push` row ran.
  - Add `SCENARIOS` entries `review fail` (outcome `express-escalated`, class `pre-push`) and `review tree changed` (same), each with a row in the `AC7.1, AC7.7` table.
  - `skip: a skipped step emits no line and the loop goes on` (a two-entry test table passed through `driveRecord`'s `steps` seam).
- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/bin-lib/driver/run.test.js`. Expected: FAIL (length 17 ≠ 18 and the new tests).
- [ ] **Step 3: Implement.** In `defineStep`'s normalized result, add `skip: result.skip === true`. `reviewStep = defineStep(STEP.review, STOP_CLASSES.PRE_PUSH, (ctx, deps) => reviewRecord(ctx, deps, { commit: commitStep, test: testStep, check: checkStep, launchImplementer: (c, d, extraPrompt) => runImplementer(c, d, { extraPrompt }), testCommand: TEST_COMMAND, isRunArtifact }))`. In the harness, add `runner` (dispatch kind `runner`; a reply gives `exited`), `execPath: '/node'`, `timers` (immediate), and `writeFileExclusive`/`rmFile`/`rmdir`/`canonicalRealpath`, all recorded. Add `size:low` to `issueFor`'s labels. Add a `defaultScript` reply for the reviewer (`role === 'reviewer'` → `{ ...ENVELOPE, result: { findings: [] } }`), for `git diff`, and for the review porcelain reads. Confirm AC6.6 and AC13.1 still pass.
- [ ] **Step 4: Run to verify they pass.** Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/settle.test.js tests/git-status-optional-locks.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js`. Expected: PASS.
- [ ] **Step 5: Commit.** `Wire the reviewer step into the driver after check — skipped steps emit no line (#5222)`.

### Task 7: The fix round

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/review.js` (`buildFixPrompt`, the fix round inside `reviewRecord`)
- Test: `tests/bin-lib/driver/run.test.js` (harness-level fix-round tests)

**Interfaces:**
- Consumes: Task 6's wiring object; `commit.run`, `test.run`, `check.run` (the normalized `StepResult`s of the existing step functions).
- Produces: `buildFixPrompt(confirmed) -> string`, the text appended to the first prompt. Each confirmed finding contributes `path:line`, its claim (fenced), the evidence test's path, and its full content fenced with `fenceFor`. It closes with "These tests are kept as regression tests: do not edit or delete them. Make every one of them pass."

- [ ] **Step 1: Write the failing tests** (`run.test.js`; the reviewer returns one valid finding; the runner's first evidence run reproduces):
  - `AC8: one fix round, in order`: the call order after the reviewer is: evidence runner (red), `worker` (implementer, prompt = the first implementer prompt + `buildFixPrompt` text, compared by `startsWith` on the first prompt), `writeFile` of the evidence path with the recorded content, `git status`/`add`/`commit`, `node verify.js`, evidence runner (direct run), `node express-lane.js check`, `git push`. The implementer `worker` call count is exactly 2.
  - `AC8: the second round never launches a third implementer`: whatever the fix-round worker returns (`done`, `cannot-complete`, `fail`), there are exactly 2 implementer launches.
  - `AC9: the evidence file is rewritten from the recorded content before the commit`: the fix-round worker fixture deletes the evidence file (runner porcelain reports it missing), so the rewrite restores the bytes, the direct run is still red, and the record escalates with `reason` `failing-test`. In a second case the fixture edits it into a passing test, and the content written before the commit equals the recorded content.
  - `AC10: each escalation names the finding and runs no second round`: one row per cause (kept evidence still red; `verify.js` exit 1; check `escalate` with `out-of-bounds`; fix worker `fail`; fix worker `timeout`; fix round changed nothing outside the evidence files; `git commit` fails). Each gives final `stop.step === 'review'`, `stop.class === 'pre-push'` (check exit non-zero excepted: `blocked`), outcome per class, `stop.detail` holding the finding's normalized path, line and claim, and exactly 2 implementer launches. The event status per the Global Constraints table.
  - `AC8: all confirmed findings share the one round`: two confirmed findings give one fix-round launch whose prompt holds both paths.
  - Review Focus 5: `a fix worker that deletes the evidence and fixes the code still passes`: the evidence is restored, the direct run is green, and the push runs.
  - `AC15 (summary): after a fix round the summary lists both commits' files and the PR body keeps the first summary`: the `summary.txt` text names `a.js` and the evidence path, and `pr-summary.md` starts with the first worker's summary.
- [ ] **Step 2: Run to verify they fail.** Run: `node --test tests/bin-lib/driver/run.test.js`. Expected: FAIL (confirmed finding gives `fix round not built`).
- [ ] **Step 3: Implement** the round in `reviewRecord`. Save `first = { worker: ctx.worker, changedFiles: ctx.changedFiles }`. Call `launchImplementer(ctx, deps, buildFixPrompt(confirmed))`, then check `ctx.shared.interrupted`; a non-ok result stops (`fail`/`stop` per status) with the finding named. Merge `ctx.worker` per the Single-commit section. "Changed nothing": `treeDelta` against the evidence set, minus the evidence paths, is empty → `stop`. Rewrite each evidence file with `deps.writeFile(abs, content)`, recreating parents with `deps.mkdirSync(dir, { recursive: true })`. Then `commit.run` (non-ok → stop with its status), set `ctx.changedFiles` to the union, `test.run` (non-ok → propagate its status/reason/class with the finding appended to detail), the direct `runEvidence` of each kept file (verdict not `passed` → `stop`, reason `failing-test`), and `check.run` (non-ok → propagate). Every stop detail is `{cause}: {normalizeEventText(path)}:{line} {normalizeEventText(claim)}`.
- [ ] **Step 4: Run to verify they pass.** Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/review.test.js`. Expected: PASS.
- [ ] **Step 5: Commit.** `Add the reviewer step's one fix round (#5222)`.

### Task 8: The push uses the second check's head

**Role:** integration

**Files:**
- Test: `tests/bin-lib/driver/run.test.js`

No source change is expected. The push guard already reads the check head from the context, and the second `check` overwrites it. Change code only if a test goes red.

- [ ] **Step 1: Write the tests:**
  - `AC15: after a fix round the push guard compares HEAD with the second check's head`: the first `check` returns `head` `'a'.repeat(40)` and the second `'c'.repeat(40)`. `rev-parse HEAD` answers `'c'.repeat(40)`, and the push runs.
  - `AC15: a HEAD that equals only the first head stops at the push with no push`: `rev-parse HEAD` answers `'a'.repeat(40)`. Final `stop.step === 'push'`, and no `git push` call.
  - `AC15: the second check reads the second scoped run's stamp`: the `verify.js` call count before the second `check` is 2, and the second `check` call comes after the second `verify.js` call.
- [ ] **Step 2: Run them.** Run: `node --test tests/bin-lib/driver/run.test.js`. Expected: PASS. These pin existing behavior once Task 7 has landed, so a red result is a bug in Task 7 to fix here.
- [ ] **Step 3: Commit.** `Pin the push guard to the second check's head after a fix round (#5222)`.

### Task 9: `docs/driver.md` and the step-addition skill

**Role:** transcription

**Files:**
- Modify: `docs/driver.md` (the Event lines `step` list; a new "## The reviewer step" section; a policy row)
- Modify: `.claude/skills/driver-step-addition/SKILL.md` (one Sites-table sentence on `skip`)

- [ ] **Step 1: Write the docs.** In `docs/driver.md`:
  - Add `review` to the `step` list after `check`.
  - Add the review event's extra fields (`returned`, `reproduced`, `discarded`, `usage`, `denials`).
  - Add a section stating: the policy key `express-driver-review` with its three settings (`off`, `on`, `beyond-express`) and its default `beyond-express` (on for a record whose size label is missing or not `low`, or that has more than three Key Files); the step's place (after `check`, before `push`); that a finding counts only when its evidence test file, written by the driver and run once with `node --test`, fails; the one fix round.
  - Add the residuals (AC14), in these words or equivalent: the driver runs worker-written test code with its own rights, as its own test step and every other lane already do; the evidence test is run once, so a test that is red by flakiness confirms a finding that is not real; a red test is the reviewer's own assertion, so a wrong expectation confirms a wrong finding; the classification rule covers only the `npm test` → `node --test` shape Task 0 captured, and a Node or reporter upgrade means re-capturing the fixtures in `tests/bin-lib/driver/fixtures/review-evidence/`.
  - Note that a skipped step writes no line. In the skill's `run.js` row, add: "A step whose result is `skip: true` emits no event line and does not halt; use it for a step a policy turns off, so an off step leaves the event stream as it was."
- [ ] **Step 2: Verify.** Run: `grep -n "express-driver-review\|flakiness\|beyond-express" docs/driver.md`. Expected: at least three hits.
- [ ] **Step 3: Commit.** `Document the driver's reviewer step and its residuals (#5222)`.
