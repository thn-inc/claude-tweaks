'use strict';
// #4621 Task 2: the pure ownership predicate and filing route for wrap-up's
// upstream feedback. Strings in, verdicts out — no git, no gh, no fs.
const { test } = require('node:test');
const assert = require('node:assert');
const { bookkeepingPermissions } = require('../../../plugin/bin/lib/issues/autonomy');
const { DECISION_FACT_FIELDS, upstreamDecisionFact } = require('../../../plugin/bin/lib/console/decision-facts');
const {
  TARGET_HOST, UPSTREAM_FILING_TARGET, HOLD_REASONS, isValidOwner, parseTargetRepo, ownedOwnersList, isOwnedRepo,
  ownerContextFromOrigin, upstreamFilingRoute, parseStagedUpstream,
} = require('../../../plugin/bin/lib/issues/upstream-ownership');

const ON = bookkeepingPermissions('supervised', { controlMode: true });
const OFF = bookkeepingPermissions('unattended');
const GITHUB_THN = { owner: 'thn-inc', host: 'github.com' };
const route = (targetRepo, ownerContext = GITHUB_THN, ownedOwners = [], permissions = ON) =>
  upstreamFilingRoute({ permissions, targetRepo, ownerContext, ownedOwners });
const owned = (targetRepo, currentRepoOwner = 'thn-inc', ownedOwners = []) =>
  isOwnedRepo({ targetRepo, currentRepoOwner, ownedOwners });

test('constants', () => {
  assert.strictEqual(TARGET_HOST, 'github.com');
  assert.deepStrictEqual(HOLD_REASONS, ['external', 'filing-failed', 'scrub-hit', 'owner-unresolved']);
  assert.strictEqual(ON.ownedUpstreamFiling, true);
  assert.strictEqual(OFF.ownedUpstreamFiling, false);
});

test('AC1.1: a target under the current repo owner is owned', () => {
  assert.strictEqual(owned('thn-inc/claude-tweaks'), true);
});

test('AC1.2: a target under another owner is not owned', () => {
  assert.strictEqual(owned('obra/superpowers'), false);
});

test('AC2.1: an owned-owners entry makes its repos owned', () => {
  assert.strictEqual(owned('obra/superpowers', 'thn-inc', ['obra']), true);
});

test('AC2.2: an owned-owners entry matches its owner only, never a prefix', () => {
  assert.strictEqual(owned('obra-fork/x', 'thn-inc', ['obra']), false);
});

test('AC3.1: the comparison is case-insensitive and exact', () => {
  assert.strictEqual(owned('THN-INC/claude-tweaks', 'thn-inc'), true);
  assert.strictEqual(owned('thn-inc/claude-tweaks', 'THN-INC'), true);
  assert.strictEqual(owned('thn-inc-evil/x', 'thn-inc'), false);
  assert.strictEqual(owned('THN-INC.evil/x', 'thn-inc'), false);
});

test('AC3.2: a target that is not a bare owner/name is never owned', () => {
  const bad = [
    'thn-inc', 'thn-inc/', '/claude-tweaks', 'thn-inc/../x', 'thn-inc/..', 'thn-inc/.',
    'thn-inc%2Fx/y', 'HTTPS://github.com/thn-inc/x', ' thn-inc/claude-tweaks',
    'thn-inc/claude-tweaks ', 'thn-inc/claude-tweaks\n',
  ];
  for (const target of bad) {
    assert.strictEqual(parseTargetRepo(target), null, JSON.stringify(target));
    assert.strictEqual(owned(target, 'thn-inc', ['thn-inc']), false, JSON.stringify(target));
  }
  assert.deepStrictEqual(parseTargetRepo('thn-inc/claude-tweaks'), { owner: 'thn-inc', name: 'claude-tweaks' });
  assert.deepStrictEqual(parseTargetRepo('a/.x'), { owner: 'a', name: '.x' });
  assert.strictEqual(parseTargetRepo(null), null);
  assert.strictEqual(parseTargetRepo(42), null);
});

