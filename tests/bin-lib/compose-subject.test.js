'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parseArgs, shellQuote, extractSection, firstSentence } = require('../../plugin/bin/lib/compose-subject.js');
const { ComposeSubjectError } = require('../../plugin/bin/lib/release/subject.js');

const RECORDS = {
  2251: { number: 2251, title: 'Merge-time conventional subject', body: 'Surface: infra\n\n## Overview\n\nMakes the merge subject conventional. Second sentence.\n\n## Deliverables\n\n- x\n', labels: [{ name: 'type:feature' }, { name: 'ready' }], issueType: null },
  2252: { number: 2252, title: 'Reconcile under squash', body: '## Overview\n\nSquash-aware reconcile.\n', labels: [{ name: 'type:task' }], issueType: null },
  2260: { number: 2260, title: 'Drop the legacy flag', body: '## Overview\n\nRemoves --legacy.\n\n## Breaking Change\n\nPass --new instead of --legacy.\n\n## Gotchas\n\n- none\n', labels: [{ name: 'type:feature' }, { name: 'breaking' }], issueType: null },
  2261: { number: 2261, title: 'Native-typed', body: '## Overview\n\nNative.\n', labels: [{ name: 'type:task' }], issueType: { name: 'Bug' } },
  2262: { number: 2262, title: "It's quoted", body: '## Overview\n\nHas a quote.\n', labels: [{ name: 'type:bug' }], issueType: null },
  2263: { number: 2263, title: 'No type', body: '## Overview\n\nNo type label.\n', labels: [{ name: 'ready' }], issueType: null },
  2264: { number: 2264, title: 'Breaking, no section', body: '## Overview\n\nOops.\n', labels: [{ name: 'type:feature' }, { name: 'breaking' }], issueType: null },
  2265: { number: 2265, title: 'Unrecognized native type', body: '## Overview\n\nEpic-typed but stale-labeled.\n', labels: [{ name: 'type:feature' }], issueType: { name: 'Epic' } },
  2266: { number: 2266, title: 'Shaping-mode record', body: '## Current State\n\nToday X is Y. More.\n', labels: [{ name: 'type:task' }], issueType: null },
  2270: { number: 2270, title: 'Second task in an all-task bundle', body: '## Overview\n\nAnother task.\n', labels: [{ name: 'type:task' }], issueType: null },
  2250: { number: 2250, title: 'Lowest is a task', body: '## Overview\n\nTask overview.\n', labels: [{ name: 'type:task' }], issueType: null },
};

function fakeDeps({ records = RECORDS, ghAvailable = () => true, remoteUrl = () => 'git@github.com:acme/repo.git', failView = false } = {}) {
  const out = { stdout: '', stderr: '', calls: [] };
  const deps = {
    ghAvailable,
    remoteUrl,
    runner: (args) => {
      out.calls.push(args);
      if (failView) throw new Error('boom: gh exploded');
      assert.equal(args[0], 'issue'); assert.equal(args[1], 'view');
      const n = Number(args[2]);
      if (!records[n]) throw new Error('unexpected ' + args.join(' '));
      return JSON.stringify(records[n]);
    },
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  return { deps, out };
}

test('parseArgs: comma-joined and space-separated numbers, --tag, --shell, --repo', () => {
  const o = parseArgs(['2251,2252', '2253', '--tag', 'auto-merge', '--shell', '--repo', 'a/b']);
  assert.deepEqual(o.numbers, [2251, 2252, 2253]);
  assert.equal(o.tag, 'auto-merge'); assert.equal(o.shell, true); assert.equal(o.repo, 'a/b');
  assert.ok(parseArgs([]).error);
  assert.ok(parseArgs(['0']).error);
  assert.ok(parseArgs(['2251', '--bogus']).error);
  assert.ok(parseArgs(['2251', '--tag']).error);
  assert.equal(parseArgs(['--help']).help, true);
});

test('single record: conventional subject from type label, summary from Overview first sentence, one Fixes line', () => {
  const { deps, out } = fakeDeps();
  const code = run(['2251'], deps);
  assert.equal(code, 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Merge-time conventional subject (#2251)');
  assert.equal(parsed.body, 'Makes the merge subject conventional.\n\nFixes #2251');
  assert.deepEqual(out.calls[0].slice(0, 3), ['issue', 'view', '2251']);
  assert.ok(out.calls[0].includes('--repo') && out.calls[0].includes('acme/repo'));
  assert.ok(out.calls[0].includes('number,title,body,labels,issueType'));
});

test('bundle: subject from the lowest number, one Fixes line per record ascending, tag paragraph', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2252,2251', '--tag', 'auto-merge'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Merge-time conventional subject (#2251)');
  assert.equal(parsed.body, 'Makes the merge subject conventional.\n\n[auto-merge]\n\nFixes #2251\nFixes #2252');
});

test('bundle Type aggregation: a type:feature sibling wins over the lowest-numbered type:task record (discriminating: the old lowest-record-only logic yields chore: here)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251,2250'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Lowest is a task (#2250)');
});

test('bundle Type aggregation: a type:bug sibling beats the lowest-numbered type:task record (bug > task precedence)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2262,2250'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.ok(parsed.title.startsWith('fix: Lowest is a task (#2250)'), parsed.title);
});

