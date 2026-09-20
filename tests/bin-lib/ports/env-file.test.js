'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  serviceVars, mergeManagedRegion, hasComposeFile, writeEnvFiles, BEGIN_MARKER, END_MARKER,
  leaseVars, LEASE_KEY, readManagedRegion,
} = require('../../../plugin/bin/lib/ports/env-file');

// AC9
test('serviceVars: first service -> PORT, later ones -> sanitized {NAME}_PORT', () => {
  assert.deepEqual(
    serviceVars(['web', 'api', 'db'], 20010),
    [['PORT', '20010'], ['API_PORT', '20011'], ['DB_PORT', '20012']],
  );
  assert.deepEqual(serviceVars(['my-db'], 20000), [['PORT', '20000']]);
  assert.deepEqual(serviceVars(['web', 'my-db'], 20000)[1], ['MY_DB_PORT', '20001']);
});

// AC10
test('mergeManagedRegion: replaces only the region, is idempotent, preserves CRLF, appends when absent', () => {
  const withForeign = `TOP=1\n${BEGIN_MARKER}\nPORT=1\n${END_MARKER}\nBOTTOM=1\n`;
  const merged = mergeManagedRegion(withForeign, [['PORT', '20000']]);
  assert.equal(merged, `TOP=1\n${BEGIN_MARKER}\nPORT=20000\n${END_MARKER}\nBOTTOM=1\n`);

  const mergedTwice = mergeManagedRegion(merged, [['PORT', '20000']]);
  assert.equal(mergedTwice, merged, 'running it twice yields identical bytes');

  const crlf = `TOP=1\r\n${BEGIN_MARKER}\r\nPORT=1\r\n${END_MARKER}\r\nBOTTOM=1\r\n`;
  const mergedCrlf = mergeManagedRegion(crlf, [['PORT', '20005']]);
  assert.ok(mergedCrlf.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(mergedCrlf), 'no bare LF introduced into a CRLF file');

  const noRegion = 'FOO=bar\n';
  const appended = mergeManagedRegion(noRegion, [['PORT', '20000']]);
  assert.ok(appended.startsWith('FOO=bar\n'));
  assert.ok(appended.includes(BEGIN_MARKER));
  assert.ok(appended.endsWith('\n'));

  const empty = mergeManagedRegion('', [['PORT', '20000']]);
  assert.equal(empty, `${BEGIN_MARKER}\nPORT=20000\n${END_MARKER}\n`);
});

// AC11 + writeEnvFiles skip-when-unchanged gotcha
test('writeEnvFiles: .env.local always, .env only with a Compose file, skips an unchanged write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-file-'));
  const vars = [['PORT', '20000']];

  const r1 = writeEnvFiles(dir, vars);
  assert.deepEqual(r1.written, [path.join(dir, '.env.local')]);
  assert.equal(fs.existsSync(path.join(dir, '.env')), false);

  const mtimeBefore = fs.statSync(path.join(dir, '.env.local')).mtimeMs;
  const r2 = writeEnvFiles(dir, vars);
  assert.deepEqual(r2.written, [], 'no write when content is unchanged');
  assert.equal(fs.statSync(path.join(dir, '.env.local')).mtimeMs, mtimeBefore);

  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n');
  assert.equal(hasComposeFile(dir), true);
  const r3 = writeEnvFiles(dir, [['PORT', '20010']]);
  assert.deepEqual(
    r3.written.sort(),
    [path.join(dir, '.env'), path.join(dir, '.env.local')].sort(),
  );
});

// #1927 AC1: the lease token is the first managed line, before PORT.
test('leaseVars + serviceVars: CLAUDE_TWEAKS_LEASE first, then PORT and {NAME}_PORT; round-trips through the managed region', () => {
  assert.deepEqual(leaseVars(43120), [['CLAUDE_TWEAKS_LEASE', '43120']]);
  assert.equal(LEASE_KEY, 'CLAUDE_TWEAKS_LEASE');
  const vars = [...leaseVars(43120), ...serviceVars(['api', 'web'], 43120)];
  assert.deepEqual(vars, [['CLAUDE_TWEAKS_LEASE', '43120'], ['PORT', '43120'], ['WEB_PORT', '43121']]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ports-lease-'));
  writeEnvFiles(dir, vars);
  const text = fs.readFileSync(path.join(dir, '.env.local'), 'utf8');
  const region = readManagedRegion(text);
  assert.deepEqual(region, vars, 'the region round-trips every pair in order');
  assert.equal(region[0][0], 'CLAUDE_TWEAKS_LEASE', 'the lease line is first');
  const lines = text.split('\n');
  assert.equal(lines.indexOf('CLAUDE_TWEAKS_LEASE=43120'), lines.indexOf(BEGIN_MARKER) + 1);
});

test('leaseVars: a CRLF file keeps its EOL with the new first line (#1927, #1787 precedent)', () => {
  const crlf = `TOP=1\r\n${BEGIN_MARKER}\r\nPORT=1\r\n${END_MARKER}\r\n`;
  const merged = mergeManagedRegion(crlf, [...leaseVars(20005), ...serviceVars(['web'], 20005)]);
  assert.ok(merged.includes(`${BEGIN_MARKER}\r\nCLAUDE_TWEAKS_LEASE=20005\r\nPORT=20005\r\n${END_MARKER}`));
  assert.ok(!/[^\r]\n/.test(merged), 'no bare LF introduced');
});
