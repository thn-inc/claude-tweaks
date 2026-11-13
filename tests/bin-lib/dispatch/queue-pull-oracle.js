'use strict';
// #5227: the bash oracle for the queue-pull parity suite. It runs
// plugin/skills/dispatch/queue-pull-script.md's fence whole, in one bash process, inside a
// throwaway sandbox:
//   <root>/home       HOME, with a .gitconfig naming the commit identity
//   <root>/tmp/run-N  a fresh TMPDIR per run, so session files never leak across runs
//   <root>/proj       a clone of <root>/origin.git: the cwd, with policy.yml and the pre-minted
//                     dispatch-standalone run dir
//   <root>/bin        PATH shims (writeShims), each a sh script: gh (the table's exact, effect-free
//                     answers baked in, never the real gh: ghShimScript), git (exec'ing the real git,
//                     only inside <root>: gitShimScript), mktemp (counter-file names,
//                     mktempShimScript) and node (the real node, logging two CLIs' inputs first:
//                     nodeShim)
//   <root>/shim       not on PATH: gh-fallback (the node gh shim bin/gh execs for graphql, effects and
//                     misses, answering from QP_SHIM_TABLE)
//   <root>/logs       gh-argv.nul, git-argv.nul (NUL-framed records: SHIM_LOGS), cli-calls/ and the
//                     mktemp counter
//   <root>/agent      files transport only: what the agent fetched through MCP (QP_AGENT_DIR), which
//                     filesOracleScript's agent writes copy from, and DISPATCH_FOREIGN_STATES
//   <root>/sysbin     files transport only: links to the system tools the fence runs, so the PATH
//                     holds no gh (the bin holds no gh shim there either)
// The env is explicit (shell-scanner-bash-differential's escape rules): nothing is inherited
// except NODE_OPTIONS (the clock stub's --require appended) and CT_TRACE_*, so the test-impact
// tracer still sees the children. Every run sits inside withEscapeGuard on this checkout.
// The gh fallback re-enters this module through shimMain(), so keep its top level cheap.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');

const { STUB_SKIP_REASON } = require('../../helpers/path-stub');
const { readText } = require('../../helpers/read-skill');
const { fixtureGit } = require('../../helpers/git-fixtures');
const {
  ghAnswer, applyEffect, shimTable, agentInputs,
} = require('./queue-pull-fixtures');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SCRIPT_MD = path.join(REPO, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md');
const FENCE_FIRST_LINE = 'DISPATCH_QUEUE_RAW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-queue-raw.json)"';
const RUN_DIR_NAME = '2026-11-12T110000-dispatch-standalone';
const CLOCK_STUB = path.join(__dirname, 'queue-pull-clock-stub.js');
const PINNED_GIT_DATE = '2026-11-12T12:00:00Z';
const ORACLE_TIMEOUT_MS = 120_000;
const STREAM_CAP_BYTES = 64 * 1024;
const BASH_CANDIDATES = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/bin/bash', '/usr/bin/bash'];
const REPORTED_LINE = /^(AUTO — dispatch: |- AUTO \d{2}:\d{2}:\d{2} — |Warning: |dispatch: queue-pull stopped -- |Queue-order cache |express-lane: |resolve-policy: )/;

// --- skip, extraction ---------------------------------------------------------

let bashFound;
function findBash() {
  if (bashFound !== undefined) return bashFound;
  bashFound = null;
  if (process.platform === 'win32') return bashFound;
  for (const candidate of BASH_CANDIDATES) {
    if (!fs.existsSync(candidate)) continue;
    const r = spawnSync(candidate, ['--noprofile', '--norc', '-c', 'echo "${BASH_VERSINFO[0]}"'], { env: {}, encoding: 'utf8', timeout: 10_000 });
    if (r.status === 0 && Number(r.stdout.trim()) >= 4) {
      bashFound = candidate;
      break;
    }
  }
  return bashFound;
}

function oracleSkip(platform = process.platform, bash = findBash()) {
  if (platform === 'win32') return 'no bash oracle — ' + STUB_SKIP_REASON;
  if (!bash) return 'no bash oracle (bash >= 4 not found)';
  return false;
}

// The ```bash block whose first line equals firstLine, as LF text.
function extractFence(mdText, firstLine) {
  const lines = mdText.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i] !== '```bash' || lines[i + 1] !== firstLine) continue;
    const end = lines.indexOf('```', i + 1);
    if (end === -1) throw new Error(`extractFence: the fence opened at line ${i + 1} is never closed`);
    return lines.slice(i + 1, end).join('\n') + '\n';
  }
  throw new Error(`extractFence: anchor not found: ${firstLine}`);
}

// --- the files transport: mcp-transport.md's substitutions over the gh fence ---------------------

const MCP_MD = path.join(REPO, 'plugin', 'skills', 'dispatch', 'mcp-transport.md');
const MCP_TARGETS_FIRST_LINE = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" <<NODE_EVAL_EOF';
const MCP_EXCLUSIONS_FIRST_LINE = 'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" "$DISPATCH_EXCLUSIONS" "$DISPATCH_IN_FLIGHT_CLAIMS" <<NODE_EVAL_EOF';

// The agent's Write of one fetched file, standing where the gh call stood: the file QP_AGENT_DIR
// holds, or no file at all when the agent wrote none.
const agentWrite = (name, variable) => `if [ -f "$QP_AGENT_DIR/${name}" ]; then cp "$QP_AGENT_DIR/${name}" "$${variable}"; else rm -f "$${variable}"; fi`;

// Replaces the span of `lines` that starts at the line equal to `first` and ends at the first later
// line equal to `through` (inclusive) or `before` (exclusive), after checking the span holds `holds`
// (the gh call it replaces). A missing anchor throws `anchor not found: <line>`.
function replaceSpan(lines, { first, through = first, before = null, holds }, replacement) {
  const start = lines.indexOf(first);
  if (start === -1) throw new Error(`anchor not found: ${first}`);
  const endLine = before === null ? through : before;
  let end = lines.indexOf(endLine, start + (before === null && through === first ? 0 : 1));
  if (end === -1) throw new Error(`anchor not found: ${endLine}`);
  if (before === null) end += 1;
  const span = lines.slice(start, end);
  if (!span.some((l) => l.includes(holds))) throw new Error(`anchor not found: ${holds}`);
  lines.splice(start, end - start, ...replacement);
}

