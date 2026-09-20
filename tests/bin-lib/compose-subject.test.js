'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  run, parseArgs, shellQuote, extractSection, firstSentence, isUnknownIssueTypeField, fetchIssueTypeGraphQL,
} = require('../../plugin/bin/lib/compose-subject.js');
const { ComposeSubjectError } = require('../../plugin/bin/lib/release/subject.js');

const RECORDS = {
  2251: { number: 2251, title: 'Merge-time conventional subject', body: 'Surface: infra\n\n## Overview\n\nMakes the merge subject conventional. Second sentence.\n\n## Deliverables\n\n- x\n\n## Release Note\n\nMade merge subjects Conventional Commits shaped.\n', labels: [{ name: 'type:feature' }, { name: 'ready' }], issueType: null },
  2252: { number: 2252, title: 'Reconcile under squash', body: '## Overview\n\nSquash-aware reconcile.\n\n## Release Note\n\nMade reconcile squash-aware.\n', labels: [{ name: 'type:task' }], issueType: null },
  2260: { number: 2260, title: 'Drop the legacy flag', body: '## Overview\n\nRemoves --legacy.\n\n## Breaking Change\n\nPass --new instead of --legacy.\n\n## Release Note\n\nDropped the legacy flag.\n\n## Gotchas\n\n- none\n', labels: [{ name: 'type:feature' }, { name: 'breaking' }], issueType: null },
  2261: { number: 2261, title: 'Native-typed', body: '## Overview\n\nNative.\n\n## Release Note\n\nAdded native type support.\n', labels: [{ name: 'type:task' }], issueType: { name: 'Bug' } },
  2262: { number: 2262, title: "It's quoted", body: '## Overview\n\nHas a quote.\n\n## Release Note\n\nAdded quote handling.\n', labels: [{ name: 'type:bug' }], issueType: null },
  2263: { number: 2263, title: 'No type', body: '## Overview\n\nNo type label.\n\n## Release Note\n\nNo type label present.\n', labels: [{ name: 'ready' }], issueType: null },
  2264: { number: 2264, title: 'Breaking, no section', body: '## Overview\n\nOops.\n\n## Release Note\n\nOops noted anyway.\n', labels: [{ name: 'type:feature' }, { name: 'breaking' }], issueType: null },
  2265: { number: 2265, title: 'Unrecognized native type', body: '## Overview\n\nEpic-typed but stale-labeled.\n\n## Release Note\n\nUnrecognized type test note.\n', labels: [{ name: 'type:feature' }], issueType: { name: 'Epic' } },
  2266: { number: 2266, title: 'Shaping-mode record', body: '## Current State\n\nToday X is Y. More.\n\n## Release Note\n\nUpdated shaping-mode current state.\n', labels: [{ name: 'type:task' }], issueType: null },
  2270: { number: 2270, title: 'Second task in an all-task bundle', body: '## Overview\n\nAnother task.\n\n## Release Note\n\nAdded another task path.\n', labels: [{ name: 'type:task' }], issueType: null },
  2250: { number: 2250, title: 'Lowest is a task', body: '## Overview\n\nTask overview.\n\n## Release Note\n\nAdded task overview support.\n', labels: [{ name: 'type:task' }], issueType: null },
  2290: { number: 2290, title: 'No release note', body: '## Overview\n\nSomething.\n', labels: [{ name: 'type:task' }], issueType: null },
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
  assert.equal(parsed.body, 'Makes the merge subject conventional.\n\nRelease-Note: Made merge subjects Conventional Commits shaped.\n\nFixes #2251');
  assert.deepEqual(out.calls[0].slice(0, 3), ['issue', 'view', '2251']);
  assert.ok(out.calls[0].includes('--repo') && out.calls[0].includes('acme/repo'));
  assert.ok(out.calls[0].includes('number,title,body,labels,issueType'));
});

test('bundle: releaseNote is derived from the subject record only — a companion record\'s own section is required but never rendered', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251,2252'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.body, /Release-Note: Made merge subjects Conventional Commits shaped\./);
  assert.ok(!parsed.body.includes('Made reconcile squash-aware.'), parsed.body);
});

test('exit 1: a record with no ## Release Note section fails loudly, regardless of breaking', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2290'], deps), 1);
  assert.match(out.stderr, /record\(s\) #2290 carry no non-empty "## Release Note" section/);
  assert.ok(out.stderr.startsWith('compose-subject.js:'), out.stderr);
});

test('exit 1: a companion record with no ## Release Note section fails loudly even though the subject record has one', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251,2290'], deps), 1);
  assert.match(out.stderr, /#2290/);
});

