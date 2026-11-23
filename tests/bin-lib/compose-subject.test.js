'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  run, parseArgs, shellQuote, extractSection, firstSentence, isUnknownIssueTypeField, fetchIssueTypeGraphQL, realDeps, USAGE,
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
  2267: { number: 2267, title: "It's Bob's `x` $(echo PWNED)", body: '## Overview\n\nShell metacharacters in the title.\n\n## Release Note\n\nAdded metacharacter-safe titles.\n', labels: [{ name: 'type:bug' }], issueType: null },
  2290: { number: 2290, title: 'No release note', body: '## Overview\n\nSomething.\n', labels: [{ name: 'type:task' }], issueType: null },
  2268: { number: 2268, title: 'Specshaped footer', body: '## Overview\n\nFooter shape one.\n\n## Release Note\n\nNote with specShapedBody footer.\n\n_Filed by `x` via specShapedBody._', labels: [{ name: 'type:task' }], issueType: null },
  2269: { number: 2269, title: 'Wontfix footer', body: '## Overview\n\nFooter shape two.\n\n## Release Note\n\nNote with wontfix footer.\n\n_Filed by `x`. Close to resolve; label `wontfix` to suppress future reports of this finding._', labels: [{ name: 'type:task' }], issueType: null },
  2271: { number: 2271, title: 'Footer-only release note', body: '## Overview\n\nOnly a footer.\n\n## Release Note\n\n_Filed by `x` via specShapedBody._', labels: [{ name: 'type:task' }], issueType: null },
  2272: { number: 2272, title: 'CRLF footer', body: '## Overview\r\n\r\nCRLF footer.\r\n\r\n## Release Note\r\n\r\nNote with CRLF footer.\r\n\r\n_Filed by `x` via specShapedBody._\r\n', labels: [{ name: 'type:task' }], issueType: null },
  10: { number: 10, title: 'Bundle lowest', body: '## Overview\n\nLowest record.\n\n## Release Note\n\nAdded the lowest thing.\n', labels: [{ name: 'type:bug' }], issueType: null },
  11: { number: 11, title: 'Bundle middle', body: '## Overview\n\nMiddle record.\n\n## Release Note\n\nFixed the middle thing.\n', labels: [{ name: 'type:task' }], issueType: null },
  12: { number: 12, title: 'Bundle top', body: '## Overview\n\nTop record.\n\n## Release Note\n\nChanged the top thing.\n', labels: [{ name: 'type:task' }], issueType: null },
  2273: { number: 2273, title: 'Footer-shaped prose mid-note', body: '## Overview\n\nMid-note line.\n\n## Release Note\n\n_Filed by the planner_\n\nMore note after.\n\n_Filed by `x` via specShapedBody._', labels: [{ name: 'type:task' }], issueType: null },
  2280: { number: 2280, title: 'Release Note behind an unclosed fence', body: '## Overview\n\nFenced.\n\n```\nnever closed\n\n## Release Note\n\nHidden note.\n', labels: [{ name: 'type:task' }], issueType: null },
  2281: { number: 2281, title: 'Breaking Change behind an unclosed fence', body: '## Overview\n\nB.\n\n```\nopen\n\n## Breaking Change\n\nUse --new.\n\n## Release Note\n\nNote.\n', labels: [{ name: 'type:feature' }, { name: 'breaking' }], issueType: null },
  2282: { number: 2282, title: 'Unclosed fence, no Release Note at all', body: '## Overview\n\nFenced.\n\n```\nnever closed\n', labels: [{ name: 'type:task' }], issueType: null },
};

const nodeFs = require('node:fs');
const nodeOs = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

// A directory path that is never created: the fakes never touch the filesystem under it.
const PHANTOM_CWD = nodePath.join(nodeOs.tmpdir(), 'compose-subject-phantom-cwd');
const INJECTED_ENV = Object.freeze({ PATH: process.env.PATH || '', COMPOSE_SUBJECT_MARKER: 'injected' });
// A home directory that is never created: no gh hosts.yml is readable under it, so the origin gate and
// host pin never read the developer's own.
const PHANTOM_HOME = nodePath.join(nodeOs.tmpdir(), 'compose-subject-phantom-home');
// The injected process context every deps object carries (#5386).
const FAKE_CTX = { cwd: () => PHANTOM_CWD, env: INJECTED_ENV, homeDir: () => PHANTOM_HOME };

function fakeDeps({
  records = RECORDS, ghAvailable = () => true, remoteUrl = () => 'git@github.com:acme/repo.git', failView = false,
  commitScope = null, commitScopePaths = [], changedFiles = null, prFiles = null, writeError = null, prView = null,
} = {}) {
  const out = { stdout: '', stderr: '', calls: [], gitCalls: [], files: {}, dirs: [] };
  const deps = {
    ...FAKE_CTX,
    ghAvailable,
    remoteUrl,
    runner: (args) => {
      out.calls.push(args);
      if (args[0] === 'pr' && args[1] === 'view') {
        if (prView === null) throw new Error('gh pr view must not be called');
        if (prView instanceof Error) throw prView;
        return JSON.stringify(prView);
      }
      if (args[0] === 'pr') {
        assert.deepEqual(args.slice(0, 2), ['pr', 'diff']);
        if (prFiles instanceof Error) throw prFiles;
        if (prFiles === null) throw new Error('gh pr diff must not be called');
        return prFiles;
      }
      if (failView) throw new Error('boom: gh exploded');
      assert.equal(args[0], 'issue'); assert.equal(args[1], 'view');
      const n = Number(args[2]);
      if (!records[n]) throw new Error('unexpected ' + args.join(' '));
      return JSON.stringify(records[n]);
    },
    readCommitScope: () => commitScope,
    readCommitScopePaths: () => commitScopePaths,
    gitRunner: (args) => {
      out.gitCalls.push(args);
      if (changedFiles instanceof Error) throw changedFiles;
      if (changedFiles === null) throw new Error('gitRunner must not be called');
      return changedFiles;
    },
    mkdirp: (d) => { out.dirs.push(d); },
    writeFile: (p, s) => {
      if (writeError) throw writeError;
      out.files[p] = s;
    },
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  return { deps, out };
}

test('parseArgs: comma-joined and space-separated numbers, --tag, --repo', () => {
  const o = parseArgs(['2251,2252', '2253', '--tag', 'auto-merge', '--repo', 'a/b']);
  assert.deepEqual(o.numbers, [2251, 2252, 2253]);
  assert.equal(o.tag, 'auto-merge'); assert.equal(o.repo, 'a/b');
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

test('bundle: every record\'s Release Note renders, lowest number first (#4634 flips #2580 AC 3)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251,2252'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.ok(parsed.body.includes('Release-Note: Made merge subjects Conventional Commits shaped.\nRelease-Note: Made reconcile squash-aware.'), parsed.body);
});

const BUNDLE_NOTES = 'Release-Note: Added the lowest thing.\nRelease-Note: Fixed the middle thing.\nRelease-Note: Changed the top thing.';

test('AC1.1: compose-subject 10,11,12 writes three Release-Note lines in number order, then the Fixes lines', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['12,10,11'], deps), 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).body, `Lowest record.\n\n${BUNDLE_NOTES}\n\nFixes #10\nFixes #11\nFixes #12`);
});

