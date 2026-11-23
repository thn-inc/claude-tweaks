'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const { readText } = require('../../helpers/read-skill');
const { STATIONS, REASON_CODES } = require('../../../plugin/bin/lib/station-events/stations');

// #5902: stations.js is the one home of station names, so a name correction is a one-file
// change. This scan walks plugin/bin and flags a known station name written as the value of a
// `station` key or property outside that file: `station: 'build'`, `'station': "build"`,
// `station = 'build'`, with a template literal quote too. Call sites name a station through
// STATION or a helper (SESSION_BOUND_STATION, releaseTransition, PR_OPENED_TRANSITION).
//
// Over each file with comments blanked (literals kept). Recall limits: a station name reached
// through a computed key (`['sta' + 'tion']`), a name assembled from two literals, a
// `.station === 'build'` comparison (a read, not a write), and a name held in a constant
// declared elsewhere than stations.js are not seen.
const BIN = path.join(__dirname, '..', '..', '..', 'plugin', 'bin');
const HOME_REL = 'lib/station-events/stations.js';
// plugin/bin .js files when this scan landed. Fewer means the walk lost files.
const FILE_FLOOR = 120;
const NAMES = STATIONS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const SITE = new RegExp(`(?<![\\w$])['"]?station['"]?\\s*(?::|=(?![=>]))\\s*(['"\`])(?:${NAMES})\\1`, 'g');

// -> { sites: [{ line, text }], verdict }
function stationSites(raw) {
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  const rows = src.split('\n');
  const sites = [];
  for (const m of src.matchAll(SITE)) {
    const line = src.slice(0, m.index).split('\n').length;
    sites.push({ line, text: rows[line - 1].trim().slice(0, 100) });
  }
  return { sites, verdict };
}

function listJs(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listJs(dir, r));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(r);
  }
  return out.sort();
}

const lines = (src) => stationSites(src).sites.map((s) => s.line);

test('scanner flags a station name as the value of a station key (proves it can go red)', () => {
  assert.deepEqual(lines([
    "emit({ kind: 'exited', station: 'build' });",
    'emit({ station: "wrap-up" });',
    "emit({ 'station': 'merge' });",
    'emit({ "station" : "accept" });',
    'e.station = `release`;',
    "const e = { station:'intake' };",
    "let station = 'shape';",
  ].join('\n')), [1, 2, 3, 4, 5, 6, 7]);
});

test('scanner ignores comments, other keys, comparisons, non-station values and constants', () => {
  assert.deepEqual(lines([
    "// station: 'build' in a comment",
    "/* station: 'build' */",
    "if (e.station === 'build') {}",
    "if (e.station == 'build') {}",
    "emit({ station: STATION.BUILD });",
    "emit({ station: row.station });",
    "emit({ station: 'blockers-feed' });",
    "emit({ substation: 'build' });",
    "emit({ stationName: 'build' });",
    "const note = 'the build station';",
    "emit({ lane: 'build' });",
  ].join('\n')), []);
});

test('scanner still sees a site after a literal holding a comment opener', () => {
  assert.deepEqual(lines([
    "const g = '/*';",
    "emit({ station: 'build' });",
    "const n = ref.replace(/^origin\\//, ''); emit({ station: 'merge' });",
  ].join('\n')), [2, 3]);
});

test('a comment-stripper mis-parse is reported, not passed as a file with no sites', () => {
  const misparsed = ["if (cond) /'/.test(cond); const b = 'p//q'; emit({ station: 'build' });"].join('\n');
  assert.equal(stationSites(misparsed).verdict, 'misparsed', STRIPPER_VERDICT_MESSAGES.misparsed);
  assert.equal(stationSites("const x = ; emit({ station: 'build' });").verdict, 'unparseable');
  assert.equal(stationSites("emit({ station: 'build' });").verdict, 'ok');
});

test('a CRLF copy of a fixture gets the same sites', () => {
  const lf = "const a = 1;\nemit({ station: 'build' });\nemit({ station: 'test' });";
  assert.deepEqual(lines(lf.replace(/\n/g, '\r\n')), lines(lf));
});

