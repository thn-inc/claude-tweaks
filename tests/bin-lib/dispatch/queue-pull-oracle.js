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
const { ghAnswer, applyEffect, shimTable } = require('./queue-pull-fixtures');

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
// claim is fixtured), and never health-state: the queue-order cache starts cold.
function seedOrigin(originDir, spec, git) {
  const branches = { main: {}, ...((spec && spec.branches) || {}) };
  if (Object.prototype.hasOwnProperty.call(branches, 'health-state')) {
    throw new Error('scenario.origin.branches never seeds health-state: the queue-order cache starts cold');
  }
  git(['init', '--bare', '-q', '-b', 'main', originDir]);
  for (const [branch, files] of Object.entries(branches)) {
    const all = branch === 'main' ? { 'README.md': 'fixture\n', '.gitignore': '.claude-tweaks/pipelines/\n', ...files } : files;
    const commit = git(['-C', originDir, 'commit-tree', writeTree(originDir, all, git), '-m', `seed ${branch}`]).trim();
    git(['-C', originDir, 'update-ref', `refs/heads/${branch}`, commit]);
  }
}

function writeShims(bin) {
  if (/\s/.test(process.execPath)) {
    throw new Error(`queue-pull oracle: the node path ${process.execPath} holds whitespace, so it cannot stand in a #! line`);
  }
  for (const kind of ['gh', 'git', 'mktemp']) {
    const src = `#!${process.execPath}\n'use strict';\nrequire(${JSON.stringify(__filename)}).shimMain(${JSON.stringify(kind)});\n`;
    fs.writeFileSync(path.join(bin, kind), src, { mode: 0o755 });
  }
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
}