test('AC1.2: with --keep-open 11 the body still has three notes, and #11\'s footer line is Refs #11', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['10,11,12', '--keep-open', '11'], deps), 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).body, `Lowest record.\n\n${BUNDLE_NOTES}\n\nFixes #10\nRefs #11\nFixes #12`);
});

test('AC2.1: compose-subject 10 output equals the pre-#4634 composer byte for byte', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['10'], deps), 0, out.stderr);
  assert.equal(out.stdout, '{"title":"fix: Bundle lowest (#10)","body":"Lowest record.\\n\\nRelease-Note: Added the lowest thing.\\n\\nFixes #10"}\n');
});

test('AC3.1: a bundle where any record has an empty ## Release Note section still fails with the existing message', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['10,11,2271'], deps), 1);
  assert.match(out.stderr, /record\(s\) #2271 carry no non-empty "## Release Note" section/);
  assert.equal(out.stdout, '');
});

test('exit 1: a record with no ## Release Note section fails loudly, regardless of breaking', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2290'], deps), 1);
  assert.match(out.stderr, /record\(s\) #2290 carry no non-empty "## Release Note" section/);
  assert.ok(out.stderr.startsWith('compose-subject.js:'), out.stderr);
});

// specShapedBody ends a Release Note section with an italic `_Filed by …_` footer; the
// footer is provenance, never release-note text, so it must not reach Release-Note:.
test('Release Note stops at the trailing "_Filed by …_" footer, for both specShapedBody footer shapes', () => {
  let r = fakeDeps();
  assert.equal(run(['2268'], r.deps), 0, r.out.stderr);
  assert.equal(JSON.parse(r.out.stdout).body, 'Footer shape one.\n\nRelease-Note: Note with specShapedBody footer.\n\nFixes #2268');
  r = fakeDeps();
  assert.equal(run(['2269'], r.deps), 0, r.out.stderr);
  assert.equal(JSON.parse(r.out.stdout).body, 'Footer shape two.\n\nRelease-Note: Note with wontfix footer.\n\nFixes #2269');
});

test('Release Note footer cut holds for a CRLF body, and spares a footer-shaped line that is not the last content', () => {
  let r = fakeDeps();
  assert.equal(run(['2272'], r.deps), 0, r.out.stderr);
  const crlf = JSON.parse(r.out.stdout).body;
  assert.match(crlf, /Release-Note: Note with CRLF footer\./);
  assert.doesNotMatch(crlf, /Filed by/);
  r = fakeDeps();
  assert.equal(run(['2273'], r.deps), 0, r.out.stderr);
  const mid = JSON.parse(r.out.stdout).body;
  assert.match(mid, /_Filed by the planner_/);
  assert.match(mid, /More note after\./);
  assert.doesNotMatch(mid, /via specShapedBody/);
});

test('a Release Note section holding only the footer counts as empty — exit 1, same as a missing section', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2271'], deps), 1);
  assert.match(out.stderr, /record\(s\) #2271 carry no non-empty "## Release Note" section/);
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
  assert.equal(parsed.body, 'Makes the merge subject conventional.\n\n[auto-merge]\n\nRelease-Note: Made merge subjects Conventional Commits shaped.\nRelease-Note: Made reconcile squash-aware.\n\nFixes #2251\nFixes #2252');
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
  assert.match(r.out.stderr, /could not resolve owner\/repo — pass --repo \[host\/\]owner\/name/);
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
    ...FAKE_CTX,
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
    readCommitScope: () => null, readCommitScopePaths: () => [],
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
    ...FAKE_CTX,
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
    readCommitScope: () => null, readCommitScopePaths: () => [],
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
    ...FAKE_CTX,
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
    readCommitScope: () => null, readCommitScopePaths: () => [],
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
    ...FAKE_CTX,
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

test('--scope (#3028): parsed, threaded into the subject, breaking keeps ! after the scope, non-token exits 1', () => {
  assert.equal(parseArgs(['2251', '--scope', 'api']).scope, 'api');
  assert.equal(parseArgs(['2251']).scope, null);
  assert.ok(parseArgs(['2251', '--scope']).error, 'trailing --scope with no value is a parse error');
  assert.ok(parseArgs(['2251', '--scope', '--tag']).error, '--scope followed by another flag is a parse error');

  const ok = fakeDeps();
  assert.equal(run(['2251', '--scope', 'web-ui'], ok.deps), 0, ok.out.stderr);
  assert.equal(JSON.parse(ok.out.stdout).title, 'feat(web-ui): Merge-time conventional subject (#2251)');

  const brk = fakeDeps();
  assert.equal(run(['2260', '--scope', 'cli'], brk.deps), 0, brk.out.stderr);
  assert.equal(JSON.parse(brk.out.stdout).title, 'feat(cli)!: Drop the legacy flag (#2260)');

  const bad = fakeDeps();
  assert.equal(run(['2251', '--scope', 'two words'], bad.deps), 1);
  assert.match(bad.out.stderr, /scope must be a single token/);
});

test('realDeps.runner (#3028) pipes gh stderr instead of inheriting it, and keeps windowsHide', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../plugin/bin/lib/compose-subject.js'), 'utf8');
  // Any parameter list: the pin is that the runner key calls execFileSync('gh', ...), not its parameter names.
  const line = src.split('\n').find((l) => /^\s*runner:\s*\([^)]*\)\s*=>\s*execFileSync\('gh'/.test(l));
  assert.ok(line, 'realDeps.runner line must exist');
  assert.ok(line.includes("stdio: ['ignore', 'pipe', 'pipe']"), line);
  assert.ok(line.includes('windowsHide: true'), line);
});

test('USAGE (#3028) advertises --scope', () => {
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  assert.match(USAGE, /\[--scope <scope>\]/);
});

test('AC1.1: explicit --scope beats a commit-scope policy value', () => {
  const { deps, out } = fakeDeps({ commitScope: 'web' });
  assert.equal(run(['2251', '--scope', 'api'], deps), 0, out.stderr);
  assert.match(JSON.parse(out.stdout).title, /^feat\(api\): /);
  assert.equal(out.gitCalls.length, 0);
});

test('AC2.1: commit-scope-paths with one matching scope across the diff scopes the subject', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/skills/=skills', 'plugin/bin/=bin'], changedFiles: 'plugin/bin/x.js\0plugin/bin/lib/y.js\0' });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.match(JSON.parse(out.stdout).title, /^feat\(bin\): /);
  assert.deepEqual(out.gitCalls, [['diff', '--name-only', '-z', '--end-of-options', 'main...feat']]);
});

test('AC2.2: paths spanning two scopes fall back to commit-scope with a stderr note', () => {
  const { deps, out } = fakeDeps({ commitScope: 'plugin', commitScopePaths: ['plugin/skills/=skills', 'plugin/bin/=bin'], changedFiles: 'plugin/bin/x.js\0plugin/skills/a.md\0' });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.match(JSON.parse(out.stdout).title, /^feat\(plugin\): /);
  assert.match(out.stderr, /span scopes bin, skills — falling back to commit-scope "plugin"/);
});