test('AC7.1: an unusable owner context is never owned and holds the item', () => {
  for (const currentRepoOwner of ['', null, 'thn_inc']) {
    assert.strictEqual(owned('thn-inc/x', currentRepoOwner), false, String(currentRepoOwner));
  }
  assert.deepStrictEqual(route('thn-inc/claude-tweaks', null),
    { route: 'hold', reason: 'owner-unresolved', targetRepo: 'thn-inc/claude-tweaks' });
  assert.deepStrictEqual(route('thn-inc/claude-tweaks', { owner: 'thn-inc', host: 'acme.ghe.com' }),
    { route: 'hold', reason: 'external', targetRepo: 'thn-inc/claude-tweaks' });
  const gitlab = ownerContextFromOrigin('https://gitlab.com/thn-inc/x.git');
  assert.deepStrictEqual(gitlab, { owner: 'thn-inc', host: 'gitlab.com' });
  assert.deepStrictEqual(route('thn-inc/x', gitlab), { route: 'hold', reason: 'external', targetRepo: 'thn-inc/x' });
  // Review Focus 2: a cloud-sandbox proxy origin resolves no owner.
  const proxy = ownerContextFromOrigin('http://local_proxy@127.0.0.1:43123/git/thn-inc/claude-tweaks');
  assert.strictEqual(proxy, null);
  assert.deepStrictEqual(route('thn-inc/claude-tweaks', proxy),
    { route: 'hold', reason: 'owner-unresolved', targetRepo: 'thn-inc/claude-tweaks' });
});

test('AC7.2: a malformed owned-owners value owns nothing and reports what it ignored', () => {
  const notAList = { a: 1 };
  for (const ownedOwners of [[42], [''], ['obra_x'], notAList]) {
    assert.strictEqual(owned('obra/superpowers', 'thn-inc', ownedOwners), false, JSON.stringify(ownedOwners));
    assert.ok(ownedOwnersList(ownedOwners).ignored.length > 0, JSON.stringify(ownedOwners));
  }
  assert.deepStrictEqual(ownedOwnersList([42]), { owners: [], ignored: ['42'] });
  assert.deepStrictEqual(ownedOwnersList(['']), { owners: [], ignored: [''] });
  assert.deepStrictEqual(ownedOwnersList(notAList), { owners: [], ignored: ['(owned-owners is not a list)'] });
  assert.deepStrictEqual(ownedOwnersList(undefined), { owners: [], ignored: ['(owned-owners is not a list)'] });
  assert.strictEqual(owned('thn-inc/x', 'thn-inc', []), true);
  assert.deepStrictEqual(ownedOwnersList('obra, acme'), { owners: ['obra', 'acme'], ignored: [] });
  assert.strictEqual(owned('acme/y', 'thn-inc', 'obra, acme'), true);
  // The resolver's raw set value: case kept in the list, compared case-insensitively.
  assert.deepStrictEqual(ownedOwnersList('Thn-Inc,acme'), { owners: ['Thn-Inc', 'acme'], ignored: [] });
  assert.strictEqual(owned('thn-inc/x', null, 'Thn-Inc,acme'), true);
  // Only whitespace around commas is trimmed; empties drop; an array element is taken as is.
  assert.deepStrictEqual(ownedOwnersList('obra ,, acme,'), { owners: ['obra', 'acme'], ignored: [] });
  assert.deepStrictEqual(ownedOwnersList([' thn-inc']), { owners: [], ignored: [' thn-inc'] });
  assert.deepStrictEqual(ownedOwnersList(['obra', 'obra_x']), { owners: ['obra'], ignored: ['obra_x'] });
});

