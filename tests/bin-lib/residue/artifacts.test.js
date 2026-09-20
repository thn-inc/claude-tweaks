'use strict';
// tests/bin-lib/residue/artifacts.test.js — the artifacts retention probe
// (#1078): aged artifact dirs under .claude-tweaks/artifacts/ (30-day
// newest-file rule), legacy project-root screenshots/ + traces/ residue behind
// its two ownership discriminators (plugin-shape match + git untracked proof),
// per-root ENOENT-clean semantics, fail-loud on unreadable roots.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probeArtifacts, THIRTY_DAYS_MS } = require('../../../plugin/bin/lib/residue/probes/artifacts');
const { validateFinding } = require('../../../plugin/bin/lib/residue/finding');
const { skipUnderRoot } = require('../../helpers/root');

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const OLD = new Date(NOW - THIRTY_DAYS_MS - 24 * 60 * 60 * 1000); // 31 days ago
const FRESH = new Date(NOW - 24 * 60 * 60 * 1000); // 1 day ago

// Fake git runners. UNTRACKED is the proof case (`git ls-files` found nothing
// tracked under the root); UNPROVEN is any git failure (`null` from the real
// wrapper); TRACKED names a real, version-controlled file under the root.
const UNTRACKED = () => '';
const UNPROVEN = () => null;
const TRACKED = () => 'screenshots/hero/sunset.jpg';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-probe-'));
}

function mkFile(p, mtime) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
  fs.utimesSync(p, mtime, mtime);
}

test('no roots at all is a clean, ran result', () => {
  const root = tmpRoot();
  assert.deepStrictEqual(probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED }), { ran: true, reason: null, findings: [] });
});

test('partial presence: missing sibling subdirs are silently clean', () => {
  const root = tmpRoot();
  mkFile(path.join(root, '.claude-tweaks/artifacts/screenshots/browse/sess1/01.png'), FRESH);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.ran, true);
  assert.deepStrictEqual(r.findings, []);
});

test('aged dir (newest file >30d) yields an auto artifact finding that validates', () => {
  const root = tmpRoot();
  mkFile(path.join(root, '.claude-tweaks/artifacts/screenshots/qa/20260601_010101_abc123/shot.png'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.findings.length, 1);
  const f = r.findings[0];
  assert.strictEqual(f.kind, 'artifact');
  assert.strictEqual(f.scope, 'observed');
  assert.strictEqual(f.remedy, 'auto');
  assert.ok(f.subject.includes('20260601_010101_abc123'));
  assert.deepStrictEqual(validateFinding(f), []);
});

test('aged-class evidence names the newest file, relative to the scanned dir', () => {
  const root = tmpRoot();
  const dir = path.join(root, '.claude-tweaks/artifacts/screenshots/qa/20260601_010101_abc123');
  mkFile(path.join(dir, 'step-1/older.png'), new Date(OLD.getTime() - 5 * 86400000));
  mkFile(path.join(dir, 'step-2/newest.png'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.findings.length, 1);
  assert.ok(
    r.findings[0].evidence.includes('(newest: step-2/newest.png)'),
    `evidence did not name the newest file: ${r.findings[0].evidence}`,
  );
});

test('empty aged dir evidence says the basis was the dir mtime, not a file', () => {
  const root = tmpRoot();
  const dir = path.join(root, '.claude-tweaks/artifacts/traces/story-empty');
  fs.mkdirSync(dir, { recursive: true });
  fs.utimesSync(dir, OLD, OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.findings.length, 1);
  assert.ok(
    r.findings[0].evidence.includes('no files — dir mtime'),
    `evidence did not flag the dir-mtime fallback: ${r.findings[0].evidence}`,
  );
});

test('discrimination: old dir mtime but one fresh file is NOT flagged', () => {
  const root = tmpRoot();
  const dir = path.join(root, '.claude-tweaks/artifacts/traces/story-1');
  mkFile(path.join(dir, 'old.zip'), OLD);
  mkFile(path.join(dir, 'new.zip'), FRESH);
  fs.utimesSync(dir, OLD, OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.deepStrictEqual(r.findings, []);
});

test('empty aged dir falls back to its own mtime and is flagged', () => {
  const root = tmpRoot();
  const dir = path.join(root, '.claude-tweaks/artifacts/screenshots/qa/20260501_010101_dead00');
  fs.mkdirSync(dir, { recursive: true });
  fs.utimesSync(dir, OLD, OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].remedy, 'auto');
});

test('legacy root with fresh content is flagged remedy record', () => {
  const root = tmpRoot();
  mkFile(path.join(root, 'traces/story-2/t.zip'), FRESH);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].kind, 'artifact');
  assert.strictEqual(r.findings[0].remedy, 'record');
  assert.ok(r.findings[0].evidence.includes('.claude-tweaks/artifacts/'));
  assert.deepStrictEqual(validateFinding(r.findings[0]), []);
});

