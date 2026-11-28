// bin/lib/accept/tripwire.js
// Pure: the diff tripwire (#4619) — does the branch's diff cross an invisible-risk
// category nobody flagged? Two signals: the changed paths against `risk-path-globs`
// (through isSensitivePath, both sides normalized and lowercased; a glob using `{`, `[` or `?`,
// which that matcher reads literally, gets a note), then the agent's classification. Monotonic: the tripwire may add a flag, never remove one —
// `flags` is always `declaredFlags` followed by the newly crossed categories, so it is
// a superset of the declared flags on every input. Fail toward caution: an unread diff,
// unread declared flags, a malformed glob map or a malformed classification is
// `could-not-run` (which forces `local`), never "no crossing found"; an unset or `{}`
// glob map only turns the glob signal off, and says so. Every packet line is one line
// of inert text with each `target:` neutralized, so park-grammar.js's TARGET_RE can
// never read a tripwire line as the packet's target. No I/O.
'use strict';

const path = require('path');
const { isSensitivePath } = require('../issues/blast-radius');
const { inertEvidence } = require('../issues/risk-flag-classify');
const { BUILTIN_RISK_CATEGORIES } = require('../policy-schema');
const { parseNameStatusZ } = require('../git-z');

const MALFORMED_GLOBS = 'risk-path-globs is not a map of category to glob list';
const NOTE_GLOBS_OFF = 'path globs not configured';
const NOTE_AGENT_OFF = 'agent classification not run';

const isStringList = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string');
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function normalizeRepoPath(p) {
  const slashed = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  return path.posix.normalize(slashed).replace(/\/+$/, '').toLowerCase();
}

// A risk-path glob in the shape a normalized path takes: `/` separators, no leading `./` or
// `/`, lowercase, and a trailing `/` read as `dir/**`.
function normalizeGlob(glob) {
  const slashed = glob.replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '').toLowerCase();
  return slashed.endsWith('/') ? `${slashed}**` : slashed;
}

