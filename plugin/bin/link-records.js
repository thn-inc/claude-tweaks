#!/usr/bin/env node
// bin/link-records.js — /specify Step 4 native linking in one command.
//   node bin/link-records.js --parent <n> --subs <n,n,...> [--blocked-by "<dependent:blocker>,..."] [--repo owner/name] [--help]
// One GraphQL databaseId batch (every number appearing in --parent/--subs/--blocked-by),
// then the sub_issues + blocked_by POSTs via bin/lib/issues/link.js. Prints one JSON
// envelope. Exit 0 on success or partial-with-`failed` (the caller reads `failed`);
// 1 when databaseId resolution fails; 2 on a malformed invocation or when `gh` is
// absent — these two endpoints have no GitHub MCP equivalent, so the fallback is
// `work-links: body-text` (record-creation.md Step 4's text-based linking).
'use strict';

const { execFileSync } = require('child_process');
const link = require('./lib/issues/link');
const { invalidateSnapshot } = require('./lib/issues/record-snapshot');
const { parseRepo, ghAvailable } = require('./lib/repo-resolve');

const USAGE = 'usage: link-records.js [--parent <n> --subs <n,n,...>] [--blocked-by "<dependent:blocker>,..."] [--repo owner/name] [--help]\n       at least one of --parent+--subs or --blocked-by is required\n';

const isPos = (n) => Number.isInteger(n) && n > 0;

function parseArgs(argv) {
  const opts = { parent: null, subs: [], blockedBy: [], repo: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--parent') opts.parent = Number(next());
    else if (a === '--subs') opts.subs = String(next() || '').split(',').filter(Boolean).map(Number);
    else if (a === '--blocked-by') {
      const pairs = String(next() || '').split(',').filter(Boolean);
      const blockedBy = [];
      for (const pair of pairs) {
        const halves = pair.split(':');
        if (halves.length !== 2 || halves[0] === '' || halves[1] === '') {
          return { error: 'malformed --blocked-by pair: ' + pair };
        }
        const [dependent, blocker] = halves.map(Number);
        blockedBy.push({ dependent, blocker });
      }
      opts.blockedBy = blockedBy;
    }
    else if (a === '--repo') { const v = next(); if (!v || v.startsWith('--')) return { error: 'missing value for --repo' }; opts.repo = v; }
    else return { error: `unknown argument: ${a}` };
  }
  return opts;
}

const realDeps = {
  runner: link.defaultRunner,
  ghAvailable,
  remoteUrl: () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }),
  invalidateSnapshot,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch gh or git.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  const hasSubs = opts.parent !== null || opts.subs.length > 0;
  const hasEdges = opts.blockedBy.length > 0;
  const subsBad = hasSubs && (!isPos(opts.parent) || opts.subs.length === 0 || opts.subs.some((n) => !isPos(n)));
  const edgesBad = opts.blockedBy.some((e) => !isPos(e.dependent) || !isPos(e.blocker));
  const bad = (!hasSubs && !hasEdges) || subsBad || edgesBad;
  if (bad) { deps.stderr(USAGE); return 2; }
  if (!deps.ghAvailable()) {
    deps.stderr('link-records.js: `gh` is required — the sub_issues and dependencies/blocked_by endpoints have no GitHub MCP equivalent. Fall back to work-links: body-text (record-creation.md Step 4).\n');
    return 2;
  }
  // remoteUrl() throws outside a git repo or without an `origin` remote — treat that
  // exactly like an unparseable remote so the friendly exit-2 message below fires
  // instead of an uncaught stack trace colliding with the exit-1 contract.
  let remote = null;
  if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  const repoSpec = opts.repo ? parseRepo(`github.com/${opts.repo}`) : parseRepo(remote);
  if (!repoSpec) { deps.stderr('link-records.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
  const { owner, repo } = repoSpec;
  // #1443: parseRepo's regex accepts any non-'/' owner/repo segment, including '.'/'..'
  // (#1153 review finding). link.linkSubIssues/linkBlockedBy build a `repos/${owner}/${repo}/
  // issues/.../sub_issues|dependencies/blocked_by` REST path via direct string interpolation
  // rather than gh's bound-variable mechanism, so a crafted --repo value reaches that path
  // string. Reject it here rather than narrowing the shared parseRepo, which 8 other CLIs also
  // call — same guard shape as fetch-sub-issues.js's own #1153 fix.
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    deps.stderr('link-records.js: invalid --repo value — owner/repo cannot be "." or ".."\n');
    return 2;
  }
  const numbers = [...(hasSubs ? [opts.parent, ...opts.subs] : []), ...opts.blockedBy.flatMap((e) => [e.dependent, e.blocker])];
  let ids;
  try {
    ids = link.resolveDatabaseIds({ owner, repo, numbers, runner: deps.runner });
  } catch (err) {
    deps.stderr(`link-records.js: ${err.message}\n`);
    return 1;
  }
  const subIssues = hasSubs
    ? link.linkSubIssues({ owner, repo, parent: opts.parent, subs: opts.subs, ids, runner: deps.runner })
    : { ok: [], failed: [] };
  // A successful sub_issues link write changes the same parent/sub-issue facts
  // _shared/trust-table.md's native branch caches in the session-scoped sub-issues
  // snapshot — invalidate it so the next read re-fetches instead of serving a stale
  // set for the rest of the TTL (#1097).
  if (subIssues.ok.length > 0) deps.invalidateSnapshot(process.env.CLAUDE_CODE_SESSION_ID);
  const blockedBy = link.linkBlockedBy({ owner, repo, edges: opts.blockedBy, ids, runner: deps.runner });
  const idsObj = {}; for (const [n, id] of ids) idsObj[String(n)] = id;
  deps.stdout(JSON.stringify({ repo: `${owner}/${repo}`, ids: idsObj, subIssues, blockedBy }, null, 2) + '\n');
  return 0;
}

module.exports = { run, parseArgs, parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
