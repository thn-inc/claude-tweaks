'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scrubStoryArtifacts, REDACTION_MARKER } = require('../../../plugin/bin/lib/qa-scrub/scrub');
const { parseSecrets } = require('../../../plugin/bin/lib/qa-scrub/secrets');
const { scrubLine } = require('../../../plugin/bin/lib/qa-scrub/line');

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'qa-scrub');
const TOKEN = 'FAKE-QA-TOKEN-0000-not-a-real-secret';
const KEY = 'FAKE-QA-KEY-9999';
const T0 = 1761818400; // story start, seconds
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const created = [];
test.after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true }); });

function put(file, content, mtime) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.utimesSync(file, mtime, mtime);
  return file;
}

// A story's artifacts as playwright-cli and the qa-agent leave them: step
// screenshots, a relocated trace, and the shared .playwright-cli output dir.
function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-scrub-'));
  created.push(root);
  const screenshots = path.join(root, 'shots', 'tokens', 'reveal-once');
  const traces = path.join(root, 'traces', 'reveal-once');
  const cliDir = path.join(root, '.playwright-cli');
  const f = {
    shot0: put(path.join(screenshots, '00_open.png'), Buffer.concat([PNG, Buffer.from('nothing to see')]), T0 + 1),
    snapshot: put(path.join(cliDir, 'page-2026-10-30T10-00-02-000Z.yml'), fs.readFileSync(path.join(FIX, 'page-reveal.yml')), T0 + 2),
    sibling: put(path.join(cliDir, 'page-2026-10-30T10-00-02-500Z.yml'), '- heading "Other story" [level=1] [ref=e1]\n', T0 + 2),
    shot1: put(path.join(screenshots, '01_click-reveal.png'), Buffer.concat([PNG, Buffer.from(TOKEN)]), T0 + 3),
    frame: put(path.join(cliDir, 'traces', 'resources', 'frame1'), Buffer.concat([JPEG, Buffer.from(TOKEN)]), T0 + 3),
    shot2: put(path.join(screenshots, '02_verify.png'), Buffer.concat([PNG, Buffer.from(TOKEN)]), T0 + 4),
    console: put(path.join(cliDir, 'console-2026-10-30T10-00-00-000Z.log'), fs.readFileSync(path.join(FIX, 'console-reveal.log')), T0 + 5),
    trace: put(path.join(traces, '2026-10-30T10-00-06Z.trace'), fs.readFileSync(path.join(FIX, 'trace-reveal.trace')), T0 + 6),
    network: put(path.join(cliDir, 'traces', 'trace-1761818401000.network'), `{"type":"resource-snapshot","snapshot":{"response":{"content":{"text":"{\\"token\\":\\"${TOKEN}\\"}"}}}}\n`, T0 + 6),
    old: put(path.join(cliDir, 'page-2026-10-29T09-00-00-000Z.yml'), `- code [ref=e4]: ${TOKEN}\n`, T0 - 100),
  };
  return { root, screenshots, traces, cliDir, since: new Date((T0 - 1) * 1000), f };
}

function secretsOf(spec) {
  const { secrets, error } = parseSecrets(spec);
  assert.equal(error, undefined);
  return secrets;
}

function run(tree, spec) {
  return scrubStoryArtifacts({
    secrets: secretsOf(spec), screenshots: tree.screenshots, traces: tree.traces, cliDir: tree.cliDir, since: tree.since,
  });
}

// grep -r over the story's in-scope paths; exit 1 means no match anywhere.
function grepFinds(needle, paths) {
  try {
    execFileSync('grep', ['-r', '-F', '-l', needle, ...paths], { stdio: 'pipe' });
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

function inScope(tree) {
  return [tree.screenshots, tree.traces, path.join(tree.cliDir, 'traces'), tree.f.snapshot, tree.f.sibling, tree.f.console];
}

const PATTERN = [{ pattern: 'FAKE-QA-TOKEN-\\d{4}-[a-z-]+' }];

test('AC1.1: a pattern secret leaves zero matches under the story dirs (grep -r)', () => {
  const tree = makeTree();
  assert.equal(grepFinds('FAKE-QA-TOKEN-0000', inScope(tree)), true, 'fixture must hold the token before the scrub');
  const out = run(tree, PATTERN);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(grepFinds('FAKE-QA-TOKEN-0000', inScope(tree)), false);
  assert.equal(fs.readFileSync(tree.f.old, 'utf8'), `- code [ref=e4]: ${TOKEN}\n`, 'a file older than --since is out of scope');
});

test('AC2.1: screenshots from the reveal step onward are removed', () => {
  const tree = makeTree();
  const out = run(tree, PATTERN);
  assert.equal(out.reveal, 'snapshot');
  assert.equal(fs.existsSync(tree.f.shot1), false);
  assert.equal(fs.existsSync(tree.f.shot2), false);
  assert.equal(fs.existsSync(tree.f.frame), false, 'a trace screencast frame after the reveal is a screenshot too');
  assert.equal(out.screenshots_removed, 3);
});

test('AC2.2: earlier screenshots are kept', () => {
  const tree = makeTree();
  const before = fs.readFileSync(tree.f.shot0);
  run(tree, PATTERN);
  assert.deepEqual(fs.readFileSync(tree.f.shot0), before);
});

test('AC6.1: snapshot YAML, trace and console log are rewritten with the marker', () => {
  const tree = makeTree();
  run(tree, PATTERN);
  for (const file of [tree.f.snapshot, tree.f.trace, tree.f.console, tree.f.network]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes(REDACTION_MARKER), `${path.basename(file)} carries the marker`);
    assert.ok(!text.includes(TOKEN), `${path.basename(file)} no longer holds the token`);
  }
  // The rest of each file is untouched: the trace stays line-delimited JSON.
  for (const line of fs.readFileSync(tree.f.trace, 'utf8').trim().split('\n')) JSON.parse(line);
});

test('AC3.1: counts and line', () => {
  const tree = makeTree();
  const out = run(tree, PATTERN);
  assert.equal(out.values_scrubbed, 1);
  assert.equal(out.artifacts_scrubbed, 4);
  assert.equal(out.screenshots_removed, 3);
  assert.equal(out.line, scrubLine(out));
  assert.equal(out.line, '1 secret value(s) scrubbed from 4 artifact(s); 3 screenshot(s) removed');
  assert.ok(!JSON.stringify(out).includes('FAKE-QA-TOKEN'), 'the outcome never carries a value');
});

test('a locator secret resolves from the reveal snapshot and joins the scrub', () => {
  const tree = makeTree();
  const out = run(tree, [{ locator: { role: 'textbox', name: 'API key' } }]);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.values_scrubbed, 1);
  assert.equal(grepFinds(KEY, inScope(tree)), false);
  assert.ok(!JSON.stringify(out).includes(KEY));
  // The token was not declared, so it stays.
  assert.equal(grepFinds('FAKE-QA-TOKEN-0000', [tree.f.console]), true);
});

