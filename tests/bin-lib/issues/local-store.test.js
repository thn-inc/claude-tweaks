'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_DIR, readRecord, writeRecord, allocateId, createRecord, queryRecords, closeRecord, deriveSlug, markShipped } = require('../../../plugin/bin/lib/issues/local-store');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('DEFAULT_DIR is specs', () => {
  assert.strictEqual(DEFAULT_DIR, 'specs');
});

// --- round-trip (AC 5) ---

test('writeRecord then readRecord round-trips facets, id, slug, title, and body', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '14-bar.md');
  const facets = {
    type: 'feature', origin: 'capture', risk: 'medium', size: 'low', ceremony: 'fast-lane', solutionUnjustified: true, breaking: false, needsDefinition: false, priority: null,
    stage: 'parked', grants: { build: false, merge: false }, bot: { inProgress: false, blocked: false, parked: false },
    parent: 12, isParentIssue: false, notPlanned: false, blockedBy: [12, 7], unsynced: true, acceptance: null, closed: false, closedAt: null, shipped: null,
  };

  writeRecord(filePath, { title: 'Bar', body: 'Current State…', facets });
  const record = readRecord(filePath);

  assert.deepStrictEqual(record.facets, facets);
  assert.strictEqual(record.id, 14);
  assert.strictEqual(record.slug, 'bar');
  assert.strictEqual(record.title, 'Bar');
  assert.strictEqual(record.body, 'Current State…');
  assert.strictEqual(record.path, filePath);
});

test('writeRecord omits default/absent frontmatter keys from the written file', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '1-min.md');
  writeRecord(filePath, {
    title: 'Min', body: 'b',
    facets: {
      type: 'task', origin: null, risk: null, size: null, ceremony: null, solutionUnjustified: false, needsDefinition: false, priority: null,
      stage: 'backlog', grants: { build: false, merge: false }, bot: { inProgress: false, blocked: false },
      parent: null, isParentIssue: false, blockedBy: [], unsynced: false, acceptance: null, closed: false, closedAt: null, shipped: null,
    },
  });
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(!/^stage:/m.test(raw), 'must not write default stage: backlog');
  assert.ok(!/^grants:/m.test(raw), 'must not write empty grants: []');
  assert.ok(!/^unsynced:/m.test(raw), 'must not write unsynced: false');
  assert.ok(!/^parent:/m.test(raw), 'must not write parent when null');
  assert.ok(!/^is-parent-issue:/m.test(raw), 'must not write is-parent-issue: false');
  assert.ok(!/^blocked-by:/m.test(raw), 'must not write blocked-by when empty');
  assert.ok(!/^origin:/m.test(raw), 'must not write origin when null');
  assert.ok(!/^closed:/m.test(raw), 'must not write closed: false');
  assert.ok(!/^closed-at:/m.test(raw), 'must not write closed-at when null');
  assert.ok(!/^shipped:/m.test(raw), 'must not write shipped when null');
  assert.ok(!/^solution-unjustified:/m.test(raw), 'must not write solution-unjustified: false');
  assert.ok(/^type: task$/m.test(raw), 'must still write the non-default type key');

  // and it still round-trips to the same facets (omission is lossless)
  const record = readRecord(filePath);
  assert.strictEqual(record.facets.stage, 'backlog');
  assert.deepStrictEqual(record.facets.grants, { build: false, merge: false });
  assert.strictEqual(record.facets.unsynced, false);
  assert.strictEqual(record.facets.closed, false);
  assert.strictEqual(record.facets.closedAt, null);
  assert.strictEqual(record.facets.shipped, null);
  assert.strictEqual(record.facets.isParentIssue, false);
  assert.strictEqual(record.facets.solutionUnjustified, false);
});

// review finding (record #472, lens 3a): needsDefinition: true was silently
// dropped on write/read — no test exercised the true case. Mirrors the
// solutionUnjustified: true round-trip coverage above.
test('writeRecord then readRecord round-trips needsDefinition: true', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '2-needs-def.md');
  writeRecord(filePath, {
    title: 'Needs def', body: 'b',
    facets: {
      type: 'task', origin: null, risk: null, size: null, ceremony: null, solutionUnjustified: false, needsDefinition: true, priority: null,
      stage: 'backlog', grants: { build: false, merge: false }, bot: { inProgress: false, blocked: false },
      parent: null, isParentIssue: false, blockedBy: [], unsynced: false, acceptance: null, closed: false, closedAt: null, shipped: null,
    },
  });
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(/^needs-definition: true$/m.test(raw), 'must write needs-definition: true');
  assert.strictEqual(readRecord(filePath).facets.needsDefinition, true);
});

// --- size facet (renamed from effort, record #217) ---
// The emit side is size-only; the read side keeps a PERMANENT effort: fallback so
// records written by a pre-rename repo still resolve their size facet.

