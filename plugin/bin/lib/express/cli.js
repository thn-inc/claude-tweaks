// bin/lib/express/cli.js — the express lane's (#4025) deterministic spine:
// bin/express-lane.js is a thin entry over run(argv, deps). Prose statement of
// record is skills/_shared/express-lane.md. Five verbs:
//   gate      eligibility verdicts (evaluateRecordEligibility) for one live-fetched
//             record (--issue, always the fresh labels) or an agent-fetched array
//             (--records-json, the gh-absent MCP path: zero gh calls, no gh probe);
//             --run adds "already escalated in this run" from decisions.md.
//   check     after the build: the runner pass stamp first, then the diff bounds —
//             both against the worktree run-state.json records (never the process
//             cwd); logs a proceed line or an escalation line under ## /express-lane.
//   escalate  writes the escalation line; the detail comes from a file, never argv.
//   verify    the express path's bookend artifacts (claim log, an unsuperseded check
//             line, PR).
//   samples   merged express PRs owing a post-merge review, reviewed ones dropped.
// Escalation is only possible before the push: escalate, and check's escalation
// branches, refuse (exit 1, nothing written) once run-state.json carries `pr`.
// Exit codes (Combined-2 base plus the sanctioned writers' 3): 0 success — gate and
// check exit 0 whatever their verdict, which is on stdout; 1 a well-formed verb whose
// answer is "no" (verify: an artifact is missing; an escalation after the PR exists) or
// an upstream failure (gate --issue's fetch, samples' fetches or a search at its
// 1000-result cap, a policy read); 2 malformed invocation (an unreadable or
// mis-shaped --records-json / --record-json / --detail-file included) or `gh` absent
// where it is needed; 3 the --run dir is missing or not anchored under the main checkout
// (log-decision/append.js's resolveTarget, [IL-127]), or (escalate only) decisions.md is
// unwritable. check self-logs its entry and reports a failed append as `logged: false`
// in its envelope plus a stderr line, never through the exit code.
// Every side effect goes through `deps` (gh-api-module-pattern's CLI wrapper contract).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { evaluateRecordEligibility, evaluateDiffBounds, expressMergeVerification } = require('./eligibility');
const { selectReviewSamples, isReviewed, fixesRecords, isExpressPr } = require('./sampling');
const { extractKeyFiles } = require('../issues/grouping');
const { gatherDiffFiles, resolveBlastRadiusConfig } = require('../blast-radius-cli');
const { checkFirstCallStamp } = require('../dispatch/first-call-artifact-check');
const { formatEntry, appendEntry, parseEntry, resolveTarget } = require('../log-decision/append');
const { hasCanonicalClaimLogFor } = require('../log-decision/claim-log');
const { resolvePolicyConfig } = require('../policy-schema');
const { computeDerivedDefaults } = require('../policy-derived-defaults');
const { ghAvailable } = require('../repo-resolve');
// Read through the module at call time: GH_TIMEOUT_MS is a lazy getter (a policy read).
const sharedPrimitives = require('../shared-primitives');

const USAGE = [
  'usage: express-lane.js gate (--issue <n> | --records-json <file>) [--run <dir>] [--repo owner/name]',
  '       express-lane.js check --run <dir> --issue <n> (--integration-branch <b> | --base <ref>) [--record-json <file>] [--repo owner/name]',
  '       express-lane.js escalate --run <dir> --issue <n> --reason <failing-test|out-of-bounds|gate-denial|express-error> --detail-file <file>',
  '       express-lane.js verify --run <dir> --issue <n>',
  '       express-lane.js samples [--every <n>] [--repo owner/name]',
  'exit: 0 success (gate/check: verdict JSON on stdout whatever it is); 1 verify found an artifact missing, an escalation was refused',
  '      because run-state.json already records the PR, or an upstream fetch failed (samples: also a search at its 1000-result cap);',
  '      2 malformed invocation or `gh` absent; 3 --run missing or not anchored under the main checkout, or (escalate) decisions.md unwritable;',
  '      check reports its own failed decisions.md append as `logged: false` in the JSON, exit 0',
  '',
].join('\n');