// The walk's verdict over `files`: one line per stripper mis-parse or station site, stations.js
// itself exempt. `read(rel)` returns a file's text, so a test can plant a file into the walk.
function offendersIn(files, read) {
  const offenders = [];
  for (const rel of files) {
    if (rel === HOME_REL) continue;
    const { sites, verdict } = stationSites(read(rel));
    if (verdict !== 'ok') offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    for (const s of sites) offenders.push(`${rel}:${s.line}: ${s.text}`);
  }
  return offenders;
}

test('no plugin/bin file but stations.js spells a station name as a station value', () => {
  const files = listJs(BIN);
  assert.ok(files.length >= FILE_FLOOR, `expected at least ${FILE_FLOOR} plugin/bin files, saw ${files.length}: the walk lost files`);
  assert.ok(files.includes(HOME_REL), `${HOME_REL} is not under plugin/bin: the home file moved, update HOME_REL`);
  assert.deepEqual(offendersIn(files, (rel) => readText(path.join(BIN, rel))), [], 'name the station through stations.js (STATION.*, SESSION_BOUND_STATION, releaseTransition, PR_OPENED_TRANSITION), not as a string');
});

// The matcher's recall proof: the same walk and offenders aggregation, over a real file with a
// station literal planted on a known line, must name that file and line.
test('the same walk goes red when a call site spells a station', () => {
  const files = listJs(BIN);
  const target = 'release-claim.js';
  assert.ok(files.includes(target), `${target} is not under plugin/bin: update the planted file`);
  const real = readText(path.join(BIN, target));
  const plantedLine = real.split('\n').length + 1;
  const offenders = offendersIn(files, (rel) => (rel === target
    ? `${real}\nemit({ station: 'build' });\n`
    : readText(path.join(BIN, rel))));
  assert.deepEqual(offenders, [`${target}:${plantedLine}: emit({ station: 'build' });`]);
});

test('the home file is exempt from the walk', () => {
  assert.deepEqual(offendersIn([HOME_REL], () => "emit({ station: 'build' });"), []);
});

// Record #6146: stations.js is also the one home of the reason codes (REASON_CODES) and the actor
// words (`agent`, `script`, `person`, `rule:{name}`). This scan flags one written as the value of
// a `reasonCode` or `actor` key or property outside that file. Call sites name a code through
// REASON_CODES or a helper.
//
// Over each file with comments blanked (literals kept). Recall limits: a key reached through a
// computed key (`['reason' + 'Code']`), a value held in a local constant, a value assembled from
// two literals, and a `.actor === 'agent'` comparison (a read, not a write) are not seen.
const VOCAB_VALUES = [...REASON_CODES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'agent', 'script', 'person', 'rule:[^\\s:\'"`]+'].join('|');
const VOCAB_SITE = new RegExp(`(?<![\\w$])['"]?(?:reasonCode|actor)['"]?\\s*(?::|=(?![=>]))\\s*(['"\`])(?:${VOCAB_VALUES})\\1`, 'g');

// -> { sites: [{ line, text }], verdict }
function vocabSites(raw) {
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  const rows = src.split('\n');
  const sites = [];
  for (const m of src.matchAll(VOCAB_SITE)) {
    const line = src.slice(0, m.index).split('\n').length;
    sites.push({ line, text: rows[line - 1].trim().slice(0, 100) });
  }
  return { sites, verdict };
}

// Same shape as offendersIn, over vocabSites.
function vocabOffendersIn(files, read) {
  const offenders = [];
  for (const rel of files) {
    if (rel === HOME_REL) continue;
    const { sites, verdict } = vocabSites(read(rel));
    if (verdict !== 'ok') offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    for (const s of sites) offenders.push(`${rel}:${s.line}: ${s.text}`);
  }
  return offenders;
}

const vocabLines = (src) => vocabSites(src).sites.map((s) => s.line);

