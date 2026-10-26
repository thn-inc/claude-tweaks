// tests/close-out-marker-cli.test.js — bin/close-out-marker.js (#4331), the CLI
// over lib/dispatch/close-out-marker.js. In-process via run(argv, deps) with
// fake deps, plus real subprocess runs against tmp files.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { run, parseArgs } = require('../plugin/bin/close-out-marker.js');
const { parseMarker, serializeMarker } = require('../plugin/bin/lib/dispatch/close-out-marker.js');

const BIN = path.join(__dirname, '..', 'plugin', 'bin', 'close-out-marker.js');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

const comment = (id, body, authorAssociation = 'MEMBER') => ({ id, authorAssociation, body });
const P = (...comments) => ({ comments });
const markerBody = (fields) => serializeMarker(fields);
const pendingFields = {
  updateMethod: ['merge'],
  conflictedFiles: ['a.js'],
  preUpdateHead: A,
  resolutionCommits: [B],
};

// `files` maps a path to its content (or a function throwing/returning it); any other path is the
// comments payload. The default `paths.txt` is the conflicted-files list WRITE_ARGV names.
const DEFAULT_FILES = { 'paths.txt': 'a.js\nb.js\n' };

function fakeDeps(payload, { writeFile, files = {} } = {}) {
  const calls = { readFile: 0, writes: [], stdout: [], stderr: [] };
  const known = { ...DEFAULT_FILES, ...files };
  return {
    calls,
    readFile: (p) => {
      calls.readFile++;
      if (Object.hasOwn(known, p)) return typeof known[p] === 'function' ? known[p]() : known[p];
      if (typeof payload === 'function') return payload();
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    },
    writeFile: (p, content) => {
      if (writeFile) return writeFile(p, content);
      calls.writes.push([p, content]);
      return undefined;
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
  };
}

const out = (deps) => deps.calls.stdout.join('');
const err = (deps) => deps.calls.stderr.join('');
const oneJsonLine = (deps) => {
  const text = out(deps);
  assert.ok(text.endsWith('\n'), text);
  assert.equal(text.slice(0, -1).includes('\n'), false, 'stdout must be exactly one line');
  return JSON.parse(text);
};

const WRITE_ARGV = [
  'write', '--comments-file', 'c.json', '--update-method', 'merge', '--conflicted-files-file', 'paths.txt',
  '--pre-update-head', C, '--resolution-commit', 'pending', '--out', 'marker.md',
];
// WRITE_ARGV with one flag's value swapped (or the flag dropped when value is null).
function writeArgv(flag, value) {
  const argv = [...WRITE_ARGV];
  const at = argv.indexOf(flag);
  if (value === null) argv.splice(at, 2);
  else argv[at + 1] = value;
  return argv;
}
// WRITE_ARGV with its conflicted-files pair replaced by `pairs` (flag, value, flag, value, ...).
function conflictedArgv(...pairs) {
  const argv = writeArgv('--conflicted-files-file', null);
  return [...argv, ...pairs];
}

// ---- read ----

test('read: no marker comment is status none with null fields', () => {
  const deps = fakeDeps(P(comment('1', 'hello')));
  assert.equal(run(['read', '--comments-file', 'c.json'], deps), 0);
  assert.equal(err(deps), '');
  assert.deepEqual(oneJsonLine(deps), {
    status: 'none',
    id: null,
    updateMethod: null,
    conflictedFiles: null,
    preUpdateHead: null,
    resolutionCommits: null,
    skipped: [],
    ids: [],
    bodyWritten: null,
  });
});

test('read: an untrusted marker comment alone is status none with one skipped note', () => {
  const deps = fakeDeps(P(comment('9', markerBody(pendingFields), 'NONE')));
  assert.equal(run(['read', '--comments-file', 'c.json'], deps), 0);
  const result = oneJsonLine(deps);
  assert.equal(result.status, 'none');
  assert.equal(result.id, null);
  assert.equal(result.updateMethod, null);
  assert.equal(result.skipped.length, 1);
});

test('read: a CRLF pending marker reads pending with its id (AC1.1 end to end)', () => {
  const crlf = markerBody(pendingFields).replace(/\n/g, '\r\n');
  const deps = fakeDeps(P(comment('IC_1', crlf)));
  assert.equal(run(['read', '--comments-file', 'c.json'], deps), 0);
  assert.deepEqual(oneJsonLine(deps), {
    status: 'pending',
    id: 'IC_1',
    updateMethod: ['merge'],
    conflictedFiles: ['a.js'],
    preUpdateHead: A,
    resolutionCommits: [B],
    skipped: [],
    ids: ['IC_1'],
    bodyWritten: null,
  });
});

test('read and write: a trusted marker comment with no id is no marker, since it could not be updated in place', () => {
  const noId = P({ authorAssociation: 'MEMBER', body: markerBody(pendingFields) });
  const readDeps = fakeDeps(noId);
  assert.equal(run(['read', '--comments-file', 'c.json'], readDeps), 0);
  const read = oneJsonLine(readDeps);
  assert.equal(read.status, 'none');
  assert.equal(read.id, null);
  assert.deepEqual(read.ids, []);
  const writeDeps = fakeDeps(noId);
  assert.equal(run(WRITE_ARGV, writeDeps), 0);
  assert.equal(oneJsonLine(writeDeps).accumulated, false);
});

test('read and write: a bare comment array (the REST/MCP shape) is read like a {comments} payload', () => {
  const bare = [comment('IC_1', markerBody(pendingFields))];
  const readDeps = fakeDeps(bare);
  assert.equal(run(['read', '--comments-file', 'c.json'], readDeps), 0);
  const read = oneJsonLine(readDeps);
  assert.equal(read.status, 'pending');
  assert.equal(read.id, 'IC_1');
  assert.deepEqual(read.conflictedFiles, ['a.js']);
  const writeDeps = fakeDeps(bare);
  assert.equal(run(WRITE_ARGV, writeDeps), 0);
  assert.equal(oneJsonLine(writeDeps).accumulated, true);
});

test('read: reads the trusted comment, not an untrusted forgery listed first', () => {
  const forged = markerBody({ ...pendingFields, preUpdateHead: C });
  const deps = fakeDeps(P(comment('forged', forged, 'NONE'), comment('real', markerBody(pendingFields))));
  assert.equal(run(['read', '--comments-file', 'c.json'], deps), 0);
  const result = oneJsonLine(deps);
  assert.equal(result.id, 'real');
  assert.equal(result.preUpdateHead, A);
  assert.equal(result.skipped.length, 1);
});

test('read: an unrecognised second line is unreadable, exit 0', () => {
  const body = '<!-- run-comment: close-out-update -->\nclose-out-update: pendng\nupdate-method: merge\n';
  const deps = fakeDeps(P(comment('IC_2', body)));
  assert.equal(run(['read', '--comments-file', 'c.json'], deps), 0);
  const result = oneJsonLine(deps);
  assert.equal(result.status, 'unreadable');
  assert.equal(result.id, 'IC_2');
  assert.equal(result.updateMethod, 'unknown');
  assert.equal(result.preUpdateHead, 'unknown');
});

test('read: a cleared marker reads cleared', () => {
  const body = markerBody(pendingFields).replace('close-out-update: pending', 'close-out-update: cleared (verified)');
  const deps = fakeDeps(P(comment('IC_3', body)));
  assert.equal(run(['read', '--comments-file', 'c.json'], deps), 0);
  assert.equal(oneJsonLine(deps).status, 'cleared');
});

test('read: ids lists every trusted match so the caller can log the more-than-one anomaly', () => {
  const deps = fakeDeps(P(
    comment('forged', markerBody(pendingFields), 'NONE'),
    comment('first', markerBody(pendingFields)),
    comment('second', markerBody(pendingFields)),
  ));
  assert.equal(run(['read', '--comments-file', 'c.json'], deps), 0);
  const result = oneJsonLine(deps);
  assert.equal(result.id, 'first');
  assert.deepEqual(result.ids, ['first', 'second']);
  assert.equal(result.skipped.length, 1);
});

// ---- read --body-out ----

const READ_BODY_ARGV = ['read', '--comments-file', 'c.json', '--body-out', 'prior.md'];

test('read --body-out: writes the trusted comment\'s exact raw body, CRLF bytes included', () => {
  const crlf = markerBody(pendingFields).replace(/\n/g, '\r\n');
  const deps = fakeDeps(P(comment('IC_1', crlf)));
  assert.equal(run(READ_BODY_ARGV, deps), 0);
  assert.equal(err(deps), '');
  assert.equal(deps.calls.writes.length, 1);
  assert.equal(deps.calls.writes[0][0], 'prior.md');
  assert.equal(deps.calls.writes[0][1], crlf);
  const result = oneJsonLine(deps);
  assert.equal(result.bodyWritten, 'prior.md');
  assert.equal(result.status, 'pending');
});

test('read --body-out: saves the trusted comment, not an untrusted forgery listed first', () => {
  const forged = markerBody({ ...pendingFields, preUpdateHead: C });
  const real = markerBody(pendingFields);
  const deps = fakeDeps(P(comment('forged', forged, 'NONE'), comment('real', real)));
  assert.equal(run(READ_BODY_ARGV, deps), 0);
  assert.equal(deps.calls.writes[0][1], real);
});

test('read --body-out: an unreadable marker\'s raw body is still saved', () => {
  const body = '<!-- run-comment: close-out-update -->\nbogus second line\r\n';
  const deps = fakeDeps(P(comment('IC_2', body)));
  assert.equal(run(READ_BODY_ARGV, deps), 0);
  assert.equal(deps.calls.writes[0][1], body);
  const result = oneJsonLine(deps);
  assert.equal(result.status, 'unreadable');
  assert.equal(result.bodyWritten, 'prior.md');
});

test('read --body-out: no trusted marker writes no file and reports bodyWritten null', () => {
  for (const payload of [P(), P(comment('1', 'hello')), P(comment('9', markerBody(pendingFields), 'NONE'))]) {
    const deps = fakeDeps(payload);
    assert.equal(run(READ_BODY_ARGV, deps), 0);
    assert.equal(deps.calls.writes.length, 0);
    const result = oneJsonLine(deps);
    assert.equal(result.status, 'none');
    assert.equal(result.bodyWritten, null);
  }
});

test('read without --body-out writes nothing and reports bodyWritten null', () => {
  const deps = fakeDeps(P(comment('IC_1', markerBody(pendingFields))));
  assert.equal(run(['read', '--comments-file', 'c.json'], deps), 0);
  assert.equal(deps.calls.writes.length, 0);
  assert.equal(oneJsonLine(deps).bodyWritten, null);
});

test('read --body-out: an unwritable path exits 3, names the path and prints no result', () => {
  const deps = fakeDeps(P(comment('IC_1', markerBody(pendingFields))), { writeFile: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
  assert.equal(run(READ_BODY_ARGV, deps), 3);
  assert.match(err(deps), /prior\.md/);
  assert.match(err(deps), /EACCES/);
  assert.equal(out(deps), '');
});

// ---- write ----

test('write: no marker writes a fresh pending body from the flags', () => {
  const deps = fakeDeps(P());
  assert.equal(run(WRITE_ARGV, deps), 0);
  assert.equal(err(deps), '');
  assert.equal(deps.calls.writes.length, 1);
  const [outPath, content] = deps.calls.writes[0];
  assert.equal(outPath, 'marker.md');
  assert.deepEqual(parseMarker(content), {
    status: 'pending',
    updateMethod: ['merge'],
    conflictedFiles: ['a.js', 'b.js'],
    preUpdateHead: C,
    resolutionCommits: ['pending'],
  });
  const result = oneJsonLine(deps);
  assert.equal(result.written, 'marker.md');
  assert.equal(result.accumulated, false);
  assert.equal(result.marker.status, 'pending');
  assert.deepEqual(result.marker.conflictedFiles, ['a.js', 'b.js']);
});

test('write: a pending marker accumulates (AC2.1 end to end)', () => {
  // the update's paths (b.js, c.js) differ from the pending marker's (a.js), so a union and a replacement read differently
  const deps = fakeDeps(P(comment('IC_1', markerBody(pendingFields))), { files: { 'paths.txt': 'b.js\nc.js\n' } });
  const argv = writeArgv('--update-method', 'gh pr update-branch');
  assert.equal(run(argv, deps), 0);
  const [, content] = deps.calls.writes[0];
  assert.deepEqual(parseMarker(content), {
    status: 'pending',
    updateMethod: ['merge', 'gh pr update-branch'],
    conflictedFiles: ['a.js', 'b.js', 'c.js'],
    preUpdateHead: C,
    resolutionCommits: [B, 'pending'],
  });
  const result = oneJsonLine(deps);
  assert.equal(result.accumulated, true);
  assert.deepEqual(result.marker.updateMethod, ['merge', 'gh pr update-branch']);
});

test('write: a cleared marker writes fresh, not accumulated', () => {
  const body = markerBody(pendingFields).replace('close-out-update: pending', 'close-out-update: cleared (verified)');
  const deps = fakeDeps(P(comment('IC_3', body)));
  assert.equal(run(WRITE_ARGV, deps), 0);
  const [, content] = deps.calls.writes[0];
  assert.deepEqual(parseMarker(content).updateMethod, ['merge']);
  assert.deepEqual(parseMarker(content).resolutionCommits, ['pending']);
  assert.equal(oneJsonLine(deps).accumulated, false);
});

test('write: an unreadable marker exits 1 and writes nothing', () => {
  const body = '<!-- run-comment: close-out-update -->\nbogus second line\n';
  const deps = fakeDeps(P(comment('IC_4', body)));
  assert.equal(run(WRITE_ARGV, deps), 1);
  assert.match(err(deps), /marker unreadable/);
  assert.equal(deps.calls.writes.length, 0);
  assert.equal(out(deps), '');
});

test('write: --conflicted-files none writes none and unknown writes unknown', () => {
  for (const [flagValue, expectedField, expectedLine] of [
    ['none', [], 'conflicted-files: none'],
    ['unknown', 'unknown', 'conflicted-files: unknown'],
  ]) {
    const deps = fakeDeps(P());
    assert.equal(run(conflictedArgv('--conflicted-files', flagValue), deps), 0, flagValue);
    const [, content] = deps.calls.writes[0];
    assert.ok(content.split('\n').includes(expectedLine), content);
    assert.deepEqual(parseMarker(content).conflictedFiles, expectedField);
  }
});

test('write: a pending marker with unknown conflicted files stays unknown after accumulating', () => {
  const body = markerBody({ ...pendingFields, conflictedFiles: 'unknown' });
  const deps = fakeDeps(P(comment('IC_1', body)));
  assert.equal(run(WRITE_ARGV, deps), 0);
  assert.equal(parseMarker(deps.calls.writes[0][1]).conflictedFiles, 'unknown');
});

test('write: an uppercase --pre-update-head is accepted and written lowercase', () => {
  const deps = fakeDeps(P());
  assert.equal(run(writeArgv('--pre-update-head', 'A'.repeat(40)), deps), 0);
  assert.equal(parseMarker(deps.calls.writes[0][1]).preUpdateHead, A);
});

test('write: conflicted file paths are untrusted text, recorded verbatim from --conflicted-files-file', () => {
  const awkward = ['dir/a b.js', 'app/routes/posts.$slug.tsx', '$(touch pwned).js', '`x`.md'];
  const deps = fakeDeps(P(), { files: { 'paths.txt': `${awkward.join('\n')}\n` } });
  assert.equal(run(WRITE_ARGV, deps), 0);
  assert.equal(err(deps), '');
  assert.deepEqual(parseMarker(deps.calls.writes[0][1]).conflictedFiles, awkward);
  assert.ok(deps.calls.writes[0][1].includes('conflicted-files: dir/a b.js, app/routes/posts.$slug.tsx, $(touch pwned).js, `x`.md\n'));
});

test('write: the paths file may use CRLF line endings, and blank or whitespace-only lines are ignored', () => {
  const deps = fakeDeps(P(), { files: { 'paths.txt': '\r\na.js\r\n\n   \r\nb/c.js\n\n' } });
  assert.equal(run(WRITE_ARGV, deps), 0);
  assert.deepEqual(parseMarker(deps.calls.writes[0][1]).conflictedFiles, ['a.js', 'b/c.js']);
});

test('write: a path with leading or trailing whitespace exits 1 (the marker would trim it) and writes nothing', () => {
  for (const padded of ['trail ', ' lead', 'tab\t']) {
    const deps = fakeDeps(P(), { files: { 'paths.txt': `a.js\n${padded}\n` } });
    assert.equal(run(WRITE_ARGV, deps), 1, JSON.stringify(padded));
    assert.match(err(deps), /leading or trailing whitespace/);
    assert.match(err(deps), /--conflicted-files unknown/);
    assert.equal(deps.calls.writes.length, 0);
  }
  // interior whitespace is part of the name and is carried
  const deps = fakeDeps(P(), { files: { 'paths.txt': 'dir/a b.js\n' } });
  assert.equal(run(WRITE_ARGV, deps), 0);
  assert.deepEqual(parseMarker(deps.calls.writes[0][1]).conflictedFiles, ['dir/a b.js']);
});

test('write: a paths file with no paths exits 1 and writes nothing', () => {
  for (const content of ['', '\n', '  \r\n\n\t\n']) {
    const deps = fakeDeps(P(), { files: { 'paths.txt': content } });
    assert.equal(run(WRITE_ARGV, deps), 1, JSON.stringify(content));
    assert.match(err(deps), /--conflicted-files-file/);
    assert.equal(deps.calls.writes.length, 0);
    assert.equal(out(deps), '');
  }
});

test('write: an unreadable paths file exits 1 and writes nothing', () => {
  const deps = fakeDeps(P(), { files: { 'paths.txt': () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } } });
  assert.equal(run(WRITE_ARGV, deps), 1);
  assert.match(err(deps), /paths\.txt/);
  assert.match(err(deps), /ENOENT/);
  assert.equal(deps.calls.writes.length, 0);
  assert.equal(out(deps), '');
});

test('write: a path containing a comma exits 1 (the marker format cannot carry it) and writes nothing', () => {
  const deps = fakeDeps(P(), { files: { 'paths.txt': 'a.js\nweird,name.js\n' } });
  assert.equal(run(WRITE_ARGV, deps), 1);
  assert.match(err(deps), /weird,name\.js/);
  assert.equal(deps.calls.writes.length, 0);
  assert.equal(out(deps), '');
});

test('write: a bare carriage return inside a path exits 1 (it would add a line to the body)', () => {
  const deps = fakeDeps(P(), { files: { 'paths.txt': 'a.js\nb\rc.js\n' } });
  assert.equal(run(WRITE_ARGV, deps), 1);
  assert.match(err(deps), /line break/);
  assert.equal(deps.calls.writes.length, 0);
});

test('write: a path named none or unknown exits 1 (the marker would read it back as a sentinel) and writes nothing', () => {
  for (const reserved of ['none', 'unknown']) {
    const deps = fakeDeps(P(), { files: { 'paths.txt': `${reserved}\n` } });
    assert.equal(run(WRITE_ARGV, deps), 1, reserved);
    assert.match(err(deps), new RegExp(`path named ${reserved}`));
    assert.equal(deps.calls.writes.length, 0);
    assert.equal(out(deps), '');
  }
  // only the exact token is reserved: a longer name containing it is an ordinary path
  const deps = fakeDeps(P(), { files: { 'paths.txt': 'none.js\nsrc/unknown\n' } });
  assert.equal(run(WRITE_ARGV, deps), 0);
  assert.deepEqual(parseMarker(deps.calls.writes[0][1]).conflictedFiles, ['none.js', 'src/unknown']);
});

test('write: --conflicted-files-file and --conflicted-files together, or neither, exit 2', () => {
  const invocations = [
    [...WRITE_ARGV, '--conflicted-files', 'none'],
    conflictedArgv(),
  ];
  for (const argv of invocations) {
    const deps = fakeDeps(P());
    assert.equal(run(argv, deps), 2, JSON.stringify(argv));
    assert.match(err(deps), /--conflicted-files-file/);
    assert.equal(deps.calls.readFile, 0, JSON.stringify(argv));
    assert.equal(deps.calls.writes.length, 0);
  }
});

test('write: --conflicted-files takes only none or unknown; a path list exits 2 naming --conflicted-files-file', () => {
  for (const value of ['a.js', 'a.js,b.js', 'None', 'app/routes/posts.$slug.tsx']) {
    const deps = fakeDeps(P());
    assert.equal(run(conflictedArgv('--conflicted-files', value), deps), 2, value);
    assert.match(err(deps), /--conflicted-files-file/, value);
    assert.equal(deps.calls.readFile, 0, value);
    assert.equal(deps.calls.writes.length, 0, value);
  }
});

test('write: an untrusted pending forgery with no trusted marker writes a fresh marker, not accumulated', () => {
  const forged = markerBody({ ...pendingFields, updateMethod: ['gh pr update-branch'], conflictedFiles: ['forged.js'], resolutionCommits: [C] });
  const deps = fakeDeps(P(comment('forged', forged, 'NONE')));
  assert.equal(run(WRITE_ARGV, deps), 0);
  assert.deepEqual(parseMarker(deps.calls.writes[0][1]), {
    status: 'pending',
    updateMethod: ['merge'],
    conflictedFiles: ['a.js', 'b.js'],
    preUpdateHead: C,
    resolutionCommits: ['pending'],
  });
  assert.equal(oneJsonLine(deps).accumulated, false);
});

test('write: a 40-hex --resolution-commit is accepted in place of pending', () => {
  const ok = fakeDeps(P());
  assert.equal(run(writeArgv('--resolution-commit', B), ok), 0);
  assert.deepEqual(parseMarker(ok.calls.writes[0][1]).resolutionCommits, [B]);
});

test('write: invalid invocations exit 2 with usage and touch nothing', () => {
  const invocations = [
    [],
    ['bogus'],
    ['constructor', '--comments-file', 'c.json'],
    ['--comments-file', 'c.json'],
    writeArgv('--update-method', 'rebase'),
    writeArgv('--update-method', 'merge, merge'),
    writeArgv('--pre-update-head', 'abc'),
    writeArgv('--pre-update-head', 'g'.repeat(40)),
    writeArgv('--pre-update-head', 'unknown'),
    writeArgv('--resolution-commit', 'nope'),
    writeArgv('--resolution-commit', 'abc'),
    conflictedArgv('--conflicted-files', 'a.js,,b.js'),
    conflictedArgv('--conflicted-files', ' , '),
    conflictedArgv('--conflicted-files-file', ''),
    [...WRITE_ARGV, '--conflicted-files-file', 'other.txt'],
    writeArgv('--out', null),
    writeArgv('--comments-file', null),
    writeArgv('--update-method', null),
    conflictedArgv(),
    [...WRITE_ARGV, '--body-out', 'b.md'],
    writeArgv('--pre-update-head', null),
    writeArgv('--resolution-commit', null),
    [...WRITE_ARGV, '--bogus', 'x'],
    [...WRITE_ARGV, '--sha', A],
    [...WRITE_ARGV, '--constructor', 'x'],
    [...WRITE_ARGV, '--out'],
    [...WRITE_ARGV, '--out', 'other.md'],
    [...WRITE_ARGV, 'toString'],
    writeArgv('--out', ''),
    writeArgv('--out', '--x'),
  ];
  for (const argv of invocations) {
    const deps = fakeDeps(P());
    assert.equal(run(argv, deps), 2, JSON.stringify(argv));
    assert.match(err(deps), /usage:/, JSON.stringify(argv));
    assert.equal(deps.calls.readFile, 0, JSON.stringify(argv));
    assert.equal(deps.calls.writes.length, 0, JSON.stringify(argv));
    assert.equal(out(deps), '', JSON.stringify(argv));
  }
});

test('a line break in any flag value exits 2 and writes nothing', () => {
  const invocations = [
    conflictedArgv('--conflicted-files', 'a.js\nb.js'),
    conflictedArgv('--conflicted-files', 'a.js\r\nb.js'),
    writeArgv('--conflicted-files-file', 'paths.txt\n'),
    ['read', '--comments-file', 'c.json', '--body-out', 'b.md\n'],
    writeArgv('--update-method', 'merge\n'),
    writeArgv('--pre-update-head', `${C}\n`),
    writeArgv('--resolution-commit', 'pending\n'),
    writeArgv('--out', 'marker.md\nx'),
    ['resolve-pending', '--comments-file', 'c.json', '--sha', `${C}\n`, '--out', 'm.md'],
    ['read', '--comments-file', 'c.json\n'],
  ];
  for (const argv of invocations) {
    const deps = fakeDeps(P());
    assert.equal(run(argv, deps), 2, JSON.stringify(argv));
    assert.match(err(deps), /line break/, JSON.stringify(argv));
    assert.equal(deps.calls.readFile, 0, JSON.stringify(argv));
    assert.equal(deps.calls.writes.length, 0, JSON.stringify(argv));
  }
});

test('write: a trailing bare --out is a usage error, not a value', () => {
  const argv = WRITE_ARGV.slice(0, -2).concat(['--out']);
  const deps = fakeDeps(P());
  assert.equal(run(argv, deps), 2);
  assert.match(err(deps), /--out needs a value/);
});

test('write: an unwritable --out exits 3 and names the path', () => {
  const deps = fakeDeps(P(), { writeFile: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
  assert.equal(run(WRITE_ARGV, deps), 3);
  assert.match(err(deps), /marker\.md/);
  assert.match(err(deps), /EACCES/);
  assert.equal(out(deps), '');
});

// ---- resolve-pending ----

const RESOLVE_ARGV = ['resolve-pending', '--comments-file', 'c.json', '--sha', C, '--out', 'marker.md'];

test('resolve-pending: replaces the pending entry and writes the marker', () => {
  const body = markerBody({ ...pendingFields, resolutionCommits: [B, 'pending'] });
  const deps = fakeDeps(P(comment('IC_1', body)));
  assert.equal(run(RESOLVE_ARGV, deps), 0);
  const [outPath, content] = deps.calls.writes[0];
  assert.equal(outPath, 'marker.md');
  const parsed = parseMarker(content);
  assert.equal(parsed.status, 'pending');
  assert.deepEqual(parsed.resolutionCommits, [B, C]);
  assert.deepEqual(parsed.updateMethod, ['merge']);
  assert.equal(parsed.preUpdateHead, A);
  const result = oneJsonLine(deps);
  assert.equal(result.written, 'marker.md');
  assert.equal(result.accumulated, false);
  assert.deepEqual(result.marker.resolutionCommits, [B, C]);
});

test('resolve-pending: a marker with no pending entry exits 1 and writes nothing', () => {
  const deps = fakeDeps(P(comment('IC_1', markerBody(pendingFields))));
  assert.equal(run(RESOLVE_ARGV, deps), 1);
  assert.match(err(deps), /pending/);
  assert.equal(deps.calls.writes.length, 0);
});

test('resolve-pending: no marker, a cleared marker and an unreadable marker each exit 1', () => {
  const bodies = [
    null,
    markerBody({ ...pendingFields, resolutionCommits: ['pending'] }).replace('close-out-update: pending', 'close-out-update: cleared (ok)'),
    '<!-- run-comment: close-out-update -->\nbogus\n',
    markerBody({ ...pendingFields, resolutionCommits: 'unknown' }),
  ];
  for (const body of bodies) {
    const deps = fakeDeps(body === null ? P() : P(comment('IC_1', body)));
    assert.equal(run(RESOLVE_ARGV, deps), 1, String(body));
    assert.equal(deps.calls.writes.length, 0);
    assert.equal(out(deps), '');
  }
});

test('resolve-pending: an invalid --sha or missing flag exits 2', () => {
  const invocations = [
    ['resolve-pending', '--comments-file', 'c.json', '--sha', 'abc', '--out', 'm.md'],
    ['resolve-pending', '--comments-file', 'c.json', '--sha', 'pending', '--out', 'm.md'],
    ['resolve-pending', '--comments-file', 'c.json', '--out', 'm.md'],
    ['resolve-pending', '--comments-file', 'c.json', '--sha', C],
    ['resolve-pending', '--sha', C, '--out', 'm.md'],
    ['resolve-pending', '--comments-file', 'c.json', '--sha', C, '--out', 'm.md', '--update-method', 'merge'],
    ['read', '--comments-file', 'c.json', '--out', 'm.md'],
  ];
  for (const argv of invocations) {
    const deps = fakeDeps(P());
    assert.equal(run(argv, deps), 2, JSON.stringify(argv));
    assert.equal(deps.calls.readFile, 0, JSON.stringify(argv));
  }
});

test('resolve-pending: an unwritable --out exits 3', () => {
  const body = markerBody({ ...pendingFields, resolutionCommits: ['pending'] });
  const deps = fakeDeps(P(comment('IC_1', body)), { writeFile: () => { throw new Error('disk full'); } });
  assert.equal(run(RESOLVE_ARGV, deps), 3);
});

// ---- payload failures, help, parseArgs ----

test('an unreadable or non-list comments file exits 1 for every verb', () => {
  const failures = [
    () => { throw new Error('ENOENT: no such file'); },
    () => '',
    () => '{not json',
    () => 'null',
    () => '{"message":"Not Found"}',
  ];
  const argvs = [['read', '--comments-file', 'c.json'], WRITE_ARGV, RESOLVE_ARGV];
  for (const argv of argvs) {
    for (const payload of failures) {
      const deps = fakeDeps(payload);
      assert.equal(run(argv, deps), 1, argv[0]);
      assert.match(err(deps), /--comments-file/);
      assert.equal(out(deps), '');
      assert.equal(deps.calls.writes.length, 0);
    }
  }
});

test('--help exits 0 and prints usage on stdout without reading', () => {
  for (const argv of [['--help'], ['-h'], ['read', '--help'], ['write', '-h']]) {
    const deps = fakeDeps(() => { throw new Error('must not read'); });
    assert.equal(run(argv, deps), 0, JSON.stringify(argv));
    assert.match(out(deps), /^usage: close-out-marker\.js/);
    assert.equal(err(deps), '');
    assert.equal(deps.calls.readFile, 0);
  }
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: a bare inherited key is not a known verb or flag', () => {
  assert.ok(parseArgs(['constructor']).error);
  assert.ok(parseArgs(['read', 'constructor', 'x']).error);
  assert.ok(parseArgs(['read', '--comments-file', 'f', '--comments-file', 'g']).error);
});

// ---- subprocess ----

test('subprocess: read prints one JSON line and exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-'));
  try {
    const file = path.join(dir, 'comments.json');
    fs.writeFileSync(file, JSON.stringify(P(comment('IC_1', markerBody(pendingFields)))));
    const r = spawnSync(process.execPath, [BIN, 'read', '--comments-file', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const result = JSON.parse(lines[0]);
    assert.equal(result.status, 'pending');
    assert.equal(result.id, 'IC_1');
    assert.equal(result.preUpdateHead, A);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('subprocess: write creates the --out file and an unwritable --out exits 3', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-'));
  try {
    const file = path.join(dir, 'comments.json');
    fs.writeFileSync(file, JSON.stringify(P()));
    const target = path.join(dir, 'marker.md');
    const pathsFile = path.join(dir, 'paths.txt');
    fs.writeFileSync(pathsFile, 'a.js\napp/routes/posts.$slug.tsx\n');
    const argv = writeArgv('--comments-file', file);
    argv[argv.indexOf('--out') + 1] = target;
    argv[argv.indexOf('--conflicted-files-file') + 1] = pathsFile;
    const ok = spawnSync(process.execPath, [BIN, ...argv], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(parseMarker(fs.readFileSync(target, 'utf8')).conflictedFiles, ['a.js', 'app/routes/posts.$slug.tsx']);

    const bad = [...argv];
    bad[bad.indexOf('--out') + 1] = path.join(dir, 'no-such-dir', 'marker.md');
    const fail = spawnSync(process.execPath, [BIN, ...bad], { encoding: 'utf8' });
    assert.equal(fail.status, 3, fail.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('subprocess: read --body-out saves the raw body byte for byte and an unwritable path exits 3', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'com-'));
  try {
    const crlf = markerBody(pendingFields).replace(/\n/g, '\r\n');
    const file = path.join(dir, 'comments.json');
    fs.writeFileSync(file, JSON.stringify(P(comment('IC_1', crlf))));
    const target = path.join(dir, 'prior.md');
    const ok = spawnSync(process.execPath, [BIN, 'read', '--comments-file', file, '--body-out', target], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(fs.readFileSync(target), Buffer.from(crlf, 'utf8'));
    assert.equal(JSON.parse(ok.stdout).bodyWritten, target);

    const none = path.join(dir, 'none.json');
    fs.writeFileSync(none, JSON.stringify(P()));
    const absent = path.join(dir, 'absent.md');
    const noMarker = spawnSync(process.execPath, [BIN, 'read', '--comments-file', none, '--body-out', absent], { encoding: 'utf8' });
    assert.equal(noMarker.status, 0, noMarker.stderr);
    assert.equal(fs.existsSync(absent), false);
    assert.equal(JSON.parse(noMarker.stdout).bodyWritten, null);

    const fail = spawnSync(process.execPath, [BIN, 'read', '--comments-file', file, '--body-out', path.join(dir, 'no-such-dir', 'prior.md')], { encoding: 'utf8' });
    assert.equal(fail.status, 3, fail.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