// #2444 review fix: a caller-supplied --repo can itself already be a
// host-qualified `host/owner/repo` slug (repoSlug()'s GHE output) — before
// this fix, --repo was always prefixed with `github.com/` regardless of
// shape, producing an unparseable 4-segment string for a slug like this.
test('#2444 fix: a host-qualified --repo slug passes through to the --repo flag unmangled', () => {
  const { deps, out } = fakeDeps({ remoteUrl: () => { throw new Error('remoteUrl should not be called when --repo is passed'); } });
  const code = run(['2251', '--repo', 'ghe.example.com/acme/widgets'], deps);
  assert.equal(code, 0, out.stderr);
  assert.ok(out.calls[0].includes('--repo') && out.calls[0].includes('ghe.example.com/acme/widgets'));
});

test('#2444 fix: a bare --repo owner/repo still resolves unchanged', () => {
  const { deps, out } = fakeDeps({ remoteUrl: () => { throw new Error('remoteUrl should not be called when --repo is passed'); } });
  const code = run(['2251', '--repo', 'acme/widgets'], deps);
  assert.equal(code, 0, out.stderr);
  assert.ok(out.calls[0].includes('--repo') && out.calls[0].includes('acme/widgets'));
  assert.ok(!out.calls[0].join(' ').includes('github.com/acme/widgets'), 'must not be double-wrapped with github.com/');
});

test('bundle: subject from the lowest number, one Fixes line per record ascending, tag paragraph', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2252,2251', '--tag', 'auto-merge'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Merge-time conventional subject (#2251)');
  assert.equal(parsed.body, 'Makes the merge subject conventional.\n\n[auto-merge]\n\nRelease-Note: Made merge subjects Conventional Commits shaped.\n\nFixes #2251\nFixes #2252');
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
  assert.equal(parsed.body, 'Today X is Y.\n\nRelease-Note: Updated shaping-mode current state.\n\nFixes #2266');
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
  assert.equal(recoveredBody, 'Has a quote.\n\nRelease-Note: Added quote handling.\n\nFixes #2262');
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

test('firstSentence (#2319): e.g./i.e./etc. and version/decimal numbers are not sentence terminators', () => {
  // Discriminating: the pre-#2319 regex cut at the first `.` followed by whitespace with no
  // abbreviation/version awareness, so each of these would have truncated to just the token
  // before the first period (e.g. 'e.g.', 'v6.34.', 'i.e.', 'etc.').
  assert.equal(firstSentence('e.g. Do the thing. More.'), 'e.g. Do the thing.');
  assert.equal(firstSentence('This is v6.34. New release adds support. More.'), 'This is v6.34. New release adds support.');
  assert.equal(firstSentence('Say i.e. this way. Next.'), 'Say i.e. this way.');
  assert.equal(firstSentence('etc. Something else. More.'), 'etc. Something else.');
  // A plain decimal (no leading v) is treated the same as a version number.
  assert.equal(firstSentence('It costs 6.34. That is the price. More.'), 'It costs 6.34. That is the price.');
  // No later terminator at all: falls through to the whole paragraph, same as the untouched case.
  assert.equal(firstSentence('v6.34. New release with no terminator'), 'v6.34. New release with no terminator');
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

// (#2561) GHES/older-gh REST `issueType` field rejection — retry + fallback.
test('isUnknownIssueTypeField: matches the exact gh rejection text on .message or .stderr, not other failures', () => {
  assert.equal(isUnknownIssueTypeField({ message: 'gh: Unknown JSON field: "issueType"' }), true);
  assert.equal(isUnknownIssueTypeField({ stderr: 'error: Unknown JSON field: "issueType"' }), true);
  assert.equal(isUnknownIssueTypeField({ message: 'HTTP 404: Not Found' }), false);
  assert.equal(isUnknownIssueTypeField({ message: 'network timeout' }), false);
  assert.equal(isUnknownIssueTypeField(new Error('gh auth login required')), false);
});

test('fetchIssueTypeGraphQL: parses a native type from the GraphQL response, adds --hostname only off github.com', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify({ data: { repository: { issue: { issueType: { name: 'Bug' } } } } });
  };
  const result = fetchIssueTypeGraphQL(runner, { host: 'github.com', owner: 'acme', repo: 'repo' }, 42);
  assert.deepEqual(result, { name: 'Bug' });
  assert.ok(!calls[0].includes('--hostname'), calls[0].join(' '));
  // owner/repo are bound GraphQL variables (-f owner=…/-f repo=…), never
  // string-interpolated into the query text — gh-api-module-pattern.
  assert.ok(calls[0].includes('owner=acme'), calls[0].join(' '));
  assert.ok(calls[0].includes('repo=repo'), calls[0].join(' '));
  const queryArg = calls[0].find((a) => a.startsWith('query='));
  assert.ok(queryArg.includes('$owner:String!') && queryArg.includes('$repo:String!'), queryArg);
  assert.ok(!queryArg.includes('"acme"') && !queryArg.includes('"repo"'), queryArg);

  const ghesRunner = (args) => { calls.push(args); return JSON.stringify({ data: { repository: { issue: { issueType: { name: 'Task' } } } } }); };
  fetchIssueTypeGraphQL(ghesRunner, { host: 'ghes.acme.internal', owner: 'acme', repo: 'repo' }, 42);
  assert.ok(calls[1].includes('--hostname') && calls[1].includes('ghes.acme.internal'), calls[1].join(' '));
});

