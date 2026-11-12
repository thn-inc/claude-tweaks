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
//   the sandbox off all five succeeded. Writes are not confined to the working
//   directory, though: a write to a directory under the system temporary directory
//   failed, but a write under the CLI's own per-user scratch root in `/tmp` succeeded,
//   so code the worker runs can write there. That is a stated residual.
// - `sandbox.autoAllowBashIfSandboxed` defaults to true, and then lets any sandboxed
//   Bash command run without an allow rule (`touch` ran). With it set to false,
//   `touch` was denied while `node --test`, `git status --short` and
//   `git log --oneline -1` ran. This module therefore sets it to false.
// - `sandbox.failIfUnavailable: true` comes from the documentation and was not
//   exercised, because the sandbox was available on the probe host. A launch the CLI
//   refuses because the sandbox is unavailable is expected to surface as
//   `launch-error`; that was not probed.
//
// The test-command allow rule, the git rules and the sandbox block exist only on the
// platforms where the sandbox was probed (SANDBOX_PROBED_PLATFORMS). Elsewhere the
// worker has no Bash at all: its tool list is Read, Write and Edit, and `toolsFor`
// drops Bash from `--tools` as well. The reason is a probe on the same CLI and date,
// on macOS, in a throwaway repository, launched with no TTY, through this module's
// own launcher. An allowed `git log`, `git diff` or `git show` writes a file of the
// worker's choosing through `--output=<path>`. With no sandbox (the settings
// generated for a platform that is not sandbox-probed) no command was denied, and
// every one of six writes landed: a file in the working directory, one under
// `.git/info/`, one in a directory outside the working directory, and `.git/config`
// itself was overwritten. An allowed `git status` would then run a program named in
// that configuration (`core.fsmonitor`) with the user's full rights and network.
// With the sandbox on (the settings generated for `darwin`), the same commands were
// not denied by the permission rules but ran inside the sandbox: the writes into the
// working directory and under `.git/info/` succeeded; the writes to `.git/config`
// and to `.git/hooks/pre-commit` failed with `fatal: could not open '<path>' for
// writing: Operation not permitted`; a write to a directory under the system
// temporary directory failed the same way; a write under the CLI's own per-user
// scratch root in `/tmp` succeeded. Wherever the git rules exist, `git diff
// --no-index` also reads files outside the working directory. Off the probed
// platforms the worker can neither list nor search files, so its prompt must name
// the files it is to work on.
//
// Under `--restricted`, with `defaultMode: dontAsk` and `--permission-prompts none`,
// the worker's Write and Edit tools into `.git` were denied in a probe (Claude Code CLI
// 2.1.322, macOS, 2026-11-12): an Edit of `.git/config`, a Write of a new file under
// `.git/info/`, and, in a linked worktree, a Write over the one-line `.git` file,
// although Read, Edit and Write are on the allow list. Each showed up as a permission
// denial in the result. This was probed on macOS only and is not proven on other
// platforms.
//
// The test command is project configuration supplied by the driver, never taken from
// a record or a worker. The refusals in `assertTestCommand` catch obvious mistakes
// only and are not a closed check: forms such as `node -pe` or `sh -xc` still pass.
// Any test command executes code by design, which is why the rule exists only on the
// platforms where the sandbox was probed.
//
// The residual, stated plainly: the driver's own test step runs worker-written code
// with the driver's rights, as every other lane does today. Where Bash exists (the
// probed platforms), code the worker runs can read files outside the working
// directory, because the sandbox as configured confines writes to the working
// directory and the CLI's own scratch root and denies the network, but does not
// restrict reads, and so can `git diff --no-index`. With the network denied, the
// worker's own result text is the remaining way out for what it read. This is a
// stated residual.
//
// What the worker's code can read and write today, probed on Claude Code CLI
// 2.1.322, macOS, 2026-11-12, under a subscription login with no TTY, using a test
// file the worker ran through the allowed test command with the sandbox on. With the
// settings as generated, the test read a file in a directory under the system
// temporary directory and a file under the CLI's per-user scratch root, listed the
// home directory, and opened shell and package-manager dotfiles there. It wrote
// under the CLI's per-user scratch root, which is also what the sandbox sets as the
// temporary directory for the commands it runs. With the setting
// `permissions.blockReadsOutsideWorkingDirectories: true` added, listing the home
// directory, opening a shell profile there and listing the SSH directory failed with
// EPERM; the files under the system temporary directory and the scratch root stayed
// readable; `node --test` and `git status` still ran, but a Node installation under
// the home directory was no longer reachable, so a different `node` ran. That read
// block is not turned on here: it protects the home directory but cuts off a
// toolchain installed there, so it needs a per-project list of readable paths, which
// is a decision for the project and is not made here. Setting `CLAUDE_CODE_TMPDIR`
// in the worker's environment did not move the sandbox's writable temporary root.
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