test('writeRecord emits the size facet as a size: line and never an effort: line', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '1-sized.md');
  writeRecord(filePath, { title: 'Sized', body: 'b', facets: baseFacets({ size: 'medium' }) });

  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(/^size: medium$/m.test(raw), 'must write the facet under the size: key');
  assert.ok(!/^effort:/m.test(raw), 'must never emit a pre-rename effort: line');
  assert.strictEqual(readRecord(filePath).facets.size, 'medium');

  const withoutSize = path.join(dir, '2-unsized.md');
  writeRecord(withoutSize, { title: 'Unsized', body: 'b', facets: baseFacets() });
  assert.ok(!/^size:/m.test(fs.readFileSync(withoutSize, 'utf8')), 'must not write size when null');
  assert.strictEqual(readRecord(withoutSize).facets.size, null);
});

test('a pre-rename record file carrying only an effort: line reads back as facets.size', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '3-legacy.md');
  // Hand-written, not via writeRecord: a record created before the rename, by
  // this repo or by another one that still writes effort:.
  fs.writeFileSync(filePath, '---\ntype: feature\neffort: high\n---\n\n# Legacy\n\nbody\n');

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.size, 'high', 'the pre-rename effort: line must resolve the size facet');
  assert.strictEqual(record.facets.effort, undefined, 'no stray effort key survives on the parsed facets');

  // Rewriting a legacy record migrates the key: size: out, effort: gone.
  writeRecord(filePath, { title: record.title, body: record.body, facets: record.facets });
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(/^size: high$/m.test(raw));
  assert.ok(!/^effort:/m.test(raw));
});

// The precedence rule, stated once: size: always wins over a pre-rename effort:
// line, in BOTH line orders — the fallback is held aside during the parse and
// applied only when no size: line was seen, so it is never order-dependent.
test('size: wins over a pre-rename effort: line whichever order the two lines appear in', (t) => {
  const dir = tmp(t);

  const sizeFirst = path.join(dir, '1-size-first.md');
  fs.writeFileSync(sizeFirst, '---\ntype: task\nsize: low\neffort: high\n---\n\n# A\n\nbody\n');
  assert.strictEqual(readRecord(sizeFirst).facets.size, 'low', 'size: before effort: must win');

  const effortFirst = path.join(dir, '2-effort-first.md');
  fs.writeFileSync(effortFirst, '---\ntype: task\neffort: high\nsize: low\n---\n\n# B\n\nbody\n');
  assert.strictEqual(readRecord(effortFirst).facets.size, 'low', 'size: after effort: must still win');
});

// --- isParentIssue (parent-issue marker) ---

test('writeRecord then readRecord round-trips isParentIssue: true as an is-parent-issue: true frontmatter line', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '1-parent.md');
  writeRecord(filePath, {
    title: 'Parent',
    body: 'Design summary',
    facets: {
      type: 'feature', origin: null, risk: null, size: null, ceremony: null, priority: null,
      stage: 'backlog', grants: { build: false, merge: false }, bot: { inProgress: false, blocked: false },
      parent: null, isParentIssue: true, blockedBy: [], unsynced: false, acceptance: null, closed: false, closedAt: null,
    },
  });

  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(/^is-parent-issue: true$/m.test(raw), 'must write is-parent-issue: true when the facet is true');

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.isParentIssue, true);
});

test('a pre-existing record file with frontmatter but no is-parent-issue line reads back isParentIssue: false (backward compatibility)', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '2-old.md');
  // Hand-written, not via writeRecord: simulates a record created before this
  // facet existed — some frontmatter present, but no is-parent-issue line at all.
  fs.writeFileSync(filePath, '---\ntype: feature\n---\n\n# Old Parent\n\nbody\n');

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.type, 'feature');
  assert.strictEqual(record.facets.isParentIssue, false, 'an absent is-parent-issue line must default to false, not throw or come back undefined');
});

test('createRecord with isParentIssue: true is findable via queryRecords, and ordinary records are not', (t) => {
  const dir = tmp(t);
  const parent = createRecord(dir, {
    slug: 'the-parent', title: 'The Parent', body: 'Design summary',
    facets: baseFacets({ type: 'feature', isParentIssue: true }),
  });
  createRecord(dir, {
    slug: 'a-leaf', title: 'A Leaf', body: 'leaf body',
    facets: baseFacets({ type: 'feature', parent: parent.id, stage: 'ready' }),
  });

  const parents = queryRecords(dir, { isParentIssue: true });
  assert.strictEqual(parents.length, 1);
  assert.strictEqual(parents[0].id, parent.id);

  closeRecord(parent.path);
  assert.strictEqual(queryRecords(dir, { isParentIssue: true }).length, 0, 'closed parents drop out of the default open-only query');
  assert.strictEqual(queryRecords(dir, { isParentIssue: true, closed: true }).length, 1, 'still findable when explicitly querying closed records');
});

