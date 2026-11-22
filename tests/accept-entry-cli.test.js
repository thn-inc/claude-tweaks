'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { PACKET_MARKER } = require('../plugin/bin/lib/wrap-up/packet-contract');
const { REFRESHABLE_FIELDS } = require('../plugin/bin/lib/issues/accept-entry');

const BIN = path.join(__dirname, '..', 'plugin', 'bin', 'accept-entry.js');

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'accept-entry-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const write = (file, text) => { fs.writeFileSync(file, text); return file; };
const writeJson = (file, value) => write(file, JSON.stringify(value));

const unexpectedGh = (args) => { throw new Error(`unexpected gh ${args.join(' ')}`); };
const cli = (argv, { cwd, deps = {} } = {}) => runCliSync(BIN, argv, { cwd, deps: { gh: unexpectedGh, ...deps } });
const json = (result) => JSON.parse(result.stdout);

const packetBody = (deploy, guide = '- Open <http://localhost:3000/x>') => [
  PACKET_MARKER, '', '### Recording', 'not recorded', '', '### Test guide', guide, '', '### Deploy status', ...deploy, '',
].join('\n');

const comment = (body, createdAt, url) => ({ id: url, url, body, createdAt, authorAssociation: 'OWNER', author: { login: 'owner' } });

function ghReturning(comments, calls = []) {
  return (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'view' && args.includes('comments')) return JSON.stringify({ comments });
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
}

// --- auto-label ---

test('auto-label on an approved record prints action none', (t) => {
  const dir = tempDir(t);
  const labels = writeJson(path.join(dir, 'labels.json'), { labels: [{ name: 'accept:approved' }] });
  const result = cli(['auto-label', '--labels-json', labels]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '{"action":"none"}\n');
});

test('auto-label reads a bare name array and a relative path against the injected cwd', (t) => {
  const dir = tempDir(t);
  writeJson(path.join(dir, 'labels.json'), ['ready']);
  const result = cli(['auto-label', '--labels-json', 'labels.json'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result), { action: 'apply-pending' });
});

test('auto-label --acceptance-facet: approved → none, empty → apply-pending', () => {
  const approved = cli(['auto-label', '--acceptance-facet', 'approved']);
  assert.equal(approved.code, 0, approved.stderr);
  assert.equal(approved.stdout, '{"action":"none"}\n');
  const empty = cli(['auto-label', '--acceptance-facet', '']);
  assert.equal(empty.code, 0, empty.stderr);
  assert.equal(empty.stdout, '{"action":"apply-pending"}\n');
});

test('auto-label with both inputs, neither, or an unknown facet value is exit 2', (t) => {
  const dir = tempDir(t);
  const labels = writeJson(path.join(dir, 'labels.json'), []);
  assert.equal(cli(['auto-label', '--labels-json', labels, '--acceptance-facet', 'pending']).code, 2);
  assert.equal(cli(['auto-label']).code, 2);
  assert.equal(cli(['auto-label', '--acceptance-facet', 'maybe']).code, 2);
});

test('unreadable --labels-json → exit 1', (t) => {
  const dir = tempDir(t);
  const missing = path.join(dir, 'missing.json');
  const garbage = write(path.join(dir, 'garbage.json'), '{not json');
  const wrongShape = writeJson(path.join(dir, 'shape.json'), { labels: 'accept:approved' });
  for (const file of [missing, garbage, wrongShape]) {
    const result = cli(['auto-label', '--labels-json', file]);
    assert.equal(result.code, 1, file);
    assert.equal(result.stdout, '', file);
  }
});

// --- read ---

test('read writes the earliest trusted packet and lists the later one in extras', (t) => {
  const dir = tempDir(t);
  const early = packetBody(['target: local']);
  const late = packetBody(['target: dev, confirmed live']);
  const calls = [];
  const gh = ghReturning([
    comment(late, '2026-11-02T00:00:00Z', 'https://github.com/o/r/issues/7#c2'),
    { body: 'plain comment', createdAt: '2026-11-01T00:00:00Z', authorAssociation: 'OWNER' },
    comment(early, '2026-11-01T00:00:00Z', 'https://github.com/o/r/issues/7#c1'),
  ], calls);
  const result = cli(['read', '--record', '7', '--out', 'packet.md'], { cwd: dir, deps: { gh } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result), {
    status: 'found', url: 'https://github.com/o/r/issues/7#c1', extras: ['https://github.com/o/r/issues/7#c2'], skipped: [],
  });
  assert.equal(fs.readFileSync(path.join(dir, 'packet.md'), 'utf8'), early);
  assert.deepEqual(calls[0].slice(0, 5), ['issue', 'view', '7', '--json', 'comments']);
});

