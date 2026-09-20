#!/usr/bin/env node
// bin/preflight-records.js — record pre-flight JSON in one command.
//   node bin/preflight-records.js <n> [<n> ...] [--work-links native|body-text] [--repo owner/name] [--help]
// Fetches every record (`gh issue view`), derives facets/keyFiles/fingerprint
// (bin/lib/issues/record.js, bin/lib/issues/grouping.js), resolves blockedBy
// either from the body (work-links: body-text, no extra call) or one batched
// GraphQL call (work-links: native — the deps-resolved policy value unless
// --work-links overrides it), and groups records sharing key files
// (groupByFileOverlap). Mechanizes skills/flow/materialize.md's Resolution +
// blocked-by bullet and skills/flow/multi-spec.md's Validation steps 1-5.
// Prints one JSON envelope: { records, overlapGroups, workLinks }.
// Exit 0 success; 1 any record fetch (or the native dependency GraphQL call)
// failed — every failing record named, all-at-once; 2 malformed invocation
// (no numbers, non-positive, unresolvable owner/repo under native mode).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const preflight = require('./lib/preflight-records/preflight-records');
const { resolvePolicyKeys } = require('./lib/policy-schema');
const { parseRepo, repoResolutionNote } = require('./lib/repo-resolve');

const USAGE = 'usage: preflight-records.js <n> [<n> ...] [--work-links native|body-text] [--repo owner/name] [--help]\n';

function parseArgs(argv) {
  const opts = { numbers: [], workLinks: null, repo: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--work-links') {
      const v = next();
      if (v !== 'native' && v !== 'body-text') return { error: `--work-links must be "native" or "body-text" (got "${v}")` };
      opts.workLinks = v;
    } else if (a === '--repo') {
      const v = next();
      if (!v || v.startsWith('--')) return { error: 'missing value for --repo' };
      opts.repo = v;
    } else if (a.startsWith('--')) {
      return { error: `unknown argument: ${a}` };
    } else {
      opts.numbers.push(a);
    }
  }
  return opts;
}

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

const realDeps = {
  runner: preflight.defaultRunner,
  remoteUrl: () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }),
  // The deps-resolved work-links policy value (--work-links overrides this).
  // Never throws: readFileSafe swallows a missing/unreadable policy.yml,
  // repoRoot falls back to cwd outside a git repo, and resolvePolicyKeys is
  // pure — the schema default ('body-text') is what a totally unconfigured
  // project resolves to.
  resolveWorkLinks: () => {
    const policyRaw = readFileSafe(path.join(repoRoot(), '.claude-tweaks', 'policy.yml'));
    return resolvePolicyKeys(['work-links'], { policyRaw, runConfigRaw: null })['work-links'].value;
  },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch gh or git.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (opts.numbers.length === 0) { deps.stderr(USAGE); return 2; }

  const numbers = opts.numbers.map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n <= 0)) {
    deps.stderr(`preflight-records.js: every argument must be a positive integer issue number\n${USAGE}`);
    return 2;
  }

  // #2538: derive repo/host ONCE, before any gh call — both fetchIssues
  // (unconditional, every mode) and the native-mode dependency check below
  // need it. Resolution failure is non-fatal here (body-text mode's bare
  // `gh issue view` calls already work fine with no --repo on the ordinary
  // github.com case) — only work-links: native hard-requires a resolved
  // repo, at its own existing gate below, unchanged.
  let remote = null;
  if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  const repoSpec = parseRepo(opts.repo ? (opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`) : remote);
  const repoNote = repoResolutionNote(repoSpec);
  if (repoNote) deps.stderr(`preflight-records.js: ${repoNote}\n`);

  const { ok: issues, failed } = preflight.fetchIssues({
    numbers,
    owner: repoSpec && repoSpec.owner,
    repo: repoSpec && repoSpec.repo,
    host: repoSpec && repoSpec.host,
    runner: deps.runner,
  });
  if (failed.length > 0) {
    const names = failed.map((f) => `#${f.number} (${f.error})`).join(', ');
    deps.stderr(`preflight-records.js: record fetch failed for ${names}\n`);
    return 1;
  }

  let workLinks = opts.workLinks;
  if (!workLinks) {
    try {
      workLinks = deps.resolveWorkLinks();
    } catch {
      workLinks = 'body-text';
    }
  }

  let dependencies = null;
  if (workLinks === 'native') {
    if (!repoSpec) { deps.stderr('preflight-records.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
    try {
      dependencies = preflight.fetchNativeDependencies({
        numbers, owner: repoSpec.owner, repo: repoSpec.repo, host: repoSpec.host, runner: deps.runner,
      });
    } catch (err) {
      deps.stderr(`preflight-records.js: ${preflight.errorText(err)}\n`);
      return 1;
    }
  }

  const records = preflight.buildRecords({ issues, dependencies });
  const overlapGroups = preflight.buildOverlapGroups(records);
  deps.stdout(`${JSON.stringify({ records, overlapGroups, workLinks }, null, 2)}\n`);
  return 0;
}

module.exports = { run, parseArgs, parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