test('bundle Type aggregation: an all-type:task bundle still composes chore:', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2252,2270'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'chore: Reconcile under squash (#2252)');
});

test('summary falls back to ## Current State\'s first sentence when ## Overview is absent (shaping-mode records)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2266'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.ok(parsed.body.startsWith('Today X is Y.\n\nFixes #2266'), parsed.body);
});

test('breaking record: ! suffix and BREAKING CHANGE footer from its ## Breaking Change section', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2260'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat!: Drop the legacy flag (#2260)');
  assert.ok(parsed.body.endsWith('\n\nBREAKING CHANGE: Pass --new instead of --legacy.'), parsed.body);
});

test('native issueType wins over a type:* label', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2261'], deps), 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).title, 'fix: Native-typed (#2261)');
});

test('an unrecognized native issueType is decided from it alone — no fallback to a stale type:* label', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2265'], deps), 1);
  assert.match(out.stderr, /type must be one of/);
  assert.ok(out.stderr.startsWith('compose-subject.js: composeSubject:'), out.stderr);
});

test('--shell prints two eval-able sh assignments; a real eval round-trip recovers title and body verbatim', () => {
  const { deps: jsonDeps, out: jsonOut } = fakeDeps();
  assert.equal(run(['2262'], jsonDeps), 0, jsonOut.stderr);
  const jsonComposed = JSON.parse(jsonOut.stdout);

  const { deps, out } = fakeDeps();
  assert.equal(run(['2262', '--shell'], deps), 0, out.stderr);
  const lines = out.stdout.trimEnd().split('\n');
  assert.equal(lines[0], "SUBJECT_TITLE='fix: It'\\''s quoted (#2262)'");
  // Exactly two eval-able sh assignments, not exactly two physical lines: SUBJECT_BODY='...'
  // appears exactly once, and this fixture's body itself spans several physical lines —
  // proving the contract is "two assignments", never "two lines".
  assert.ok(out.stdout.startsWith('SUBJECT_TITLE='));
  const bodyAt = out.stdout.indexOf('\nSUBJECT_BODY=');
  assert.ok(bodyAt > 0, 'SUBJECT_BODY= assignment not found on its own line');
  assert.equal(out.stdout.indexOf('\nSUBJECT_BODY=', bodyAt + 1), -1, 'SUBJECT_BODY= must appear exactly once');
  assert.ok(lines.length > 2, 'this fixture must actually exercise the multi-physical-line body case');

  const result = require('child_process').spawnSync(
    'sh',
    ['-c', 'eval "$1"; printf "%s\n---\n%s" "$SUBJECT_TITLE" "$SUBJECT_BODY"', '_', out.stdout],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const [recoveredTitle, recoveredBody] = result.stdout.split('\n---\n');
  assert.equal(recoveredTitle, "fix: It's quoted (#2262)");
  assert.equal(recoveredBody, 'Has a quote.\n\nFixes #2262');
  assert.equal(recoveredTitle, jsonComposed.title);
  assert.equal(recoveredBody, jsonComposed.body);

  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});

test('exit 1: record with no resolvable type, or breaking without a ## Breaking Change section', () => {
  let r = fakeDeps();
  assert.equal(run(['2263'], r.deps), 1);
  assert.match(r.out.stderr, /type must be one of/);
  assert.ok(r.out.stderr.startsWith('compose-subject.js: composeSubject:'), r.out.stderr);
  r = fakeDeps();
  assert.equal(run(['2264'], r.deps), 1);
  assert.match(r.out.stderr, /Breaking Change/);
  assert.ok(r.out.stderr.startsWith('compose-subject.js: breaking is set on'), r.out.stderr);
});

test('usage errors cite the failing record number', () => {
  let r = fakeDeps();
  assert.equal(run(['2264'], r.deps), 1);
  assert.match(r.out.stderr, /#2264/);

  // Bundle: 2251 (subject record, not breaking) + 2264 (breaking, no Breaking Change section) —
  // the usage error must cite the breaking record (#2264), never misattribute it to the
  // bundle's subject record (#2251).
  r = fakeDeps();
  assert.equal(run(['2251,2264'], r.deps), 1);
  assert.match(r.out.stderr, /#2264/);
  assert.doesNotMatch(r.out.stderr, /#2251 but/);
});

test('mixed bundle: one breaking record with a section, one without — exits 1 naming only the missing one', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2260', '2264'], deps), 1);
  assert.match(out.stderr, /#2264/);
  assert.doesNotMatch(out.stderr, /#2260 but/);
});

test('ComposeSubjectError is a named Error subclass', () => {
  // run()'s catch around composeSubject() is instanceof-gated on this class (only a
  // ComposeSubjectError reads as exit 1; anything else propagates). A test that a genuine bug
  // thrown from *inside* composeSubject actually propagates through run() was attempted per
  // the brief (e.g. a record `title` whose toString throws) and found unreachable: every value
  // run() hands to composeSubject comes from `JSON.parse(raw)` (plain JSON data only — no
  // object can carry a throwing toString/valueOf), and every field composeSubject reads is
  // guarded by a typeof/Number.isInteger check before use, so no crafted record can make it
  // throw anything but a ComposeSubjectError. Covering the class contract only, as the brief's
  // fallback allows.
  assert.ok(new ComposeSubjectError('x') instanceof Error);
  assert.equal(new ComposeSubjectError('x').name, 'ComposeSubjectError');
});

test('exit 2: gh absent, or owner/repo unresolvable without --repo', () => {
  let r = fakeDeps({ ghAvailable: () => false });
  assert.equal(run(['2251'], r.deps), 2);
  r = fakeDeps({ remoteUrl: () => { throw new Error('not a git repo'); } });
  assert.equal(run(['2251'], r.deps), 2);
  r = fakeDeps({ remoteUrl: () => { throw new Error('not a git repo'); } });
  assert.equal(run(['2251', '--repo', 'acme/repo'], r.deps), 0, r.out.stderr);
});

test('exit 3: a gh issue view call fails', () => {
  const r = fakeDeps({ failView: true });
  assert.equal(run(['2251'], r.deps), 3);
  assert.match(r.out.stderr, /boom/);
});

test('helpers: extractSection and firstSentence', () => {
  const body = '## Overview\n\nOne. Two.\n\n## Breaking Change\n\nNote line 1.\nNote line 2.\n\n## Gotchas\n\n- g\n';
  assert.equal(extractSection(body, 'Breaking Change'), 'Note line 1.\nNote line 2.');
  assert.equal(extractSection(body, 'Missing'), '');
  assert.equal(firstSentence('One. Two.'), 'One.');
  assert.equal(firstSentence('No terminator here\n\nSecond para.'), 'No terminator here');
  assert.equal(firstSentence('Is this it? Yes. More.'), 'Is this it?');
  assert.equal(firstSentence('Line one\ncontinues here. Then more.'), 'Line one continues here.');
  assert.equal(firstSentence(''), '');
});

test('Type vocabulary has one source of truth: TYPE_PREFIX and record.TYPES name the same set', () => {
  // Pins subject.js's TYPE_PREFIX keys against record.js's TYPES so the two never drift apart
  // silently. A fourth Type must gain a prefix in subject.js's TYPE_PREFIX in the SAME change
  // that adds it to record.js's TYPES — otherwise this fails loudly instead of leaving the new
  // Type unresolvable (typeOf returns null for it) and merges silently blocked (exit 1).
  const { TYPE_PREFIX } = require('../../plugin/bin/lib/release/subject.js');
  const { TYPES } = require('../../plugin/bin/lib/issues/record.js');
  assert.deepEqual(Object.keys(TYPE_PREFIX).sort(), TYPES.slice().sort());
});
