'use strict';
// timing-skip.js (#5555): the one fallback "timing at close" SKIP writer the closing
// paths call when lib/timing/at-close.js itself cannot be used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { logTimingSkip, logTimingFailure } = require('../../../plugin/bin/lib/log-decision/timing-skip');
const { appendEntry, formatEntry } = require('../../../plugin/bin/lib/log-decision/append');

function skipLines(runDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.startsWith('- SKIP '));
}

test('logTimingFailure names the error message, and a thrown non-Error by String(err), never "undefined"', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-skip-'));
  try {
    logTimingFailure(root, 'timing module failed to load', new Error('load fault'));
    logTimingFailure(root, 'timing at close failed', 'plain string');
    logTimingFailure(root, 'timing at close failed', { code: 'X' });
    const skips = skipLines(root);
    assert.equal(skips.length, 3);
    assert.match(skips[0], /^- SKIP \d{2}:\d{2}:\d{2} — timing at close: condition: timing module failed to load \(load fault\) → fallback: no timing\.json written\./);
    assert.match(skips[1], /condition: timing at close failed \(plain string\) → fallback: no timing\.json written/);
    assert.match(skips[2], /condition: timing at close failed \(\[object Object\]\)/);
    for (const s of skips) assert.doesNotMatch(s, /undefined/);
    assert.match(fs.readFileSync(path.join(root, 'decisions.md'), 'utf8'), /^## \/wrap-up$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('logTimingSkip never throws and never creates a missing run dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-skip-'));
  try {
    const gone = path.join(root, 'gone');
    assert.doesNotThrow(() => logTimingSkip(gone, 'condition: x → fallback: y'));
    assert.doesNotThrow(() => logTimingFailure(gone, 'x', new Error('y')));
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The window logTimingSkip's own directory check cannot close: an archive moves the run dir away
// after the check, before the append (createParent: false is what keeps the lock from recreating it).
test('an append with createParent false to a vanished run dir throws and recreates nothing; the default still creates it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-timing-skip-'));
  try {
    const entry = formatEntry({ status: 'SKIP', now: Date.now(), step: 'timing at close', text: 'condition: x → fallback: y' });
    const gone = path.join(root, 'gone');
    assert.throws(() => appendEntry({ runDir: gone, section: '/wrap-up', entry, createParent: false }));
    assert.deepEqual(fs.readdirSync(root), []);
    const made = path.join(root, 'made');
    appendEntry({ runDir: made, section: '/wrap-up', entry });
    assert.ok(fs.existsSync(path.join(made, 'decisions.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