// createSandbox(scenario, { transport, origin, name }) -> sandbox. `origin` is another sandbox's
// origin.git to copy (a cache-hit run after its cache-miss run); scenario.origin is then unused.
function createSandbox(scenario, { transport = 'gh', origin = null, name = scenario.name || 'sandbox' } = {}) {
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
    else seedOrigin(originDir, scenario.origin, git);
    git(['clone', '-q', originDir, proj]);

    const policy = Object.entries(scenario.policy || {}).map(([k, v]) => `${k}: ${v}\n`).join('');
    fs.mkdirSync(path.join(proj, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude-tweaks', 'policy.yml'), policy);
    const runDir = path.join(proj, '.claude-tweaks', 'pipelines', RUN_DIR_NAME);
    fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'decisions.md'), '');

    writeShims(bin);
    fs.writeFileSync(tablePath, JSON.stringify({ ...table, root, realGit }));

    const runEnv = ({ tmpdir, sessionId }) => {
      const env = {
        PATH: [bin, '/usr/bin', '/bin'].join(path.delimiter),
        HOME: home, PWD: proj, OLDPWD: proj, TMPDIR: tmpdir, TZ: 'UTC', LANG: 'C',
        CLAUDE_PLUGIN_ROOT: path.join(REPO, 'plugin').split(path.sep).join('/'),
        CLAUDE_CODE_SESSION_ID: sessionId,
        ...gitIsolation,
        QP_SHIM_TABLE: tablePath, QP_LOG_DIR: logs, QP_TMPNAME_COUNTER_FILE: path.join(logs, 'tmpname-counter'),
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${JSON.stringify(CLOCK_STUB)}`].filter(Boolean).join(' '),
      };
      for (const [k, v] of Object.entries(process.env)) if (k.startsWith('CT_TRACE_')) env[k] = v;
      return env;
    };
    const orderBlob = () => {
      try {
        return JSON.parse(git(['-C', originDir, 'show', 'health-state:queue-order/order.json']));
      } catch {
        return null;
      }
    };
    return {
      name, transport, scenario, root, home, proj, bin, logs, origin: originDir, runDir, runs: 0, runEnv, orderBlob, cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

// --- the bounded run -----------------------------------------------------------

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
  return () => Buffer.concat(chunks).toString('utf8') + (truncated ? '\n[queue-pull oracle: stream truncated at 64 KiB]\n' : '');
}

function spawnBounded(bash, scriptFile, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bash, ['--noprofile', '--norc', '-c', 'ulimit -f 4096; exec "$0" --noprofile --norc "$1"', bash, scriptFile],
      { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

// runOracle(sandbox, script, { sessionId }) -> { status, stdout, stderr, files, staged, decisions,
// orderBlob, ghArgv, gitArgv }, plus a non-enumerable `sandbox`. The session id is derived from
// the sandbox name, so a parity pair's two sandboxes print the same paths after normalize.
async function runOracle(sandbox, script, { sessionId = `qp-${sandbox.name}` } = {}) {
  const bash = findBash();
  if (!bash) throw new Error(oracleSkip());
  return withEscapeGuard(REPO, async () => {
    sandbox.runs += 1;
    const tmpdir = path.join(sandbox.root, 'tmp', `run-${sandbox.runs}`);
    fs.mkdirSync(tmpdir, { recursive: true });
    const scriptFile = path.join(sandbox.root, `queue-pull-${sandbox.runs}.sh`);
    fs.writeFileSync(scriptFile, script);
    for (const log of ['gh-argv.jsonl', 'git-argv.jsonl']) fs.writeFileSync(path.join(sandbox.logs, log), '');

    const run = await spawnBounded(bash, scriptFile, { cwd: sandbox.proj, env: sandbox.runEnv({ tmpdir, sessionId }) });

    const sessionDir = path.join(tmpdir, `ct-session-${sessionId}`);
    const files = {};
    for (const name of sessionFileNames()) files[name] = readOrNull(path.join(sessionDir, name));
    const stagedDir = path.join(sandbox.runDir, 'staged');
    const staged = {};
    for (const name of fs.existsSync(stagedDir) ? fs.readdirSync(stagedDir).sort() : []) {
      staged[name] = fs.readFileSync(path.join(stagedDir, name), 'utf8');
    }
    const result = {
      ...run,
      files,
      staged,
      decisions: readOrNull(path.join(sandbox.runDir, 'decisions.md')),
      orderBlob: sandbox.orderBlob(),
      ghArgv: readJsonl(path.join(sandbox.logs, 'gh-argv.jsonl')),
      gitArgv: readJsonl(path.join(sandbox.logs, 'git-argv.jsonl')),
    };
    Object.defineProperty(result, 'sandbox', { value: sandbox, enumerable: false });
    return result;
  });
}

// The real checkout's HEAD and `git status --porcelain` before and after fn; any change fails
// the run (#4303: an inherited OLDPWD put commits on the live branch).
async function withEscapeGuard(repoRoot, fn) {
  const read = () => ({
    head: fixtureGit(['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
    status: fixtureGit(['--no-optional-locks', '-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  });
  const before = read();
  let outcome;
  try {
    outcome = { value: await fn() };
  } catch (err) {
    outcome = { err };
  }
  const after = read();
  if (after.head !== before.head || after.status !== before.status) {
    throw new Error(`escape guard: ${repoRoot} changed during the run\nHEAD ${before.head} -> ${after.head}\n`
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

// The AUTO and Warning lines AC1 compares on each channel.
function reported(text) {
  return String(text || '').split(/\r?\n/).filter((line) => REPORTED_LINE.test(line));
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
// starts only once that job has finished, and gets its result; independent jobs run up to
// `limit` at a time. The first failure rejects, after the jobs already running settle.
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
  const finished = new Set();
  const errors = [];
  let running = 0;
  return new Promise((resolve, reject) => {
    const pump = () => {
      while (errors.length === 0 && running < slots) {
        const at = pending.findIndex((job) => job.after === undefined || finished.has(job.after));
        if (at === -1) break;
        const [job] = pending.splice(at, 1);
        running += 1;
        Promise.resolve()
          .then(() => job.run(job.after === undefined ? undefined : results[job.after]))
          .then((value) => {
            results[job.name] = value;
            finished.add(job.name);
          }, (err) => {
            errors.push(new Error(`runAll: job ${job.name} failed: ${err && err.message}`, { cause: err }));
          })
          .finally(() => {
            running -= 1;
            pump();
          });
      }
      if (running > 0) return;
      if (errors.length) reject(errors[0]);
      else if (pending.length) reject(new Error(`runAll: jobs that can never start (an after cycle): ${pending.map((j) => j.name).join(', ')}`));
      else resolve(results);
    };
    pump();
  });
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
  const { TMPDIR, CLAUDE_CODE_SESSION_ID: sessionId } = process.env;
  applyEffect(answer.effect, TMPDIR && sessionId ? path.join(TMPDIR, `ct-session-${sessionId.trim()}`) : null);
  shimLog('gh-argv.jsonl', { tag: answer.status ? 'injected' : 'ok', argv });
  process.stdout.write(answer.stdout);
  process.stderr.write(answer.stderr);
  process.exitCode = answer.status;
}

const GIT_GLOBAL_FLAGS = new Set(['--no-optional-locks', '--no-pager', '--literal-pathspecs']);

function gitShim(table) {
  const argv = process.argv.slice(2);
  const cwd = process.cwd();
  const refuse = (why) => {
    shimLog('git-argv.jsonl', { tag: 'REFUSED', why, cwd, argv });
    process.stderr.write(`git-shim: refused (${why}): ${argv.join(' ').slice(0, 300)}\n`);
    process.exitCode = 97;
  };
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE) return refuse('GIT_DIR/GIT_WORK_TREE set');
  const dirs = [cwd];
  let i = 0;
  while (i < argv.length && argv[i].startsWith('-') && argv[i] !== '--version') {
    if (argv[i] === '-C') {
      dirs.push(path.resolve(dirs[dirs.length - 1], argv[i + 1] || ''));
      i += 2;
    } else if (argv[i] === '-c') {
      i += 2;
    } else if (GIT_GLOBAL_FLAGS.has(argv[i])) {
      i += 1;
    } else {
      return refuse(`unknown global option ${argv[i]}`);
    }
  }
  for (const dir of dirs) {
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return refuse(`unresolvable directory ${dir}`);
    }
    if (real !== table.root && !real.startsWith(table.root + path.sep)) return refuse(`outside the sandbox: ${real}`);
  }
  const sub = argv.slice(i);
  if (table.git.fail.some((prefix) => prefix.every((a, k) => sub[k] === a))) {
    shimLog('git-argv.jsonl', { tag: 'injected', cwd, argv });
    process.stderr.write(`git-shim: injected failure: ${sub.join(' ')}\n`);
    process.exitCode = 128;
    return undefined;
  }
  if (sub.length === 3 && sub[0] === 'remote' && sub[1] === 'get-url' && sub[2] === 'origin') {
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
  REPO, SCRIPT_MD, FENCE_FIRST_LINE, RUN_DIR_NAME,
  findBash, oracleSkip, extractFence, fenceSessionFiles, sessionFileNames,
  createSandbox, runOracle, withEscapeGuard, normalize, reported, assertParity, runAll, shimMain,
};