test('fetchIssueTypeGraphQL: degrades to null on a runner failure, malformed JSON, or a response carrying no issueType (never throws)', () => {
  assert.equal(fetchIssueTypeGraphQL(() => { throw new Error('boom'); }, { owner: 'a', repo: 'b' }, 1), null);
  assert.equal(fetchIssueTypeGraphQL(() => 'not json', { owner: 'a', repo: 'b' }, 1), null);
  assert.equal(fetchIssueTypeGraphQL(() => JSON.stringify({ data: { repository: { issue: { issueType: null } } } }), { owner: 'a', repo: 'b' }, 1), null);
});

test('run(): REST issueType rejection retries without the field, then still resolves type from an existing type:* label (label-first, no GraphQL call)', () => {
  const out = { stdout: '', stderr: '', calls: [] };
  let attempt = 0;
  const deps = {
    ghAvailable: () => true,
    remoteUrl: () => 'git@github.com:acme/repo.git',
    runner: (args) => {
      out.calls.push(args);
      if (args[0] === 'issue' && args[1] === 'view') {
        attempt++;
        if (attempt === 1) {
          const e = new Error('gh: Unknown JSON field: "issueType"');
          throw e;
        }
        assert.ok(!args.includes('number,title,body,labels,issueType'), 'retry must drop the rejected field');
        return JSON.stringify({ ...RECORDS[2251], issueType: undefined });
      }
      throw new Error('unexpected call: ' + args.join(' '));
    },
    fetchIssueType: () => { throw new Error('must not call GraphQL fallback when a type:* label already resolves the type'); },
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  const code = run(['2251'], deps);
  assert.equal(code, 0, out.stderr);
  assert.equal(attempt, 2);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Merge-time conventional subject (#2251)');
});

test('run(): REST issueType rejection + no type:* label falls back to the GraphQL native type', () => {
  const out = { stdout: '', stderr: '' };
  let viewAttempt = 0;
  const deps = {
    ghAvailable: () => true,
    remoteUrl: () => 'git@github.com:acme/repo.git',
    runner: (args) => {
      if (args[0] === 'issue' && args[1] === 'view') {
        viewAttempt++;
        if (viewAttempt === 1) throw new Error('Unknown JSON field: "issueType"');
        return JSON.stringify(RECORDS[2263]); // no type:* label
      }
      throw new Error('unexpected call: ' + args.join(' '));
    },
    fetchIssueType: (runner, repoSpec, n) => {
      assert.equal(n, 2263);
      assert.equal(repoSpec.owner, 'acme');
      return { name: 'Bug' };
    },
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  const code = run(['2263'], deps);
  assert.equal(code, 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'fix: No type (#2263)');
});

test('run(): REST issueType rejection + no label + GraphQL fallback also finds nothing — composeSubject\'s pre-existing type requirement still applies (exit 1, unchanged from the REST-works case)', () => {
  const out = { stdout: '', stderr: '' };
  let viewAttempt = 0;
  const deps = {
    ghAvailable: () => true,
    remoteUrl: () => 'git@github.com:acme/repo.git',
    runner: (args) => {
      if (args[0] === 'issue' && args[1] === 'view') {
        viewAttempt++;
        if (viewAttempt === 1) throw new Error('Unknown JSON field: "issueType"');
        return JSON.stringify(RECORDS[2263]);
      }
      throw new Error('unexpected call: ' + args.join(' '));
    },
    fetchIssueType: () => null,
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  const code = run(['2263'], deps);
  assert.equal(code, 1);
  assert.match(out.stderr, /type must be one of/);
});

test('run(): a genuine gh failure (not the issueType rejection) on the first view call is still fatal, with no retry attempted', () => {
  const out = { stdout: '', stderr: '' };
  let calls = 0;
  const deps = {
    ghAvailable: () => true,
    remoteUrl: () => 'git@github.com:acme/repo.git',
    runner: () => { calls++; throw new Error('HTTP 404: Not Found'); },
    fetchIssueType: () => { throw new Error('must not be called'); },
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  const code = run(['2251'], deps);
  assert.equal(code, 3);
  assert.equal(calls, 1);
  assert.match(out.stderr, /HTTP 404/);
});

test('run(): unaffected hosts (REST issueType field works) are unchanged — still one gh issue view call, no fetchIssueType call', () => {
  const { deps, out } = fakeDeps();
  deps.fetchIssueType = () => { throw new Error('must not be called when the REST field succeeds'); };
  const code = run(['2261'], deps); // 2261 carries a native issueType in the fixture already
  assert.equal(code, 0, out.stderr);
  assert.equal(out.calls.length, 1);
});
