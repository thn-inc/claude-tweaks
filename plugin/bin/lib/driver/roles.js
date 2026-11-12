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
//   a checkout the person had already trusted. The Read tool also read a file
//   outside the working directory. Under `--restricted` both were refused, and the
//   generated `--settings` file still applied. So every role launches with
//   `--restricted`, and the implementer uses it in place of `--setting-sources
//   project`. The probe that forced the change was the project-file allow rule.
// - Unprobed residual. The user-level leakage probe (a broad allow rule in a scratch
//   home directory) was not run, because a scratch configuration directory carries
//   no subscription login. `--restricted` ignores user, project and local settings
//   files by its documented contract, and that contract is what is relied on.
// - Sandbox. With `sandbox.enabled: true`, `allowUnsandboxedCommands: false`,
//   `network.allowedDomains: []` and `network.strictAllowlist: true`, a test file the
//   worker ran with `node --test` could reach none of: `curl` to an HTTPS host,
//   `gh api`, `git ls-remote` over HTTPS, `git push` to a bare repository outside the
//   working directory, or a file write outside the working directory. With the
//   sandbox off all five succeeded.
// - `sandbox.autoAllowBashIfSandboxed` defaults to true, and then lets any sandboxed
//   Bash command run without an allow rule (`touch` ran). With it set to false,
//   `touch` was denied while `node --test`, `git status --short` and
//   `git log --oneline -1` ran. This module therefore sets it to false.
// - `sandbox.failIfUnavailable: true` comes from the documentation and was not
//   exercised, because the sandbox was available on the probe host. A launch the CLI
//   refuses because the sandbox is unavailable surfaces as `launch-error`.
//
// The test-command allow rule and the sandbox block exist only on the platforms where
// the sandbox was probed (SANDBOX_PROBED_PLATFORMS). Elsewhere the worker only edits:
// no rule can execute a file it wrote.
//
// The residual, stated plainly: the driver's own test step runs worker-written code
// with the driver's rights, as every other lane does today.
//
// Permission denials are data for the driver's event line, never a reason to widen a
// list: there is no path here that composes wider rights after a denial.

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'cannot-complete'] },
    title: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['status', 'title', 'summary'],
  additionalProperties: false,
};

const SANDBOX_PROBED_PLATFORMS = ['darwin'];

const ROLES = {
  implementer: { tools: ['Read', 'Write', 'Edit', 'Bash'], settings: true },
  reviewer: { tools: ['Read', 'Grep', 'Glob'], settings: false },
  explorer: { tools: ['Read', 'Grep', 'Glob'], settings: false },
};

const TEST_COMMAND_PATTERN = /^[A-Za-z0-9 ._\/:=-]+$/;

function implementerSettings({ testCommand, platform } = {}) {
  if (typeof testCommand !== 'string' || !TEST_COMMAND_PATTERN.test(testCommand)) {
    throw new TypeError('testCommand must match ' + TEST_COMMAND_PATTERN + ', got ' + JSON.stringify(testCommand));
  }
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
  const args = ['-p', '--safe-mode', '--restricted', '--tools', spec.tools.join(','), '--disable-slash-commands', '--strict-mcp-config'];
  if (spec.settings) args.push('--settings', settingsFile);
  args.push('--permission-prompts', 'none', '--output-format', 'json', '--json-schema', JSON.stringify(schema));
  if (appendPromptFile) args.push('--append-system-prompt-file', appendPromptFile);
  if (spendCeiling !== undefined && spendCeiling !== null) args.push('--max-budget-usd', String(spendCeiling));
  if (model) args.push('--model', model);
  return args;
}

module.exports = { RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, ROLES, implementerSettings, composeArgs };
