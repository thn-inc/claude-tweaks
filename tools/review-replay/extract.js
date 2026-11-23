'use strict';
// tools/review-replay/extract.js — picks the archived review findings a replay can judge and writes everything the
// replay workflow needs: a source tree per run at the commit the review ran on, the judge prompts per arm, the manifest
// that lists them, the fixture that records what was selected and why, and the archived verdicts the scorer compares to.
// The prompts carry the production tiebreak template and the finding, never an archived verdict or rationale.

const path = require('path');
const crypto = require('crypto');
const { readRun, selectRuns, matchVerdicts } = require('./archive.js');
const { loadTemplate, disciplineLines, buildPrompt } = require('./prompt.js');
const { split, bump } = require('./util.js');
const {
  SCHEMA_VERSION, MANIFEST_FILE, FIXTURE_FILE, VERDICTS_FILE, isRunRecordPath, specFileCited,
} = require('./schema.js');

const POSITIVE_INT = /^[1-9]\d*$/;
const ARM_NAME = /^[A-Za-z0-9._-]+$/;
const ARM_KEYS_ACCEPTED = new Set(['name', 'chunk', 'profile', 'effort', 'repeat']);
const HEAD_REASONS = ['no-fix-commit', 'fix-commit-not-in-clone'];
const EXIT_SHORTFALL = 3;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'unknown'];

function positiveInt(flag, value) {
  if (!POSITIVE_INT.test(String(value))) return { error: `${flag} must be a positive integer` };
  return { value: Number(value) };
}

// efforts: the model-profiles EFFORT_SCALE, the one list of effort levels the plugin accepts.
function parseArm(text, profiles, efforts) {
  const arm = { chunk: 1, repeat: 1 };
  for (const part of String(text).split(',')) {
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? '' : part.slice(eq + 1);
    if (!ARM_KEYS_ACCEPTED.has(key)) return { error: `--arm: unknown key "${key}" in "${text}"` };
    if (key === 'name' || key === 'profile') {
      arm[key] = value;
    } else if (key === 'effort') {
      if (!efforts.includes(value)) return { error: `--arm: effort must be one of ${efforts.join('|')}: "${value}" in "${text}"` };
      arm.effort = value;
    } else {
      const n = positiveInt(`--arm ${key}`, value);
      if (n.error) return n;
      arm[key] = n.value;
    }
  }
  if (!arm.name || !ARM_NAME.test(arm.name)) return { error: `--arm: name is required and may use letters, digits, ".", "_" and "-" only: "${text}"` };
  if (!arm.profile || !Object.prototype.hasOwnProperty.call(profiles, arm.profile)) {
    return { error: `--arm: profile must be one of ${Object.keys(profiles).join('|')}: "${text}"` };
  }
  return { arm };
}

function parseQuota(text) {
  const quota = {};
  for (const part of String(text).split(',')) {
    const eq = part.indexOf('=');
    const sev = eq === -1 ? '' : part.slice(0, eq);
    const n = eq === -1 ? { error: 'x' } : positiveInt('--quota', part.slice(eq + 1));
    if (!sev || n.error) return { error: `--quota must be <severity>=<n>[,<severity>=<n>...]: "${text}"` };
    if (!SEVERITIES.includes(sev)) return { error: `--quota severity must be one of ${SEVERITIES.join('|')}: "${sev}"` };
    if (sev in quota) return { error: `--quota names severity "${sev}" more than once` };
    quota[sev] = n.value;
  }
  return { quota };
}

// The options parseArgs collected -> the validated extract request, or { error } for a malformed invocation.
function parseExtractOptions(opts, profiles, efforts) {
  if (!opts.out) return { error: 'extract requires --out' };
  if (!opts.arms || opts.arms.length === 0) return { error: 'extract requires at least one --arm' };
  const arms = [];
  for (const text of opts.arms) {
    const parsed = parseArm(text, profiles, efforts);
    if (parsed.error) return parsed;
    if (arms.some((a) => a.name === parsed.arm.name)) return { error: `--arm: duplicate arm name "${parsed.arm.name}"` };
    arms.push(parsed.arm);
  }
  const requested = {};
  for (const [flag, key] of [['min-runs', 'minRuns'], ['min-findings', 'minFindings']]) {
    if (opts[flag] === undefined) continue;
    const n = positiveInt(`--${flag}`, opts[flag]);
    if (n.error) return n;
    requested[key] = n.value;
  }
  if (opts.quota !== undefined) {
    const q = parseQuota(opts.quota);
    if (q.error) return q;
    requested.quota = q.quota;
  }
  return { arms, requested };
}

