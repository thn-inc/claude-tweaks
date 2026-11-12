'use strict';
// The driver's worker launcher: composes one headless `claude -p` launch from a role
// (see roles.js), writes the per-launch files, hands the launch to an injected runner,
// classifies what came back and returns one envelope. Nothing here retries, and there
// is no path that composes wider rights after a denial: denials are data in the
// envelope, never a reason to launch again.
//
// The envelope. Every launch resolves to one object with these fields, in this order
// (ENVELOPE_FIELDS): status, reason, result, usage, turns, denials, spendOverrun,
// costUsd, detail. Fields may be added, never renamed. `status` is `ok`, `fail` or
// `timeout`; `reason` is null for `ok`, else one of `wall-clock-ceiling`,
// `launch-error`, `spend-ceiling`, `exit` or `schema`. `result` is the worker's
// structured output when status is `ok` and null otherwise. A structured output whose
// `title` holds a line break (`\n` or `\r`) is `fail` with reason `schema`: the title
// is meant to be one line.
//
// Untrusted text. `result` (every string in it), `detail` when it carries the worker's
// own `result` string, and `denials[].tool_input` are text the worker controls. A
// consumer must treat them as untrusted: never place them in a command, and neutralize
// them before they reach a commit message, a comment or a log line that a person or a
// tool will act on.
//
// How an outcome is classified, first match wins. The launcher killed the child at the
// wall-clock ceiling: `timeout`. The runner threw or its `exited` promise rejected:
// `launch-error`, naming the error. No result object on stdout, a non-zero exit code
// and an empty stdout (an unknown flag, for instance): `launch-error`, with the first
// line of stderr. A result object whose subtype is `error_max_budget_usd`:
// `spend-ceiling`. A result object with a non-zero exit code, `is_error` true or a
// subtype other than `success`: `exit`. No result object and a non-zero exit code or a
// death by signal: `exit`. A missing structured output, one that does not conform to
// the schema, or stdout that is not a result object after a zero exit: `schema`.
// Anything else is `ok`. A "result object" is stdout that parses, after trimming, to
// an object with `type: "result"`; whenever one exists, `usage`, `turns`, `denials`
// and `costUsd` are read from it, and `spendOverrun` is true exactly when a spend
// ceiling was given and the reported cost is above it. The free-text `result` string
// is never parsed.
//
// The runner contract. `runner({ file, args, options, input, platform })` returns
// `{ pid, kill(signal), exited }`, where `exited` resolves to
// `{ code, signal, stdout, stderr }`. `options` carries `cwd`, `env` (only the names in
// ENV_ALLOW, or ENV_ALLOW_WIN32 on win32) and whatever the platform launch
// translation added. `platform` is the launch's own platform, so a runner never
// consults the host's. The prompt is passed as `input`, to be written to the child's
// standard input; it is never on the argument list. A runner that cannot start the
// child rejects `exited` (or throws) with the spawn error.
//
// What the launch rests on. These facts were probed on 2026-11-12 with Claude Code CLI
// 2.1.322 on macOS (darwin), under a subscription login, with the model alias
// `haiku`, launched from a process with no TTY. Linux and Windows were not probed.
//
// - Result shape. `--output-format json` prints one object with `type: "result"`. The
//   fields read here are `subtype` (`"success"`), `is_error`, `num_turns`,
//   `total_cost_usd`, `usage` (holding `input_tokens`, `cache_creation_input_tokens`,
//   `cache_read_input_tokens` and `output_tokens`), `permission_denials` (an array of
//   `{ tool_name, tool_use_id, tool_input }`), `result` (a string) and, when
//   `--json-schema` is passed, `structured_output`.
// - Spend ceiling. `--max-budget-usd` takes effect under subscription login. With a
//   ceiling of 0.0001 the process exited 1 after one turn and printed a result with
//   `subtype: "error_max_budget_usd"`, `is_error: true` and `errors` holding
//   `Reached maximum budget ($0.0001)`, with no `result` and no `structured_output`.
//   The ceiling is checked between turns: the turn that crossed it completed, and the
//   reported cost was above the ceiling. That is why `spendOverrun` exists.
// - Project file. `--append-system-prompt-file <path>` with the prompt on stdin
//   carried the project text to the worker, so neither text is on the command line.
//   Appending a repository's project file took the starting context from about 6,200
//   tokens to about 15,300.
// - Hooks. A default launch ran the plugin's SessionStart hook, which created a
//   directory in the working directory; adding `--safe-mode` stopped that.
// - Environment. `PATH`, `HOME` and `USER` were the minimum that launched logged in.
//   `CLAUDE_CONFIG_DIR` is passed through as well, because it selects the login.
// - Smoke test. The opt-in live smoke test passed once on the same CLI, date and
//   platform, launched from a process with no TTY. A run started by a person from a
//   terminal has not been recorded.
//
// On win32 the default `bin` of `claude` does not find an npm-installed `claude.cmd`;
// a win32 caller passes `bin` explicitly.
//
// Per-launch files live under the caller's settings directory, with the process id, a
// counter and random hex in their names, are written exclusively with mode 0600, and
// are removed after the child has exited on every path, including a throw. The
// settings directory and the working directory must both be absolute paths, and the
// settings directory must lie outside the working directory: the implementer's Edit
// and Write rules cover the working directory, so a rights file inside it could be
// edited by the worker. The check is lexical (no symbolic link is resolved) and the
// caller is trusted code. The prompt must be a string.
//
// The wall-clock ceiling. The launcher enforces it, never the runner: once the runner
// has returned the child's handle, a timer for `ceilings.wallClockMs` is armed, and it
// is cleared when the child exits. At the ceiling the child is killed. On POSIX the
// child was started as the leader of its own process group, so the launcher sends
// SIGTERM to the whole group; if the child is still running KILL_GRACE_MS (5 seconds)
// later, it sends SIGKILL to the group. On win32 there are no process groups, so the
// launcher runs `taskkill /T /F /PID {pid}` (the whole process tree, forced) through
// the runner, with the allow-listed environment, and ignores its outcome: nothing
// waits on it. A kill that throws because the child is already gone is swallowed. A
// reap deadline of REAP_DEADLINE_MS (5 seconds) starts after the SIGKILL on POSIX and
// as soon as taskkill has been started on win32; if it fires, a taskkill still running
// is killed, and on win32 the worker handle's own `kill('SIGKILL')` is called once. The
// envelope is returned once the child has exited, as `timeout` with reason
// `wall-clock-ceiling`, built from whatever the child printed. Only when the deadline
// passes first (a child that survives the kill, or a descendant that holds the child's
// output open) does the launcher return without waiting, with `detail` naming the pid.
// A launcher that waited forever would hang the driver that called it. The per-launch
// files are removed on this path too. The Windows and Linux kill paths were not probed
// against a real worker.
//
// Termination of the launcher itself. On POSIX the worker is spawned detached, as the
// leader of its own process group, so it does not die when the launching process is
// interrupted or dies. Whoever calls the launcher must forward termination to it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('node:child_process');
const { launchSpec } = require('../impeccable-engine');
const { ROLES, RESULT_SCHEMA, implementerSettings, composeArgs, assertSpendCeiling } = require('./roles');