test('legacy root aged >30d, even proven untracked, is remedy record — never auto: untracked proves non-tracked, not plugin-owned', () => {
  const root = tmpRoot();
  mkFile(path.join(root, 'screenshots/qa/run1/x.png'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].subject, 'screenshots');
  assert.strictEqual(r.findings[0].remedy, 'record');
  assert.ok(r.findings[0].evidence.includes('never auto-deleted'));
});

test('a user-owned gitignored traces/ archive (aged, untracked, zip-shaped) is never auto-deleted', () => {
  // The traces/ shape heuristic (any first-level subdir containing a .zip at
  // any depth) matches generic archives — e.g. a project's own Playwright
  // trace store — and gitignored content is exactly as "untracked" as plugin
  // residue. Neither discriminator proves ownership, so auto must never fire.
  const root = tmpRoot();
  mkFile(path.join(root, 'traces/2026-06-checkout-flow/trace.zip'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].subject, 'traces');
  assert.strictEqual(r.findings[0].remedy, 'record');
});

test('legacy root with tracked files yields NO finding — not the plugin\'s to delete', () => {
  const root = tmpRoot();
  mkFile(path.join(root, 'screenshots/qa/run1/x.png'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: TRACKED });
  assert.strictEqual(r.ran, true);
  assert.deepStrictEqual(r.findings, []);
});

test('untracked root that does not match the plugin shape yields NO finding', () => {
  const root = tmpRoot();
  mkFile(path.join(root, 'screenshots/hero/sunset.jpg'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(r.ran, true);
  assert.deepStrictEqual(r.findings, []);
});

test('traces shape needs a first-level subdir containing a .zip', () => {
  const root = tmpRoot();
  mkFile(path.join(root, 'traces/notes/readme.md'), OLD);
  const shapeless = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.deepStrictEqual(shapeless.findings, []);
  mkFile(path.join(root, 'traces/story-3/nested/t.zip'), OLD);
  const shaped = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
  assert.strictEqual(shaped.findings.length, 1);
  assert.strictEqual(shaped.findings[0].subject, 'traces');
});

test('aged legacy root git could not prove untracked caps remedy at record', () => {
  const root = tmpRoot();
  mkFile(path.join(root, 'screenshots/qa/run1/x.png'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW, run: UNPROVEN });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].remedy, 'record');
  assert.ok(
    r.findings[0].evidence.includes('git could not prove the tree untracked'),
    `evidence did not carry the unproven note: ${r.findings[0].evidence}`,
  );
  assert.deepStrictEqual(validateFinding(r.findings[0]), []);
});

test('no runner injected at all is UNPROVEN, never untracked', () => {
  const root = tmpRoot();
  mkFile(path.join(root, 'screenshots/qa/run1/x.png'), OLD);
  const r = probeArtifacts({ cwd: root, now: NOW });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].remedy, 'record');
  assert.ok(r.findings[0].evidence.includes('git could not prove the tree untracked'));
});

test('an unreadable root fails the whole probe loudly, naming it', skipUnderRoot('root ignores directory permissions'), () => {
  const root = tmpRoot();
  const locked = path.join(root, '.claude-tweaks/artifacts/traces');
  fs.mkdirSync(locked, { recursive: true });
  mkFile(path.join(root, '.claude-tweaks/artifacts/screenshots/qa/run1/a.png'), OLD);
  fs.chmodSync(locked, 0o000);
  try {
    const r = probeArtifacts({ cwd: root, now: NOW, run: UNTRACKED });
    assert.strictEqual(r.ran, false);
    assert.ok(r.reason.includes('traces'));
    assert.deepStrictEqual(r.findings, []);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

test("'artifact' is a registered kind", () => {
  const { KINDS } = require('../../../plugin/bin/lib/residue/finding');
  assert.ok(KINDS.includes('artifact'));
});
