#!/usr/bin/env node
// bin/file-feedback.js — argv-safe upstream feedback filing (#681).
//   node bin/file-feedback.js --drafts <path.json> [--repo owner/name] [--dry-run] [--help]
// Reads a JSON array of drafts ({ title, body, labels, fingerprintBasis: {
// component, summary } }), computes each one's dedup fingerprint via
// bin/lib/feedback/file-feedback.js, dedup-searches, files whatever isn't a
// duplicate, reads the created issue back, and verifies the read-back matches
// what was sent — replacing skills/feedback/SKILL.md Step 8's shell recipe,
// which interpolated a model-authored title into a `gh issue create --title
// '<title>'` string and had no read-back verification at all.
//
// Prints one result line per draft, in input order: `filed #{n}` /
// `dedup-hit #{n}` / `filing-failure: {reason}` (dry-run: `would-file
// (fingerprint {fp})` in place of `filed #{n}` — nothing is created).
//
// Exit codes: 0 every draft filed or dedup-hit cleanly (dry-run: every draft
// resolved without a filing-failure); 1 any draft returned filing-failure
// (other drafts still get processed — this is a summary exit code, not
// stop-on-first-failure); 2 malformed invocation (missing --drafts, unreadable
// drafts file, malformed draft entry) or `gh` unavailable — `gh issue
// create`/`issue view`/`issue list` have no GitHub MCP equivalent wired here;
// the fallback is manual filing per skills/feedback/SKILL.md's existing Step 8
// recipe, or skills/_shared/github-write-transport.md's MCP path in a
// gh-absent cloud sandbox (this CLI does not implement an MCP branch itself).
'use strict';

const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const feedback = require('./lib/feedback/file-feedback');
const { parseRepo, ghAvailable } = require('./lib/repo-resolve');

const USAGE = 'usage: file-feedback.js --drafts <path.json> [--repo owner/name] [--dry-run] [--help]\n';

const FALLBACK_MSG =
  'file-feedback.js: `gh` is required — `gh issue create`/`issue view`/`issue list` have no GitHub MCP ' +
  'equivalent wired here. Fall back to manual filing per skills/feedback/SKILL.md\'s existing Step 8 ' +
  'recipe, or skills/_shared/github-write-transport.md\'s MCP path in a gh-absent cloud sandbox.\n';

function parseArgs(argv) {
  const opts = { drafts: null, repo: null, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--drafts') { const v = next(); if (!v || v.startsWith('--')) return { error: 'missing value for --drafts' }; opts.drafts = v; }
    else if (a === '--repo') { const v = next(); if (!v || v.startsWith('--')) return { error: 'missing value for --repo' }; opts.repo = v; }
    else if (a === '--dry-run') opts.dryRun = true;
    else return { error: `unknown argument: ${a}` };
  }
  return opts;
}

// A malformed entry name, or null if the draft is well-formed.
function validateDraft(d, index) {
  if (!d || typeof d !== 'object') return `draft[${index}]: not an object`;
  if (typeof d.title !== 'string' || d.title === '') return `draft[${index}]: missing title`;
  if (typeof d.body !== 'string' || d.body === '') return `draft[${index}]: missing body`;
  if (d.labels !== undefined && !Array.isArray(d.labels)) return `draft[${index}]: labels must be an array`;
  const basis = d.fingerprintBasis;
  if (!basis || typeof basis !== 'object') return `draft[${index}]: missing fingerprintBasis`;
  if (!basis.component) return `draft[${index}]: fingerprintBasis.component is required`;
  if (!basis.summary) return `draft[${index}]: fingerprintBasis.summary is required`;
  return null;
}