// filesOracleScript(fence, mcpText) -> the fence as mcp-transport.md's procedure runs it with gh
// absent: (a) the queue pull and the open-numbers pull, (b) both dependency-freshness searches and
// (c) the `gh issue view` loop become the agent's writes; (d) the neighbour-in-flight block becomes
// mcp-transport's four steps (pool write, its claim-targets fence, claims-map write, its exclusions
// fence), followed by the fence's own NEIGHBOUR_RC stop, kept as written; (e) the cross-PR overlap
// fetch and compute become `echo '[]'`. Everything else runs as written; the CLIs it spawns find no
// gh on the files sandbox's PATH (f).
function filesOracleScript(fence, mcpText) {
  const lines = fence.replace(/\n$/, '').split('\n');
  const mcpFence = (firstLine) => extractFence(mcpText, firstLine).replace(/\n$/, '').split('\n');
  replaceSpan(lines, {
    first: 'gh issue list --label auto:build --state open --json number,title,body,labels,createdAt,updatedAt,state --limit 500 > "$DISPATCH_QUEUE_RAW"',
    holds: 'gh issue list --label auto:build',
  }, [agentWrite('dispatch-queue-raw.json', 'DISPATCH_QUEUE_RAW')]);
  replaceSpan(lines, {
    first: 'gh issue list --state open --json number --limit 200 > "$DISPATCH_OPEN_NUMBERS"',
    holds: 'gh issue list --state open',
  }, [agentWrite('dispatch-open-numbers.json', 'DISPATCH_OPEN_NUMBERS')]);
  for (const v of ['DISPATCH_DEP_NUMBERS', 'DISPATCH_ALL_DEP_NUMBERS']) {
    replaceSpan(lines, {
      first: `  gh issue list --search "$(echo "$${v}" | tr ',' ' ' | sed 's/[0-9][0-9]*/#&/g')" --state all --json number,updatedAt,state --limit 500 > "$DISPATCH_DEP_FRESHNESS" 2>/dev/null || echo '[]' > "$DISPATCH_DEP_FRESHNESS"`,
      holds: 'gh issue list --search',
    }, [`  ${agentWrite('dispatch-dep-freshness.json', 'DISPATCH_DEP_FRESHNESS')}`]);
  }
  replaceSpan(lines, { first: ': > "$DISPATCH_VERIFIED_OPEN_DEPS"', through: 'done', holds: 'gh issue view "$DEP"' },
    [agentWrite('dispatch-verified-open-deps.txt', 'DISPATCH_VERIFIED_OPEN_DEPS')]);
  replaceSpan(lines, {
    first: 'if ! gh issue list --label bot:in-progress --state open --json number,title,body,labels --limit 200 > "$DISPATCH_IN_FLIGHT_RAW" 2>/dev/null; then',
    before: 'NEIGHBOUR_RC=$?',
    holds: 'neighbourInFlightExclusions',
  }, [
    agentWrite('dispatch-in-flight-raw.json', 'DISPATCH_IN_FLIGHT_RAW'),
    ...mcpFence(MCP_TARGETS_FIRST_LINE),
    agentWrite('dispatch-in-flight-claims.json', 'DISPATCH_IN_FLIGHT_CLAIMS'),
    ...mcpFence(MCP_EXCLUSIONS_FIRST_LINE),
  ]);
  replaceSpan(lines, {
    first: 'gh pr list --state open --json number,files,closingIssuesReferences --limit 100 > "$DISPATCH_OPEN_PRS" 2>/dev/null || echo \'[]\' > "$DISPATCH_OPEN_PRS"',
    through: 'NODE_EVAL_EOF',
    holds: 'detectCrossPRFileOverlap',
  }, ['echo \'[]\' > "$DISPATCH_CROSSPR_OVERLAP"']);
  // The one gh call left as written: the shipped pass's `gh pr view` probe loop, which mcp-transport.md
  // does not replace. It iterates the probe list, which is empty on files: the linked-PR query fails
  // with no gh, so dispatch-linked-prs.json is {} and no candidate has a mention to probe.
  const kept = new Set(['  FILES_JSON=$(gh pr view "$PR" --json files -q \'[.files[].path]\' 2>/dev/null || echo \'[]\')']);
  const leftover = lines.find((l) => !kept.has(l) && /(^|[\s(!|;&])gh\s/.test(l.replace(/'[^']*'|"[^"$]*"/g, '')) && !/^\s*#/.test(l));
  if (leftover) throw new Error(`filesOracleScript: a gh call survives the substitutions: ${leftover}`);
  return lines.join('\n') + '\n';
}

// The fence's session-tmp-resolve `--value <name>` arguments, in fence order.
function fenceSessionFiles(fence) {
  return [...fence.matchAll(/session-tmp-resolve\.js" --value ([^\s)"]+)\)"/g)].map((m) => m[1]);
}

let sessionNames;
function sessionFileNames() {
  if (!sessionNames) {
    sessionNames = [...fenceSessionFiles(extractFence(readText(SCRIPT_MD), FENCE_FIRST_LINE)), 'dispatch-next-pick.json'];
  }
  return sessionNames;
}

// --- process groups and sandbox lifetime ---------------------------------------

const liveRoots = new Set();
const liveGroups = new Set();
let exitHooksInstalled = false;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// SIGKILL the group until the kernel reports it empty (ESRCH; EPERM for a group of zombies on
// macOS). A single kill races a group that keeps forking. -> true when empty within ~2 s.
function reapGroup(pgid) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch (err) {
      if (err.code === 'ESRCH' || err.code === 'EPERM') {
        liveGroups.delete(pgid);
        return true;
      }
      throw err;
    }
    sleepSync(20);
  }
  return false;
}

function reapEverything() {
  for (const pgid of [...liveGroups]) reapGroup(pgid);
  for (const root of [...liveRoots]) fs.rmSync(root, { recursive: true, force: true });
}

function installExitHooks() {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.once('exit', reapEverything);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      reapEverything();
      process.kill(process.pid, signal);
    });
  }
}

let realGitPath;
function resolveRealGit() {
  if (realGitPath) return realGitPath;
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, 'git');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return (realGitPath = candidate);
    } catch { /* not here */ }
  }
  throw new Error('queue-pull oracle: no git on PATH');
}

// --- sandbox -------------------------------------------------------------------

// A tree object holding `files` ({ 'dir/name': content }), written into gitDir.
function writeTree(gitDir, files, git) {
  const blobs = [];
  const dirs = new Map();
  for (const [p, content] of Object.entries(files)) {
    const [head, ...rest] = p.split('/');
    if (rest.length === 0) blobs.push([head, content]);
    else dirs.set(head, { ...(dirs.get(head) || {}), [rest.join('/')]: content });
  }
  const lines = blobs.map(([name, content]) => `100644 blob ${git(['-C', gitDir, 'hash-object', '-w', '--stdin'], { input: content }).trim()}\t${name}`);
  for (const [name, sub] of dirs) lines.push(`040000 tree ${writeTree(gitDir, sub, git)}\t${name}`);
  return git(['-C', gitDir, 'mktree'], { input: lines.map((l) => l + '\n').join('') }).trim();
}

// origin.git always has main, has each other branch the scenario names (claims-registry when a
// claim is fixtured), and never health-state: the queue-order cache starts cold. `headBranch`
// (scenario.headBranch) points origin's HEAD at another seeded branch, so a clone checks it out and
// `git remote show origin` reports it.
function seedOrigin(originDir, spec, git, headBranch) {
  const branches = { main: {}, ...((spec && spec.branches) || {}) };
  if (Object.prototype.hasOwnProperty.call(branches, 'health-state')) {
    throw new Error('scenario.origin.branches never seeds health-state: the queue-order cache starts cold');
  }
  if (headBranch && !Object.prototype.hasOwnProperty.call(branches, headBranch)) {
    throw new Error(`scenario.headBranch ${headBranch} names no seeded branch`);
  }
  git(['init', '--bare', '-q', '-b', 'main', originDir]);
  for (const [branch, files] of Object.entries(branches)) {
    const all = branch === 'main' ? { 'README.md': 'fixture\n', '.gitignore': '.claude-tweaks/pipelines/\n', ...files } : files;
    const commit = git(['-C', originDir, 'commit-tree', writeTree(originDir, all, git), '-m', `seed ${branch}`]).trim();
    git(['-C', originDir, 'update-ref', `refs/heads/${branch}`, commit]);
  }
  if (headBranch) git(['-C', originDir, 'symbolic-ref', 'HEAD', `refs/heads/${headBranch}`]);
}

// The system tools the fence and its CLIs run, for the `files` sandbox's PATH: symlinked into
// <root>/sysbin so the PATH holds no gh even where the host has one in /usr/bin (a CI runner does).
const FILES_SYSTEM_TOOLS = ['bash', 'sh', 'cat', 'cp', 'mv', 'rm', 'grep', 'sed', 'tr', 'dirname', 'env', 'mkdir', 'ls'];
function writeSystemBin(sysbin) {
  for (const tool of FILES_SYSTEM_TOOLS) {
    const found = ['/usr/bin', '/bin'].map((d) => path.join(d, tool)).find((p) => fs.existsSync(p));
    if (!found) throw new Error(`queue-pull oracle: no ${tool} in /usr/bin or /bin`);
    fs.symlinkSync(found, path.join(sysbin, tool));
  }
}

// writeShims({ bin, shimDir, root, realGit, table, gh }) writes the PATH shims into `bin`: git
// (gitShimScript, `table` baked in), mktemp (mktempShimScript), node and, when `gh` is true, gh
// (ghShimScript). `shimDir` (<root>/shim, not on PATH) holds what bin/gh needs beside it: the node
// fallback gh-fallback. createSandbox calls this once and setScenario again for each new table, so
// the baked values follow the scenario.
function writeShims({ bin, shimDir, root, realGit, table, gh = true }) {
  if (/\s/.test(process.execPath)) {
    throw new Error(`queue-pull oracle: the node path ${process.execPath} holds whitespace, so it cannot stand in a #! line`);
  }
  if (gh) {
    const fallback = `#!${process.execPath}\n'use strict';\nrequire(${JSON.stringify(__filename)}).shimMain('gh');\n`;
    fs.writeFileSync(path.join(shimDir, 'gh-fallback'), fallback, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), ghShimScript({ shimDir, table }), { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, 'git'), gitShimScript({ root, realGit, table }), { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'mktemp'), mktempShimScript(), { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'node'), nodeShim(), { mode: 0o755 });
}