const ESCALATION_REASONS = Object.freeze(['failing-test', 'out-of-bounds', 'gate-denial', 'express-error']);
const SECTION = '/express-lane';
const ESCALATION_STEP = 'Express lane';
const CHECK_STEP = 'Express lane check';
const ESCALATION_REVERSIBILITY = 'high (worktree and branch kept)';
const ISSUE_FIELDS = 'number,title,body,labels';
const NO_WORKTREE = 'no worktree recorded in run-state.json';
// gh pr list's own result cap: a search that fills it may have dropped older merges,
// which would shift every ordinal — refused, never sampled.
const SAMPLES_SEARCH_LIMIT = 1000;
// The merged-PR search returns up to SAMPLES_SEARCH_LIMIT bodies; it gets its own
// bound (materialize.js's SIBLING_PREMISE_SEARCH_TIMEOUT_MS precedent), never shorter
// than the shared gh bound.
const SAMPLES_SEARCH_TIMEOUT_MS = 60000;
const REPO_RE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/;
const VERB_FLAGS = {
  gate: ['--issue', '--records-json', '--run', '--repo'],
  check: ['--run', '--issue', '--integration-branch', '--base', '--record-json', '--repo'],
  escalate: ['--run', '--issue', '--reason', '--detail-file'],
  verify: ['--run', '--issue'],
  samples: ['--every', '--repo'],
};

class UsageError extends Error {}

function positiveInt(flag, v) {
  if (!/^\d+$/.test(v) || Number(v) <= 0) throw new UsageError(`${flag} must be a positive integer, got "${v}"`);
  return Number(v);
}

// argv -> { verb, flags } (every flag takes a value); throws UsageError.
function parseArgs(argv) {
  const verb = argv[0];
  if (!Object.hasOwn(VERB_FLAGS, verb || '')) throw new UsageError(verb ? `unknown verb: ${verb}` : 'a verb is required');
  const allowed = VERB_FLAGS[verb];
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!allowed.includes(a)) throw new UsageError(`unknown argument for ${verb}: ${a}`);
    if (Object.hasOwn(flags, a)) throw new UsageError(`${a} given twice`);
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) throw new UsageError(`${a} requires a value`);
    flags[a] = v;
  }
  if (flags['--issue'] !== undefined) flags['--issue'] = positiveInt('--issue', flags['--issue']);
  if (flags['--every'] !== undefined) flags['--every'] = positiveInt('--every', flags['--every']);
  if (flags['--repo'] !== undefined && !REPO_RE.test(flags['--repo'])) throw new UsageError(`--repo must be owner/name, got "${flags['--repo']}"`);
  if (flags['--reason'] !== undefined && !ESCALATION_REASONS.includes(flags['--reason'])) {
    throw new UsageError(`--reason must be one of ${ESCALATION_REASONS.join('|')}`);
  }
  const need = (...names) => { for (const n of names) if (flags[n] === undefined) throw new UsageError(`${verb} requires ${n}`); };
  if (verb === 'gate' && (flags['--issue'] === undefined) === (flags['--records-json'] === undefined)) {
    throw new UsageError('gate takes exactly one of --issue or --records-json');
  }
  if (verb === 'check') {
    need('--run', '--issue');
    if ((flags['--integration-branch'] === undefined) === (flags['--base'] === undefined)) {
      throw new UsageError('check takes exactly one of --integration-branch or --base');
    }
  }
  if (verb === 'escalate') need('--run', '--issue', '--reason', '--detail-file');
  if (verb === 'verify') need('--run', '--issue');
  return { verb, flags };
}

// The action text after `Express lane: `; the detail is collapsed to one line.
function escalationText(n, reason, detail) {
  return `escalated #${n} to /flow (reason: ${reason}) — ${String(detail).replace(/\s+/g, ' ').trim()}`;
}

function entriesOf(decisionsText) {
  return String(decisionsText || '').split(/\r?\n/).map(parseEntry).filter(Boolean);
}

const isEscalationOf = (e, n) => e.location === ESCALATION_STEP && e.action.startsWith(`escalated #${n} to /flow`);
const isProceedOf = (e, n) => e.location === CHECK_STEP && e.action.startsWith(`#${n} proceed`);

function hasEscalation(decisionsText, n) {
  return entriesOf(decisionsText).some((e) => isEscalationOf(e, n));
}

// A proceed line counts only when no escalation for the same record follows it.
function hasProceed(decisionsText, n) {
  let proceeded = false;
  for (const e of entriesOf(decisionsText)) {
    if (isProceedOf(e, n)) proceeded = true;
    else if (isEscalationOf(e, n)) proceeded = false;
  }
  return proceeded;
}

// A gh-issue-view-shaped record: {number, body, labels} (title optional).
function validRecord(r) {
  return r !== null && typeof r === 'object' && !Array.isArray(r)
    && Number.isInteger(r.number) && r.number > 0
    && (r.body == null || typeof r.body === 'string') && Array.isArray(r.labels);
}