test('AC2.3: paths spanning two scopes with no commit-scope leave the subject unscoped, with the note', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/skills/=skills', 'plugin/bin/=bin'], changedFiles: 'plugin/bin/x.js\0plugin/skills/a.md\0' });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.match(JSON.parse(out.stdout).title, /^feat: /);
  assert.match(out.stderr, /span scopes bin, skills — subject left unscoped/);
});

test('AC3.1: commit-scope-paths set with no --range (and no --pr) exits 1 naming the flag', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'] });
  assert.equal(run(['2251'], deps), 1);
  assert.match(out.stderr, /pass --range \{base\}\.\.\.\{head\}/);
  assert.equal(out.gitCalls.length, 0);
});

test('AC3.2: --range with no commit-scope-paths never calls git and composes as before', () => {
  const { deps, out } = fakeDeps({ commitScope: 'web' });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).title, 'feat(web): Merge-time conventional subject (#2251)');
  assert.equal(out.gitCalls.length, 0);
});

test('AC4.1: a throwing gitRunner exits 3 with the message on stderr', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], changedFiles: new Error('fatal: bad revision') });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 3);
  assert.match(out.stderr, /git diff --name-only main\.\.\.feat failed: fatal: bad revision/);
});

test('a malformed commit-scope-paths entry exits 1 naming the entry', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin'] });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 1);
  assert.match(out.stderr, /commit-scope-paths entry "plugin\/bin" is not \{path-prefix\}=\{token\}/);
});

test('a policy-sourced token with ( fails composeSubject\'s own validation, exit 1', () => {
  const { deps, out } = fakeDeps({ commitScope: 'a(b' });
  assert.equal(run(['2251'], deps), 1);
  assert.match(out.stderr, /scope must be a single token/);
});

test('parseArgs and USAGE: --range parsed; trailing --range is an error; USAGE advertises it', () => {
  assert.equal(parseArgs(['2251', '--range', 'main...feat']).range, 'main...feat');
  assert.equal(parseArgs(['2251']).range, null);
  assert.ok(parseArgs(['2251', '--range']).error);
  assert.equal(parseArgs(['2251', '--pr', '3430']).pr, '3430');
  assert.ok(parseArgs(['2251', '--pr']).error);
  assert.ok(parseArgs(['2251', '--pr', 'x']).error);
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  assert.match(USAGE, /\[--range <base>\.\.\.<head>\]/);
  assert.match(USAGE, /\[--pr <n>\]/);
});

test('--pr (#3298 final review): commit-scope-paths resolves over gh pr diff --name-only, no git call', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], prFiles: 'plugin/bin/x.js\n' });
  assert.equal(run(['2251', '--pr', '3430'], deps), 0, out.stderr);
  assert.match(JSON.parse(out.stdout).title, /\(bin\)/);
  assert.equal(out.gitCalls.length, 0);
  const prCalls = out.calls.filter((c) => c[0] === 'pr');
  assert.deepEqual(prCalls, [['pr', 'diff', '3430', '--repo', 'acme/repo', '--name-only']]);
});

test('--pr with no commit-scope-paths never calls gh pr diff', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251', '--pr', '3430'], deps), 0, out.stderr);
  assert.equal(out.calls.filter((c) => c[0] === 'pr').length, 0);
});

test('--pr: a failing gh pr diff exits 3 naming the PR', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], prFiles: new Error('boom') });
  assert.equal(run(['2251', '--pr', '3430'], deps), 3);
  assert.match(out.stderr, /gh pr diff 3430 --name-only failed: .*boom/);
});

test('--range and --pr together is a usage error, exit 1', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251', '--range', 'main...feat', '--pr', '3430'], deps), 1);
  assert.match(out.stderr, /mutually exclusive/);
});

test('commit-scope-paths set with neither --range nor --pr names both flags', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'] });
  assert.equal(run(['2251'], deps), 1);
  assert.match(out.stderr, /neither --range nor --pr/);
  assert.match(out.stderr, /pass --range \{base\}\.\.\.\{head\}/);
});

test('a whitespace-bearing commit-scope policy value exits 1 loudly (never a silent unscoped subject)', () => {
  const { deps, out } = fakeDeps({ commitScope: 'web app' });
  assert.equal(run(['2251'], deps), 1);
  assert.match(out.stderr, /scope must be a single token/);
});

test('--range argv pins -z and --end-of-options', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], changedFiles: 'plugin/bin/x.js\0' });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.deepEqual(out.gitCalls[0], ['diff', '--name-only', '-z', '--end-of-options', 'main...feat']);
});

test('--range must be <base>...<head>: a two-dot range, a bare ref, or a dash-leading value is a usage error', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], changedFiles: 'plugin/bin/x.js\0' });
  assert.equal(run(['2251', '--range', 'main..feat'], deps), 1);
  assert.match(out.stderr, /invalid --range value: main\.\.feat/);
  assert.equal(run(['2251', '--range', 'main'], deps), 1);
  assert.equal(run(['2251', '--range', '-Ofile'], deps), 1);
  assert.equal(out.gitCalls.length, 0);
});

test('a non-ASCII changed path still matches its prefix because -z output is not C-quoted', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['docs/=docs', 'plugin/bin/=bin'], changedFiles: 'docs/café.md\0docs/a b.md\0' });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.match(JSON.parse(out.stdout).title, /\(docs\)/);
});

test('explicit --scope skips path resolution entirely even when commit-scope-paths is set', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], changedFiles: null });
  assert.equal(run(['2251', '--scope', 'api'], deps), 0, out.stderr);
  assert.match(JSON.parse(out.stdout).title, /feat\(api\)/);
  assert.equal(out.gitCalls.length, 0);
  assert.equal(out.calls.filter((c) => c[0] === 'pr').length, 0);
});

test('an empty changed-file list with commit-scope-paths set falls through to commit-scope silently', () => {
  const { deps, out } = fakeDeps({ commitScope: 'plugin', commitScopePaths: ['plugin/bin/=bin'], changedFiles: '' });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.match(JSON.parse(out.stdout).title, /\(plugin\)/);
  assert.equal(out.stderr, '');
});

