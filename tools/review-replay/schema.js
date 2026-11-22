'use strict';
// tools/review-replay/schema.js — the one home of the replay tool's schemas. `extract` writes them and `score`
// reads them; both import every key list from here, so the two sides cannot drift.

const SCHEMA_VERSION = 1;
const MANIFEST_FILE = 'manifest.json';
const FIXTURE_FILE = 'fixture.json';
const VERDICTS_FILE = 'archived-verdicts.json';
const JOURNAL_FILE = 'journal.jsonl';

const VERDICT_CLASSES = ['confirmed', 'refuted', 'cant-tell'];

// Why a run, or one of its findings, is left out of the replay set.
const EXCLUSION_REASONS = [
  'no-decisions',
  'decisions-unreadable',
  'no-review',
  'no-findings-artifact',
  'findings-unreadable',
  'no-fix-commit',
  'fix-commit-not-in-clone',
  'no-recorded-base',
  'head-not-in-clone',
  'file-absent-at-head',
  'no-eligible-findings',
];

const MANIFEST_KEYS = ['schemaVersion', 'template', 'arms'];
const ARM_KEYS = ['name', 'chunk', 'profile', 'model', 'effort', 'repeat', 'prompts'];
const PROMPT_KEYS = ['file', 'name', 'run', 'findingIds'];
const JOURNAL_EVENT_TYPES = ['started', 'result'];

// The identity line the workflow puts first in each judge's prompt; score reads it back from the agent's transcript.
const IDENTITY_RE = /^Replay judge (\S+)\.$/m;

// The archived runs' own records. The extracted tree leaves this directory out (extract's writeTree pathspec) and
// eligibility treats a path under it as absent, both through this one definition so the two cannot drift. The only
// thing put back is a run's spec file, at the path a finding cites (specFileCited).
const RUN_RECORDS_DIR = '.claude-tweaks/pipelines';
const isRunRecordPath = (p) => p === RUN_RECORDS_DIR || String(p).startsWith(`${RUN_RECORDS_DIR}/`);

// `work/<file>` when `p` is `<RUN_RECORDS_DIR>/<dir>/work/<file>` (the spec path a finding of a resumed run cites), else null.
function specFileCited(p) {
  const rest = String(p).startsWith(`${RUN_RECORDS_DIR}/`) ? String(p).slice(RUN_RECORDS_DIR.length + 1).split('/') : [];
  const ok = rest.length === 3 && rest[1] === 'work' && rest.every((s) => s !== '' && s !== '.' && s !== '..');
  return ok ? `work/${rest[2]}` : null;
}

// A native path as the forward-slash spelling the judge prompt uses.
const toPosix = (p) => String(p).replace(/\\/g, '/');

const armLabel = (arm, repeat, name) => `${arm}|${repeat}|${name}`;