test('read passes --repo to gh', (t) => {
  const dir = tempDir(t);
  const calls = [];
  const pinned = [];
  const result = cli(['read', '--record', '7', '--out', path.join(dir, 'p.md'), '--repo', 'o/r'], {
    deps: { gh: ghReturning([], calls), pinGhHost: (spec) => pinned.push(spec) },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(calls[0].slice(-2), ['--repo', 'o/r']);
  assert.equal(pinned.length, 1);
  assert.deepEqual(pinned[0], { host: 'github.com', owner: 'o', repo: 'r' });
});

test('read with no packet reports none and leaves no packet file, an earlier one included', (t) => {
  const dir = tempDir(t);
  const out = write(path.join(dir, 'packet.md'), 'an earlier run\'s packet');
  const result = cli(['read', '--record', '7', '--out', out], { deps: { gh: ghReturning([{ body: 'hi', authorAssociation: 'OWNER' }]) } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result), { status: 'none', url: null, extras: [], skipped: [] });
  assert.equal(fs.existsSync(out), false);
});

test('read with an older-schema packet reports unreadable and writes its body', (t) => {
  const dir = tempDir(t);
  const out = path.join(dir, 'packet.md');
  const body = '<!-- acceptance-packet: v99 -->\nfuture';
  const result = cli(['read', '--record', '7', '--out', out], {
    deps: { gh: ghReturning([comment(body, '2026-11-01T00:00:00Z', 'u1')]) },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(json(result).status, 'unreadable');
  assert.equal(fs.readFileSync(out, 'utf8'), body);
});

test('read with a throwing gh runner exits 1, never reports none, and removes an earlier --out', (t) => {
  const dir = tempDir(t);
  const out = write(path.join(dir, 'packet.md'), 'an earlier run\'s packet');
  const result = cli(['read', '--record', '7', '--out', out], { deps: { gh: () => { throw new Error('gh: HTTP 502'); } } });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /HTTP 502/);
  assert.equal(fs.existsSync(out), false);
});

test('read with an unwritable --out exits 1', (t) => {
  const dir = tempDir(t);
  const result = cli(['read', '--record', '7', '--out', path.join(dir, 'no', 'such', 'dir', 'p.md')], {
    deps: { gh: ghReturning([comment(packetBody(['target: local']), '2026-11-01T00:00:00Z', 'u1')]) },
  });
  assert.equal(result.code, 1);
});

test('read refuses a malformed --record or --repo with exit 2', (t) => {
  const dir = tempDir(t);
  assert.equal(cli(['read', '--record', '0', '--out', path.join(dir, 'p.md')]).code, 2);
  assert.equal(cli(['read', '--record', '7']).code, 2);
  assert.equal(cli(['read', '--record', '7', '--out', path.join(dir, 'p.md'), '--repo', 'nope']).code, 2);
});

// --- state ---

test('state with no --packet-file and --packet-status none prints no-packet', () => {
  const result = cli(['state', '--acceptance-facet', 'pending', '--packet-status', 'none']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(json(result).state, 'no-packet');
});

test('state reads a relative --packet-file as found', (t) => {
  const dir = tempDir(t);
  write(path.join(dir, 'packet.md'), packetBody(['target: dev, confirmed live']));
  writeJson(path.join(dir, 'labels.json'), { labels: [{ name: 'accept:pending' }] });
  const result = cli(['state', '--labels-json', 'labels.json', '--packet-file', 'packet.md'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result), { state: 'live-on-dev', recording: false, verdict: null, message: null });
});

test('state refuses a missing packet input or a contradictory one with exit 2', (t) => {
  const dir = tempDir(t);
  const file = write(path.join(dir, 'packet.md'), packetBody(['target: local']));
  assert.equal(cli(['state', '--acceptance-facet', '']).code, 2);
  assert.equal(cli(['state', '--acceptance-facet', '', '--packet-status', 'found']).code, 2);
  assert.equal(cli(['state', '--acceptance-facet', '', '--packet-status', 'none', '--packet-file', file]).code, 2);
  assert.equal(cli(['state', '--acceptance-facet', '', '--packet-status', 'bogus']).code, 2);
});

test('state with an unreadable --packet-file exits 1', (t) => {
  const dir = tempDir(t);
  const result = cli(['state', '--acceptance-facet', '', '--packet-file', path.join(dir, 'missing.md')]);
  assert.equal(result.code, 1);
});

// --- refresh ---

test('refresh writes --out and prints refreshed and unverified', (t) => {
  const dir = tempDir(t);
  write(path.join(dir, 'packet.md'), packetBody(['target: local', 'ref: aaa1111']));
  writeJson(path.join(dir, 'deploy.json'), { ref: 'bbb2222', text: 'target: dev, confirmed live', devBaseUrl: 'https://dev.example.com' });
  const result = cli(['refresh', '--packet-file', 'packet.md', '--out', 'fresh.md', '--deploy-json', 'deploy.json'], { cwd: dir });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result), { refreshed: ['deploy-status', 'test-guide-base-url'], unverified: ['recording-link'] });
  const fresh = fs.readFileSync(path.join(dir, 'fresh.md'), 'utf8');
  assert.match(fresh, /^ref: bbb2222$/m);
  assert.match(fresh, /<https:\/\/dev\.example\.com\/x>/);
});

test('refresh with no --deploy-json writes the packet unchanged and reports every field unverified', (t) => {
  const dir = tempDir(t);
  const body = packetBody(['target: local', 'ref: aaa1111']);
  const packet = write(path.join(dir, 'packet.md'), body);
  const out = path.join(dir, 'fresh.md');
  const result = cli(['refresh', '--packet-file', packet, '--out', out]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result), { refreshed: [], unverified: [...REFRESHABLE_FIELDS] });
  assert.equal(fs.readFileSync(out, 'utf8'), body);
});

test('refresh with an invalid --deploy-json or unreadable --packet-file exits 1 and removes an earlier --out', (t) => {
  const dir = tempDir(t);
  const packet = write(path.join(dir, 'packet.md'), packetBody(['target: local', 'ref: aaa1111']));
  const out = path.join(dir, 'fresh.md');
  const noRef = writeJson(path.join(dir, 'noref.json'), { text: 'target: dev' });
  const badUrl = writeJson(path.join(dir, 'badurl.json'), { ref: 'bbb2222', text: 'target: dev', devBaseUrl: 'not a url' });
  const cases = [
    ['refresh', '--packet-file', packet, '--out', out, '--deploy-json', noRef],
    ['refresh', '--packet-file', packet, '--out', out, '--deploy-json', badUrl],
    ['refresh', '--packet-file', path.join(dir, 'missing.md'), '--out', out],
  ];
  for (const argv of cases) {
    write(out, 'an earlier refresh\'s packet');
    assert.equal(cli(argv).code, 1, argv.join(' '));
    assert.equal(fs.existsSync(out), false, `stale --out left behind: ${argv.join(' ')}`);
  }
});

test('refresh with a --deploy-json ref outside the sha grammar exits 1 and leaves the input untouched', (t) => {
  const dir = tempDir(t);
  const body = packetBody(['target: local', 'ref: aaa1111']);
  const packet = write(path.join(dir, 'packet.md'), body);
  const out = path.join(dir, 'fresh.md');
  for (const ref of ['BBB2222', 'bbb', 'bbb2222 ', ' ', 42]) {
    const deploy = writeJson(path.join(dir, 'deploy.json'), { ref, text: 'target: dev, confirmed live' });
    write(out, 'an earlier refresh\'s packet');
    const result = cli(['refresh', '--packet-file', packet, '--out', out, '--deploy-json', deploy]);
    assert.equal(result.code, 1, JSON.stringify(ref));
    assert.match(result.stderr, /--deploy-json .* needs a ref \(a lowercase hex sha, 7-64 characters\)/, JSON.stringify(ref));
    assert.equal(result.stdout, '', JSON.stringify(ref));
    assert.equal(fs.existsSync(out), false, `stale --out left behind: ${JSON.stringify(ref)}`);
    assert.equal(fs.readFileSync(packet, 'utf8'), body, JSON.stringify(ref));
  }
});

test('refresh with an unwritable --out exits 1', (t) => {
  const dir = tempDir(t);
  const packet = write(path.join(dir, 'packet.md'), packetBody(['target: local', 'ref: aaa1111']));
  const result = cli(['refresh', '--packet-file', packet, '--out', path.join(dir, 'no', 'such', 'dir', 'fresh.md')]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /could not write --out/);
});

test('refresh refuses an --out that is the --packet-file with exit 2 and leaves the input', (t) => {
  const dir = tempDir(t);
  const body = packetBody(['target: local', 'ref: aaa1111']);
  const packet = write(path.join(dir, 'packet.md'), body);
  const badDeploy = writeJson(path.join(dir, 'deploy.json'), { text: 'no ref' });
  const same = cli(['refresh', '--packet-file', packet, '--out', packet, '--deploy-json', badDeploy]);
  assert.equal(same.code, 2);
  const relative = cli(['refresh', '--packet-file', 'packet.md', '--out', path.join(dir, '.', 'packet.md'), '--deploy-json', badDeploy], { cwd: dir });
  assert.equal(relative.code, 2);
  assert.equal(fs.readFileSync(packet, 'utf8'), body);
});

test('refresh refuses a symlinked --out that points at the --packet-file with exit 2', (t) => {
  const dir = tempDir(t);
  const body = packetBody(['target: local', 'ref: aaa1111']);
  const packet = write(path.join(dir, 'packet.md'), body);
  const badDeploy = writeJson(path.join(dir, 'deploy.json'), { text: 'no ref' });
  try {
    fs.symlinkSync(packet, path.join(dir, 'link.md'));
  } catch (err) {
    t.skip(`symlinks cannot be created here (${err.code})`);
    return;
  }
  // Relative spellings, so the identity check also resolves against the injected cwd.
  const result = cli(['refresh', '--packet-file', 'packet.md', '--out', 'link.md', '--deploy-json', badDeploy], { cwd: dir });
  assert.equal(result.code, 2, result.stderr);
  assert.equal(fs.readFileSync(packet, 'utf8'), body);
});

test('refresh refuses a case alias of the --packet-file on a case-insensitive filesystem', (t) => {
  const dir = tempDir(t);
  const body = packetBody(['target: local', 'ref: aaa1111']);
  const packet = write(path.join(dir, 'packet.md'), body);
  const alias = path.join(dir, 'PACKET.md');
  let caseInsensitive = false;
  try {
    caseInsensitive = fs.statSync(alias).ino === fs.statSync(packet).ino;
  } catch {
    // ENOENT: the filesystem tells the two spellings apart.
  }
  if (!caseInsensitive) {
    t.skip('the filesystem is case-sensitive, so PACKET.md is a different file');
    return;
  }
  const badDeploy = writeJson(path.join(dir, 'deploy.json'), { text: 'no ref' });
  const result = cli(['refresh', '--packet-file', packet, '--out', alias, '--deploy-json', badDeploy]);
  assert.equal(result.code, 2, result.stderr);
  assert.equal(fs.readFileSync(packet, 'utf8'), body);
});

test('refresh refuses the same spelling even when no file identity is known (an --out not yet written)', (t) => {
  const dir = tempDir(t);
  const body = packetBody(['target: local', 'ref: aaa1111']);
  const packet = write(path.join(dir, 'packet.md'), body);
  const result = cli(['refresh', '--packet-file', packet, '--out', path.join(dir, 'x', '..', 'packet.md')], {
    deps: { fileId: () => null },
  });
  assert.equal(result.code, 2);
  assert.equal(fs.readFileSync(packet, 'utf8'), body);
});

test('refresh refuses with exit 2 when a file identity cannot be read, and removes nothing', (t) => {
  const dir = tempDir(t);
  const body = packetBody(['target: local', 'ref: aaa1111']);
  const packet = write(path.join(dir, 'packet.md'), body);
  const out = write(path.join(dir, 'out.md'), 'an earlier refresh');
  const result = cli(['refresh', '--packet-file', packet, '--out', out], {
    deps: { fileId: () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } },
  });
  assert.equal(result.code, 2);
  assert.equal(fs.readFileSync(packet, 'utf8'), body);
  assert.equal(fs.readFileSync(out, 'utf8'), 'an earlier refresh');
});

