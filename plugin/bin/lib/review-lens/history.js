'use strict';

// Per-lens review history (#5998): for each review lens 3a..3h, how many of the last N qualifying pipeline runs
// confirmed a finding, read from run directories under one or more pipelines roots and their `archive/`.
//
// Reads, per run directory: `lens-dispatch.json` (the denominator; `review-coordination.js record-lens-dispatch`
// is its one writer — see dispatch-record.js), `spec-{N}/lens-dispatch.json` for a multi-member run, `run-state.json`,
// and `step-yield.json` (the numerator, `byLens` confirmed counts — docs/reference/step-yield.md).
//
// Qualifying rule: a run counts for a lens only when exactly one dispatch source holds entries for it and that
// source has an entry `status: 'completed'` with `reviewers: 2`. Failed, blocked and single-reviewer dispatches never
// qualify; a run with no dispatch file counts for no lens (no legacy derivation). Qualifying runs are filtered first,
// then the newest N (run id's leading UTC timestamp, never directory order) are taken.
// Confirmed = `both` + tiebreak `byVerdict.confirmed`, summed over every step bucket and `unattributed`; `relabeled`
// adds nothing. A qualifying run whose lens has no finding line counts 0 — the dispatch is the evidence, not the finding.
//
// Closed rule: a run is not closed when it has neither a `step-yield.json` nor a `clean` `run-state.json`, or when
// `runLiveness(dir).verdict` is `live` (probed only when the first test does not already decide). A not-closed run is
// listed in `skipped` ("run not closed"), never counted and never an error; a closed run whose yield is missing or not a
// schemaVersion-1 yield is an `errors` entry, never read as 0. A run with no dispatch file is never counted, but a
// malformed yield in it is still reported (errors if closed, skipped if not).
// A run dir that cannot be listed for its spec-N members is an `errors` entry and is excluded (never read as a run without members).
// Multi-member rule: two or more dispatch sources holding entries for a lens exclude the run for that lens (`skipped`).
// Archive-twin rule: one run id under a root and `{root}/archive` (or two roots) counts once — the copy with a clean
// run-state or a step-yield wins, then `archive/`, then the first root; the other is `skipped`.
//
// Nothing is dropped silently: `skipped` is the legitimate exclusions, `errors` the inputs that could not be read.
// Result: { lenses: {"3a".."3h": {runs, confirmed, perRun, shareWithFinding, insufficient}}, skipped, errors }.

const fs = require('node:fs');
const path = require('node:path');
const { runLiveness } = require('../run-liveness');
const { lstatType } = require('../path-guard');
const { SCHEMA_VERSION, STEP_YIELD_FILE, ownGet } = require('../timing/step-yield');
const { LENS_IDS, LENS_DISPATCH_FILE, readLensDispatch } = require('./dispatch-record');

const DEFAULT_N = 20;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(v) ? v : 0);

// The one `confirmed` definition: tools/step-yield-report.js imports it for its per-lens table.
function confirmedCount(findings) {
  if (!isObject(findings)) return 0;
  const verdicts = findings.tiebreak && findings.tiebreak.byVerdict;
  return num(findings.both) + num(verdicts && verdicts.confirmed);
}

// The run id's leading YYYY-MM-DDTHHMMSS read as UTC -> an ISO string, or null when it is not a real instant.
function startedAtOf(runId) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(runId);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const ok = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === s;
  return ok ? t.toISOString() : null;
}

const codeOf = (err) => (err && err.code) || 'unknown';

// Child directory names, or { error: code }. A missing directory is `{ names: [], missing: true }`.
function childDirs(dir) {
  try {
    const names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    return { names };
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return { names: [], missing: true, code: err.code };
    return { error: codeOf(err) };
  }
}

// { state: 'missing' } | { state: 'ok', doc } | { state: 'error', reason }.
function readYield(dir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, STEP_YIELD_FILE), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: 'missing' };
    return { state: 'error', reason: `unreadable (${codeOf(err)})` };
  }
  let doc;
  try { doc = JSON.parse(raw); } catch { return { state: 'error', reason: 'step-yield.json unparseable' }; }
  if (!isObject(doc) || doc.schemaVersion !== SCHEMA_VERSION || !Array.isArray(doc.steps)) {
    return { state: 'error', reason: `step-yield.json is not a schemaVersion ${SCHEMA_VERSION} yield` };
  }
  return { state: 'ok', doc };
}

function isCleanState(dir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8'));
    return isObject(doc) && doc.status === 'clean';
  } catch {
    return false;
  }
}

const hasYieldFile = (dir) => lstatType(path.join(dir, STEP_YIELD_FILE)).type === 'file';
const hasCloseEvidence = (dir) => isCleanState(dir) || hasYieldFile(dir);

// The step-yield `byLens` confirmed count for one lens, summed over every step bucket and the unattributed one.
function confirmedForLens(doc, lens) {
  const buckets = [...doc.steps, doc.unattributed];
  let total = 0;
  for (const b of buckets) {
    if (!isObject(b) || !isObject(b.findings) || !isObject(b.findings.byLens)) continue;
    total += confirmedCount(ownGet(b.findings.byLens, lens));
  }
  return total;
}

function collectRunDirs(roots, errors) {
  const found = [];
  roots.forEach((root, rootIndex) => {
    const top = childDirs(root);
    // A root that is missing is as unreadable as one that denies access: never read as empty.
    if (top.error || top.missing) { errors.push({ path: root, reason: `unreadable root (${top.error || top.code})` }); return; }
    for (const name of top.names) {
      if (name !== 'archive') found.push({ dir: path.join(root, name), name, archive: false, rootIndex });
    }
    const arch = childDirs(path.join(root, 'archive'));
    if (arch.error) { errors.push({ path: path.join(root, 'archive'), reason: `unreadable archive (${arch.error})` }); return; }
    for (const name of arch.names) {
      if (name !== 'archive') found.push({ dir: path.join(root, 'archive', name), name, archive: true, rootIndex });
    }
  });
  return found;
}

