// tests/multispec-ephemeral-server-record-conformance.test.js — pins #3656: in a multi-spec
// /flow run each spec's {run-dir} is {parent}/spec-{N}/, but the specs share one dev server, so
// ephemeral-server.txt must live at one run-wide place. dev-url-detection.md's Ephemeral server
// start item 4 is the single definition of that "server record"; dispatch's task-prompt templates
// write and re-check the bundle parent, never a spec-{N}/ subdirectory.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

// `### ` sections: slice to the next `### ` or `## ` heading.
function subsection(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const rest = text.slice(start + 1);
  const m = rest.search(/\n##+ /);
  return m === -1 ? text.slice(start) : text.slice(start, start + 1 + m);
}

function lineStarting(text, prefix) {
  const line = text.split('\n').find((l) => l.startsWith(prefix));
  assert.ok(line, `missing line starting: ${prefix}`);
  return line;
}

// Template prose hard-wraps mid-sentence; compare on single-space-joined text.
const flat = (s) => s.replace(/\s+/g, ' ');

// The fenced blocks of a markdown file, in order (bodies only).
function fencedBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const l of text.split('\n')) {
    if (l.startsWith('```')) {
      if (cur === null) cur = [];
      else { blocks.push(cur.join('\n')); cur = null; }
    } else if (cur !== null) cur.push(l);
  }
  return blocks;
}

// The blank-line-delimited paragraph of `block` that starts with `marker`.
function paragraph(block, marker) {
  const start = block.indexOf(marker);
  assert.notEqual(start, -1, `missing paragraph: ${marker}`);
  const m = block.slice(start).search(/\r?\n\r?\n/); // CRLF checkouts (#3574)
  return m === -1 ? block.slice(start) : block.slice(start, start + m);
}

test('AC3.1: dev-url-detection item 4 defines the server record with the single-spec fallback', () => {
  const dud = read('_shared', 'dev-url-detection.md');
  const item4 = lineStarting(dud, '4. **Record the PID + port + detach state**');
  for (const needle of [
    'server record',
    '`$MULTISPEC_PARENT_DIR/ephemeral-server.txt`',
    '`{run-dir}/ephemeral-server.txt`',
    'every reader resolves this same path',
  ]) {
    assert.ok(item4.includes(needle), `item 4 must include: ${needle}`);
  }
  assert.ok(
    !item4.includes('> "{run-dir}/ephemeral-server.txt"'),
    'the printf example must redirect to "{server-record}", not a raw {run-dir} path',
  );
  assert.ok(item4.includes('> "{server-record}"'), 'the printf example redirects to "{server-record}"');
});

test('dev-url-detection Cleanup reads the server record', () => {
  const dud = read('_shared', 'dev-url-detection.md');
  const cleanup = subsection(dud, '### Cleanup');
  const bullet = lineStarting(cleanup, '- **In a pipeline**');
  assert.ok(bullet.includes('server record'), 'the In a pipeline bullet must name the server record');
});

test('dispatch templates write and re-check the bundle parent, never a spec-{N}/ dir', () => {
  const blocks = fencedBlocks(read('dispatch', 'task-prompt.md'));
  assert.equal(blocks.length, 2, 'task-prompt.md keeps exactly two fenced templates');
  const markers = ['Ephemeral dev server (only if', 'Ephemeral dev server liveness'];
  blocks.forEach((block, i) => {
    const para = flat(paragraph(block, markers[i]));
    // Bare path: template 1 names it inside the printf redirect's quotes, template 2 in backticks.
    assert.ok(
      para.includes('{minted-run-dir}/ephemeral-server.txt'),
      `template ${i + 1} paragraph must name the minted run dir's record`,
    );
    assert.ok(
      para.includes('never a `spec-{N}/` subdirectory'),
      `template ${i + 1} paragraph must exclude spec-{N}/ subdirectories`,
    );
  });
});

test('AC1.1: a later spec\'s fix wave reads the server record', () => {
  const sec = flat(section(read('review', 'step3-routing.md'), '## Fix-wave server coordination (pipeline runs)'));
  for (const needle of ['read the server record', '`$MULTISPEC_PARENT_DIR/ephemeral-server.txt`', 'rewrites the server record']) {
    assert.ok(sec.includes(needle), `Fix-wave server coordination must include: ${needle}`);
  }
});

test('AC2.1/AC2.2: consolidated teardown kills the recorded shared server, so none outlives the run', () => {
  const step1 = lineStarting(read('flow', 'multispec-review-console.md'), '1. **Tear down the shared ephemeral dev server**');
  const row15 = lineStarting(read('flow', 'multispec-console-template.md'), '| 15 |');
  for (const [name, line] of [['multispec-review-console step 1', step1], ['multispec-console-template row 15', row15]]) {
    assert.ok(line.includes('`$MULTISPEC_PARENT_DIR/ephemeral-server.txt`'), `${name} must name the parent server record`);
  }
  // Section D's step 1 skips the whole section under MULTISPEC_REVIEW_DEFER=1 (set here), so the kill cites steps 2-4.
  assert.ok(step1.includes('Section D steps 2-4'), 'step 1 must cite Section D steps 2-4, past the defer check');
});