test('vocab scanner flags a reason code or actor literal as a reasonCode/actor value (proves it can go red)', () => {
  assert.deepEqual(vocabLines([
    "emit({ reasonCode: 'test-failed' });",
    'p.actor = "script";',
    "emit({ 'actor': 'rule:auto' });",
    'emit({ reasonCode: `unspecified` });',
  ].join('\n')), [1, 2, 3, 4]);
});

test('vocab scanner ignores comments, comparisons, other keys and non-vocabulary values', () => {
  assert.deepEqual(vocabLines([
    "// reasonCode: 'other'",
    "if (p.actor === 'agent') {}",
    "emit({ reason: 'other' });",
    'emit({ actor: ACTOR });',
    "emit({ reasonCode: 'failed: test' });",
  ].join('\n')), []);
});

test('vocab scanner reports a stripper mis-parse', () => {
  const misparsed = ["if (cond) /'/.test(cond); const b = 'p//q'; emit({ reasonCode: 'other' });"].join('\n');
  assert.equal(vocabSites(misparsed).verdict, 'misparsed', STRIPPER_VERDICT_MESSAGES.misparsed);
  assert.equal(vocabSites("const x = ; emit({ reasonCode: 'other' });").verdict, 'unparseable');
  assert.equal(vocabSites("emit({ reasonCode: 'other' });").verdict, 'ok');
});

test('AC1.9: no call site spells a reason code or actor literal outside stations.js', () => {
  const files = listJs(BIN);
  assert.ok(files.length >= FILE_FLOOR, `expected at least ${FILE_FLOOR} plugin/bin files, saw ${files.length}: the walk lost files`);
  assert.deepEqual(vocabOffendersIn(files, (rel) => readText(path.join(BIN, rel))), [], 'name the reason code through REASON_CODES and the actor through stations.js, not as a string');
});

test('the vocab walk goes red when a call site spells a reason code', () => {
  const files = listJs(BIN);
  const target = 'release-claim.js';
  assert.ok(files.includes(target), `${target} is not under plugin/bin: update the planted file`);
  const real = readText(path.join(BIN, target));
  const plantedLine = real.split('\n').length + 1;
  const offenders = vocabOffendersIn(files, (rel) => (rel === target
    ? `${real}\nemit({ reasonCode: 'other' });\n`
    : readText(path.join(BIN, rel))));
  assert.deepEqual(offenders, [`${target}:${plantedLine}: emit({ reasonCode: 'other' });`]);
});

test('vocab scanner needs a non-empty rule id without whitespace or colon, as ACTORS does', () => {
  assert.deepEqual(vocabLines([
    "emit({ actor: 'rule:' });",
    "emit({ actor: 'rule:a b' });",
    "emit({ actor: 'rule:a:b' });",
  ].join('\n')), []);
});

// Both walks turn a stripper verdict other than ok into an offender line, not a clean file.
const MISPARSE_FIXTURE = "if (cond) /'/.test(cond); const b = 'p//q'; emit({ station: 'build' });";
const UNPARSEABLE_FIXTURE = "const x = ; emit({ station: 'build' });";

test('the station walk reports a stripper mis-parse and an unparseable file as offenders', () => {
  assert.deepEqual(offendersIn(['x.js'], () => MISPARSE_FIXTURE), [`x.js: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
  assert.deepEqual(offendersIn(['x.js'], () => UNPARSEABLE_FIXTURE), [`x.js: ${STRIPPER_VERDICT_MESSAGES.unparseable}`, `x.js:1: ${UNPARSEABLE_FIXTURE}`]);
});

test('the vocab walk reports a stripper mis-parse and an unparseable file as offenders', () => {
  const misparsed = MISPARSE_FIXTURE.replace("station: 'build'", "reasonCode: 'other'");
  const unparseable = UNPARSEABLE_FIXTURE.replace("station: 'build'", "reasonCode: 'other'");
  assert.deepEqual(vocabOffendersIn(['x.js'], () => misparsed), [`x.js: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
  assert.deepEqual(vocabOffendersIn(['x.js'], () => unparseable), [`x.js: ${STRIPPER_VERDICT_MESSAGES.unparseable}`, `x.js:1: ${unparseable}`]);
});
