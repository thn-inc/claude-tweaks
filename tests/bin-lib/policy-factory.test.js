'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scratchDir } = require('../helpers/tmp-dir');
const {
  FACTORY_POLICY_ENV, FACTORY_POLICY_REL_PATH, FACTORY_REFUSED_KEYS, readFactoryPolicy, splitTopLevelChunks,
} = require('../../plugin/bin/lib/policy-factory');
const { parseFlatLines, parseDriverModels, resolvePolicyKeys } = require('../../plugin/bin/lib/policy-schema');

function homeWith(fileText) {
  const dir = scratchDir('factory-policy-');
  if (fileText !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(dir, FACTORY_POLICY_REL_PATH), fileText);
  }
  return dir;
}
const read = (envText, dir) => readFactoryPolicy({ env: envText === undefined ? {} : { [FACTORY_POLICY_ENV]: envText }, homeDir: () => dir });
const VALID_BLOCK = (role, profile) => `express-driver-models:\n  ${role}: ${profile}\n`;

test('exported names are final', () => {
  assert.equal(FACTORY_POLICY_ENV, 'CLAUDE_TWEAKS_FACTORY_POLICY');
  assert.equal(FACTORY_POLICY_REL_PATH, '.claude-tweaks/factory-policy.yml');
  assert.deepEqual(FACTORY_REFUSED_KEYS, ['merge-authorization', 'control-mode', 'deploy-command', 'release-hook']);
});

test('env only: raw is the variable verbatim, origin env', () => {
  const dir = homeWith();
  assert.deepEqual(read('model-stance: economy', dir), { raw: 'model-stance: economy', origin: 'env', warnings: [] });
});

test('file only: raw is the file verbatim, origin file', () => {
  const text = '# factory\nmodel-stance: max-rigor\n';
  assert.deepEqual(read(undefined, homeWith(text)), { raw: text, origin: 'file', warnings: [] });
});

test('whitespace-only variable counts as absent', () => {
  assert.deepEqual(read('  \n ', homeWith()), { raw: null, origin: null, warnings: [] });
  const withFile = read('  \n ', homeWith('autonomy: trusted\n'));
  assert.equal(withFile.origin, 'file');
  assert.equal(withFile.raw, 'autonomy: trusted\n');
});

test('env wins per flat key, file-only keys kept', () => {
  const result = read('model-stance: economy', homeWith('model-stance: max-rigor\nautonomy: trusted\n'));
  assert.deepEqual(parseFlatLines(result.raw), { 'model-stance': 'economy', autonomy: 'trusted' });
  assert.equal(result.origin, 'env+file');
});

test('whole block key in the variable replaces the file\'s', () => {
  const result = read(VALID_BLOCK('implementer', 'fast'), homeWith('express-driver-models:\n  reviewer: capable\n  implementer: standard\n'));
  assert.deepEqual(parseDriverModels(result.raw).value, { implementer: 'fast' });
});

test('alias in the file and new name in the variable merge as one key', () => {
  const result = read('auto-merge-max-lines: 20', homeWith('automerge-max-lines: 10\n'));
  assert.ok(result.raw.includes('auto-merge-max-lines: 20'));
  assert.ok(!result.raw.includes('automerge-max-lines'));
});

test('alias in the variable wins over the new name in the file and keeps its spelling', () => {
  const result = read('automerge-max-lines: 20', homeWith('auto-merge-max-lines: 10\n'));
  assert.ok(result.raw.includes('automerge-max-lines: 20'));
  assert.ok(!result.raw.includes('auto-merge-max-lines'));
});

test('within one source the last chunk of a key wins', () => {
  const result = read('autonomy: trusted\nautonomy: unattended', homeWith('model-stance: economy\n'));
  assert.deepEqual(parseFlatLines(result.raw), { autonomy: 'unattended', 'model-stance': 'economy' });
});

test('malformed variable block is dropped for the file\'s, with the warning', () => {
  const result = read('express-driver-models:\n  bogus: fast\n', homeWith(VALID_BLOCK('implementer', 'fast')));
  assert.equal(parseDriverModels(result.raw).ok, true);
  assert.deepEqual(parseDriverModels(result.raw).value, { implementer: 'fast' });
  assert.deepEqual(result.warnings, ['resolve-policy: warning: express-driver-models has invalid value "express-driver-models:" in CLAUDE_TWEAKS_FACTORY_POLICY — using ~/.claude-tweaks/factory-policy.yml\'s block\n']);
});

test('malformed model-profiles variable block is dropped for the file\'s', () => {
  const result = read('model-profiles:\n  fast:\n    bogus: x\n', homeWith('model-profiles:\n  fast:\n    model: haiku\n'));
  assert.ok(result.raw.includes('model: haiku'));
  assert.ok(!result.raw.includes('bogus'));
  assert.equal(result.warnings.length, 1);
});