test('realDeps reads commit-scope and commit-scope-paths from the cwd policy', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-subject-policy-'));
  const prev = process.cwd();
  try {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'));
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'commit-scope: web\ncommit-scope-paths: plugin/bin/=bin, plugin/skills/=skills\n');
    process.chdir(dir);
    try {
      assert.equal(realDeps.readCommitScope(), 'web');
      assert.deepEqual(realDeps.readCommitScopePaths(), ['plugin/bin/=bin', 'plugin/skills/=skills']);
    } finally { process.chdir(prev); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// #3522 — --out-dir: the file-emitting form the worktree-guard-safe merge fences use.
test('AC2.1: --out-dir writes title.txt/body.md/message.txt equal to the JSON values', () => {
  const path = require('node:path');
  const json = fakeDeps();
  assert.equal(run(['2251', '--tag', 'human-approved'], json.deps), 0, json.out.stderr);
  const { title, body } = JSON.parse(json.out.stdout);

  const { deps, out } = fakeDeps();
  assert.equal(run(['2251', '--tag', 'human-approved', '--out-dir', '/x/subj'], deps), 0, out.stderr);
  assert.equal(out.files[path.join('/x/subj', 'title.txt')], title);
  assert.equal(out.files[path.join('/x/subj', 'body.md')], body);
  assert.equal(out.files[path.join('/x/subj', 'message.txt')], title + '\n\n' + body);
  assert.ok(out.dirs.includes('/x/subj'), JSON.stringify(out.dirs));
});

test('AC2.2: --out-dir stdout is the single-quoted title on one line', () => {
  const json = fakeDeps();
  assert.equal(run(['2262'], json.deps), 0, json.out.stderr);
  const { title } = JSON.parse(json.out.stdout);

  const { deps, out } = fakeDeps();
  assert.equal(run(['2262', '--out-dir', '/x/subj'], deps), 0, out.stderr);
  assert.equal(out.stdout, shellQuote(title) + '\n');
  assert.equal(out.stdout.split('\n').length - 1, 1, 'exactly one newline');
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
  assert.equal(out.stdout, "'fix: It'\\''s quoted (#2262)'\n");
});

// The shipped fences paste this stdout line verbatim as `gh pr merge ... -t {title-arg}` — prove it
// through a real sh, not shellQuote against itself: two quotes, a backtick, and a command substitution.
test('AC2.2: --out-dir stdout round-trips through a real sh to the exact JSON title', () => {
  const { spawnSync } = require('node:child_process');
  const json = fakeDeps();
  assert.equal(run(['2267'], json.deps), 0, json.out.stderr);
  const { title } = JSON.parse(json.out.stdout);
  assert.ok(title.includes("It's Bob's `x` $(echo PWNED)"), title);

  const { deps, out } = fakeDeps();
  assert.equal(run(['2267', '--out-dir', '/x/subj'], deps), 0, out.stderr);
  const r = spawnSync('sh', ['-c', 'printf %s ' + out.stdout.trimEnd()], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, title);
});

test('--shell is retired (#3537): an unknown argument, exit 1, nothing composed or written', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251', '--shell'], deps), 1);
  assert.match(out.stderr, /unknown argument: --shell/);
  assert.equal(out.stdout, '');
  assert.equal(out.calls.length, 0);
  assert.equal(parseArgs(['2251']).shell, undefined);
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  assert.doesNotMatch(USAGE, /--shell/);
});

test('--out-dir with no value is a usage error', () => {
  assert.ok(parseArgs(['2251', '--out-dir']).error);
  assert.ok(parseArgs(['2251', '--out-dir', '--tag']).error);
  assert.equal(parseArgs(['2251', '--out-dir', 'd']).outDir, 'd');
  assert.equal(parseArgs(['2251']).outDir, null);
});

test('no files on an uncomposable record', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2290', '--out-dir', '/x/subj'], deps), 1);
  assert.equal(Object.keys(out.files).length, 0);
});

test('write failure exits 3 naming the path', () => {
  const { deps, out } = fakeDeps({ writeError: new Error('EACCES: permission denied') });
  assert.equal(run(['2251', '--out-dir', '/x/subj'], deps), 3);
  assert.match(out.stderr, /compose-subject\.js: could not write .*title\.txt/);
  assert.match(out.stderr, /EACCES/);
  assert.equal(out.stdout, '');
});

test('USAGE advertises --out-dir', () => {
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  assert.match(USAGE, /\[--out-dir <dir>\]/);
});

test('real fs: --out-dir creates the directory and writes the files', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-subject-outdir-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'a', 'b');

  const json = fakeDeps();
  assert.equal(run(['2262'], json.deps), 0, json.out.stderr);
  const { title, body } = JSON.parse(json.out.stdout);

  const { deps, out } = fakeDeps();
  deps.mkdirp = realDeps.mkdirp;
  deps.writeFile = realDeps.writeFile;
  assert.equal(run(['2262', '--out-dir', dir], deps), 0, out.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'title.txt'), 'utf8'), title);
  assert.equal(fs.readFileSync(path.join(dir, 'body.md'), 'utf8'), body);
  assert.equal(fs.readFileSync(path.join(dir, 'message.txt'), 'utf8'), title + '\n\n' + body);
});

// #4199: --keep-open names records the merge must not close. They still compose the subject,
// Type and Release Note; only their body line changes from `Fixes #n` to `Refs #n`.
test('--keep-open: a kept-open record renders Refs #n and no Fixes #n', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2251', '--keep-open', '2251'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Merge-time conventional subject (#2251)');
  assert.equal(parsed.body, 'Makes the merge subject conventional.\n\nRelease-Note: Made merge subjects Conventional Commits shaped.\n\nRefs #2251');
  assert.doesNotMatch(parsed.body, /Fixes #/);
});

test('--keep-open: a bundle mixes one Fixes and one Refs line, Type still aggregated across both', () => {
  const { deps, out } = fakeDeps();
  // 2250 is type:task and the subject record; 2251 is type:feature and kept open: still feat:.
  assert.equal(run(['2250,2251', '--tag', 'auto-merge', '--keep-open', '2251'], deps), 0, out.stderr);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.title, 'feat: Lowest is a task (#2250)');
  assert.ok(parsed.body.endsWith('\n\nFixes #2250\nRefs #2251'), parsed.body);
  assert.match(parsed.body, /Release-Note: Added task overview support\./);
});

test('--keep-open: a number outside the record list, or a malformed value, exits 1 before any gh call', () => {
  const bad = [['2251', '--keep-open', '2252'], ['2251', '--keep-open'], ['2251', '--keep-open', '--tag'],
    ['2251', '--keep-open', ''], ['2251', '--keep-open', '0'], ['2251', '--keep-open', '2251,x']];
  for (const argv of bad) {
    const { deps, out } = fakeDeps();
    assert.equal(run(argv, deps), 1, argv.join(' '));
    assert.equal(out.calls.length, 0, argv.join(' '));
    assert.equal(out.stdout, '');
  }
  const { deps, out } = fakeDeps();
  run(['2251', '--keep-open', '2252,2251'], deps);
  assert.match(out.stderr, /--keep-open names #2252, not in the record list/);
});

test('--keep-open absent: every footer line is Fixes, JSON and --out-dir alike', () => {
  const NO_KEEP_OPEN_BODY = 'Makes the merge subject conventional.\n\n[auto-merge]\n\nRelease-Note: Made merge subjects Conventional Commits shaped.\nRelease-Note: Made reconcile squash-aware.\n\nFixes #2251\nFixes #2252';
  const json = fakeDeps();
  assert.equal(run(['2251,2252', '--tag', 'auto-merge'], json.deps), 0, json.out.stderr);
  assert.equal(json.out.stdout, `${JSON.stringify({ title: 'feat: Merge-time conventional subject (#2251)', body: NO_KEEP_OPEN_BODY })}\n`);
  const files = fakeDeps();
  assert.equal(run(['2251,2252', '--tag', 'auto-merge', '--out-dir', '/x/subj'], files.deps), 0, files.out.stderr);
  assert.equal(files.out.files[require('node:path').join('/x/subj', 'body.md')], NO_KEEP_OPEN_BODY);
  assert.deepEqual(parseArgs(['2251']).keepOpen, []);
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  assert.match(USAGE, /\[--keep-open <n>\[,<m>\.\.\.\]\]/);
});

test('exit 1: a Release Note hidden by an unclosed fence is named as the fence, not as missing (#4350)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2280'], deps), 1);
  assert.equal(out.stderr, 'compose-subject.js: record(s) #2280 (unclosed-fence at line 5) hide their "## Release Note" section behind an unclosed code fence — close the fence\n');
  assert.equal(out.stdout, '');
});