// isSensitivePath matches these characters literally, so a glob using them as syntax never matches.
const UNSUPPORTED_GLOB_RE = /[{[?]/;

// `git diff --name-status -z` -> the paths it names (both sides of a rename or copy), or
// null when any record has an unrecognised status or the wrong path count.
function parseNameStatus(raw) {
  if (typeof raw !== 'string') return null;
  const paths = [];
  for (const { status, paths: recordPaths } of parseNameStatusZ(raw)) {
    const width = /^[AMDT]$/.test(status) ? 1 : /^[RC]\d*$/.test(status) ? 2 : 0;
    if (width === 0 || recordPaths.length !== width) return null;
    paths.push(...recordPaths);
  }
  return paths;
}

const REMOVAL_COMMENT_RE = /^Risk flag ([a-z0-9-]+) removed by the maintainer during shaping$/;

// Trusted comment bodies -> every slug a whole removal line names, first-seen order.
function removalLogSlugs(texts) {
  if (!Array.isArray(texts)) return [];
  const slugs = [];
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    for (const line of text.split(/\r?\n/)) {
      const slug = REMOVAL_COMMENT_RE.exec(line.trim())?.[1];
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    }
  }
  return slugs;
}

function neutralizeTarget(text) {
  return String(text).replace(/(target):/gi, '$1\\:');
}

// Off (undefined, or a plain object with no keys) -> null; valid -> the map; else false.
function readGlobs(globs, categories) {
  if (globs === undefined) return null;
  if (!isPlainObject(globs)) return false;
  const entries = Object.entries(globs);
  if (entries.length === 0) return null;
  const valid = entries.every(([category, list]) => categories.includes(category) && isStringList(list));
  return valid ? globs : false;
}

const isClassificationEntry = (entry) => isPlainObject(entry)
  && typeof entry.category === 'string' && typeof entry.evidence === 'string';

function couldNotRun(reason, declaredFlags) {
  return {
    status: 'could-not-run', reason, crossed: [], newFlags: [], reportedFlags: [],
    flags: Array.isArray(declaredFlags) ? [...declaredFlags] : [], notes: [], removedThenCrossed: [],
  };
}

function evaluateTripwire({
  changedPaths, diffError, declaredFlags, tripwireFlags = [], removedFlags = null, globs, agentClassification,
  categories = BUILTIN_RISK_CATEGORIES,
} = {}) {
  if (!isStringList(changedPaths)) {
    return couldNotRun(typeof diffError === 'string' && diffError !== '' ? diffError : 'changed paths not read', declaredFlags);
  }
  if (!isStringList(declaredFlags)) return couldNotRun('declared flags not read', declaredFlags);
  if (!isStringList(tripwireFlags)) return couldNotRun('tripwire flags not read', declaredFlags);
  if (!isStringList(categories)) return couldNotRun('risk categories not read', declaredFlags);
  const globMap = readGlobs(globs, categories);
  if (globMap === false) return couldNotRun(MALFORMED_GLOBS, declaredFlags);
  const classification = agentClassification ?? null;
  if (classification !== null && !(Array.isArray(classification) && classification.every(isClassificationEntry))) {
    return couldNotRun('agent classification malformed', declaredFlags);
  }

  const notes = [];
  const crossings = []; // { category, via, evidence, path }
  const isCrossed = (category) => crossings.some((c) => c.category === category);

  if (globMap === null) {
    notes.push(NOTE_GLOBS_OFF);
  } else {
    for (const category of categories) {
      if (!Object.hasOwn(globMap, category)) continue;
      for (const glob of globMap[category].filter((g) => UNSUPPORTED_GLOB_RE.test(g))) {
        const note = `risk-path-globs glob uses unsupported syntax ({, [ or ?) and never matches: ${inertEvidence(glob)}`;
        if (!notes.includes(note)) notes.push(note);
      }
      const hit = firstGlobHit(changedPaths, globMap[category]);
      if (hit) crossings.push({ category, via: 'glob', evidence: inertEvidence(`${hit.glob}: ${hit.path}`), path: hit.path });
    }
  }

  if (classification === null) {
    notes.push(NOTE_AGENT_OFF);
  } else {
    for (const { category, evidence } of classification) {
      if (!categories.includes(category)) {
        const note = `agent classification category ignored: ${inertEvidence(category)}`;
        if (!notes.includes(note)) notes.push(note);
      } else if (!isCrossed(category)) {
        crossings.push({ category, via: 'agent', evidence: inertEvidence(evidence), path: null });
      }
    }
  }

  const crossed = crossings.map(({ category, via, evidence }) => ({ category, via, evidence }));
  const newFlags = crossings.map((c) => c.category).filter((category) => !declaredFlags.includes(category));
  // reportedFlags: the crossed categories the packet explains. A category nobody had declared is
  // new on the first decide (newFlags); the write that follows records it on the record's
  // `Risk-flags-added-by-tripwire:` line (tripwireFlags), so a re-run of decide on the same diff
  // finds it already declared (newFlags empty) and would drop the packet's reason. A category
  // the human declared (declaredFlags minus tripwireFlags) stays silent: AC 2, no change.
  // tripwireFlags, categories and diffError are inputs the spec's pinned signature predates
  // (spec: Build Deviations 6).
  const reportedFlags = crossings.map((c) => c.category)
    .filter((category) => newFlags.includes(category) || tripwireFlags.includes(category));
  const removed = isStringList(removedFlags) ? removedFlags : [];
  const removedThenCrossed = crossings
    .filter((c) => reportedFlags.includes(c.category) && removed.includes(c.category))
    .map((c) => ({ category: c.category, evidence: c.evidence, path: c.path === null ? null : inertEvidence(c.path) }));

  return { status: 'ok', crossed, newFlags, reportedFlags, flags: [...declaredFlags, ...newFlags], notes, removedThenCrossed };
}

// The first (path, glob) pair that matches, paths in diff order, or null.
function firstGlobHit(changedPaths, globList) {
  const lowered = globList.map(normalizeGlob);
  for (const p of changedPaths) {
    const normalized = normalizeRepoPath(p);
    const i = lowered.findIndex((glob) => isSensitivePath(normalized, [glob]));
    if (i !== -1) return { glob: globList[i], path: p };
  }
  return null;
}

function tripwireLines(result, { appendFailure } = {}) {
  const lines = [];
  if (result.status === 'could-not-run') {
    lines.push(`tripwire could not run: ${inertEvidence(result.reason)}`);
  } else {
    const removedCategories = result.removedThenCrossed.map((r) => r.category);
    for (const category of result.reportedFlags) {
      if (removedCategories.includes(category)) continue;
      const { evidence } = result.crossed.find((c) => c.category === category);
      lines.push(`tripwire: the diff crosses ${inertEvidence(category)} (${evidence}), which nobody flagged, so this run is local`);
    }
    for (const { category, evidence, path: touched } of result.removedThenCrossed) {
      lines.push(`tripwire: you removed the ${inertEvidence(category)} flag at intent; the diff touches ${touched ?? evidence}, so this run is local`);
    }
    for (const note of result.notes) lines.push(`tripwire: ${note}`);
  }
  if (typeof appendFailure === 'string' && appendFailure !== '') {
    lines.push(`tripwire: the flag write failed (${inertEvidence(appendFailure)}), so this run is local`);
  }
  return lines.map(neutralizeTarget);
}

module.exports = {
  evaluateTripwire, normalizeRepoPath, parseNameStatus, REMOVAL_COMMENT_RE, removalLogSlugs,
  neutralizeTarget, tripwireLines,
};