test('AC10.1: an owner outside the grammar never matches, in any input slot', () => {
  const bad = ['thn-іnc', 'thn-inc\n', 'thn-inc\u0000', 'thn-inc.', 'a'.repeat(40), 'thn_inc', 'thn-inc/x'];
  for (const value of bad) {
    const label = JSON.stringify(value);
    assert.strictEqual(isValidOwner(value), false, label);
    // target owner slot: every other slot carries the same string and the canonical owner
    assert.strictEqual(owned(`${value}/x`, value, [value, 'thn-inc']), false, `target ${label}`);
    // currentRepoOwner slot
    assert.strictEqual(owned('thn-inc/x', value, []), false, `currentRepoOwner ${label}`);
    // ownedOwners entry slot, as an array element and as the comma string
    assert.strictEqual(owned('thn-inc/x', null, [value]), false, `ownedOwners ${label}`);
    assert.strictEqual(owned('thn-inc/x', null, value), false, `ownedOwners string ${label}`);
    assert.deepStrictEqual(ownedOwnersList([value]), { owners: [], ignored: [value] }, label);
  }
  const max = 'a'.repeat(39);
  assert.strictEqual(isValidOwner(max), true);
  assert.strictEqual(owned(`${max}/x`, max), true);
  assert.strictEqual(owned(`${max}/x`, null, [max]), true);
  assert.strictEqual(isValidOwner(null), false);
  assert.strictEqual(isValidOwner(''), false);
});

test('the repo-name bound is 100 characters: 100 parses, 101 never does', () => {
  assert.deepStrictEqual(parseTargetRepo(`thn-inc/${'n'.repeat(100)}`), { owner: 'thn-inc', name: 'n'.repeat(100) });
  assert.strictEqual(parseTargetRepo(`thn-inc/${'n'.repeat(101)}`), null);
  assert.strictEqual(owned(`thn-inc/${'n'.repeat(101)}`), false);
  assert.strictEqual(owned(`thn-inc/${'n'.repeat(100)}`), true);
});

test('origin parsing: the AC3 origin shapes, an enterprise host and a fork', () => {
  for (const origin of [
    'git@github.com:thn-inc/claude-tweaks.git',
    'https://github.com/thn-inc/claude-tweaks',
    'https://github.com/thn-inc/claude-tweaks.git',
  ]) {
    const ctx = ownerContextFromOrigin(origin);
    assert.deepStrictEqual(ctx, { owner: 'thn-inc', host: 'github.com' }, origin);
    assert.deepStrictEqual(route('thn-inc/claude-tweaks', ctx),
      { route: 'file', reason: null, targetRepo: 'thn-inc/claude-tweaks' }, origin);
  }
  const ghe = ownerContextFromOrigin('https://ghe.acme.com/thn-inc/x');
  assert.deepStrictEqual(ghe, { owner: 'thn-inc', host: 'ghe.acme.com' });
  assert.deepStrictEqual(route('thn-inc/x', ghe), { route: 'hold', reason: 'external', targetRepo: 'thn-inc/x' });
  const fork = ownerContextFromOrigin('git@github.com:someone/claude-tweaks.git');
  assert.deepStrictEqual(route('thn-inc/claude-tweaks', fork),
    { route: 'hold', reason: 'external', targetRepo: 'thn-inc/claude-tweaks' });
  // An origin owner outside the grammar, or no origin at all, resolves no owner.
  assert.strictEqual(ownerContextFromOrigin('https://github.com/thn_inc/x'), null);
  assert.strictEqual(ownerContextFromOrigin(''), null);
  assert.strictEqual(ownerContextFromOrigin(null), null);
});

