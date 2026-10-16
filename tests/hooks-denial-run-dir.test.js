'use strict';
// tests/hooks-denial-run-dir.test.js — #2783 / #2813: a denial must never be
// logged into resolveRun's GUESSED ('fallback') run dir when a session-owned
// ad-hoc dir can be minted instead. context.js's resolveDenialRunDir is the
// one resolver every pre-tool-use denial site uses.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { gitRepo } = require('./helpers/git-fixtures');

function adhocDirs(main) {
  try {
    return fs.readdirSync(path.join(main, '.claude-tweaks', 'pipelines')).filter((n) => n.endsWith('-adhoc-standalone'));
  } catch { return []; }
}

test('isTrustedOwnedRun: session/env attribution is trusted, fallback and empty are not', () => {
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'session' }), true);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'env' }), true);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: '/r', attribution: 'fallback' }), false);
  assert.strictEqual(ctxLib.isTrustedOwnedRun({ dir: null, attribution: null }), false);
  assert.strictEqual(ctxLib.isTrustedOwnedRun(undefined), false);
});

test('resolveDenialRunDir: a trusted owned run is returned as-is, nothing minted', () => {
  const main = gitRepo();
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-owned-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-1' }, cwd: main, ownedRun: { dir: owned, attribution: 'session' } });
  assert.deepStrictEqual(r, { dir: owned, attribution: 'session' });
  assert.deepStrictEqual(adhocDirs(main), []);
});

test('resolveDenialRunDir: a fallback guess is NOT used when an ad-hoc dir can be minted', () => {
  const main = gitRepo();
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-2' }, cwd: main, ownedRun: { dir: guess, attribution: 'fallback' } });
  const dirs = adhocDirs(main);
  assert.strictEqual(dirs.length, 1);
  assert.strictEqual(fs.realpathSync(r.dir), fs.realpathSync(path.join(main, '.claude-tweaks', 'pipelines', dirs[0])));
  assert.strictEqual(r.attribution, undefined);
  assert.strictEqual(ctxLib.readRunState(r.dir).sessionId, 'sess-drd-2');
});

test('resolveDenialRunDir: falls back to the guess (attribution kept) only when minting is impossible', () => {
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-notrepo-'));
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const r = ctxLib.resolveDenialRunDir({ input: { session_id: 'sess-drd-3' }, cwd: notRepo, ownedRun: { dir: guess, attribution: 'fallback' } });
  assert.deepStrictEqual(r, { dir: guess, attribution: 'fallback' });
});

test('stampAdHocRunDirForDenial: a fallback-attributed ownedRun no longer short-circuits the mint', () => {
  const main = gitRepo();
  const guess = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guess-'));
  const stamped = ctxLib.stampAdHocRunDirForDenial({ input: { session_id: 'sess-drd-4' }, cwd: main, ownedRun: { dir: guess, attribution: 'fallback' } });
  assert.notStrictEqual(stamped, guess);
  assert.strictEqual(adhocDirs(main).length, 1);
});
