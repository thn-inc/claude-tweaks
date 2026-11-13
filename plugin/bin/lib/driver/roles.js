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
// --no-index` also reads files outside the working directory, as far as the read
// block described below allows. Off the probed platforms the worker can neither list
// nor search files, so its prompt must name the files it is to work on.
//
// Grep and Glob were probed for the implementer on Claude Code CLI 2.1.322, on a macOS
// (darwin) host, on 2026-11-12, under a claude.ai subscription (max) login, launched
// with no TTY through this module's own launcher. The settings were those
// `implementerSettings` generates for `linux` (`defaultMode: dontAsk`, allow `Read`,
// `Edit`, `Write`, the deny list, no sandbox block), with `--restricted`, `--safe-mode`
// and `Grep,Glob` added to `--tools`. In variant A `Grep` and `Glob` were also
// appended to the allow list; in variant B they were not; B behaved the same as A.
// In both variants both tools saw a file inside the working directory, and every
// outside path argument or absolute pattern tried was refused with "<path> is outside
// <cwd>; --restricted confines the file tools to the working directory." and
// recorded in the result's permission denials: a path argument to a sibling
// directory, an absolute Glob pattern there, and a non-temporary directory (this
// checkout's own `plugin/bin/lib/driver`). Grep given the symlink to the sibling
// directory as its path was refused too, with "resolves through a symlink to
// <target>, which is outside <cwd>". Grep recursing from the working directory, and
// Glob with `link/*.txt` and `**/*`, were not refused but returned nothing from the
// symlink's target; the cause was not isolated, since it may be the search tools'
// default of not following symbolic links rather than `--restricted`.
// Not probed: `../` relative paths, Grep's `glob` and `type` parameters, a symlinked
// file (as opposed to a directory), a hard link, and Linux and Windows hosts. Because
// only a darwin host was probed, Grep and Glob stay off the implementer on Linux and
// Windows; the tool list is unchanged.
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
// probed platforms), the sandbox confines writes to the working directory and the
// CLI's own scratch root and denies the network, and the read block below confines
// the reads of code the worker runs to the working directory, the derived toolchain
// roots and the CLI's own carve-outs (in the probes: `.gitconfig` with the `allowRead`
// entry; the system temporary directory and the CLI's per-user scratch root under the
// block alone). `git diff --no-index` reaches outside the working directory only as
// far as that set does. With the network denied, the worker's own result text is the
// remaining way out for what it read from that set. This is a stated residual.
//
// The read block, and what it rests on. Probed on Claude Code CLI 2.1.322, macOS,
// 2026-11-12, under a subscription login with no TTY, using a test file the worker
// ran through the allowed test command with the sandbox on. With the settings as
// generated before the block, that code read a canary file under the home directory,
// listed the home directory, opened `.zshrc` and `.npmrc` there and listed `~/.ssh`;
// the worker's own Read tool was already refused outside the working directory. It
// also read a file in a directory under the system temporary directory and a file
// under the CLI's per-user scratch root, and wrote under that scratch root, which is
// also what the sandbox sets as the temporary directory for the commands it runs.
// With `permissions.blockReadsOutsideWorkingDirectories: true` and
// `sandbox.filesystem.allowRead` set to the Node toolchain's root, the canary read,
// the home listing, `.zshrc`, `.npmrc` and the `~/.ssh` listing all failed with
// EPERM; a `node` of the same version as the toolchain's still ran and the toolchain
// stayed unwritable; `.gitconfig` stayed openable, apparently a carve-out in the CLI
// so that `git` works. With the block alone and no `allowRead` entry (the earlier
// #5217 probe, same CLI, host and date), the files under the system temporary
// directory and the scratch root stayed readable, and a Node installation under the
// home directory was no longer reachable, so a different `node` ran. So the block is
// on for the implementer wherever the sandbox was probed, and the readable set is
// derived at launch (`toolchainReadPaths`): the test command's toolchain root (the
// directory above `bin/` of the binary's real path, else the binary's own directory)
// plus the root of the interpreter its first word's shebang names, one level deep.
// The shebang half exists because the driver's test command is `npm test`: npm's
// real path, `…/lib/node_modules/npm/bin/npm-cli.js`, starts `#!/usr/bin/env node`,
// and that `node` (`…/bin/node`) lies outside npm's own root. An `env` shebang is parsed
// fail-safe: only known options are skipped, and an unknown option, `-P` or bundled
// flags yield no interpreter root. A root that would be `/`, the home directory or an
// ancestor of it falls back to the binary's own directory, else to nothing, since
// re-opening home would undo the block. The readable paths go through
// `sandbox.filesystem.allowRead`, never `additionalDirectories` or `--add-dir`: the
// CLI documentation says those directories also become writable by sandboxed
// commands. The blocked `~/.npmrc` does not stop the test command: probed 2026-11-13
// on the same host, `npm test` ran with an unreadable user config file (exit 0).
// The settings this module generates, with the readable set derived at launch, were
// run live on 2026-11-13 with Claude Code CLI 2.1.322 on macOS, under a claude.ai
// subscription (max) login, with the worker's standard streams piped (no TTY),
// through the launcher's `AC7` live smoke test: the worker ran `npm test`, the test
// file's read of a canary under the home directory failed with `EPERM`, and the
// `node` it ran was the toolchain's own (its `process.execPath` resolved to the real
// path of the `node` on PATH, v22.23.2).
//
// In the #5217 probe (Claude Code CLI 2.1.322, macOS, 2026-11-12), setting
// `CLAUDE_CODE_TMPDIR` in the worker's environment did not move the sandbox's
// writable temporary root.
//
// Permission denials are data for the driver's event line, never a reason to widen a
// list: there is no path here that composes wider rights after a denial.

