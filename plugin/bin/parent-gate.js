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
//   [--risk-floor low|medium|high|always] [--facts-json <file>]
//   [--backend github-issues|local-files] [--records-dir <dir>] [--help]
//   --closing    N or owner/repo#N; a foreign-repo token is dropped. --sub-issue N without
//                --closing means {N}; --parent without it means {}. Under --backend local-files
//                only a plain N is accepted: a record id names no repository.
//   --held       sub-issues Step 4.0b's caller has not settled; they come back in `held`.
//   --idempotence  pass only when the caller will run Close the parent below the floor
//                (Step 4.0b, tidy's parent-side entry): it adds the two idempotence reads
//                (the parent's comments and the gh login), and only for a parent that is
//                due below the floor. Without it `idempotence` is null and `skipped` is [].
//   --work-links, --risk-floor  default to .claude-tweaks/policy.yml at the repo root.
//   --backend    github-issues|local-files; defaults to CLAUDE.md's `work-backend:`. local-files
//                reads the gate's facts from the record store (bin/lib/issues/local-store.js):
//                no gh call, no gh probe, no remote read. A record's `parent` facet is its
//                parent; `closed`/`not-planned` give a sub-issue's state; the `risk`,
//                `is-parent-issue` and `acceptance` facets stand in for the labels.
//   --records-dir  the record store for --backend local-files, resolved against the repo root;
//                defaults to `specs`. Refused under any other backend.
//   --facts-json the gh-absent fact source: the MCP `issue_read` results the calling skill
//                fetched, written unreshaped (bin/lib/issues/mcp-parent-gate-shape.js's
//                FACTS_KEYS), normalized in Node and then evaluated by the same functions
//                the gh path runs. This path makes zero gh calls and never probes for gh.
//                `parentComments` and `me` are required and guarded only under --idempotence,
//                and only for an open, non-reopened parent that is due below the floor (where
//                the gh path makes its two reads); any other verdict never looks at them. The
//                origin remote (a git read) supplies owner/repo only when a --closing token is
//                qualified; otherwise no remote is read. Refused with --backend local-files.
//
// Output: one JSON line on stdout, the verdict in the order of VERDICT_FIELDS
// (bin/lib/issues/parent-gate.js): {parent, state, exceeds, closeReason, idempotence,
// maxTier, riskFloor, parentIssue, needs, held, subIssues, skipped}. The verdict is data,
// never an exit code: every `state`, `no-parent` included, is exit 0.
//
// Exit codes (Split-1/2, fetch-sub-issues.js's vocabulary): 0 a verdict was printed;
// 1 a malformed invocation; 2 `gh` is absent, or owner/repo or the repo root cannot be
// resolved; 3 a gh call failed, or under --backend local-files the record store could not be
// read (the message goes to stderr). On every non-zero exit nothing goes to stdout. Only a
// GhFailure or a FactsError maps to an exit code, and a thrown store read under local-files:
// any other throw is a bug and propagates. Under --backend local-files a sub-issue or parent
// id the store does not hold, or a closing token that names a repository, is exit 1; an absent
// records dir is an empty store, and a records dir that will not read for any other reason is 3.
//
// --facts-json uses the same vocabulary, and splits the file's problems by what they mean:
// 1 a facts file that will not read, parse or hold a JSON object, a required key that is
// absent, or a subIssueGets key set that is not the enumerated numbers (the fetch never
// happened); 3 a present entry that fails its shape guard (an MCP error or a wrapper the
// agent wrote as data). 2 can only mean no GitHub remote for a qualified --closing token, or an
// undeterminable repository root and working directory. This deliberately departs from
// cli-wrapper-contract.md's gh-absent rule (every problem with the file on the
// malformed-invocation code, as materialize.js and preflight-records.js do): a file problem and
// a guard failure are different recoveries for the prose that branches on them, and
// mcp-agent-fetch-node-compute rule 3 maps a guard failure to a failed read, never to content,
// which is this CLI's 3.
//
// There is no `--repo` flag. Owner/repo come from the origin remote, and every gh read of
// the gate names them (`--repo` on each `gh issue view`, the GraphQL variables, the REST
// path), so one gate reads one repository however many remotes the checkout has.
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
const { FactsError, normalizeMcpFacts, withIdempotenceReads } = require('./lib/issues/mcp-parent-gate-shape');
const { queryRecords, DEFAULT_DIR } = require('./lib/issues/local-store');
const { LABELS } = require('./lib/issues/record-vocabulary');