test('AC2.1: Section D reads the server record', () => {
  const d = section(read('wrap-up', 'cleanup-procedures-execution.md'), '## D. Ephemeral dev server');
  assert.ok(d.includes('server record'), 'Section D must name the server record');
  assert.ok(d.includes('`$MULTISPEC_PARENT_DIR/ephemeral-server.txt`'), 'Section D must name the parent server record');
  lineStarting(d, '2. Read the server record');
});

test('wrap-up cleanup applicability tests the server record', () => {
  const skill = flat(read('wrap-up', 'SKILL.md'));
  assert.ok(
    skill.includes('the server record (`$MULTISPEC_PARENT_DIR/ephemeral-server.txt` in a multi-spec run, else `${RUN_DIR}/ephemeral-server.txt`) exists (6)'),
    'wrap-up/SKILL.md condition list must test the server record',
  );
  const intro = lineStarting(read('wrap-up', 'cleanup-procedures.md'), 'Eight cleanup actions');
  assert.ok(intro.includes('reads the server record'), 'cleanup-procedures.md intro line must read the server record');
});

test('AC2.2: parallel-wave merge-back stops a member\'s spec-{N}/ record, and members still get no MULTISPEC_PARENT_DIR', () => {
  const waves = flat(read('flow', 'multispec-parallel-waves.md'));
  const stop = waves.indexOf('stop its dev server');
  assert.notEqual(stop, -1, 'merge-back must stop each returned member\'s dev server');
  const bullet = waves.slice(stop, stop + 900);
  for (const needle of ['{parent}/spec-{N}/ephemeral-server.txt', 'Section D steps 2-4', 'Do not pass `MULTISPEC_PARENT_DIR` to members']) {
    assert.ok(bullet.includes(needle), `merge-back stop bullet must include: ${needle}`);
  }
  // The stop precedes the first worktree removal, so no member worktree vanishes under a live server.
  assert.ok(stop < waves.indexOf('git worktree remove {worktreePath}'), 'the stop must come before any worktree removal');
  // Members' run commands carry no MULTISPEC_PARENT_DIR (it would make concurrent members share one record).
  for (const l of read('flow', 'multispec-parallel-waves.md').split('\n').filter((x) => x.startsWith('PIPELINE_RUN_DIR="{parent}/spec-{N}"'))) {
    assert.ok(!l.includes('MULTISPEC_PARENT_DIR'), `member invocation must not set MULTISPEC_PARENT_DIR: ${l}`);
  }
});

// Every skill file that names a run-dir-relative record path must also name the server record.
function scanServerRecordAgreement(files) {
  const violations = [];
  for (const [rel, text] of Object.entries(files)) {
    if (text.includes('{parent-run-dir}/ephemeral-server.txt')) {
      violations.push(`${rel}: names {parent-run-dir}/ephemeral-server.txt (the writer's path is $MULTISPEC_PARENT_DIR/ephemeral-server.txt)`);
    }
    const naked = text.includes('{run-dir}/ephemeral-server.txt') || text.includes('${RUN_DIR}/ephemeral-server.txt');
    if (naked && !text.includes('$MULTISPEC_PARENT_DIR/ephemeral-server.txt') && !text.includes('server record')) {
      violations.push(`${rel}: names a run-dir ephemeral-server.txt without the server record`);
    }
  }
  return violations;
}

function skillMarkdown(dir = SKILLS, base = SKILLS, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) skillMarkdown(p, base, out);
    else if (e.name.endsWith('.md')) out[path.relative(base, p)] = readText(p);
  }
  return out;
}

test('writer and readers agree repo-wide on the server record path', () => {
  const files = skillMarkdown();
  // standalone-fast-path.md is never multi-spec: its own precondition says so.
  const EXEMPT = path.join('wrap-up', 'standalone-fast-path.md');
  assert.ok(
    flat(files[EXEMPT]).includes('`MULTISPEC_REVIEW_DEFER`/`MULTISPEC_PARENT_DIR` are unset'),
    'the exemption precondition must still be stated',
  );
  const scanned = { ...files };
  delete scanned[EXEMPT];
  assert.deepEqual(scanServerRecordAgreement(scanned), []);
});

test('go-red: the agreement scan reports a stale parent path and a bare run-dir path', () => {
  assert.equal(scanServerRecordAgreement({ 'x.md': 'read `{parent-run-dir}/ephemeral-server.txt`' }).length, 1);
  assert.equal(scanServerRecordAgreement({ 'y.md': 'read `{run-dir}/ephemeral-server.txt`' }).length, 1);
  assert.deepEqual(scanServerRecordAgreement({ 'z.md': 'read the server record, else `{run-dir}/ephemeral-server.txt`' }), []);
});
