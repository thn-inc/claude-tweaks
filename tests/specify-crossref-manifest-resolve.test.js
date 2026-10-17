// tests/specify-crossref-manifest-resolve.test.js
// Pins that record-creation-subissues.md's cross-reference Key Files fence sets
// $SPECIFY_DECOMP_MANIFEST itself (record #3161). Each bash fence runs as its own
// Bash tool call, so shell variables do not carry over; run alone, the fence used
// to call readFileSync('') and throw ENOENT.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugin');
// Normalized to LF: a core.autocrlf Windows checkout reads the skill with \r\n, which would make the
// bare-\n fence extraction below find nothing (and \r in a fence body would break bash).
const RECORD_CREATION = fs.readFileSync(
  path.join(PLUGIN_ROOT, 'skills/specify/record-creation-subissues.md'),
  'utf8'
).replace(/\r\n/g, '\n');
const SESSION_ID = 'crossref-manifest-test-session';

// Same extraction shape as tests/specify-ceremony-tally-prose.test.js (copied, not imported).
function fenceAfter(label) {
  const idx = RECORD_CREATION.indexOf(label);
  assert.ok(idx >= 0, `extraction pattern is out of sync: label ${label} not found`);
  const m = /```bash\n([\s\S]*?)\n```/.exec(RECORD_CREATION.slice(idx));
  assert.ok(m && m[1].trim(), `extraction pattern is out of sync: no bash fence after ${label}`);
  return m[1];
}

const INIT_FENCE = fenceAfter('**Fresh manifest for this invocation.**');
const ACCUM_FENCE = fenceAfter('**Accumulate this unit for the cross-reference pass below.**');
const CROSSREF_FENCE = fenceAfter('**Cross-reference forward/backward Key Files (record #490).**');

// Runs the init fence, two accumulate fences, then the cross-reference fence, each in its
// own bash process, in a scratch project with a private TMPDIR. Throws on any non-zero exit.
function assertCrossrefFenceRunsStandalone(crossrefFence) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-crossref-manifest-'));
  try {
    const cwd = path.join(root, 'proj');
    const tmp = path.join(root, 'tmp');
    fs.mkdirSync(cwd);
    fs.mkdirSync(tmp);
    const bodyFile = path.join(root, 'body.md');
    fs.writeFileSync(bodyFile, '## Current State\n\nfixture body\n');
    // Drop SPECIFY_DECOMP_MANIFEST from the inherited env so the machine's own environment
    // cannot mask a fence that fails to set it.
    const { SPECIFY_DECOMP_MANIFEST, ...base } = process.env;
    const env = { ...base, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, CLAUDE_CODE_SESSION_ID: SESSION_ID, TMPDIR: tmp };
    const run = (script, extra = {}) => spawnSync('bash', ['-c', script], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    const expectOk = (r) => assert.strictEqual(r.status, 0, `fence exited ${r.status}: ${r.stderr}`);
    expectOk(run(INIT_FENCE));
    expectOk(run(ACCUM_FENCE, {
      SUB_ISSUE_TITLE: 'Unit 1', SUB_ISSUE_NUM: '1', SPECIFY_SUB_ISSUE_BODY: bodyFile, SUB_ISSUE_CEREMONY: 'standard',
    }));
    expectOk(run(ACCUM_FENCE, {
      SUB_ISSUE_TITLE: 'Unit 2', SUB_ISSUE_NUM: '2', SPECIFY_SUB_ISSUE_BODY: bodyFile, SUB_ISSUE_CEREMONY: 'fast-lane',
    }));
    const r = run(crossrefFence);
    expectOk(r);
    assert.ok(Array.isArray(JSON.parse(r.stdout)), 'cross-reference fence must print a JSON array');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('crossReferenceKeyFiles fence re-resolves $SPECIFY_DECOMP_MANIFEST via sessionTmpPath', () => {
  const assignIdx = CROSSREF_FENCE.indexOf('SPECIFY_DECOMP_MANIFEST=$(');
  assert.ok(assignIdx >= 0, 'the cross-reference fence must assign SPECIFY_DECOMP_MANIFEST itself');
  assert.ok(
    CROSSREF_FENCE.includes("sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-decomp-manifest.json')"),
    'the assignment must resolve the manifest via sessionTmpPath'
  );
  assert.ok(
    CROSSREF_FENCE.includes("|| require('path').join(require('os').tmpdir(), 'specify-decomp-manifest.json')"),
    'the assignment must keep the os.tmpdir() fallback the sibling fences use'
  );
  assert.ok(
    assignIdx < CROSSREF_FENCE.indexOf('crossReferenceKeyFiles(units, grep)'),
    'the assignment must come before the crossReferenceKeyFiles call'
  );
});

test('crossReferenceKeyFiles fence runs as its own Bash call against a scratch manifest', () => {
  assertCrossrefFenceRunsStandalone(CROSSREF_FENCE);
});

test('go-red control: the fence without its own re-resolution fails the same assertion', () => {
  const stripped = CROSSREF_FENCE.replace(/^SPECIFY_DECOMP_MANIFEST=\$\(node -e "[\s\S]*?^"\)\n/m, '');
  assert.notStrictEqual(stripped, CROSSREF_FENCE, 'the strip must actually remove the assignment');
  assert.throws(() => assertCrossrefFenceRunsStandalone(stripped), /fence exited 1: [\s\S]*ENOENT/);
});