const ENVELOPE_FIELDS = Object.freeze(['status', 'reason', 'result', 'usage', 'turns', 'denials', 'spendOverrun', 'costUsd', 'detail']);
const ENV_ALLOW = Object.freeze(['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'CLAUDE_CONFIG_DIR']);
const ENV_ALLOW_WIN32 = Object.freeze([...ENV_ALLOW, 'USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']);

// Copies only allow-listed names. On win32 names match case-insensitively (the stored
// key is `Path`) and keep the spelling they were stored under.
function buildEnv(parentEnv, platform) {
  const out = {};
  const source = parentEnv || {};
  if (platform === 'win32') {
    const wanted = new Set(ENV_ALLOW_WIN32.map((n) => n.toLowerCase()));
    for (const key of Object.keys(source)) {
      if (wanted.has(key.toLowerCase()) && source[key] !== undefined) out[key] = source[key];
    }
  } else {
    for (const key of ENV_ALLOW) {
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) out[key] = source[key];
    }
  }
  return out;
}

const SCHEMA_KEYWORDS = ['type', 'properties', 'required', 'enum', 'additionalProperties'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Throws, naming the keyword, when a schema or any schema nested under `properties`
// uses something outside the subset `conformsTo` handles.
function assertSupportedSchema(schema) {
  if (!isPlainObject(schema)) throw new Error('schema must be an object');
  for (const keyword of Object.keys(schema)) {
    if (!SCHEMA_KEYWORDS.includes(keyword)) throw new Error('unsupported schema keyword: ' + keyword);
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    throw new Error('unsupported schema keyword: additionalProperties (only a boolean is handled)');
  }
  if (schema.type !== undefined && schema.type !== 'object' && schema.type !== 'string') {
    throw new Error('unsupported schema keyword: type ' + JSON.stringify(schema.type));
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) throw new Error('unsupported schema keyword: properties (must be an object)');
    for (const key of Object.keys(schema.properties)) assertSupportedSchema(schema.properties[key]);
  }
}

// A validator for the small JSON Schema subset the worker result schema uses. A
// keyword outside that subset throws, so a schema can never be half-checked.
function conformsTo(schema, value) {
  assertSupportedSchema(schema);
  if (schema.type === 'object' && !isPlainObject(value)) return false;
  if (schema.type === 'string' && typeof value !== 'string') return false;
  if (schema.enum !== undefined && !schema.enum.includes(value)) return false;
  if (schema.required !== undefined) {
    if (!isPlainObject(value)) return false;
    for (const key of schema.required) if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
  }
  if (schema.properties !== undefined && isPlainObject(value)) {
    for (const key of Object.keys(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && !conformsTo(schema.properties[key], value[key])) return false;
    }
  }
  if (schema.additionalProperties === false && isPlainObject(value)) {
    const known = schema.properties || {};
    for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(known, key)) return false;
  }
  return true;
}

