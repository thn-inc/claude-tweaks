'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const { readText } = require('../../helpers/read-skill');
const { STATIONS } = require('../../../plugin/bin/lib/station-events/stations');

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
// `station: '<name>'` sites in stations.js when this scan landed (the tables). Fewer means the
// matcher stopped matching; the home file is scanned only to prove the matcher still sees them.
const HOME_SITE_FLOOR = 12;
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

test('no plugin/bin file but stations.js spells a station name as a station value', () => {
  const files = listJs(BIN);
  assert.ok(files.length >= FILE_FLOOR, `expected at least ${FILE_FLOOR} plugin/bin files, saw ${files.length}: the walk lost files`);
  assert.ok(files.includes(HOME_REL), `${HOME_REL} is not under plugin/bin: the home file moved, update HOME_REL`);
  const offenders = [];
  let homeSites = 0;
  for (const rel of files) {
    const { sites, verdict } = stationSites(readText(path.join(BIN, rel)));
    if (rel === HOME_REL) { homeSites = sites.length; continue; }
    if (verdict !== 'ok') offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    for (const s of sites) offenders.push(`${rel}:${s.line}: ${s.text}`);
  }
  assert.deepEqual(offenders, [], 'name the station through stations.js (STATION.*, SESSION_BOUND_STATION, releaseTransition, PR_OPENED_TRANSITION), not as a string');
  assert.ok(homeSites >= HOME_SITE_FLOOR, `expected at least ${HOME_SITE_FLOOR} station sites in ${HOME_REL}, saw ${homeSites}: the matcher stopped matching`);
});

test('the same walk goes red when a call site spells a station', () => {
  const planted = `${readText(path.join(BIN, 'release-claim.js'))}\nemit({ station: 'build' });\n`;
  assert.equal(stationSites(planted).sites.length, 1);
});
