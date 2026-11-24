'use strict';
// Pins plugin/skills/_shared/release-state.md (#5883) to the code it documents: the section
// headings #5884/#5885 cite, the exit table against EXIT, the names and the marker example
// against the store and marker modules, and the gh-absent (MCP) procedure's load-bearing claims.
// Every go-red control runs the same helper the positive test runs, on a mutated copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { EXIT, USAGE } = require('../plugin/bin/release-state');
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

// The bash fence under ## The CLI, one line per usage form, with the plugin-root spelling reduced
// to the script name the CLI's own USAGE prints.
function assertUsageFence(text) {
  const m = sectionBody(text, '## The CLI').match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(m, 'a bash fence of the usage forms under ## The CLI');
  const fence = m[1].split('\n').map((l) => l.replace('node "${CLAUDE_PLUGIN_ROOT}/bin/release-state.js"', 'release-state.js'));
  const printed = USAGE.split('\n').map((l) => l.trim().replace(/^usage: /, '')).filter((l) => l.startsWith('release-state.js marker '));
  assert.ok(printed.length >= 4, 'USAGE carries the marker forms');
  assert.deepEqual(fence, printed);
}

function assertMcpPath(text) {
  const body = sectionBody(text, '## gh-absent (MCP) path');
  for (const needle of ['get_file_contents', 'create_branch', 'create_or_update_file', '--marker-json', '--emit']) {
    assert.ok(body.includes(needle), `the MCP path names ${needle}`);
  }
  assert.match(body, /counts as `null` only after/, 'the confirm-before-absent ladder');
  assert.match(body, /that read answers not-found and the root on the default/, 'only a not-found on the branch read leads to a missing branch');
  assert.match(body, /re-run step 2 with `--after-conflict`/, 'retry once, through the at-or-past check');
  assert.match(body, /anything else, a `write` included, is the exit-4 equivalent/, 'then contested');
  assert.match(body, /`reset` takes `--marker-json` the same way and makes one write; a rejection is the exit-4\nequivalent/, 'reset: one write');
  assert.match(body, /needs a local clone, because no compare tool is used/, 'descent needs a local clone');
  assert.match(body, /any other\s+exit routes as in step 2/, 'step 4: other exits of the --after-conflict re-run route as in step 2');
  assert.match(body, /fails with no rejection[^]*?re-read and re-run with `--after-conflict`/, 'step 5: a no-rejection failure re-reads and re-runs with --after-conflict');
  assert.match(body, /A write that\s+landed reads as at-or-past \(exit 0 without `write`, success\)/, 'step 5: a landed write reads as at-or-past');
  assert.match(body, /anything else is the exit-3\s+equivalent, and nothing more is written/, 'step 5: otherwise the exit-3 equivalent');
  assert.match(body, /Without\s+one, the CLI exits 5\. When exit 5 comes from a shallow clone or git older than 2\.29, deepen the\s+clone \(`git fetch --unshallow origin`\) or upgrade git, then re-run/, 'exit-5 recovery');
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

test('contract: the usage fence equals the CLI\'s USAGE forms', () => {
  const text = load();
  assert.doesNotThrow(() => assertUsageFence(text));
  assert.throws(() => assertUsageFence(text.replace(' [--after-conflict]]', ']')), 'a flag dropped');
  assert.throws(() => assertUsageFence(text.replace('marker init --to <sha>', 'marker init --to <ref>')), 'a placeholder renamed');
  assert.throws(() => assertUsageFence(text.replace(/^node .* marker reset .*\n/m, '')), 'a form dropped');
  assert.doesNotThrow(() => assertUsageFence(readCrlf(text)));
});

test('contract: MCP path', () => {
  const text = load();
  assert.doesNotThrow(() => assertMcpPath(text));
  assert.throws(() => assertMcpPath(text.split('get_file_contents').join('x')));
  assert.throws(() => assertMcpPath(text.replace('counts as `null` only after', 'counts as `null` after')));
  assert.throws(() => assertMcpPath(text.replace('that read answers not-found and', 'that read fails and')), 'the old ladder');
  assert.throws(() => assertMcpPath(text.replace('re-run step 2 with `--after-conflict`', 're-run step 2')));
  assert.throws(() => assertMcpPath(text.replace('anything else, a `write` included, is the exit-4 equivalent', 'anything else is fine')));
  assert.throws(() => assertMcpPath(text.replace('makes one write; a rejection', 'makes writes; a rejection')));
  assert.throws(() => assertMcpPath(text.replace('needs a local clone, because no compare tool is used', 'needs nothing')));
  const dropped = (needle, to) => {
    const mutated = text.replace(needle, to);
    assert.notEqual(mutated, text, `the contract carries ${needle}`);
    return mutated;
  };
  assert.throws(() => assertMcpPath(dropped(/any other\s+exit routes as in step 2/, 'nothing else happens')), 'step 4: other exits dropped');
  assert.throws(() => assertMcpPath(dropped(/re-read and re-run with `--after-conflict`\. A write that/, 'give up. A write that')), 'step 5: the re-run dropped');
  assert.throws(() => assertMcpPath(dropped(/landed reads as at-or-past \(exit 0 without `write`, success\)/, 'landed is fine')), 'step 5: at-or-past dropped');
  assert.throws(() => assertMcpPath(dropped(/anything else is the exit-3\s+equivalent, and nothing more is written/, 'anything else is fine')), 'step 5: exit-3 equivalent dropped');
  assert.throws(() => assertMcpPath(dropped('(`git fetch --unshallow origin`)', '(`git fetch`)')), 'exit-5 recovery: the unshallow fetch dropped');
  assert.throws(() => assertMcpPath(dropped('or upgrade git, then re-run', 'then stop')), 'exit-5 recovery: upgrade and re-run dropped');
  assert.throws(() => assertMcpPath(dropped('older than 2.29', 'older')), 'exit-5 recovery: the git version dropped');
  assert.doesNotThrow(() => assertMcpPath(readCrlf(text)), 'CRLF checkout');
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