// POSIX single-quoting: the text stands for itself in bash, whatever it holds.
function shQuote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// bin/mktemp: a POSIX sh script taking no arguments: <TMPDIR>/tmp.qp<8-digit counter>, the counter
// read from and written back to QP_TMPNAME_COUNTER_FILE -- the name and counter format deps.tmpName
// (queue-pull.js) emits under the same env var, which also reads an absent or empty counter as 0.
// Any other counter must be one or more digits (leading zeros are decimal), at most 15 once those
// are stripped (the module refuses past Number.MAX_SAFE_INTEGER; shell arithmetic overflows past
// 18). The file is created exclusively with mode 0600 and the counter written only after that; a
// counter write that fails refuses too, leaving the created file behind. Refuses (exit 97,
// `mktemp-shim: refused ({why}): {args}`): an argument, a missing TMPDIR or counter path, a counter
// that is not digits, a next name that already exists (the old node shim died on EEXIST, exit 1).
// No forks: no $(...), subshell or pipe; dash and macOS /bin/sh alike.
function mktempShimScript() {
  return [
    '#!/bin/sh',
    '# Generated by tests/bin-lib/dispatch/queue-pull-oracle.js (mktempShimScript).',
    "IFS=' '",
    'qp_refuse() {',
    '  why=$1; shift',
    '  printf \'mktemp-shim: refused (%s): %s\\n\' "$why" "$*" >&2',
    '  exit 97',
    '}',
    '[ $# -eq 0 ] || qp_refuse \'arguments are not supported\' "$@"',
    '[ -n "$TMPDIR" ] && [ -n "$QP_TMPNAME_COUNTER_FILE" ] || qp_refuse \'TMPDIR and QP_TMPNAME_COUNTER_FILE are required\'',
    'n=',
    'IFS= read -r n 2>/dev/null < "$QP_TMPNAME_COUNTER_FILE"',
    "IFS=' '",
    'case "$n" in',
    '  *[!0-9]*) qp_refuse "counter file holds \\"$n\\"" ;;',
    'esac',
    'while :; do',
    '  case "$n" in 0?*) n=${n#0} ;; *) break ;; esac',
    'done',
    '[ ${#n} -le 15 ] || qp_refuse "counter file holds \\"$n\\""',
    'n=$((${n:-0} + 1))',
    'p=$n',
    'while [ ${#p} -lt 8 ]; do p=0$p; done',
    'f=$TMPDIR/tmp.qp$p',
    'umask 077',
    'set -C',
    'true 2>/dev/null > "$f" || {',
    '  if [ -e "$f" ]; then qp_refuse "file exists: $f"; fi',
    '  qp_refuse "cannot create: $f"',
    '}',
    'set +C',
    'printf \'%s\' "$n" 2>/dev/null > "$QP_TMPNAME_COUNTER_FILE" || qp_refuse "cannot write counter: $QP_TMPNAME_COUNTER_FILE"',
    'printf \'%s\\n\' "$f"',
    '',
  ].join('\n');
}

// bin/node: the real node, exec'd (same pid, stdin, exit and signals), after logging the two CLI
// calls the real-writer pins read, under <logs>/cli-calls/<pid>/: `argv` (NUL-separated, the
// script path first) and, for dispatch-unlanded-blockers.js, copies of its --groups and
// --exclusions files as they stood when it ran (the fence overwrites the groups file with its
// stdout). The logging is silent: nothing it does reaches the run's own streams.
function nodeShim() {
  return [
    '#!/bin/sh',
    'case "$1" in',
    '  */bin/resolve-policy.js|*/bin/dispatch-unlanded-blockers.js)',
    '    if [ -n "$QP_LOG_DIR" ]; then',
    '      d="$QP_LOG_DIR/cli-calls/$$"',
    '      { /bin/mkdir -p "$d" && printf \'%s\\0\' "$@" > "$d/argv"',
    '        prev=',
    '        for a in "$@"; do',
    '          case "$prev" in --groups) /bin/cp "$a" "$d/groups" ;; --exclusions) /bin/cp "$a" "$d/exclusions" ;; esac',
    '          prev=$a',
    '        done; } 2>/dev/null',
    '    fi ;;',
    'esac',
    `exec ${shQuote(process.execPath)} "$@"`,
    '',
  ].join('\n');
}