const path = require('node:path');
const { isAncestorOrSelf } = require('../path-guard');

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

// A readPaths entry in an error message: JSON.stringify throws on a BigInt or a cycle.
function describeEntry(entry) {
  try {
    const json = JSON.stringify(entry);
    if (typeof json === 'string') return json;
  } catch (e) { /* fall through to String */ }
  try {
    const text = String(entry);
    if (text !== '') return text;
  } catch (e) { /* fall through to the tag */ }
  return Object.prototype.toString.call(entry);
}

// Every entry must be an absolute, already-normalized path that is not the filesystem
// root: a root or a `..` that collapses to it would re-open every read the block closes.
function assertReadPaths(readPaths, platform) {
  if (!Array.isArray(readPaths)) throw new TypeError('readPaths must be an array, got ' + describeEntry(readPaths));
  const pathModule = platform === 'win32' ? path.win32 : path.posix;
  for (const entry of readPaths) {
    const reason =
      typeof entry !== 'string' || !pathModule.isAbsolute(entry) ? 'must be an absolute path string'
      : pathModule.parse(entry).root === entry ? 'must not be the filesystem root'
      : pathModule.normalize(entry) !== entry ? 'must already be normalized'
      : null;
    if (reason) throw new TypeError('readPaths entries ' + reason + ', got ' + describeEntry(entry));
  }
}

function implementerSettings({ testCommand, platform, readPaths = [] } = {}) {
  assertReadPaths(readPaths, platform);
  assertTestCommand(testCommand);
  const sandboxed = SANDBOX_PROBED_PLATFORMS.includes(platform);
  const allow = ['Read', 'Edit', 'Write'];
  if (sandboxed) {
    allow.push('Bash(' + testCommand + ' *)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git ls-files *)');
  }
  // A second layer, not the only one: with `dontAsk`, a closed allow list and
  // `autoAllowBashIfSandboxed: false`, these commands are already refused. The deny
  // rules keep them refused if a later change widens the allow list or the sandbox.
  const deny = ['Bash(gh *)', 'Bash(git push *)', 'Bash(git commit *)', 'Bash(git add *)', 'Bash(curl *)', 'Bash(wget *)'];
  const settings = { permissions: { defaultMode: 'dontAsk', allow, deny } };
  if (sandboxed) {
    settings.permissions.blockReadsOutsideWorkingDirectories = true;
    settings.sandbox = {
      enabled: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      network: { allowedDomains: [], strictAllowlist: true },
      filesystem: { allowRead: readPaths.slice() },
    };
  }
  return settings;
}

