#!/usr/bin/env node
// bin/preflight-records.js — record pre-flight JSON in one command.
//   node bin/preflight-records.js <n> [<n> ...] [--work-links native|body-text] [--repo owner/name] [--merge-gate] [--waves] [--integration-branch <name>] [--records-json <path>] [--blocker-landing] [--blocker-states-json <path>] [--help]
// Fetches every record (`gh issue view`), derives facets/keyFiles/fingerprint
// (bin/lib/issues/record.js, bin/lib/issues/grouping.js), resolves blockedBy
// either from the body (work-links: body-text, no extra call) or one batched
// GraphQL call (work-links: native — the deps-resolved policy value unless
// --work-links overrides it), and groups records sharing key files
// (groupByFileOverlap, transitive) and lists each directly-overlapping pair
// with its shared files (directOverlaps, #3278). Mechanizes
// skills/flow/materialize.md's Resolution + blocked-by bullet and
// skills/flow/multi-spec.md's Validation steps 1-5.
// Prints one JSON envelope: { records, overlapGroups, directOverlaps, workLinks }.
// --merge-gate (#2733) treats the positional numbers as one /flow run's
// targets and adds mergeGate {gates, deferred, kept, rerun}
// (bin/lib/preflight-records/merge-gate.js). --integration-branch <name>
// (default 'main') is consumed by --merge-gate (the branch its regex looks for)
// and --blocker-landing (the branch a blocker's closing commit must reach).
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
// --blocker-landing (#4553) adds records[n].blockerLanding [{blocker, verdict,
// commit, via}] — for each record, the landing verdict of every blocker that is
// NOT one of the positional numbers (an in-run blocker is ordered by the DAG,
// never judged here), in blockedBy order, [] when none; the verdicts are
// bin/lib/preflight-records/blocker-landing.js's. One batched GraphQL call plus
// one REST compare per distinct candidate commit; none when no record has an
// out-of-run blocker. Under --records-json no such call can run, so every
// out-of-run blocker reads undetermined/records-json (one stderr line says so)
// unless --blocker-states-json <path> — a JSON object keyed by blocker number
// to the {state, stateReason|state_reason} the caller fetched over another
// transport — supplies the state: open reads open, closed NOT_PLANNED/DUPLICATE
// not-applicable, any other closed undetermined. A compare call that throws
// leaves that blocker undetermined/probe-failed and prints one stderr line (the
// cause — a wrong integration branch, a 403, a rate limit — is otherwise lost).
// The key is absent without the flag, and the rest of the envelope is unchanged.
// Exit 0 success; 1 any record fetch (or the native dependency GraphQL call)
// failed — every failing record named, all-at-once — or, with --blocker-landing,
// the blocker query failed as a whole (never a per-blocker undetermined); 2
// malformed invocation (no numbers, non-positive, unresolvable owner/repo under
// native mode or for --blocker-landing with a non-empty blocker set, a
// --blocker-landing blocker number that is no valid issue number, a bad
// --records-json, --blocker-states-json without both --records-json and
// --blocker-landing, or a bad/incomplete --blocker-states-json), or a --waves
// dependency cycle among the requested records.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const preflight = require('./lib/preflight-records/preflight-records');
const { fetchBlockerLanding, undeterminedAll, classifyFromState } = require('./lib/preflight-records/blocker-landing');
const { planMergeGateSplit } = require('./lib/preflight-records/merge-gate');
const { planParallelWaves } = require('./lib/preflight-records/waves');
const { resolvePolicyKeys } = require('./lib/policy-schema');
const { parseRepo, repoResolutionNote, pinExplicitRepoHost } = require('./lib/repo-resolve');

const USAGE = 'usage: preflight-records.js <n> [<n> ...] [--work-links native|body-text] [--repo owner/name] [--merge-gate] [--waves] [--integration-branch <name>] [--records-json <path>] [--blocker-landing] [--blocker-states-json <path>] [--help]\n';

function parseArgs(argv) {
  const opts = {
    numbers: [], workLinks: null, repo: null, mergeGate: false, waves: false, integrationBranch: null, recordsJson: null, blockerLanding: false, blockerStatesJson: null, help: false,
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
    } else if (a === '--blocker-landing') {
      opts.blockerLanding = true;
    } else if (a === '--blocker-states-json') {
      const v = next();
      if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: 'missing value for --blocker-states-json' };
      opts.blockerStatesJson = v;
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
  // #4505: an explicit --repo's host reaches the native-dependency GraphQL
  // queries, which thread no --hostname for github.com.
  pinGhHost: (repoSpec) => pinExplicitRepoHost(repoSpec),
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
  if (opts.repo && repoSpec && deps.pinGhHost) deps.pinGhHost(repoSpec);
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
  return {
    issues, workLinks, dependencies, repoSpec,
  };
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

// A runner error's text (errorText joins the exec message — which embeds the
// whole GraphQL query — gh's stderr and stdout) -> one bounded line. Keeps the
// head (the command) and the tail (gh's own diagnostic) and drops the middle.
function oneLine(text, max = 400) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const keep = Math.floor((max - 3) / 2);
  return `${flat.slice(0, keep)} … ${flat.slice(-keep)}`;
}