test('route: control mode off leaves the item unchanged; on files an owned target and holds the rest', () => {
  // AC6.1 at the unit level: off is unchanged even for an owned target.
  assert.deepStrictEqual(route('thn-inc/claude-tweaks', GITHUB_THN, [], { ownedUpstreamFiling: false }),
    { route: 'unchanged', reason: null, targetRepo: 'thn-inc/claude-tweaks' });
  assert.deepStrictEqual(route('thn-inc/claude-tweaks', GITHUB_THN, [], OFF),
    { route: 'unchanged', reason: null, targetRepo: 'thn-inc/claude-tweaks' });
  assert.deepStrictEqual(upstreamFilingRoute({ targetRepo: 'thn-inc/claude-tweaks', ownerContext: GITHUB_THN, ownedOwners: [] }),
    { route: 'unchanged', reason: null, targetRepo: 'thn-inc/claude-tweaks' });
  assert.deepStrictEqual(route('thn-inc/claude-tweaks'),
    { route: 'file', reason: null, targetRepo: 'thn-inc/claude-tweaks' });
  assert.deepStrictEqual(route('obra/superpowers', GITHUB_THN, ['obra']),
    { route: 'file', reason: null, targetRepo: 'obra/superpowers' });
  assert.deepStrictEqual(route('obra/superpowers'),
    { route: 'hold', reason: 'external', targetRepo: 'obra/superpowers' });
  // A missing or unparseable target is external, ahead of the owner context: the previous
  // release's staged file (no target line) holds as external even where no owner resolves.
  assert.deepStrictEqual(route(null, null), { route: 'hold', reason: 'external', targetRepo: null });
  assert.deepStrictEqual(route('thn-inc', null), { route: 'hold', reason: 'external', targetRepo: 'thn-inc' });
  assert.deepStrictEqual(route(42), { route: 'hold', reason: 'external', targetRepo: null });
});

test('filingTarget: a draft header off the repo /claude-tweaks:feedback files into holds as external, even where its owner is owned', () => {
  const pinned = (targetRepo, over = {}) => upstreamFilingRoute({
    permissions: ON, targetRepo, ownerContext: GITHUB_THN, ownedOwners: ['obra'], filingTarget: UPSTREAM_FILING_TARGET, ...over,
  });
  // The origin owner (thn-inc) and an owned-owners entry (obra) both own these, but the issue would not land there.
  assert.deepStrictEqual(pinned('thn-inc/other'), { route: 'hold', reason: 'external', targetRepo: 'thn-inc/other' });
  assert.deepStrictEqual(pinned('obra/superpowers'), { route: 'hold', reason: 'external', targetRepo: 'obra/superpowers' });
  // The pinned repo itself files, whatever the case of the header.
  assert.deepStrictEqual(pinned('thn-inc/claude-tweaks'), { route: 'file', reason: null, targetRepo: 'thn-inc/claude-tweaks' });
  assert.strictEqual(pinned('THN-INC/Claude-Tweaks').route, 'file');
  // The pin is judged ahead of the owner context: an unresolved owner does not turn an off-target header into owner-unresolved.
  assert.strictEqual(pinned('obra/superpowers', { ownerContext: null }).reason, 'external');
  assert.strictEqual(pinned('thn-inc/claude-tweaks', { ownerContext: null }).reason, 'owner-unresolved');
  // A pinned target that is owned only through owned-owners files from a foreign-owner checkout.
  assert.strictEqual(pinned('thn-inc/claude-tweaks', { ownerContext: { owner: 'zeta', host: 'github.com' }, ownedOwners: [] }).reason, 'external');
  assert.strictEqual(pinned('thn-inc/claude-tweaks', { ownerContext: { owner: 'zeta', host: 'github.com' }, ownedOwners: ['thn-inc'] }).route, 'file');
  // No pin: a caller that already knows where the issue landed (--filed) is judged on that repo as it stands.
  assert.strictEqual(route('obra/superpowers', GITHUB_THN, ['obra']).route, 'file');
  // Control mode off stays unchanged under a pin, ahead of everything else.
  assert.strictEqual(pinned('obra/superpowers', { permissions: OFF }).route, 'unchanged');
});