test('a legacy record with family-parent: true frontmatter reads back isParentIssue: true', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '9-legacy-parent.md');
  fs.writeFileSync(filePath, '---\ntype: feature\nfamily-parent: true\n---\n\n# Legacy parent\n\nBody.\n');

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.isParentIssue, true);
});

test('an explicit is-parent-issue: false beats a stray legacy family-parent: true (held-aside precedence)', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '10-both-lines.md');
  fs.writeFileSync(filePath, '---\ntype: feature\nis-parent-issue: false\nfamily-parent: true\n---\n\n# Both lines\n\nBody.\n');

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.isParentIssue, false,
    'new-beats-legacy: a naive OR would wrongly resolve true');
});

// The precedence rule is order-independent, exactly like size/effort above:
// held-aside application means the legacy line's position relative to the new
// line never matters, only whether a new-form line was seen at all.
test('is-parent-issue: still wins over a stray legacy family-parent: true when family-parent: appears first', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '11-legacy-first.md');
  fs.writeFileSync(filePath, '---\ntype: feature\nfamily-parent: true\nis-parent-issue: false\n---\n\n# Legacy first\n\nBody.\n');

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.isParentIssue, false,
    'family-parent: before is-parent-issue: must still lose to the explicit new-form line');
});

test('rewriting a legacy family-parent: record migrates the key: is-parent-issue: true out, family-parent: gone', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '12-legacy.md');
  // Hand-written, not via writeRecord: a record created before the rename.
  fs.writeFileSync(filePath, '---\ntype: feature\nfamily-parent: true\n---\n\n# Legacy\n\nbody\n');

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.isParentIssue, true, 'the pre-rename family-parent: line must resolve the isParentIssue facet');

  writeRecord(filePath, { title: record.title, body: record.body, facets: record.facets });
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(/^is-parent-issue: true$/m.test(raw), 'must migrate to an is-parent-issue: true line');
  assert.ok(!/^family-parent:/m.test(raw), 'must not carry forward the pre-rename family-parent: line');
});

// --- allocateId (AC 5) ---

test('allocateId returns max numeric prefix + 1', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, '13-foo.md'), 'x');
  assert.strictEqual(allocateId(dir), 14);
});

test('allocateId returns 1 for an empty dir', (t) => {
  const dir = tmp(t);
  assert.strictEqual(allocateId(dir), 1);
});

test('allocateId returns 1 for a missing dir', (t) => {
  const dir = tmp(t);
  assert.strictEqual(allocateId(path.join(dir, 'does-not-exist')), 1);
});

test('allocateId ignores non-matching filenames', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, '13-foo.md'), 'x');
  fs.writeFileSync(path.join(dir, '2-a.md'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'x-9.md'), 'x');
  assert.strictEqual(allocateId(dir), 14);
});

// --- queryRecords (AC 5) ---

function baseFacets(overrides) {
  return Object.assign({
    type: 'task', origin: null, risk: null, size: null, ceremony: null, solutionUnjustified: false, priority: null,
    stage: 'backlog', grants: { build: false, merge: false }, bot: { inProgress: false, blocked: false },
    parent: null, isParentIssue: false, blockedBy: [], unsynced: false, acceptance: null, closed: false, closedAt: null, shipped: null,
  }, overrides);
}

test('queryRecords: stage filter, unsynced filter, and empty filter (returns all)', (t) => {
  const dir = tmp(t);
  writeRecord(path.join(dir, '1-a.md'), { title: 'A', body: 'a', facets: baseFacets({ stage: 'parked' }) });
  writeRecord(path.join(dir, '2-b.md'), { title: 'B', body: 'b', facets: baseFacets({ stage: 'ready', unsynced: true }) });
  writeRecord(path.join(dir, '3-c.md'), { title: 'C', body: 'c', facets: baseFacets({ stage: 'backlog' }) });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored — not a record file');

  const parked = queryRecords(dir, { stage: 'parked' });
  assert.strictEqual(parked.length, 1);
  assert.strictEqual(parked[0].slug, 'a');

  const unsynced = queryRecords(dir, { unsynced: true });
  assert.strictEqual(unsynced.length, 1);
  assert.strictEqual(unsynced[0].slug, 'b');

  const all = queryRecords(dir, {});
  assert.strictEqual(all.length, 3);
});

test('queryRecords matches object-valued facets (grants) with deep equality, not partial match', (t) => {
  const dir = tmp(t);
  writeRecord(path.join(dir, '1-a.md'), { title: 'A', body: 'a', facets: baseFacets({ grants: { build: true, merge: true } }) });
  writeRecord(path.join(dir, '2-b.md'), { title: 'B', body: 'b', facets: baseFacets({ grants: { build: true, merge: false } }) });

  const bothGrants = queryRecords(dir, { grants: { build: true, merge: true } });
  assert.strictEqual(bothGrants.length, 1);
  assert.strictEqual(bothGrants[0].slug, 'a');
});

