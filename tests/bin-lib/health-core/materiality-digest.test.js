'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  MATERIALITY_MARKER_PREFIX,
  materialityFingerprint,
  parseMaterialityFingerprints,
  materialityEntryLine,
  isMaterialityDuplicate,
  trustedMaterialityTexts,
  CarryOverInputError,
  digestReplacementMarker,
  selectCarryOverEntries,
  materialityEntryDate,
  isLiveEntryLine,
  planCarryOver,
  classifyRolloverResume,
} = require('../../../plugin/bin/lib/health-core/materiality-digest');

const ENTRY = {
  area: 'tidy',
  finding: 'digest sweep never dedups entries',
  fileRefs: 'plugin/skills/tidy/digest-sweep.md',
  deferReason: 'direct-filing-sweep',
  provenance: '2026-09-01T120000-tidy-standalone',
};

// A `gh --json comments` element shape: body plus camelCase authorAssociation.
const comment = (body, association) => ({ body, authorAssociation: association });

// --- materialityFingerprint: stability and normalization ---

test('materialityFingerprint is deterministic for identical input', () => {
  assert.strictEqual(materialityFingerprint(ENTRY), materialityFingerprint({ ...ENTRY }));
});

test('materialityFingerprint is stable across incidental whitespace/casing differences in finding', () => {
  const a = materialityFingerprint(ENTRY);
  const b = materialityFingerprint({ ...ENTRY, finding: '  Digest   sweep NEVER dedups entries  ' });
  assert.strictEqual(a, b);
});

test('materialityFingerprint is stable across file-ref ordering and whitespace', () => {
  const a = materialityFingerprint({ ...ENTRY, fileRefs: 'a.md, b.md' });
  const b = materialityFingerprint({ ...ENTRY, fileRefs: 'b.md,   a.md' });
  assert.strictEqual(a, b);
});

test('materialityFingerprint differs when area differs', () => {
  const a = materialityFingerprint(ENTRY);
  const b = materialityFingerprint({ ...ENTRY, area: 'review' });
  assert.notStrictEqual(a, b);
});

test('materialityFingerprint differs when finding text differs', () => {
  const a = materialityFingerprint(ENTRY);
  const b = materialityFingerprint({ ...ENTRY, finding: 'a completely different finding' });
  assert.notStrictEqual(a, b);
});

test('materialityFingerprint differs when file refs differ', () => {
  const a = materialityFingerprint(ENTRY);
  const b = materialityFingerprint({ ...ENTRY, fileRefs: 'some/other/file.md' });
  assert.notStrictEqual(a, b);
});

test('materialityFingerprint is prefixed with materiality-', () => {
  assert.match(materialityFingerprint(ENTRY), /^materiality-[0-9a-f]{8}$/);
});

// --- materialityEntryLine / parseMaterialityFingerprints ---

test('materialityEntryLine renders the Entry format line with the dedup marker appended', () => {
  const line = materialityEntryLine(ENTRY);
  assert.ok(line.startsWith('- [tidy] digest sweep never dedups entries — plugin/skills/tidy/digest-sweep.md — Defer-reason: direct-filing-sweep — 2026-09-01T120000-tidy-standalone'));
  assert.ok(line.includes(`<!-- ${MATERIALITY_MARKER_PREFIX}: ${materialityFingerprint(ENTRY)} -->`));
});

test('parseMaterialityFingerprints extracts every embedded marker in order', () => {
  const text = [
    materialityEntryLine(ENTRY),
    materialityEntryLine({ ...ENTRY, area: 'review', finding: 'a second finding' }),
  ].join('\n');
  const fps = parseMaterialityFingerprints(text);
  assert.strictEqual(fps.length, 2);
  assert.strictEqual(fps[0], materialityFingerprint(ENTRY));
  assert.strictEqual(fps[1], materialityFingerprint({ ...ENTRY, area: 'review', finding: 'a second finding' }));
});

test('parseMaterialityFingerprints returns [] for text with no markers', () => {
  assert.deepStrictEqual(parseMaterialityFingerprints('nothing here'), []);
});

test('parseMaterialityFingerprints handles undefined/null without throwing', () => {
  assert.deepStrictEqual(parseMaterialityFingerprints(undefined), []);
  assert.deepStrictEqual(parseMaterialityFingerprints(null), []);
});

// --- isMaterialityDuplicate: the dedup gate itself ---

test('isMaterialityDuplicate is false when the digest container has no entries yet', () => {
  assert.strictEqual(isMaterialityDuplicate([], ENTRY), false);
  assert.strictEqual(isMaterialityDuplicate('', ENTRY), false);
});

test('isMaterialityDuplicate is true when an identical entry was already routed in a prior comment', () => {
  const priorComment = comment(materialityEntryLine(ENTRY), 'OWNER');
  assert.strictEqual(isMaterialityDuplicate([priorComment], ENTRY), true);
});

test('isMaterialityDuplicate is true across multiple comments (github-issues shape: array of comment objects)', () => {
  const comments = [
    comment(materialityEntryLine({ ...ENTRY, area: 'review', finding: 'unrelated finding' }), 'OWNER'),
    comment(materialityEntryLine(ENTRY), 'OWNER'),
  ];
  assert.strictEqual(isMaterialityDuplicate(comments, ENTRY), true);
});

test('isMaterialityDuplicate is false for a genuinely new finding even when other entries exist', () => {
  const comments = [comment(materialityEntryLine(ENTRY), 'OWNER')];
  const fresh = { ...ENTRY, finding: 'a brand new, unrelated finding' };
  assert.strictEqual(isMaterialityDuplicate(comments, fresh), false);
});

test('isMaterialityDuplicate accepts a single string (local-files shape: one file body)', () => {
  const body = materialityEntryLine(ENTRY);
  assert.strictEqual(isMaterialityDuplicate(body, ENTRY), true);
});

test('AC1.1: an untrusted-association comment carrying a matching fingerprint does not make the candidate a duplicate', () => {
  for (const association of ['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR']) {
    assert.strictEqual(isMaterialityDuplicate([comment(materialityEntryLine(ENTRY), association)], ENTRY), false, association);
  }
  assert.strictEqual(isMaterialityDuplicate([{ body: materialityEntryLine(ENTRY) }], ENTRY), false); // no association
  assert.strictEqual(isMaterialityDuplicate([materialityEntryLine(ENTRY)], ENTRY), false); // bare string element
});

test('AC2.1: a matching fingerprint in an OWNER/MEMBER/COLLABORATOR comment still dedups', () => {
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    assert.strictEqual(isMaterialityDuplicate([comment(materialityEntryLine(ENTRY), association)], ENTRY), true, association);
    assert.strictEqual(isMaterialityDuplicate([{ body: materialityEntryLine(ENTRY), author_association: association }], ENTRY), true, `${association} (REST)`);
  }
});