test('parseStagedUpstream: headers, CRLF, ambiguity and the body', () => {
  // Review Focus 4: a CRLF staged file.
  const crlf = '<!-- upstream-target: thn-inc/claude-tweaks -->\r\nTitle: Fix the router\r\n\r\nBody line one\r\nline two\r\n';
  assert.deepStrictEqual(parseStagedUpstream(crlf),
    { targetRepo: 'thn-inc/claude-tweaks', title: 'Fix the router', body: 'Body line one\nline two\n' });
  const lf = '<!-- upstream-target: obra/superpowers -->\nTitle: A title\n\nThe body.\n\nSecond paragraph.';
  assert.deepStrictEqual(parseStagedUpstream(lf),
    { targetRepo: 'obra/superpowers', title: 'A title', body: 'The body.\n\nSecond paragraph.' });
  // Review Focus 5: two target lines naming different repos are ambiguous.
  const twoTargets = '<!-- upstream-target: thn-inc/claude-tweaks -->\nTitle: T\n\nbody\n<!-- upstream-target: obra/superpowers -->\n';
  const ambiguous = parseStagedUpstream(twoTargets);
  assert.strictEqual(ambiguous.targetRepo, null);
  assert.strictEqual(ambiguous.title, 'T');
  assert.strictEqual(ambiguous.body, 'body\n<!-- upstream-target: obra/superpowers -->\n');
  // The same value on two lines is not ambiguous.
  assert.strictEqual(parseStagedUpstream('<!-- upstream-target: a/b -->\n<!-- upstream-target: a/b -->\n').targetRepo, 'a/b');
  assert.strictEqual(parseStagedUpstream('Title: one\nTitle: two\n').title, null);
  // No header line: both fields null and the body is the whole text.
  assert.deepStrictEqual(parseStagedUpstream('Just a body.\nMore.'), { targetRepo: null, title: null, body: 'Just a body.\nMore.' });
  // The inner text is taken exactly, untrimmed.
  assert.strictEqual(parseStagedUpstream('<!-- upstream-target:  thn-inc/x -->').targetRepo, ' thn-inc/x');
  // The body never carries either header line.
  const parsed = parseStagedUpstream(lf);
  assert.ok(!parsed.body.includes('upstream-target'));
  assert.ok(!parsed.body.includes('Title: '));
  assert.deepStrictEqual(parseStagedUpstream(undefined), { targetRepo: null, title: null, body: '' });
});

test('parseStagedUpstream: a Title-looking line after the header block is body text', () => {
  const text = '<!-- upstream-target: thn-inc/x -->\nTitle: Real title\n\nIntro\nTitle: something else\n\nmore';
  assert.deepStrictEqual(parseStagedUpstream(text),
    { targetRepo: 'thn-inc/x', title: 'Real title', body: 'Intro\nTitle: something else\n\nmore' });
});

test('parseStagedUpstream: a later differing target marker nulls the target and stays in the body', () => {
  const text = '<!-- upstream-target: a/b -->\nTitle: T\n\nsee\n<!-- upstream-target: c/d -->\nend';
  assert.deepStrictEqual(parseStagedUpstream(text),
    { targetRepo: null, title: 'T', body: 'see\n<!-- upstream-target: c/d -->\nend' });
});

test('parseStagedUpstream: a later marker with the block\'s own value keeps the target and stays in the body', () => {
  const text = '<!-- upstream-target: a/b -->\nTitle: T\n\nquoted:\n<!-- upstream-target: a/b -->';
  assert.deepStrictEqual(parseStagedUpstream(text),
    { targetRepo: 'a/b', title: 'T', body: 'quoted:\n<!-- upstream-target: a/b -->' });
  // A marker in the body never supplies a target the block lacks.
  assert.strictEqual(parseStagedUpstream('Title: T\n\nbody\n<!-- upstream-target: a/b -->').targetRepo, null);
});

test('parseStagedUpstream: the header block is leading blank lines, then consecutive header lines', () => {
  // Leading blank lines belong to the block; the first blank after a header ends it and is dropped,
  // so a header after that blank is body text.
  assert.deepStrictEqual(parseStagedUpstream('\n<!-- upstream-target: a/b -->\n\nTitle: T\n\nbody'),
    { targetRepo: 'a/b', title: null, body: 'Title: T\n\nbody' });
  assert.deepStrictEqual(parseStagedUpstream('\n\n<!-- upstream-target: a/b -->\nTitle: T\n\nbody'),
    { targetRepo: 'a/b', title: 'T', body: 'body' });
  // Only one blank line after the block is dropped.
  assert.deepStrictEqual(parseStagedUpstream('<!-- upstream-target: a/b -->\nTitle: T\n\n\npara'),
    { targetRepo: 'a/b', title: 'T', body: '\npara' });
  // Inside the block a header twice with different values reads null; the other field is kept.
  assert.deepStrictEqual(parseStagedUpstream('<!-- upstream-target: a/b -->\nTitle: one\nTitle: two\n\nbody'),
    { targetRepo: 'a/b', title: null, body: 'body' });
});