function parseResultObject(stdout) {
  if (typeof stdout !== 'string') return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    return isPlainObject(parsed) && parsed.type === 'result' ? parsed : null;
  } catch {
    return null;
  }
}

function firstLine(text) {
  if (typeof text !== 'string') return '';
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') || '';
}

function exitWhat(code, signal) {
  return typeof code === 'number' ? 'exit ' + code : (signal || 'exit ' + code);
}

function describeError(err) {
  if (err && typeof err === 'object') return (err.code ? err.code + ': ' : '') + String(err.message);
  return String(err);
}

const KILL_GRACE_MS = 5000;
const REAP_DEADLINE_MS = 5000;
// The largest delay a timer takes; a larger one fires after 1 ms, killing the child at once.
const MAX_TIMER_MS = 2147483647;

function classify({ timedOut, timeoutDetail, spawnError, code, signal, stdout, stderr }, { schema, spendCeiling }) {
  const obj = parseResultObject(stdout);
  const cost = obj && typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : null;
  const envelope = (status, reason, detail, okResult) => ({
    status,
    reason,
    result: okResult === undefined ? null : okResult,
    usage: obj && obj.usage !== undefined ? obj.usage : null,
    turns: obj && obj.num_turns !== undefined ? obj.num_turns : null,
    denials: obj && Array.isArray(obj.permission_denials) ? obj.permission_denials : [],
    spendOverrun: obj !== null && typeof spendCeiling === 'number' && cost !== null && cost > spendCeiling,
    costUsd: cost,
    detail,
  });
  const empty = typeof stdout !== 'string' || stdout.trim() === '';

  if (timedOut) return envelope('timeout', 'wall-clock-ceiling', timeoutDetail === undefined ? null : timeoutDetail);
  if (spawnError !== undefined) return envelope('fail', 'launch-error', describeError(spawnError));
  if (!obj && typeof code === 'number' && code !== 0 && empty) {
    return envelope('fail', 'launch-error', firstLine(stderr) || 'exit ' + code);
  }
  if (obj && obj.subtype === 'error_max_budget_usd') {
    return envelope('fail', 'spend-ceiling', Array.isArray(obj.errors) ? obj.errors.join('; ') : exitWhat(code, signal));
  }
  if (obj && (code !== 0 || obj.is_error === true || obj.subtype !== 'success')) {
    return envelope('fail', 'exit', typeof obj.result === 'string' && obj.result !== '' ? obj.result : exitWhat(code, signal));
  }
  if (!obj && code !== 0) {
    const line = firstLine(stderr);
    return envelope('fail', 'exit', exitWhat(code, signal) + (line ? ': ' + line : ''));
  }
  if (!obj || obj.structured_output === undefined || !conformsTo(schema, obj.structured_output)) {
    return envelope('fail', 'schema', null);
  }
  const title = isPlainObject(obj.structured_output) ? obj.structured_output.title : undefined;
  if (typeof title === 'string' && /[\r\n]/.test(title)) return envelope('fail', 'schema', null);
  return envelope('ok', null, null, obj.structured_output);
}