test('a trusted copy of the fingerprint still dedups when an untrusted copy sits beside it', () => {
  const line = materialityEntryLine(ENTRY);
  assert.strictEqual(isMaterialityDuplicate([comment(line, 'NONE'), comment(line, 'MEMBER')], ENTRY), true);
});

test('trustedMaterialityTexts names each skipped marker comment and ignores untrusted comments with no marker', () => {
  const planted = { body: materialityEntryLine(ENTRY), authorAssociation: 'NONE', url: 'https://example.test/c/1', author: { login: 'mallory' } };
  const chatter = { body: 'just a comment', authorAssociation: 'NONE', url: 'https://example.test/c/2', author: { login: 'bob' } };
  const owner = comment('owner text', 'OWNER');
  const { texts, skipped } = trustedMaterialityTexts([planted, chatter, owner]);
  assert.deepStrictEqual(texts, ['owner text']);
  assert.deepStrictEqual(skipped, ['skipped marker comment https://example.test/c/1 by mallory (NONE) — not an owner, member, or collaborator']);
});

test('a bare-string array element stays untrusted and its note names the contract violation (#3766)', () => {
  const line = materialityEntryLine(ENTRY);
  const { texts, skipped } = trustedMaterialityTexts([line, 'no marker here', comment('owner text', 'OWNER')]);
  assert.deepStrictEqual(texts, ['owner text']);
  assert.deepStrictEqual(skipped, ['skipped bare-string digest element — caller passed comment bodies, not comment objects (no author association to check)']);
  assert.strictEqual(isMaterialityDuplicate([line], ENTRY), false);
});

test('trustedMaterialityTexts treats a single string (local-files body) as trusted', () => {
  assert.deepStrictEqual(trustedMaterialityTexts('body'), { texts: ['body'], skipped: [] });
  assert.deepStrictEqual(trustedMaterialityTexts(undefined), { texts: [], skipped: [] });
});

test('a re-encountered finding folds into its existing entry instead of appending a second one (AC2)', () => {
  // Simulates the routing skill's own decision: on firing 1, the container is empty, so the
  // finding is appended; on firing 2 (same underlying finding, unchanged), the container
  // already carries it, so the routing skill must skip appending — this is the exact
  // spurious-cluster-promotion scenario #1279's Current State #2 describes.
  let container = '';
  const shouldAppendFiring1 = !isMaterialityDuplicate(container, ENTRY);
  assert.strictEqual(shouldAppendFiring1, true);
  container += `${materialityEntryLine(ENTRY)}\n`;

  const shouldAppendFiring2 = !isMaterialityDuplicate(container, ENTRY);
  assert.strictEqual(shouldAppendFiring2, false);
  // Only one entry line exists in the container after both firings — never a second one.
  assert.strictEqual(parseMaterialityFingerprints(container).length, 1);
});

// --- Rollover carry-over (#4848): planner + replacement identity ---

const C_DATE = '2026-08-24T18:35:16Z';
const firstSeen = (iso) => `<!-- materiality-first-seen: ${iso} -->`;
let commentSeq = 0;
// A `gh issue view --json comments` element: body, camelCase association, createdAt, url.
const posted = (body, { association = 'MEMBER', createdAt = C_DATE } = {}) => {
  commentSeq += 1;
  return { body, authorAssociation: association, createdAt, url: `https://example.test/issues/1#issuecomment-${commentSeq}` };
};
const findingLine = (n, over = {}) => materialityEntryLine({ ...ENTRY, finding: `finding ${n}`, ...over });
const entryFor = (n) => ({ ...ENTRY, finding: `finding ${n}` });
const stamped = (line, iso = C_DATE) => `${line} ${firstSeen(iso)}`;
const planOf = (old, fresh = [], opts = {}) => planCarryOver(old, fresh, { oldCommentCount: old.length, ...opts });
const postBodies = (p) => p.bodies.map((b) => posted(b));
const commentIdOf = (c) => c.url.match(/issuecomment-(\d+)$/)[1];
const TOMBSTONE_HEADER = 'Fingerprint-only tombstones:';
const tombstoneLines = (bodies) => bodies.join('\n').split('\n').filter((l) => l.startsWith('<!--'));

test('AC1.1: selectCarryOverEntries selects only trusted live lines', () => {
  const live = findingLine(1);
  const trusted = posted([
    live,
    findingLine(2).replace(' <!--', ' → #12 <!--'),
    `${findingLine(3)} → #13`,
    `${findingLine(4)} → expired`,
  ].join('\n'));
  const planted = posted(findingLine(5), { association: 'CONTRIBUTOR' });
  const { entries, skipped } = selectCarryOverEntries([trusted, planted]);
  assert.deepStrictEqual(entries.map((e) => e.line), [stamped(live)]);
  assert.strictEqual(entries[0].fingerprint, materialityFingerprint(entryFor(1)));
  assert.strictEqual(skipped.length, 1);
  assert.ok(skipped[0].includes(planted.url), skipped[0]);
});

test('selectCarryOverEntries keeps a live line with a mid-finding arrow and a fingerprint-less live line, and ignores non-entry lines', () => {
  const arrow = '- [tests] a → b — f.js — Defer-reason: x — run';
  const bare = '- [tests] no marker here — f.js — Defer-reason: x — run';
  const rows = [
    'Note: a remark about the digest',
    arrow,
    '---',
    bare,
    '<!-- materiality-fingerprint: t1 --> <!-- consolebackfill-item: i1 -->',
  ];
  for (const eol of ['\n', '\r\n']) {
    const { entries } = selectCarryOverEntries([posted(rows.join(eol))]);
    assert.deepStrictEqual(entries.map((e) => e.line), [stamped(arrow), stamped(bare)], JSON.stringify(eol));
    assert.deepStrictEqual(entries.map((e) => e.key), [arrow, bare]);
    assert.deepStrictEqual(entries.map((e) => e.fingerprint), [null, null]);
  }
});

test('selectCarryOverEntries collapses a duplicate fingerprint across comments', () => {
  const bare = '- [tests] no marker here — f.js — Defer-reason: x — run';
  const { entries } = selectCarryOverEntries([
    posted(`${findingLine(1)}\n${bare}`),
    posted(`${findingLine(1)}\n${bare}`, { createdAt: '2026-09-09T00:00:00Z' }),
  ]);
  assert.strictEqual(entries.length, 2);
  assert.ok(entries[0].line.includes(C_DATE), 'the first occurrence wins');
});

test('selectCarryOverEntries stamps the comment createdAt and keeps an existing stamp', () => {
  const fresh = findingLine(1);
  const old = stamped(findingLine(2), '2026-01-01T00:00:00Z');
  const { entries } = selectCarryOverEntries([posted(`${fresh}\n${old}`, { createdAt: '2026-08-24T18:35:16Z' })]);
  assert.strictEqual(entries[0].line, `${fresh} <!-- materiality-first-seen: 2026-08-24T18:35:16Z -->`);
  assert.strictEqual(entries[1].line, old);
  assert.strictEqual(entries[1].line.split('materiality-first-seen').length - 1, 1, 'no second marker');
});