// --- labels ---

test('labels --verdict approved prints add and remove', (t) => {
  const dir = tempDir(t);
  const labels = writeJson(path.join(dir, 'labels.json'), { labels: [{ name: 'demo:pending' }, { name: 'ready' }] });
  const result = cli(['labels', '--labels-json', labels, '--verdict', 'approved']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result), { add: ['accept:approved'], remove: ['demo:pending'] });
  const batch = cli(['labels', '--labels-json', labels, '--verdict', 'approved', '--batch']);
  assert.deepEqual(json(batch), { add: ['accept:approved', 'accept:approved-batch'], remove: ['demo:pending'] });
});

test('labels with an unknown verdict is exit 2', (t) => {
  const dir = tempDir(t);
  const labels = writeJson(path.join(dir, 'labels.json'), []);
  assert.equal(cli(['labels', '--labels-json', labels, '--verdict', 'maybe']).code, 2);
});

// --- invocation ---

test('missing subcommand → exit 2', () => {
  const result = cli([]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage:/);
});

test('unknown subcommand, unknown flag, repeated flag and a trailing bare flag are exit 2', (t) => {
  const dir = tempDir(t);
  const labels = writeJson(path.join(dir, 'labels.json'), []);
  assert.equal(cli(['nope']).code, 2);
  assert.equal(cli(['auto-label', '--labels-json', labels, '--extra', 'x']).code, 2);
  assert.equal(cli(['auto-label', '--labels-json', labels, '--labels-json', labels]).code, 2);
  assert.equal(cli(['labels', '--labels-json', labels, '--verdict']).code, 2);
  assert.equal(cli(['auto-label', 'constructor', 'x']).code, 2);
});

test('--help prints the usage with exit 0', () => {
  const result = cli(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /usage: accept-entry\.js/);
});

test('a real subprocess refuses a missing subcommand with exit 2', () => {
  // real process: proves the script entry's exit code
  const result = spawnCli(BIN, []);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage:/);
});