// bin/git: the sandbox's containment guard, a POSIX sh script with root, the real git, the canned
// origin URL and the injected-failure prefixes baked in. It refuses (exit 97, logged REFUSED) an
// exported GIT_DIR/GIT_WORK_TREE, config carried in the env (GIT_CONFIG_PARAMETERS, or
// GIT_CONFIG_COUNT, which git needs before it reads any GIT_CONFIG_KEY_<n>), a repository moved by
// the env (GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES), a
// GIT_INDEX_FILE that is absolute and lexically outside root, or relative with a .. segment (git
// resolves a relative one from the worktree top, so a .. can climb out of the sandbox; the
// plugin's scratch indexes are absolute, under the sandbox TMPDIR), an unknown leading
// global option, any -c key but core.quotePath
// (the one key any plugin call path sets, review-context's; an allow-list, because a deny-list of
// the keys that run a command or move git's view off the sandbox always misses one: include.path
// pulls in a config file that can set any of them, remote.<name>.receivepack runs a program on
// push), and a cwd or -C directory that is unresolvable or physically outside root. Each -C is
// entered with `cd -P` from where the one before it landed, as git's own chdir does, so a symlink
// cannot walk it out. A gitFail prefix of the sub-argv exits 128, `remote get-url origin` prints
// the canned URL, and anything else is logged and exec'd as the real git from the original cwd,
// PWD and OLDPWD. A log record it cannot write stops the call (exit 97) before git runs.
// The refused argv is cut at 300 bytes (the sandbox runs LANG=C, and dash always counts bytes),
// where the old node shim cut at 300 UTF-16 units: the two cuts differ whenever the joined argv is
// over 300 bytes and holds non-ASCII text before the cut.
// The shim contains where git acts (directories, repository, config), not which programs git may
// run: GIT_SSH_COMMAND, GIT_EXTERNAL_DIFF, GIT_ASKPASS, GIT_PAGER/GIT_EDITOR and GIT_EXEC_PATH stay
// unchecked, and withEscapeGuard backs it up.
// No forks for its own checks: no $(...), subshell or pipe; dash and macOS /bin/sh alike.
function gitShimScript({ root, realGit, table }) {
  const failTests = table.git.fail.map((prefix) => {
    const tests = [`[ $# -ge ${prefix.length} ]`, ...prefix.map((token, k) => `[ "\${${k + 1}}" = ${shQuote(token)} ]`)];
    return `  if ${tests.join(' && ')}; then qp_join "$@"; qp_kind=injected; return; fi`;
  });
  return [
    '#!/bin/sh',
    '# Generated by tests/bin-lib/dispatch/queue-pull-oracle.js (gitShimScript); rewritten by setScenario.',
    'unset CDPATH',
    'qp_pwd=$PWD',
    'qp_oldpwd_set=${OLDPWD+1}',
    'qp_oldpwd=$OLDPWD',
    '# The physical cwd; empty (refused below) when it cannot be resolved. In a deleted cwd both',
    '# shells let `cd -P .` succeed and leave PWD non-absolute (`.` or empty).',
    'qp_cwd=',
    'if cd -P . 2>/dev/null; then',
    '  case $PWD in /*) qp_cwd=$PWD ;; esac',
    'fi',
    'if [ -z "$QP_LOG_DIR" ]; then',
    "  printf 'git-shim: QP_LOG_DIR is required\\n' >&2",
    '  exit 97',
    'fi',
    `qp_root=${shQuote(root)}`,
    '',
    '# qp_log TAG WHY ARGV...: one NUL-framed record (SHIM_LOGS) carrying the physical cwd. A write',
    '# that fails stops the call: an unlogged call would read as one that never happened.',
    'qp_log() {',
    '  qp_tag=$1',
    '  qp_lwhy=$2',
    '  shift 2',
    `  { printf '%s\\0' "$qp_tag" "$qp_lwhy" "$qp_cwd" "$#" "$@" >> "$QP_LOG_DIR/git-argv.nul"; } 2>/dev/null && return`,
    "  printf 'git-shim: cannot write %s\\n' \"$QP_LOG_DIR/git-argv.nul\" >&2",
    '  exit 97',
    '}',
    '',
    "# qp_join ARGS...: qp_j = the args joined by single spaces (JS argv.join(' ')).",
    'qp_join() {',
    '  qp_j=',
    '  qp_first=1',
    '  for qp_x in "$@"; do',
    '    if [ -n "$qp_first" ]; then qp_j=$qp_x; qp_first=; else qp_j="$qp_j $qp_x"; fi',
    '  done',
    '}',
    '',
    '# qp_refuse WHY ARGV...: log REFUSED, print the argv cut at 300 bytes, exit 97.',
    'qp_refuse() {',
    '  qp_why=$1',
    '  qp_log REFUSED "$@"',
    '  shift',
    '  qp_join "$@"',
    '  if [ "${#qp_j}" -gt 300 ]; then',
    '    qp_q=?',
    '    while [ "${#qp_q}" -lt 300 ]; do qp_q="$qp_q?"; done',
    '    qp_tail=${qp_j#$qp_q}',
    '    qp_j=${qp_j%"$qp_tail"}',
    '  fi',
    "  printf 'git-shim: refused (%s): %s\\n' \"$qp_why\" \"$qp_j\" >&2",
    '  exit 97',
    '}',
    '',
    '# qp_inside DIR: true when DIR is root or under it.',
    'qp_inside() {',
    '  case $1 in "$qp_root"|"$qp_root"/*) return 0 ;; esac',
    '  return 1',
    '}',
    '',
    '# qp_norm DIR: qp_p = DIR resolved lexically against qp_cur, as path.resolve does.',
    'qp_norm() {',
    '  case $1 in /*) qp_r=$1 ;; *) qp_r=$qp_cur/$1 ;; esac',
    '  qp_p=',
    '  while [ -n "$qp_r" ]; do',
    '    qp_s=${qp_r%%/*}',
    '    case $qp_r in */*) qp_r=${qp_r#*/} ;; *) qp_r= ;; esac',
    '    case $qp_s in',
    "      ''|.) ;;",
    '      ..) qp_p=${qp_p%/*} ;;',
    '      *) qp_p=$qp_p/$qp_s ;;',
    '    esac',
    '  done',
    '  if [ -z "$qp_p" ]; then qp_p=/; fi',
    '}',
    '',
    '# qp_key SETTING: records the first -c key that is not core.quotepath (any case).',
    'qp_key() {',
    '  qp_k=${1%%=*}',
    '  case $qp_k in',
    '    [cC][oO][rR][eE].[qQ][uU][oO][tT][eE][pP][aA][tT][hH]) ;;',
    '    *) if [ -z "$qp_isbad" ]; then qp_isbad=1; qp_badkey=$qp_k; fi ;;',
    '  esac',
    '}',
    '',
    'if [ -n "$GIT_DIR" ] || [ -n "$GIT_WORK_TREE" ]; then qp_refuse \'GIT_DIR/GIT_WORK_TREE set\' "$@"; fi',
    'if [ -n "$GIT_CONFIG_COUNT" ] || [ -n "$GIT_CONFIG_PARAMETERS" ]; then qp_refuse \'GIT_CONFIG_COUNT/GIT_CONFIG_PARAMETERS set\' "$@"; fi',
    'if [ -n "$GIT_COMMON_DIR" ] || [ -n "$GIT_OBJECT_DIRECTORY" ] || [ -n "$GIT_ALTERNATE_OBJECT_DIRECTORIES" ]; then qp_refuse \'GIT_COMMON_DIR/GIT_OBJECT_DIRECTORY/GIT_ALTERNATE_OBJECT_DIRECTORIES set\' "$@"; fi',
    '# An absolute GIT_INDEX_FILE, its .. resolved lexically (qp_norm ignores qp_cur for one), must be',
    '# root or under it. git resolves a relative one from the worktree top, so one with a .. segment',
    '# is refused outright.',
    'case $GIT_INDEX_FILE in',
    '  /*) qp_norm "$GIT_INDEX_FILE"; qp_inside "$qp_p" || qp_refuse "GIT_INDEX_FILE outside the sandbox: $GIT_INDEX_FILE" "$@" ;;',
    '  ..|../*|*/..|*/../*) qp_refuse "GIT_INDEX_FILE outside the sandbox: $GIT_INDEX_FILE" "$@" ;;',
    'esac',
    '',
    "# The leading global options (queue-pull-fixtures.js's gitSubArgv): qp_n counts their tokens.",
    'qp_n=0',
    'qp_want=',
    'qp_isunknown=',
    'qp_unknown=',
    'qp_isbad=',
    'qp_badkey=',
    'for qp_a in "$@"; do',
    '  case $qp_want in',
    '    C) qp_want=; qp_n=$((qp_n + 1)); continue ;;',
    '    c) qp_want=; qp_n=$((qp_n + 1)); qp_key "$qp_a"; continue ;;',
    '  esac',
    '  case $qp_a in',
    '    --version) break ;;',
    '    -C) qp_want=C ;;',
    '    -c) qp_want=c ;;',
    '    --no-optional-locks|--no-pager|--literal-pathspecs) ;;',
    '    -*) qp_isunknown=1; qp_unknown=$qp_a; break ;;',
    '    *) break ;;',
    '  esac',
    '  qp_n=$((qp_n + 1))',
    'done',
    '# A trailing -c has an empty value, so an empty key.',
    'if [ "$qp_want" = c ]; then qp_key \'\'; fi',
    'if [ -n "$qp_isunknown" ]; then qp_refuse "unknown global option $qp_unknown" "$@"; fi',
    'if [ -n "$qp_isbad" ]; then qp_refuse "config key not allowed: $qp_badkey" "$@"; fi',
    '',
    '# The physical cwd, then each -C entered from where the one before it landed. An empty -C is',
    '# a no-op (as in git); a relative one gets ./ so `cd -P -- -` cannot mean $OLDPWD.',
    'if [ -z "$qp_cwd" ]; then qp_refuse \'unresolvable cwd\' "$@"; fi',
    'qp_inside "$qp_cwd" || qp_refuse "outside the sandbox: $qp_cwd" "$@"',
    'qp_cur=$qp_cwd',
    'qp_i=0',
    'qp_want=',
    'for qp_a in "$@"; do',
    '  [ "$qp_i" -lt "$qp_n" ] || break',
    '  qp_i=$((qp_i + 1))',
    '  case $qp_want in',
    '    c) qp_want=; continue ;;',
    '    C)',
    '      qp_want=',
    '      [ -n "$qp_a" ] || continue',
    '      case $qp_a in /*) qp_d=$qp_a ;; *) qp_d=./$qp_a ;; esac',
    '      if cd -P -- "$qp_d" 2>/dev/null; then',
    '        qp_cur=$PWD',
    '        qp_inside "$qp_cur" || qp_refuse "outside the sandbox: $qp_cur" "$@"',
    '      else',
    '        qp_norm "$qp_a"',
    '        qp_refuse "unresolvable directory $qp_p" "$@"',
    '      fi',
    '      continue ;;',
    '  esac',
    '  case $qp_a in -C) qp_want=C ;; -c) qp_want=c ;; esac',
    'done',
    '# Back to the cwd, PWD and OLDPWD this shim started with (cd moved OLDPWD), which the real',
    '# git inherits.',
    'cd -P -- "$qp_cwd" 2>/dev/null || qp_refuse "cannot return to $qp_cwd" "$@"',
    'PWD=$qp_pwd',
    'if [ -n "$qp_oldpwd_set" ]; then OLDPWD=$qp_oldpwd; else unset OLDPWD; fi',
    '',
    '# qp_route SUB-ARGV: qp_kind = injected (qp_j = the sub-argv joined), canned or delegated.',
    'qp_route() {',
    '  shift "$qp_n"',
    ...failTests,
    '  if [ $# -eq 3 ] && [ "$1" = remote ] && [ "$2" = get-url ] && [ "$3" = origin ]; then qp_kind=canned; return; fi',
    '  qp_kind=delegated',
    '}',
    'qp_route "$@"',
    'case $qp_kind in',
    '  injected)',
    "    qp_log injected '' \"$@\"",
    "    printf 'git-shim: injected failure: %s\\n' \"$qp_j\" >&2",
    '    exit 128 ;;',
    '  canned)',
    "    qp_log canned '' \"$@\"",
    `    printf '%s\\n' ${shQuote(table.git.remoteUrl)}`,
    '    exit 0 ;;',
    'esac',
    "qp_log delegated '' \"$@\"",
    `exec ${shQuote(realGit)} "$@"`,
    '',
  ].join('\n');
}

