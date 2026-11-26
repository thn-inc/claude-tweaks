'use strict';
// #4524: the guard-refusals tools derive their refusal tail from REFUSAL_SIGNATURES, so a signature
// that lacks "Refusing to run" is counted without a tool edit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ISOLATION_CLAUSE } = require('../../plugin/bin/lib/hooks/harness-refusal');
const pristineTranscripts = require('../../tools/guard-refusals/transcripts');
const pristineTrace = require('../../tools/guard-refusals/trace');
const { writeStore, use, result, WINDOW } = require('../helpers/guard-refusals-store');

const SYNTH = 'Declining to execute it';
const PATHS = [
  require.resolve('../../plugin/bin/lib/hooks/harness-refusal'),
  require.resolve('../../tools/guard-refusals/trace'),
  require.resolve('../../tools/guard-refusals/transcripts'),
];

function loadWithSignatures(extra) {
  const [refusalPath, tracePath, transcriptsPath] = PATHS;
  for (const p of PATHS) delete require.cache[p];
  const orig = require(refusalPath);
  require.cache[refusalPath].exports = { ...orig, REFUSAL_SIGNATURES: Object.freeze([...orig.REFUSAL_SIGNATURES, extra]) };
  const trace = require(tracePath);
  const transcripts = require(transcriptsPath);
  const restore = () => { for (const p of PATHS) delete require.cache[p]; };
  return { trace, transcripts, restore };
}

test('transcripts: a refusal ending in a signature without the shared prefix is counted', () => {
  const text = `This session${ISOLATION_CLAUSE}/wt, but this command is too complex to verify that it stays inside the worktree. ${SYNTH}.`;
  const projectsDir = writeStore([use('t1', 'Bash', { command: 'git status' }), result('t1', text)]);
  const { transcripts, restore } = loadWithSignatures(SYNTH);
  try {
    const scan = transcripts.scanStore({ projectsDir, ...WINDOW });
    assert.equal(scan.refusals.length, 1);
    assert.equal(scan.rows.find((r) => r.toolUseId === 't1').guard, 'harness-command');
  } finally { restore(); }
  assert.equal(pristineTranscripts.scanStore({ projectsDir, ...WINDOW }).refusals.length, 0);
});

test('trace: clauseOf cuts at a signature without the shared prefix', () => {
  const text = `This session${ISOLATION_CLAUSE}/wt, but this command is too complex to verify that it stays inside the worktree. ${SYNTH}. names git in a form too complex`;
  const { trace, restore } = loadWithSignatures(SYNTH);
  try {
    assert.equal(trace.classifyReason(text), 'too-complex');
  } finally { restore(); }
  assert.equal(pristineTrace.classifyReason(text), 'names-git');
});
