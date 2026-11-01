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
// line on stdout:
//   {"number":N,"state":"live|stale|tombstone|unreadable","claimedAt":"..."}
//     one per blob read, sorted by issue number; `state` is classifyClaimBlob's
//     (claims.js); `claimedAt` is present when the blob parses as an object
//     carrying a string claimedAt
//   {"number":N,"state":"could-not-read","reason":"transport-failure"}
//     a blob the batched read could not fetch
//   {"number":null,"state":"complete","count":C}
//     the terminator, the last line of every exit-0 read; C is the blob rows
//     printed (0 for an empty or missing registry)
// Exit 0 read; 1 malformed invocation; 3 the registry could not be read. On exit 3
// the only stdout line is the registry row {"number":null,"state":"could-not-read",
// "reason":"transport-failure"} (with "timedOut":true for a timeout), there is no
// terminator, and a one-line `read-claims.js:` message names the failure on stderr.
// Consumers treat a claims file with neither a `complete` row nor a registry
// could-not-read row as unread: an interpreter that dies before run() leaves it empty.
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
      // A leading dash of either kind would reach `git fetch` as an option, not a remote.
      if (typeof v !== 'string' || !v.trim() || v.startsWith('-')) return { error: '--remote needs a remote name' };
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

// The claimedAt read. null for anything that is not a JSON object.
function parseBlob(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The line that names why git failed: its own first stderr line (403, auth, network),
// since an execFileSync error's message line is only "Command failed: git fetch ...".
function failureDetail(err) {
  const stderrLine = String((err && err.stderr) || '').split('\n').map((l) => l.trim()).find(Boolean);
  return stderrLine || errText(err).split('\n')[0];
}

function line(row) {
  return `${JSON.stringify(row)}\n`;
}

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (opts.error) { deps.stderr(`read-claims.js: ${opts.error}\n${USAGE}`); return 1; }

  const scratchRef = `refs/claims-scan-read/${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const blobRows = [];
  let failure = null;
  try {
    deps.runner(['fetch', '-q', opts.remote, `${CLAIMS_BRANCH}:${scratchRef}`]);
    const tip = deps.runner(['rev-parse', scratchRef]).trim();
    const batch = readClaimBlobsGitBatch({ tip, runner: deps.runner });
    if (batch.failure) {
      failure = { detail: batch.failure, timedOut: Boolean(batch.timedOut) };
    } else {
      const now = deps.now();
      for (const n of Object.keys(batch.results).map(Number).sort((a, b) => a - b)) {
        const r = batch.results[n];
        if (r.failure) {
          blobRows.push({ number: n, state: 'could-not-read', reason: r.failure });
        } else if (!r.absent) {
          const parsed = parseBlob(r.content);
          const claimedAt = parsed && typeof parsed.claimedAt === 'string' ? { claimedAt: parsed.claimedAt } : {};
          blobRows.push({ number: n, state: classifyClaimBlob(r.content, now).state, ...claimedAt });
        }
      }
    }
  } catch (err) {
    // A remote with no claims-registry branch is an empty registry, not a failure.
    if (classifyGitError(err).kind !== 'missing-branch') {
      failure = { detail: failureDetail(err), timedOut: isTimeoutError(err) };
    }
  } finally {
    try { deps.runner(['update-ref', '-d', scratchRef]); } catch { /* best-effort cleanup — never mask the read's own outcome */ }
  }

  if (failure) {
    deps.stdout(line({
      number: null, state: 'could-not-read', reason: 'transport-failure', ...(failure.timedOut ? { timedOut: true } : {}),
    }));
    deps.stderr(`read-claims.js: could not read claims-registry: ${failure.detail}\n`);
    return 3;
  }
  for (const row of blobRows) deps.stdout(line(row));
  deps.stdout(line({ number: null, state: 'complete', count: blobRows.length }));
  return 0;
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