// bin/gh: a POSIX sh script answering the table's exact-argv, effect-free entries without a node
// start, one `if` arm per entry in table order. An entry whose argv an earlier entry already holds
// gets no arm (ghAnswer never returns it), and an effect entry gets none either, so the calls they
// would answer fall through. A hit logs one SHIM_LOGS.gh record (tag injected for a non-zero
// status, else ok; why and cwd empty), writes stdout then stderr and exits with the status, as
// ghShim does. Every answer is inline (measured: a 277 KB inline answer added ~7 ms to each call
// that parses past it under macOS /bin/sh, nothing measurable under dash or at fixture sizes).
// Every other call (api graphql, an effect entry, a miss) execs <shimDir>/gh-fallback, the node
// shim (ghShim), so ghAnswer still answers it and a miss still exits 97, logged UNHANDLED. An
// empty QP_LOG_DIR is refused (exit 97) before any arm or the fallback, and a log record it cannot
// write stops the call (exit 97) before any output. No forks: no $(...), subshell or pipe; dash
// and macOS /bin/sh alike.
function ghShimScript({ shimDir, table }) {
  const arms = [];
  const held = new Set();
  table.gh.forEach((entry, i) => {
    if (!Array.isArray(entry.argv)) return;
    const key = JSON.stringify(entry.argv);
    if (held.has(key)) return;
    held.add(key);
    if (entry.effect) return;
    const stdout = entry.stdout || '';
    const stderr = entry.stderr || '';
    const status = entry.status || 0;
    // A sh literal cannot carry a NUL byte, so an answer holding one would be cut short.
    if (typeof stdout !== 'string' || typeof stderr !== 'string' || /\0/.test(stdout + stderr)
      || !Number.isInteger(status) || status < 0 || status > 255) {
      throw new Error(`ghShimScript: scenario.gh[${i}] needs a NUL-free string stdout and stderr and a status in 0..255`);
    }
    const writes = [];
    if (stdout) writes.push(`printf '%s' ${shQuote(stdout)}`);
    if (stderr) writes.push(`printf '%s' ${shQuote(stderr)} >&2`);
    const tests = [`[ $# -eq ${entry.argv.length} ]`, ...entry.argv.map((a, k) => `[ "\${${k + 1}}" = ${shQuote(a)} ]`)];
    arms.push(`if ${tests.join(' && ')}; then`, `  qp_log ${status ? 'injected' : 'ok'} "$@"`, ...writes.map((line) => `  ${line}`), `  exit ${status}`, 'fi');
  });
  return [
    '#!/bin/sh',
    '# Generated by tests/bin-lib/dispatch/queue-pull-oracle.js (ghShimScript); rewritten by setScenario.',
    '# An empty QP_LOG_DIR would send the fallback\'s record to a relative gh-argv.nul in the cwd.',
    'if [ -z "$QP_LOG_DIR" ]; then',
    "  printf 'gh-shim: QP_LOG_DIR is required\\n' >&2",
    '  exit 97',
    'fi',
    '',
    '# qp_log TAG ARGV...: one NUL-framed record (SHIM_LOGS), why and cwd empty. A write that fails',
    '# stops the call: an unlogged answer would read as a call that never happened.',
    'qp_log() {',
    '  qp_tag=$1',
    '  shift',
    `  { printf '%s\\0' "$qp_tag" '' '' "$#" "$@" >> "$QP_LOG_DIR/gh-argv.nul"; } 2>/dev/null && return`,
    "  printf 'gh-shim: cannot write %s\\n' \"$QP_LOG_DIR/gh-argv.nul\" >&2",
    '  exit 97',
    '}',
    '',
    ...arms,
    `exec ${shQuote(path.join(shimDir, 'gh-fallback'))} "$@"`,
    '',
  ].join('\n');
}

