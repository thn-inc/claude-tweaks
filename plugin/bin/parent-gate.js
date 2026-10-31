#!/usr/bin/env node
// bin/parent-gate.js — the Parent-Gate Procedure's gather and evaluate as one
// command (#4603): Resolve the parent, Enumerate the parent's sub-issues, the
// Self-inclusion rule and Evaluate the gate (wrap-up/verification-brief-parent-gate.md),
// plus the below-floor close's idempotence check. A thin argument-parsing shell over
// bin/lib/issues/parent-gate.js, which the reconciler's below-floor-parent-close.js
// composes too, so the prose and the reconciler run one implementation.
//
// Usage: parent-gate.js (--sub-issue <n> | --parent <n>) [--closing <tok>[,<tok>...]]
//   [--held <n>[,<n>...]] [--merging-pr <n>] [--idempotence] [--work-links native|body-text]
//   [--risk-floor low|medium|high|always] [--help]
//   --closing    N or owner/repo#N; a foreign-repo token is dropped. --sub-issue N without
//                --closing means {N}; --parent without it means {}.
//   --held       sub-issues Step 4.0b's caller has not settled; they come back in `held`.
//   --idempotence  pass only when the caller will run Close the parent below the floor
//                (Step 4.0b, tidy's parent-side entry): it adds the two idempotence reads
//                (the parent's comments and the gh login), and only for a parent that is
//                due below the floor. Without it `idempotence` is null and `skipped` is [].
//   --work-links, --risk-floor  default to .claude-tweaks/policy.yml at the repo root.
//   --backend    github-issues|local-files; defaults to CLAUDE.md's `work-backend:`.
//                local-files is refused until its record reader exists.
//
// Output: one JSON line on stdout, the verdict in the order of VERDICT_FIELDS
// (bin/lib/issues/parent-gate.js): {parent, state, exceeds, closeReason, idempotence,
// maxTier, riskFloor, parentIssue, needs, held, subIssues, skipped}. The verdict is data,
// never an exit code: every `state`, `no-parent` included, is exit 0.
//
// Exit codes (Split-1/2, fetch-sub-issues.js's vocabulary): 0 a verdict was printed;
// 1 a malformed invocation; 2 `gh` is absent, or owner/repo cannot be resolved; 3 a gh
// call failed (the message goes to stderr). On every non-zero exit nothing goes to
// stdout. Only a GhFailure maps to 3: any other throw is a bug and propagates.
//
// There is no `--repo` flag. Owner/repo come from the origin remote, because shapes 1, 3,
// 6 and 7 of the gate's gh calls carry no `--repo` and read the repo of gh's own cwd; an
// override would split one gate's reads across two repositories.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseRepo, ghAvailable, remoteUrl } = require('./lib/repo-resolve');
const { POLICY_KEYS, resolvePolicyKeys } = require('./lib/policy-schema');
const { readWorkBackend } = require('./lib/work-backend');
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives');
const {
  VALID_RISK_FLOORS, VERDICT_FIELDS, GhFailure, ghCaller, gatherGateFacts, gatherIdempotenceFacts,
  evaluateParentGate, evaluateIdempotence, parseClosingTokens,
} = require('./lib/issues/parent-gate');

const USAGE = 'usage: parent-gate.js (--sub-issue <n> | --parent <n>) [--closing <tok>[,<tok>...]] [--held <n>[,<n>...]] [--merging-pr <n>] [--idempotence] [--work-links native|body-text] [--risk-floor low|medium|high|always] [--help]\n';

const WORK_LINKS = POLICY_KEYS.find((k) => k.key === 'work-links').values;
const BACKENDS = ['github-issues', 'local-files'];
const VALUE_FLAGS = new Set(['--sub-issue', '--parent', '--closing', '--held', '--merging-pr', '--work-links', '--risk-floor', '--backend']);