function readJsonFile(deps, flag, file) {
  let raw;
  try { raw = deps.readFile(file); } catch (err) { throw new UsageError(`could not read ${flag} ${file}: ${err.message}`); }
  if (raw === null) throw new UsageError(`${flag} ${file} does not exist`);
  try { return JSON.parse(raw); } catch (err) { throw new UsageError(`${flag} ${file} is not valid JSON: ${err.message}`); }
}

function repoArgs(flags) {
  return flags['--repo'] ? ['--repo', flags['--repo']] : [];
}

function fetchIssue(deps, flags, n) {
  const rec = JSON.parse(deps.gh(['issue', 'view', ...repoArgs(flags), '--json', ISSUE_FIELDS, '--', String(n)]));
  if (!validRecord(rec) || rec.number !== n) throw new Error(`gh issue view returned no record #${n}`);
  return rec;
}

function sensitivePathsOf(entry) {
  const raw = entry && entry.value;
  return Array.isArray(raw) ? raw : String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function ghPresent(deps) {
  try { return deps.ghAvailable() === true; } catch { return false; }
}

class AnchorError extends Error {}

// --run -> the anchored decisions.md path; throws AnchorError (exit 3).
function anchoredDecisions(deps, runDir) {
  let target;
  try { target = resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) { throw new AnchorError(String(err && err.message)); }
  if (target.ok) return target.file;
  if (target.reason === 'missing') throw new AnchorError(`run dir does not exist: ${runDir}`);
  throw new AnchorError(`run dir is not anchored under the main checkout (a worktree-local shadow): ${runDir} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section`);
}

function readDecisions(deps, file) {
  const text = deps.readFile(file);
  return text === null ? '' : text;
}

// -> true when the entry landed. `strict` (the escalate verb, whose write is its
// whole job) turns a failed append into exit 3; check reports it as data instead
// (`logged: false` plus a stderr line, the self-logging CLIs' shape).
function append(deps, runDir, step, text, reversibility, strict) {
  try {
    const entry = formatEntry({ status: 'AUTO', now: deps.now(), step, text, reversibility });
    appendEntry({ runDir, section: SECTION, entry });
    return true;
  } catch (err) {
    const message = `could not write decisions.md (${err && err.message})`;
    if (strict) throw new AnchorError(message);
    deps.stderr(`express-lane.js: ${message} — the ${step} entry was not logged\n`);
    return false;
  }
}

function emit(deps, envelope, logged) {
  deps.stdout(`${JSON.stringify(logged ? envelope : { ...envelope, logged: false })}\n`);
  return 0;
}

// run-state.json parsed, or null when absent/unreadable/not an object.
function readRunState(deps, runDir) {
  try {
    const state = JSON.parse(deps.readFile(path.join(runDir, 'run-state.json')));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch {
    return null;
  }
}

// `state` is the run's run-state.json: once it records the PR the branch is pushed,
// and escalation (which keeps the worktree and branch for /flow) is no longer possible.
function escalate(deps, runDir, n, reason, detail, state, strict = false) {
  if (state && state.pr) {
    deps.stderr(`express-lane.js: refusing to escalate #${n} (${reason}) — the PR already exists (run-state.json records pr ${JSON.stringify(state.pr.number ?? null)}); escalation is only possible before the push\n`);
    return 1;
  }
  const oneLine = String(detail).replace(/\s+/g, ' ').trim() || 'no detail';
  const logged = append(deps, runDir, ESCALATION_STEP, escalationText(n, reason, oneLine), ESCALATION_REVERSIBILITY, strict);
  return emit(deps, { action: 'escalate', reason, detail: oneLine }, logged);
}

function runGate(deps, flags) {
  let issues;
  if (flags['--records-json'] !== undefined) {
    issues = readJsonFile(deps, '--records-json', flags['--records-json']);
    if (!Array.isArray(issues) || !issues.length || !issues.every(validRecord)) {
      throw new UsageError('--records-json must hold a non-empty array of {number, body, labels} records');
    }
  } else if (!ghPresent(deps)) {
    deps.stderr('express-lane.js: `gh` is required for gate --issue — fetch through MCP and pass --records-json instead\n');
    return 2;
  }
  const decisionsFile = flags['--run'] !== undefined ? anchoredDecisions(deps, flags['--run']) : null;
  try {
    if (!issues) issues = [fetchIssue(deps, flags, flags['--issue'])];
  } catch (err) {
    deps.stderr(`express-lane.js: could not fetch #${flags['--issue']}: ${err && err.message}\n`);
    return 1;
  }
  let policy;
  let decisionsText = '';
  try {
    policy = deps.resolvePolicy(['express-lane', 'integration-model', 'merge-sensitive-paths'], { runDir: flags['--run'] || null });
    if (decisionsFile) decisionsText = readDecisions(deps, decisionsFile);
  } catch (err) {
    deps.stderr(`express-lane.js: could not read policy or decisions.md: ${err && err.message}\n`);
    return 1;
  }
  const enabled = policy['express-lane'].value === true;
  const opts = { enabled, integrationModel: policy['integration-model'].value, sensitivePaths: sensitivePathsOf(policy['merge-sensitive-paths']) };
  const verdicts = issues.map((issue) => evaluateRecordEligibility(issue, { ...opts, escalated: decisionsFile !== null && hasEscalation(decisionsText, issue.number) }));
  deps.stdout(`${JSON.stringify({ enabled, verdicts })}\n`);
  return 0;
}

function runCheck(deps, flags) {
  const n = flags['--issue'];
  const runDir = flags['--run'];
  let record = null;
  if (flags['--record-json'] !== undefined) {
    record = readJsonFile(deps, '--record-json', flags['--record-json']);
    if (!validRecord(record) || record.number !== n) throw new UsageError(`--record-json must hold the {number, body, labels} record #${n}`);
  } else if (!ghPresent(deps)) {
    deps.stderr('express-lane.js: `gh` is required for check without --record-json\n');
    return 2;
  }
  anchoredDecisions(deps, runDir);

  // One tree for both judgments: checkFirstCallStamp verifies run-state.json's
  // worktree, so the bounds' git calls run there too, never in the process cwd.
  const state = readRunState(deps, runDir);
  const worktree = state && typeof state.worktree === 'string' && state.worktree.trim() ? state.worktree : null;
  if (worktree === null) return escalate(deps, runDir, n, 'express-error', NO_WORKTREE, state);

  let stamp;
  try { stamp = deps.stampCheck({ runDir }); } catch (err) {
    return escalate(deps, runDir, n, 'express-error', `runner stamp read failed: ${err && err.message}`, state);
  }
  if (!stamp || stamp.verified !== true) {
    return escalate(deps, runDir, n, 'failing-test', `no runner pass stamp verifies HEAD (${stamp && stamp.reason})`, state);
  }

  let bounds;
  let mergeVerification;
  try {
    if (!record) record = fetchIssue(deps, flags, n);
    const git = (args) => deps.git(args, { cwd: worktree });
    const { files } = gatherDiffFiles({ base: flags['--base'], integrationBranch: flags['--integration-branch'] }, { git });
    const config = deps.blastRadiusConfig({ git, readFile: deps.readFile, runDir });
    bounds = evaluateDiffBounds(files, { keyFiles: extractKeyFiles(record), sensitivePaths: config.mergeSensitivePaths, maxLines: config.autoMergeMaxLines });
    if (bounds.withinBounds) mergeVerification = expressMergeVerification(deps.resolvePolicy(['merge-verification'], { runDir })['merge-verification'].value);
  } catch (err) {
    return escalate(deps, runDir, n, 'express-error', String(err && err.message), state);
  }
  if (!bounds.withinBounds) return escalate(deps, runDir, n, 'out-of-bounds', bounds.violations.join('; '), state);

  const k = bounds.changedFiles.length;
  const logged = append(deps, runDir, CHECK_STEP, `#${n} proceed — ${k} changed file(s), ${bounds.implLines} implementation line(s) within bounds; runner stamp verifies HEAD.`);
  const configSet = `mode=auto,ceremony-profile=fast-lane,merge-verification=${mergeVerification}`;
  return emit(deps, { action: 'proceed', mergeVerification, configSet, bounds }, logged);
}

function runEscalate(deps, flags) {
  let raw;
  try { raw = deps.readFile(flags['--detail-file']); } catch (err) { throw new UsageError(`could not read --detail-file: ${err.message}`); }
  const detail = raw === null ? '' : raw.split(/\r?\n/)[0].trim();
  if (!detail) throw new UsageError('--detail-file must exist and hold a non-empty first line');
  anchoredDecisions(deps, flags['--run']);
  return escalate(deps, flags['--run'], flags['--issue'], flags['--reason'], detail, readRunState(deps, flags['--run']), true);
}

function runVerify(deps, flags) {
  const n = flags['--issue'];
  const file = anchoredDecisions(deps, flags['--run']);
  let decisionsText = '';
  let state = null;
  try { decisionsText = readDecisions(deps, file); } catch { decisionsText = ''; }
  try { state = JSON.parse(deps.readFile(path.join(flags['--run'], 'run-state.json'))); } catch { state = null; }
  const missing = [];
  if (!hasCanonicalClaimLogFor(decisionsText, n)) missing.push('claim-log');
  if (!hasProceed(decisionsText, n)) missing.push('express-check');
  const pr = state && typeof state === 'object' ? state.pr : null;
  if (!pr || !Number.isInteger(pr.number) || pr.number <= 0) missing.push('pr');
  deps.stdout(`${JSON.stringify({ ok: missing.length === 0, missing })}\n`);
  return missing.length === 0 ? 0 : 1;
}

function runSamples(deps, flags) {
  if (!ghPresent(deps)) {
    deps.stderr('express-lane.js: `gh` is required for samples\n');
    return 2;
  }
  let every = flags['--every'];
  try {
    if (every === undefined) every = deps.resolvePolicy(['express-review-sample-every'], { runDir: null })['express-review-sample-every'].value;
    const listArgs = ['pr', 'list', ...repoArgs(flags), '--state', 'merged', '--search', 'claude-tweaks-express in:body', '--json', 'number,mergedAt,mergeCommit,body', '--limit', String(SAMPLES_SEARCH_LIMIT)];
    const merges = JSON.parse(deps.gh(listArgs, { timeout: Math.max(SAMPLES_SEARCH_TIMEOUT_MS, sharedPrimitives.GH_TIMEOUT_MS) }));
    if (!Array.isArray(merges)) throw new Error('gh pr list did not return an array');
    if (merges.length >= SAMPLES_SEARCH_LIMIT) {
      throw new Error(`the merged-PR search returned ${merges.length} results, its ${SAMPLES_SEARCH_LIMIT}-result search cap — older express merges may be missing, so ordinals cannot be trusted`);
    }
    const byNumber = new Map(merges.map((m) => [m.number, m]));
    const expressMerges = merges.filter((m) => m && isExpressPr(m.body) && Number.isFinite(Date.parse(m.mergedAt))).length;
    const sampled = [];
    for (const s of selectReviewSamples(merges, every)) {
      const view = JSON.parse(deps.gh(['pr', 'view', ...repoArgs(flags), '--json', 'comments', '--', String(s.number)]));
      if (isReviewed(view && view.comments)) continue;
      const m = byNumber.get(s.number);
      sampled.push({ pr: s.number, ordinal: s.ordinal, mergedAt: s.mergedAt, mergeSha: (m.mergeCommit && m.mergeCommit.oid) || null, records: fixesRecords(m.body) });
    }
    deps.stdout(`${JSON.stringify({ every, expressMerges, sampled })}\n`);
    return 0;
  } catch (err) {
    deps.stderr(`express-lane.js: samples failed: ${err && err.message}\n`);
    return 1;
  }
}

const HANDLERS = { gate: runGate, check: runCheck, escalate: runEscalate, verify: runVerify, samples: runSamples };

function run(argv, deps = realDeps) {
  if (argv.includes('--help') || argv.includes('-h')) { deps.stdout(USAGE); return 0; }
  try {
    const { verb, flags } = parseArgs(argv);
    return HANDLERS[verb](deps, flags);
  } catch (err) {
    if (err instanceof UsageError) { deps.stderr(`express-lane.js: ${err.message}\n${USAGE}`); return 2; }
    if (err instanceof AnchorError) { deps.stderr(`express-lane.js: ${err.message}\n`); return 3; }
    deps.stderr(`express-lane.js: ${err && err.message}\n`);
    return 1;
  }
}

function defaultGit(args, opts = {}) {
  return execFileSync('git', args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function defaultReadFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function defaultResolvePolicy(keys, { runDir = null } = {}) {
  const { root, result } = resolvePolicyConfig({ git: defaultGit, readFile: defaultReadFile, runDir, keys });
  return computeDerivedDefaults(result, keys, root);
}

const realDeps = {
  gh: (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout || sharedPrimitives.GH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true }),
  ghAvailable: () => ghAvailable(),
  git: defaultGit,
  readFile: defaultReadFile,
  blastRadiusConfig: resolveBlastRadiusConfig,
  resolvePolicy: defaultResolvePolicy,
  stampCheck: ({ runDir }) => checkFirstCallStamp({ runDir }),
  now: () => Date.now(),
  cwd: () => process.cwd(),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

module.exports = {
  run, realDeps, USAGE, ESCALATION_REASONS, escalationText, hasEscalation, defaultResolvePolicy, parseArgs, sensitivePathsOf,
};