// The first word of a command as a real path: an absolute word is the path, a relative
// one (it has a `/`) is refused, a bare name goes through the PATH lookup seam. Any seam
// throw, and any non-absolute answer, is a null, never an error: a missing toolchain just
// re-opens nothing.
function resolveCommandWord(command, deps) {
  try {
    const word = command.split(' ')[0];
    let found;
    if (word.includes('/')) found = path.posix.isAbsolute(word) ? word : null;
    else found = deps.lookup(word);
    if (typeof found !== 'string' || found === '') return null;
    const real = deps.realpath(found);
    return typeof real === 'string' && path.posix.isAbsolute(real) && path.posix.normalize(real) === real ? real : null;
  } catch (e) {
    return null;
  }
}

// The directory to re-open for a binary: the root above `bin/`, else the binary's own
// directory. Never `/`, and never home or an ancestor of it, whether home is taken as
// given or through its real path.
function rootOfReal(real, deps) {
  const homes = [];
  if (typeof deps.home === 'string' && deps.home !== '') {
    homes.push(deps.home);
    try {
      const realHome = deps.realpath(deps.home);
      if (typeof realHome === 'string' && realHome !== '') homes.push(realHome);
    } catch (e) { /* the home as given still guards */ }
  }
  const tooWide = (candidate) =>
    candidate === '/' || homes.some((h) => isAncestorOrSelf(candidate, h, { pathImpl: path.posix }));
  const dir = path.posix.dirname(real);
  const root = path.posix.basename(dir) === 'bin' ? path.posix.dirname(dir) : dir;
  if (!tooWide(root)) return root;
  return tooWide(dir) ? null : dir;
}

function toolchainRoot(command, deps = {}) {
  const real = resolveCommandWord(command, deps);
  return real === null ? null : rootOfReal(real, deps);
}

// The interpreter a `#!` line names; for `env`, only what is positively understood is
// skipped, and anything else means no interpreter (the command's own root still stands):
// the no-argument flags, `-S` (separate or attached, the string's tokens follow),
// options with an argument (`-u NAME`, `-C DIR`, `--unset NAME`, `--chdir DIR`, or the
// attached `-uNAME`, `-C/dir`, `--unset=NAME`, `--chdir=DIR`), and `NAME=value`. Every other
// token that starts with `-` (`-P` in any form, bundled flags, `-a`, `--argv0`, an
// abbreviated long option) may carry an argument or move the lookup off PATH, so reading
// the next word as the interpreter could re-open the wrong directory.
const ENV_FLAGS = ['-i', '-0', '-v', '-', '--ignore-environment', '--null', '--debug'];
const ENV_OPTIONS_WITH_ARGUMENT = ['-u', '-C', '--unset', '--chdir'];
const ENV_ATTACHED_ARGUMENT = /^(-[uC].|--(unset|chdir)=)/;
function shebangInterpreter(line) {
  if (typeof line !== 'string' || !line.startsWith('#!')) return null;
  const tokens = line.slice(2).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (path.posix.basename(tokens[0]) !== 'env') return tokens[0];
  const args = tokens.slice(1);
  for (let i = 0; i < args.length; i++) {
    // An attached -S in option position (`-Snode`): its string is read as the next token. A
    // token consumed as an option's argument (`-u -Sfoo`) never reaches here, so is never split.
    const token = /^-S./.test(args[i]) ? args[i].slice(2) : args[i];
    if (token === '-S' || ENV_FLAGS.includes(token) || ENV_ATTACHED_ARGUMENT.test(token)) continue;
    if (ENV_OPTIONS_WITH_ARGUMENT.includes(token)) i++;
    else if (token.startsWith('-')) return null;
    else if (!token.includes('=')) return token;
  }
  return null;
}

function toolchainReadPaths(testCommand, deps = {}) {
  assertTestCommand(testCommand);
  const real = resolveCommandWord(testCommand, deps);
  if (real === null) return [];
  const roots = [rootOfReal(real, deps)];
  let interpreter = null;
  try { interpreter = shebangInterpreter(deps.firstLine(real)); } catch (e) { /* adds nothing */ }
  if (interpreter !== null) roots.push(toolchainRoot(interpreter, deps));
  return roots.filter((r, i) => r !== null && roots.indexOf(r) === i);
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

module.exports = { RESULT_SCHEMA, SANDBOX_PROBED_PLATFORMS, ROLES, implementerSettings, toolchainRoot, toolchainReadPaths, composeArgs, toolsFor, assertSpendCeiling };