test('parseStagedUpstream: a Title-shaped first body line after the blank separator is body text', () => {
  assert.deepStrictEqual(parseStagedUpstream('<!-- upstream-target: a/b -->\nTitle: Real\n\nTitle: quoted first body line\nmore'),
    { targetRepo: 'a/b', title: 'Real', body: 'Title: quoted first body line\nmore' });
});

test('parseStagedUpstream: a target-marker first body line after the blank separator is body text', () => {
  assert.deepStrictEqual(parseStagedUpstream('<!-- upstream-target: a/b -->\nTitle: Real\n\n<!-- upstream-target: a/b -->\nmore'),
    { targetRepo: 'a/b', title: 'Real', body: '<!-- upstream-target: a/b -->\nmore' });
});

test('parseStagedUpstream: a Causal tag after the header block is body text; before the header it hides the header', () => {
  const after = '<!-- upstream-target: thn-inc/x -->\nTitle: T\n\n**Causal:** systemic\nThe draft.';
  assert.deepStrictEqual(parseStagedUpstream(after), { targetRepo: 'thn-inc/x', title: 'T', body: '**Causal:** systemic\nThe draft.' });
  // Prepended ahead of the header, the tag is the first non-blank line, so no header block is read and the item holds.
  const before = '**Causal:** systemic\n<!-- upstream-target: thn-inc/x -->\nTitle: T\n\nThe draft.';
  assert.deepStrictEqual(parseStagedUpstream(before), { targetRepo: null, title: null, body: before });
});

test('ownedOwnersList: an element with no string form is ignored, never thrown on', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.deepStrictEqual(ownedOwnersList([Object.create(null), proxy, 'obra']),
    { owners: ['obra'], ignored: ['[object Object]', '(unprintable)'] });
});

test('AC4.2: a held item becomes one packet decision fact', () => {
  const runDir = '/repo/.claude-tweaks/pipelines/2026-11-16T10-00-00Z-upstream';
  const body = 'The router\n\nskips   the\tsecond step when X.';
  const fact = upstreamDecisionFact({
    id: 'wrap-up-upstream-1.md', targetRepo: 'obra/superpowers', title: 'Router skips a step',
    body, reason: 'external', detail: null, runDir, staged: true,
  });
  assert.strictEqual(fact.id, 'decision:upstream:wrap-up-upstream-1.md');
  assert.strictEqual(fact.kind, 'decision');
  assert.strictEqual(fact.origin, 'upstream');
  assert.ok(fact.evidenceRef.endsWith('/staged/wrap-up-upstream-1.md'), fact.evidenceRef);
  assert.strictEqual(fact.evidenceRef, '.claude-tweaks/pipelines/2026-11-16T10-00-00Z-upstream/staged/wrap-up-upstream-1.md');
  assert.strictEqual(fact.summary,
    'Upstream feedback wrap-up-upstream-1.md held, not filed (external): target obra/superpowers; draft "Router skips a step"');
  for (const part of ['obra/superpowers', 'Router skips a step', 'external']) assert.ok(fact.summary.includes(part), part);
  for (const word of body.split(/\s+/)) assert.ok(fact.text.includes(word), word);
  assert.strictEqual(fact.text, `${fact.summary} — draft: The router skips the second step when X.`);
  assert.strictEqual(fact.suggestedResolution,
    `file the draft at ${fact.evidenceRef} into obra/superpowers yourself, or decline`);
  const allowed = [...DECISION_FACT_FIELDS, 'text'];
  for (const key of Object.keys(fact)) assert.ok(allowed.includes(key), key);

  const failed = upstreamDecisionFact({
    id: 'wrap-up-upstream-2.md', targetRepo: null, title: null, body: '',
    reason: 'filing-failed', detail: 'gh exited 1:\n  HTTP 404', runDir, staged: true,
  });
  assert.strictEqual(failed.summary,
    'Upstream feedback wrap-up-upstream-2.md held, not filed (filing-failed): target unresolved — gh exited 1: HTTP 404');
  assert.strictEqual(failed.text, failed.summary);
  assert.strictEqual(failed.suggestedResolution,
    `fix the cause, then file the draft at ${failed.evidenceRef} into its upstream repo yourself, or decline`);
  const scrub = upstreamDecisionFact({
    id: 'wrap-up-upstream-3.md', targetRepo: 'thn-inc/x', title: 'T', body: 'b', reason: 'scrub-hit', detail: null, runDir, staged: true,
  });
  assert.ok(scrub.suggestedResolution.startsWith('fix the cause, then file the draft at '));
  const owner = upstreamDecisionFact({
    id: 'wrap-up-upstream-4.md', targetRepo: 'thn-inc/x', title: 'T', body: 'b', reason: 'owner-unresolved', detail: null, runDir, staged: true,
  });
  assert.ok(owner.suggestedResolution.startsWith('file the draft at '));
});

