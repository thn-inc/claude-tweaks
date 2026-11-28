// bin/lib/skill-gate/index.js — the skill-load gate's rules (record #5605):
// decide whether a lifecycle step loads `journeys`, `visual-review`, or
// `design-wrapper {mode}` at all, before the skill's text enters context.
// `skip` means the skill has nothing to do; every other input is `proceed`
// (the closed rule). Pure: decide() takes the changed files already resolved
// (or `{ error }`) and a lazy loadJourneys(), so the IO layer and the CLI
// (bin/skill-gate.js) own every fs and git read.
//
// A `proceed` this module cannot rule on carries a reason starting
// CANNOT_TELL and `cannotTell: true` (spec Deliverable 4); a proceed a rule
// reached never starts with that prefix. design-detect's SKIP_REASONS are a
// wire contract and pass through verbatim.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  evaluate,
  layer1,
  fileMatchesFrontendPredicate,
  SKIP_REASONS,
} = require('../design-detect');
const { lstatType, resolveLeaf, canonicalRealpath, isAncestorOrSelf } = require('../path-guard');
const { splitFrontmatterFence, parseFrontmatterListField } = require('../health-core/frontmatter-list');
const { resolveBase, changedFiles } = require('../verify/changed-files');
// GIT_TIMEOUT_MS is a getter (env var and policy); read it at call time.
const sharedPrimitives = require('../shared-primitives');

const SKILLS = ['journeys', 'visual-review', 'design-wrapper'];
const WRAPPER_MODES = ['pre-build', 'test', 'review', 'polish', 'survey'];
const CANNOT_TELL = 'cannot tell: ';

// The no-surface set: test code and pipeline artifacts, which no journey
// persona uses. Display strings only — matching is the hand-written,
// whole-segment, case-sensitive predicate per entry in NO_SURFACE_MATCHERS.
const NO_SURFACE_SET = Object.freeze([
  'test/**',
  'tests/**',
  '**/__tests__/**',
  '**/*.test.{js,jsx,ts,tsx,cjs,mjs,cts,mts}',
  '**/*.spec.{js,jsx,ts,tsx,cjs,mjs,cts,mts}',
  '.claude-tweaks/pipelines/**',
  'docs/superpowers/plans/**',
  'docs/plans/*-ledger.md',
]);

const TEST_NAME = /\.test\.(js|jsx|ts|tsx|cjs|mjs|cts|mts)$/;
const SPEC_NAME = /\.spec\.(js|jsx|ts|tsx|cjs|mjs|cts|mts)$/;

// One predicate per NO_SURFACE_SET entry, same order; each takes the path's
// `/`-segments.
const NO_SURFACE_MATCHERS = [
  (s) => s[0] === 'test' && s.length > 1,
  (s) => s[0] === 'tests' && s.length > 1,
  (s) => s.slice(0, -1).includes('__tests__'),
  (s) => TEST_NAME.test(s[s.length - 1]),
  (s) => SPEC_NAME.test(s[s.length - 1]),
  (s) => s[0] === '.claude-tweaks' && s[1] === 'pipelines' && s.length > 2,
  (s) => s[0] === 'docs' && s[1] === 'superpowers' && s[2] === 'plans' && s.length > 3,
  (s) => s.length === 3 && s[0] === 'docs' && s[1] === 'plans' && s[2].endsWith('-ledger.md'),
];

const VISUAL_SIGNAL_SURFACES = ['web', 'mobile', 'desktop'];
const VISUAL_NO_SIGNAL_SURFACES = ['backend', 'infra', 'terminal'];
const KNOWN_SURFACES = [...VISUAL_SIGNAL_SURFACES, ...VISUAL_NO_SIGNAL_SURFACES];

// Reads a surface value as design-detect's layer2 does: lower-cased, legacy
// `frontend` as `web`.
function normalizeSurface(value) {
  if (value == null || value === '') return { kind: 'absent' };
  const s = String(value).toLowerCase();
  const normalized = s === 'frontend' ? 'web' : s;
  if (KNOWN_SURFACES.includes(normalized)) return { kind: 'known', value: normalized };
  return { kind: 'unrecognised', raw: String(value) };
}

function inNoSurfaceSet(file) {
  const segments = file.split('/');
  return NO_SURFACE_MATCHERS.some((m) => m(segments));
}

