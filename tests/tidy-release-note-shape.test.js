'use strict';
// #2828: step-1-records.md's Shape 4.5 — placement, worklist scope, and the fenced scan block
// extracted and executed against a fixture (docs/skill-authoring.md § Executable snippets).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sessionTmpPath } = require('../plugin/bin/lib/session-tmp');
const F = require('./bin-lib/release-note-repair/fixtures');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugin');
const DOC = readText(path.join(ROOT, 'plugin/skills/tidy/step-1-records.md'));
const FLAT = DOC.replace(/\s+/g, ' ');

function shapeBlock() {
  const start = DOC.indexOf('### Shape 4.5 — ');
  assert.notEqual(start, -1, 'Shape 4.5 heading missing');
  const m = /```bash\n([\s\S]*?)\n```/.exec(DOC.slice(start));
  assert.ok(m, 'extraction pattern is out of sync with the doc');
  return m[1];
}

test('Shape 4.5 sits between Shape 4 and Shape 5', () => {
  const s4 = DOC.indexOf('### Shape 4 — ');
  const s45 = DOC.indexOf('### Shape 4.5 — ');
  const s5 = DOC.indexOf('### Shape 5 — ');
  assert.ok(s4 !== -1 && s4 < s45 && s45 < s5);
});

test('Shape 4.5 joins the worklist rule and names its contract', () => {
  assert.ok(FLAT.includes('Worklist rule (Shapes 1, 2, 3, 4, 4.5, 5, 7, 8)'));
  const section = DOC.slice(DOC.indexOf('### Shape 4.5 — '), DOC.indexOf('### Shape 5 — ')).replace(/\s+/g, ' ');
  assert.ok(section.includes('`missing section: ## Release Note`'));
  assert.ok(section.includes('`empty section: ## Release Note`'));
  assert.ok(section.includes('any other exit is a scan error'));
  assert.ok(section.includes('`Fill Release Note (insert one ## Release Note section; labels unchanged)`'));
  assert.ok(section.includes('`release-note-repair.md`'));
  assert.ok(section.includes('[release-note]'));
});

function runBlock(driver, records) {
  const sessionId = `rn-shape-${process.pid}-${Date.now()}-${driver}`;
  const facetedPath = sessionTmpPath(sessionId, 'tidy-records-faceted.json');
  fs.writeFileSync(facetedPath, JSON.stringify(records));
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-shape-')), 'cands.json');
  const script = shapeBlock()
    .split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT)
    .split('{work-backend}').join(driver)
    .split('{release-note-candidates-file}').join(outFile);
  try {
    const stdout = execFileSync('bash', ['-c', script], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId }, encoding: 'utf8' });
    return { stdout, candidates: JSON.parse(fs.readFileSync(outFile, 'utf8')).candidates, outFile };
  } finally {
    fs.rmSync(path.dirname(facetedPath), { recursive: true, force: true });
  }
}

test('the Shape 4.5 block runs (github-issues) and writes the uncapped list', () => {
  const rec = (number, body, stage = 'ready') => ({ number, title: `R${number}`, state: 'OPEN', labels: [{ name: 'ready' }], body, facets: { stage } });
  const { stdout, candidates, outFile } = runBlock('github-issues', [rec(1, F.MISSING_RN), rec(2, F.CONFORMING), rec(3, F.MISSING_RN, 'backlog')]);
  assert.equal(stdout, `—\t[release-note] 1 ready record(s) missing only a Release Note, 0 scan error(s) — Fill Release Note (candidates: ${outFile})\n`);
  assert.deepEqual(candidates.map((c) => c.ref), ['#1']);
});

test('the Shape 4.5 block runs (local-files)', () => {
  const { candidates } = runBlock('local-files', [{ path: 'specs/9-x.md', id: 9, title: 'L9', body: F.EMPTY_RN, facets: { stage: 'ready', needsDefinition: false, closed: false } }]);
  assert.deepEqual(candidates.map((c) => [c.ref, c.gap]), [['specs/9-x.md', 'empty section: ## Release Note']]);
});
