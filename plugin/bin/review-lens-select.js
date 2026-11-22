#!/usr/bin/env node
// bin/review-lens-select.js — the per-run review lens selection (#6001): which of /claude-tweaks:review Step 3's lenses
// to dispatch, decided in code from the tier, the diff facts, the per-lens history and the skip streaks.
//   node bin/review-lens-select.js --run <run-dir> --tier low|medium|high|xhigh|max --base <ref> [--risk-flags <csv>]
//
// stdout, one JSON line, exactly: { tier, selected: [<lens id>], skipped: [{lens, reason}], fallback: null | "<reason>" }.
// The same object plus `v: 1` is written to {run}/lens-selection.json (lib/review-lens/selection-record.js). One
// decisions.md line per outcome (section /review, step "Step 3 lens selection"): one SKIP per skipped lens
// (`condition: {reason} → fallback: lens not dispatched`), or — on a fallback — one AUTO naming its reason. Nothing is
// printed unless both writes succeeded.
//
// Exit codes: 0 printed; 1 a write or log failed (nothing printed); 2 malformed invocation (a bad or missing flag, an
// unknown flag, a --tier outside TIERS) or a --run the anchoring guard refuses (missing, not anchored under the main
// checkout's .claude-tweaks/pipelines — _shared/pipeline-run-dir.md — or no main checkout resolvable from the cwd).
//
// --run is the log and record target only. The history root is the main checkout's pipelines root (hooks/run-dir-resolve
// rootOnly), never --run. Each input's failure selects the full tier set (`fallback` set, `skipped: []`) with the reason
// logged — never read as "nothing calls for a lens":
//   - the diff facts cannot be computed (--base unresolvable, git diff fails, a fact throws, an unreadable
//     risk-path-globs block with control mode on): facts.js's `{ok:false, fact, reason}` -> select.js's fallback.
//   - the lens history is unreadable or malformed (readLensHistory throws, or select.js's historyProblem): fallback.
//   - the skip streaks are unreadable (readSkipStreaks `ok:false`, or it throws): select.js forces every below-floor
//     lens silently and sets no fallback, so this CLI logs the reason as one AUTO line itself.
//   - readRiskPolicy(mainRoot) throws: riskPolicy `{ error }`, so the riskPathTouched fact fails -> fallback.
// A --base equal to HEAD is an empty diff: every fact false, the rules apply as written.
// Entry contract: .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md.
'use strict';

const path = require('node:path');
const { resolve: resolveRoot } = require('./lib/hooks/run-dir-resolve');
const { readRiskPolicy } = require('./lib/policy');
const { resolveTarget, appendEntries, formatEntry } = require('./lib/log-decision/append');
const { computeFacts } = require('./lib/review-lens/facts');
const { readLensHistory } = require('./lib/review-lens/history');
const { selectLenses, TIERS } = require('./lib/review-lens/select');
const { writeLensSelection, readSkipStreaks } = require('./lib/review-lens/selection-record');

const USAGE = 'usage: review-lens-select.js --run <run-dir> --tier low|medium|high|xhigh|max --base <ref> [--risk-flags <csv>]\n';
const SECTION = '/review';
const STEP = 'Step 3 lens selection';
const VALUE_FLAGS = { '--run': 'run', '--tier': 'tier', '--base': 'base', '--risk-flags': 'riskFlags' };

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  git: null,
  now: () => Date.now(),
};

const messageOf = (err) => (err && err.message) || String(err);

function parseArgs(argv) {
  const o = { run: null, tier: null, base: null, riskFlags: null };
  for (let i = 0; i < argv.length; i++) {
    const key = Object.prototype.hasOwnProperty.call(VALUE_FLAGS, argv[i]) ? VALUE_FLAGS[argv[i]] : null;
    if (!key) return { error: `unknown argument: ${argv[i]}` };
    const value = argv[++i];
    if (value === undefined || value === '') return { error: `${argv[i - 1]} requires a value` };
    o[key] = value;
  }
  for (const [flag, key] of Object.entries(VALUE_FLAGS)) {
    if (key !== 'riskFlags' && o[key] === null) return { error: `${flag} is required` };
  }
  if (!TIERS.includes(o.tier)) return { error: `--tier must be one of ${TIERS.join('|')}` };
  return o;
}

function run(argv, deps = {}) {
  deps = { ...realDeps, ...deps };
  const usageError = (message) => { deps.stderr(`review-lens-select.js: ${message}\n${USAGE}`); return 2; };
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);

  let cwd;
  let mainRoot;
  let target;
  try {
    cwd = deps.cwd();
    const resolved = resolveRoot({ cwd, env: deps.env, rootOnly: true });
    if (!resolved.ok) return usageError(`no main checkout resolvable: ${resolved.message}`);
    mainRoot = resolved.path;
    target = resolveTarget({ runDir: o.run, cwd, mainRoot });
  } catch (err) {
    return usageError(`could not resolve --run ${o.run}: ${messageOf(err)}`);
  }
  if (!target.ok) {
    return usageError(target.reason === 'missing'
      ? `run dir does not exist: ${o.run}`
      : `run dir is not anchored under the main checkout's .claude-tweaks/pipelines: ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }
  const runDir = path.dirname(target.file);

  let riskPolicy;
  try { riskPolicy = readRiskPolicy(mainRoot); } catch (err) { riskPolicy = { error: messageOf(err) }; }
  const riskFlags = o.riskFlags === null ? [] : o.riskFlags.split(',').map((f) => f.trim()).filter(Boolean);
  let facts;
  try {
    facts = computeFacts({ cwd, base: o.base, riskFlags, riskPolicy, git: deps.git || undefined });
  } catch (err) {
    facts = { ok: false, fact: 'facts', reason: messageOf(err) };
  }

  const roots = [path.join(mainRoot, '.claude-tweaks', 'pipelines')];
  let history = null;
  let historyError = null;
  try { history = readLensHistory({ roots }); } catch (err) { historyError = `lens history unreadable: ${messageOf(err)}`; }
  let streaks;
  try { streaks = readSkipStreaks({ roots, excludeRunId: path.basename(runDir) }); } catch (err) {
    streaks = { ok: false, reason: messageOf(err) };
  }

  const selection = selectLenses({ tier: o.tier, facts, history, streaks });
  if (historyError && selection.fallback) selection.fallback = historyError;

  const items = [];
  if (selection.fallback) {
    items.push({ status: 'AUTO', text: `lens selection fell back to the full ${selection.tier} tier set: ${selection.fallback}` });
  } else {
    if (!streaks.ok) items.push({ status: 'AUTO', text: `skip streaks unreadable, every below-floor lens forced: ${streaks.reason}` });
    for (const s of selection.skipped) items.push({ status: 'SKIP', text: `condition: ${s.reason} → fallback: lens not dispatched` });
  }
  const now = deps.now();
  try {
    appendEntries({
      runDir,
      items: items.map((it) => ({ section: SECTION, entry: formatEntry({ ...it, step: STEP, reversibility: 'n/a', now }) })),
    });
    writeLensSelection(runDir, selection);
  } catch (err) {
    deps.stderr(`review-lens-select.js: could not write the lens selection (${messageOf(err)})\n`);
    return 1;
  }
  deps.stdout(`${JSON.stringify(selection)}\n`);
  return 0;
}

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
