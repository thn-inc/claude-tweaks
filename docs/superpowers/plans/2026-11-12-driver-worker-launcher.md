# Driver Worker Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A launcher that starts one headless `claude -p` worker for a named role with driver-generated rights and returns one envelope per launch.

**Architecture:** `roles.js` is pure data and builders: each role's tool list, flags and settings object. `worker.js` composes a launch from a role, writes the per-launch files, spawns through an injected runner, enforces the wall-clock ceiling, classifies the outcome and returns the envelope. Nothing here decides when to launch or acts on an envelope.

**Tech Stack:** Node 20+ built-ins only (`child_process`, `fs`, `path`, `crypto`), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T060404-spec-5217/work/5217-spec.md` (record #5217).

## Global Constraints

- Never pass `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, or any other bypass, for any role.
- There is no code path that launches a second time or composes wider rights after a denial.
- No new dependency. `plugin/bin/lib/impeccable-engine/index.js` is imported (`launchSpec`), never changed.
- Do not add a prompt sentence asking the worker to refuse instructions; rights are the containment.
- Commit messages: `{Verb} {what} — {detail}`, body ends with the line `Claude-Session: https://claude.ai/code/session_01Ngy9oVi97DUwAAwGPfXJV8`; write `refs #5217`, never `closes`.
- Nothing machine-specific goes into a committed file: no absolute local path, no account or login name, no settings content of the person who ran the probes.
- One plain command per Bash call in this worktree (no `&&`, no `$(...)`, no heredoc); file content goes through the Write tool.
- Test discipline (project-maturity `established`): "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them." Every file in this plan is new, so this applies only if a task finds it must touch an existing file.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

Rules quoted from the project skills that govern these files:

- `.claude/skills/gh-api-module-pattern`: "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.** The scan reads each `child_process` call's own argument text: it accepts a literal `windowsHide` key there, or a bare identifier as the whole options argument whose own `const X = { … }` literal names it". A spread carrying the flag does not satisfy it.
- `.claude/skills/gh-api-module-pattern`: "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently. Record values inside the runner, assert after it returns (an `AssertionError` thrown *inside* a runner can be swallowed by the module's own try/catch)." The same holds for the fake `claude` runner here.
- `.claude/skills/gh-api-module-pattern/async-fan-out.md`: "**`promisify(execFile)` (or `execFileSync`) must be called at the site the runner fires, not hoisted to module scope.**" Call `cp.spawn(...)` as a property access at the site, never a require-time destructure.
- `.claude/skills/gh-api-module-pattern/async-fan-out.md`: "Test an async timeout's classification branch with a mocked hung child …, never by racing a real short-lived process against a millisecond-scale deadline."
- `.claude/skills/windows-checkout-test-parity`: "Put the platform translation in a function whose OS inputs are arguments" and "Tests pass `'win32'` and `'linux'` explicitly"; never stub `process.platform`.
- `.claude/skills/windows-checkout-test-parity`: "A shape assertion (`startsWith('"')`, `includes('engine-probe')`) stays green when an escaping pass is dropped. Pin the whole output".
- `.claude/skills/windows-checkout-test-parity`: "When a `catch` turns a throw into a domain verdict, list the throws one platform produces and another does not, and give each its own reason." A spawn `EINVAL`/`ENOENT` is `launch-error`, never a worker result.
- `.claude/skills/windows-checkout-test-parity` (Anti-Patterns): "Reading `env.PATH` from a `{ ...process.env }` copy" fails on win32, whose stored key is `Path`: "match the keys the code replaces case-insensitively".
- `tests/path-guard-conformance.test.js` fails the suite on any `existsSync` or `realpathSync` token under `plugin/bin/`. Use neither: write with `{ flag: 'wx' }`, remove with `fs.rmSync(p, { force: true })`.

## Task 0 results (already captured; transcribe, do not re-run)

Probed 2026-11-12 with Claude Code CLI 2.1.322 on macOS (darwin), subscription login, model alias `haiku`, launched from a process with no TTY. Raw output: the run directory's `evidence/task0-probe.txt`. Sanitized fixtures to copy into the repository are in the scratch directory named in Task 1. These facts go into the module header comments in the tasks below, in plain sentences, without any local path.

- **(a) Result shape.** `--output-format json` prints one object with `type: "result"`. Fields used: `subtype` (`"success"`), `is_error`, `num_turns`, `total_cost_usd`, `usage` (with `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`), `permission_denials` (array of `{ tool_name, tool_use_id, tool_input }`), `result` (string) and, when `--json-schema` is passed, `structured_output` (the schema object; `result` then holds the same object as a JSON string).
- **(b) Spend ceiling.** `--max-budget-usd` takes effect under subscription login. With a ceiling of 0.0001 the process exited 1 after one turn and printed a result with `subtype: "error_max_budget_usd"`, `is_error: true`, `errors: ["Reached maximum budget ($0.0001)"]`, no `result` and no `structured_output`. The check runs between turns: the turn that crossed the ceiling completed (its file write landed) and `total_cost_usd` was above the ceiling.
- **(c) Project file.** Both `--append-system-prompt` and `--system-prompt` carried the text to the worker (a codeword placed in it was repeated back). `--append-system-prompt-file <path>` with the prompt on stdin also worked, and is what the launcher uses, so neither text is on the command line. Starting context with this repository's `CLAUDE.md` appended: about 15,300 tokens, against about 6,200 with nothing appended.
- **(d) Hooks.** A default launch ran the plugin's SessionStart hook (it created `.claude-tweaks/` in the working directory). Adding only `--safe-mode` did not.
- **(e) Rights leakage, and the flag it changed.** Under `--setting-sources project`, an allow rule in the working directory's own `.claude/settings.json` let a command absent from the generated allow list run, once that directory sat under a checkout the person had already trusted (in an untrusted temporary directory the same rule was ignored). The `Read` tool also read a file outside the working directory. Under `--restricted` both were refused, and the generated `--settings` file still applied. **The implementer therefore launches with `--restricted` in place of `--setting-sources project`.** User-level rules were not probed with a scratch home, because a scratch configuration directory carries no subscription login; `--restricted` ignores user, project and local settings files by its documented contract.
- **(f) Environment.** `PATH`, `HOME` and `USER` were the minimum that launched logged in. `CLAUDE_CONFIG_DIR` is passed through too: without it the worker used the default configuration directory's login, not the launching session's.
- **Sandbox (criterion 12).** With `sandbox.enabled: true`, `allowUnsandboxedCommands: false`, `network.allowedDomains: []` and `network.strictAllowlist: true`, a test file the worker ran with `node --test` could reach none of: `curl` to an HTTPS host (exit 56), `gh api` ("host is not on the allow list"), `git ls-remote` over HTTPS (403 from the proxy), `git push` to a bare repository outside the working directory (rejected), a file write outside the working directory (`EPERM`). With the sandbox off all five succeeded. **`sandbox.autoAllowBashIfSandboxed` defaults to true and then lets any sandboxed Bash command run without an allow rule** (`touch` ran); with it set to `false`, `touch` was denied while `node --test`, `git status --short` and `git log --oneline -1` ran. `sandbox.failIfUnavailable: true` is taken from the documentation and was not exercised, since the sandbox was available on the probe host.
- **Not probed:** Linux and Windows; a launch started by a person from a terminal (the opt-in smoke test is that probe).