test('writeRecord then readRecord round-trips the acceptance facet', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '9-demo.md');
  writeRecord(filePath, { title: 'Demo', body: 'b', facets: baseFacets({ acceptance: 'pending' }) });
  const record = readRecord(filePath);
  assert.strictEqual(record.facets.acceptance, 'pending');
});

test('writeRecord omits the acceptance line when null', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '10-none.md');
  writeRecord(filePath, { title: 'None', body: 'b', facets: baseFacets({ acceptance: null }) });
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(!/^acceptance:/m.test(raw), 'must not write acceptance when null');
});

test('queryRecords filters by acceptance facet', (t) => {
  const dir = tmp(t);
  writeRecord(path.join(dir, '1-a.md'), { title: 'A', body: 'a', facets: baseFacets({ acceptance: 'pending' }) });
  writeRecord(path.join(dir, '2-b.md'), { title: 'B', body: 'b', facets: baseFacets({ acceptance: 'approved' }) });
  const pending = queryRecords(dir, { acceptance: 'pending' });
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].slug, 'a');
});

test('queryRecords returns an empty array for a missing dir', (t) => {
  const dir = tmp(t);
  assert.deepStrictEqual(queryRecords(path.join(dir, 'nope'), {}), []);
});

test('writeRecord writes ceremony:{tier}, readRecord reads it back, and a null ceremony writes no line', (t) => {
  const dir = tmp(t);
  const withCeremony = path.join(dir, '1-a.md');
  writeRecord(withCeremony, { title: 'A', body: 'b', facets: baseFacets({ ceremony: 'standard' }) });
  const rawWith = fs.readFileSync(withCeremony, 'utf8');
  assert.ok(/^ceremony: standard$/m.test(rawWith));
  assert.strictEqual(readRecord(withCeremony).facets.ceremony, 'standard');

  const withoutCeremony = path.join(dir, '2-b.md');
  writeRecord(withoutCeremony, { title: 'B', body: 'b', facets: baseFacets() });
  const rawWithout = fs.readFileSync(withoutCeremony, 'utf8');
  assert.ok(!/^ceremony:/m.test(rawWithout));
  assert.strictEqual(readRecord(withoutCeremony).facets.ceremony, null);
});

// solution:unjustified (challenge framing-check) is presence-only for the local-files
// driver too, same convention as unsynced/closed: written only when true, and
// its absence on read is the false default from facet-shape.js's
// sharedFacetDefaults(), never a distinct "open" value. Renamed from framing:
// by record #677 — the legacy line stays readable forever ([IL-85]).
test('writeRecord writes solution-unjustified: true, readRecord reads it back, and a false value writes no line', (t) => {
  const dir = tmp(t);
  const withFlag = path.join(dir, '1-a.md');
  writeRecord(withFlag, { title: 'A', body: 'b', facets: baseFacets({ solutionUnjustified: true }) });
  const rawWith = fs.readFileSync(withFlag, 'utf8');
  assert.ok(/^solution-unjustified: true$/m.test(rawWith));
  assert.ok(!/^framing:/m.test(rawWith), 'emit side never writes the legacy framing: line');
  assert.strictEqual(readRecord(withFlag).facets.solutionUnjustified, true);

  const withoutFlag = path.join(dir, '2-b.md');
  writeRecord(withoutFlag, { title: 'B', body: 'b', facets: baseFacets() });
  const rawWithout = fs.readFileSync(withoutFlag, 'utf8');
  assert.ok(!/^solution-unjustified:/m.test(rawWithout));
  assert.strictEqual(readRecord(withoutFlag).facets.solutionUnjustified, false);
});

// breaking mirrors solutionUnjustified's presence-only convention (#2251): written
// only when true, read as false when the line is absent.
test('writeRecord writes breaking: true, readRecord reads it back, and a false value writes no line', (t) => {
  const dir = tmp(t);
  const withFlag = path.join(dir, '1-brk.md');
  writeRecord(withFlag, { title: 'A', body: 'b', facets: baseFacets({ breaking: true }) });
  const rawWith = fs.readFileSync(withFlag, 'utf8');
  assert.ok(/^breaking: true$/m.test(rawWith));
  assert.strictEqual(readRecord(withFlag).facets.breaking, true);

  const withoutFlag = path.join(dir, '2-nobrk.md');
  writeRecord(withoutFlag, { title: 'B', body: 'b', facets: baseFacets() });
  assert.ok(!/^breaking:/m.test(fs.readFileSync(withoutFlag, 'utf8')));
  assert.strictEqual(readRecord(withoutFlag).facets.breaking, false);
});