test('exit 1: a Breaking Change hidden by an unclosed fence is named as the fence (#4350)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2281'], deps), 1);
  assert.equal(out.stderr, 'compose-subject.js: breaking is set on #2281 (unclosed-fence at line 5) but an unclosed code fence hides the "## Breaking Change" section — close the fence\n');
  assert.equal(out.stdout, '');
});

test('exit 1: a bundle with both a missing and a hidden Release Note prints both lines, missing first (#4350)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2280,2290'], deps), 1);
  assert.equal(out.stderr,
    'compose-subject.js: record(s) #2290 carry no non-empty "## Release Note" section\n'
    + 'compose-subject.js: record(s) #2280 (unclosed-fence at line 5) hide their "## Release Note" section behind an unclosed code fence — close the fence\n');
  assert.equal(out.stdout, '');
});

test('exit 1: an unclosed fence with no Release Note heading behind it keeps the missing-section message (#4350)', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['2282'], deps), 1);
  assert.match(out.stderr, /record\(s\) #2282 carry no non-empty "## Release Note" section/);
  assert.doesNotMatch(out.stderr, /unclosed-fence/);
});

// ---- Script-entry pins (#5386): the CLI run as a real script, committed before the entry split. ----
const { spawnCli } = require('../helpers/run-cli');
const { STUB_SKIP } = require('../helpers/path-stub');

const CLI_PATH = require('node:path').join(__dirname, '..', '..', 'plugin', 'bin', 'compose-subject.js');
const STUB_ISSUE = {
  number: 7,
  title: 'Fix the widget',
  body: '## Overview\n\nFixes the widget.\n\n## Release Note\n\nThe widget works.\n',
  labels: [{ name: 'type:bug' }],
  issueType: null,
};
// The four git variables that would point a child at the test runner's own repository.
const GIT_REPO_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