const USAGE = 'usage: parent-gate.js (--sub-issue <n> | --parent <n>) [--closing <tok>[,<tok>...]] [--held <n>[,<n>...]] [--merging-pr <n>] [--idempotence] [--work-links native|body-text] [--risk-floor low|medium|high|always] [--facts-json <file>] [--backend github-issues|local-files] [--records-dir <dir>] [--help]\n';

const WORK_LINKS = POLICY_KEYS.find((k) => k.key === 'work-links').values;
const BACKENDS = ['github-issues', 'local-files'];
const VALUE_FLAGS = new Set(['--sub-issue', '--parent', '--closing', '--held', '--merging-pr', '--work-links', '--risk-floor', '--backend', '--facts-json', '--records-dir']);
// A record's `acceptance` facet, as the label the gate reads it from.
const ACCEPTANCE_LABELS = {
  pending: LABELS.ACCEPT_PENDING,
  approved: LABELS.ACCEPT_APPROVED,
  'changes-requested': LABELS.ACCEPT_CHANGES_REQUESTED,
};

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
      const numbers = text.split(',').map((token) => positive(token.trim()));
      return numbers.includes(null) ? { error: `--held must be positive integers separated by commas: ${text}` } : { value: numbers };
    }
    case '--closing': {
      // Syntax only: dropping a foreign-repo token needs the resolved owner/repo, so run() filters.
      const tokens = text.split(',').map((token) => token.trim());
      const checked = parseClosingTokens(tokens, { owner: 'o', repo: 'r' });
      return checked.error ? { error: checked.error } : { value: tokens };
    }
    case '--work-links':
      return WORK_LINKS.includes(text) ? { value: text } : { error: `--work-links must be one of ${WORK_LINKS.join(', ')}: ${text}` };
    case '--risk-floor':
      return VALID_RISK_FLOORS.includes(text) ? { value: text } : { error: `--risk-floor must be one of ${VALID_RISK_FLOORS.join(', ')}: ${text}` };
    case '--facts-json':
    case '--records-dir':
      return { value: text };
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
  '--facts-json': 'factsJson',
  '--records-dir': 'recordsDir',
};