const realDeps = {
  // Plain, non-retrying runner — deliberately. `fileOne` (used by the
  // non-dry-run path below) applies retry internally, per call: the dedup
  // search and read-back retry freely (idempotent reads), but the create
  // call goes through feedback.createWithDedupSafeRetry instead of a plain
  // retry, because gh issue create is not idempotent — see that function's
  // doc comment. Wrapping this runner here (as before) would let a
  // transient create failure retry — and possibly duplicate-file — before
  // fileOne's own dedup-safe handling ever saw the failure. The dry-run
  // branch below (a read-only dedup search, no create call) wraps this
  // runner locally instead, since it never calls fileOne.
  runner: feedback.defaultRunner,
  ghAvailable,
  remoteUrl: () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }),
  readDraftsFile: (p) => JSON.parse(fs.readFileSync(p, 'utf8')),
  tmpFile: () => os.tmpdir() + '/feedback-body-' + Date.now() + Math.random() + '.md',
  writeFile: fs.writeFileSync,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O through deps so tests never touch gh, git, or disk.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (!opts.drafts) { deps.stderr('--drafts is required\n' + USAGE); return 2; }

  let drafts;
  try {
    drafts = deps.readDraftsFile(opts.drafts);
  } catch (err) {
    deps.stderr(`file-feedback.js: could not read drafts file: ${err && err.message}\n`);
    return 2;
  }
  if (!Array.isArray(drafts)) { deps.stderr('file-feedback.js: drafts file must contain a JSON array\n'); return 2; }
  for (let i = 0; i < drafts.length; i++) {
    const problem = validateDraft(drafts[i], i);
    if (problem) { deps.stderr(`file-feedback.js: ${problem}\n`); return 2; }
  }

  if (!deps.ghAvailable()) { deps.stderr(FALLBACK_MSG); return 2; }

  let remote = null;
  if (!opts.repo) { try { remote = deps.remoteUrl(); } catch { remote = null; } }
  const repoSpec = opts.repo ? parseRepo(`github.com/${opts.repo}`) : parseRepo(remote);
  if (!repoSpec) { deps.stderr('file-feedback.js: could not resolve owner/repo — pass --repo owner/name\n'); return 2; }
  const repo = `${repoSpec.owner}/${repoSpec.repo}`;

  const lines = [];
  let anyFailure = false;

  for (const draft of drafts) {
    if (opts.dryRun) {
      let fingerprint;
      try {
        fingerprint = feedback.computeFingerprint(draft);
      } catch (err) {
        anyFailure = true;
        lines.push(`filing-failure: ${feedback.errorText(err)}`);
        continue;
      }
      const marker = `<!-- fingerprint: ${fingerprint} -->`;
      try {
        // Read-only search — safe to retry freely, unlike the create path.
        const readRunner = feedback.withTransientRetry(deps.runner, { maxRetries: 4 });
        const hit = feedback.findDuplicate({ repo, marker, runner: readRunner });
        if (hit) lines.push(`dedup-hit #${hit.number}`);
        else lines.push(`would-file (fingerprint ${fingerprint})`);
      } catch (err) {
        // findDuplicate calls deps.runner (a real `gh` call outside tests) — its
        // failure carries the actual diagnostic in .stderr/.stdout, or may not be
        // an Error at all. Plain `err.message` silently drops that (matches the
        // bug errorText() was written to prevent in bin/lib/issues/link.js).
        anyFailure = true;
        lines.push(`filing-failure: ${feedback.errorText(err)}`);
      }
      continue;
    }

    const bodyFile = deps.tmpFile();
    const result = feedback.fileOne({ repo, draft, runner: deps.runner, bodyFile, writeFile: deps.writeFile });
    if (result.status === 'filed') lines.push(`filed #${result.number}`);
    else if (result.status === 'dedup-hit') lines.push(`dedup-hit #${result.number}`);
    else { anyFailure = true; lines.push(`filing-failure: ${result.reason}`); }
  }

  deps.stdout(lines.join('\n') + (lines.length ? '\n' : ''));
  return anyFailure ? 1 : 0;
}

module.exports = { run, parseArgs, parseRepo, validateDraft, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
