# Lens Reviewer Worker Role and Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run review lens briefs as lean, read-only headless `claude -p` workers through the driver's existing launcher, returning exactly the reply shape `review-coordination.js settle-lens-replies` already reads, with every worker's tokens counted in the run's `timing.json`.

**Architecture:** A new `lens-reviewer` role in `plugin/bin/lib/driver/roles.js` (Read, plus Grep/Glob and a closed set of read-only git rules only on `SANDBOX_PROBED_PLATFORMS`, under the sandbox block) whose generated settings come from a new `lensReviewerSettings` builder, selected in `worker.js` through one `settingsFor(role, opts)` dispatcher. A library `plugin/bin/lib/driver/lens-workers.js` validates the workflow script's input, launches one worker per side through `launchWorker` with a named concurrency bound and per-worker timeout, maps each envelope to `{lens, side, text, failed}`, and appends one dispatch record per worker to `{run}/worker-dispatches.jsonl`; the thin CLI `plugin/bin/review-lens-workers.js` wraps it. `timing/transcript.js` gains a reader for that file and `timing/run-timing.js` merges its items into `timing.json` `dispatches`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Claude Code CLI `claude -p` (headless), git.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T104447-record-6000/work/6000-spec.md` (record #6000)

**Scope keywords:** lens-reviewer, review-lens-workers, worker-dispatches

## Global Constraints

- Spec, Deliverable 1 (verbatim): "No Write, no Edit, no network. On a platform outside `SANDBOX_PROBED_PLATFORMS` the role has no Bash, so a lens brief that needs `git show` or `git log` cannot run there: the launcher marks that side `failed: true` with the reason `platform`, and the dispatcher falls back to the Task path (never an empty review)."
- Spec, Deliverable 1 (verbatim): "The probe covers repository-config-driven program starts as well as flags: textconv and external diff via `.gitattributes`, `core.pager`, `core.fsmonitor`, `-c` and `GIT_*` environment, `git grep --open-files-in-pager`, with `--no-ext-diff` and `--no-textconv` pinned where the probe needs them; the role header says that widening the allow list means re-probing."
- Spec, Deliverable 2 (verbatim): "A worker that fails, times out or returns blank text is `text: null, failed: true` with a `reason` (`launch`, `auth`, `timeout`, `blank`, `platform`) on stderr and in the launcher's log, not in the reply shape; a model reply of \"No findings.\" is a valid reply, never `blank`; one worker's failure never touches another's reply. The launcher's exit code is 0 when it printed the reply shape, and 2 on a malformed call."
- Spec, Deliverable 4 (verbatim): "The launcher rejects a lens `3f` entry before any worker starts: that side returns `failed: true` with `reason: excluded`, pinned by a unit test."
- Spec, Gotcha (verbatim): "A lens brief embeds untrusted diff text; the worker's rights, not the prompt, are what contain it. The `auth` flag here means the worker's launch credentials and rights: no credential beyond what `claude -p` needs reaches the generated settings, and no network is granted."
- Spec, Gotcha (verbatim): "Headless worker authentication on env-authenticated hosts is undecided (#5259); the launcher must report a launch failure as a failure, never as an empty review."
- The reply `side` labels are exactly `A` and `B` (side A only for `reviewers: 1`), as `plugin/workflows/review-lens-fanout.js` labels them; the dispatch-record `description` is `lens {lens} {side}`, the workflow agent label, so `derive.js`'s `ROLE_PATTERNS` books it as `lens reviewer`.
- Lens token class: `/^[A-Za-z0-9_-]+$/`, the same class `review-lens-fanout.js` and `settle-lens-replies` read.
- Existing roles keep byte-identical argv and settings (spec Key Files: "`worker.js` — reuse the launcher; no behaviour change for existing roles").
- Commit subjects: `{Verb} {what} — {detail}`, every one carrying `refs #6000`; never `closes`/`fixes`.

Governing skills, quoted verbatim:

- `.claude/skills/headless-worker-launch/SKILL.md` (governs `roles.js`, `worker.js`): "For every command an allow rule admits, list its flags that write a file, read outside the working directory (`git diff --no-index`), run a program (a pager, a configured hook, `-c` config) or reach the network, and probe each one through this module's own launcher. Add a step for the worst one to the opt-in live smoke test in `tests/bin-lib/driver/worker.test.js` (`AC7`, run with `DRIVER_LIVE_SMOKE=1`), the way `.git/info`, `.git/config` and `.git/hooks/pre-commit` writes were added."
- same skill: "Drive `launchWorker` from `worker.js` with the real `defaultRunner`, wrapped through the `runner` dependency so that it changes only what the probe tests (for a tool, its name in `--tools`). Every other flag, the environment and the generated settings stay the module's own; anything else measures a launch the driver never makes."
- same skill: "Take the evidence from each launch's session transcript, found by the result's `session_id` (see `transcript-payload-verification`): every `tool_use` input and its `tool_result`, plus the envelope's `denials`. The worker's own summary is its account of what happened, not evidence."
- same skill: "A case whose transcript holds no `tool_use` of the tool is not-called, never contained: re-run it once, and report it as unsettled if it is still not called."
- same skill: "Record each result in the module header with the CLI version, platform, date, login kind and whether a TTY was attached, and keep rights that rest on an unprobed cell off."
- same skill: "Every role launches with `--restricted`, which ignores user, project and local settings files while the generated `--settings` file still applies. A change that drops `--restricted` reopens that path."
- same skill: "`autoAllowBashIfSandboxed` defaults to true and then lets any sandboxed Bash command run with no allow rule, so it must stay false. Keep the deny rules when widening anything else."
- same skill: "No code path composes wider rights after a permission denial: a denial goes into the envelope's `denials` for the driver's event line."
- same skill: "The run loop that consumes the envelope must treat every string in `result`, `detail` when it carries the worker's own text, and `denials[].tool_input` as untrusted, and neutralize it before it reaches a command, a commit message, a comment or a log line."
- same skill (anti-pattern row): "A live smoke or probe prompt that leaves the worker to phrase its own Bash commands | The model rewrites them (haiku appended an exit-status echo to each, #5268), so an exact allow rule stops matching and an allowed step is denied unrun; tell it to run each command exactly as written, as the `AC7` prompt does"
- same skill (anti-pattern row): "Calling a git subcommand read-only because its name sounds like a read | `log`, `diff` and `show` take `--output`; `diff --no-index` reads any file; `status` runs `core.fsmonitor` from a configuration the worker may have written"
- same skill (anti-pattern row): "Writing a schema `required` list or a field list as an array literal that starts with `'status'` | `tests/git-status-optional-locks.test.js` reads it as a git argument list; derive the list instead (see `bin-source-scan-conformance`)"
- `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (governs the new CLI): "A CLI that tests call in-process meets the entry contract (#5374; `plugin/bin/resolve-policy.js` is the worked example). It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`." The implementer also reads that file's "A run-directory argument gets one of four boundary guards" bullet and `run-dir-boundary-guards.md` before writing `--run` handling.
- `.claude/skills/bin-source-scan-conformance/SKILL.md` and `.claude/skills/windows-checkout-test-parity/SKILL.md`: the new `plugin/bin` files pass the repo's source scans (`windowsHide` on spawns, path-guard for `fs.existsSync`/`realpathSync`); the implementer reads both before writing Task 4's CLI. `timing-procedure-read-counting` and `transcript-payload-verification` are read before Task 5 and Task 2 respectively.

## Review Focus

1. Lens briefs whose model says "No findings." or a reply ending in a status line only — must stay a valid reply (`failed: false`), never `blank` (Task 4 test `AC2.1/blank: "No findings." is a reply`).
2. A lens file naming `3f` among other lenses — only 3f's sides fail `excluded`; the others launch (Task 4 test).
3. The CLI killed mid-run (SIGINT/SIGTERM) — running workers (detached process groups on POSIX) are signalled, never orphaned (Task 4 test `forwards termination to every running worker`).
4. A worker whose envelope is `ok` but whose structured `text` is whitespace-only — `blank`, `failed: true` (Task 4 test).
5. A run dir that already has a `worker-dispatches.jsonl` from an earlier review round — records append; `timing.json` counts both rounds, not the last only (Task 5 test `two launcher runs append`).

---