test('readRecord: legacy framing: true line reads as solutionUnjustified true (permanent read-side fallback)', (t) => {
  const dir = tmp(t);
  const legacy = path.join(dir, '3-legacy.md');
  fs.writeFileSync(legacy, '---\ntype: task\nframing: true\n---\n# Legacy\n\nb\n');
  assert.strictEqual(readRecord(legacy).facets.solutionUnjustified, true);
  assert.ok(!('framing' in readRecord(legacy).facets), 'no framing key on the read record');

  // Migrate-on-write: rewriting the record emits the new line and drops the legacy one.
  const migrated = readRecord(legacy);
  writeRecord(legacy, { title: migrated.title, body: migrated.body, facets: migrated.facets });
  const rewritten = fs.readFileSync(legacy, 'utf8');
  assert.ok(/^solution-unjustified: true$/m.test(rewritten));
  assert.ok(!/^framing:/m.test(rewritten), 'rewrite must not carry the legacy framing: line forward');
});

test('readRecord: an explicit solution-unjustified: line wins over a legacy framing: line in either order', (t) => {
  const dir = tmp(t);
  const newFirst = path.join(dir, '4-new-first.md');
  fs.writeFileSync(newFirst, '---\ntype: task\nsolution-unjustified: false\nframing: true\n---\n# A\n\nb\n');
  assert.strictEqual(readRecord(newFirst).facets.solutionUnjustified, false);
  const legacyFirst = path.join(dir, '5-legacy-first.md');
  fs.writeFileSync(legacyFirst, '---\ntype: task\nframing: true\nsolution-unjustified: false\n---\n# B\n\nb\n');
  assert.strictEqual(readRecord(legacyFirst).facets.solutionUnjustified, false);
});

// notPlanned mirrors solutionUnjustified's presence-only convention exactly — written only
// when true, absent-on-read falls back to sharedFacetDefaults()' false. Added
// alongside the wontfix-label parse in record.js (refs #513) so both drivers
// carry the shared facet symmetrically.
test('writeRecord writes not-planned: true, readRecord reads it back, and a false notPlanned writes no line', (t) => {
  const dir = tmp(t);
  const withNotPlanned = path.join(dir, '3-c.md');
  writeRecord(withNotPlanned, { title: 'C', body: 'b', facets: baseFacets({ notPlanned: true }) });
  const rawWith = fs.readFileSync(withNotPlanned, 'utf8');
  assert.ok(/^not-planned: true$/m.test(rawWith));
  assert.strictEqual(readRecord(withNotPlanned).facets.notPlanned, true);

  const withoutNotPlanned = path.join(dir, '4-d.md');
  writeRecord(withoutNotPlanned, { title: 'D', body: 'b', facets: baseFacets() });
  const rawWithout = fs.readFileSync(withoutNotPlanned, 'utf8');
  assert.ok(!/^not-planned:/m.test(rawWithout));
  assert.strictEqual(readRecord(withoutNotPlanned).facets.notPlanned, false);
});

// --- malformed file (AC 5) ---

test('readRecord on a file with no frontmatter: type null, stage backlog, body is the whole content', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '5-broken.md');
  fs.writeFileSync(filePath, 'Just plain text, no frontmatter here.\n');

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.type, null);
  assert.strictEqual(record.facets.stage, 'backlog');
  assert.strictEqual(record.body, 'Just plain text, no frontmatter here.');
  assert.strictEqual(record.title, null);
  assert.strictEqual(record.id, 5);
  assert.strictEqual(record.slug, 'broken');
  assert.deepStrictEqual(record.facets.grants, { build: false, merge: false });
  assert.deepStrictEqual(record.facets.bot, { inProgress: false, blocked: false, parked: false });
  assert.deepStrictEqual(record.facets.blockedBy, []);
  assert.strictEqual(record.facets.unsynced, false);
  assert.strictEqual(record.facets.acceptance, null);
  assert.strictEqual(record.facets.closed, false);
  assert.strictEqual(record.facets.closedAt, null);
  assert.strictEqual(record.facets.isParentIssue, false);
});

// --- closure (record #13) ---

test('writeRecord then readRecord round-trips closed and closedAt facets', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '1-a.md');
  writeRecord(filePath, { title: 'A', body: 'a', facets: baseFacets({ closed: true, closedAt: '2026-07-19T12:00:00.000Z' }) });
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(/^closed: true$/m.test(raw));
  assert.ok(/^closed-at: 2026-07-19T12:00:00\.000Z$/m.test(raw));

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.closed, true);
  assert.strictEqual(record.facets.closedAt, '2026-07-19T12:00:00.000Z');
});

