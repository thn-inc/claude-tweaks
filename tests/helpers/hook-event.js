'use strict';
// In-process runner for a hooks.js hook event (#5377).
//
// `runHookCli(args, { input, cwd, env, deps, fresh, tripwire })` calls hooks.js through runCli with
// the payload as stdin. An event's JSON goes through `deps.stdoutSync` (a synchronous fd 1 write in
// the real CLI), so it is collected here, in write order with `deps.stdout`, and never reaches fd 1.
// `cwd` and `env` are required: `env` is the whole environment the event sees.
//
// A hook event (anything that is not a key of hooks.js's VERBS) runs inside the env tripwire, and the
// call rejects when plugin/bin code read the real process.env, except for the keys in
// TRIPWIRE_ALLOWED. A verb call is not tripped: verbs read the injected env already and are covered
// by the leak guard. `tripwire: false` turns it off for one call.

const path = require('path');
const { runCli } = require('./run-cli');
const gitFixtures = require('./git-fixtures');
const { withEnvTripwire } = require('./env-tripwire');

const HOOKS = path.resolve(__dirname, '..', '..', 'plugin', 'bin', 'hooks.js');

// A key is added here only with a reason, and the task that adds it names it in its report.
const TRIPWIRE_ALLOWED = {
  CT_HOOKS_GIT_TIMEOUT_MS: 'process-wide timeout knob, cli-wrapper-contract.md',
  NODE_V8_COVERAGE: 'read by node:child_process itself on every spawn, with or without an env option',
};

// The whole environment a hook event sees in a test: a clean git environment with the ambient run dir
// blanked (#1130) and the gate-denial test mode on (#1337), under the test's own keys.
function hookEnv(overrides = {}) {
  return gitFixtures.hookEnv({ CT_HOOKS_TEST_MODE: '1', ...overrides });
}

async function runHookCli(args, { input, cwd, env, deps = {}, fresh, tripwire } = {}) {
  if (typeof cwd !== 'string' || !cwd) throw new TypeError('runHookCli: cwd is required');
  if (env === null || typeof env !== 'object') throw new TypeError('runHookCli: env is required');
  let stdout = '';
  const append = (write) => (text) => {
    stdout += text;
    return write ? write(text) : undefined;
  };
  const merged = { ...deps, stdout: append(deps.stdout), stdoutSync: append(deps.stdoutSync) };
  const isVerb = Object.prototype.hasOwnProperty.call(require(HOOKS).VERBS, args[0]);
  const call = () => runCli(HOOKS, args, { cwd, env, stdin: input, fresh, deps: merged });
  let res;
  if (isVerb || tripwire === false) {
    res = await call();
  } else {
    const { value, reads } = await withEnvTripwire(call);
    const offenders = reads.filter((r) => !Object.prototype.hasOwnProperty.call(TRIPWIRE_ALLOWED, r.key));
    if (offenders.length) {
      throw new Error(`hook event read process.env: ${offenders.map((r) => `${r.key}@${r.frame}`).join(', ')}`);
    }
    res = value;
  }
  return { code: res.code, stdout, stderr: res.stderr };
}

module.exports = { runHookCli, hookEnv, TRIPWIRE_ALLOWED, HOOKS };
