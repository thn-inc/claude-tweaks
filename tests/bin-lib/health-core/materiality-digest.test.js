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