const FACT_RUN_DIR = '/repo/.claude-tweaks/pipelines/2026-11-16T10-00-00Z-upstream';
const factFor = (over) => upstreamDecisionFact({
  id: 'wrap-up-upstream-5.md', targetRepo: 'thn-inc/x', title: 'Leaky title', body: 'leaky body text', reason: 'external', detail: null, runDir: FACT_RUN_DIR, staged: true, ...over,
});

test('a scrub-hit fact carries the draft by evidenceRef only: neither its title nor its body is inline', () => {
  const scrub = factFor({ reason: 'scrub-hit', detail: 'internal path' });
  for (const field of ['summary', 'text', 'suggestedResolution']) {
    assert.ok(!scrub[field].includes('leaky body text'), `${field}: ${scrub[field]}`);
    assert.ok(!scrub[field].includes('Leaky title'), `${field}: ${scrub[field]}`);
  }
  assert.strictEqual(scrub.text, scrub.summary);
  // The scanner's detail names what it matched, so it stays out of the packet with the draft.
  assert.ok(!scrub.summary.includes('internal path'), scrub.summary);
  assert.strictEqual(scrub.summary, 'Upstream feedback wrap-up-upstream-5.md held, not filed (scrub-hit): target thn-inc/x');
  assert.ok(scrub.suggestedResolution.includes(scrub.evidenceRef), scrub.suggestedResolution);
  // Every other reason keeps the draft inline, filing-failed included.
  for (const reason of ['external', 'filing-failed', 'owner-unresolved']) {
    const fact = factFor({ reason });
    assert.ok(fact.summary.includes('draft "Leaky title"'), `${reason}: ${fact.summary}`);
    assert.ok(fact.text.endsWith(' — draft: leaky body text'), `${reason}: ${fact.text}`);
  }
});

test('upstreamDecisionFact refuses a reason outside HOLD_REASONS', () => {
  for (const reason of ['bogus', '', undefined, null, 'External', 'scrub-hit ']) {
    assert.throws(() => factFor({ reason }), RangeError, JSON.stringify(reason));
  }
  for (const reason of HOLD_REASONS) assert.doesNotThrow(() => factFor({ reason }), reason);
});

test('a target outside the owner/name grammar is never echoed into the fact', () => {
  for (const targetRepo of ['x reason none fact y', 'not a repo', 'a/b/c', ' thn-inc/x', 'thn-inc/x\nfact y']) {
    const fact = factFor({ targetRepo });
    assert.ok(fact.summary.includes('target unresolved'), `${JSON.stringify(targetRepo)}: ${fact.summary}`);
    assert.ok(fact.suggestedResolution.endsWith(' into its upstream repo yourself, or decline'), fact.suggestedResolution);
    for (const field of ['summary', 'text', 'suggestedResolution']) assert.ok(!fact[field].includes(targetRepo.trim()), `${field}: ${fact[field]}`);
  }
});
