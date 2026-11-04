'use strict';

// Filing-time self-validation of a composed Premise-check: command (#2633).
// A health skill composes the command (harness-health's buildPremiseCheck —
// pure, never executes); this module runs it ONCE, before filing, so a
// command that already reads "resolved" (non-zero) is dropped instead of
// auto-closing the record at its first materialize (#2621's M2). Lives in
// health-core, not harness-health, so the other three health skills reuse it
// verbatim if they ever gain a Premise-check: composer. Stateful (spawns a
// shell) — deliberately NOT in tests/bin-lib/health-core/purity.test.js's
// PURE_MODULES.
const { execFileSync } = require('child_process');

// #1829: a short bound on a bound-but-arbitrary command a record body names,
// so a hostile or hung Premise-check: command can never stall filing or
// materialize. plugin/bin/materialize.js imports this constant and
// defaultRunner, so the command runs there later under the same bound.
const PREMISE_SELF_CHECK_TIMEOUT_MS = 5000;

// The shell a Premise-check command runs under. On win32 a literal /bin/sh
// resolves to `<drive>:\bin\sh` and throws ENOENT, so there the POSIX shell
// is found on PATH instead (#3563). Pure: the platform is a parameter.
function posixShell(platform = process.platform) {
  return platform === 'win32' ? 'sh' : '/bin/sh';
}

// command, { cwd, timeoutMs, platform, exec } -> exit code. Also
// materialize.js's runner: a non-zero exit is a normal outcome (unwrapped
// from execFileSync's throw); no exit code at all (timeout, spawn error)
// re-throws. An omitted cwd runs in the process cwd. `platform` picks the
// shell (posixShell) and `exec` is the spawn seam — both injectable so the
// platform split is testable without stubbing process.platform (#3563).
function defaultRunner(command, { cwd, timeoutMs, platform = process.platform, exec = execFileSync }) {
  try {
    exec(posixShell(platform), ['-c', command], { cwd, stdio: 'ignore', timeout: timeoutMs, windowsHide: true });
    return 0;
  } catch (err) {
    if (typeof err.status === 'number') return err.status;
    throw err;
  }
}

// true only when the command exited 0 — the "premise still unresolved"
// reading a Premise-check: line must have at filing time to be worth
// keeping. Every other outcome (non-zero, timeout, spawn error) is false:
// fail toward "no auto-close", never toward keeping a line that may fire.
function premiseReadsUnresolved(command, {
  root, runner = defaultRunner, timeoutMs = PREMISE_SELF_CHECK_TIMEOUT_MS,
} = {}) {
  try {
    return runner(command, { cwd: root, timeoutMs }) === 0;
  } catch {
    return false;
  }
}

module.exports = { premiseReadsUnresolved, defaultRunner, posixShell, PREMISE_SELF_CHECK_TIMEOUT_MS };
