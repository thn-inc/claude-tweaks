'use strict';
// Worker roles for the driver's headless `claude -p` launcher: the per-role tool
// list, the argument list the launcher composes, and the generated settings for
// the one role that may run commands (the implementer). Pure data and builders;
// nothing here spawns a process or touches the file system.
//
// What the rights rest on. These facts were probed on 2026-11-12 with Claude Code
// CLI 2.1.322 on macOS (darwin), under a subscription login, launched from a
// process with no TTY. Linux and Windows were not probed.
//
// - Rights leakage and the flag it changed. Under `--setting-sources project`, an
//   allow rule in the working directory's own `.claude/settings.json` let a command
//   that was absent from the generated allow list run, once that directory sat under
//   a checkout the person had already trusted. In an untrusted temporary directory
//   the same rule was ignored. The Read tool also read a file outside the working
//   directory. Under `--restricted` both were refused, and the generated
//   `--settings` file still applied. So every role launches with `--restricted`, and
//   the implementer uses it in place of `--setting-sources project`. The probe that
//   forced the change was the project-file allow rule.
// - Unprobed residual. The user-level leakage probe (a broad allow rule in a scratch
//   home directory) was not run, because a scratch configuration directory carries
//   no subscription login. `--restricted` ignores user, project and local settings
//   files by its documented contract, and that contract is what is relied on.
// - Sandbox. With `sandbox.enabled: true`, `allowUnsandboxedCommands: false`,
//   `network.allowedDomains: []` and `network.strictAllowlist: true`, a test file the
//   worker ran with `node --test` could reach none of these: `curl` to an HTTPS host
//   (exit 56), `gh api` ("host is not on the allow list"), `git ls-remote` over HTTPS
//   (403 from the proxy), `git push` to a bare repository outside the working
//   directory (rejected), a file write outside the working directory (`EPERM`). With
//   the sandbox off all five succeeded.
// - `sandbox.autoAllowBashIfSandboxed` defaults to true, and then lets any sandboxed
//   Bash command run without an allow rule (`touch` ran). With it set to false,
//   `touch` was denied while `node --test`, `git status --short` and
//   `git log --oneline -1` ran. This module therefore sets it to false.
// - `sandbox.failIfUnavailable: true` comes from the documentation and was not
//   exercised, because the sandbox was available on the probe host. A launch the CLI
//   refuses because the sandbox is unavailable surfaces as `launch-error`.
//
// The test-command allow rule and the sandbox block exist only on the platforms where
// the sandbox was probed (SANDBOX_PROBED_PLATFORMS). Elsewhere the worker only edits
// and runs read-only git commands. Those git rules can start a program only through
// git configuration: `core.fsmonitor` on `git status`, and external diff and textconv
// drivers on `git diff` and `git show`. Under `--restricted`, with `defaultMode:
// dontAsk` and `--permission-prompts none`, the worker's writes into `.git` were
// denied in a probe (Claude Code CLI 2.1.322, macOS, 2026-11-12): an Edit of
// `.git/config`, a Write of a new file under `.git/info/`, and, in a linked worktree,
// a Write over the one-line `.git` file, although Read, Edit and Write are on the
// allow list. Each showed up as a permission denial in the result. This was probed on
// macOS only and is not proven on other platforms. On a sandbox-probed platform a
// test the worker runs could write git configuration only inside the sandbox, where
// the same containment applies as to the test itself.
//
// The test command is project configuration supplied by the driver, never taken from
// a record or a worker. The refusals in `assertTestCommand` catch obvious mistakes
// only and are not a closed check: forms such as `node -pe` or `sh -xc` still pass.
// Any test command executes code by design, which is why the rule exists only on the
// platforms where the sandbox was probed.
//
// The residual, stated plainly: the driver's own test step runs worker-written code
// with the driver's rights, as every other lane does today.
//
// Permission denials are data for the driver's event line, never a reason to widen a
// list: there is no path here that composes wider rights after a denial.

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const RESULT_SCHEMA = deepFreeze({
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'cannot-complete'] },
    title: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['status', 'title', 'summary'],
  additionalProperties: false,
});

const SANDBOX_PROBED_PLATFORMS = deepFreeze(['darwin']);

const ROLES = deepFreeze({
  implementer: { tools: ['Read', 'Write', 'Edit', 'Bash'], settings: true },
  reviewer: { tools: ['Read', 'Grep', 'Glob'], settings: false },
  explorer: { tools: ['Read', 'Grep', 'Glob'], settings: false },
});

const TEST_COMMAND_PATTERN = /^[A-Za-z0-9 ._\/:=-]+$/;
const CODE_FLAGS = ['-c', '-e', '--eval', '-p', '--print'];
const BARE_INTERPRETERS = ['sh', 'bash', 'zsh', 'node', 'python', 'python3'];

function assertTestCommand(testCommand) {
  const reason =
    typeof testCommand !== 'string' || !TEST_COMMAND_PATTERN.test(testCommand) ? 'must match ' + TEST_COMMAND_PATTERN
    : /^ | $|  /.test(testCommand) ? 'must not have a leading, trailing or doubled space'
    : testCommand.split(' ').some((t) => CODE_FLAGS.includes(t)) ? 'must not carry an inline-code flag'
    : BARE_INTERPRETERS.includes(testCommand) ? 'must not be a bare interpreter'
    : null;
  if (reason) throw new TypeError('testCommand ' + reason + ', got ' + JSON.stringify(testCommand));
}

function implementerSettings({ testCommand, platform } = {}) {
  assertTestCommand(testCommand);
  const sandboxed = SANDBOX_PROBED_PLATFORMS.includes(platform);
  const allow = ['Read', 'Edit', 'Write'];
  if (sandboxed) allow.push('Bash(' + testCommand + ' *)');
  allow.push('Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)');
  const deny = ['Bash(gh *)', 'Bash(git push *)', 'Bash(git commit *)', 'Bash(git add *)', 'Bash(curl *)', 'Bash(wget *)'];
  const settings = { permissions: { defaultMode: 'dontAsk', allow, deny } };
  if (sandboxed) {
    settings.sandbox = {
      enabled: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      network: { allowedDomains: [], strictAllowlist: true },
    };
  }
  return settings;
}

function composeArgs({ role, settingsFile, appendPromptFile, schema, spendCeiling, model } = {}) {
  const spec = Object.prototype.hasOwnProperty.call(ROLES, role) ? ROLES[role] : undefined;
  if (!spec) throw new Error('unknown role: ' + String(role));
  if (spec.settings && (typeof settingsFile !== 'string' || settingsFile === '')) {
    throw new Error('settingsFile is required for role ' + role + ' and must be a non-empty string');
  }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('schema is required and must be an object');
  }
  if (spendCeiling !== undefined && !(typeof spendCeiling === 'number' && Number.isFinite(spendCeiling) && spendCeiling > 0)) {
    throw new RangeError('spendCeiling must be a finite number above zero, got ' + String(spendCeiling));
  }
  const args = ['-p', '--safe-mode', '--restricted', '--tools', spec.tools.join(','), '--disable-slash-commands', '--strict-mcp-config'];
  if (spec.settings) args.push('--settings', settingsFile);
  args.push('--permission-prompts', 'none', '--output-format', 'json', '--json-schema', JSON.stringify(schema));
  if (appendPromptFile) args.push('--append-system-prompt-file', appendPromptFile);
  if (spendCeiling !== undefined) args.push('--max-budget-usd', String(spendCeiling));
  if (model) args.push('--model', model);
  return args;
}

module.exports = { RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, ROLES, implementerSettings, composeArgs };