// Every property is required, so `required` is the property names in order. (Written
// out, the list would start with 'status', which tests/git-status-optional-locks.test.js
// reads as a git argument list.)
const RESULT_PROPERTIES = {
  status: { type: 'string', enum: ['done', 'cannot-complete'] },
  title: { type: 'string' },
  summary: { type: 'string' },
};
const RESULT_SCHEMA = deepFreeze({
  type: 'object',
  properties: RESULT_PROPERTIES,
  required: Object.keys(RESULT_PROPERTIES),
  additionalProperties: false,
});

const SANDBOX_PROBED_PLATFORMS = deepFreeze(['darwin']);

const ROLES = deepFreeze({
  implementer: { tools: ['Read', 'Write', 'Edit', 'Bash'], settings: true },
  reviewer: { tools: ['Read', 'Grep', 'Glob'], settings: false },
  explorer: { tools: ['Read', 'Grep', 'Glob'], settings: false },
});

function specFor(role) {
  if (!Object.prototype.hasOwnProperty.call(ROLES, role)) throw new Error('unknown role: ' + String(role));
  return ROLES[role];
}

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
  if (sandboxed) {
    allow.push('Bash(' + testCommand + ' *)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)');
  }
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

// The one spend-ceiling rule, shared by composeArgs and the launcher: absent passes.
function assertSpendCeiling(value) {
  if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    throw new RangeError('spendCeiling must be a finite number above zero, got ' + String(value));
  }
}

// The tools a role launches with on a platform: Bash is dropped for a role that carries
// generated settings when the platform is not sandbox-probed. A fresh array each call.
function toolsFor(role, platform) {
  const spec = specFor(role);
  const sandboxed = SANDBOX_PROBED_PLATFORMS.includes(platform);
  return spec.tools.filter((tool) => !(tool === 'Bash' && spec.settings && !sandboxed));
}

function composeArgs({ role, settingsFile, appendPromptFile, schema, spendCeiling, model, platform } = {}) {
  const spec = specFor(role);
  if (spec.settings && (typeof settingsFile !== 'string' || settingsFile === '')) {
    throw new Error('settingsFile is required for role ' + role + ' and must be a non-empty string');
  }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('schema is required and must be an object');
  }
  assertSpendCeiling(spendCeiling);
  if (typeof platform !== 'string' || platform === '') throw new TypeError('platform is required and must be a non-empty string');
  const args = ['-p', '--safe-mode', '--restricted', '--tools', toolsFor(role, platform).join(','), '--disable-slash-commands', '--strict-mcp-config'];
  if (spec.settings) args.push('--settings', settingsFile);
  args.push('--permission-prompts', 'none', '--output-format', 'json', '--json-schema', JSON.stringify(schema));
  if (appendPromptFile) args.push('--append-system-prompt-file', appendPromptFile);
  if (spendCeiling !== undefined) args.push('--max-budget-usd', String(spendCeiling));
  if (model) args.push('--model', model);
  return args;
}

module.exports = { RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, ROLES, implementerSettings, composeArgs, toolsFor, assertSpendCeiling };