// A digit string -> its positive safe-integer value, or null (`Number('')` is 0, so test the digits first).
function positive(text) {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// The value of one value-taking flag, validated -> { value } or { error }.
function flagValue(flag, text) {
  switch (flag) {
    case '--sub-issue':
    case '--parent':
    case '--merging-pr': {
      const n = positive(text);
      return n === null ? { error: `${flag} must be a positive integer: ${text}` } : { value: n };
    }
    case '--held': {
      const numbers = text.split(',').map(positive);
      return numbers.includes(null) ? { error: `--held must be positive integers separated by commas: ${text}` } : { value: numbers };
    }
    case '--closing': {
      // Syntax only: dropping a foreign-repo token needs the resolved owner/repo, so run() filters.
      const tokens = text.split(',');
      const checked = parseClosingTokens(tokens, { owner: 'o', repo: 'r' });
      return checked.error ? { error: checked.error } : { value: tokens };
    }
    case '--work-links':
      return WORK_LINKS.includes(text) ? { value: text } : { error: `--work-links must be one of ${WORK_LINKS.join(', ')}: ${text}` };
    case '--risk-floor':
      return VALID_RISK_FLOORS.includes(text) ? { value: text } : { error: `--risk-floor must be one of ${VALID_RISK_FLOORS.join(', ')}: ${text}` };
    default:
      return BACKENDS.includes(text) ? { value: text } : { error: `--backend must be one of ${BACKENDS.join(', ')}: ${text}` };
  }
}

const OPT_NAMES = {
  '--sub-issue': 'subIssue',
  '--parent': 'parent',
  '--closing': 'closing',
  '--held': 'held',
  '--merging-pr': 'mergingPr',
  '--work-links': 'workLinks',
  '--risk-floor': 'riskFloor',
  '--backend': 'backend',
};

function parseArgs(argv) {
  const opts = {
    help: false, subIssue: null, parent: null, closing: null, held: [], mergingPr: null, idempotence: false, workLinks: null, riskFloor: null, backend: null,
  };
  const given = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--idempotence') { opts.idempotence = true; continue; }
    if (!VALUE_FLAGS.has(a)) return { error: a.startsWith('--') ? `unknown argument: ${a}` : `unexpected argument: ${a}` };
    i++;
    const text = argv[i];
    // A trailing bare flag reads undefined; '' and a `--`-prefixed text are not values either.
    if (typeof text !== 'string' || !text.trim() || text.startsWith('--')) return { error: `missing value for ${a}` };
    if (given.has(a)) return { error: `${a} given more than once` };
    given.add(a);
    const parsed = flagValue(a, text);
    if (parsed.error) return { error: parsed.error };
    opts[OPT_NAMES[a]] = parsed.value;
  }
  if (!opts.help && (opts.subIssue === null) === (opts.parent === null)) {
    return { error: 'exactly one of --sub-issue and --parent is required' };
  }
  return opts;
}

const realDeps = {
  ghAvailable,
  remoteUrl,
  runner: (args) => execFileSync('gh', args, {
    encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }),
  cwd: () => process.cwd(),
  repoRoot: () => execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  }).trim(),
  // The policy file's text, or null when the project has none.
  readPolicyRaw: (root) => {
    try {
      return fs.readFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'utf8');
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
      throw err;
    }
  },
  readWorkBackend,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// argv -> exit code. All I/O goes through deps so tests never touch gh or git.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(`parent-gate.js: ${opts.error}\n${USAGE}`); return 1; }
  if (opts.help) { deps.stdout(USAGE); return 0; }

  let root;
  try { root = deps.repoRoot(); } catch { root = deps.cwd ? deps.cwd() : process.cwd(); }

  let backend = opts.backend;
  if (!backend) {
    let configured = null;
    try { configured = deps.readWorkBackend(root); } catch { configured = null; }
    backend = configured === 'local-files' ? 'local-files' : 'github-issues';
  }
  if (backend === 'local-files') {
    deps.stderr('parent-gate.js: --backend local-files is not supported yet\n');
    return 1;
  }

  let hasGh = false;
  try { hasGh = deps.ghAvailable(); } catch { hasGh = false; }
  if (!hasGh) {
    deps.stderr('parent-gate.js: `gh` is required; without it, pass the facts you fetched through --facts-json <file>\n');
    return 2;
  }

  let remote = null;
  try { remote = deps.remoteUrl(); } catch { remote = null; }
  const repoSpec = parseRepo(remote);
  if (!repoSpec) { deps.stderr('parent-gate.js: could not resolve owner/repo from the origin remote\n'); return 2; }
  const { owner, repo } = repoSpec;
  // parseRepo accepts any non-'/' segment, '.' and '..' included; the gate's REST paths interpolate
  // owner/repo (the same guard as fetch-sub-issues.js).
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    deps.stderr('parent-gate.js: invalid origin remote — owner/repo cannot be "." or ".."\n');
    return 2;
  }

  let policyRaw = null;
  try { policyRaw = deps.readPolicyRaw(root); } catch { policyRaw = null; }
  const policy = resolvePolicyKeys(['work-links', 'risk-floor'], { policyRaw });
  const workLinks = opts.workLinks || policy['work-links'].value;
  const riskFloor = opts.riskFloor || policy['risk-floor'].value;

  const tokens = opts.closing !== null ? opts.closing : opts.subIssue !== null ? [String(opts.subIssue)] : [];
  const closing = parseClosingTokens(tokens, { owner, repo });
  if (closing.error) { deps.stderr(`parent-gate.js: ${closing.error}\n${USAGE}`); return 1; }

  const caller = ghCaller(deps.runner);
  let verdict;
  try {
    const facts = gatherGateFacts({
      subIssue: opts.subIssue, parent: opts.parent, owner, repo, workLinks, caller,
    });
    verdict = evaluateParentGate({
      ...facts, closingSet: closing.numbers, held: opts.held, mergingPr: opts.mergingPr, riskFloor,
    });
    if (opts.idempotence && verdict.state === 'due' && verdict.exceeds === false) {
      const { idempotence, skipped } = evaluateIdempotence(gatherIdempotenceFacts({ parent: verdict.parent, caller }));
      verdict = { ...verdict, idempotence, skipped };
    }
  } catch (err) {
    if (!(err instanceof GhFailure)) throw err;
    deps.stderr(`parent-gate.js: ${err.message}\n`);
    return 3;
  }
  deps.stdout(`${JSON.stringify(Object.fromEntries(VERDICT_FIELDS.map((key) => [key, verdict[key]])))}\n`);
  return 0;
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