function isEmptyOrAbsent(fs, dir) {
  if (!fs.existsSync(dir)) return true;
  try {
    return fs.readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

// Why a run that has no usable review head is excluded: the head reason readRun recorded.
function headReason(r) {
  return r.why.find((w) => HEAD_REASONS.includes(w)) || r.why[0] || 'no-fix-commit';
}

// One run -> { exclusion } with the run-level reason, or { eligible, findingExclusions, match } for a run that can be
// replayed. Every exclusion reason a run can carry is named in schema.js's EXCLUSION_REASONS.
function examineRun(dir, deps) {
  const r = readRun(dir, deps);
  if (r.excluded) return { exclusion: r.excluded };
  if (r.findings === null) return { exclusion: r.why.includes('findings-unreadable') ? 'findings-unreadable' : 'no-findings-artifact' };
  if (r.head === null) return { exclusion: headReason(r) };
  if (r.base === null) return { exclusion: 'no-recorded-base' };
  try {
    deps.git(['cat-file', '-e', `${r.head}^{commit}`]);
  } catch {
    return { exclusion: 'head-not-in-clone' };
  }
  // The tree leaves out RUN_RECORDS_DIR, so those entries are not there; a run's own spec is put back at the path a finding cites.
  const files = new Set(split(deps.git(['ls-tree', '-r', '--name-only', r.head])).filter((p) => p && !isRunRecordPath(p)));
  const inTree = (p) => files.has(p) || (specFileCited(p) !== null && r.specFiles.includes(specFileCited(p)));
  const match = matchVerdicts(r.findings, r.verdicts, r.failedJudges);
  const eligible = [];
  const findingExclusions = [];
  for (const f of r.findings) {
    // A failed judge left no archived verdict, so such a finding is never eligible: it has nothing to score against.
    if (!match.byId.has(f.id)) continue;
    if (!inTree(f.path)) {
      findingExclusions.push({ run: r.run, finding: f.id, reason: 'file-absent-at-head' });
      continue;
    }
    eligible.push({ ...f, verdict: match.byId.get(f.id) });
  }
  if (eligible.length === 0) return { exclusion: 'no-eligible-findings', findingExclusions };
  return { run: r, eligible, findingExclusions, match };
}

function metRequest(requested, picked) {
  const findings = picked.reduce((n, p) => n + p.eligible.length, 0);
  const bySeverity = {};
  for (const p of picked) for (const f of p.eligible) bump(bySeverity, f.severity);
  if (requested.minRuns !== undefined && picked.length < requested.minRuns) return false;
  if (requested.minFindings !== undefined && findings < requested.minFindings) return false;
  return Object.entries(requested.quota || {}).every(([sev, n]) => (bySeverity[sev] || 0) >= n);
}

const slices = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

function writeJson(fs, file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function extract(opts, deps) {
  const fs = deps.fs;
  const { PROFILES, EFFORT_SCALE } = require(path.join(deps.pluginRoot, 'bin', 'lib', 'model-profiles', 'profiles.js'));
  const request = parseExtractOptions(opts, PROFILES, EFFORT_SCALE);
  if (request.error) {
    deps.err(`review-replay.js: ${request.error}`);
    return 2;
  }
  const { arms, requested } = request;
  if (!isEmptyOrAbsent(fs, opts.out)) {
    deps.err(`review-replay.js: --out ${opts.out} must not exist or must be empty`);
    return 2;
  }
  const dup = (opts.select || []).find((n, i, all) => all.indexOf(n) !== i);
  if (dup !== undefined) {
    deps.err(`review-replay.js: --select names run "${dup}" more than once`);
    return 2;
  }
  const selected = selectRuns(opts.runs, opts.select, fs);
  if (selected.missing.length > 0) {
    deps.err(`review-replay.js: no such run under ${opts.runs}: ${selected.missing.join(', ')}`);
    return 2;
  }

  const templatePath = path.resolve(opts.template || path.join(deps.pluginRoot, 'skills', 'review', 'step3-tiebreak.md'));
  const templateText = fs.readFileSync(templatePath, 'utf8');
  const template = loadTemplate(templateText);
  const corePath = path.resolve(opts['dispatch-core'] || path.join(deps.pluginRoot, 'skills', '_shared', 'subagent-dispatch-core.md'));
  const fallbackDiscipline = disciplineLines(fs.readFileSync(corePath, 'utf8'));
  if (fallbackDiscipline === null) {
    deps.err(`review-replay.js: ${corePath} has no READ-ONLY REVIEW and SHELL DISCIPLINE lines`);
    return 1;
  }

  // Runs in order; whole runs are added until the request is met. With nothing requested, every eligible run is taken.
  const hasRequest = Object.keys(requested).length > 0;
  const excluded = [];
  const picked = [];
  for (const dir of selected.dirs) {
    const x = examineRun(dir, deps);
    if (x.findingExclusions) excluded.push(...x.findingExclusions);
    if (x.exclusion) {
      excluded.push({ run: path.basename(dir), reason: x.exclusion });
      continue;
    }
    picked.push(x);
    if (hasRequest && metRequest(requested, picked)) break;
  }

  const bySeverity = {};
  for (const p of picked) for (const f of p.eligible) bump(bySeverity, f.severity);
  // Nothing eligible is a shortfall too, with or without a request: an empty replay set is not a clean result.
  if (picked.length === 0 || (hasRequest && !metRequest(requested, picked))) {
    const available = { runs: picked.length, findings: picked.reduce((n, p) => n + p.eligible.length, 0), bySeverity };
    deps.err(JSON.stringify({ shortfall: { requested, available }, excluded }));
    return EXIT_SHORTFALL;
  }

  // Selection succeeded: from here on files are written.
  const out = path.resolve(opts.out);
  try {
    return writeOutputs({ out, picked, arms, requested, excluded, bySeverity, template, templateText, templatePath, fallbackDiscipline, PROFILES }, deps);
  } catch (e) {
    deps.err(`review-replay.js: writing ${out} failed: ${String((e && e.message) || e).split('\n')[0]}\nreview-replay.js: ${out} is now partial; remove it before re-running extract`);
    return 1;
  }
}

function writeOutputs(c, deps) {
  const { out, picked, arms, requested, excluded, bySeverity, template, templateText, templatePath, fallbackDiscipline, PROFILES } = c;
  const fs = deps.fs;
  const counts = { fallbackMatched: 0, verdictsWithoutFinding: 0, findingsWithoutVerdict: 0, failedJudgeByReason: {}, disciplineFallbackPrompts: 0 };
  const verdicts = {};
  const fixtureRuns = [];
  const manifestArms = arms.map((a) => ({
    name: a.name, chunk: a.chunk, profile: a.profile, model: PROFILES[a.profile].model, effort: a.effort !== undefined ? a.effort : PROFILES[a.profile].effort, repeat: a.repeat, prompts: [],
  }));

  for (const p of picked) {
    const r = p.run;
    const tree = path.join(out, 'trees', r.run);
    deps.writeTree(r.head, tree);
    const specDir = path.join(tree, '.claude-tweaks', 'pipelines', r.run);
    for (const rel of r.specFiles) {
      fs.mkdirSync(path.dirname(path.join(specDir, rel)), { recursive: true });
      fs.copyFileSync(path.join(r.dir, rel), path.join(specDir, rel));
    }
    // A resumed run's spec lives under an earlier pipeline directory name: put it at the path a finding cites too.
    for (const f of p.eligible) {
      const rel = specFileCited(f.path);
      if (rel === null) continue;
      fs.mkdirSync(path.dirname(path.join(tree, f.path)), { recursive: true });
      fs.copyFileSync(path.join(r.dir, rel), path.join(tree, f.path));
    }
    counts.fallbackMatched += p.match.fallbackMatched;
    counts.verdictsWithoutFinding += p.match.verdictsWithoutFinding;
    counts.findingsWithoutVerdict += p.match.findingsWithoutVerdict;
    for (const [reason, n] of Object.entries(p.match.failedJudgeByReason)) bump(counts.failedJudgeByReason, reason, n);

    const own = r.dispatchBundle === null ? null : disciplineLines(r.dispatchBundle);
    const discipline = own || fallbackDiscipline;
    const findings = p.eligible.map(({ verdict, ...f }) => f);
    for (const f of p.eligible) verdicts[`${r.run}/${f.id}`] = f.verdict;
    fixtureRuns.push({
      run: r.run, tree, head: r.head, base: r.base, findings,
      // null for a run with no readable timing.json: its cost is unknown, not zero, and score reports how many runs lack it.
      baselineTiebreak: r.why.includes('no-timing') ? null : { agents: r.cost.tiebreakAgents, out: r.cost.tbOut, cc: r.cost.tbCc, cr: r.cost.tbCr, seconds: r.cost.tbSeconds },
    });

    manifestArms.forEach((arm) => {
      slices(findings, arm.chunk).forEach((chunk, k) => {
        const name = `${r.run}--${k}`;
        const file = path.join(out, 'prompts', arm.name, `${name}.md`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${buildPrompt(template, chunk, { treeRoot: tree, base: r.base, head: r.head, discipline })}\n`);
        arm.prompts.push({ file, name, run: r.run, findingIds: chunk.map((f) => f.id) });
        if (!own) counts.disciplineFallbackPrompts += 1;
      });
    });
  }

  const totals = { runs: picked.length, findings: picked.reduce((n, p) => n + p.eligible.length, 0), bySeverity };
  fs.mkdirSync(out, { recursive: true });
  writeJson(fs, path.join(out, MANIFEST_FILE), {
    schemaVersion: SCHEMA_VERSION,
    template: { path: templatePath, sha1: crypto.createHash('sha1').update(templateText).digest('hex') },
    arms: manifestArms,
  });
  writeJson(fs, path.join(out, FIXTURE_FILE), { schemaVersion: SCHEMA_VERSION, requested, totals, counts, excluded, runs: fixtureRuns });
  writeJson(fs, path.join(out, VERDICTS_FILE), { schemaVersion: SCHEMA_VERSION, verdicts });
  deps.log(JSON.stringify({ totals, requested, excluded, arms: manifestArms.map((a) => ({ name: a.name, prompts: a.prompts.length })) }, null, 2));
  return 0;
}

module.exports = { extract, parseExtractOptions, parseArm, positiveInt, isEmptyOrAbsent, writeJson };