// The label back as { arm, repeat (a number), name }, or null when it is not one armLabel produced.
function parseArmLabel(label) {
  const m = /^([^|]+)\|(\d+)\|([^|]+)$/.exec(String(label));
  return m ? { arm: m[1], repeat: Number(m[2]), name: m[3] } : null;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function keyProblems(where, obj, keys) {
  const out = [];
  for (const k of keys) if (!(k in obj)) out.push(`${where}: missing key ${k}`);
  for (const k of Object.keys(obj)) if (!keys.includes(k)) out.push(`${where}: unknown key ${k}`);
  return out;
}

// The problems with a manifest object, as strings; an empty list is a valid manifest.
function validateManifest(obj) {
  if (!isObject(obj)) return ['manifest: not an object'];
  const problems = keyProblems('manifest', obj, MANIFEST_KEYS);
  if (obj.schemaVersion !== SCHEMA_VERSION) problems.push(`manifest: schemaVersion must be ${SCHEMA_VERSION}`);
  if ('template' in obj && !isObject(obj.template)) problems.push('manifest: template must be an object');
  if (!('arms' in obj)) return problems;
  if (!Array.isArray(obj.arms)) return [...problems, 'manifest: arms must be an array'];
  obj.arms.forEach((arm, i) => {
    const where = `arms[${i}]`;
    if (!isObject(arm)) {
      problems.push(`${where}: not an object`);
      return;
    }
    problems.push(...keyProblems(where, arm, ARM_KEYS));
    for (const k of ['chunk', 'repeat']) {
      if (k in arm && !(Number.isInteger(arm[k]) && arm[k] >= 1)) problems.push(`${where}: ${k} must be a positive integer`);
    }
    if ('prompts' in arm && !Array.isArray(arm.prompts)) {
      problems.push(`${where}: prompts must be an array`);
    } else if (Array.isArray(arm.prompts)) {
      arm.prompts.forEach((p, j) => {
        if (!isObject(p)) {
          problems.push(`${where}.prompts[${j}]: not an object`);
          return;
        }
        problems.push(...keyProblems(`${where}.prompts[${j}]`, p, PROMPT_KEYS));
        if ('findingIds' in p && !Array.isArray(p.findingIds)) problems.push(`${where}.prompts[${j}]: findingIds must be an array`);
      });
    }
  });
  return problems;
}

// The lens-reviewer replay's schema: the same walk, over a manifest whose prompts are one reviewer slot each.
const REVIEWS_MANIFEST_FILE = 'reviews-manifest.json';
const REVIEWS_FIXTURE_FILE = 'reviews-fixture.json';
const REPORTS_FILE = 'archived-reports.json';
const REVIEWS_KIND = 'reviews';
const CONTROL_ARM = 'control';
const isControlArm = (name) => name === CONTROL_ARM || String(name).startsWith(`${CONTROL_ARM}.`);

const REVIEWS_MANIFEST_KEYS = ['schemaVersion', 'kind', 'arms'];
const REVIEWS_ARM_KEYS = ['name', 'profile', 'model', 'effort', 'repeat', 'prompts'];
const REVIEWS_PROMPT_KEYS = ['file', 'name', 'run', 'lens', 'side', 'repo'];

// Why a run, or one of its reviewer slots, is left out of the lens replay set.
const REVIEW_EXCLUSION_REASONS = [
  'no-decisions',
  'decisions-unreadable',
  'no-review',
  'unlabelled-dispatch',
  'no-archived-tier',
  'no-transcript',
  'no-sha-range',
  'commit-not-in-clone',
  'run-input-gone',
  'unknown-run-input',
  'unrewritten-path',
  'report-unparsed',
  'timing-unreadable',
  'no-timing',
];

// The problems with a reviews manifest object, as strings; an empty list is a valid manifest.
function validateReviewsManifest(obj) {
  if (!isObject(obj)) return ['manifest: not an object'];
  const problems = keyProblems('manifest', obj, REVIEWS_MANIFEST_KEYS);
  if (obj.schemaVersion !== SCHEMA_VERSION) problems.push(`manifest: schemaVersion must be ${SCHEMA_VERSION}`);
  if ('kind' in obj && obj.kind !== REVIEWS_KIND) problems.push(`manifest: kind must be "${REVIEWS_KIND}"`);
  if (!('arms' in obj)) return problems;
  if (!Array.isArray(obj.arms)) return [...problems, 'manifest: arms must be an array'];
  obj.arms.forEach((arm, i) => {
    const where = `arms[${i}]`;
    if (!isObject(arm)) {
      problems.push(`${where}: not an object`);
      return;
    }
    problems.push(...keyProblems(where, arm, REVIEWS_ARM_KEYS));
    if ('repeat' in arm && !(Number.isInteger(arm.repeat) && arm.repeat >= 1)) problems.push(`${where}: repeat must be a positive integer`);
    if ('prompts' in arm && !Array.isArray(arm.prompts)) {
      problems.push(`${where}: prompts must be an array`);
    } else if (Array.isArray(arm.prompts)) {
      arm.prompts.forEach((p, j) => {
        if (!isObject(p)) {
          problems.push(`${where}.prompts[${j}]: not an object`);
          return;
        }
        problems.push(...keyProblems(`${where}.prompts[${j}]`, p, REVIEWS_PROMPT_KEYS));
      });
    }
  });
  return problems;
}

module.exports = {
  REVIEWS_MANIFEST_FILE, REVIEWS_FIXTURE_FILE, REPORTS_FILE, REVIEWS_KIND, CONTROL_ARM, isControlArm,
  REVIEWS_MANIFEST_KEYS, REVIEWS_ARM_KEYS, REVIEWS_PROMPT_KEYS, REVIEW_EXCLUSION_REASONS, validateReviewsManifest,
  SCHEMA_VERSION, MANIFEST_FILE, FIXTURE_FILE, VERDICTS_FILE, JOURNAL_FILE,
  VERDICT_CLASSES, EXCLUSION_REASONS, MANIFEST_KEYS, ARM_KEYS, PROMPT_KEYS, JOURNAL_EVENT_TYPES,
  IDENTITY_RE, RUN_RECORDS_DIR, isRunRecordPath, specFileCited, toPosix, armLabel, parseArmLabel, validateManifest,
};