## Review Focus

- A prompt or project file larger than a Windows command line (32,767 characters): the launch must still work, so neither may be on the argument list. Test in Task 2.
- Standard output that is not one result object (empty, truncated, or a warning line): the launcher must return `fail`, never throw and never report `ok`. Tests in Task 2.
- A result with no `structured_output` (schema flag ignored by a different CLI): `fail`/`schema`, never a parse of the free-text `result`. Test in Task 2.
- A `testCommand` carrying `)` or a newline would corrupt the allow rule: `implementerSettings` throws. Test in Task 1.
- A launch that throws after the per-launch files are written (the runner rejects): both files are still removed. Test in Task 2.

---

### Task 1: Role table, settings builder and Task 0 evidence

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/roles.js`
- Create: `tests/bin-lib/driver/fixtures/worker-result.json`
- Create: `tests/bin-lib/driver/fixtures/worker-result-budget.json`
- Test: `tests/bin-lib/driver/roles.test.js`

**Interfaces:**
- Produces (all exported from `roles.js`):
  - `RESULT_SCHEMA`: `{ type: 'object', properties: { status: { type: 'string', enum: ['done', 'cannot-complete'] }, title: { type: 'string' }, summary: { type: 'string' } }, required: ['status', 'title', 'summary'], additionalProperties: false }`
  - `SANDBOX_PROBED_PLATFORMS`: `['darwin']`
  - `ROLES`: `{ implementer: { tools: ['Read', 'Write', 'Edit', 'Bash'], settings: true }, reviewer: { tools: ['Read', 'Grep', 'Glob'], settings: false }, explorer: { tools: ['Read', 'Grep', 'Glob'], settings: false } }`
  - `implementerSettings({ testCommand, platform }) -> object`
  - `composeArgs({ role, settingsFile, appendPromptFile, schema, spendCeiling, model }) -> string[]` (throws `Error` on an unknown role)

- [ ] **Step 1: Copy the two fixtures and write the failing tests**

Read `worker-result.json` and `worker-result-budget.json` from the scratch fixtures directory named in your task brief and write each, byte for byte, to `tests/bin-lib/driver/fixtures/` with the Write tool. They are already sanitized (ids, the temporary path and the credential expiry replaced); do not edit them. Then write `tests/bin-lib/driver/roles.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { ROLES, RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, implementerSettings, composeArgs } = require(path.join(LIB, 'driver', 'roles.js'));

const ALLOW_SANDBOXED = ['Read', 'Edit', 'Write', 'Bash(node --test *)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)'];
const ALLOW_EDIT_ONLY = ['Read', 'Edit', 'Write', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)'];
const DENY = ['Bash(gh *)', 'Bash(git push *)', 'Bash(git commit *)', 'Bash(git add *)', 'Bash(curl *)', 'Bash(wget *)'];
const SANDBOX = { enabled: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false, failIfUnavailable: true, network: { allowedDomains: [], strictAllowlist: true } };

test('AC2: implementer settings on a sandbox-probed platform pin defaultMode and the exact allow and deny lists', () => {
  const s = implementerSettings({ testCommand: 'node --test', platform: 'darwin' });
  assert.strictEqual(s.permissions.defaultMode, 'dontAsk');
  assert.deepStrictEqual(s.permissions.allow, ALLOW_SANDBOXED);
  assert.deepStrictEqual(s.permissions.deny, DENY);
});