test('closeRecord marks a record closed with a timestamp, preserving title, body, and other facets', (t) => {
  const dir = tmp(t);
  const filePath = path.join(dir, '1-a.md');
  writeRecord(filePath, { title: 'A', body: 'Current State…', facets: baseFacets({ stage: 'ready', risk: 'low' }) });

  closeRecord(filePath);

  const record = readRecord(filePath);
  assert.strictEqual(record.facets.closed, true);
  assert.strictEqual(typeof record.facets.closedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(record.facets.closedAt)), 'closedAt must be a parseable timestamp');
  assert.strictEqual(record.facets.stage, 'ready');
  assert.strictEqual(record.facets.risk, 'low');
  assert.strictEqual(record.title, 'A');
  assert.strictEqual(record.body, 'Current State…');
});

test('queryRecords excludes closed:true records by default, matching every pre-existing call site\'s "open, as today" expectation', (t) => {
  const dir = tmp(t);
  writeRecord(path.join(dir, '1-a.md'), { title: 'A', body: 'a', facets: baseFacets({ stage: 'ready' }) });
  writeRecord(path.join(dir, '2-b.md'), { title: 'B', body: 'b', facets: baseFacets({ stage: 'ready', closed: true, closedAt: '2026-07-19T12:00:00.000Z' }) });

  const open = queryRecords(dir, {});
  assert.strictEqual(open.length, 1);
  assert.strictEqual(open[0].slug, 'a');

  const stageFiltered = queryRecords(dir, { stage: 'ready' });
  assert.strictEqual(stageFiltered.length, 1, 'a stage filter with no closed key must still exclude the closed record');
  assert.strictEqual(stageFiltered[0].slug, 'a');
});

test('queryRecords returns closed records only when the caller explicitly filters on closed', (t) => {
  const dir = tmp(t);
  writeRecord(path.join(dir, '1-a.md'), { title: 'A', body: 'a', facets: baseFacets() });
  writeRecord(path.join(dir, '2-b.md'), { title: 'B', body: 'b', facets: baseFacets({ closed: true, closedAt: '2026-07-19T12:00:00.000Z' }) });

  const closedOnly = queryRecords(dir, { closed: true });
  assert.strictEqual(closedOnly.length, 1);
  assert.strictEqual(closedOnly[0].slug, 'b');

  const openOnlyExplicit = queryRecords(dir, { closed: false });
  assert.strictEqual(openOnlyExplicit.length, 1);
  assert.strictEqual(openOnlyExplicit[0].slug, 'a');
});

// --- createRecord (concurrency fix) ---

test('createRecord writes at allocateId\'s candidate id and returns a readRecord-shaped record', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, '5-existing.md'), 'x');

  const record = createRecord(dir, { slug: 'new-idea', title: 'New Idea', body: 'body text', facets: baseFacets({ origin: 'capture' }) });

  assert.strictEqual(record.id, 6);
  assert.strictEqual(record.slug, 'new-idea');
  assert.strictEqual(record.title, 'New Idea');
  assert.strictEqual(record.body, 'body text');
  assert.strictEqual(record.facets.origin, 'capture');
  assert.strictEqual(record.path, path.join(dir, '6-new-idea.md'));
  assert.ok(fs.existsSync(path.join(dir, '6-new-idea.md')));

  // no leftover claim file after a successful create
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.claim')), []);
});

test('createRecord requires a slug', (t) => {
  const dir = tmp(t);
  assert.throws(() => createRecord(dir, { title: 'No slug', body: 'b', facets: baseFacets() }), /requires a slug/);
});

// This is the core proof the race is fixed. It reproduces the EXACT window the
// finding describes: two near-simultaneous callers both read the same directory
// listing (both would compute allocateId(dir) === 2 here) before either has
// written anything. We simulate caller A having already won that id an instant
// earlier by pre-placing A's claim marker (see claimPathFor) at id 2 — this is
// deliberately slug-agnostic, exactly like the real claim file, so it proves the
// fix holds even when the two callers pick DIFFERENT slugs (the likelier
// real-world shape for two independent /capture-style calls) — the naive
// "exclusive-create the final {id}-{slug}.md path" approach would NOT have
// caught this, since two different slugs produce two different filenames that
// would both succeed under that approach and silently share id 2.
test('createRecord: a same-tick competing claim at the candidate id is not silently collided with — the caller advances to the next id', (t) => {
  const dir = tmp(t);
  writeRecord(path.join(dir, '1-first.md'), { title: 'First', body: 'a', facets: baseFacets() });
  assert.strictEqual(allocateId(dir), 2, 'both racing callers would compute the same starting candidate');

  // Caller A wins the race a moment earlier and is mid-write: its claim on id 2
  // already exists on disk (this is exactly what createRecord itself would have
  // just done inside its own loop for a real competing call).
  fs.writeFileSync(path.join(dir, '2.claim'), 'competitor in flight', { flag: 'wx' });

  // Caller B (this test), using a DIFFERENT slug than whatever A intends,
  // starts from the same candidate id 2 but must not collide with A.
  const recordB = createRecord(dir, { slug: 'second-caller', title: 'Second', body: 'b', facets: baseFacets() });

  assert.strictEqual(recordB.id, 3, 'must have skipped the already-claimed id 2 entirely');
  assert.strictEqual(recordB.path, path.join(dir, '3-second-caller.md'));
  assert.ok(fs.existsSync(path.join(dir, '3-second-caller.md')));

  // A's in-flight claim at id 2 is untouched — B never wrote or renamed it.
  assert.ok(fs.existsSync(path.join(dir, '2.claim')));
  assert.strictEqual(fs.readFileSync(path.join(dir, '2.claim'), 'utf8'), 'competitor in flight');

  // No id-2 record was ever created by B, and no file silently shares id 2 with
  // a different name written by B.
  assert.ok(!fs.existsSync(path.join(dir, '2-second-caller.md')));
});

