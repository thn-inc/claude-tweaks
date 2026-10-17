#!/usr/bin/env node
// bin/preflight-records.js — record pre-flight JSON in one command.
//   node bin/preflight-records.js <n> [<n> ...] [--work-links native|body-text] [--repo owner/name] [--merge-gate] [--waves] [--integration-branch <name>] [--records-json <path>] [--help]
// Fetches every record (`gh issue view`), derives facets/keyFiles/fingerprint
// (bin/lib/issues/record.js, bin/lib/issues/grouping.js), resolves blockedBy
// either from the body (work-links: body-text, no extra call) or one batched
// GraphQL call (work-links: native — the deps-resolved policy value unless
// --work-links overrides it), and groups records sharing key files
// (groupByFileOverlap). Mechanizes skills/flow/materialize.md's Resolution +
// blocked-by bullet and skills/flow/multi-spec.md's Validation steps 1-5.
// Prints one JSON envelope: { records, overlapGroups, workLinks }.
// --merge-gate (#2733) treats the positional numbers as one /flow run's
// targets and adds mergeGate {gates, deferred, kept, rerun}
// (bin/lib/preflight-records/merge-gate.js). --integration-branch <name>
// (default 'main') is consumed only with --merge-gate, naming the branch the
// gate's regex looks for.
// --waves (#2677) adds waves {waves, parallel} — the opt-in multi-spec parallel-wave plan (bin/lib/preflight-records/waves.js).
// --records-json <path> (#3351) is the gh-free input: a JSON array of the
// requested records ({number, title, body, labels}, labels as {name} objects or
// bare strings), fetched by the caller over another transport — the path a
// gh-absent cloud sandbox takes, where every gh call would exit 1. No gh call is
// made at all, so work-links: native cannot be honored: it degrades to
// body-text (blockedBy read from the record bodies, workLinks reported as
// 'body-text'), a stderr line says so, and the envelope gains
// nativeLinksUnchecked: true (the key is absent on every other run). Every
// --records-json input problem (unreadable, not JSON, wrong shape, a requested
// number missing/duplicated/extra) is exit 2 — this path never exits 1.
// Exit 0 success; 1 any record fetch (or the native dependency GraphQL call)
// failed — every failing record named, all-at-once; 2 malformed invocation
// (no numbers, non-positive, unresolvable owner/repo under native mode, a bad
// --records-json), or a --waves dependency cycle among the requested records.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const preflight = require('./lib/preflight-records/preflight-records');
const { planMergeGateSplit } = require('./lib/preflight-records/merge-gate');
const { planParallelWaves } = require('./lib/preflight-records/waves');
const { resolvePolicyKeys } = require('./lib/policy-schema');
const { parseRepo, repoResolutionNote } = require('./lib/repo-resolve');

const USAGE = 'usage: preflight-records.js <n> [<n> ...] [--work-links native|body-text] [--repo owner/name] [--merge-gate] [--waves] [--integration-branch <name>] [--records-json <path>] [--help]\n';

function parseArgs(argv) {
  const opts = {
    numbers: [], workLinks: null, repo: null, mergeGate: false, waves: false, integrationBranch: null, recordsJson: null, help: false,
  };
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
    } else if (a === '--merge-gate') {
      opts.mergeGate = true;
    } else if (a === '--waves') {
      opts.waves = true;
    } else if (a === '--integration-branch') {
      const v = next();
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: 'missing value for --integration-branch' };
      opts.integrationBranch = v;
    } else if (a === '--records-json') {
      const v = next();
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: 'missing value for --records-json' };
      opts.recordsJson = v;
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
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true }).trim();
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
  remoteUrl: () => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true }),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
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

// The deps-resolved work-links value, --work-links overriding it. Never throws.
function resolveWorkLinks(opts, deps) {
  if (opts.workLinks) return opts.workLinks;
  try {
    return deps.resolveWorkLinks();
  } catch {
    return 'body-text';
  }
}

// The gh path: fetch every record, then (work-links: native) one batched
// GraphQL call. -> { issues, workLinks, dependencies } | { code }.
function loadFromGh(opts, numbers, deps) {
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
    return { code: 1 };
  }

  const workLinks = resolveWorkLinks(opts, deps);

  let dependencies = null;
  if (workLinks === 'native') {
    if (!repoSpec) { deps.stderr('preflight-records.js: could not resolve owner/repo — pass --repo owner/name\n'); return { code: 2 }; }
    try {
      dependencies = preflight.fetchNativeDependencies({
        numbers, owner: repoSpec.owner, repo: repoSpec.repo, host: repoSpec.host, runner: deps.runner,
      });
    } catch (err) {
      deps.stderr(`preflight-records.js: ${preflight.errorText(err)}\n`);
      return { code: 1 };
    }
  }
  return { issues, workLinks, dependencies };
}

// #3351: the gh-free path — no repo resolution, no fetch, no GraphQL. Every
// input problem is exit 2, never 1. Under work-links: native the dependency
// call cannot run, so it degrades to body-text and says so (stderr line plus
// nativeLinksUnchecked on the envelope).
// -> { issues, workLinks, dependencies, nativeLinksUnchecked } | { code }.
function loadFromRecordsJson(opts, numbers, deps) {
  let text;
  try {
    text = deps.readFile(opts.recordsJson);
  } catch (err) {
    deps.stderr(`preflight-records.js: cannot read --records-json ${opts.recordsJson}: ${preflight.errorText(err)}\n`);
    return { code: 2 };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    deps.stderr(`preflight-records.js: --records-json ${opts.recordsJson} is not valid JSON: ${preflight.errorText(err)}\n`);
    return { code: 2 };
  }
  const parsed = preflight.issuesFromRecordsJson(raw, numbers);
  if (parsed.error) {
    deps.stderr(`preflight-records.js: ${parsed.error}\n`);
    return { code: 2 };
  }

  let workLinks = resolveWorkLinks(opts, deps);
  const nativeLinksUnchecked = workLinks === 'native';
  if (nativeLinksUnchecked) {
    deps.stderr('preflight-records.js: --records-json makes no gh call — native blocked-by links unchecked; blockedBy read from record bodies (work-links: body-text)\n');
    workLinks = 'body-text';
  }
  return {
    issues: parsed.ok, workLinks, dependencies: null, nativeLinksUnchecked,
  };
}

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

  // The two input paths — gh (fetch every record) and --records-json (#3351,
  // no gh at all) — feed the one shared tail below.
  const loaded = opts.recordsJson ? loadFromRecordsJson(opts, numbers, deps) : loadFromGh(opts, numbers, deps);
  if (loaded.code !== undefined) return loaded.code;
  const {
    issues, workLinks, dependencies, nativeLinksUnchecked,
  } = loaded;

  const records = preflight.buildRecords({ issues, dependencies });
  const overlapGroups = preflight.buildOverlapGroups(records);
  const envelope = { records, overlapGroups, workLinks };
  if (nativeLinksUnchecked) envelope.nativeLinksUnchecked = true;
  if (opts.mergeGate) envelope.mergeGate = planMergeGateSplit({ issues, records, numbers, integrationBranch: opts.integrationBranch || 'main' });
  if (opts.waves) {
    try {
      envelope.waves = planParallelWaves({ records, numbers });
    } catch (err) {
      if (!/^dependency cycle through #/.test(err && err.message)) throw err;
      deps.stderr(`preflight-records.js: ${err.message}\n`);
      return 2;
    }
  }
  deps.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
  return 0;
}

module.exports = { run, parseArgs, parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