### Task 1: The `lens-reviewer` role, its settings builder, and the settings dispatcher

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/roles.js` (header, `ROLES`, `DRIVER_ROLE_PROFILES`, `toolsFor`, new `lensReviewerSettings`, new `settingsFor`, new `LENS_REPLY_SCHEMA`, exports)
- Modify: `plugin/bin/lib/driver/worker.js:544-561` (call `settingsFor` instead of `implementerSettings`; derive toolchain read paths only for `implementer`)
- Test: `tests/bin-lib/driver/roles.test.js`, `tests/bin-lib/driver/worker.test.js`

**Interfaces:**
- Produces: `ROLES['lens-reviewer'] = { tools: ['Read', 'Grep', 'Glob', 'Bash'], settings: true }`; `DRIVER_ROLE_PROFILES['lens-reviewer'] = 'fast'` (code-only row, not in `POLICY_DRIVER_ROLES`); `LENS_REPLY_SCHEMA` = `{ type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }` (required derived from the property names, as `RESULT_SCHEMA` does); `lensReviewerSettings({ platform }) -> settings object`; `settingsFor(role, { testCommand, platform, readPaths }) -> settings object | null` (`implementer` → `implementerSettings`, `lens-reviewer` → `lensReviewerSettings`, a `settings: false` role → `null`); `toolsFor('lens-reviewer', p)` = `['Read','Grep','Glob','Bash']` on `darwin`, `['Read']` elsewhere.

`lensReviewerSettings` content (the starting rule set; Task 2's probe may only narrow it, and records why):
- `permissions.defaultMode: 'dontAsk'`; on a sandbox-probed platform `allow` = `Read`, `Grep`, `Glob`, `Bash(git diff --no-ext-diff --no-textconv *)`, `Bash(git show --no-ext-diff --no-textconv *)`, `Bash(git log --no-ext-diff --no-textconv *)`, `Bash(git grep *)`; off the probed platforms `allow` = `['Read']` and no sandbox block.
- `deny` = the implementer's six rules plus `Bash(* --output*)`, `Bash(* --ext-diff*)`, `Bash(* --textconv*)`, `Bash(* --no-index*)`, `Bash(* --open-files-in-pager*)`, `Bash(git grep * -O*)`, `Bash(git -c *)`, `Edit`, `Write`.
- sandbox-probed platforms only: `permissions.blockReadsOutsideWorkingDirectories: true`, and the implementer's sandbox block with `filesystem.allowRead: []` and, added, `filesystem.denyWrite: ['.']` (the working directory; Task 2 probes whether it takes effect and drops it with a header note if the CLI refuses the key).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/roles.test.js`:
  - `AC1.1: the lens-reviewer tool list and darwin settings are pinned` — `deepStrictEqual` of `toolsFor('lens-reviewer','darwin')`, of `lensReviewerSettings({platform:'darwin'})` against the literal object above, and of `composeArgs({role:'lens-reviewer', settingsFile:'/s/x.json', schema: LENS_REPLY_SCHEMA, platform:'darwin'})` containing `--restricted`, `--safe-mode`, `--settings`, and `--tools` `Read,Grep,Glob,Bash`.
  - `AC1.2: off the sandbox-probed platforms the lens-reviewer has no Bash at all` — for `linux`, `win32`: `toolsFor` is `['Read']`, settings keys are `['permissions']`, `allow` is `['Read']`, no `Bash(` rule in `allow`, `--tools` value is `Read`.
  - `lens-reviewer has no Write, Edit or network on any platform` — no `Write`/`Edit` in tools or allow; `sandbox.network.allowedDomains` deep-equals `[]` with `strictAllowlist: true` on darwin.
  - `Proof(auth) unit: no credential reaches the lens-reviewer settings` — `JSON.stringify(lensReviewerSettings(...))` for all three platforms contains none of `GH_TOKEN`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `env`, `apiKeyHelper`.
  - `settingsFor dispatches by role` — implementer output equals `implementerSettings` for the same input; `reviewer` → `null`.
  - Update the three existing invariants that the new role breaks, exempting `lens-reviewer` by name and asserting its own expectation instead: `AC1: every role but the implementer launches with no Bash, Edit or Write` (lens-reviewer: Bash only on darwin, never Edit/Write), `AC1: no role has an allow rule that can run gh` (extend the loop to `lensReviewerSettings` per platform), and its `settings === false` line (`lens-reviewer` has `settings: true`).
  - In `tests/bin-lib/driver/worker.test.js`: `lens-reviewer launch writes lensReviewerSettings and no toolchain readPaths` (fake runner captures the settings file text before cleanup; `allowRead` is `[]` even with a `testCommand` passed), and `existing roles: argv and settings unchanged` (implementer and reviewer argv/settings for a fixed input deep-equal values captured from `HEAD` before this task — paste them as literals).