// Drives several createRecord calls against the same directory back-to-back with
// distinct slugs (simulating a burst of near-simultaneous callers before any of
// them would naturally have observed each other's completed writes) and asserts
// every call lands a distinct, correctly-numbered record with no collisions and
// no leftover claim litter.
test('createRecord: a rapid burst of calls against the same directory produces distinct, non-colliding ids', (t) => {
  const dir = tmp(t);
  const slugs = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

  const records = slugs.map((slug) => createRecord(dir, { slug, title: slug, body: 'x', facets: baseFacets() }));

  const ids = records.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'every id must be unique');
  assert.deepStrictEqual([...ids].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);

  // every record actually round-trips from disk at its claimed path
  for (const record of records) {
    const reread = readRecord(record.path);
    assert.strictEqual(reread.id, record.id);
    assert.strictEqual(reread.slug, record.slug);
  }

  // no claim files left behind
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.claim')), []);
});

// Reproduces the exact race the finding describes: two near-simultaneous
// createRecord calls both call allocateId(dir) while the directory is still
// empty and both get id=1. The first caller (A) completes its ENTIRE
// write+rename cycle (finalizing 1-alice.md and freeing 1.claim) before the
// second caller (B) — whose OWN `id` variable was already snapshotted as 1,
// per createRecord's own single up-front allocateId(dir) call — reaches its
// first claim attempt. We simulate B's stale snapshot by making the FIRST
// fs.readdirSync call (the one inside allocateId) see an empty directory,
// then restoring the real fs.readdirSync for every subsequent call (used by
// createRecord's own new finalized-id check) so it sees A's real, already-
// finalized file.
test('createRecord: a stale allocateId snapshot does not silently share an id with a since-finalized record', (t) => {
  const dir = tmp(t);
  writeRecord(path.join(dir, '1-alice.md'), { title: 'Alice', body: 'a', facets: baseFacets() });

  const originalReaddir = fs.readdirSync;
  let first = true;
  fs.readdirSync = function (...args) {
    if (first && args[0] === dir) {
      first = false;
      return [];
    }
    return originalReaddir.apply(fs, args);
  };
  let record;
  try {
    record = createRecord(dir, { slug: 'bob', title: 'Bob', body: 'b', facets: baseFacets() });
  } finally {
    fs.readdirSync = originalReaddir;
  }

  assert.strictEqual(record.id, 2, 'must not silently share id 1 with the already-finalized rival record');
  assert.strictEqual(record.path, path.join(dir, '2-bob.md'));
  assert.ok(fs.existsSync(path.join(dir, '2-bob.md')));
  assert.ok(!fs.existsSync(path.join(dir, '1-bob.md')), 'must never have written a second file under the already-claimed id 1');
  // Exactly one record at id 1 (alice's), not two files sharing the id.
  const idOneFiles = fs.readdirSync(dir).filter((n) => /^1-.*\.md$/.test(n));
  assert.deepStrictEqual(idOneFiles, ['1-alice.md']);
  // No leftover claim litter from B's spurious, released claim.
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.claim')), []);
});

test('createRecord: an EEXIST on the claim retries forward past MULTIPLE already-claimed ids in a row', (t) => {
  const dir = tmp(t);
  // Simulate three competing in-flight claims stacked at the very ids
  // allocateId would hand out next (dir is empty, so allocateId(dir) === 1).
  fs.writeFileSync(path.join(dir, '1.claim'), 'x', { flag: 'wx' });
  fs.writeFileSync(path.join(dir, '2.claim'), 'x', { flag: 'wx' });
  fs.writeFileSync(path.join(dir, '3.claim'), 'x', { flag: 'wx' });

  const record = createRecord(dir, { slug: 'late-arrival', title: 'Late', body: 'b', facets: baseFacets() });

  assert.strictEqual(record.id, 4, 'must skip past every already-claimed id before succeeding');
  assert.ok(fs.existsSync(path.join(dir, '4-late-arrival.md')));
});

// --- deriveSlug ---
// Matches the algorithm previously spelled out in prose in capture/SKILL.md:
// lowercase, collapse runs of non-alphanumeric characters to a single '-',
// trim leading/trailing '-', truncate to 60 chars, dedupe against existing
// slugs with a numeric suffix.