function parseArgs(argv) {
  const opts = {
    help: false, subIssue: null, parent: null, closing: null, held: [], mergingPr: null, idempotence: false, workLinks: null, riskFloor: null, backend: null, factsJson: null, recordsDir: null,
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
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  // Throws when the records dir will not read; queryRecords reads any such dir as empty.
  probeRecordsDir: (dir) => { fs.readdirSync(dir); },
  queryRecords,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function printVerdict(deps, verdict) {
  deps.stdout(`${JSON.stringify(Object.fromEntries(VERDICT_FIELDS.map((key) => [key, verdict[key]])))}\n`);
}

// --backend local-files: the same gate over the record store -> exit code. A record's `parent`
// facet is its parent, `closed`/`not-planned` give a sub-issue's state, and the `risk`,
// `is-parent-issue` and `acceptance` facets stand in for the labels the gh path reads. The
// store is read in two scans, open then closed; a record both return (closed between them)
// is kept once, as the later closed scan read it.
function runLocalFiles(opts, deps, { root, tokens, riskFloor }) {
  const closing = parseClosingTokens(tokens, { owner: null, repo: null });
  if (closing.error) {
    deps.stderr(`parent-gate.js: ${closing.error} (--backend local-files takes plain ids)\n${USAGE}`);
    return 1;
  }
  const dir = path.resolve(root, opts.recordsDir !== null ? opts.recordsDir : DEFAULT_DIR);
  let records;
  try {
    // An absent dir is an empty store; any other readdir error would otherwise read as one too.
    try { deps.probeRecordsDir(dir); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    records = [...deps.queryRecords(dir, {}), ...deps.queryRecords(dir, { closed: true })];
  } catch (err) {
    deps.stderr(`parent-gate.js: could not read the records in ${dir}: ${err && err.message}\n`);
    return 3;
  }
  const byId = new Map(records.map((record) => [record.id, record]));

  let parentId = opts.parent;
  if (parentId === null) {
    const sub = byId.get(opts.subIssue);
    if (!sub) { deps.stderr(`parent-gate.js: sub-issue #${opts.subIssue} is not a record in ${dir}\n`); return 1; }
    parentId = sub.facets.parent;
  }
  let facts = { parent: null, parentLabels: [], subIssues: [] };
  let parentRecord = null;
  if (parentId !== null && parentId !== undefined) {
    parentRecord = byId.get(parentId);
    if (!parentRecord) { deps.stderr(`parent-gate.js: parent #${parentId} is not a record in ${dir}\n`); return 1; }
    const parentLabels = [];
    if (parentRecord.facets.isParentIssue === true) parentLabels.push(LABELS.PARENT_ISSUE);
    const acceptance = parentRecord.facets.acceptance;
    if (Object.prototype.hasOwnProperty.call(ACCEPTANCE_LABELS, acceptance)) parentLabels.push(ACCEPTANCE_LABELS[acceptance]);
    facts = {
      parent: parentId,
      parentLabels,
      subIssues: [...byId.values()].filter((r) => r.facets.parent === parentId).map((r) => ({
        number: r.id,
        title: r.title,
        state: r.facets.closed ? 'CLOSED' : 'OPEN',
        stateReason: r.facets.closed ? (r.facets.notPlanned ? 'NOT_PLANNED' : 'COMPLETED') : '',
        labels: r.facets.risk ? [`risk:${r.facets.risk}`] : [],
        closedBy: [],
      })),
    };
  }

  let verdict = evaluateParentGate({
    ...facts, closingSet: closing.numbers, held: opts.held, mergingPr: opts.mergingPr, riskFloor,
  });
  if (opts.idempotence && verdict.state === 'due' && verdict.exceeds === false) {
    const { idempotence, skipped } = evaluateIdempotence({
      state: parentRecord.facets.closed ? 'CLOSED' : 'OPEN', body: parentRecord.body,
    });
    verdict = { ...verdict, idempotence, skipped };
  }
  printVerdict(deps, verdict);
  return 0;
}

// argv -> exit code. All I/O goes through deps so tests never touch gh or git.
function run(argv, deps = realDeps) {
  const opts = parseArgs(argv);
  if (opts.error) { deps.stderr(`parent-gate.js: ${opts.error}\n${USAGE}`); return 1; }
  if (opts.help) { deps.stdout(USAGE); return 0; }

  // The policy and CLAUDE.md reads need a root: the repo root, else the cwd. With neither, a
  // policy read would silently fall to the schema defaults, so this is an environment failure.
  let root;
  try {
    try { root = deps.repoRoot(); } catch { root = deps.cwd ? deps.cwd() : process.cwd(); }
  } catch {
    deps.stderr('parent-gate.js: could not determine the repository root or the working directory\n');
    return 2;
  }

  let backend = opts.backend;
  if (!backend) {
    let configured = null;
    try { configured = deps.readWorkBackend(root); } catch { configured = null; }
    backend = configured === 'local-files' ? 'local-files' : 'github-issues';
  }
  let tokens = [];
  if (opts.closing !== null) tokens = opts.closing;
  else if (opts.subIssue !== null) tokens = [String(opts.subIssue)];

  let policyRaw = null;
  try { policyRaw = deps.readPolicyRaw(root); } catch { policyRaw = null; }
  const policy = resolvePolicyKeys(['work-links', 'risk-floor'], { policyRaw });
  const workLinks = opts.workLinks || policy['work-links'].value;
  const riskFloor = opts.riskFloor || policy['risk-floor'].value;

  if (backend === 'local-files') {
    if (opts.factsJson !== null) {
      deps.stderr('parent-gate.js: --facts-json cannot be combined with --backend local-files\n');
      return 1;
    }
    return runLocalFiles(opts, deps, { root, tokens, riskFloor });
  }
  if (opts.recordsDir !== null) {
    deps.stderr('parent-gate.js: --records-dir only applies to --backend local-files\n');
    return 1;
  }

  // The facts file path makes no gh call and never probes for gh. It needs owner/repo only to
  // judge a qualified --closing token (an unqualified one skips sameRepoNumbers), so it reads
  // the origin remote only then.
  if (opts.factsJson === null) {
    let hasGh = false;
    try { hasGh = deps.ghAvailable(); } catch { hasGh = false; }
    if (!hasGh) {
      deps.stderr('parent-gate.js: `gh` is required; without it, pass the facts you fetched through --facts-json <file>\n');
      return 2;
    }
  }

  let owner = null;
  let repo = null;
  if (opts.factsJson === null || tokens.some((token) => !/^\d+$/.test(token))) {
    let remote = null;
    try { remote = deps.remoteUrl(); } catch { remote = null; }
    const repoSpec = parseRepo(remote);
    if (!repoSpec) { deps.stderr('parent-gate.js: could not resolve owner/repo from the origin remote\n'); return 2; }
    ({ owner, repo } = repoSpec);
    // parseRepo accepts any non-'/' segment, '.' and '..' included; the gate's REST paths interpolate
    // owner/repo (the same guard as fetch-sub-issues.js).
    if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
      deps.stderr('parent-gate.js: invalid origin remote — owner/repo cannot be "." or ".."\n');
      return 2;
    }
  }

  const closing = parseClosingTokens(tokens, { owner, repo });
  if (closing.error) { deps.stderr(`parent-gate.js: ${closing.error}\n${USAGE}`); return 1; }

  let mcp = null;
  if (opts.factsJson !== null) {
    let raw;
    try {
      raw = deps.readFile(opts.factsJson);
    } catch (err) {
      deps.stderr(`parent-gate.js: facts file ${opts.factsJson}: unreadable (${err && err.message})\n`);
      return 1;
    }
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      deps.stderr(`parent-gate.js: facts file ${opts.factsJson}: not valid JSON (${err.message})\n`);
      return 1;
    }
    try {
      mcp = normalizeMcpFacts(raw, { subIssue: opts.subIssue, parent: opts.parent, workLinks });
      mcp.raw = raw;
    } catch (err) {
      if (!(err instanceof FactsError)) throw err;
      deps.stderr(`parent-gate.js: facts file ${err.key}: ${err.message}\n`);
      return err.exit;
    }
  }

  const caller = mcp ? null : ghCaller(deps.runner);
  let verdict;
  try {
    const facts = mcp ? mcp.gate : gatherGateFacts({
      subIssue: opts.subIssue, parent: opts.parent, owner, repo, workLinks, caller,
    });
    verdict = evaluateParentGate({
      ...facts, closingSet: closing.numbers, held: opts.held, mergingPr: opts.mergingPr, riskFloor,
    });
    if (opts.idempotence && verdict.state === 'due' && verdict.exceeds === false) {
      // The facts file's two idempotence reads are guarded here and nowhere earlier: a verdict that
      // never reads them (the gh path makes no such call) must not depend on them.
      const idempotenceFacts = mcp ? withIdempotenceReads(mcp.raw, mcp.idempotence) : gatherIdempotenceFacts({ parent: verdict.parent, owner, repo, caller });
      const { idempotence, skipped } = evaluateIdempotence(idempotenceFacts);
      verdict = { ...verdict, idempotence, skipped };
    }
  } catch (err) {
    if (err instanceof FactsError) {
      deps.stderr(`parent-gate.js: facts file ${err.key}: ${err.message}\n`);
      return err.exit;
    }
    if (!(err instanceof GhFailure)) throw err;
    deps.stderr(`parent-gate.js: ${err.message}\n`);
    return 3;
  }
  printVerdict(deps, verdict);
  return 0;
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