// One copy per run id (the archive-twin rule); the others go to `skipped`.
function dedupe(found, skipped) {
  const groups = new Map();
  for (const r of found) {
    if (!groups.has(r.name)) groups.set(r.name, []);
    groups.get(r.name).push(r);
  }
  const kept = [];
  for (const group of groups.values()) {
    if (group.length === 1) { kept.push(group[0]); continue; }
    const ranked = group
      .map((r) => ({ r, evidence: hasCloseEvidence(r.dir) ? 1 : 0 }))
      .sort((a, b) => (b.evidence - a.evidence) || (Number(b.r.archive) - Number(a.r.archive)) || (a.r.rootIndex - b.r.rootIndex));
    const winner = ranked[0].r;
    kept.push(winner);
    for (const { r } of ranked.slice(1)) skipped.push({ path: r.dir, reason: `duplicate run id (kept ${winner.dir})` });
  }
  return kept;
}

// Dispatch sources of a run: the parent file and each spec-N child. { sources: [{ name, dir, read }] } or, when
// the run dir cannot be listed for its spec-N members, { error: code } — never read as "no members".
function dispatchSources(dir) {
  const children = childDirs(dir);
  if (children.error) return { error: children.error };
  const sources = [{ name: LENS_DISPATCH_FILE, dir, read: readLensDispatch(dir) }];
  const specs = children.names.filter((n) => /^spec-\d+$/.test(n))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  for (const n of specs) sources.push({ name: n, dir: path.join(dir, n), read: readLensDispatch(path.join(dir, n)) });
  return { sources };
}

const newestFirst = (a, b) => {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  if (a.runId !== b.runId) return a.runId < b.runId ? 1 : -1;
  return 0;
};

function readLensHistory({ roots, n = DEFAULT_N, liveness } = {}) {
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every((r) => typeof r === 'string' && r !== '')) {
    throw new TypeError('roots must be a non-empty array of strings');
  }
  if (!Number.isInteger(n) || n < 1) throw new TypeError('n must be a positive integer');
  if (liveness !== undefined && typeof liveness !== 'function') throw new TypeError('liveness must be a function');
  const verdictOf = liveness || ((dir) => runLiveness(dir).verdict);

  const skipped = [];
  const errors = [];
  const perLens = new Map(LENS_IDS.map((id) => [id, []]));

  // Closed check (liveness probed only when the file evidence does not already decide).
  const isClosed = (dir) => hasCloseEvidence(dir) && verdictOf(dir) !== 'live';

  for (const run of dedupe(collectRunDirs(roots, errors), skipped)) {
    const { dir, name } = run;
    const listed = dispatchSources(dir);
    if (listed.error) { errors.push({ path: dir, reason: `unreadable spec members (${listed.error})` }); continue; }
    const { sources } = listed;
    const anyDispatch = sources.some((s) => s.read.state !== 'absent');

    if (!anyDispatch) {
      // Never counted; a malformed yield is still reported.
      const y = readYield(dir);
      if (y.state === 'error') {
        if (isClosed(dir)) errors.push({ path: path.join(dir, STEP_YIELD_FILE), reason: y.reason });
        else skipped.push({ path: dir, reason: 'run not closed' });
      }
      continue;
    }

    const startedAt = startedAtOf(name);
    if (startedAt === null) { skipped.push({ path: dir, reason: 'run id has no parseable start time' }); continue; }
    if (!isClosed(dir)) { skipped.push({ path: dir, reason: 'run not closed' }); continue; }

    const broken = sources.filter((s) => s.read.state === 'error');
    if (broken.length > 0) {
      for (const s of broken) errors.push({ path: path.join(s.dir, LENS_DISPATCH_FILE), reason: s.read.reason });
      continue;
    }

    const y = readYield(dir);
    if (y.state === 'missing') { errors.push({ path: path.join(dir, STEP_YIELD_FILE), reason: 'step-yield.json missing' }); continue; }
    if (y.state === 'error') { errors.push({ path: path.join(dir, STEP_YIELD_FILE), reason: y.reason }); continue; }

    for (const lens of LENS_IDS) {
      const holding = sources.filter((s) => s.read.state === 'ok' && s.read.entries.some((e) => e.lens === lens));
      if (holding.length === 0) continue;
      if (holding.length > 1) {
        skipped.push({ path: dir, reason: `multi-member dispatch (lens ${lens}: ${holding.map((s) => s.name).join(', ')})` });
        continue;
      }
      const qualifies = holding[0].read.entries.some((e) => e.lens === lens && e.status === 'completed' && e.reviewers === 2);
      if (!qualifies) continue;
      perLens.get(lens).push({ runId: name, startedAt, confirmed: confirmedForLens(y.doc, lens) });
    }
  }

  const lenses = {};
  for (const lens of LENS_IDS) {
    const picked = perLens.get(lens).sort(newestFirst).slice(0, n);
    const runs = picked.length;
    const confirmed = picked.reduce((a, r) => a + r.confirmed, 0);
    lenses[lens] = {
      runs,
      confirmed,
      perRun: runs ? confirmed / runs : null,
      shareWithFinding: runs ? picked.filter((r) => r.confirmed > 0).length / runs : null,
      insufficient: runs < n,
    };
  }
  return { lenses, skipped, errors };
}

module.exports = { DEFAULT_N, confirmedCount, startedAtOf, readLensHistory };