test('deriveSlug lowercases and collapses runs of non-alphanumeric characters to a single dash', () => {
  assert.strictEqual(deriveSlug('Fix Flaky Statusline Test!!'), 'fix-flaky-statusline-test');
  assert.strictEqual(deriveSlug('A/B---Testing   Rollout'), 'a-b-testing-rollout');
});

test('deriveSlug trims leading and trailing separators produced by boundary punctuation', () => {
  assert.strictEqual(deriveSlug('  ---Leading and trailing---  '), 'leading-and-trailing');
  assert.strictEqual(deriveSlug('***Ready***'), 'ready');
});

test('deriveSlug truncates to 60 characters', () => {
  const longTitle = 'a'.repeat(58) + ' b c d e f g'; // collapses to 58 a's, then dash-separated letters
  const slug = deriveSlug(longTitle);
  assert.ok(slug.length <= 60, `expected length <= 60, got ${slug.length}`);
  assert.strictEqual(slug, 'a'.repeat(58) + '-b');
});

test('deriveSlug does not leave a trailing separator when truncation lands exactly on one', () => {
  // Collapsed form is 59 a's, a single '-', then more letters — the 60-char cut
  // point lands exactly on the dash, which must be trimmed off afterward.
  const longTitle = 'a'.repeat(59) + ' bcdef';
  const slug = deriveSlug(longTitle);
  assert.strictEqual(slug, 'a'.repeat(59));
  assert.ok(!slug.endsWith('-'), 'must not end with a trailing separator after truncation');
});

test('deriveSlug returns the base slug unchanged when there is no collision', () => {
  assert.strictEqual(deriveSlug('New Idea', ['existing-one', 'existing-two']), 'new-idea');
});

test('deriveSlug dedupes against existing slugs with a numeric suffix', () => {
  assert.strictEqual(deriveSlug('New Idea', ['new-idea']), 'new-idea-2');
  assert.strictEqual(deriveSlug('New Idea', ['new-idea', 'new-idea-2']), 'new-idea-3');
  assert.strictEqual(deriveSlug('New Idea', ['new-idea', 'new-idea-2', 'new-idea-3']), 'new-idea-4');
});

test('deriveSlug treats a missing existingSlugs argument as no collisions', () => {
  assert.strictEqual(deriveSlug('Plain Title'), 'plain-title');
});

test('deriveSlug falls back to a non-empty slug when the title has no alphanumeric characters', () => {
  const slug = deriveSlug('!!! *** ???');
  assert.ok(slug.length > 0, 'must not produce an empty slug');
  assert.strictEqual(slug, 'untitled');
});

test('shipped facet: absent by default, round-trips as a frontmatter line after closed-at, and closeRecord can set it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-store-shipped-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, '21-ship.md');
  writeRecord(filePath, { title: 'Ship', body: 'b', facets: baseFacets({ type: 'feature' }) });
  assert.strictEqual(readRecord(filePath).facets.shipped, null);
  closeRecord(filePath, { shipped: 'v1.3.0' });
  const text = fs.readFileSync(filePath, 'utf8');
  assert.match(text, /^closed: true$/m);
  assert.match(text, /^shipped: v1\.3\.0$/m);
  assert.ok(text.indexOf('closed-at:') < text.indexOf('shipped:'), 'shipped follows closed-at');
  const back = readRecord(filePath);
  assert.strictEqual(back.facets.shipped, 'v1.3.0');
  assert.strictEqual(back.facets.closed, true);
  const open = path.join(dir, '22-open.md');
  writeRecord(open, { title: 'Open', body: 'b', facets: baseFacets({ type: 'bug' }) });
  markShipped(open, 'v1.3.0');
  assert.deepStrictEqual([readRecord(open).facets.shipped, readRecord(open).facets.closed], ['v1.3.0', false]);
});

test('shipped facet: a value carrying whitespace or a control character is rejected and the file is untouched', (t) => {
  // #2256 defense in depth — the facet serializes as one `shipped: {value}` frontmatter
  // line, so a newline in the value would write a second line into the fence.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-store-shipped-bad-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, '23-ship.md');
  writeRecord(filePath, { title: 'Ship', body: 'b', facets: baseFacets({ type: 'feature' }) });
  const before = fs.readFileSync(filePath, 'utf8');
  assert.throws(() => markShipped(filePath, 'v1.3.0\nclosed: true'), { name: 'TypeError', message: /shipped facet/ });
  assert.throws(() => closeRecord(filePath, { shipped: 'v1.3.0\nclosed: true' }), { name: 'TypeError', message: /shipped facet/ });
  assert.strictEqual(fs.readFileSync(filePath, 'utf8'), before, 'a rejected value writes nothing');
});
