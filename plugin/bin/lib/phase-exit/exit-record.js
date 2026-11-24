// The phase-exit record (#6143): the one `AUTO` decisions.md line phase-exit.js
// writes under PHASE_SECTIONS[phase] at every phase exit of a run that is not
// closed, and the reader that decides whether a run's decisions.md set records
// that exit. lib/flow/inflight-run.js's inFlightPhase consumes the reader; a PR
// checklist row is only its pre-filter. Runs started before this line existed
// write none: inFlightPhase reads a run with no record for any phase as past test
// when it carries an entry under /review or /wrap-up (postTestSectionRecorded),
// else its checked rows alone decide (expand-contract).
'use strict';

const fs = require('fs');
const path = require('path');
const { parseEntry, normalizeSection } = require('../log-decision/append');
const { PHASE_SECTIONS } = require('../../pr-merge-state');
const { parseManifestYaml } = require('../flow/manifest');

const PHASE_EXIT_STEP = 'Phase exit';
// Pipeline order: a phase never exits before the ones ahead of it.
const PHASES = Object.keys(PHASE_SECTIONS);
// Sections only a run past its test phase writes to: /review gates on test passing, and /wrap-up follows review.
const POST_TEST_SECTIONS = [PHASE_SECTIONS.review, PHASE_SECTIONS['wrap-up']];
const SPEC_ID_RE = /^[A-Za-z0-9._-]+$/;

function phaseExitText(phase, head) {
  return `${phase} phase exited at ${head || 'unknown HEAD'}`;
}

// {runDir}/decisions.md, then every {runDir}/spec-{N}/decisions.md (N all digits,
// a real directory, not a symlink) in name order. A missing or unreadable parent
// file, or an unreadable present spec file, throws; a spec dir with no file is skipped.
function readRunDecisions(runDir, fsImpl = fs) {
  const texts = [fsImpl.readFileSync(path.join(runDir, 'decisions.md'), 'utf8')];
  const specDirs = fsImpl.readdirSync(runDir).filter((name) => /^spec-\d+$/.test(name)).sort();
  for (const name of specDirs) {
    const dir = path.join(runDir, name);
    if (!fsImpl.lstatSync(dir).isDirectory()) continue;
    const file = path.join(dir, 'decisions.md');
    let text;
    try {
      text = fsImpl.readFileSync(file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') continue;
      throw e;
    }
    texts.push(text);
  }
  return texts;
}

// True when, under any `## {PHASE_SECTIONS[phase]}` heading, an AUTO entry with
// location `Phase exit` has an action starting `{phase} phase exited at `.
function phaseExitRecorded(decisionsText, phase) {
  const section = PHASE_SECTIONS[phase];
  if (!section || typeof decisionsText !== 'string' || !decisionsText) return false;
  const prefix = `${phase} phase exited at `;
  let inSection = false;
  for (const raw of decisionsText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const heading = /^## (.+)$/.exec(line);
    if (heading) { inSection = normalizeSection(heading[1].trim()) === section; continue; }
    if (!inSection) continue;
    const entry = parseEntry(line);
    if (entry && entry.status === 'AUTO' && entry.location === PHASE_EXIT_STEP && entry.action.startsWith(prefix)) return true;
  }
  return false;
}

// True when the text records the exit of `phase` or of any phase after it.
function phaseExitReached(decisionsText, phase) {
  const i = PHASES.indexOf(phase);
  return i >= 0 && PHASES.slice(i).some((p) => phaseExitRecorded(decisionsText, p));
}

const anyPhaseExitRecorded = (decisionsText) => PHASES.some((p) => phaseExitRecorded(decisionsText, p));

// True when a `## /review` or `## /wrap-up` section of the text holds at least one entry.
function postTestSectionRecorded(decisionsText) {
  if (typeof decisionsText !== 'string' || !decisionsText) return false;
  let inSection = false;
  for (const raw of decisionsText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const heading = /^## (.+)$/.exec(line);
    if (heading) { inSection = POST_TEST_SECTIONS.includes(normalizeSection(heading[1].trim())); continue; }
    if (inSection && parseEntry(line)) return true;
  }
  return false;
}

// A multi-spec run's specs, from {runDir}/manifest.yml (flow/manifest.js's shape), in manifest order:
// [{ id, status, phase, decisions }], `decisions` being {runDir}/spec-{id}/decisions.md ('' when the
// spec dir or its file is absent, or the dir is a symlink). null when the run has no manifest.yml (a
// single-spec run). Throws on a manifest.yml that cannot be read (bar ENOENT) or parsed, a spec id
// that is not a plain name, and an unreadable present spec file.
function readRunSpecs(runDir, fsImpl = fs) {
  const file = path.join(runDir, 'manifest.yml');
  let text;
  try {
    text = fsImpl.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
  const manifest = parseManifestYaml(text);
  if (!manifest) throw new Error(`${file} does not parse`);
  return manifest.multispec.specs.map((spec) => {
    if (!SPEC_ID_RE.test(String(spec.id))) throw new Error(`${file}: spec id ${JSON.stringify(spec.id)} is not a plain name`);
    const dir = path.join(runDir, `spec-${spec.id}`);
    let decisions = '';
    let isDir = false;
    try { isDir = fsImpl.lstatSync(dir).isDirectory(); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
    if (isDir) {
      try {
        decisions = fsImpl.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
      } catch (e) {
        if (!e || e.code !== 'ENOENT') throw e;
      }
    }
    return { id: spec.id, status: spec.status, phase: spec.phase, decisions };
  });
}

module.exports = {
  PHASE_EXIT_STEP, PHASES, phaseExitText, readRunDecisions, phaseExitRecorded, phaseExitReached, anyPhaseExitRecorded, postTestSectionRecorded, readRunSpecs,
};