const listBlockers = (numbers) => numbers.map((n) => `#${n}`).join(', ');

// #4553, --records-json path: -> { results: Map<number, result> } | { code }.
// No gh call can run. Without --blocker-states-json every blocker reads
// undetermined (and one stderr line says so); with it, the caller's fetched
// state classifies each (classifyFromState) — a missing/unusable entry, or an
// unreadable/non-object file, is an input problem: exit 2, never 1. The file is
// validated whenever it is passed, even when no record has an out-of-run
// blocker: a path that cannot be read is a caller bug, not an unused input.
function blockerLandingFromRecordsJson(opts, union, deps) {
  if (!opts.blockerStatesJson) {
    if (union.length) {
      deps.stderr(`preflight-records.js: --records-json makes no gh call — blocker landing undetermined for ${listBlockers(union)} (pass --blocker-states-json to judge open blockers)\n`);
    }
    return { results: new Map(undeterminedAll(union, 'records-json').map((r) => [r.blocker, r])) };
  }
  let text;
  try {
    text = deps.readFile(opts.blockerStatesJson);
  } catch (err) {
    deps.stderr(`preflight-records.js: cannot read --blocker-states-json ${opts.blockerStatesJson}: ${preflight.errorText(err)}\n`);
    return { code: 2 };
  }
  let states;
  try {
    states = JSON.parse(text);
  } catch (err) {
    deps.stderr(`preflight-records.js: --blocker-states-json ${opts.blockerStatesJson} is not valid JSON: ${preflight.errorText(err)}\n`);
    return { code: 2 };
  }
  if (!states || typeof states !== 'object' || Array.isArray(states)) {
    deps.stderr('preflight-records.js: --blocker-states-json must be a JSON object keyed by blocker number\n');
    return { code: 2 };
  }
  const results = new Map();
  const unusable = [];
  for (const n of union) {
    const r = classifyFromState(n, states[String(n)]);
    if (r) results.set(n, r); else unusable.push(n);
  }
  if (unusable.length) {
    deps.stderr(`preflight-records.js: --blocker-states-json has no usable state for ${listBlockers(unusable)}\n`);
    return { code: 2 };
  }
  return { results };
}

// #4553, gh path: -> { results } | { code }. An empty blocker set needs no
// repo and no call. A non-empty one with no resolvable owner/repo, or a blocker
// number that is no valid issue number (a `Blocked by #0` body line — a fixed
// input, so a retry could not help), is exit 2 — checked here, before
// fetchBlockerLanding, so neither can surface as the exit-1 query failure; a
// whole-query failure is exit 1 (never per-blocker undetermined), its message
// collapsed to one stderr line. A compare call that threw does not fail the run
// (that blocker reads undetermined), but each gets one stderr line.
function blockerLandingFromGh(opts, union, repoSpec, deps) {
  if (union.length === 0) return { results: new Map() };
  const invalid = union.filter((n) => !(Number.isSafeInteger(n) && n > 0));
  if (invalid.length) {
    deps.stderr(`preflight-records.js: --blocker-landing: not a valid issue number: ${invalid.map(String).join(', ')} — fix the record's Blocked by line\n`);
    return { code: 2 };
  }
  if (!repoSpec) {
    deps.stderr('preflight-records.js: could not resolve owner/repo for --blocker-landing — pass --repo owner/name\n');
    return { code: 2 };
  }
  const { results, error, probeErrors } = fetchBlockerLanding({
    blockers: union,
    owner: repoSpec.owner,
    repo: repoSpec.repo,
    host: repoSpec.host,
    integrationBranch: opts.integrationBranch || 'main',
    runner: deps.runner,
  });
  if (error) {
    deps.stderr(`preflight-records.js: blocker landing query failed: ${oneLine(error)}\n`);
    return { code: 1 };
  }
  for (const { sha, message } of probeErrors || []) {
    deps.stderr(`preflight-records.js: blocker landing compare failed for ${sha}: ${oneLine(message)}\n`);
  }
  return { results };
}

// argv -> exit code. All I/O through deps so tests never touch gh or git.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(opts.error + '\n' + USAGE); return 2; }
  if (opts.help) { deps.stdout(USAGE); return 0; }
  if (opts.blockerStatesJson && !(opts.recordsJson && opts.blockerLanding)) {
    deps.stderr(`preflight-records.js: --blocker-states-json is valid only with both --records-json and --blocker-landing\n${USAGE}`);
    return 2;
  }
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
  const directOverlaps = preflight.buildDirectOverlaps(records);
  const envelope = { records, overlapGroups, directOverlaps, workLinks };
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
  if (opts.blockerLanding) {
    // After every local computation (a --waves cycle is exit 2 before any
    // network call) and before the single stdout write.
    const { byRecord, union } = preflight.outOfRunBlockers(records, numbers);
    const landing = opts.recordsJson
      ? blockerLandingFromRecordsJson(opts, union, deps)
      : blockerLandingFromGh(opts, union, loaded.repoSpec, deps);
    if (landing.code !== undefined) return landing.code;
    for (const n of numbers) records[String(n)].blockerLanding = byRecord.get(n).map((b) => landing.results.get(b));
  }
  deps.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
  return 0;
}

module.exports = { run, parseArgs, parseRepo };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