test('malformed variable map block with no file block is kept (nothing to fall back to)', () => {
  const result = read('express-driver-models:\n  bogus: fast\n', homeWith('autonomy: trusted\n'));
  assert.ok(result.raw.includes('bogus: fast'));
  assert.deepEqual(result.warnings, []);
});

test('risk-path-globs in the variable always wins, never dropped here', () => {
  const result = read('risk-path-globs:\n  nonsense: [a]\n', homeWith('risk-path-globs:\n  auth: [auth/**]\n'));
  assert.ok(result.raw.includes('nonsense'));
  assert.ok(!result.raw.includes('auth/**'));
  assert.deepEqual(result.warnings, []);
});

test('refused keys are carried in raw (the resolver refuses them)', () => {
  const result = read('control-mode: on', homeWith('autonomy: trusted\n'));
  assert.ok(result.raw.includes('control-mode: on'));
});

test('directory at the file path: absent plus one could-not-read warning', () => {
  const dir = homeWith();
  fs.mkdirSync(path.join(dir, FACTORY_POLICY_REL_PATH), { recursive: true });
  const result = read(undefined, dir);
  assert.deepEqual(result, { raw: null, origin: null, warnings: ['resolve-policy: warning: could not read ~/.claude-tweaks/factory-policy.yml (EISDIR) — factory file ignored\n'] });
});

function trySymlink(target, linkPath, t) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (err) {
    if (process.platform === 'win32' && err.code === 'EPERM') { t.skip('symlinks need privilege on win32'); return false; }
    throw err;
  }
}

test('dangling symlink reads as absent, silent', (t) => {
  const dir = homeWith();
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  if (!trySymlink(path.join(dir, 'missing.yml'), path.join(dir, FACTORY_POLICY_REL_PATH), t)) return;
  assert.deepEqual(read(undefined, dir), { raw: null, origin: null, warnings: [] });
});

test('symlink to a readable file is read', (t) => {
  const dir = homeWith();
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'real.yml'), 'autonomy: trusted\n');
  if (!trySymlink(path.join(dir, 'real.yml'), path.join(dir, FACTORY_POLICY_REL_PATH), t)) return;
  assert.deepEqual(read(undefined, dir), { raw: 'autonomy: trusted\n', origin: 'file', warnings: [] });
});

test('no homeDir function: home comes from env.HOME, then env.USERPROFILE; neither means no read', () => {
  const seen = [];
  const readFile = (p) => { seen.push(p); return 'autonomy: trusted\n'; };
  readFactoryPolicy({ env: { HOME: '/h', USERPROFILE: '/u' }, readFile });
  readFactoryPolicy({ env: { USERPROFILE: '/u' }, readFile });
  const none = readFactoryPolicy({ env: {}, readFile });
  assert.deepEqual(seen, [path.join('/h', FACTORY_POLICY_REL_PATH), path.join('/u', FACTORY_POLICY_REL_PATH)]);
  assert.deepEqual(none, { raw: null, origin: null, warnings: [] });
});

test('a homeDir function wins over env.HOME', () => {
  const seen = [];
  readFactoryPolicy({ env: { HOME: '/h' }, homeDir: () => '/injected', readFile: (p) => { seen.push(p); return ''; } });
  assert.deepEqual(seen, [path.join('/injected', FACTORY_POLICY_REL_PATH)]);
});

test('a non-ENOENT read error without a code still warns', () => {
  const result = readFactoryPolicy({ env: { HOME: '/h' }, readFile: () => { throw new Error('boom'); } });
  assert.equal(result.raw, null);
  assert.deepEqual(result.warnings, ['resolve-policy: warning: could not read ~/.claude-tweaks/factory-policy.yml (UNKNOWN) — factory file ignored\n']);
});

test('CRLF factory text resolves like policy.yml', () => {
  const { raw } = readFactoryPolicy({ env: { [FACTORY_POLICY_ENV]: 'model-stance: economy # note\r\n' } });
  const resolved = resolvePolicyKeys(['model-stance'], { factoryRaw: raw });
  assert.equal(resolved['model-stance'].value, 'economy');
});

test('splitTopLevelChunks', () => {
  const chunks = splitTopLevelChunks('# lead\na: 1\nb:\n  x: y\n\n"c": 2\n');
  assert.deepEqual(chunks.map((c) => c.key), ['a', 'b', 'c']);
  assert.equal(chunks[1].text, 'b:\n  x: y\n');
});

test('splitTopLevelChunks: comments between rows stay in the chunk, a column-0 non-key line ends it', () => {
  const chunks = splitTopLevelChunks("'k':\n  # note\n  a: 1\n- stray\nz: 2\n");
  assert.deepEqual(chunks.map((c) => c.key), ['k', 'z']);
  assert.equal(chunks[0].text, "'k':\n  # note\n  a: 1\n");
});