// A `gh` stub that answers exactly the calls compose-subject's success path makes for
// `7 --repo owner/name`: `gh --version` and `gh issue view 7 …`; any other call exits 1.
// -> { dir, env, log, cleanup }; env is process.env minus GIT_*/GH_HOST, with the stub dir first on PATH.
function ghStubFixture() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-subject-ghstub-'));
  const log = path.join(dir, 'gh.log');
  try {
    fs.writeFileSync(path.join(dir, 'issue.json'), JSON.stringify(STUB_ISSUE));
    const script = [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> '${log}'`,
      'if [ "$1" = "--version" ]; then echo "gh version 2.0.0"; exit 0; fi',
      `if [ "$1 $2 $3" = "issue view 7" ]; then cat '${path.join(dir, 'issue.json')}'; exit 0; fi`,
      'echo "stub gh: unexpected call: $*" >&2',
      'exit 1',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'gh'), script);
    fs.chmodSync(path.join(dir, 'gh'), 0o755); // root-safe: exec-bit stub, not a denial simulation
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  const env = { ...process.env, PATH: dir + path.delimiter + (process.env.PATH || '') };
  for (const k of [...GIT_REPO_VARS, 'GH_HOST']) delete env[k];
  return { dir, env, log, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Proves the script entry: a real process composes a subject from a record read through a stub gh on PATH.
test('AC5.1 AC7.1: a record with a Type and a Release Note composes a subject — exit 0, stdout asserted', { skip: STUB_SKIP }, () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const stub = ghStubFixture();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-subject-cwd-'));
  try {
    const res = spawnCli(CLI_PATH, ['7', '--repo', 'owner/name'], { env: stub.env, cwd });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout, `${JSON.stringify({
      title: 'fix: Fix the widget (#7)',
      body: 'Fixes the widget.\n\nRelease-Note: The widget works.\n\nFixes #7',
    })}\n`);
    assert.equal(res.stderr, '');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    stub.cleanup();
  }
});

// Proves the script entry's refusal path: a real process exits non-zero and prints the usage on stderr.
test('AC7.1: --bogus exits 1 with the usage on stderr', () => {
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  const res = spawnCli(CLI_PATH, ['--bogus']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, `unknown argument: --bogus\n${USAGE}`);
});

// ---- Injected cwd and env (#5386): every seam `run` reaches takes them from deps. ----

// process.env minus the variables that would point a git child at the test runner's own repository.
function envWithoutGitRepoVars(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of GIT_REPO_VARS) delete env[k];
  return env;
}


test('AC8.1: run reads commit-scope through deps.cwd()', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], changedFiles: '' });
  const seen = [];
  deps.cwd = () => PHANTOM_CWD;
  deps.env = INJECTED_ENV;
  deps.readCommitScope = (cwd) => { seen.push(['scope', cwd]); return null; };
  deps.readCommitScopePaths = (cwd) => { seen.push(['paths', cwd]); return ['plugin/bin/=bin']; };
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.deepEqual(seen, [['scope', PHANTOM_CWD], ['paths', PHANTOM_CWD]]);
});

test('AC8.1: realDeps.readCommitScope and readCommitScopePaths read the policy under the cwd they are given', (t) => {
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-policy-arg-'));
  t.after(() => nodeFs.rmSync(dir, { recursive: true, force: true }));
  nodeFs.mkdirSync(nodePath.join(dir, '.claude-tweaks'));
  nodeFs.writeFileSync(nodePath.join(dir, '.claude-tweaks', 'policy.yml'), 'commit-scope: web\ncommit-scope-paths: plugin/bin/=bin\n');
  assert.equal(realDeps.readCommitScope(dir), 'web');
  assert.deepEqual(realDeps.readCommitScopePaths(dir), ['plugin/bin/=bin']);
});

test('AC8.1: runner, gitRunner, ghAvailable and the fetchIssueType runner receive the injected cwd and env', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], changedFiles: '' });
  const expected = { cwd: PHANTOM_CWD, env: INJECTED_ENV };
  const seen = { runner: [], gitRunner: [], ghAvailable: [], remoteUrl: [], fetchRunner: [] };
  const viewRunner = deps.runner;
  let first = true;
  deps.cwd = () => PHANTOM_CWD;
  deps.env = INJECTED_ENV;
  deps.ghAvailable = (o) => { seen.ghAvailable.push(o); return true; };
  deps.remoteUrl = (o) => { seen.remoteUrl.push(o); return 'git@github.com:acme/repo.git'; };
  deps.gitRunner = (args, o) => { seen.gitRunner.push(o); return ''; };
  // The first view is rejected for the issueType field so the GraphQL fallback runs and receives its runner.
  deps.runner = (args, o) => {
    seen.runner.push(o);
    if (first) { first = false; throw new Error('Unknown JSON field: "issueType"'); }
    return args[0] === 'api' ? '{}' : viewRunner(args);
  };
  deps.fetchIssueType = (runner) => { runner(['api', 'graphql']); return { name: 'Bug' }; };
  deps.readCommitScopePaths = () => ['plugin/bin/=bin'];
  assert.equal(run(['2263', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.match(out.stdout, /^\{"title":"fix: /);
  // runner: the failed view, its retry, and the call the fetchIssueType runner made.
  assert.equal(seen.runner.length, 3);
  // Each seam also gets the injected home directory and stderr, for the gh host and hosts.yml lookups.
  const ctxOf = (o) => ({ cwd: o.cwd, env: o.env });
  for (const o of [...seen.runner, ...seen.gitRunner, ...seen.ghAvailable, ...seen.remoteUrl]) {
    assert.deepEqual(ctxOf(o), expected);
    assert.equal(o.homeDir(), PHANTOM_HOME);
    assert.equal(o.stderr, deps.stderr);
  }
  assert.equal(seen.gitRunner.length, 1);
  assert.equal(seen.ghAvailable.length, 1);
  assert.equal(seen.remoteUrl.length, 1);
});

test('AC8.1: pinGhHost receives the injected cwd and env for an explicit --repo', () => {
  const { deps, out } = fakeDeps();
  const seen = [];
  deps.cwd = () => PHANTOM_CWD;
  deps.env = INJECTED_ENV;
  deps.pinGhHost = (spec, o) => { seen.push([spec.owner, spec.repo, o]); };
  assert.equal(run(['2251', '--repo', 'owner/name'], deps), 0, out.stderr);
  assert.equal(seen.length, 1);
  const [owner, name, o] = seen[0];
  assert.deepEqual([owner, name, o.cwd, o.env, o.homeDir(), o.stderr], ['owner', 'name', PHANTOM_CWD, INJECTED_ENV, PHANTOM_HOME, deps.stderr]);
});

test('AC8.1: the origin gate reads an exported GH_HOST from the injected env', () => {
  const origin = 'https://git.corp.example/owner/name.git';
  const admitted = fakeDeps({ remoteUrl: () => origin });
  admitted.deps.cwd = () => PHANTOM_CWD;
  admitted.deps.env = { ...INJECTED_ENV, GH_HOST: 'git.corp.example' };
  assert.equal(run(['2251'], admitted.deps), 0, admitted.out.stderr);
  assert.ok(admitted.out.calls[0].includes('git.corp.example/owner/name'), admitted.out.calls[0].join(' '));

  const refused = fakeDeps({ remoteUrl: () => origin });
  refused.deps.cwd = () => PHANTOM_CWD;
  refused.deps.env = INJECTED_ENV;
  assert.equal(run(['2251'], refused.deps), 2);
  assert.match(refused.out.stderr, /is not a known GitHub host/);
});

test('AC8.1: the injected homeDir stays lazy — an exported GH_HOST never reaches it', () => {
  const origin = 'https://git.corp.example/owner/name.git';
  const boom = () => { throw new Error('homeDir() must not run when GH_HOST decides the lookup'); };
  const env = { ...INJECTED_ENV, GH_HOST: 'git.corp.example' };
  // The origin gate, with and without a caller-supplied gateDeps overlay.
  for (const gateDeps of [undefined, { remoteUrl: () => origin }]) {
    const { deps, out } = fakeDeps({ remoteUrl: () => origin });
    Object.assign(deps, { env, homeDir: boom, gateDeps });
    assert.equal(run(['2251'], deps), 0, out.stderr);
  }
  // realDeps.pinGhHost for an explicit --repo: the exported GH_HOST wins before the home is read.
  const { _resetGhHostCache } = require('../../plugin/bin/lib/repo-resolve.js');
  _resetGhHostCache();
  assert.equal(realDeps.pinGhHost({ host: 'git.corp.example', owner: 'owner', repo: 'name' }, { cwd: PHANTOM_CWD, env, homeDir: boom, stderr: () => {} }), null);
  _resetGhHostCache();
});

test('AC8.1: the origin read follows deps.cwd()', (t) => {
  const repo = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-origin-')));
  t.after(() => nodeFs.rmSync(repo, { recursive: true, force: true }));
  const setupEnv = envWithoutGitRepoVars();
  execFileSync('git', ['init', '-q'], { cwd: repo, env: setupEnv, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/fixture/repo.git'], { cwd: repo, env: setupEnv, stdio: 'ignore', windowsHide: true });
  // Real remoteUrl (not faked): only the injected cwd points it at the fixture repository.
  const { deps, out } = fakeDeps({ remoteUrl: realDeps.remoteUrl });
  deps.cwd = () => repo;
  deps.env = envWithoutGitRepoVars();
  assert.equal(run(['2251'], deps), 0, out.stderr);
  assert.ok(out.calls[0].includes('fixture/repo'), out.calls[0].join(' '));
});

test('AC8.1: a relative --out-dir lands under deps.cwd(), not the process cwd', () => {
  const { deps, out } = fakeDeps();
  deps.cwd = () => PHANTOM_CWD;
  deps.env = INJECTED_ENV;
  assert.equal(run(['2251', '--out-dir', nodePath.join('rel', 'out')], deps), 0, out.stderr);
  const resolvedDir = PHANTOM_CWD + nodePath.sep + nodePath.join('rel', 'out');
  assert.deepEqual(out.dirs, [resolvedDir]);
  assert.deepEqual(Object.keys(out.files), ['title.txt', 'body.md', 'message.txt'].map((f) => nodePath.join(resolvedDir, f)));
});

test('AC8.1: a failed write under a relative --out-dir names the path as typed, not the resolved one', () => {
  const typed = nodePath.join('rel', 'out');
  const resolvedFile = nodePath.join(PHANTOM_CWD + nodePath.sep + typed, 'title.txt');
  const { deps, out } = fakeDeps();
  deps.cwd = () => PHANTOM_CWD;
  deps.env = INJECTED_ENV;
  deps.writeFile = (p) => { throw new Error(`EACCES: permission denied, open '${p}'`); };
  assert.equal(run(['2251', '--out-dir', typed], deps), 3);
  const typedFile = nodePath.join(typed, 'title.txt');
  assert.equal(out.stderr, `compose-subject.js: could not write ${typedFile}: EACCES: permission denied, open '${typedFile}'\n`);
  assert.ok(!out.stderr.includes(resolvedFile));
});

test('AC8.1: an absolute --out-dir is handed to fs unchanged even with a deps.cwd()', () => {
  const abs = nodePath.join(nodeOs.tmpdir(), 'compose-subject-abs-out');
  const { deps, out } = fakeDeps();
  deps.cwd = () => PHANTOM_CWD;
  deps.env = INJECTED_ENV;
  assert.equal(run(['2251', '--out-dir', abs], deps), 0, out.stderr);
  assert.deepEqual(out.dirs, [abs]);
});

// A deleted working directory: process.cwd() throws ENOENT. `--repo --scope` and an absolute --out-dir
// need no cwd, so the compose still exits 0, as it did before #5386 took cwd from deps. pinGhHost is
// left out, as in fakeDeps: its real host lookup is not what this pins.
test('--repo --scope with an absolute --out-dir composes when deps.cwd() throws (deleted cwd)', () => {
  const { runCliSync } = require('../helpers/run-cli');
  const abs = nodePath.join(nodeOs.tmpdir(), 'compose-subject-deleted-cwd-out');
  const deletedCwd = () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); };
  const { deps, out } = fakeDeps();
  delete deps.stdout; // the helper's own collectors capture stdout and stderr
  delete deps.stderr;
  const res = runCliSync(CLI_PATH, ['2251', '--repo', 'o/r', '--scope', 'x', '--out-dir', abs], {
    deps: { ...deps, cwd: deletedCwd, pinGhHost: undefined },
  });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(res.stdout, "'feat(x): Merge-time conventional subject (#2251)'\n");
  assert.deepEqual(out.dirs, [abs]);
  assert.deepEqual(Object.keys(out.files), ['title.txt', 'body.md', 'message.txt'].map((f) => nodePath.join(abs, f)));
});

// The real children, not faked seams: each gets the injected values from an env-only or cwd-only fixture.
test('AC8.1: realDeps.ghAvailable looks `gh` up on the injected PATH', { skip: STUB_SKIP }, (t) => {
  const withGh = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-gh-present-'));
  const withoutGh = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-gh-absent-'));
  t.after(() => { nodeFs.rmSync(withGh, { recursive: true, force: true }); nodeFs.rmSync(withoutGh, { recursive: true, force: true }); });
  nodeFs.writeFileSync(nodePath.join(withGh, 'gh'), '#!/bin/sh\necho "gh version 2.0.0"\n');
  nodeFs.chmodSync(nodePath.join(withGh, 'gh'), 0o755); // root-safe: exec-bit stub, not a denial simulation
  assert.equal(realDeps.ghAvailable({ cwd: withGh, env: { PATH: withGh } }), true);
  // An empty PATH directory: a real `gh` elsewhere on the machine must not answer.
  assert.equal(realDeps.ghAvailable({ cwd: withoutGh, env: { PATH: withoutGh } }), false);
});

test('AC8.1: realDeps.runner starts gh in the injected cwd with the injected env', { skip: STUB_SKIP }, (t) => {
  const stubDir = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-runner-stub-')));
  const cwd = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-runner-cwd-')));
  t.after(() => { nodeFs.rmSync(stubDir, { recursive: true, force: true }); nodeFs.rmSync(cwd, { recursive: true, force: true }); });
  nodeFs.writeFileSync(nodePath.join(stubDir, 'gh'), '#!/bin/sh\nprintf "cwd=%s marker=%s" "$(pwd -P)" "$COMPOSE_SUBJECT_MARKER"\n');
  nodeFs.chmodSync(nodePath.join(stubDir, 'gh'), 0o755); // root-safe: exec-bit stub, not a denial simulation
  const env = envWithoutGitRepoVars({ PATH: stubDir + nodePath.delimiter + (process.env.PATH || ''), COMPOSE_SUBJECT_MARKER: 'from-injected-env' });
  delete env.GH_HOST;
  assert.equal(realDeps.runner(['version-probe'], { cwd, env }), `cwd=${cwd} marker=from-injected-env`);
});

test('AC8.1: realDeps.gitRunner starts git in the injected cwd with the injected env', (t) => {
  const repo = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-gitrunner-')));
  t.after(() => nodeFs.rmSync(repo, { recursive: true, force: true }));
  const env = envWithoutGitRepoVars({ GIT_AUTHOR_NAME: 'Env Proof', GIT_AUTHOR_EMAIL: 'env-proof@example.invalid' });
  execFileSync('git', ['init', '-q'], { cwd: repo, env, stdio: 'ignore', windowsHide: true });
  // git prints the toplevel with forward slashes on Windows; path.resolve gives the native spelling.
  assert.equal(nodePath.resolve(realDeps.gitRunner(['rev-parse', '--show-toplevel'], { cwd: repo, env }).trim()), repo);
  assert.match(realDeps.gitRunner(['var', 'GIT_AUTHOR_IDENT'], { cwd: repo, env }), /^Env Proof <env-proof@example\.invalid> /);
});

test('AC8.1: realDeps.remoteUrl runs git with the injected env', (t) => {
  const repo = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-remote-env-')));
  t.after(() => nodeFs.rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo, env: envWithoutGitRepoVars(), stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/real/repo.git'], { cwd: repo, env: envWithoutGitRepoVars(), stdio: 'ignore', windowsHide: true });
  // Only the injected env (GIT_CONFIG_GLOBAL naming a config file with an insteadOf rewrite) changes the answer.
  const globalConfig = nodePath.join(repo, 'global-gitconfig');
  nodeFs.writeFileSync(globalConfig, '[url "https://github.com/envonly/"]\n\tinsteadOf = https://github.com/real/\n');
  const env = envWithoutGitRepoVars({ GIT_CONFIG_GLOBAL: globalConfig });
  assert.equal(realDeps.remoteUrl({ cwd: repo, env }).trim(), 'https://github.com/envonly/repo.git');
});

test('AC8.1: realDeps.cwd and realDeps.env are the ambient values', () => {
  assert.equal(realDeps.cwd(), process.cwd());
  assert.equal(realDeps.env, process.env);
});

test('AC8.1: realDeps.homeDir is the ambient home', () => {
  assert.equal(realDeps.homeDir(), nodeOs.homedir());
});

// ---- Injected home directory and stderr (#5386): the gh host lookups read them, not the real ones. ----
const GHE_HOST = 'ghe.example.test';
const GHE_ORIGIN = `https://${GHE_HOST}/owner/name.git`;

// A fixture home whose gh hosts.yml names GHE_HOST: an injected homeDir finds it, the real home never does.
function hostsHome(t) {
  const home = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-hosts-home-')));
  t.after(() => nodeFs.rmSync(home, { recursive: true, force: true }));
  nodeFs.mkdirSync(nodePath.join(home, '.config', 'gh'), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(home, '.config', 'gh', 'hosts.yml'), `${GHE_HOST}:\n`);
  return home;
}

// Repo A has no remote; repo B has the GHE origin. `GIT_DIR=<B>/.git` in the injected env only
// makes a child whose cwd is A read B's remote. -> { a, env } with env free of GH_* and, when
// given, a stub directory first on PATH.
function originPair(t, stubDir) {
  const { committedRepo, cleanGitEnv } = require('../helpers/git-fixtures');
  const a = committedRepo({ prefix: 'cs-a-' });
  const b = committedRepo({ prefix: 'cs-b-' });
  t.after(() => { for (const d of [a.dir, b.dir]) nodeFs.rmSync(d, { recursive: true, force: true }); });
  b.git('remote', 'add', 'origin', GHE_ORIGIN);
  const env = { ...cleanGitEnv(), GIT_DIR: nodePath.join(b.dir, '.git') };
  if (stubDir) env.PATH = stubDir + nodePath.delimiter + (process.env.PATH || '');
  for (const k of ['GH_HOST', 'GH_REPO', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME']) delete env[k];
  return { a, b, env };
}

test('AC8.1: the origin gate reads gh hosts.yml from the injected homeDir', (t) => {
  const { deps, out } = fakeDeps({ remoteUrl: () => GHE_ORIGIN });
  const home = hostsHome(t);
  deps.homeDir = () => home;
  assert.equal(run(['2251'], deps), 0, out.stderr);
  assert.ok(out.calls[0].includes(`${GHE_HOST}/owner/name`), out.calls[0].join(' '));
  // Without that home the same origin is refused, so the admission above came from the injected one.
  const refused = fakeDeps({ remoteUrl: () => GHE_ORIGIN });
  assert.equal(run(['2251'], refused.deps), 2);
});

test('AC8.1: realDeps.runner takes the gh host from the injected env, homeDir and stderr', { skip: STUB_SKIP }, (t) => {
  const { _resetGhHostCache } = require('../../plugin/bin/lib/repo-resolve.js');
  const stubDir = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'compose-subject-hoststub-')));
  t.after(() => nodeFs.rmSync(stubDir, { recursive: true, force: true }));
  nodeFs.writeFileSync(nodePath.join(stubDir, 'gh'), '#!/bin/sh\nprintf %s "$GH_HOST"\n');
  nodeFs.chmodSync(nodePath.join(stubDir, 'gh'), 0o755); // root-safe: exec-bit stub, not a denial simulation
  const { a, env } = originPair(t, stubDir);
  const notes = [];
  _resetGhHostCache();
  t.after(_resetGhHostCache);
  const home = hostsHome(t);
  const out = realDeps.runner(['issue', 'view', '1'], { cwd: a.dir, env, homeDir: () => home, stderr: (s) => notes.push(s) });
  assert.equal(out, GHE_HOST);
  assert.equal(notes.length, 1);
  assert.match(notes[0], new RegExp(GHE_HOST));
});

test('AC8.1: realDeps.pinGhHost reads the origin and hosts.yml from the injected context', (t) => {
  const { _resetGhHostCache } = require('../../plugin/bin/lib/repo-resolve.js');
  const { a, env } = originPair(t);
  const spec = { host: GHE_HOST, owner: 'owner', repo: 'name' };
  t.after(_resetGhHostCache);
  // The origin host is known only through the injected home: explicit --repo on that very host needs no pin.
  _resetGhHostCache();
  const home = hostsHome(t);
  assert.equal(realDeps.pinGhHost(spec, { cwd: a.dir, env, homeDir: () => home, stderr: () => {} }), null);
  // An injected home with no hosts.yml leaves the origin host unknown, so the explicit host is pinned.
  _resetGhHostCache();
  assert.equal(realDeps.pinGhHost(spec, { cwd: a.dir, env, homeDir: () => PHANTOM_HOME, stderr: () => {} }), GHE_HOST);
});

const HK_PR = { number: 5207, title: 'Prune 111 completed execution plans', body: '<!-- tidy-housekeeping-pr -->\nTidy housekeeping.' };

test('AC2.1: --housekeeping --pr {n} --out-dir {d} exits 0 and writes a chore subject and a body with no Release-Note or Fixes line', () => {
  const { deps, out } = fakeDeps({ prView: HK_PR });
  const code = run(['--housekeeping', '--pr', '5207', '--out-dir', '/tmp/hk'], deps);
  assert.equal(code, 0, out.stderr);
  const title = 'chore: Prune 111 completed execution plans (#5207)';
  assert.equal(out.files[nodePath.join(nodePath.resolve(PHANTOM_CWD, '/tmp/hk'), 'title.txt')], title);
  const body = out.files[nodePath.join(nodePath.resolve(PHANTOM_CWD, '/tmp/hk'), 'body.md')];
  assert.equal(body, 'Prune 111 completed execution plans');
  assert.equal(out.stdout, `'${title}'\n`);
  assert.deepEqual(out.calls[0].slice(0, 3), ['pr', 'view', '5207']);
  assert.ok(out.calls[0].includes('acme/repo'));
  assert.ok(!out.calls.some((c) => c[0] === 'issue'), 'no gh issue view in the record-less form');
});

test('AC2.2: --pr {n} with no <n> and no --housekeeping still exits 1 with missing <n> argument', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['--pr', '5207', '--out-dir', '/tmp/hk'], deps), 1);
  assert.match(out.stderr, /^missing <n> argument\n/);
  assert.equal(out.calls.length, 0);
});