// createSandbox(scenario, { transport, origin, name, agent }) -> sandbox. `origin` is another
// sandbox's origin.git to copy (a cache-hit run after its cache-miss run); scenario.origin is then
// unused. On transport 'files' the bin holds no gh shim and the PATH no gh at all, `agent`
// ({ name: content }) is written to <root>/agent (QP_AGENT_DIR, what filesOracleScript's agent
// writes copy from), and scenario.foreign ({ 'owner/name#N': state }; a string is written as is,
// null writes nothing) is written there as foreign-states.json and exported as
// DISPATCH_FOREIGN_STATES. `sandbox.setScenario(next)` swaps the gh and git answers for later runs
// (the D1 reproduction's second pull); everything else stays the first scenario's.
function createSandbox(scenario, { transport = 'gh', origin = null, name = scenario.name || 'sandbox', agent = {} } = {}) {
  installExitHooks();
  const table = shimTable(scenario);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qp-oracle-')));
  liveRoots.add(root);
  const cleanup = () => {
    fs.rmSync(root, { recursive: true, force: true });
    liveRoots.delete(root);
  };
  try {
    const dir = (...segments) => {
      const p = path.join(root, ...segments);
      fs.mkdirSync(p, { recursive: true });
      return p;
    };
    const home = dir('home');
    const logs = dir('logs');
    const bin = dir('bin');
    dir('tmp');
    const proj = path.join(root, 'proj');
    const originDir = path.join(root, 'origin.git');
    const gitConfig = path.join(home, '.gitconfig');
    const tablePath = path.join(root, 'shim-table.json');
    fs.writeFileSync(gitConfig, '[user]\n\tname = qp-oracle\n\temail = qp-oracle@example.invalid\n[init]\n\tdefaultBranch = main\n');

    const realGit = resolveRealGit();
    const gitIsolation = {
      GIT_CEILING_DIRECTORIES: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig,
      GIT_AUTHOR_DATE: PINNED_GIT_DATE, GIT_COMMITTER_DATE: PINNED_GIT_DATE,
    };
    const setupEnv = { HOME: home, PATH: [path.dirname(realGit), '/usr/bin', '/bin'].join(path.delimiter), TZ: 'UTC', LANG: 'C', ...gitIsolation };
    const git = (args, opts = {}) => fixtureGit(args, { env: setupEnv, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });

    if (origin) fs.cpSync(origin, originDir, { recursive: true });
    else seedOrigin(originDir, scenario.origin, git, scenario.headBranch);
    git(['clone', '-q', originDir, proj]);

    const policy = Object.entries(scenario.policy || {}).map(([k, v]) => `${k}: ${v}\n`).join('');
    fs.mkdirSync(path.join(proj, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude-tweaks', 'policy.yml'), policy);
    const runDir = path.join(proj, '.claude-tweaks', 'pipelines', RUN_DIR_NAME);
    fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'decisions.md'), '');

    const onFiles = transport === 'files';
    const shimDir = dir('shim');
    fs.writeFileSync(tablePath, JSON.stringify(table));
    writeShims({ bin, shimDir, root, realGit, table, gh: !onFiles });
    const agentDir = dir('agent');
    for (const [file, content] of Object.entries(agent)) fs.writeFileSync(path.join(agentDir, file), content);
    let foreignStates = null;
    if (onFiles && scenario.foreign !== undefined) {
      foreignStates = path.join(agentDir, 'foreign-states.json');
      // An object is written as JSON, a string as is; null names a file the agent never wrote.
      if (scenario.foreign !== null) fs.writeFileSync(foreignStates, typeof scenario.foreign === 'string' ? scenario.foreign : JSON.stringify(scenario.foreign));
    }
    let systemPath = ['/usr/bin', '/bin'];
    if (onFiles) {
      systemPath = [dir('sysbin')];
      writeSystemBin(systemPath[0]);
    }

    const runEnv = ({ tmpdir, sessionId }) => {
      const env = {
        PATH: [bin, ...systemPath].join(path.delimiter),
        HOME: home, PWD: proj, OLDPWD: proj, TMPDIR: tmpdir, TZ: 'UTC', LANG: 'C',
        CLAUDE_PLUGIN_ROOT: path.join(REPO, 'plugin').split(path.sep).join('/'),
        CLAUDE_CODE_SESSION_ID: sessionId,
        ...gitIsolation,
        QP_SHIM_TABLE: tablePath, QP_LOG_DIR: logs, QP_TMPNAME_COUNTER_FILE: path.join(logs, 'tmpname-counter'),
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${JSON.stringify(CLOCK_STUB)}`].filter(Boolean).join(' '),
        ...(onFiles ? { QP_AGENT_DIR: agentDir } : {}),
        ...(foreignStates ? { DISPATCH_FOREIGN_STATES: foreignStates } : {}),
      };
      for (const [k, v] of Object.entries(process.env)) if (k.startsWith('CT_TRACE_')) env[k] = v;
      return env;
    };
    // null only when origin has no health-state branch or the branch has no order.json; a git
    // failure of any other kind, or a blob that is not JSON, throws.
    const orderBlob = () => {
      try {
        git(['-C', originDir, 'rev-parse', '--verify', '--quiet', 'refs/heads/health-state']);
      } catch (err) {
        if (err.status === 1 && !String(err.stderr || '').trim()) return null;
        throw err;
      }
      if (!git(['-C', originDir, 'ls-tree', '--name-only', 'health-state', '--', 'queue-order/order.json']).trim()) return null;
      // A real-sized queue's blob passes execFileSync's 1 MiB default buffer (fixtureGit reports an
      // overflow as one).
      return JSON.parse(git(['-C', originDir, 'show', 'health-state:queue-order/order.json'], { maxBuffer: 64 * 1024 * 1024 }));
    };
    const setScenario = (next) => {
      const nextTable = shimTable(next);
      fs.writeFileSync(tablePath, JSON.stringify(nextTable));
      writeShims({ bin, shimDir, root, realGit, table: nextTable, gh: !onFiles });
    };
    return {
      name, transport, scenario, root, home, proj, bin, logs, agentDir, origin: originDir, runDir, runs: 0, runEnv, orderBlob, cleanup, setScenario,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

// --- the bounded run -----------------------------------------------------------

// The marker a capped stream ends with; assertClean fails any run whose stream carries it.
const STREAM_TRUNCATED = '[queue-pull oracle: stream truncated at 64 KiB]';
function capture(stream) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  stream.on('data', (chunk) => {
    const room = STREAM_CAP_BYTES - size;
    if (chunk.length > room) truncated = true;
    if (room <= 0) return;
    const kept = chunk.subarray(0, room);
    chunks.push(kept);
    size += kept.length;
  });
  return () => Buffer.concat(chunks).toString('utf8') + (truncated ? `\n${STREAM_TRUNCATED}\n` : '');
}

// command + args run as their own process group, stdin closed, each stream capped, reaped on exit.
function spawnBounded(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    if (child.pid) liveGroups.add(child.pid);
    const stdout = capture(child.stdout);
    const stderr = capture(child.stderr);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reapGroup(child.pid);
    }, ORACLE_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      if (child.pid) reapGroup(child.pid);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const empty = reapGroup(child.pid);
      if (timedOut) return reject(new Error(`queue-pull oracle: timed out after ${ORACLE_TIMEOUT_MS} ms\n${stderr()}`));
      if (!empty) return reject(new Error(`queue-pull oracle: SURVIVORS: process group ${child.pid} still alive after bash exited`));
      const status = code !== null ? code : 128 + (os.constants.signals[signal] || 0);
      return resolve({ status, stdout: stdout(), stderr: stderr() });
    });
  });
}

const readOrNull = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

// The shim logs (under <root>/logs). One record per shim call, every writer alike: the fields tag,
// why, cwd, argc (a decimal string) and then each argv element, every one followed by one NUL byte.
// NUL cannot occur in an argv element, so no escaping is needed and the sh shims can write a record
// with one `printf '%s\0' "$tag" "$why" "$cwd" "$#" "$@"`.
const SHIM_LOGS = { gh: 'gh-argv.nul', git: 'git-argv.nul' };

function appendShimRecord(file, { tag, why = '', cwd = '', argv }) {
  const fields = [tag, why, cwd, String(argv.length), ...argv];
  fs.appendFileSync(file, fields.map((f) => `${f}\0`).join(''));
}

// readShimLog(logsDir, kind) -> [{ tag, argv }] for 'gh'; [{ tag, cwd, argv }] for 'git', plus `why`
// when it is non-empty. An absent log reads as []; a record that is cut short or whose argc is not
// a decimal integer throws.
function readShimLog(logsDir, kind) {
  const file = path.join(logsDir, SHIM_LOGS[kind]);
  const text = readOrNull(file) || '';
  const malformed = (detail) => new Error(`readShimLog: malformed record in ${file}: ${detail}`);
  if (text !== '' && !text.endsWith('\0')) throw malformed('file ends mid-field');
  const fields = text === '' ? [] : text.slice(0, -1).split('\0');
  const records = [];
  for (let i = 0; i < fields.length;) {
    if (i + 4 > fields.length) throw malformed('file ends mid-record');
    const [tag, why, cwd, argc] = fields.slice(i, i + 4);
    if (!/^\d+$/.test(argc)) throw malformed(`argc is not a decimal integer: ${JSON.stringify(argc)}`);
    const end = i + 4 + Number(argc);
    if (end > fields.length) throw malformed(`argc ${argc} but the file ends after ${fields.length - i - 4} argument(s)`);
    const argv = fields.slice(i + 4, end);
    records.push(kind === 'git' ? { tag, ...(why ? { why } : {}), cwd, argv } : { tag, argv });
    i = end;
  }
  return records;
}

// The session dir a run's node processes resolve under its TMPDIR: plugin/bin/lib/session-tmp.js's
// sessionTmpRoot rule, which this test process cannot call directly (its os.tmpdir() differs), over
// the plugin's own session-id rule (required here, not at the top, as the shims re-enter this file).
const sessionDirUnder = (tmpdir, sessionId) => {
  const { resolveSessionId } = require(path.join(REPO, 'plugin', 'bin', 'lib', 'session-tmp.js'));
  return path.join(tmpdir, `ct-session-${resolveSessionId(sessionId)}`);
};

// runOracle(sandbox, script, { sessionId, tmp }) -> { status, stdout, stderr, files, staged,
// decisions, orderBlob, ghArgv, gitArgv }, plus a non-enumerable `sandbox`. The session id is
// derived from the sandbox name, so a parity pair's two sandboxes print the same paths after
// normalize. `tmp` names the run's TMPDIR under <root>/tmp (default `run-<n>`, fresh per run): the
// D1 reproduction passes one name to two runs, its only deliberate session reuse.
async function runOracle(sandbox, script, { sessionId = `qp-${sandbox.name}`, tmp = null } = {}) {
  const bash = findBash();
  if (!bash) throw new Error(oracleSkip());
  return withEscapeGuard(REPO, async () => {
    sandbox.runs += 1;
    const tmpdir = path.join(sandbox.root, 'tmp', tmp || `run-${sandbox.runs}`);
    fs.mkdirSync(tmpdir, { recursive: true });
    const scriptFile = path.join(sandbox.root, `queue-pull-${sandbox.runs}.sh`);
    fs.writeFileSync(scriptFile, script);
    for (const log of Object.values(SHIM_LOGS)) fs.writeFileSync(path.join(sandbox.logs, log), '');
    fs.rmSync(path.join(sandbox.logs, 'cli-calls'), { recursive: true, force: true });

    const run = await spawnBounded(bash, ['--noprofile', '--norc', '-c', 'ulimit -f 4096; exec "$0" --noprofile --norc "$1"', bash, scriptFile],
      { cwd: sandbox.proj, env: sandbox.runEnv({ tmpdir, sessionId }) });
    const result = collectResult(sandbox, run, tmpdir, sessionId);
    Object.defineProperty(result, 'sandbox', { value: sandbox, enumerable: false });
    return result;
  });
}

// runModuleCli(sandbox, argv, { sessionId, stage }) -> the same result shape as runOracle: spawns
// `node <this checkout>/plugin/bin/queue-pull.js <argv>` with the sandbox's explicit env (PATH
// shims, frozen clock, fresh TMPDIR) and cwd, inside the escape guard. `stage` ({ name: content })
// is written to the run's session dir first: the `files` transport's inputs at their default paths.
// `tmp` is runOracle's.
async function runModuleCli(sandbox, argv, { sessionId = `qp-${sandbox.name}`, stage = {}, tmp = null } = {}) {
  return withEscapeGuard(REPO, async () => {
    sandbox.runs += 1;
    const tmpdir = path.join(sandbox.root, 'tmp', tmp || `run-${sandbox.runs}`);
    fs.mkdirSync(tmpdir, { recursive: true });
    for (const log of Object.values(SHIM_LOGS)) fs.writeFileSync(path.join(sandbox.logs, log), '');
    fs.rmSync(path.join(sandbox.logs, 'cli-calls'), { recursive: true, force: true });
    if (Object.keys(stage).length) {
      const sessionDir = sessionDirUnder(tmpdir, sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });
      for (const [name, content] of Object.entries(stage)) fs.writeFileSync(path.join(sessionDir, name), content);
    }
    // Async and bounded like the oracle's own run, so a parity pool runs the two sides concurrently.
    const r = await spawnBounded(process.execPath, [path.join(REPO, 'plugin', 'bin', 'queue-pull.js'), ...argv],
      { cwd: sandbox.proj, env: sandbox.runEnv({ tmpdir, sessionId }) });
    const result = collectResult(sandbox, r, tmpdir, sessionId);
    Object.defineProperty(result, 'sandbox', { value: sandbox, enumerable: false });
    return result;
  });
}

// The files, staged proposals, decisions, order blob and shim logs a run left behind, merged into
// the run's { status, stdout, stderr }. Shared by the oracle and the module CLI.
function collectResult(sandbox, run, tmpdir, sessionId) {
  const sessionDir = sessionDirUnder(tmpdir, sessionId);
  const files = {};
  for (const name of sessionFileNames()) files[name] = readOrNull(path.join(sessionDir, name));
  const stagedDir = path.join(sandbox.runDir, 'staged');
  const staged = {};
  for (const name of fs.existsSync(stagedDir) ? fs.readdirSync(stagedDir).sort() : []) {
    staged[name] = fs.readFileSync(path.join(stagedDir, name), 'utf8');
  }
  return {
    ...run,
    files,
    staged,
    decisions: readOrNull(path.join(sandbox.runDir, 'decisions.md')),
    orderBlob: sandbox.orderBlob(),
    ghArgv: readShimLog(sandbox.logs, 'gh'),
    gitArgv: readShimLog(sandbox.logs, 'git'),
    cliCalls: readCliCalls(path.join(sandbox.logs, 'cli-calls')),
  };
}

// nodeShim's log: [{ argv, groups, exclusions }] (the files' text, or null), sorted by argv. Only
// PATH `node` calls are logged, so a module-side run (whose CLIs spawn process.execPath) logs none.
function readCliCalls(dir) {
  const calls = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map((pid) => ({
    argv: fs.readFileSync(path.join(dir, pid, 'argv'), 'utf8').split('\0').slice(0, -1),
    groups: readOrNull(path.join(dir, pid, 'groups')),
    exclusions: readOrNull(path.join(dir, pid, 'exclusions')),
  }));
  return calls.sort((a, b) => (a.argv.join('\0') < b.argv.join('\0') ? -1 : 1));
}

// The real checkout's HEAD (its commit and what it points at: a branch, or detached), refs, index
// and tracked-file status before and after fn; any change fails the run (#4303: an inherited
// OLDPWD put commits on the live branch). Untracked files are
// deliberately not compared: tools/run-tests.js runs files concurrently and another suite
// (exit-code-conformance) creates a temporary untracked file in this checkout (controller ruling,
// Task 4 review). A stray commit, ref, staged change or tracked-file edit is still caught.
async function withEscapeGuard(repoRoot, fn) {
  const g = (...args) => fixtureGit(['--no-optional-locks', '-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let currentBranch = null;
  try { currentBranch = g('symbolic-ref', '--short', 'HEAD').trim(); } catch { /* detached HEAD: HEAD is compared */ }
  // The repository's refs are shared with every worktree and sibling session, so a whole-repo
  // `for-each-ref` flaps whenever one of them pushes a branch (seen live), and tags and the stash
  // are as shared (a sibling's tag or stash entry moves them too). The refs compared are the current
  // branch and any ref whose tip carries the sandbox's own git identity (`qp-oracle`, the only author
  // an escaped oracle command can commit as, so an escaped stash or tag is still caught by it).
  // `symref` is what HEAD points at, so a branch switch at the same commit is caught.
  const symbolicHead = () => {
    try {
      return g('symbolic-ref', '-q', 'HEAD').trim();
    } catch (err) {
      if (err.status === 1) return '(detached)';
      throw err;
    }
  };
  const read = () => ({
    head: g('rev-parse', 'HEAD').trim(),
    symref: symbolicHead(),
    refs: g('for-each-ref', '--format=%(refname) %(objectname) %(authorname)').split('\n')
      .filter(Boolean).filter((l) => {
        const [name, , ...author] = l.split(' ');
        return author.join(' ') === 'qp-oracle' || name === `refs/heads/${currentBranch}`;
      }).join('\n') + '\n',
    index: g('diff', '--cached', '--name-status'),
    status: g('status', '--porcelain', '--untracked-files=no'),
  });
  const before = read();
  let outcome;
  try {
    outcome = { value: await fn() };
  } catch (err) {
    outcome = { err };
  }
  const after = read();
  if (['head', 'symref', 'refs', 'index', 'status'].some((k) => after[k] !== before[k])) {
    throw new Error(`escape guard: ${repoRoot} changed during the run\nHEAD ${before.head} -> ${after.head}\n`
      + `HEAD points at ${before.symref} -> ${after.symref}\n`
      + `refs before:\n${before.refs}refs after:\n${after.refs}`
      + `index before:\n${before.index}index after:\n${after.index}`
      + `status before:\n${before.status}status after:\n${after.status}`);
  }
  if (outcome.err) throw outcome.err;
  return outcome.value;
}

// --- comparison ------------------------------------------------------------------

// AC1's two substitutions and nothing else: the sandbox root -> <SCR>, the run-dir name -> <RUN>.
function normalize(value, sandbox) {
  const sub = (s) => s.split(sandbox.root).join('<SCR>').split(RUN_DIR_NAME).join('<RUN>');
  const walk = (v) => {
    if (typeof v === 'string') return sub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [sub(k), walk(x)]));
    return v;
  };
  return walk(value);
}

// The four failure lines whose fence tail is `$(cat <err file>)`: Node's uncaught-exception header
// (a throw-site file:line or a node:internal loader line, Node-version dependent) leads the tail,
// and the module prints err.message instead. They compare up to and including this prefix, tail
// excluded (controller ruling, Task 4 review). `errFile` is the session file the tail is read from.
const TAIL_LINES = [
  { prefix: 'dispatch: queue-pull stopped -- not-spec-shaped exclusion pass hit a corrupt exclusions file: ', errFile: 'dispatch-shape-gate.err' },
  { prefix: 'dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: ', errFile: 'dispatch-linked-prs.err' },
  { prefix: 'Warning: not-spec-shaped pass skipped — ', errFile: 'dispatch-shape-gate.err' },
  { prefix: 'Warning: open-linked-PR filtering failed — dispatch-groups.json left unfiltered for this exclusion this run: ', errFile: 'dispatch-linked-prs.err' },
];
const TAIL_EXCLUDED_PREFIXES = TAIL_LINES.map((t) => t.prefix);

// The AUTO and Warning lines AC1 compares on each channel.
function reported(text) {
  return String(text || '').split(/\r?\n/).filter((line) => REPORTED_LINE.test(line)).map((line) => {
    const prefix = TAIL_EXCLUDED_PREFIXES.find((p) => line.startsWith(p));
    return prefix ? prefix : line;
  });
}

const parsedOrRaw = (text) => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

function parityView(r, files) {
  const picked = {};
  for (const name of files) picked[name] = parsedOrRaw(r.files[name]);
  return normalize({
    status: r.status, stdout: reported(r.stdout), stderr: reported(r.stderr),
    files: picked, staged: r.staged, decisions: r.decisions, orderBlob: r.orderBlob,
  }, r.sandbox);
}

// Lines `reported` drops: AC1 compares only AUTO/Warning lines, so a module-side `queue-pull: <step>:`
// diagnostic (a step that threw, R6) is never compared as text. It may only appear in a run where
// the script's stderr also carries an unreported line, i.e. where the script errored there too.
const unreportedLines = (text) => String(text || '').split(/\r?\n/).filter((line) => line.trim() !== '' && !REPORTED_LINE.test(line));
const moduleDiagnostics = (text) => String(text || '').split(/\r?\n/).filter((line) => line.startsWith('queue-pull: '));

// a: the oracle's run, b: the module's. Files compare JSON-equal (raw text when not JSON).
function assertParity(a, b, { files = sessionFileNames() } = {}) {
  assert.deepStrictEqual(parityView(b, files), parityView(a, files));
  const diagnostics = moduleDiagnostics(b.stderr);
  assert.ok(diagnostics.length === 0 || unreportedLines(a.stderr).length > 0,
    `the module printed ${JSON.stringify(diagnostics[0])} where the script's stderr shows no error`);
}

// runAll([{ name, after?, run(depResult) }], limit) -> { [name]: result }. A job naming `after`
// starts only once that job has settled, and gets its result; independent jobs run up to `limit`
// at a time. Every job settles: one failure never stops the others. A failed job (or one whose
// `after` failed, which never runs) gets a non-enumerable property that throws its own error when
// read, so each consumer fails on its own job with that job's cause; failedJobs(results) lists
// every failure. An invalid job list (a duplicate name, an unknown or cyclic `after`) rejects.
const FAILED_JOBS = Symbol('runAll.failed');
function runAll(jobs, limit = (os.availableParallelism ? os.availableParallelism() : os.cpus().length)) {
  const names = new Set();
  for (const job of jobs) {
    if (names.has(job.name)) return Promise.reject(new Error(`runAll: duplicate job name ${job.name}`));
    names.add(job.name);
  }
  const orphan = jobs.find((job) => job.after !== undefined && !names.has(job.after));
  if (orphan) return Promise.reject(new Error(`runAll: job ${orphan.name} names an unknown after: ${orphan.after}`));

  const slots = Math.max(1, Math.floor(limit) || 1);
  const pending = [...jobs];
  const results = {};
  const failed = new Map();
  Object.defineProperty(results, FAILED_JOBS, { value: failed, enumerable: false });
  const settled = new Set();
  const fail = (name, err) => {
    failed.set(name, err);
    Object.defineProperty(results, name, { enumerable: false, configurable: true, get() { throw err; } });
  };
  let running = 0;
  return new Promise((resolve, reject) => {
    const pump = () => {
      while (running < slots) {
        const at = pending.findIndex((job) => job.after === undefined || settled.has(job.after));
        if (at === -1) break;
        const [job] = pending.splice(at, 1);
        if (job.after !== undefined && failed.has(job.after)) {
          fail(job.name, new Error(`runAll: job ${job.name} never ran: its after job ${job.after} failed`, { cause: failed.get(job.after) }));
          settled.add(job.name);
          continue;
        }
        running += 1;
        Promise.resolve()
          .then(() => job.run(job.after === undefined ? undefined : results[job.after]))
          .then((value) => {
            results[job.name] = value;
          }, (err) => {
            fail(job.name, new Error(`runAll: job ${job.name} failed: ${err && err.message}`, { cause: err }));
          })
          .finally(() => {
            settled.add(job.name);
            running -= 1;
            pump();
          });
      }
      if (running > 0) return;
      if (pending.length) reject(new Error(`runAll: jobs that can never start (an after cycle): ${pending.map((j) => j.name).join(', ')}`));
      else resolve(results);
    };
    pump();
  });
}

// [[name, error]] for every job runAll could not give a result, in settle order.
const failedJobs = (results) => [...(results[FAILED_JOBS] || new Map())];

// runPair({ name, scenario, transport, origin, agent }) -> { oracle, module }: two sandboxes built
// from one scenario under one name (so both print the same session paths after normalize), the
// oracle run in one and the module CLI in the other, concurrently. `origin` ({ oracle, module }:
// origin.git paths) makes each side copy its own earlier run's origin -- a cache-hit config after
// its miss. On `files`, `agent` (default agentInputs(scenario)) is what the oracle's agent writes
// copy from, and the same files are staged at the module's session paths. Both results keep their
// sandbox (non-enumerable `.sandbox`) for the caller to clean up. On a failure both sides settle
// before either sandbox is removed (the other side's process may still be running in its own), and
// the first failure is rethrown.
let fenceText = null;
async function runPair({ name, scenario, transport = 'gh', origin = null, agent = null }) {
  if (!fenceText) fenceText = extractFence(readText(SCRIPT_MD), FENCE_FIRST_LINE);
  const inputs = transport === 'files' ? (agent || agentInputs(scenario)) : {};
  const script = transport === 'files' ? filesOracleScript(fenceText, readText(MCP_MD)) : fenceText;
  const make = (side) => createSandbox(scenario, { transport, name, agent: inputs, origin: origin ? origin[side] : null });
  const sandboxes = [];
  const teardown = (err) => {
    for (const sb of sandboxes) sb.cleanup();
    throw err;
  };
  try {
    sandboxes.push(make('oracle'), make('module'));
  } catch (err) {
    teardown(err);
  }
  const [oracle, module] = await Promise.allSettled([
    runOracle(sandboxes[0], script),
    runModuleCli(sandboxes[1], ['--transport', transport], { stage: inputs }),
  ]);
  const rejected = [oracle, module].find((s) => s.status === 'rejected');
  if (rejected) teardown(rejected.reason);
  return { oracle: oracle.value, module: module.value };
}

// --- the node gh shim (<root>/shim/gh-fallback re-enters here) -------------------------

function shimLog(kind, entry) {
  appendShimRecord(path.join(process.env.QP_LOG_DIR, SHIM_LOGS[kind]), entry);
}

function ghShim(table) {
  const argv = process.argv.slice(2);
  const answer = ghAnswer(table.gh, argv);
  if (!answer) {
    shimLog('gh', { tag: 'UNHANDLED', argv });
    process.stderr.write(`gh-shim: no canned response for: ${argv.join(' ').slice(0, 300)}\n`);
    process.exitCode = 97;
    return;
  }
  // The plugin's own rule; its os.tmpdir() reads the sandbox TMPDIR this shim runs under.
  const { sessionTmpRoot } = require(path.join(REPO, 'plugin', 'bin', 'lib', 'session-tmp.js'));
  applyEffect(answer.effect, sessionTmpRoot(process.env.CLAUDE_CODE_SESSION_ID));
  shimLog('gh', { tag: answer.status ? 'injected' : 'ok', argv });
  process.stdout.write(answer.stdout);
  process.stderr.write(answer.stderr);
  process.exitCode = answer.status;
}

function shimMain(kind) {
  const table = JSON.parse(fs.readFileSync(process.env.QP_SHIM_TABLE, 'utf8'));
  if (kind === 'gh') return ghShim(table);
  throw new Error(`unknown shim ${kind}`);
}

module.exports = {
  REPO, SCRIPT_MD, MCP_MD, FENCE_FIRST_LINE, RUN_DIR_NAME,
  findBash, oracleSkip, extractFence, fenceSessionFiles, sessionFileNames, filesOracleScript,
  createSandbox, writeShims, runOracle, runModuleCli, runPair, withEscapeGuard, normalize, reported, assertParity, runAll, failedJobs, shimMain, shQuote,
  STREAM_TRUNCATED, TAIL_LINES, SHIM_LOGS, appendShimRecord, readShimLog,
};