test('AC2.1: a carried entry still dedups against the new container', () => {
  const old = [posted(`${findingLine(2)}\n${findingLine(1)}`)];
  const p = planOf(old);
  assert.strictEqual(isMaterialityDuplicate([{ body: p.bodies[0], authorAssociation: 'MEMBER' }], entryFor(1)), true);
});

test('AC3.1: a carried entry\'s expiry age comes from its original timestamp, not the new comment\'s', () => {
  const plain = findingLine(1, { provenance: 'harness-health' });
  const p = planOf([posted(plain, { createdAt: '2026-01-01T00:00:00Z' })]);
  assert.strictEqual(materialityEntryDate(p.pending[0], '2026-11-01T00:00:00Z').toISOString(), '2026-01-01T00:00:00.000Z');
  assert.strictEqual(materialityEntryDate(plain, '2026-11-01T00:00:00Z').toISOString(), '2026-11-01T00:00:00.000Z', 'control: unstamped, the new comment date wins');
});

test('materialityEntryDate reads a run-id from provenance as UTC ahead of any other source', () => {
  const runLine = findingLine(1, { provenance: '2026-08-24T183516-tidy-standalone' });
  const expected = '2026-08-24T18:35:16.000Z';
  for (const line of [runLine, `${runLine} → #12`, stamped(runLine, '2026-02-02T00:00:00Z')]) {
    assert.strictEqual(materialityEntryDate(line, '2026-11-01T00:00:00Z').toISOString(), expected, line);
  }
});

test('materialityEntryDate falls back to the comment date, and returns null with nothing parseable', () => {
  const skillLine = findingLine(1, { provenance: 'harness-health' });
  assert.strictEqual(materialityEntryDate(skillLine, '2026-11-01T00:00:00Z').toISOString(), '2026-11-01T00:00:00.000Z');
  assert.strictEqual(materialityEntryDate(skillLine), null);
  assert.strictEqual(materialityEntryDate(stamped(skillLine, 'not-a-date')), null);
  assert.strictEqual(materialityEntryDate(stamped(skillLine, 'not-a-date'), '2026-11-01T00:00:00Z').toISOString(), '2026-11-01T00:00:00.000Z');
  assert.strictEqual(materialityEntryDate(stamped(skillLine, '2026-02-02T00:00:00Z')).toISOString(), '2026-02-02T00:00:00.000Z');
});

