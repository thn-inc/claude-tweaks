#!/usr/bin/env node
// bin/read-claims.js — the claims-registry blob read for item 10 of
// _shared/github-pr-scan.md (#4818). One batched git read of the `claims/`
// keyspace on `claims-registry` — a fetch into a scratch ref, `ls-tree` and
// `cat-file --batch` (readClaimBlobsGitBatch, bin/lib/issues/claims-git-cas.js) —
// classified per blob, so a read that fails is a visible `could-not-read` row
// and never an absent claim.
//
// Usage: read-claims.js [--remote <name>] [--help]   (default remote `origin`)
// Runs from the repo checkout (git uses the process cwd). One JSON object per
// line on stdout, sorted by issue number:
//   {"number":N,"state":"live|stale|tombstone|unreadable","claimedAt":"..."}
//     one per blob read; `state` is classifyClaimBlob's vocabulary; `claimedAt`
//     present when the blob parses as an object carrying it
//   {"number":N,"state":"could-not-read","reason":"transport-failure"}
//     a blob the batched read could not fetch
//   {"number":null,"state":"could-not-read","reason":"transport-failure"}
//     the registry itself could not be read; the only row printed
// Exit 0 read (including an empty or absent registry, which prints no rows, and
// per-blob could-not-read rows); 1 malformed invocation; 3 the registry could
// not be read — the registry row is still printed, and a one-line
// `read-claims.js:` message names the failure on stderr.
'use strict';

const { classifyClaimBlob } = require('./lib/issues/claims');
const {
  CLAIMS_BRANCH, classifyGitError, defaultRunner, errText, readClaimBlobsGitBatch,
} = require('./lib/issues/claims-git-cas');
const { isTimeoutError } = require('./lib/shared-primitives');

const USAGE = 'usage: read-claims.js [--remote <name>] [--help]\n';

function parseArgs(argv) {
  const o = { remote: 'origin', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--remote') {
      const v = argv[++i];
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: '--remote needs a remote name' };
      o.remote = v;
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  runner: defaultRunner,
  now: () => Date.now(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function claimedAtOf(content) {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.claimedAt === 'string') {
      return { claimedAt: parsed.claimedAt };
    }
  } catch { /* unparseable: no claimedAt */ }
  return {};
}

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (opts.error) { deps.stderr(`read-claims.js: ${opts.error}\n${USAGE}`); return 1; }

  const scratchRef = `refs/claims-scan-read/${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const rows = [];
  let code = 0;
  const registryFailure = (detail, timedOut) => {
    rows.push({ number: null, state: 'could-not-read', reason: 'transport-failure', ...(timedOut ? { timedOut: true } : {}) });
    deps.stderr(`read-claims.js: could not read claims-registry: ${detail}\n`);
    code = 3;
  };
  try {
    deps.runner(['fetch', '-q', opts.remote, `${CLAIMS_BRANCH}:${scratchRef}`]);
    const tip = deps.runner(['rev-parse', scratchRef]).trim();
    const batch = readClaimBlobsGitBatch({ tip, runner: deps.runner });
    if (batch.failure) {
      registryFailure(batch.failure, batch.timedOut);
    } else {
      const now = deps.now();
      for (const n of Object.keys(batch.results).map(Number).sort((a, b) => a - b)) {
        const r = batch.results[n];
        if (r.failure) {
          rows.push({ number: n, state: 'could-not-read', reason: r.failure });
        } else if (!r.absent) {
          rows.push({ number: n, state: classifyClaimBlob(r.content, now).state, ...claimedAtOf(r.content) });
        }
      }
    }
  } catch (err) {
    if (classifyGitError(err).kind === 'missing-branch') return 0;
    registryFailure(errText(err).split('\n')[0], isTimeoutError(err));
  } finally {
    try { deps.runner(['update-ref', '-d', scratchRef]); } catch { /* best-effort cleanup — never mask the read's own outcome */ }
  }
  for (const row of rows) deps.stdout(`${JSON.stringify(row)}\n`);
  return code;
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
