// bin/lib/ports/cli.js — argv parsing and dispatch for bin/ports.js.
// run(argv, deps) seam per this repo's gh-api-module-pattern CLI wrapper
// contract (bin/stage-item.js is the closest sibling). Exit codes: 0
// success, 2 malformed invocation, 3 pool exhausted, 4 registry unwritable
// (write failure after the lock is held, or the lock itself timed out).
'use strict';

const os = require('os');
const { runGit } = require('../hooks/git-exec');
const { allocate, release, status } = require('./registry');
const { serviceVars, leaseVars } = require('./env-file');

const USAGE = 'usage: ports.js <allocate|status|release|env> [--path P] [--services a,b,c]\n';
const COMMANDS = ['allocate', 'status', 'release', 'env'];

function parseArgs(argv) {
  const o = { command: null, path: null, services: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--path') o.path = next();
    else if (a === '--services') o.services = next();
    else if (!a.startsWith('--') && !o.command) o.command = a;
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

// "a, b ,c" -> ['a','b','c']; blank/whitespace-only entries dropped.
function parseServices(raw) {
  if (raw == null) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const realDeps = {
  home: () => os.homedir(),
  resolvePath: (cwd) => {
    const { stdout, failure } = runGit(['rev-parse', '--show-toplevel'], cwd);
    return failure ? null : stdout;
  },
  cwd: () => process.cwd(),
  allocate,
  release,
  status,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

async function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`ports.js: ${message}\n${USAGE}`); return 2; };

  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!COMMANDS.includes(o.command)) {
    return usageError(`unknown command: ${JSON.stringify(o.command)} (expected ${COMMANDS.join('|')})`);
  }

  let services = [];
  if (o.services != null && o.services.trim() !== '') {
    services = parseServices(o.services);
    if (services.length === 0) return usageError(`--services must be a non-empty comma-separated list: ${JSON.stringify(o.services)}`);
  }

  const targetPath = o.path || deps.resolvePath(deps.cwd());
  if (!targetPath) return usageError('--path was not given and could not be inferred (not inside a git repo)');

  const home = deps.home();

  try {
    if (o.command === 'allocate') {
      const result = await deps.allocate(targetPath, { services, home });
      if (result.envWriteError) {
        deps.stderr(`ports.js: could not write env file(s) (${result.envWriteError}) — lease recorded in the registry regardless\n`);
      }
      deps.stdout(`${result.base}\n`);
      return 0;
    }
    if (o.command === 'release') {
      deps.release(targetPath, { home });
      return 0;
    }
    if (o.command === 'status') {
      const reg = deps.status({ home });
      deps.stdout(`${JSON.stringify(reg, null, 2)}\n`);
      return 0;
    }
    if (o.command === 'env') {
      const reg = deps.status({ home });
      const entry = Object.entries(reg.leases || {}).find(([, lease]) => lease.path === targetPath);
      if (!entry) return 0; // no lease for this path — nothing to report, not an error
      const [base, lease] = entry;
      const baseNum = Number(base);
      for (const [k, v] of [...leaseVars(baseNum), ...serviceVars(lease.services, baseNum)]) deps.stdout(`${k}=${v}\n`);
      return 0;
    }
  } catch (err) {
    if (err && err.code === 'PORTS_EXHAUSTED') {
      deps.stderr('ports.js: pool exhausted — no free block available\n');
      return 3;
    }
    deps.stderr(`ports.js: registry unwritable (${(err && err.message) || err})\n`);
    return 4;
  }
  return 2;
}

module.exports = { run, parseArgs, parseServices };