test('--housekeeping usage errors: with a record number, --keep-open, --range, or without --pr — exit 1, no gh call', () => {
  for (const argv of [['5207', '--housekeeping', '--pr', '1'], ['--housekeeping', '--pr', '1', '--keep-open', '2'], ['--housekeeping', '--range', 'a...b'], ['--housekeeping']]) {
    const { deps, out } = fakeDeps({ prView: HK_PR });
    assert.equal(run(argv, deps), 1, argv.join(' '));
    assert.equal(out.calls.length, 0, argv.join(' '));
  }
});

test('--housekeeping refuses a PR body with no housekeeping marker (exit 1), accepts the wrap-up-residue-pr marker', () => {
  const plain = fakeDeps({ prView: { ...HK_PR, body: 'Fixes #12' } });
  assert.equal(run(['--housekeeping', '--pr', '5207'], plain.deps), 1);
  assert.match(plain.out.stderr, /no housekeeping marker/);
  const residue = fakeDeps({ prView: { ...HK_PR, body: '<!-- wrap-up-residue-pr -->' } });
  assert.equal(run(['--housekeeping', '--pr', '5207'], residue.deps), 0, residue.out.stderr);
});

test('--housekeeping neutralizes a closing phrase in the PR title', () => {
  const { deps, out } = fakeDeps({ prView: { ...HK_PR, title: 'Prune plans (closes #12)' } });
  assert.equal(run(['--housekeeping', '--pr', '5207'], deps), 0, out.stderr);
  const { title, body } = JSON.parse(out.stdout);
  assert.doesNotMatch(`${title}\n${body}`, /closes #12/);
});

test('--housekeeping: a failed or unparseable gh pr view exits 3', () => {
  assert.equal(run(['--housekeeping', '--pr', '5207'], fakeDeps({ prView: new Error('boom') }).deps), 3);
  const bad = fakeDeps({ prView: HK_PR });
  const runner = bad.deps.runner;
  bad.deps.runner = (args) => (args[1] === 'view' ? 'not json' : runner(args));
  assert.equal(run(['--housekeeping', '--pr', '5207'], bad.deps), 3);
});

test('USAGE advertises --housekeeping', () => {
  assert.match(USAGE, /--housekeeping/);
});