test('AC2: the test command is a parameter, and no other interpreter rule exists', () => {
  const s = implementerSettings({ testCommand: 'npm test --', platform: 'darwin' });
  assert.ok(s.permissions.allow.includes('Bash(npm test -- *)'));
  const others = s.permissions.allow.filter((r) => r !== 'Bash(npm test -- *)');
  for (const r of others) assert.doesNotMatch(r, /^Bash\((node|npm|sh|bash|python)\b/);
});

test('AC12: on a sandbox-probed platform the sandbox block is present with these exact keys', () => {
  assert.deepStrictEqual(SANDBOX_PROBED_PLATFORMS, ['darwin']);
  assert.deepStrictEqual(implementerSettings({ testCommand: 'node --test', platform: 'darwin' }).sandbox, SANDBOX);
});

test('AC12: off the sandbox-probed platforms there is no sandbox block and no rule that can execute a file the worker wrote', () => {
  for (const platform of ['linux', 'win32']) {
    const s = implementerSettings({ testCommand: 'node --test', platform });
    assert.deepStrictEqual(Object.keys(s), ['permissions']);
    assert.deepStrictEqual(s.permissions.allow, ALLOW_EDIT_ONLY);
    assert.deepStrictEqual(s.permissions.deny, DENY);
  }
});

test('Review focus: a testCommand that would corrupt the rule is refused', () => {
  for (const bad of ['node --test)', 'node\n--test', '', 'a*b', undefined]) {
    assert.throws(() => implementerSettings({ testCommand: bad, platform: 'darwin' }), /testCommand/);
  }
});

test('AC1: the implementer argument list carries every flag, in this exact order', () => {
  const args = composeArgs({ role: 'implementer', settingsFile: '/s/settings.json', appendPromptFile: '/s/append.md', schema: RESULT_SCHEMA, spendCeiling: 2.5, model: 'haiku' });
  assert.deepStrictEqual(args, [
    '-p', '--safe-mode', '--restricted', '--tools', 'Read,Write,Edit,Bash', '--disable-slash-commands', '--strict-mcp-config',
    '--settings', '/s/settings.json', '--permission-prompts', 'none', '--output-format', 'json',
    '--json-schema', JSON.stringify(RESULT_SCHEMA), '--append-system-prompt-file', '/s/append.md', '--max-budget-usd', '2.5', '--model', 'haiku',
  ]);
});

test('AC1: optional parts are omitted when not given', () => {
  const args = composeArgs({ role: 'implementer', settingsFile: '/s/settings.json', schema: RESULT_SCHEMA });
  for (const flag of ['--append-system-prompt-file', '--max-budget-usd', '--model']) assert.ok(!args.includes(flag), flag);
});

test('AC3: reviewer and explorer launch with --restricted, read-only tools, no Bash and no settings file', () => {
  for (const role of ['reviewer', 'explorer']) {
    const args = composeArgs({ role, schema: RESULT_SCHEMA });
    assert.deepStrictEqual(args, ['-p', '--safe-mode', '--restricted', '--tools', 'Read,Grep,Glob', '--disable-slash-commands', '--strict-mcp-config', '--permission-prompts', 'none', '--output-format', 'json', '--json-schema', JSON.stringify(RESULT_SCHEMA)]);
    assert.ok(!ROLES[role].tools.includes('Bash'));
    assert.strictEqual(ROLES[role].settings, false);
  }
});

test('AC1: no role ever carries a bypass, in arguments or settings', () => {
  const settings = JSON.stringify(['darwin', 'linux', 'win32'].map((platform) => implementerSettings({ testCommand: 'node --test', platform })));
  for (const role of Object.keys(ROLES)) {
    const text = composeArgs({ role, settingsFile: '/s/x.json', appendPromptFile: '/s/a.md', schema: RESULT_SCHEMA, spendCeiling: 1, model: 'm' }).join('\n') + settings;
    assert.ok(!text.includes('--dangerously-skip-permissions'));
    assert.ok(!text.includes('bypassPermissions'));
    assert.ok(!text.includes('--setting-sources'));
  }
});

test('composeArgs refuses an unknown role', () => {
  assert.throws(() => composeArgs({ role: 'merger', schema: RESULT_SCHEMA }), /unknown role/);
});

test('Task 0 fixtures carry the field names the launcher reads', () => {
  const ok = require('./fixtures/worker-result.json');
  const budget = require('./fixtures/worker-result-budget.json');
  for (const k of ['type', 'subtype', 'is_error', 'num_turns', 'total_cost_usd', 'usage', 'permission_denials', 'structured_output']) assert.ok(k in ok, k);
  assert.strictEqual(budget.subtype, 'error_max_budget_usd');
  assert.ok(!('structured_output' in budget));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/driver/roles.test.js`
Expected: FAIL with `Cannot find module` for `driver/roles.js`

- [ ] **Step 3: Implement `roles.js`**

- `implementerSettings({ testCommand, platform })`: throws `TypeError` whose message contains `testCommand` unless `testCommand` is a string matching `/^[A-Za-z0-9 ._\/:=-]+$/`. Returns `{ permissions: { defaultMode: 'dontAsk', allow, deny }, sandbox }` with the arrays and sandbox block the tests pin when `SANDBOX_PROBED_PLATFORMS.includes(platform)`; on any other platform it returns `{ permissions }` only, with no `sandbox` key and without `Bash(${testCommand} *)` (which otherwise sits fourth in `allow`). The spec's "Plan Review Clarifications" section records this as the user's decision.
- `composeArgs`: the order the tests pin. `--settings` only when the role has `settings: true`; `--append-system-prompt-file`, `--max-budget-usd` (as `String(spendCeiling)`) and `--model` only when given.
- Header comment, in plain sentences: what the module is; the "Task 0 results" bullets (e) and "Sandbox (criterion 12)" above including the `autoAllowBashIfSandboxed` finding, with the CLI version, date, platform and login type; that `--restricted` replaced `--setting-sources project` and which probe forced it; that the test-command rule and the sandbox block exist only on platforms where the sandbox was probed, and that elsewhere the worker only edits; that the user-level leakage probe the record asked for (a broad allow rule in a scratch home directory) was not run and why, as an unprobed residual; that a launch the CLI refuses because the sandbox is unavailable surfaces as `launch-error`; the residual, verbatim: "the driver's own test step runs worker-written code with the driver's rights, as every other lane does today"; and that permission denials are data for the driver's event line, never a reason to widen a list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/roles.test.js`
Expected: PASS, 11 tests, 0 failed

- [ ] **Step 5: Commit**

`git add plugin/bin/lib/driver/roles.js tests/bin-lib/driver/roles.test.js tests/bin-lib/driver/fixtures/worker-result.json tests/bin-lib/driver/fixtures/worker-result-budget.json`, then commit with subject `Add driver worker roles — per-role tools, flags and generated settings (refs #5217)`.

---

### Task 2: The launcher and its envelope

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/driver/worker.js`
- Test: `tests/bin-lib/driver/worker.test.js`

**Interfaces:**
- Consumes: `ROLES`, `RESULT_SCHEMA`, `implementerSettings`, `composeArgs` from Task 1; `launchSpec(launcher, args, platform, env)` from `plugin/bin/lib/impeccable-engine/index.js` (returns `{ file, args, options }`).
- Produces (exported from `worker.js`):
  - `ENVELOPE_FIELDS`: `['status', 'reason', 'result', 'usage', 'turns', 'denials', 'spendOverrun', 'costUsd', 'detail']`
  - `ENV_ALLOW`: `['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'CLAUDE_CONFIG_DIR']`; `ENV_ALLOW_WIN32`: `ENV_ALLOW` plus `['USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']`
  - `buildEnv(parentEnv, platform) -> object`
  - `conformsTo(schema, value) -> boolean` (throws `Error` naming the keyword on a schema keyword outside `type` (`object`|`string`), `properties`, `required`, `enum`, `additionalProperties`)
  - `launchWorker(opts, deps) -> Promise<Envelope>` where `opts = { role, cwd, prompt, ceilings: { wallClockMs, spendCeiling }, testCommand, claudeMdText, settingsDir, platform, env, schema, model, bin }` (`schema` defaults to `RESULT_SCHEMA`, `bin` to `'claude'`, `platform` to `process.platform`, `env` to `process.env`) and `deps = { runner, timers }`.
  - Runner contract, used by Task 3: `runner({ file, args, options, input, platform }) -> { pid, kill(signal), exited: Promise<{ code, signal, stdout, stderr }> }`. `options` carries `cwd`, `env` and whatever `launchSpec` returned; `platform` is the launch's `opts.platform`, passed on every call so the runner never consults `process.platform` itself. A runner that cannot start the child rejects `exited` (or throws) with the spawn error.

Outcome classification, in this order (write it as one function over `{ timedOut, spawnError, code, signal, stdout, stderr }`):

| Condition | status | reason | detail |
|---|---|---|---|
| the launcher killed the child at the wall-clock ceiling | `timeout` | `wall-clock-ceiling` | `null` |
| the runner threw or `exited` rejected | `fail` | `launch-error` | the error's `code` and message |
| stdout holds no result object, `code` is a non-zero number and stdout is empty after trimming | `fail` | `launch-error` | first non-empty stderr line, else `exit {code}` |
| a result object with `subtype === 'error_max_budget_usd'` | `fail` | `spend-ceiling` | `errors` joined with `; ` |
| a result object, and `code !== 0` or `is_error === true` or `subtype !== 'success'` | `fail` | `exit` | the `result` string, else `exit {code}` or the signal name |
| no result object (any other case: non-JSON stdout, signal death) with `code !== 0` | `fail` | `exit` | `exit {code}` or the signal name, plus the first stderr line |
| `structured_output` absent, or `conformsTo(schema, structured_output)` false, or stdout unparseable with `code === 0` | `fail` | `schema` | `null` |
| otherwise | `ok` | `null` | `null` |

A "result object" is stdout that `JSON.parse`s (after trimming) to an object with `type === 'result'`. Whenever one exists, the envelope takes `usage` from `usage`, `turns` from `num_turns`, `denials` from `permission_denials` (passed through unchanged; `[]` when absent), `costUsd` from `total_cost_usd`, and `spendOverrun` is `true` exactly when a spend ceiling was given and `total_cost_usd > spendCeiling`. Without one: `usage: null`, `turns: null`, `denials: []`, `costUsd: null`, `spendOverrun: false`. `result` is `structured_output` only when status is `ok`, else `null`.

Per-launch files: under `settingsDir` (created with `fs.mkdirSync(settingsDir, { recursive: true })`), named `worker-{process.pid}-{n}-{16 random hex chars}.settings.json` and `….append.md` (`n` is a module-level counter), written with `{ flag: 'wx', mode: 0o600 }`. The settings file exists only for a role with `settings: true`; the append file only when `claudeMdText` is a non-empty string. Both are removed in a `finally` that runs after the child has exited, on every path including a throw.

The prompt is handed to the runner as `input` and is never on the argument list. `ceilings.spendCeiling`, when given, must be a finite number above zero, else `launchWorker` rejects with a `RangeError` before writing anything.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/worker.test.js`

Shared helpers at the top of the file:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const worker = require(path.join(LIB, 'driver', 'worker.js'));
const { launchWorker, buildEnv, conformsTo, ENVELOPE_FIELDS, ENV_ALLOW, ENV_ALLOW_WIN32 } = worker;
const { RESULT_SCHEMA } = require(path.join(LIB, 'driver', 'roles.js'));
const OK = require('./fixtures/worker-result.json');
const BUDGET = require('./fixtures/worker-result-budget.json');

// A fake runner: records every call, answers with `outcome` (or rejects with `spawnError`).
function fakeRunner(outcome, { spawnError } = {}) {
  const calls = [];
  const runner = (call) => {
    const record = { ...call, files: {} };
    for (const flag of ['--settings', '--append-system-prompt-file']) {
      const i = call.args.indexOf(flag);
      if (i !== -1) record.files[flag] = { path: call.args[i + 1], text: fs.readFileSync(call.args[i + 1], 'utf8') };
    }
    calls.push(record);
    return { pid: 4242, kill() { throw new Error('unexpected kill'); }, exited: spawnError ? Promise.reject(spawnError) : Promise.resolve({ signal: null, stderr: '', ...outcome }) };
  };
  return { runner, calls };
}
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-worker-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const base = (t, extra = {}) => ({ role: 'implementer', cwd: tmp(t), prompt: 'do the thing', ceilings: { wallClockMs: 60000 }, testCommand: 'node --test', settingsDir: tmp(t), platform: 'darwin', env: { PATH: '/bin', HOME: '/h', USER: 'u' }, ...extra });
const okOut = (over = {}) => ({ code: 0, stdout: JSON.stringify({ ...OK, ...over }) });
```

Tests (each its own `test(...)`, named as written):

1. `AC5: an ok result fills every envelope field from the result` — `launchWorker(base(t), { runner })` with `okOut()`; assert `Object.keys(env)` deep-equals `ENVELOPE_FIELDS`, `status === 'ok'`, `reason === null`, `result` deep-equals `OK.structured_output`, `usage` deep-equals `OK.usage`, `turns === OK.num_turns`, `denials` deep-equals `OK.permission_denials` (length 2), `costUsd === OK.total_cost_usd`, `spendOverrun === false`, `detail === null`.
2. `AC5: the envelope field names are pinned` — `assert.deepStrictEqual(ENVELOPE_FIELDS, ['status', 'reason', 'result', 'usage', 'turns', 'denials', 'spendOverrun', 'costUsd', 'detail'])`.
3. `AC5: a result that fails the schema is fail/schema` — `okOut({ structured_output: { status: 'maybe', title: 't', summary: 's' } })` gives `status 'fail'`, `reason 'schema'`, `result null`, and still carries `turns` and `denials`.
4. `Review focus: a result with no structured_output is fail/schema, and the free-text result is not parsed` — build the stdout from `OK` with `structured_output` deleted and `result` set to a JSON string of a valid object; expect `fail`/`schema`.
5. `AC5: a non-zero exit with a result object is fail/exit` — `{ code: 1, stdout: JSON.stringify({ ...OK, is_error: true, result: 'Not logged in · Please run /login' }) }`; expect `fail`/`exit` and `detail` containing `Not logged in`.
6. `AC6: a result with permission denials stays ok, and the runner is called exactly once` — after test 1's launch: `calls.length === 1`; the one settings file text equals `JSON.stringify(implementerSettings({ testCommand: 'node --test', platform: 'darwin' }), null, 2)` (import it), so no wider list was composed.
7. `AC8: the CLI stopping at the spend ceiling is fail/spend-ceiling` — `{ code: 1, stdout: JSON.stringify(BUDGET) }` with `ceilings: { wallClockMs: 60000, spendCeiling: 0.0001 }`; expect `fail`/`spend-ceiling`, `detail` `'Reached maximum budget ($0.0001)'`, `spendOverrun === true`, and `--max-budget-usd` followed by `'0.0001'` in the recorded args.
8. `AC8: a cost above the ceiling on a normal result reports spendOverrun and leaves the status alone` — `okOut({ total_cost_usd: 3 })` with `spendCeiling: 2`; expect `status 'ok'`, `spendOverrun true`. Second assertion: same without a ceiling gives `spendOverrun false` and no `--max-budget-usd` in args.
9. `Review focus: a spend ceiling that is not a positive finite number is refused before anything is written` — for `0`, `-1`, `NaN`, `'2'`: `assert.rejects(launchWorker(...), RangeError)`, `calls.length === 0`, `fs.readdirSync(settingsDir)` is empty.
10. `AC9: a spawn error is fail/launch-error with the error named` — `fakeRunner({}, { spawnError: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) })`; expect `fail`/`launch-error`, `detail` matching `/ENOENT/`, `result null`, `turns null`.
11. `AC9: a flag the CLI does not know is fail/launch-error, never a worker result` — `{ code: 1, stdout: '', stderr: "error: unknown option '--restricted'\n" }`; expect `fail`/`launch-error` and `detail === "error: unknown option '--restricted'"`.
12. `Review focus: stdout that is not one result object never reads as ok` — table: `{ code: 0, stdout: 'warning: x\n' }` → `fail`/`schema`; `{ code: 0, stdout: '' }` → `fail`/`schema`; `{ code: 0, stdout: '{"type":"other"}' }` → `fail`/`schema`; `{ code: 2, stdout: 'partial {' }` → `fail`/`exit`; `{ code: null, signal: 'SIGKILL', stdout: '' }` → `fail`/`exit` with `detail` matching `/SIGKILL/`.
13. `AC10: the runner receives only allow-listed environment names` — parent `env` `{ PATH: '/bin', HOME: '/h', USER: 'u', TMPDIR: '/t', LANG: 'C', CLAUDE_CONFIG_DIR: '/c', PIPELINE_RUN_DIR: '/r', CLAUDE_CODE_SESSION_ID: 's', GH_TOKEN: 'g', GITHUB_TOKEN: 'g2', SECRET: 'x' }`; assert `Object.keys(calls[0].options.env).sort()` deep-equals `[...ENV_ALLOW].sort()`.
14. `AC10: on win32 the allow list matches names case-insensitively and keeps the stored spelling` — `buildEnv({ Path: 'p', USERPROFILE: 'u', ComSpec: 'c', GH_TOKEN: 'g' }, 'win32')` deep-equals `{ Path: 'p', USERPROFILE: 'u', ComSpec: 'c' }`; `buildEnv({ Path: 'p' }, 'linux')` deep-equals `{}`; `ENV_ALLOW_WIN32` contains every `ENV_ALLOW` name.
15. `AC11: two concurrent launches use distinct files and both are removed` — one shared `settingsDir`, `Promise.all` of two launches each with `claudeMdText: 'project rules'`; the four recorded paths are distinct, each is inside `settingsDir`, the recorded append text is `'project rules'`, and `fs.readdirSync(settingsDir)` is empty afterwards.
16. `Review focus: the per-launch files are removed when the launch fails to start` — with the `spawnError` runner and `claudeMdText` set: `fs.readdirSync(settingsDir)` is empty after the envelope returns.
17. `Review focus: the prompt and the project file never reach the argument list` — `prompt` and `claudeMdText` each `'x'.repeat(40000)`; assert `calls[0].input === prompt`, no element of `calls[0].args` has length above 1000, `calls[0].file === 'claude'` and `calls[0].args[0] === '-p'`.
18. `reviewer launches write no settings file` — `role: 'reviewer'`: `calls[0].args` has no `--settings`, and `calls[0].files` has no `--settings` key.
19. `conformsTo covers the schema subset and refuses the rest` — true for a valid result; false for a missing key, an extra key, a wrong enum value, a non-string title, `null`, an array; `assert.throws(() => conformsTo({ type: 'object', patternProperties: {} }, {}), /patternProperties/)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/driver/worker.test.js`
Expected: FAIL with `Cannot find module` for `driver/worker.js`

- [ ] **Step 3: Implement `worker.js`** to the Interfaces block and the classification table

`deps.runner` is required in this task (Task 3 adds the default). Compose with `composeArgs`, pass the result through `launchSpec(bin, args, platform, env)` and call `runner({ file, args, options: { ...spec.options, cwd, env: buildEnv(env, platform) }, input: prompt, platform })`. The settings file text is `JSON.stringify(implementerSettings({ testCommand, platform }), null, 2)`. Header comment, in plain sentences: the envelope contract (field names, the classification table in words, "fields may be added, never renamed"), the runner contract, and Task 0 results (a), (b), (c), (d) and (f) with the CLI version, date, platform and login type, including that the ceiling is checked between turns and that `CLAUDE_CONFIG_DIR` selects the login.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/worker.test.js`
Expected: PASS, 19 tests, 0 failed

- [ ] **Step 5: Run the source scans that walk `plugin/bin/`**

Run: `node --test tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failed

- [ ] **Step 6: Commit**

`git add plugin/bin/lib/driver/worker.js tests/bin-lib/driver/worker.test.js`, then commit with subject `Add the driver worker launcher — one envelope per headless launch (refs #5217)`.

---

### Task 3: Wall-clock ceiling, the real runner and the live smoke test

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/worker.js`
- Test: `tests/bin-lib/driver/worker.test.js`

**Interfaces:**
- Consumes: `launchWorker(opts, deps)` and the runner contract from Task 2.
- Produces (added exports): `KILL_GRACE_MS = 5000`; `REAP_DEADLINE_MS = 5000`; `defaultRunner({ file, args, options, input, platform }, { spawn } = {}) -> handle` (`platform` defaults to `process.platform`; `spawn` defaults to `cp.spawn`, read at the call site); `launchWorker`'s `deps` now defaults to `{ runner: defaultRunner, timers: { setTimeout, clearTimeout } }`.

Ceiling behaviour: `launchWorker` arms `timers.setTimeout(onCeiling, ceilings.wallClockMs)` after the runner returns the handle and clears it when the child exits. `ceilings.wallClockMs` must be a finite number above zero, else a `RangeError` before anything is written. `onCeiling`, by `platform`:
- not `win32`: `handle.kill('SIGTERM')`, then `timers.setTimeout(onGrace, KILL_GRACE_MS)`, cleared when the child exits; `onGrace` calls `handle.kill('SIGKILL')` and arms the reap deadline.
- `win32`: `runner({ file: 'taskkill', args: ['/T', '/F', '/PID', String(handle.pid)], options: {}, input: '', platform })`; its own outcome is awaited and ignored (a rejection too), then the reap deadline is armed.

Reap deadline: `timers.setTimeout(onDeadline, REAP_DEADLINE_MS)`, cleared when the child exits. The envelope is returned when `handle.exited` settles, with `timeout`/`wall-clock-ceiling` whatever the child printed and `detail: null`. Only if the deadline fires first (a child that survives the kill, or a descendant holding its output open) does the launcher return without it: `timeout`/`wall-clock-ceiling` with `detail: 'child {pid} did not exit after kill'`. A launcher that waited forever would hang the driver; the header comment says so. A `kill` that throws (the child is already gone) is swallowed. The per-launch files are removed on this path too.

`defaultRunner`: `spawn(file, args, { ...options, detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })`, where `spawn` is the injected one or `cp.spawn` with `cp` being `require('node:child_process')`, accessed as a property at the call site. It writes `input` to stdin and ends it, collects stdout and stderr as UTF-8 strings, resolves `exited` on `close` with `{ code, signal, stdout, stderr }`, and rejects it on the child's `error` event. `kill(signal)` is `process.kill(-child.pid, signal)` when `platform !== 'win32'`, else `child.kill(signal)`. An `EPIPE` on stdin (the child exited before reading) is ignored.

- [ ] **Step 1: Write the failing tests** (appended to `tests/bin-lib/driver/worker.test.js`)

A hung fake for these tests:

```js
// Never exits on its own. `dieOn` names what ends it: a signal name, or 'taskkill'.
function hungRunner(dieOn) {
  const calls = []; const kills = []; let finish;
  const exited = new Promise((resolve) => { finish = resolve; });
  const runner = (call) => {
    calls.push(call);
    if (call.file === 'taskkill') { if (dieOn === 'taskkill') finish({ code: 1, signal: null, stdout: '', stderr: '' }); return { pid: 1, kill() {}, exited: Promise.resolve({ code: 0, signal: null, stdout: '', stderr: '' }) }; }
    return { pid: 4242, kill(sig) { kills.push(sig); if (sig === dieOn) finish({ code: null, signal: sig, stdout: '', stderr: '' }); }, exited };
  };
  return { runner, calls, kills };
}
// Timers that record each delay and fire on the next tick, so no test waits on a real clock.
// `hold` lists delays that are recorded but never fired (the test decides the child's fate instead).
function instantTimers({ hold = [] } = {}) {
  const delays = []; const cleared = [];
  return { delays, cleared, timers: { setTimeout: (fn, ms) => { delays.push(ms); return hold.includes(ms) ? { held: ms } : setImmediate(fn); }, clearTimeout: (h) => { cleared.push(h); if (h && !h.held) clearImmediate(h); } } };
}
```

Every test below passes `ceilings: { wallClockMs: 1234 }`. `KILL_GRACE_MS` and `REAP_DEADLINE_MS` are both 5000, so `hold: [5000]` holds both; they are told apart by position in `delays`.

1. `AC4: at the ceiling a POSIX child gets SIGTERM and the envelope is timeout/wall-clock-ceiling` — `hungRunner('SIGTERM')`, `platform: 'linux'`, `ceilings: { wallClockMs: 1234 }`, `instantTimers()`; expect `status 'timeout'`, `reason 'wall-clock-ceiling'`, `kills` deep-equals `['SIGTERM']`, `delays[0] === 1234`.
2. `AC4: a POSIX child that ignores SIGTERM gets SIGKILL after KILL_GRACE_MS` — `hungRunner('SIGKILL')`; expect `kills` deep-equals `['SIGTERM', 'SIGKILL']`, `delays.slice(0, 2)` deep-equals `[1234, worker.KILL_GRACE_MS]`, `worker.KILL_GRACE_MS === 5000`, `worker.REAP_DEADLINE_MS === 5000`, and `detail === null`.
3. `AC4: on win32 the ceiling runs taskkill on the child's pid` — `hungRunner('taskkill')`, `platform: 'win32'`, `env: { Path: 'p' }`; expect `timeout`/`wall-clock-ceiling`, `kills` deep-equals `[]`, and the second recorded call has `file === 'taskkill'` and `args` deep-equal `['/T', '/F', '/PID', '4242']`.
4. `AC4: the envelope is returned only after the child has exited` — a runner whose `exited` resolves only when the test calls a `release()` it holds and whose `kill` only records; timers `instantTimers({ hold: [5000] })` (the grace and the reap deadline are recorded, never fired). After `await new Promise(setImmediate)` three times, a `settled` flag set in `.then` is still `false` and `kills` deep-equals `['SIGTERM']`; call `release({ code: null, signal: 'SIGTERM', stdout: '', stderr: '' })`, await the launch, expect `timeout`/`wall-clock-ceiling` with `detail === null`.
4b. `a child that survives the kill is given up on at the reap deadline, with its pid named` — `hungRunner('never')` (nothing ends it), `platform: 'linux'`, `instantTimers()`; expect `timeout`/`wall-clock-ceiling`, `kills` deep-equals `['SIGTERM', 'SIGKILL']`, `delays` deep-equals `[1234, worker.KILL_GRACE_MS, worker.REAP_DEADLINE_MS]`, `detail === 'child 4242 did not exit after kill'`, and `fs.readdirSync(settingsDir)` empty. Same on `platform: 'win32'` with `env: { Path: 'p' }`: `kills` deep-equals `[]`, a `taskkill` call recorded, `delays` deep-equals `[1234, worker.REAP_DEADLINE_MS]`, same `detail`.
5. `AC4: a child that exits before the ceiling clears the timer and is classified normally` — `fakeRunner(okOut())` with timers that record `clearTimeout` calls; expect `status 'ok'` and exactly one clear.
6. `a wall-clock ceiling that is not a positive finite number is refused` — `0`, `-5`, `NaN`, `undefined`: `assert.rejects(..., RangeError)` and the runner is never called.
7. `AC9: the win32 launch of a .cmd launcher is pinned as an exact string` — `platform: 'win32'`, `bin: 'C:\\x\\claude.cmd'`, `role: 'reviewer'`, `env: { ComSpec: 'cmd.exe', Path: 'p' }`, `fakeRunner(okOut())`; assert `calls[0].file === 'cmd.exe'`, `calls[0].args.slice(0, 3)` deep-equals `['/d', '/s', '/c']`, `calls[0].options.windowsVerbatimArguments === true`, and `calls[0].args[3]` strictly equals this literal, written in the test with `String.raw` (do not call `launchSpec` or `escapeBatchArg` from the test); pass `schema: { type: 'object' }`:

```text
"C:\x\claude.cmd ^^^"-p^^^" ^^^"--safe-mode^^^" ^^^"--restricted^^^" ^^^"--tools^^^" ^^^"Read^^^,Grep^^^,Glob^^^" ^^^"--disable-slash-commands^^^" ^^^"--strict-mcp-config^^^" ^^^"--permission-prompts^^^" ^^^"none^^^" ^^^"--output-format^^^" ^^^"json^^^" ^^^"--json-schema^^^" ^^^"{\^^^"type\^^^":\^^^"object\^^^"}^^^""
```

   That line is what the existing `launchSpec` printed for these arguments when the plan was written; its escaping is pinned and round-trip tested in `tests/bin-lib/impeccable-engine/windows-launch.test.js`.
8. `AC9: a non-.cmd launcher passes through untouched on every platform` — `platform: 'win32'`, default `bin`: `calls[0].file === 'claude'` and `calls[0].args[0] === '-p'`.
9. `defaultRunner pipes input to the child and resolves with its output` — `worker.defaultRunner({ file: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], options: { cwd: os.tmpdir(), env: process.env }, input: 'hello' })`; `await handle.exited` deep-equals `{ code: 0, signal: null, stdout: 'hello', stderr: '' }`, and `handle.pid` is a number.
9b. `defaultRunner takes detached and its kill from the platform it is given` — pass a recording `spawn` as the second argument (`(file, args, o) => { seen.push(o); return cp.spawn(file, args, o); }`, `cp` being `require('node:child_process')`) and run a hung child (`process.execPath`, `['-e', 'setInterval(()=>{},1000)']`): with `platform: 'win32'`, `seen[0].detached === false`, `seen[0].windowsHide === true`, and `handle.kill('SIGTERM')` ends it (`exited` resolves with `signal: 'SIGTERM'`); with `platform: 'linux'`, `seen[0].detached === true` and `handle.kill('SIGTERM')` ends it too. Give the `'linux'` half `{ skip: process.platform === 'win32' && 'win32: no process groups' }` as its own test.
10. `defaultRunner rejects when the binary does not exist` — `file: path.join(os.tmpdir(), 'no-such-binary-5217')`; `assert.rejects(handle.exited, /ENOENT/)`. Through `launchWorker` with `bin` set to that path and the default deps: `fail`/`launch-error`.
11. `defaultRunner kill ends the child and a grandchild it started (POSIX only)` — `{ skip: process.platform === 'win32' && 'win32: no process groups; taskkill covers it' }`. Child script (via `-e`): spawn a grandchild `node -e "setInterval(()=>{},1000)"` with `stdio: 'ignore'`, print the grandchild pid on stdout, then `setInterval(()=>{},1000)`. The child also writes a marker file (its path passed as an argument) once the grandchild pid is printed; the test waits for that file with `fs.watch`-free polling (`fs.readdirSync` of its temp directory, up to 50 tries 100 ms apart), then calls `handle.kill('SIGTERM')`, awaits `handle.exited`, parses the grandchild pid from the resolved `stdout`, and polls `process.kill(grandPid, 0)` up to 50 times, 100 ms apart, until it throws `ESRCH`; assert it did. No assertion is on elapsed time.
12. `AC7: live smoke test — the write runs, echo and curl are denied` — `{ skip: !process.env.DRIVER_LIVE_SMOKE && 'set DRIVER_LIVE_SMOKE=1 to launch a real worker (spends tokens)' }`. Real `launchWorker` with default deps: `role: 'implementer'`, a fresh temp `cwd` and `settingsDir`, `model: 'haiku'`, `testCommand: 'node --test'`, `ceilings: { wallClockMs: 180000, spendCeiling: 1 }`, `claudeMdText: 'Probe project file.'`, `prompt`: "Do these three things in order: (1) use the Write tool to create smoke-w.txt containing hi; (2) run the bash command: echo hi > smoke-b.txt (3) run the bash command: curl -s https://example.com -o smoke-net.txt Then report what happened." Assert: `status === 'ok'`; `smoke-w.txt` exists in `cwd` (use `fs.readdirSync(cwd)`); `smoke-b.txt` and `smoke-net.txt` do not; `denials` has at least one entry whose `tool_input.command` includes `echo` and at least one whose `tool_input.command` includes `curl`; `fs.readdirSync(settingsDir)` is empty. Remove both directories in `t.after`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/driver/worker.test.js`
Expected: FAIL — the new tests fail (no `KILL_GRACE_MS`, no `defaultRunner`, no ceiling handling) while Task 2's 19 still pass

- [ ] **Step 3: Implement the ceiling, `KILL_GRACE_MS` and `defaultRunner`** to the Interfaces block

Extend the header comment with the kill contract (process group on POSIX, `taskkill /T /F /PID` on win32, the 5 second grace, the reap deadline and why the launcher gives up instead of waiting forever) and one sentence that Windows and Linux launches were not probed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/worker.test.js`
Expected: PASS with 1 skipped (the live smoke test), 0 failed

- [ ] **Step 5: Run the source scans and the role tests**

Run: `node --test tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/driver/roles.test.js`
Expected: PASS, 0 failed

- [ ] **Step 6: Commit**

`git add plugin/bin/lib/driver/worker.js tests/bin-lib/driver/worker.test.js`, then commit with subject `Add the worker wall-clock ceiling and real runner — group kill, taskkill, opt-in smoke test (refs #5217)`.

---

## Spec coverage

| Spec item | Where |
|---|---|
| Task 0 (a)-(f), escape probe | Captured before planning; "Task 0 results" above; fixtures in Task 1; header comments in Tasks 1-3 |
| Deliverable: `roles.js` | Task 1 |
| Deliverable: `worker.js`, CLAUDE.md pass-through, spend ceiling | Task 2 |
| Deliverable: wall-clock ceiling | Task 3 |
| Deliverable: tests and opt-in live smoke test | Tasks 1-3 |
| AC1, AC2, AC3, AC12 | Task 1 tests |
| AC5, AC6, AC8, AC10, AC11, AC9 (launch-error) | Task 2 tests |
| AC4, AC7, AC9 (win32 launch pin) | Task 3 tests |
| AC8 closing comment on the record | Posted at wrap-up from the "Task 0 results" (b) text; not a code task |

Acceptance-criterion clauses, by id:

| Clause ids | Covered by |
|---|---|
| AC1.1 | Task 1: "AC1: the implementer argument list carries every flag, in this exact order" (`--restricted` standing in for `--setting-sources project`, per Task 0 (e)) |
| AC1.2 | Task 1: "AC1: no role ever carries a bypass, in arguments or settings" |
| AC2.1, AC2.2, AC2.3, AC2.4 | Task 1: "AC2: implementer settings on a sandbox-probed platform pin defaultMode and the exact allow and deny lists" |
| AC2.5 | Task 1: "AC2: the test command is a parameter, and no other interpreter rule exists" |
| AC3.1 | Task 1: "AC3: reviewer and explorer launch with --restricted, read-only tools, no Bash and no settings file" |
| AC4.1 | Task 3 tests 1 and 4 |
| AC4.2 | Task 2 Interfaces (runner contract; the promise also carries `signal`) and Task 3 test 9 |
| AC4.3 | Task 3 test 11 (a detached child's group is what `kill` reaches) |
| AC4.4 | Task 3 tests 1, 2 and 11 |
| AC4.5 | Task 3 test 3 |
| AC4.6 | Task 3 tests 1 to 3 pass `platform` explicitly |
| AC5.1, AC5.4 | Task 2 tests 1 and 6 |
| AC5.2 | Task 2 tests 3 and 4 |
| AC5.3 | Task 2 tests 5 and 12 |
| AC5.5 | Task 2 test 2 |
| AC5.6, AC5.7 | Task 1: `RESULT_SCHEMA` as pinned in the Interfaces block and used by the argument-list test; Task 2 test 19 |
| AC6.1 | Task 2 test 6 |
| AC7.1 | Task 3 test 12 |
| AC8.1 | Header comment (Task 2 Step 3, result (b)); the closing comment is posted at wrap-up |
| AC8.2, AC8.3 | Task 2 tests 7 and 8 |
| AC9.1 | Task 2 tests 10 and 11; Task 3 tests 7, 8 and 10 |
| AC10.1, AC10.2 | Task 2 tests 13 and 14 |
| AC11.1 | Task 2 test 15 |
| AC12.1, AC12.2 | The escape probe, run before planning; result in "Task 0 results" and the `roles.js` header (Task 1 Step 3) |
| AC12.3 | Task 1: "AC12: on a sandbox-probed platform the sandbox block is present with these exact keys" |
| AC12.4 | Task 1: "AC12: off the sandbox-probed platforms there is no sandbox block and no rule that can execute a file the worker wrote" |
| AC12.5 | `roles.js` header comment (Task 1 Step 3) |

Waived plugin/bin/lib/impeccable-engine/index.js: read-only; Task 2 Step 3 imports `launchSpec` from it in place and Task 3 test 7 pins what it returns.

Deviations from the spec's text, each under the authority the spec gives Task 0:

- `--setting-sources project` is replaced by `--restricted` (probe (e)).
- The prompt travels on stdin and the project file through `--append-system-prompt-file`, so the runner contract gains `input` and the promise also carries `signal`.
- The test-command rule and the sandbox block exist only where the sandbox was probed (`darwin`); elsewhere the worker only edits. Decided by the user at plan review (the spec's "Plan Review Clarifications").
- A non-zero exit with empty stdout is `launch-error`; a non-zero exit with a result object, or with other output, is `exit`. Decided by the user at plan review.
- A child that has not exited `REAP_DEADLINE_MS` after the kill is given up on, so in that one case the envelope is returned before the child has exited (criterion 4 says "only after").
- The user-level leakage probe of Task 0 (e) was not run; it is stated as an unprobed residual in the `roles.js` header and in the record's closing comment.