// A path the gate will not match because it is not in git's canonical
// repo-relative shape. No normalisation: such a path gives `proceed`.
function pathShapeProblem(file) {
  if (typeof file !== 'string' || file === '') return 'empty path';
  if (file.includes('://')) return 'a URL scheme (://)';
  if (file.includes('\\')) return 'a backslash';
  if (file.includes('%')) return 'a percent sign';
  if (file.startsWith('/')) return 'a leading /';
  if (file.endsWith('/')) return 'a trailing /';
  const segments = file.split('/');
  if (segments.some((s) => s === '.' || s === '..')) return 'a . or .. segment';
  if (segments.includes('')) return 'an empty segment';
  return null;
}

function isJourneyPath(file) {
  const s = file.split('/');
  return s[0] === 'docs' && s[1] === 'journeys' && s.length > 2;
}

// Mirrors journeyFileExists in bin/lib/journey-health/scope.js: a `*` only
// in the last segment matches `[^/]*`, the dirname compared literally. Any
// other wildcard is one the gate cannot match.
function journeyEntryMatch(entry, file) {
  if (typeof entry !== 'string') return 'unmatchable';
  // An entry not in git's canonical repo-relative shape (`./a.js`, a leading /)
  // can never equal a changed path: the gate cannot match it, so it says so.
  if (pathShapeProblem(entry) !== null) return 'unmatchable';
  if (entry.includes('?') || entry.includes('[') || entry.includes('**')) return 'unmatchable';
  const cut = entry.lastIndexOf('/');
  const dir = entry.slice(0, cut + 1);
  const base = entry.slice(cut + 1);
  if (dir.includes('*')) return 'unmatchable';
  if (!base.includes('*')) return entry === file ? 'match' : 'no-match';
  if (!file.startsWith(dir)) return 'no-match';
  const pattern = base.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${pattern}$`).test(file.slice(dir.length)) ? 'match' : 'no-match';
}

function cannotTell(what) {
  return { decision: 'proceed', reason: `${CANNOT_TELL}${what}`, cannotTell: true };
}

function proceed(reason) {
  return { decision: 'proceed', reason };
}

function filesProblem(files) {
  if (!Array.isArray(files)) {
    const error = files && typeof files.error === 'string' ? files.error : 'no file list';
    return `changed files could not be resolved (${error})`;
  }
  if (files.length === 0) return 'the changed-file list is empty';
  return null;
}

function journeysOrError(loadJourneys) {
  const loaded = loadJourneys();
  if (!loaded || !Array.isArray(loaded.journeys)) {
    const error = loaded && typeof loaded.error === 'string' ? loaded.error : 'no journeys result';
    return { error: `journeys could not be read (${error})` };
  }
  return { journeys: loaded.journeys };
}

function entriesOf(journey) {
  return Array.isArray(journey.files) ? journey.files : [];
}

function decideDesignWrapper({ mode, surface, files, designIntegration }) {
  if (mode === 'pre-build') {
    const l1 = layer1(designIntegration);
    if (!l1.proceed) return { decision: 'skip', reason: l1.reason };
    const s = normalizeSurface(surface);
    if (s.kind === 'absent') return { decision: 'skip', reason: 'no surface declared' };
    if (s.kind === 'unrecognised') return cannotTell(`unrecognised surface "${s.raw}"`);
    if (s.value === 'backend' || s.value === 'infra') {
      return { decision: 'skip', reason: SKIP_REASONS.NON_FRONTEND_SURFACE };
    }
    return proceed(`surface ${s.value} routed to pre-build`);
  }
  if (!WRAPPER_MODES.includes(mode)) throw new Error(`skill-gate: unknown design-wrapper mode "${mode}"`);
  if (!Array.isArray(files)) return cannotTell(filesProblem(files));
  const e = evaluate({ mode, designIntegrationValue: designIntegration, surface, files });
  return { decision: e.decision, reason: e.reason !== undefined ? e.reason : `design-detect proceeds (track ${e.track})` };
}

function decideVisualReview({ surface, files, loadJourneys }) {
  const problem = filesProblem(files);
  if (problem) return cannotTell(problem);
  const s = normalizeSurface(surface);
  if (s.kind === 'known' && VISUAL_SIGNAL_SURFACES.includes(s.value)) {
    return proceed(`frontend surface declared (${s.value})`);
  }
  if (s.kind === 'unrecognised') return cannotTell(`unrecognised surface "${s.raw}"`);
  for (const f of files) {
    const shape = pathShapeProblem(f);
    if (shape) return proceed(`changed path has ${shape}: ${f}`);
  }
  const trigger = files.find(fileMatchesFrontendPredicate);
  if (trigger) return proceed(`UI trigger file in the diff: ${trigger}`);
  const loaded = journeysOrError(loadJourneys);
  if (loaded.error) return cannotTell(loaded.error);
  const overlapping = new Set();
  for (const j of loaded.journeys) {
    if (entriesOf(j).some((entry) => files.some((f) => journeyEntryMatch(entry, f) === 'match'))) {
      overlapping.add(j.name);
    }
  }
  const surfaceText = s.kind === 'known' ? `surface: ${s.value}` : 'no surface declared';
  return {
    decision: 'skip',
    reason: `no frontend surface (${surfaceText}) and no UI trigger file in the diff`,
    journeys: [...overlapping].sort(),
  };
}

function decideJourneys({ files, loadJourneys }) {
  const problem = filesProblem(files);
  if (problem) return cannotTell(problem);
  for (const f of files) {
    const shape = pathShapeProblem(f);
    if (shape) return proceed(`changed path has ${shape}: ${f}`);
  }
  const outside = files.find((f) => !inNoSurfaceSet(f));
  if (outside) return proceed(`changed file outside the no-surface set: ${outside}`);
  const journeyFile = files.find(isJourneyPath);
  if (journeyFile) return proceed(`changed journey file: ${journeyFile}`);
  const loaded = journeysOrError(loadJourneys);
  if (loaded.error) return cannotTell(loaded.error);
  for (const j of loaded.journeys) {
    const entry = entriesOf(j).find((e) => files.some((f) => journeyEntryMatch(e, f) === 'unmatchable'));
    if (entry !== undefined) return proceed(`journey ${j.name} has a files: entry the gate cannot match: ${entry}`);
  }
  for (const j of loaded.journeys) {
    for (const entry of entriesOf(j)) {
      const f = files.find((file) => journeyEntryMatch(entry, file) === 'match');
      if (f !== undefined) return proceed(`journey ${j.name} lists changed file ${f}`);
    }
  }
  return { decision: 'skip', reason: 'every changed file is test code or a pipeline artifact, and no journey lists one' };
}

function decide({ skill, mode, surface, files, designIntegration, loadJourneys } = {}) {
  if (skill === 'design-wrapper') return decideDesignWrapper({ mode, surface, files, designIntegration });
  if (skill === 'visual-review') return decideVisualReview({ surface, files, loadJourneys });
  if (skill === 'journeys') return decideJourneys({ files, loadJourneys });
  throw new Error(`skill-gate: unknown skill "${skill}"`);
}

// --- IO layer: journey reads and the changed-file resolution ---

// The `files:` list of one journey file's text. Pure. `{ files: null }` when
// the file has no frontmatter or no `files:` key (a journey that lists
// nothing); `{ error }` when the frontmatter never closes or `files:` carries
// an inline value (`files: [a.js]`) the list reader would silently read as
// empty. CRLF reads as LF; surrounding quotes are stripped from each item.
function parseJourneyText(text) {
  const source = String(text);
  const firstLine = source.split(/\r?\n/, 1)[0];
  if (firstLine !== '---') {
    // A fence the list reader would not see (BOM, trailing space) is frontmatter
    // the gate cannot read, not a journey that lists nothing.
    if (firstLine.replace(/^﻿/, '').trim() === '---') return { error: 'frontmatter fence is not exactly ---' };
    return { files: null };
  }
  const fence = splitFrontmatterFence(source);
  if (!fence) return { error: 'frontmatter never closes' };
  if (fence.frontmatter.some((l) => /^files:\s*\S/.test(l))) {
    return { error: 'files: has an inline value; the gate reads only the block list form' };
  }
  const fieldIdx = fence.frontmatter.findIndex((l) => /^files:\s*$/.test(l));
  if (fieldIdx === -1) return { files: null };
  // The list reader stops at the first line that is not a bare `- item`, and keeps
  // an inline comment in the item. Either misread would list less than the journey
  // does, so a comment or blank line inside the list, or an item with ` #`, is an error.
  for (let i = fieldIdx + 1; i < fence.frontmatter.length; i++) {
    const line = fence.frontmatter[i];
    const m = line.match(/^\s*-\s*(.+?)\s*$/);
    if (m) {
      if (/\s#/.test(m[1])) return { error: 'files: has an item with an inline comment' };
    } else if (/^[A-Za-z_][\w-]*:/.test(line)) {
      break;
    } else {
      return { error: 'files: list has a blank, comment or unreadable line' };
    }
  }
  const items = parseFrontmatterListField(source, 'files');
  return { files: items.map((i) => i.replace(/^(["'])(.*)\1$/, '$2')) };
}

function errMessage(e) {
  return (e && e.message) || String(e);
}

// One directory on the way to the journeys: `{ missing: true }` when it is
// absent (lstat, never followed), `{ error }` when it is a symlink that
// dangles or resolves outside the checkout, or cannot be read; else `{}`.
function guardDir(p, label, rootReal, fsImpl) {
  const leaf = lstatType(p, { fsImpl });
  if (leaf.type === 'missing') return { missing: true };
  if (leaf.type === 'unreadable') return { error: `${label} could not be read (${leaf.code})` };
  if (leaf.type !== 'symlink') return {};
  const resolved = resolveLeaf(p, { fsImpl });
  if (resolved.state === 'dangling') return { error: `${label} is a dangling symlink` };
  if (resolved.state !== 'resolved') return { error: `${label} could not be resolved (${resolved.state})` };
  if (!isAncestorOrSelf(rootReal, resolved.path)) return { error: `${label} is a symlink that resolves outside the checkout` };
  return {};
}

// Top-level `docs/journeys/*.md` only, sorted by name. A directory that is
// truly missing (not a symlink) is no journeys; every other read problem is an
// error the caller turns into a cannot-tell. `docs` and `docs/journeys` are
// checked before the directory is listed, and a symlinked entry is read only
// when it resolves inside `root`.
function readJourneys(root, { fsImpl = fs } = {}) {
  const docsDir = path.join(root, 'docs');
  const dir = path.join(docsDir, 'journeys');
  const rootReal = canonicalRealpath(root, { fsImpl });
  if (rootReal === null) return { error: 'the checkout root could not be resolved' };
  for (const [p, label] of [[docsDir, 'docs'], [dir, 'docs/journeys']]) {
    const g = guardDir(p, label, rootReal, fsImpl);
    if (g.error) return { error: g.error };
    if (g.missing) return { journeys: [] };
  }
  let names;
  try {
    names = fsImpl.readdirSync(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { journeys: [] };
    return { error: `docs/journeys could not be read: ${errMessage(e)}` };
  }
  const journeys = [];
  for (const entry of names.filter((n) => n.endsWith('.md')).sort()) {
    const file = path.join(dir, entry);
    const leaf = lstatType(file, { fsImpl });
    if (leaf.type === 'symlink') {
      const resolved = resolveLeaf(file, { fsImpl });
      if (resolved.state === 'dangling') return { error: `journey ${entry} is a dangling symlink` };
      if (resolved.state !== 'resolved') return { error: `journey ${entry} could not be resolved (${resolved.state})` };
      if (!isAncestorOrSelf(rootReal, resolved.path)) {
        return { error: `journey ${entry} is a symlink that resolves outside the checkout` };
      }
    }
    let text;
    try {
      text = fsImpl.readFileSync(file, 'utf8');
    } catch (e) {
      return { error: `journey ${entry} could not be read: ${errMessage(e)}` };
    }
    const parsed = parseJourneyText(text);
    if (parsed.error) return { error: `journey ${entry}: ${parsed.error}` };
    journeys.push({ name: entry.slice(0, -'.md'.length), files: parsed.files });
  }
  return { journeys };
}

// Resolves the changed files when only a branch was given, runs the rules,
// and turns any throw into a cannot-tell proceed. The reason is collapsed to
// one line: the CLI writes it to stderr as exactly one line.
function gate({
  skill, mode, surface, files, integrationBranch, root, designIntegration,
  env, execImpl, decideImpl = decide, fsImpl,
}) {
  const exec = execImpl || ((cmd, args, opts) => execFileSync(cmd, args, { ...opts, cwd: root, env, timeout: sharedPrimitives.GIT_TIMEOUT_MS, windowsHide: true }));
  let list = files;
  if (list == null && integrationBranch) {
    try {
      const base = resolveBase({ integrationBranch, requireNonDegenerate: true, execImpl: exec });
      list = changedFiles({ base, execImpl: exec }).files;
    } catch (e) {
      list = { error: errMessage(e) };
    }
  }
  let result;
  try {
    result = decideImpl({
      skill, mode, surface, files: list, designIntegration,
      loadJourneys: () => readJourneys(root, { fsImpl }),
    });
  } catch (e) {
    return cannotTell(`gate error: ${errMessage(e)}`.replace(/\s+/g, ' '));
  }
  if (result && result.cannotTell) return { ...result, reason: result.reason.replace(/\s+/g, ' ').trim() };
  return result;
}

module.exports = {
  parseJourneyText,
  readJourneys,
  gate,
  SKILLS,
  WRAPPER_MODES,
  CANNOT_TELL,
  NO_SURFACE_SET,
  VISUAL_SIGNAL_SURFACES,
  VISUAL_NO_SIGNAL_SURFACES,
  normalizeSurface,
  inNoSurfaceSet,
  pathShapeProblem,
  isJourneyPath,
  journeyEntryMatch,
  decide,
};
