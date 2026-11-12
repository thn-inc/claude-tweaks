'use strict';
// #5227: the bash oracle for the queue-pull parity suite. It runs
// plugin/skills/dispatch/queue-pull-script.md's fence whole, in one bash process, inside a
// throwaway sandbox:
//   <root>/home       HOME, with a .gitconfig naming the commit identity
//   <root>/tmp/run-N  a fresh TMPDIR per run, so session files never leak across runs
//   <root>/proj       a clone of <root>/origin.git: the cwd, with policy.yml and the pre-minted
//                     dispatch-standalone run dir
//   <root>/bin        PATH shims: gh (answers from QP_SHIM_TABLE, never the real gh), git (the
//                     real git, only inside <root>), mktemp (counter-file names) and a node link
//   <root>/logs       gh-argv.jsonl, git-argv.jsonl and the mktemp counter
//   <root>/agent      files transport only: what the agent fetched through MCP (QP_AGENT_DIR), which
//                     filesOracleScript's agent writes copy from, and DISPATCH_FOREIGN_STATES
//   <root>/sysbin     files transport only: links to the system tools the fence runs, so the PATH
//                     holds no gh (the bin holds no gh shim there either)
// The env is explicit (shell-scanner-bash-differential's escape rules): nothing is inherited
// except NODE_OPTIONS (the clock stub's --require appended) and CT_TRACE_*, so the test-impact
// tracer still sees the children. Every run sits inside withEscapeGuard on this checkout.
// The shim files re-enter this module through shimMain(), so keep its top level cheap.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');

const { STUB_SKIP_REASON } = require('../../helpers/path-stub');
const { readText } = require('../../helpers/read-skill');
const { fixtureGit } = require('../../helpers/git-fixtures');
const {
  ghAnswer, applyEffect, gitSubArgv, gitFailMatch, isGetUrlOrigin, shimTable, agentInputs,
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

function writeShims(bin, { gh = true } = {}) {
  if (/\s/.test(process.execPath)) {
    throw new Error(`queue-pull oracle: the node path ${process.execPath} holds whitespace, so it cannot stand in a #! line`);
  }
  for (const kind of gh ? ['gh', 'git', 'mktemp'] : ['git', 'mktemp']) {
    const src = `#!${process.execPath}\n'use strict';\nrequire(${JSON.stringify(__filename)}).shimMain(${JSON.stringify(kind)});\n`;
    fs.writeFileSync(path.join(bin, kind), src, { mode: 0o755 });
  }
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
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
    writeShims(bin, { gh: !onFiles });
    fs.writeFileSync(tablePath, JSON.stringify({ ...table, root, realGit }));
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
    const setScenario = (next) => fs.writeFileSync(tablePath, JSON.stringify({ ...shimTable(next), root, realGit }));
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
const readJsonl = (file) => (readOrNull(file) || '').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// The session dir a run's node processes resolve under its TMPDIR: plugin/bin/lib/session-tmp.js's
// sessionTmpRoot rule, which this test process cannot call directly (its os.tmpdir() differs).
const sessionDirUnder = (tmpdir, sessionId) => path.join(tmpdir, `ct-session-${String(sessionId).trim()}`);

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
    for (const log of ['gh-argv.jsonl', 'git-argv.jsonl']) fs.writeFileSync(path.join(sandbox.logs, log), '');

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
    for (const log of ['gh-argv.jsonl', 'git-argv.jsonl']) fs.writeFileSync(path.join(sandbox.logs, log), '');
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
    ghArgv: readJsonl(path.join(sandbox.logs, 'gh-argv.jsonl')),
    gitArgv: readJsonl(path.join(sandbox.logs, 'git-argv.jsonl')),
  };
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

// a: the oracle's run, b: the module's. Files compare JSON-equal (raw text when not JSON).
function assertParity(a, b, { files = sessionFileNames() } = {}) {
  assert.deepStrictEqual(parityView(b, files), parityView(a, files));
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

// --- the shims (each bin/ file re-enters here) -------------------------------------

function shimLog(file, entry) {
  fs.appendFileSync(path.join(process.env.QP_LOG_DIR, file), JSON.stringify(entry) + '\n');
}

function ghShim(table) {
  const argv = process.argv.slice(2);
  const answer = ghAnswer(table.gh, argv);
  if (!answer) {
    shimLog('gh-argv.jsonl', { tag: 'UNHANDLED', argv });
    process.stderr.write(`gh-shim: no canned response for: ${argv.join(' ').slice(0, 300)}\n`);
    process.exitCode = 97;
    return;
  }
  // The plugin's own rule; its os.tmpdir() reads the sandbox TMPDIR this shim runs under.
  const { sessionTmpRoot } = require(path.join(REPO, 'plugin', 'bin', 'lib', 'session-tmp.js'));
  applyEffect(answer.effect, sessionTmpRoot(process.env.CLAUDE_CODE_SESSION_ID));
  shimLog('gh-argv.jsonl', { tag: answer.status ? 'injected' : 'ok', argv });
  process.stdout.write(answer.stdout);
  process.stderr.write(answer.stderr);
  process.exitCode = answer.status;
}

// The only `-c` key the shim lets through: core.quotePath, the one key any plugin call path sets
// (review-context's). Every other key is refused, because a deny-list of the keys that run a
// command or move git's view off the sandbox always misses one (include.path pulls in a config
// file that can set any of them; remote.<name>.receivepack runs a program on push).
const ALLOWED_CONFIG_KEYS = new Set(['core.quotepath']);
const refusedConfig = (setting) => !ALLOWED_CONFIG_KEYS.has(setting.split('=')[0].toLowerCase());

function gitShim(table) {
  const argv = process.argv.slice(2);
  const cwd = process.cwd();
  const refuse = (why) => {
    shimLog('git-argv.jsonl', { tag: 'REFUSED', why, cwd, argv });
    process.stderr.write(`git-shim: refused (${why}): ${argv.join(' ').slice(0, 300)}\n`);
    process.exitCode = 97;
  };
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE) return refuse('GIT_DIR/GIT_WORK_TREE set');
  const parsed = gitSubArgv(argv);
  if (parsed.unknown) return refuse(`unknown global option ${parsed.unknown}`);
  const badConfig = parsed.configs.find(refusedConfig);
  if (badConfig !== undefined) return refuse(`config key not allowed: ${badConfig.split('=')[0]}`);
  // Each -C resolves against the one before it, as git does.
  const dirs = [cwd];
  for (const dir of parsed.dirs) dirs.push(path.resolve(dirs[dirs.length - 1], dir));
  for (const dir of dirs) {
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return refuse(`unresolvable directory ${dir}`);
    }
    if (real !== table.root && !real.startsWith(table.root + path.sep)) return refuse(`outside the sandbox: ${real}`);
  }
  const { sub } = parsed;
  if (gitFailMatch(table.git.fail, sub)) {
    shimLog('git-argv.jsonl', { tag: 'injected', cwd, argv });
    process.stderr.write(`git-shim: injected failure: ${sub.join(' ')}\n`);
    process.exitCode = 128;
    return undefined;
  }
  if (isGetUrlOrigin(sub)) {
    shimLog('git-argv.jsonl', { tag: 'canned', cwd, argv });
    process.stdout.write(table.git.remoteUrl + '\n');
    return undefined;
  }
  const r = spawnSync(table.realGit, argv, { stdio: 'inherit', env: process.env });
  shimLog('git-argv.jsonl', { tag: 'delegated', status: r.status, cwd, argv });
  process.exitCode = r.status === null ? 1 : r.status;
  return undefined;
}