- [ ] **Step 2: Run** `node --test tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/worker.test.js` — Expected: FAIL on the new tests (`lensReviewerSettings is not a function` / unknown role).
- [ ] **Step 3: Implement** the role, `LENS_REPLY_SCHEMA`, `lensReviewerSettings`, `settingsFor` and the `toolsFor` rule in `roles.js`; in `worker.js` replace the `implementerSettings(...)` call with `settingsFor(role, { testCommand, platform, readPaths })`, guard the `toolchainReadPaths` derivation and the caller-`readPaths` home check with `role === 'implementer'`, and pass `readPaths: []` for `lens-reviewer`. Add a `roles.js` header section "The lens-reviewer role" stating the rule set, that Grep/Glob are on only where probed (#5258), that widening the allow list means re-probing, and a placeholder line `Probe results: Task 2` that Task 2 replaces.
- [ ] **Step 4: Run** the same command — Expected: PASS, and `node --test tests/git-status-optional-locks.test.js` PASS.
- [ ] **Step 5: Commit** — `git add plugin/bin/lib/driver/roles.js plugin/bin/lib/driver/worker.js tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/worker.test.js` then `git commit -m "Add the lens-reviewer worker role — read-only rules and settings dispatcher, refs #6000"`.

### Task 2: Live probe matrix for the lens-reviewer rules, recorded in the header

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/roles.js` (header "Probe results", and narrow `lensReviewerSettings` if a probe fails)
- Test: `tests/bin-lib/driver/worker.test.js` (new opt-in live test beside `AC7`), `tests/bin-lib/driver/roles.test.js` (one negative unit test per vector)

**Interfaces:**
- Consumes: Task 1's `lensReviewerSettings`, `launchWorker({ role: 'lens-reviewer', schema: LENS_REPLY_SCHEMA, ... })`.

Probe repository: a throwaway `git init` repo in a temp dir with two commits, a `.gitattributes` of `* diff=evil`, and repo config `diff.evil.command`, `diff.evil.textconv`, `core.pager`, `core.fsmonitor` each set by the harness to a script that `touch`es a distinct marker file outside the repo (`$TMPDIR/ct-lens-probe-{vector}`). Prompt tells the worker to run each command exactly as written.

Vectors (each one probe case, evidence from the transcript's `tool_use`/`tool_result` and the envelope `denials`, plus the marker file's absence):
1. `git diff --no-ext-diff --no-textconv HEAD~1 HEAD --output=out.txt` (and `git log … --output=`, `git show … --output=`) — no file written anywhere.
2. `git diff HEAD~1 HEAD` without the pinned flags — denied (no allow rule matches).
3. External diff via `.gitattributes` + `diff.evil.command` — marker absent under the pinned `--no-ext-diff`.
4. Textconv via `diff.evil.textconv` — marker absent under `--no-textconv`.
5. `core.pager` — marker absent (no TTY; record that).
6. `core.fsmonitor` — `git diff --no-ext-diff --no-textconv` (worktree compare) — record whether the marker appears; if it does, the program ran inside the sandbox: record whether its network and outside writes were refused.
7. `git -c core.pager=… log …` — denied.
8. `GIT_EXTERNAL_DIFF=… git diff --no-ext-diff --no-textconv …` (env prefix) — denied.
9. `git grep --open-files-in-pager=… x` and `git grep -O… x` — denied.
10. `git diff --no-ext-diff --no-textconv --no-index /etc/hosts x` — denied.
11. A compound `git log --no-ext-diff --no-textconv -1; touch x` — the `touch` half denied.
12. `filesystem.denyWrite: ['.']` — accepted by the CLI or not (a refusal surfaces as `launch-error`).

- [ ] **Step 1: Write the negative unit tests** in `roles.test.js`, one per vector, each named `AC3.1 vector {n}: {short name} is not admitted by the lens-reviewer rules` — each asserts the generated settings either lack an allow rule matching the command's prefix or carry the deny rule naming its flag (string assertions over `allow`/`deny`; vector 6 asserts `sandbox.enabled === true` and `allowUnsandboxedCommands === false`).
- [ ] **Step 2: Write the opt-in live test** `AC4.1 (#6000): live probe — the lens-reviewer git rules write nothing and start no configured program` in `worker.test.js`, `skip: !process.env.DRIVER_LIVE_SMOKE && 'set DRIVER_LIVE_SMOKE=1 to launch real workers (spends tokens)'`, driving `launchWorker` with the real `defaultRunner` per the governing skill, model `haiku`, platform `process.platform`, asserting for every vector the marker file is absent and no `--output` target exists, and printing each vector's transcript evidence.
- [ ] **Step 3: Run** `node --test tests/bin-lib/driver/roles.test.js` — Expected: PASS (Task 1's rules already deny these; any FAIL is a missing deny rule: add it to `lensReviewerSettings` and re-run).
- [ ] **Step 4: Run** `DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern "AC4.1 \(#6000\)" tests/bin-lib/driver/worker.test.js > "$PIPELINE_RUN_DIR/evidence/lens-probe.txt" 2>&1` (run `mkdir -p "$PIPELINE_RUN_DIR/evidence"` first; `$PIPELINE_RUN_DIR` is the literal absolute run dir from the dispatch brief). Expected: PASS. A vector that writes or starts a program: narrow the rule set (drop the command from `allow`, e.g. drop `git grep` if `-O` cannot be denied), re-run, and record the drop. A vector that is not-called twice is recorded as unsettled and its command stays off `allow`.
- [ ] **Step 5: Replace** the header's `Probe results: Task 2` line with the per-vector results, the CLI version (`claude --version`), platform, date, login kind, TTY state, the routes left unprobed, and the sentence that widening the allow list means re-probing.
- [ ] **Step 6: Log** the evidence: `node "{plugin-root}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"` with `{text-file}` holding one line: `AC4.1 lens-reviewer probe: DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern "AC4.1 (#6000)" tests/bin-lib/driver/worker.test.js — {n} vectors contained, {m} dropped, {k} unsettled; log $PIPELINE_RUN_DIR/evidence/lens-probe.txt`.
- [ ] **Step 7: Commit** — `git commit -m "Probe the lens-reviewer git rules live — record vectors and results in the roles.js header, refs #6000"` with the two test files and `roles.js` added by path.

### Task 3: The lens worker's launch effort through #5942's mechanism

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/launch.js` (extract the `resolvePolicy` subset builder from `roleLaunch` into `modelPolicySubset(policy)`; add `launchEffortForModel(model, policy)`)
- Test: `tests/bin-lib/driver/launch.test.js`

**Interfaces:**
- Produces: `launchEffortForModel(model: string, policy: object) -> string | null` — the `PROFILES` entry whose `model` equals `model` (`haiku`→`fast`, `sonnet`→`standard`, `opus`→`capable`, `fable`→`frontier`), resolved by `resolve(profile, { policy: modelPolicySubset(policy), unattended: true })`, returning its `launchEffort`; an alias that is no profile family throws a `DRIVER_MODEL_REFUSED` error (the same `refuse` helper). `roleLaunch` behavior unchanged.

- [ ] **Step 1: Write the failing tests** — `AC3.1 effort: a sonnet lens launches at the profile effort under model-effort: profile` (`launchEffortForModel('sonnet', { 'model-effort': { value: 'profile' } }) === 'high'`), `… under inherit returns null`, `… a haiku lens returns null (fast has no dial)`, `… an unknown alias throws DRIVER_MODEL_REFUSED`, and `roleLaunch unchanged` (an existing `roleLaunch` assertion re-run against the refactored builder).
- [ ] **Step 2: Run** `node --test tests/bin-lib/driver/launch.test.js` — Expected: FAIL (`launchEffortForModel is not a function`).
- [ ] **Step 3: Implement** both functions; export them.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Resolve a lens worker's launch effort from its model's profile — #5942's mechanism, refs #6000"`.

### Task 4: The launcher library and CLI

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/lens-workers.js`
- Create: `plugin/bin/review-lens-workers.js`
- Modify: `docs/plugin-structure.md` (list the new CLI and module)
- Test: `tests/bin-lib/driver/lens-workers.test.js`, `tests/bin-lib/driver/review-lens-workers-cli.test.js`, `tests/review-lens-fanout-workflow.test.js`

**Interfaces:**
- Consumes: `launchWorker` (worker.js), `LENS_REPLY_SCHEMA`, `SANDBOX_PROBED_PLATFORMS` (roles.js), `launchEffortForModel` (launch.js).
- Produces:
  - Module header constants: `LENS_WORKER_CONCURRENCY = 4`, `LENS_WORKER_TIMEOUT_MS = 900000` (15 min), `EXCLUDED_LENSES = ['3f']`, `FAILURE_REASONS = ['launch', 'auth', 'timeout', 'blank', 'platform', 'excluded']`.
  - `inputRefusal(input) -> string | null` — the exact checks and messages of `review-lens-fanout.js`'s `refusal`.
  - `async runLensWorkers({ lenses, cwd, settingsDir, platform, policy, env, now }, deps) -> { reply: { started: true, lenses: [{lens, reviewers}], reviewers: [{lens, side, text, failed}] }, records: [workerRecord] }` — reply order is lens order then A, B, as the workflow returns it.
  - `classifyFailure(envelope) -> null | 'launch' | 'auth' | 'timeout' | 'blank'` — `timeout` for envelope status `timeout`; `auth` when the envelope's `detail` matches the authentication-failure wording captured in Step 1 below; `launch` for any other `fail`; `blank` for `ok` with `result.text` not a string or whitespace-only.
  - CLI `review-lens-workers.js --run <dir> --lenses-file <json> [--cwd <dir>]`: `run(argv, deps)` / `realDeps` per the CLI contract; prints the reply JSON on stdout, one `review-lens-workers: lens {lens} {side} failed: {reason}` stderr line per failed side; exit 0 when it printed the reply, 2 on a malformed call (unknown flag, missing `--run`/`--lenses-file`, unreadable/unparseable lens file, an `inputRefusal`, an unanchored `--run`). `--cwd` defaults to the main checkout that anchors `--run` (the directory holding both the run's worktree and its `context/` bundle); `settingsDir` is a per-run temp directory outside `cwd`.
  - On POSIX the CLI installs SIGINT/SIGTERM handlers that call `kill('SIGTERM')` on every running worker handle (tracked through a wrapping runner, as `launch.js`'s `launchTracked` does for the driver), then exits.

- [ ] **Step 1: Capture the auth-failure wording** — run `claude -p --output-format json "x"` once with `CLAUDE_CONFIG_DIR` set to an empty temp directory, save stdout/stderr to `$PIPELINE_RUN_DIR/evidence/auth-failure.txt`, and write the pattern from that text into `classifyFailure` with a comment quoting it, the CLI version and date.
- [ ] **Step 2: Write the failing tests** (fake runner returning canned `claude -p` result objects, as `worker.test.js` does):
  - `AC5.1: two lenses, four workers — the reply is byte-equal in shape to what settle-lens-replies accepts` — run, write the reply to a temp file, run `review-coordination.js settle-lens-replies <file> --ctx-id t` in-process, assert exit 0.
  - `AC5.2: a worker that exits non-zero fails only its own side` — one fake child exits 1; that side `{text:null, failed:true}`, the other three keep their texts.
  - `AC2.1: an auth-failure fake yields failed: true, never text: ""` — fake stdout/stderr from Step 1's capture; side is `text: null, failed: true`, stderr names `auth`.
  - `AC2.1 platform: off SANDBOX_PROBED_PLATFORMS every side fails with reason platform and no worker starts` — `platform: 'linux'`; runner never called.
  - `3f is excluded before any worker starts` — lenses `3b`,`3f`; 3f sides `failed: true`, stderr `excluded`, runner called only for 3b.
  - `blank: whitespace text is blank; "No findings." is a reply` — two fakes.
  - `timeout: a worker past LENS_WORKER_TIMEOUT_MS fails with reason timeout` (fake timers).
  - `concurrency: never more than LENS_WORKER_CONCURRENCY workers run at once` — six sides, counting live fake handles.
  - `effort: a sonnet lens under model-effort: profile launches with --effort high` — argv captured by the fake runner.
  - `Proof(auth) launcher: the worker env holds only ENV_ALLOW names` — the fake runner's `options.env` keys ⊆ `ENV_ALLOW`, with `GH_TOKEN` set in the parent env.
  - `forwards termination to every running worker` — CLI `run` with a fake runner whose children never exit, emit SIGTERM through an injected signal seam, assert every handle's `kill('SIGTERM')` called.
  - CLI: exit 2 cases (no `--run`, unknown flag, lens file not JSON, a refusal from `inputRefusal`), exit 0 prints the reply.
  - In `tests/review-lens-fanout-workflow.test.js`: `both producers' replies pass settle-lens-replies` — the workflow script's stubbed output and `runLensWorkers`' fake-runner output for the same two-lens input, each through `settle-lens-replies`, both exit 0 and produce the same pair verdicts.
- [ ] **Step 3: Run** `node --test tests/bin-lib/driver/lens-workers.test.js tests/bin-lib/driver/review-lens-workers-cli.test.js tests/review-lens-fanout-workflow.test.js` — Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `lens-workers.js` and the CLI. The worker's prompt is the lens brief verbatim (stdin); the reply `text` is `envelope.result.text` unmodified; the reason never enters the reply object. Every worker-controlled string written to stderr goes through `neutralize` (`plugin/bin/lib/driver/events.js`). Add both files to `docs/plugin-structure.md` beside the other driver modules and CLIs.
- [ ] **Step 5: Run** the Step 3 command plus `node --test tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js` — Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "Add review-lens-workers — run lens briefs as headless lens-reviewer workers, refs #6000"`.

Proof(auth): every lens worker launches through `launchWorker`, whose `buildEnv` passes only `ENV_ALLOW` (`PATH`, `HOME`, `USER`, `TMPDIR`, `LANG`, `CLAUDE_CONFIG_DIR`) so no forge token reaches it, under `--restricted --safe-mode` with generated settings whose sandbox network is `allowedDomains: []` and `strictAllowlist: true`; Task 1's settings test and Task 4's env test pin both, and Task 2's live probe shows no allowed command writes or starts a configured program.

### Task 5: Count lens worker tokens in `timing.json` dispatches

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/lens-workers.js` (build and append the dispatch records)
- Modify: `plugin/bin/lib/timing/transcript.js` (add `readWorkerDispatches`)
- Modify: `plugin/bin/lib/timing/run-timing.js` (`deriveTiming`/`collectDispatches` merge the worker items)
- Test: `tests/bin-lib/driver/lens-workers.test.js`, `tests/bin-lib/timing/transcript.test.js`, `tests/bin-lib/timing/run-timing.test.js`

**Interfaces:**
- Consumes: Task 4's `runLensWorkers` records.
- Produces:
  - `WORKER_DISPATCHES_FILE = 'worker-dispatches.jsonl'` (run-dir relative; the launcher appends, never rewrites).
  - A worker record (one JSON line per launched side; excluded and platform sides write none, since no worker ran): `{ kind: 'worker', agentId: sessionId || 'lens-{lens}-{side}-{startMs}', description: 'lens {lens} {side}', agentType: 'lens-reviewer', metaModel: model, transcriptModel: null, parentAgentId: null, spawnDepth: null, startTs, endTs, wallClockMs, tokens: { input, output, cacheRead, cacheCreate } | null, firstTurnTokens: number | null, costUsd, failed, reason, notFound: null | string, workflowRunId: null, workflowPhase: null }`. `tokens` maps the envelope `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`); null with `notFound: 'no usage in the worker envelope'` when the envelope has none. `firstTurnTokens` is the first assistant row's `inputTokens + cacheRead + cacheCreate` from the worker's own transcript (`locateTranscripts({ cwd, sessionId })` then `readUsage`), null when it cannot be found.
  - `readWorkerDispatches(runDir, { window, fsImpl }) -> { items, excludedOutsideWindow, notes }` — parses the file line by line, drops a malformed line into `notes`, keeps an item only inside `window` (by `startTs`), never throws.
  - `collectDispatches` takes `{ workerItems }` and adds them before `aggregateDispatches`; when no subagents directory is found but worker items exist, it returns a dispatches value (with `notFoundDirs`), not `{ notFound }`.
- Header of `lens-workers.js` documents the usage source (envelope for totals, worker transcript for first-turn tokens), the record fields and the `kind: worker` tag (spec Deliverable 3).

- [ ] **Step 1: Write the failing tests** — `AC6.1: lens worker tokens appear in timing.json dispatches for a run that used the launcher` (temp run dir with `events.jsonl`, run `runLensWorkers` with a fake runner whose result carries `usage`, then `deriveTiming(runDir, { transcriptPaths: [...], wantTokens: true })`; `timing.dispatches.items` holds two `kind: 'worker'` items with those token counts and `byRole['lens reviewer'].dispatches === 2`); `two launcher runs append` (second run, four items); `readWorkerDispatches skips a malformed line into notes`; `no subagents dir but worker items still yields dispatches`; `a failed worker with no usage is listed with tokens null and counted in no bucket`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/driver/lens-workers.test.js tests/bin-lib/timing/transcript.test.js tests/bin-lib/timing/run-timing.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the record build/append in `lens-workers.js` (append via one `fs.appendFileSync` per run of all records), `readWorkerDispatches`, and the merge.
- [ ] **Step 4: Run** the Step 2 command plus `node --test tests/bin-lib/timing/golden.test.js tests/bin-lib/timing/cli.test.js` — Expected: PASS (golden output unchanged for runs with no worker file).
- [ ] **Step 5: Real-input check** — run `node plugin/bin/phase-timing.js` (or the at-close writer) against one archived run dir under `.claude-tweaks/pipelines/archive/` that has no `worker-dispatches.jsonl` and confirm `dispatches` is byte-identical to `HEAD`'s output; record both outputs' `dispatches` digests in `$PIPELINE_RUN_DIR/evidence/timing-real-input.txt`.
- [ ] **Step 6: Commit** — `git commit -m "Count headless lens workers in timing.json dispatches — worker-dispatches.jsonl, refs #6000"`.

### Task 6: Live smoke — one Haiku lens worker on an archived brief

**Role:** integration

**Files:**
- Create: `tests/fixtures/review-lens-workers/smoke-lens-3b.json` (a `{ lenses: [{ lens: '3b', brief, model: 'haiku', reviewers: 1 }] }` file whose brief is lens 3b's instruction text from `plugin/skills/review/step3-lens-dispatch.md` applied to commit `2601ef2d8d` (#5990, a large diff), naming the range `2601ef2d8d~1..2601ef2d8d` and telling the worker to run `git show --no-ext-diff --no-textconv 2601ef2d8d` exactly as written)
- Test: `tests/bin-lib/driver/lens-workers.test.js` (opt-in live test)

- [ ] **Step 1: Write the opt-in test** `AC7.1 (#6000): live smoke — one haiku lens worker replies and its tokens are recorded`, `skip: !process.env.DRIVER_LIVE_SMOKE && 'set DRIVER_LIVE_SMOKE=1 to launch a real worker (spends tokens)'`: runs the CLI on the fixture into a temp run dir with `--cwd` the repository root, asserts exit 0, one reviewer with `failed: false` and a non-blank `text`, one `worker-dispatches.jsonl` record with non-null `tokens` and `firstTurnTokens`, and prints `firstTurnTokens` and the total (`input + output + cacheRead + cacheCreate`).
- [ ] **Step 2: Run** `DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern "AC7.1 \(#6000\)" tests/bin-lib/driver/lens-workers.test.js > "$PIPELINE_RUN_DIR/evidence/lens-smoke.txt" 2>&1` — Expected: PASS; total under 100000 is the target, an overrun is reported, not a failure.
- [ ] **Step 3: Log** an `AC evidence` decision (as Task 2 Step 6) carrying `AC7.1`, the command, first-turn and total tokens, and the log path; the PR quotes the same two numbers.
- [ ] **Step 4: Commit** — `git commit -m "Add the lens worker live smoke test — haiku lens 3b on #5990's diff, refs #6000"`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1, AC1.1, AC1.2 | 1 |
| AC3.1 (probe matrix, negative tests), AC4.1 | 2 |
| AC3.1 (effort through #5942) | 3 |
| Deliverable 2, AC2.1, AC5.1, AC5.2, 3f exclusion | 4 |
| Deliverable 3, AC6.1 | 5 |
| Deliverable 4, AC7.1 | 6 |
| Gotcha: reply-shape contract test across both producers | 4 |
| Gotcha: 3f stays off the worker path (say which in the PR) | 4 (excluded), PR text |

Waived plugin/bin/lib/driver/review.js: read only for context (its reviewer role is unchanged).
Waived plugin/skills/review/step3-lens-dispatch.md: read in Task 6 to compose the fixture brief; unchanged (the dispatcher that routes to this launcher is #6003).
Waived docs/superpowers/specs/2026-11-18-pipeline-economy-design.md: background only.
