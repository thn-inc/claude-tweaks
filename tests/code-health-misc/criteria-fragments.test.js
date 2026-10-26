const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('../helpers/read-skill');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readShared(name) {
  return readText(path.join(REPO_ROOT, 'plugin', 'skills', '_shared', name));
}
function readSkill(skill, file = 'SKILL.md') {
  return readText(path.join(REPO_ROOT, 'plugin', 'skills', skill, file));
}

const FRAGMENTS = [
  'criteria-architecture-depth.md',
  'criteria-simplification.md',
  'criteria-review-quality.md',
];

test('all three criteria fragments exist', () => {
  for (const f of FRAGMENTS) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, 'plugin', 'skills', '_shared', f)),
      `expected skills/_shared/${f} to exist`
    );
  }
});

test('architecture-depth fragment carries signature criteria', () => {
  const body = readShared('criteria-architecture-depth.md');
  assert.match(body, /Leverage = how much behavior/, 'leverage definition');
  assert.match(body, /deletion test/i, 'deletion test');
  assert.match(body, /port/i, 'dependency classification (port/adapter)');
});

test('simplification fragment carries signature criteria', () => {
  const body = readShared('criteria-simplification.md');
  assert.match(body, /trial-and-error/i, 'verbose debugging patterns');
  assert.match(body, /readability/i, 'readability counter-rule');
});

test('review-quality fragment carries signature criteria', () => {
  const body = readShared('criteria-review-quality.md');
  assert.match(body, /critical.*high.*medium.*low/i, 'severity scale');
  for (const cat of ['Architecture', 'Security', 'Convention', 'Performance',
                     'Error handling', 'Test quality', 'Coverage', 'UX', 'Docs']) {
    assert.match(body, new RegExp(cat), `category enum value: ${cat}`);
  }
  assert.match(body, /calibrated senior engineer block a PR/, 'CALIBRATION filter');
  assert.match(body, /auto-mode-contract/, 'points at contract for confidence/reversibility');
});

test('/deepen references the architecture-depth criteria fragment', () => {
  const skill = readSkill('deepen');
  const sub = readSkill('deepen', 'depth-analysis.md');
  assert.match(skill + sub, /criteria-architecture-depth\.md/);
});

test('/simplify references the simplification criteria fragment', () => {
  assert.match(readSkill('simplify'), /criteria-simplification\.md/);
});

test('/review references the review-quality criteria fragment', () => {
  const steps = readSkill('review', 'code-mode-steps.md');
  const dispatch = readSkill('review', 'step3-lens-dispatch.md');
  assert.match(steps + dispatch, /criteria-review-quality\.md/);
});

test('review-quality CALIBRATION block stays byte-identical between fragment and step3-lens-dispatch', () => {
  // The canonical dispatch template moved from step3-routing.md to step3-lens-dispatch.md
  // (#887) so step3-routing's findings-conditional lazy-load actually holds — the byte-identity
  // pin follows the template to its new home.
  const frag = readShared('criteria-review-quality.md');
  const routing = readSkill('review', 'step3-lens-dispatch.md');

  // Both must contain the load-bearing filter line verbatim (belt-and-suspenders existence checks).
  const anchor = 'When in doubt: would a calibrated senior engineer block a PR on this finding alone? If no, drop it.';
  assert.ok(frag.includes(anchor), 'fragment contains the calibration anchor line');
  assert.ok(routing.includes(anchor), 'step3-lens-dispatch contains the calibration anchor line');

  // Extract the full CALIBRATION block from a file's content.
  // Returns the substring starting at "Only flag issues where:" and ending at the "drop it." sentence (inclusive).
  function extractCalibrationBlock(content) {
    const start = 'Only flag issues where:';
    const end = 'When in doubt: would a calibrated senior engineer block a PR on this finding alone? If no, drop it.';
    const startIdx = content.indexOf(start);
    const endIdx = content.indexOf(end);
    assert.ok(startIdx !== -1, 'CALIBRATION block start not found');
    assert.ok(endIdx !== -1, 'CALIBRATION block end not found');
    return content.slice(startIdx, endIdx + end.length);
  }

  const fromFragment = extractCalibrationBlock(frag);
  const fromRouting = extractCalibrationBlock(routing);
  assert.strictEqual(fromFragment, fromRouting, 'CALIBRATION block must be byte-identical in fragment and step3-lens-dispatch');
});

test('simplification fragment carries test-oracle constraint', () => {
  const body = readShared('criteria-simplification.md');
  const constraintsStart = body.indexOf('## Constraints');
  assert.ok(constraintsStart !== -1, 'Constraints section exists');
  const nextHeading = body.indexOf('\n## ', constraintsStart + 1);
  const constraintsSectionEnd = nextHeading === -1 ? body.length : nextHeading;
  const constraintsSection = body.slice(constraintsStart, constraintsSectionEnd);

  assert.match(constraintsSection, /expected value/i, 'mentions "expected value"');
  assert.match(constraintsSection, /oracle/i, 'mentions "oracle"');
  assert.match(constraintsSection, /test-local constant/i, 'mentions "test-local constant"');
});

test('/simplify dispatch Constraints line carries the test-oracle clause', () => {
  const skill = readSkill('simplify');
  const step2Start = skill.search(/^## Step 2:/m);
  assert.ok(step2Start !== -1, 'Step 2 exists');
  const fencedBlockStart = skill.indexOf('```', step2Start);
  assert.ok(fencedBlockStart !== -1, 'Fenced block exists in Step 2');
  const fencedBlockEnd = skill.indexOf('```', fencedBlockStart + 3);
  assert.ok(fencedBlockEnd !== -1, 'Fenced block closes');
  const fencedBlock = skill.slice(fencedBlockStart, fencedBlockEnd);

  const constraintsLineMatch = fencedBlock.match(/^- Constraints: .+$/m);
  assert.ok(constraintsLineMatch, 'Constraints line exists in the fenced block');
  const constraintsLine = constraintsLineMatch[0];

  assert.match(constraintsLine, /expected value/i, 'mentions "expected value"');
  assert.match(constraintsLine, /production constant/i, 'mentions "production constant"');
});