// No args: <TMPDIR>/tmp.qp<8-digit counter>, the counter read from and written back to
// QP_TMPNAME_COUNTER_FILE (absent = 0) -- the format deps.tmpName emits under the same env var.
function mktempShim() {
  const args = process.argv.slice(2);
  const { TMPDIR, QP_TMPNAME_COUNTER_FILE: counterFile } = process.env;
  const refuse = (why) => {
    process.stderr.write(`mktemp-shim: refused (${why}): ${args.join(' ')}\n`);
    process.exitCode = 97;
  };
  if (args.length) return refuse('arguments are not supported');
  if (!TMPDIR || !counterFile) return refuse('TMPDIR and QP_TMPNAME_COUNTER_FILE are required');
  const stored = readOrNull(counterFile);
  const n = stored === null ? 0 : Number(stored);
  if (!Number.isSafeInteger(n) || n < 0) return refuse(`counter file holds ${JSON.stringify(stored)}`);
  const file = path.join(TMPDIR, `tmp.qp${String(n + 1).padStart(8, '0')}`);
  fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(counterFile, String(n + 1));
  process.stdout.write(file + '\n');
  return undefined;
}

function shimMain(kind) {
  if (kind === 'mktemp') return mktempShim();
  const table = JSON.parse(fs.readFileSync(process.env.QP_SHIM_TABLE, 'utf8'));
  if (kind === 'gh') return ghShim(table);
  if (kind === 'git') return gitShim(table);
  throw new Error(`unknown shim ${kind}`);
}

module.exports = {
  REPO, SCRIPT_MD, MCP_MD, FENCE_FIRST_LINE, RUN_DIR_NAME,
  findBash, oracleSkip, extractFence, fenceSessionFiles, sessionFileNames, filesOracleScript,
  createSandbox, runOracle, runModuleCli, runPair, withEscapeGuard, normalize, reported, assertParity, runAll, failedJobs, shimMain,
  STREAM_TRUNCATED, TAIL_LINES,
};