test('materialityEntryDate ignores a run-id with an impossible date instead of rolling it into the next month', () => {
  const impossible = findingLine(1, { provenance: '2026-02-30T000000-spec-1' });
  const commentDate = '2026-11-01T00:00:00Z';
  // The same fall-through a non-run-id provenance takes: first-seen marker, else the comment date.
  assert.strictEqual(materialityEntryDate(stamped(impossible, '2026-02-02T00:00:00Z'), commentDate).toISOString(), '2026-02-02T00:00:00.000Z');
  assert.strictEqual(materialityEntryDate(impossible, commentDate).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.strictEqual(materialityEntryDate(impossible), null);
  const badHour = findingLine(1, { provenance: '2026-02-03T250000-spec-1' });
  assert.strictEqual(materialityEntryDate(badHour, commentDate).toISOString(), '2026-11-01T00:00:00.000Z');
  // Control: a valid run id still dates from the run id, ahead of the marker and the comment date.
  const valid = findingLine(1, { provenance: '2026-02-28T120000-spec-1' });
  assert.strictEqual(materialityEntryDate(stamped(valid, '2026-02-02T00:00:00Z'), commentDate).toISOString(), '2026-02-28T12:00:00.000Z');
});

test('isLiveEntryLine is true only for an Entry-format line with no trailing mark', () => {
  const live = findingLine(1);
  assert.strictEqual(isLiveEntryLine(live), true);
  assert.strictEqual(isLiveEntryLine(stamped(live)), true, 'a trailing first-seen comment keeps it live');
  assert.strictEqual(isLiveEntryLine('- [tests] a → b — f.js — Defer-reason: x — run'), true, 'a mid-finding arrow is not a mark');
  assert.strictEqual(isLiveEntryLine(`${live} → expired`), false);
  assert.strictEqual(isLiveEntryLine(`${live} → #123`), false);
  assert.strictEqual(isLiveEntryLine(live.replace(' <!--', ' → #123 <!--')), false, 'a mark before the trailing comment');
  assert.strictEqual(isLiveEntryLine('- [text](https://example.test/x) a link bullet'), false);
  assert.strictEqual(isLiveEntryLine('Note: a remark about the digest'), false);
  assert.strictEqual(isLiveEntryLine(''), false);
});

test('AC5.1: a promoted and an expired finding are still duplicates against the new container, and neither is in the active set', () => {
  const PROMOTED = { ...ENTRY, finding: 'promoted finding' };
  const EXPIRED = { ...ENTRY, finding: 'expired finding' };
  const LIVE = { ...ENTRY, finding: 'live finding' };
  const old = [posted([
    materialityEntryLine(PROMOTED).replace(' <!--', ' → #12 <!--'),
    `${materialityEntryLine(EXPIRED)} → expired`,
    materialityEntryLine(LIVE),
  ].join('\n'))];
  const p = planOf(old);
  const fresh = postBodies(p);
  assert.strictEqual(isMaterialityDuplicate(fresh, PROMOTED), true);
  assert.strictEqual(isMaterialityDuplicate(fresh, EXPIRED), true);
  assert.deepStrictEqual(selectCarryOverEntries(fresh).entries.map((e) => e.line), [stamped(materialityEntryLine(LIVE))]);
  assert.strictEqual(p.tombstones, 2);
});

test('AC8.1 (marker half): a tombstone keeps a consolebackfill-item marker', () => {
  const item = '<!-- consolebackfill-item: item1 -->';
  const marked = `${materialityEntryLine(ENTRY)} ${item} → expired`;
  const other = { ...ENTRY, finding: 'second finding' };
  const stampedMarked = `${stamped(materialityEntryLine(other), '2026-01-01T00:00:00Z')} → #5`;
  const claim = '<!-- agent-claim: {"runId":"x"} -->';
  const p = planOf([posted(`${marked}\n${stampedMarked}`), posted(claim)]);
  assert.strictEqual(p.tombstones, 2);
  const lines = tombstoneLines(p.bodies);
  assert.deepStrictEqual(lines, [
    `<!-- materiality-fingerprint: ${materialityFingerprint(ENTRY)} --> ${item}`,
    `<!-- materiality-fingerprint: ${materialityFingerprint(other)} -->`,
  ]);
  const all = p.bodies.join('\n');
  assert.ok(!all.includes('- ['), all);
  assert.ok(!all.includes('agent-claim'), all);
  assert.ok(!all.includes('materiality-first-seen'), all);
});

test('a tombstone has no entry line and fits under the comment-size cap', () => {
  const rows = Array.from({ length: 20 }, (_, i) => `${findingLine(i)} → expired`);
  const p = planOf([posted(rows.join('\n'))], [], { maxChars: 200 });
  assert.strictEqual(p.tombstones, 20);
  const markers = new Set();
  for (const body of p.bodies) {
    assert.ok(body.length <= 200, `${body.length}`);
    const [header, ...rest] = body.split('\n');
    assert.ok(header.startsWith(TOMBSTONE_HEADER) && !header.includes('<!--'), header);
    for (const l of rest) {
      assert.ok(!/^- \[/.test(l), l);
      for (const m of parseMaterialityFingerprints(l)) markers.add(m);
    }
  }
  assert.strictEqual(markers.size, 20);
});

test('a fingerprint with both a live and a marked line is carried live, with no tombstone', () => {
  const p = planOf([posted(`${findingLine(1)}\n${findingLine(1)} → #12`)]);
  assert.strictEqual(p.live, 1);
  assert.strictEqual(p.tombstones, 0);
  assert.deepStrictEqual(tombstoneLines(p.bodies), []);
});

test('a marked line sharing a live line\'s fingerprint still tombstones its own consolebackfill-item marker', () => {
  const item = '<!-- consolebackfill-item: item9 -->';
  const old = [posted(`${findingLine(1)}\n${findingLine(1)} ${item} → expired`)];
  const p0 = planOf(old);
  assert.strictEqual(p0.tombstones, 1);
  assert.deepStrictEqual(tombstoneLines(p0.bodies), [item]);
  const liveOnly = planOf(old, [posted(stamped(findingLine(1)))]);
  assert.deepStrictEqual(liveOnly.tombstonesPending, [item]);
  assert.strictEqual(liveOnly.verified, false, 'verified needs the item marker');
  assert.strictEqual(planOf(old, postBodies(p0)).verified, true);
});

test('a marked line with no fingerprint is counted in unfingerprintedMarked, not tombstoned', () => {
  const p = planOf([posted(`- [tidy] old work — src/a.js — Defer-reason: x — 2026-08-01T000000-tidy-standalone → #3900\n${findingLine(1)}`)]);
  assert.strictEqual(p.unfingerprintedMarked, 1);
  assert.strictEqual(p.tombstones, 0);
  assert.strictEqual(p.live, 1);
});

test('a second rollover carries tombstones and stamps again', () => {
  const item = '<!-- consolebackfill-item: itemP -->';
  const A = [posted(`${findingLine(1)}\n${findingLine(2)} ${item} → expired`, { createdAt: '2026-03-01T00:00:00Z' })];
  const pAB = planOf(A);
  const B = pAB.bodies.map((b) => posted(b, { createdAt: '2026-09-01T00:00:00Z' }));
  const pBC = planOf(B);
  const C = pBC.bodies.map((b) => posted(b, { createdAt: '2026-11-01T00:00:00Z' }));
  assert.strictEqual(isMaterialityDuplicate(C, entryFor(2)), true);
  assert.ok(pBC.bodies.join('\n').includes(item));
  assert.strictEqual(pBC.tombstones, pAB.tombstones);
  assert.deepStrictEqual(pBC.pending, [stamped(findingLine(1), '2026-03-01T00:00:00Z')]);
  assert.strictEqual(planOf(B, C).verified, true);
});

test('AC6.1: planning refuses a paged, wrapped or malformed input rather than returning an empty plan', () => {
  const c1 = posted(findingLine(1));
  const c2 = posted(findingLine(2));
  const c3 = posted(findingLine(3));
  const shapes = [
    [[c1, c2], [c3]],
    { comments: [c1] },
    null,
    JSON.stringify([c1]),
    ['- [a] b'],
    [{ body: 'x' }],
    [{ authorAssociation: 'MEMBER' }],
    [{ body: 'x', authorAssociation: 'MEMBER' }],
    [{ body: 'x', authorAssociation: 'MEMBER', createdAt: 'yesterday' }],
    [c1, 'a bare body'],
  ];
  const refused = { name: 'CarryOverInputError' };
  for (const shape of shapes) {
    const count = Array.isArray(shape) ? shape.length : 1;
    assert.throws(() => planCarryOver(shape, [], { oldCommentCount: count }), refused, `old ${JSON.stringify(shape)}`);
    assert.throws(() => planCarryOver([c1], shape, { oldCommentCount: 1 }), refused, `new ${JSON.stringify(shape)}`);
    if (Array.isArray(shape)) assert.throws(() => selectCarryOverEntries(shape), refused, `select ${JSON.stringify(shape)}`);
  }
  assert.throws(() => planCarryOver([], [], { oldCommentCount: 0 }), refused, 'an empty old side');
  assert.throws(() => selectCarryOverEntries(null), refused);
  assert.ok(new CarryOverInputError('x') instanceof Error);
  assert.deepStrictEqual(planCarryOver([c1], [], { oldCommentCount: 1 }).live, 1, 'a well-formed read plans');
  assert.doesNotThrow(() => planCarryOver([c1], [], { oldCommentCount: 1 }), 'an empty new side is valid');
});

test('planCarryOver refuses a truncated read', () => {
  const old = [posted(findingLine(1)), posted(findingLine(2))];
  assert.throws(() => planCarryOver(old, [], { oldCommentCount: old.length + 1 }), { name: 'CarryOverInputError' });
  assert.throws(() => planCarryOver(old, [], { oldCommentCount: NaN }), { name: 'CarryOverInputError' });
  assert.throws(() => planCarryOver(old, []), { name: 'CarryOverInputError' });
  assert.throws(() => planCarryOver(old, [], {}), { name: 'CarryOverInputError' });
});

test('AC7.1: a re-run after each interruption point posts nothing twice', () => {
  const rows = [1, 2, 3, 4].map((n) => findingLine(n));
  const marked = [5, 6, 7].map((n) => `${findingLine(n)} → expired`);
  const old = [posted([...rows, ...marked].join('\n'))];
  const opts = { maxChars: 200 };
  const p0 = planOf(old, [], opts);
  assert.strictEqual(p0.verified, false);
  assert.strictEqual(p0.pending.length, 4);
  assert.ok(p0.bodies.length >= 3, `${p0.bodies.length}`);
  const bodyLines = (bodies) => bodies.flatMap((b) => b.split('\n')).filter((l) => !l.startsWith(TOMBSTONE_HEADER));
  for (let k = 0; k <= p0.bodies.length; k += 1) {
    const fresh = p0.bodies.slice(0, k).map((b) => posted(b));
    const again = planOf(old, fresh, opts);
    const already = new Set(bodyLines(p0.bodies.slice(0, k)));
    for (const l of bodyLines(again.bodies)) assert.ok(!already.has(l), `k=${k} reposts ${l}`);
    assert.deepStrictEqual(new Set([...already, ...bodyLines(again.bodies)]), new Set(bodyLines(p0.bodies)), `k=${k} loses a line`);
  }
  const done = planOf(old, p0.bodies.map((b) => posted(b)), opts);
  assert.deepStrictEqual(done.pending, []);
  assert.deepStrictEqual(done.tombstonesPending, []);
  assert.deepStrictEqual(done.bodies, []);
  assert.deepStrictEqual(done.markerEdits, []);
  assert.strictEqual(done.verified, true);
  assert.strictEqual(done.carried, done.live);
  assert.strictEqual(done.tombstonesCarried, done.tombstones);
  assert.deepStrictEqual(planOf(old, p0.bodies.map((b) => posted(b)), opts), done, 'unchanged when re-planned');
});

test('AC7.2: a promotion on the old issue mid-rollover reaches the carried copy', () => {
  const noFp = '- [t] no fingerprint here — f.js — Defer-reason: x — run';
  const rows = [findingLine(1), findingLine(2), noFp];
  const variants = [[0, '→ #99'], [0, '→ expired'], [2, '→ #99']];
  for (const [idx, mark] of variants) {
    const old = [posted(rows.join('\n'))];
    const p = planOf(old);
    const fresh = postBodies(p);
    assert.strictEqual(planOf(old, fresh).verified, true);
    const marked = [...rows];
    marked[idx] = `${rows[idx]} ${mark}`;
    const old2 = [{ ...old[0], body: marked.join('\n') }];
    const p2 = planOf(old2, fresh);
    assert.strictEqual(p2.verified, false);
    assert.deepStrictEqual(p2.bodies, []);
    assert.strictEqual(p2.markerEdits.length, 1);
    assert.strictEqual(p2.markerEdits[0].commentId, commentIdOf(fresh[0]));
    const carriedLine = p.pending[idx];
    assert.ok(carriedLine.endsWith(firstSeen(C_DATE)), carriedLine);
    const expected = fresh[0].body.split('\n').map((l) => (l === carriedLine ? `${l} ${mark}` : l)).join('\n');
    assert.strictEqual(p2.markerEdits[0].body, expected);
    const fresh2 = [{ ...fresh[0], body: p2.markerEdits[0].body }];
    const p3 = planOf(old2, fresh2);
    assert.deepStrictEqual(p3.markerEdits, []);
    assert.strictEqual(p3.verified, true);
    const keep = rows.filter((_, i) => i !== idx).map((l) => stamped(l));
    assert.deepStrictEqual(selectCarryOverEntries(fresh2).entries.map((e) => e.line), keep);
  }
});

test('a marker edit on a CRLF comment puts the mark before the carriage return, leaving other line ends alone', () => {
  const rows = [findingLine(1), findingLine(2)];
  const old = [posted(rows.join('\n'))];
  const p = planOf(old);
  const crlf = { ...posted(p.bodies[0]) };
  crlf.body = p.pending.join('\r\n');
  const marked = [{ ...old[0], body: `${rows[0]} → #99\n${rows[1]}` }];
  const again = planOf(marked, [crlf]);
  assert.strictEqual(again.markerEdits.length, 1);
  assert.strictEqual(again.markerEdits[0].body, `${p.pending[0]} → #99\r\n${p.pending[1]}`);
  const done = planOf(marked, [{ ...crlf, body: again.markerEdits[0].body }]);
  assert.deepStrictEqual(done.markerEdits, [], 'the mark reads as trailing, so nothing is edited twice');
  assert.strictEqual(done.verified, true);
});

test('a marker edit finds its comment id from html_url, a numeric id or a numeric string id, and refuses a comment with none', () => {
  const old = [posted(findingLine(1))];
  const carriedBody = planOf(old).bodies[0];
  const marked = [{ ...old[0], body: `${findingLine(1)} → #99` }];
  const newSide = (identity) => [{ body: carriedBody, authorAssociation: 'MEMBER', createdAt: C_DATE, ...identity }];
  const editIdFor = (identity) => planOf(marked, newSide(identity)).markerEdits.map((e) => e.commentId);
  assert.deepStrictEqual(editIdFor({ html_url: 'https://github.com/o/r/issues/1#issuecomment-4242' }), ['4242']);
  assert.deepStrictEqual(editIdFor({ id: 777 }), ['777']);
  assert.deepStrictEqual(editIdFor({ id: '888' }), ['888']);
  assert.throws(() => planOf(marked, newSide({})), { name: 'CarryOverInputError' });
  assert.throws(() => planOf(marked, newSide({ id: 'abc', url: 'https://example.test/issues/1' })), { name: 'CarryOverInputError' });
});

test('a trusted old-side bullet that fails the Entry format is counted in unparsedEntryLines, never changing verified', () => {
  const noArea = '- [] no area — f.js — Defer-reason: x — run';
  const bracketed = '- [a]b] finding — f.js — Defer-reason: x — run';
  const p = planOf([posted(`${noArea}\n${findingLine(1)}`)]);
  assert.strictEqual(p.unparsedEntryLines, 1);
  assert.strictEqual(p.live, 1);
  assert.strictEqual(planOf([posted(`${bracketed}\n${noArea}`)]).unparsedEntryLines, 2);
  const old = [posted(`${noArea}\n${findingLine(1)}`)];
  const again = planOf(old, postBodies(p));
  assert.strictEqual(again.verified, true, 'verified is not changed by an unparsed line');
  assert.strictEqual(again.unparsedEntryLines, 1);
  const quiet = planOf([posted([
    findingLine(1),
    `${findingLine(2)} → expired`,
    '- [tidy] old work — src/a.js — Defer-reason: x — run → #3900',
    'Note: a remark about the digest',
    '---',
  ].join('\n'))]);
  assert.strictEqual(quiet.unparsedEntryLines, 0);
});

test('an unparsed bullet carrying a fingerprint marker is tombstoned, not counted', () => {
  const marked = '- [] gone <!-- materiality-fingerprint: fpunparsed -->';
  const p = planOf([posted(`${marked}\n${findingLine(1)}`)]);
  assert.strictEqual(p.unparsedEntryLines, 0);
  assert.strictEqual(p.tombstones, 1);
  assert.deepStrictEqual(tombstoneLines(p.bodies), ['<!-- materiality-fingerprint: fpunparsed -->']);
});

test('planCarryOver checks newCommentCount against the new comments read when given, and ignores it when omitted', () => {
  const old = [posted(findingLine(1))];
  const fresh = postBodies(planOf(old));
  const refused = { name: 'CarryOverInputError' };
  const withCount = (side, newCommentCount) => planCarryOver(old, side, { oldCommentCount: old.length, newCommentCount });
  assert.strictEqual(withCount(fresh, fresh.length).verified, true, 'a matching count plans');
  assert.strictEqual(withCount([], 0).pending.length, 1, 'a matching zero plans');
  assert.throws(() => withCount([], 1), refused, 'a short read of a one-comment side');
  assert.throws(() => withCount(fresh, fresh.length + 1), refused);
  assert.throws(() => withCount(fresh, 0), refused);
  assert.throws(() => withCount(fresh, NaN), refused);
  assert.throws(() => withCount(fresh, String(fresh.length)), refused, 'a string count is not an integer');
  assert.throws(() => withCount(fresh, null), refused);
  assert.throws(() => withCount(fresh, -1), refused);
  assert.throws(() => withCount([], 2), /newCommentCount 2 does not equal the 0 new comments read/);
  assert.deepStrictEqual(planCarryOver(old, fresh, { oldCommentCount: old.length }), planCarryOver(old, fresh, { oldCommentCount: old.length, newCommentCount: undefined }), 'omitted is unchanged');
  assert.strictEqual(planCarryOver(old, [], { oldCommentCount: old.length }).pending.length, 1);
});

test('AC7.1 (non-body posts): a re-run after the label move or the close posts nothing, though the old side now holds the rollover\'s own comments', () => {
  const entries = [1, 2].map((n) => findingLine(n));
  const expired = `${findingLine(3)} → expired`;
  const priorTombstone = `${TOMBSTONE_HEADER} promoted or expired findings kept for dedup\n<!-- materiality-fingerprint: priorfp -->`;
  const base = [posted([...entries, expired].join('\n')), posted(priorTombstone)];
  const first = planOf(base);
  assert.strictEqual(first.pending.length, 2);
  assert.ok(first.bodies.length > 0);
  const fresh = postBodies(first);
  const pointer = posted('<!-- digest-rollover-to: 456 -->\nThis digest rolled over to #456; the carried entries live there.');
  const summary = posted('<!-- digest-rollover-to: 456 -->\nRolled over to #456: carried 2 entries and 2 tombstones.');
  for (const old of [[...base, pointer], [...base, pointer, summary]]) {
    const again = planOf(old, fresh);
    assert.deepStrictEqual(again.pending, []);
    assert.deepStrictEqual(again.tombstonesPending, []);
    assert.deepStrictEqual(again.bodies, []);
    assert.deepStrictEqual(again.markerEdits, []);
    assert.strictEqual(again.verified, true);
    assert.strictEqual(again.live, first.live);
    assert.strictEqual(again.tombstones, first.tombstones);
    assert.strictEqual(again.unparsedEntryLines, 0);
  }
});

test('AC10.1: a re-plan after posting returns no marker edit for a key that is still live on the old issue', () => {
  const old = [posted(`${findingLine(1)}\n${findingLine(1)} → #12`)];
  const fresh = postBodies(planOf(old));
  const again = planOf(old, fresh);
  assert.deepStrictEqual(again.markerEdits, []);
  assert.strictEqual(again.verified, true);
  assert.strictEqual(selectCarryOverEntries(fresh).entries.length, 1);
});

test('a mark made only on the carried copy counts as carried', () => {
  const old = [posted(findingLine(1))];
  const p = planOf(old, [posted(`${stamped(findingLine(1))} → #99`)]);
  assert.strictEqual(p.carried, p.live);
  assert.strictEqual(p.live, 1);
  assert.deepStrictEqual(p.markerEdits, []);
  assert.deepStrictEqual(p.bodies, []);
});

test('planCarryOver ignores an untrusted comment in the new container', () => {
  const old = [posted(`${findingLine(1)}\n${findingLine(2)} → #12`)];
  const planted = planOf(old).bodies.map((b) => posted(b, { association: 'CONTRIBUTOR' }));
  const p = planOf(old, planted);
  assert.strictEqual(p.carried, 0);
  assert.strictEqual(p.tombstonesCarried, 0);
  assert.strictEqual(p.verified, false);
  assert.strictEqual(p.skipped.length, planted.length);
});

test('planCarryOver splits bodies at line boundaries under maxChars', () => {
  const tail = ` ${firstSeen('2026-01-01T00:00:00Z')}`;
  const sized = (c, total) => `- [t] ${c.repeat(total - 6 - tail.length)}${tail}`;
  // 80 chars each: two fit under 200 even with room kept for a marker edit on each.
  const lines = [sized('a', 80), sized('b', 80), sized('c', 80)];
  assert.ok(lines.every((l) => l.length === 80));
  const p = planOf([posted(lines.join('\n'))], [], { maxChars: 200 });
  assert.ok(p.bodies.every((b) => b.length <= 200));
  assert.deepStrictEqual(p.bodies.flatMap((b) => b.split('\n')), lines);
  assert.strictEqual(p.bodies.length, 2);
  const long = sized('z', 250);
  const q = planOf([posted([lines[0], long].join('\n'))], [], { maxChars: 200 });
  assert.ok(q.bodies.includes(long), 'a single over-cap line gets its own body, uncut');
  assert.deepStrictEqual(q.bodies.flatMap((b) => b.split('\n')).sort(), [lines[0], long].sort());
});

test('planCarryOver handles the shapes found on the live digest', () => {
  const arrow = '- [tests] a → b — f.js — Defer-reason: x — run <!-- materiality-fingerprint: arrowfp -->';
  const body = [
    'Run note: some chatter',
    '- [tidy] old work — src/a.js — Defer-reason: x — 2026-08-01T000000-tidy-standalone → #3900',
    `${findingLine(1)} → #4413`,
    arrow,
    findingLine(2, { provenance: 'harness-health' }),
    findingLine(3, { provenance: 'reflect full mode, /flow #1153 wrap-up' }),
    '---',
    '<!-- agent-claim: {"runId":"x"} -->',
  ].join('\n');
  const old = [posted(body)];
  const p = planOf(old);
  assert.strictEqual(p.live, 3);
  assert.strictEqual(p.tombstones, 1);
  assert.strictEqual(p.unfingerprintedMarked, 1);
  assert.deepStrictEqual(p.pending.map((l) => l.replace(/ <!-- materiality-first-seen: .*$/, '')), [
    arrow,
    findingLine(2, { provenance: 'harness-health' }),
    findingLine(3, { provenance: 'reflect full mode, /flow #1153 wrap-up' }),
  ]);
  for (const l of p.pending) assert.strictEqual(materialityEntryDate(l).toISOString(), '2026-08-24T18:35:16.000Z', l);
  const again = planOf(old, postBodies(p));
  assert.strictEqual(again.verified, true);
  assert.strictEqual(again.pending.length, 0);
});

test('two live lines sharing a fingerprint: the dropped line\'s consolebackfill-item marker is tombstoned, and verified needs it', () => {
  const base = findingLine(1);
  const item = '<!-- consolebackfill-item: item2 -->';
  const old = [posted(`${base}\n${base} ${item}`)];
  const p = planOf(old);
  assert.strictEqual(p.live, 1);
  assert.strictEqual(p.tombstones, 1);
  assert.deepStrictEqual(tombstoneLines(p.bodies), [item]);
  const liveOnly = planOf(old, [posted(stamped(base))]);
  assert.deepStrictEqual(liveOnly.tombstonesPending, [item]);
  assert.strictEqual(liveOnly.verified, false);
  assert.strictEqual(planOf(old, postBodies(p)).verified, true);
});

test('a mark followed by prose between later comments is not trailing', () => {
  const misread = `${findingLine(1)} → #12 <!-- a --> text <!-- b -->`;
  assert.deepStrictEqual(selectCarryOverEntries([posted(misread)]).entries.map((e) => e.line), [stamped(misread)]);
  const prose = `${findingLine(2)} → #12 ${'<!-- a --> x '.repeat(40)}`;
  assert.strictEqual(selectCarryOverEntries([posted(prose)]).entries.length, 1);
  const marked = `${findingLine(3)} → #12 ${Array(40).fill('<!-- a -->').join(' ')}`;
  assert.deepStrictEqual(selectCarryOverEntries([posted(marked)]).entries, []);
});

test('a marker edit on every line of a full body leaves it at or under maxChars', () => {
  const rows = Array.from({ length: 9 }, (_, i) => findingLine(i));
  const lineLength = stamped(rows[0]).length;
  assert.ok(rows.every((r) => stamped(r).length === lineLength));
  // The longest mark: `→ #` and ten digits, with its space, is 14 characters. The cap leaves room for five
  // lines carrying 13 each, so a reserve below 14 packs five and the edited bodies overrun.
  const longest = '→ #1234567890';
  const maxChars = 5 * lineLength + 4 + 5 * (longest.length);
  const old = [posted(rows.join('\n'))];
  const fresh = postBodies(planOf(old, [], { maxChars }));
  assert.ok(fresh.length >= 2);
  for (const mark of [longest, '→ expired', '→ #4848']) {
    const old2 = [{ ...old[0], body: rows.map((l) => `${l} ${mark}`).join('\n') }];
    const p = planOf(old2, fresh, { maxChars });
    assert.strictEqual(p.markerEdits.length, fresh.length, mark);
    for (const edit of p.markerEdits) assert.ok(edit.body.length <= maxChars, `${mark}: ${edit.body.length} > ${maxChars}`);
  }
});

test('a re-plan after the selected live line moved posts the item marker the carried copy lacks', () => {
  const base = findingLine(1);
  const item = '<!-- consolebackfill-item: item2 -->';
  const old = [posted(`${base}\n${base} ${item}`)];
  const first = planOf(old);
  assert.deepStrictEqual(tombstoneLines(first.bodies), [item]);
  const entriesOnly = [posted(first.bodies[0])]; // interrupted before the tombstone body
  assert.ok(!first.bodies[0].includes(item));
  // The first line is promoted meanwhile: the line with the item marker is now the selected one.
  const old2 = [{ ...old[0], body: `${base} → #5\n${base} ${item}` }];
  const again = planOf(old2, entriesOnly);
  assert.strictEqual(again.live, 1);
  assert.strictEqual(again.carried, 1);
  assert.strictEqual(again.tombstones, 1, 'the marked first line adds none: its fingerprint marker is on the live line');
  assert.deepStrictEqual(again.markerEdits, []);
  assert.deepStrictEqual(again.tombstonesPending, [item]);
  assert.strictEqual(again.verified, false, 'the item marker is on neither side yet');
  assert.deepStrictEqual(tombstoneLines(again.bodies), [item]);
  const done = planOf(old2, [...entriesOnly, ...postBodies({ bodies: again.bodies })]);
  assert.strictEqual(done.verified, true);
  assert.deepStrictEqual(done.bodies, []);
  assert.strictEqual(done.tombstones, done.tombstonesCarried);
});

test('one item marker on two live fingerprints is tombstoned once when both carried copies lack it', () => {
  const item = '<!-- consolebackfill-item: shared1 -->';
  const old = [posted(`${findingLine(1)} ${item}\n${findingLine(2)} ${item}`)];
  const entriesOnly = [posted(`${stamped(findingLine(1))}\n${stamped(findingLine(2))}`)]; // interrupted before the item markers
  const p = planOf(old, entriesOnly);
  assert.strictEqual(p.live, 2);
  assert.strictEqual(p.carried, 2);
  assert.strictEqual(p.tombstones, 1, 'the shared marker is one tombstone');
  assert.deepStrictEqual(p.tombstonesPending, [item]);
  assert.deepStrictEqual(tombstoneLines(p.bodies), [item]);
  assert.strictEqual(p.verified, false);
  assert.strictEqual(planOf(old, [...entriesOnly, ...postBodies(p)]).verified, true);
});

test('a fingerprint-less live duplicate is not counted in unfingerprintedMarked', () => {
  const bare = '- [tests] no marker here — f.js — Defer-reason: x — run';
  const p = planOf([posted(`${bare}\n${bare}`)]);
  assert.strictEqual(p.live, 1);
  assert.strictEqual(p.unfingerprintedMarked, 0);
  assert.strictEqual(p.tombstones, 0);
  assert.strictEqual(planOf([posted(`${bare}\n${bare} → #7`)]).unfingerprintedMarked, 1, 'a marked fingerprint-less line still counts');
});

// --- classifyRolloverResume: replacement identity ---

const OLD_ISSUE = { number: 123, state: 'open', labels: [{ name: 'digest' }], body: '' };
const candidate = (number, over = {}) => ({
  number,
  state: 'open',
  author_association: 'MEMBER',
  title: 'Digest (continues #123)',
  labels: [],
  body: `Carry-over digest.\n${digestReplacementMarker(123)}\n`,
  ...over,
});

test('digestReplacementMarker renders the marker line', () => {
  assert.strictEqual(digestReplacementMarker(123), '<!-- digest-rollover-of: 123 -->');
});

test('AC9.1: an issue merely titled like a replacement, with no trusted marker line, is never resumed', () => {
  const none = { state: 'none', replacement: null, extras: [] };
  const cases = [
    candidate(10, { body: 'no marker at all' }),
    candidate(10, { author_association: 'CONTRIBUTOR' }),
    candidate(10, { body: digestReplacementMarker(124) }),
    candidate(10, { body: `see ${digestReplacementMarker(123)} here` }),
    candidate(10, { body: undefined }),
  ];
  for (const c of cases) assert.deepStrictEqual(classifyRolloverResume([c], OLD_ISSUE), none, JSON.stringify(c.body));
  assert.deepStrictEqual(classifyRolloverResume([], OLD_ISSUE), none);
});

test('classifyRolloverResume resumes on the marker plus the digest label on either issue', () => {
  const withLabel = classifyRolloverResume([candidate(10)], OLD_ISSUE);
  assert.deepStrictEqual(withLabel, { state: 'resume', replacement: 10, extras: [] });
  const onReplacement = classifyRolloverResume([candidate(10, { labels: [{ name: 'digest' }] })], { ...OLD_ISSUE, labels: [] });
  assert.deepStrictEqual(onReplacement, { state: 'resume', replacement: 10, extras: [] });
});

test('classifyRolloverResume names a stalled label move only while the old issue is open', () => {
  for (const state of ['open', 'OPEN']) {
    const out = classifyRolloverResume([candidate(10)], { ...OLD_ISSUE, state, labels: [] });
    assert.deepStrictEqual(out, { state: 'stalled', replacement: 10, extras: [] }, state);
  }
  const none = { state: 'none', replacement: null, extras: [] };
  for (const state of ['closed', 'CLOSED']) {
    assert.deepStrictEqual(classifyRolloverResume([candidate(10, { state: 'closed' })], { ...OLD_ISSUE, state, labels: [] }), none, state);
  }
  assert.strictEqual(classifyRolloverResume([candidate(10, { body: 'x' })], { ...OLD_ISSUE, labels: [] }).state, 'none');
});

test('classifyRolloverResume reports an open replacement of a hand-closed old issue as orphan, still none', () => {
  const closedOld = { ...OLD_ISSUE, state: 'closed', labels: [] };
  const none = { state: 'none', replacement: null, extras: [] };
  assert.deepStrictEqual(classifyRolloverResume([candidate(10)], closedOld), { ...none, orphan: 10 });
  assert.deepStrictEqual(classifyRolloverResume([candidate(10, { state: 'OPEN' })], closedOld), { ...none, orphan: 10 }, 'gh casing');
  assert.deepStrictEqual(
    classifyRolloverResume([candidate(10, { state: 'closed' }), candidate(11), candidate(12)], closedOld),
    { ...none, orphan: 11 },
    'the lowest-numbered open match',
  );
  assert.deepStrictEqual(classifyRolloverResume([candidate(10, { author_association: 'NONE' })], closedOld), none, 'an untrusted marker is no orphan');
  assert.deepStrictEqual(classifyRolloverResume([candidate(10, { state: 'closed' })], closedOld), none, 'a closed past generation stays quiet');
  assert.ok(!('orphan' in classifyRolloverResume([candidate(10)], { ...OLD_ISSUE, labels: [] })), 'a stalled move is not an orphan');
});

test('a second-generation rollover: the first replacement keeps its marker, and only the live pair is resumable', () => {
  const none = { state: 'none', replacement: null, extras: [] };
  const GEN0 = { number: 10, state: 'closed', labels: [], body: '' };
  // R1 rolled over to R2 and the label moved on: R1 is closed and unlabeled, its marker still names #10.
  const r1Closed = candidate(20, { state: 'closed', body: digestReplacementMarker(10) });
  assert.deepStrictEqual(classifyRolloverResume([r1Closed], GEN0), none, 'R1 against closed gen-0 is a finished past, not a stall');
  // R2 continues R1 while R1 is still the open, labeled container: an interrupted rollover.
  const r1Open = { number: 20, state: 'open', labels: [{ name: 'digest' }], body: digestReplacementMarker(10) };
  const r2 = candidate(30, { body: digestReplacementMarker(20) });
  assert.deepStrictEqual(classifyRolloverResume([r2], r1Open), { state: 'resume', replacement: 30, extras: [] });
  // Once it finishes, R1 is closed and R2 holds the label.
  const r1Done = { ...r1Open, state: 'closed', labels: [] };
  const r2Done = { ...r2, labels: [{ name: 'digest' }] };
  assert.deepStrictEqual(classifyRolloverResume([r2Done], r1Done), { state: 'finished', replacement: 30, extras: [] });
  assert.deepStrictEqual(classifyRolloverResume([r1Closed], GEN0), none, 'and the earlier pair stays quiet');
});

test('classifyRolloverResume treats a closed old issue with a labeled replacement as finished', () => {
  const labeled = { labels: [{ name: 'digest' }] };
  const closedNoLabel = { ...OLD_ISSUE, state: 'closed', labels: [] };
  assert.deepStrictEqual(
    classifyRolloverResume([candidate(10, labeled), candidate(11)], closedNoLabel),
    { state: 'finished', replacement: 10, extras: [11] },
  );
  assert.strictEqual(classifyRolloverResume([candidate(10, labeled)], { ...closedNoLabel, state: 'CLOSED' }).state, 'finished');
  assert.strictEqual(classifyRolloverResume([candidate(10)], { ...OLD_ISSUE, state: 'closed' }).state, 'resume', 'closed but still labeled: the label move is unfinished');
});

test('classifyRolloverResume picks the lowest-numbered of several and lists the others as extras', () => {
  const out = classifyRolloverResume(
    [candidate(12), candidate(10), candidate(11), candidate(9, { author_association: 'NONE' })],
    OLD_ISSUE,
  );
  assert.deepStrictEqual(out, { state: 'resume', replacement: 10, extras: [11, 12] });
});

test('classifyRolloverResume refuses a non-array candidate list and a non-object old issue', () => {
  const refused = { name: 'CarryOverInputError' };
  for (const bad of [{}, 'x', null, undefined]) assert.throws(() => classifyRolloverResume(bad, OLD_ISSUE), refused, String(bad));
  for (const bad of [null, 'x', [], undefined, {}]) assert.throws(() => classifyRolloverResume([candidate(10)], bad), refused, JSON.stringify(bad));
});

test('classifyRolloverResume refuses a candidate without an integer number and ignores the old issue itself', () => {
  const none = { state: 'none', replacement: null, extras: [] };
  const refused = { name: 'CarryOverInputError' };
  assert.throws(() => classifyRolloverResume([candidate(undefined)], OLD_ISSUE), refused);
  assert.throws(() => classifyRolloverResume([candidate('10')], OLD_ISSUE), refused);
  assert.throws(() => classifyRolloverResume([candidate('11'), candidate(12)], OLD_ISSUE), refused);
  assert.deepStrictEqual(classifyRolloverResume([candidate(123)], OLD_ISSUE), none, 'the old issue is never its own replacement');
  assert.deepStrictEqual(classifyRolloverResume([candidate(123), candidate(10)], OLD_ISSUE), { state: 'resume', replacement: 10, extras: [] });
});

test('classifyRolloverResume reads the state casing gh returns', () => {
  const labeled = candidate(10, { labels: [{ name: 'digest' }] });
  assert.strictEqual(classifyRolloverResume([candidate(10)], { ...OLD_ISSUE, state: 'OPEN' }).state, 'resume');
  assert.strictEqual(classifyRolloverResume([labeled], { ...OLD_ISSUE, state: 'OPEN', labels: [] }).state, 'resume', 'an OPEN old issue is not finished');
  assert.strictEqual(classifyRolloverResume([labeled], { ...OLD_ISSUE, state: 'CLOSED', labels: [] }).state, 'finished');
});

test('classifyRolloverResume refuses a candidate with no author association and an old issue with no state', () => {
  const refused = { name: 'CarryOverInputError' };
  const { author_association: _dropped, ...noAssociation } = candidate(10);
  assert.throws(() => classifyRolloverResume([noAssociation], OLD_ISSUE), refused);
  assert.throws(() => classifyRolloverResume([candidate(10), 'x'], OLD_ISSUE), refused);
  const { state: _state, ...noState } = OLD_ISSUE;
  assert.throws(() => classifyRolloverResume([candidate(10)], noState), refused);
  assert.throws(() => classifyRolloverResume([], { ...OLD_ISSUE, state: '' }), refused);
});