test('a locator value is also scrubbed in its JSON-escaped form', () => {
  const tree = makeTree();
  put(path.join(tree.cliDir, 'page-2026-10-30T10-00-03-000Z.yml'), '- textbox "Code" [ref=e1]: "FAKE\\"QUOTED-1234"\n', T0 + 3);
  put(path.join(tree.traces, 'quoted.trace'), '{"value":"FAKE\\"QUOTED-1234"}\n', T0 + 6);
  const out = run(tree, [{ locator: { label: 'Code' } }]);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.values_scrubbed, 1);
  assert.equal(grepFinds('QUOTED-1234', inScope(tree)), false);
});

test('AC5.1: an unreadable trace fails the scrub and lists its path', () => {
  const tree = makeTree();
  const broken = path.join(tree.traces, 'broken.trace');
  fs.symlinkSync(path.join(tree.root, 'does-not-exist'), broken);
  const out = run(tree, PATTERN);
  assert.equal(out.ok, false);
  assert.ok(out.remaining.includes(broken));
  const err = out.errors.find((e) => e.path === broken);
  assert.ok(err && typeof err.code === 'string' && err.code !== '');
});

test('a zip trace is deleted and counted', () => {
  const tree = makeTree();
  const zip = put(path.join(tree.traces, 't.trace'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), T0 + 6);
  const out = run(tree, PATTERN);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(fs.existsSync(zip), false);
  assert.deepEqual(out.deleted, [{ path: zip, reason: 'zip-container' }]);
  assert.equal(out.artifacts_scrubbed, 5);
});

test('a binary artifact holding the secret is deleted', () => {
  const tree = makeTree();
  const bin = put(path.join(tree.traces, 'blob.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(TOKEN)]), T0 + 6);
  const out = run(tree, PATTERN);
  assert.equal(fs.existsSync(bin), false);
  assert.deepEqual(out.deleted, [{ path: bin, reason: 'binary' }]);
});

test('an unresolved locator fails rather than reporting clean', () => {
  const tree = makeTree();
  const out = run(tree, [{ locator: { role: 'textbox', name: 'Nope' } }]);
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors, [{ locator: 0, code: 'locator-unresolved' }]);
  assert.ok(out.remaining.length > 0, 'every in-scope file is unproven');
});

test('a too-short locator value is refused, not scrubbed', () => {
  const tree = makeTree();
  put(path.join(tree.cliDir, 'page-2026-10-30T10-00-03-000Z.yml'), '- textbox "Pin" [ref=e1]: 42\n', T0 + 3);
  const out = run(tree, [{ locator: { label: 'Pin' } }]);
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors, [{ locator: 0, code: 'locator-value-too-short' }]);
});

test('no matches deletes nothing and flags no_matches', () => {
  const tree = makeTree();
  const out = run(tree, [{ pattern: 'NEVER-PRESENT-\\d+' }]);
  assert.equal(out.ok, true);
  assert.equal(out.no_matches, true);
  assert.equal(out.reveal, 'none');
  for (const file of Object.values(tree.f)) assert.equal(fs.existsSync(file), true);
  assert.equal(out.line, '0 secret value(s) scrubbed from 0 artifact(s); 0 screenshot(s) removed');
});

test('a match outside any snapshot leaves the reveal unknown and drops every screenshot', () => {
  const tree = makeTree();
  fs.unlinkSync(tree.f.snapshot);
  const out = run(tree, PATTERN);
  assert.equal(out.reveal, 'unknown');
  assert.equal(fs.existsSync(tree.f.shot0), false);
  assert.equal(out.ok, true);
});

test('a sibling story file in cliDir without the secret is not rewritten', () => {
  const tree = makeTree();
  const before = fs.statSync(tree.f.sibling).mtimeMs;
  run(tree, PATTERN);
  assert.equal(fs.statSync(tree.f.sibling).mtimeMs, before);
  assert.equal(fs.readFileSync(tree.f.sibling, 'utf8'), '- heading "Other story" [level=1] [ref=e1]\n');
});

test('missing trace and cli dirs are an empty scope', () => {
  const tree = makeTree();
  const out = scrubStoryArtifacts({
    secrets: secretsOf(PATTERN), screenshots: tree.screenshots, traces: path.join(tree.root, 'nope'), cliDir: path.join(tree.root, 'nope2'), since: tree.since,
  });
  assert.equal(out.ok, true);
  assert.equal(out.reveal, 'none', 'image bytes are never searched — pixels are judged by reveal time only');
  assert.equal(fs.existsSync(tree.f.shot1), true);
});