let launchCounter = 0;

// Waits for the child to exit, enforcing the wall-clock ceiling (see the header). Every
// timer armed here is cleared before this returns, whichever way the launch ends.
async function superviseChild({ handle, runner, platform, env, wallClockMs, timers }) {
  const armed = [];
  let finished = false;
  let timedOut = false;
  let giveUp;
  let killerHandle;
  const gaveUp = new Promise((resolve) => { giveUp = resolve; });
  const arm = (fn, ms) => {
    const timer = timers.setTimeout(fn, ms);
    armed.push(timer);
    return timer;
  };
  const kill = (signal) => {
    try {
      handle.kill(signal);
    } catch {
      // The child is already gone.
    }
  };
  const armReap = () => {
    if (!finished) arm(giveUp, REAP_DEADLINE_MS);
  };
  const onGrace = () => {
    kill('SIGKILL');
    armReap();
  };
  const onCeiling = () => {
    timedOut = true;
    if (platform === 'win32') {
      try {
        killerHandle = runner({ file: 'taskkill', args: ['/T', '/F', '/PID', String(handle.pid)], options: { env: buildEnv(env, platform) }, input: '', platform });
      } catch {
        // Its outcome is ignored, a throw included.
      }
      // Nothing waits on taskkill: its `exited` is observed only to swallow a rejection.
      Promise.resolve(killerHandle && killerHandle.exited).then(() => {}, () => {});
      armReap();
    } else {
      kill('SIGTERM');
      arm(onGrace, KILL_GRACE_MS);
    }
  };
  try {
    arm(onCeiling, wallClockMs);
    const settled = await Promise.race([
      handle.exited.then((result) => ({ result }), (err) => ({ err: err === undefined ? new Error('launch failed') : err })),
      gaveUp.then(() => ({ gaveUp: true })),
    ]);
    if (settled.gaveUp) {
      // A taskkill that is still running is not left behind.
      if (killerHandle) {
        try {
          killerHandle.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      }
      // On win32 nothing else has signalled the worker's own handle yet.
      if (platform === 'win32') kill('SIGKILL');
      return { timedOut: true, timeoutDetail: 'child ' + handle.pid + ' did not exit after kill' };
    }
    if (settled.err !== undefined) return { timedOut, spawnError: settled.err };
    return { timedOut, ...settled.result };
  } catch (err) {
    return { timedOut, spawnError: err === undefined ? new Error('launch failed') : err };
  } finally {
    finished = true;
    for (const timer of armed) timers.clearTimeout(timer);
  }
}

// The launch's own spawn, used when the caller injects no runner. `spawn` is read at the
// call site so a test can swap it. The child leads its own process group on POSIX so the
// ceiling's kill reaches its descendants.
function defaultRunner({ file, args, options, input, platform = process.platform }, { spawn } = {}) {
  const spawnFn = spawn || cp.spawn;
  const child = spawnFn(file, args, { ...options, detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const kill = (signal) => {
    if (platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  };
  try {
    let stdout = '';
    let stderr = '';
    const exited = new Promise((resolve, reject) => {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
      // A write to a pipe the child has closed fails under different codes per platform
      // (EPIPE, EOF, ECONNRESET). Whatever the code, the child's own exit decides the result.
      child.stdin.on('error', () => {});
    });
    child.stdin.end(input);
    return { pid: child.pid, kill, exited };
  } catch (err) {
    // A child that was started must not outlive a failed set-up.
    try {
      kill('SIGKILL');
    } catch {
      // Already gone.
    }
    throw err;
  }
}

function defaultDeps() {
  return { runner: defaultRunner, timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (timer) => clearTimeout(timer) } };
}

async function launchWorker(opts, deps = defaultDeps()) {
  const {
    role, cwd, prompt, ceilings = {}, testCommand, claudeMdText, settingsDir,
    platform = process.platform, env = process.env, schema = RESULT_SCHEMA, model, bin = 'claude',
  } = opts;
  const runner = deps && deps.runner;
  if (typeof runner !== 'function') throw new TypeError('deps.runner is required');
  const spendCeiling = ceilings.spendCeiling;
  assertSpendCeiling(spendCeiling);
  const wallClockMs = ceilings.wallClockMs;
  if (!(typeof wallClockMs === 'number' && Number.isFinite(wallClockMs) && wallClockMs > 0 && wallClockMs <= MAX_TIMER_MS)) {
    throw new RangeError('ceilings.wallClockMs must be a finite number above zero and at most ' + MAX_TIMER_MS + ', got ' + String(wallClockMs));
  }
  const timers = deps.timers || defaultDeps().timers;
  assertSupportedSchema(schema);
  const spec = Object.prototype.hasOwnProperty.call(ROLES, role) ? ROLES[role] : undefined;
  if (!spec) throw new Error('unknown role: ' + String(role));
  if (typeof platform !== 'string' || platform === '') throw new TypeError('platform must be a non-empty string, got ' + String(platform));
  if (typeof prompt !== 'string') throw new TypeError('prompt must be a string, got ' + (prompt === null ? 'null' : typeof prompt));
  for (const [name, value] of [['cwd', cwd], ['settingsDir', settingsDir]]) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new TypeError(name + ' must be an absolute path string, got ' + String(value));
  }
  const rel = path.relative(cwd, settingsDir);
  if (!(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) {
    throw new Error('settingsDir must lie outside the working directory: ' + settingsDir + ' is not outside ' + cwd);
  }
  const settingsText = spec.settings ? JSON.stringify(implementerSettings({ testCommand, platform }), null, 2) : null;
  const withAppend = typeof claudeMdText === 'string' && claudeMdText !== '';

  const written = [];
  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    const stem = path.join(settingsDir, 'worker-' + process.pid + '-' + (launchCounter += 1) + '-' + crypto.randomBytes(8).toString('hex'));
    let settingsFile;
    let appendPromptFile;
    if (settingsText !== null) {
      settingsFile = stem + '.settings.json';
      fs.writeFileSync(settingsFile, settingsText, { flag: 'wx', mode: 0o600 });
      written.push(settingsFile);
    }
    if (withAppend) {
      appendPromptFile = stem + '.append.md';
      fs.writeFileSync(appendPromptFile, claudeMdText, { flag: 'wx', mode: 0o600 });
      written.push(appendPromptFile);
    }
    const args = composeArgs({ role, settingsFile, appendPromptFile, schema, spendCeiling, model, platform });
    const childEnv = buildEnv(env, platform);
    const launch = launchSpec(bin, args, platform, childEnv);
    let outcome;
    try {
      const handle = runner({ file: launch.file, args: launch.args, options: { ...launch.options, cwd, env: childEnv }, input: prompt, platform });
      outcome = await superviseChild({ handle, runner, platform, env, wallClockMs, timers });
    } catch (err) {
      outcome = { timedOut: false, spawnError: err === undefined ? new Error('launch failed') : err };
    }
    return classify(outcome, { schema, spendCeiling });
  } finally {
    for (const file of written) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // A removal that fails never changes the outcome and never stops the next one.
      }
    }
  }
}

module.exports = { ENVELOPE_FIELDS, ENV_ALLOW, ENV_ALLOW_WIN32, KILL_GRACE_MS, REAP_DEADLINE_MS, buildEnv, conformsTo, defaultRunner, launchWorker };
