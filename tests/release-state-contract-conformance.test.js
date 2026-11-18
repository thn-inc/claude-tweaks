'use strict';
// Pins plugin/skills/_shared/release-state.md (#5883) to the code it documents: the section
// headings #5884/#5885 cite, the exit table against EXIT, the names and the marker example
// against the store and marker modules, and the gh-absent (MCP) procedure's load-bearing claims.
// Every go-red control runs the same helper the positive test runs, on a mutated copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { EXIT } = require('../plugin/bin/release-state');
const { RELEASE_STATE_BRANCH } = require('../plugin/bin/lib/release-state/store');
const { MARKER_FILE, parseMarker, serializeMarker } = require('../plugin/bin/lib/release-state/marker');

const CONTRACT = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'release-state.md');
const load = () => readText(CONTRACT);

const SECTIONS = [
  '## The branch and its files',
  '## reviewed-through.json',
  '## Writer rules',
  '## The CLI',
  '### Exit codes',
  '## gh-absent (MCP) path',
  '## Recovery: an orphaned or malformed marker',
];

// Headings outside fenced code, in file order.
function headings(text) {
  const out = [];
  let fenced = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    else if (!fenced && /^#{2,3} /.test(line)) out.push(line.trimEnd());
  }
  return out;
}

// The text under `heading` up to the next heading of the same or a higher level.
function sectionBody(text, heading) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const level = heading.match(/^#+/)[0].length;
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `missing ${heading}`);
  const body = [];
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (/^```/.test(line)) fenced = !fenced;
    if (!fenced && /^#{1,6} /.test(line) && line.match(/^#+/)[0].length <= level) break;
    body.push(line);
  }
  return body.join('\n');
}

function assertSections(text) {
  const found = headings(text);
  let at = -1;
  for (const h of SECTIONS) {
    const i = found.indexOf(h, at + 1);
    assert.notEqual(i, -1, `heading "${h}" is missing or out of order`);
    at = i;
  }
}

function assertExitTable(text) {
  const rows = [];
  for (const line of sectionBody(text, '### Exit codes').split('\n')) {
    const m = line.match(/^\| (\d+) \| `([^`]+)` \|/);
    if (m) rows.push([m[2], Number(m[1])]);
  }
  const expected = Object.entries(EXIT).map(([name, n]) => [name.toLowerCase().replace(/_/g, '-'), n]);
  assert.deepEqual(rows, expected);
}

function assertNamesAndExample(text) {
  assert.ok(text.includes(`\`${RELEASE_STATE_BRANCH}\``), 'names the branch');
  assert.ok(text.includes(`\`${MARKER_FILE}\``), 'names the marker file');
  const m = sectionBody(text, '## reviewed-through.json').match(/```json\n([\s\S]*?)\n```/);
  assert.ok(m, 'a fenced json example under ## reviewed-through.json');
  const parsed = parseMarker(JSON.parse(m[1]));
  assert.equal(parsed.error, undefined, 'the example parses as a marker');
  assert.equal(m[1], serializeMarker(parsed.marker).trimEnd());
}

function assertMcpPath(text) {
  const body = sectionBody(text, '## gh-absent (MCP) path');
  for (const needle of ['get_file_contents', 'create_branch', 'create_or_update_file', '--marker-json', '--emit']) {
    assert.ok(body.includes(needle), `the MCP path names ${needle}`);
  }
  assert.match(body, /counts as `null` only after/, 'the confirm-before-absent ladder');
  assert.match(body, /re-runs the same call once/, 'retry once');
  assert.match(body, /second rejection is the exit-4 equivalent/, 'then contested');
  assert.match(body, /needs a local clone, because no compare tool is used/, 'descent needs a local clone');
}

function assertResetReason(text) {
  const body = sectionBody(text, '## Writer rules');
  assert.match(body, /no `#`/);
  assert.ok(body.includes('track-issue-fixes'), 'names the workflow the # rule protects');
}

test('contract: sections in order', () => {
  const text = load();
  assert.doesNotThrow(() => assertSections(text));
  assert.throws(() => assertSections(text.replace('## Writer rules\n', '')));
  assert.throws(() => assertSections(text.replace('### Exit codes\n', '')));
});

test('contract: the exit table equals EXIT, both directions', () => {
  const text = load();
  assert.doesNotThrow(() => assertExitTable(text));
  assert.throws(() => assertExitTable(text.replace(/^\| 6 \|.*\n/m, '')), 'the 6 row dropped');
  assert.throws(() => assertExitTable(text.replace(/^\| 6 \|/m, '| 7 |')), 'the 6 row renumbered to 7');
  assert.throws(() => assertExitTable(text.replace(/^(\| 6 \|.*\n)/m, '$1| 7 | `extra` | x |\n')), 'an extra row');
});

test('contract: names and the marker example match the code', () => {
  const text = load();
  assert.doesNotThrow(() => assertNamesAndExample(text));
  const crlf = readCrlf(text);
  assert.ok(crlf.includes('\r\n'));
  assert.doesNotThrow(() => assertNamesAndExample(crlf));
  assert.throws(() => assertNamesAndExample(text.replace('"version": 1', '"version":1')), 'a hand-spaced example');
  assert.throws(() => assertNamesAndExample(text.replace(/"sha": "[0-9a-f]{40}"/, '"sha": "abc"')), 'a bad sha');
  assert.throws(() => assertNamesAndExample(text.split(`\`${MARKER_FILE}\``).join('`other.json`')), 'a renamed file');
});

test('contract: MCP path', () => {
  const text = load();
  assert.doesNotThrow(() => assertMcpPath(text));
  assert.throws(() => assertMcpPath(text.split('get_file_contents').join('x')));
  assert.throws(() => assertMcpPath(text.replace('counts as `null` only after', 'counts as `null` after')));
  assert.throws(() => assertMcpPath(text.replace('re-runs the same call once', 're-runs it')));
  assert.throws(() => assertMcpPath(text.replace('second rejection is the exit-4 equivalent', 'second rejection is fine')));
  assert.throws(() => assertMcpPath(text.replace('needs a local clone, because no compare tool is used', 'needs nothing')));
});

test('contract: the reset reason and commit-message rule names # and its reason', () => {
  const text = load();
  assert.doesNotThrow(() => assertResetReason(text));
  assert.throws(() => assertResetReason(text.split('track-issue-fixes').join('x')));
});

// A CRLF checkout of the contract, as a Windows autocrlf working copy holds it.
function readCrlf(text) {
  return text.replace(/\n/g, '\r\n');
}
