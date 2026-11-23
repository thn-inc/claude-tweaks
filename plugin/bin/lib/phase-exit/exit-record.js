// The phase-exit record (#6143): the one `AUTO` decisions.md line phase-exit.js
// writes under PHASE_SECTIONS[phase] at every phase exit of a run that is not
// closed, and the reader that decides whether a run's decisions.md set records
// that exit. lib/flow/inflight-run.js's inFlightPhase consumes the reader; a PR
// checklist row is only its pre-filter. Runs started before this line existed
// write none, so their checked rows alone decide (expand-contract).
'use strict';

const fs = require('fs');
const path = require('path');
const { parseEntry, normalizeSection } = require('../log-decision/append');
const { PHASE_SECTIONS } = require('../../pr-merge-state');

const PHASE_EXIT_STEP = 'Phase exit';

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

module.exports = { PHASE_EXIT_STEP, phaseExitText, readRunDecisions, phaseExitRecorded };
