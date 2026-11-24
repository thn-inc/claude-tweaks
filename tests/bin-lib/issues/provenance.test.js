'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { resolveProvenance, issueAuthorTrust, PRODUCERS } = require('../../../plugin/bin/lib/issues/provenance.js');
const { ORIGINS } = require('../../../plugin/bin/lib/issues/record.js');

test('PRODUCERS is record.js ORIGINS, not a second copy', () => {
  assert.deepEqual(PRODUCERS, ORIGINS);
});

test('a by:* label resolves to its producer', () => {
  assert.deepEqual(
    resolveProvenance({ labels: ['by:code-health', 'ready'], body: '' }),
    { kind: 'producer', source: 'code-health' }
  );
});

test('an unknown by:* label is not treated as a producer', () => {
  // Guards against a stray label inventing a trust class.
  assert.deepEqual(
    resolveProvenance({ labels: ['by:something-else'], body: '' }),
    { kind: 'human', source: 'human' }
  );
});

test('an Origin body line resolves to a side-effect class', () => {
  assert.deepEqual(
    resolveProvenance({ labels: [], body: 'Origin: ledger resolve gate\n\nSome text.' }),
    { kind: 'side-effect', source: 'ledger resolve gate' }
  );
});

test('the trailing "from ..." clause is stripped so the class is not per-record', () => {
  const a = resolveProvenance({ labels: [], body: 'Origin: wrap-up leftover from #42' });
  const b = resolveProvenance({ labels: [], body: 'Origin: wrap-up leftover from #91' });
  assert.equal(a.source, 'wrap-up leftover');
  assert.deepEqual(a, b);
});

test('"from session recall" collapses to the same class as "from #N"', () => {
  const byNumber = resolveProvenance({ labels: [], body: 'Origin: demo changes-requested from #17' });
  const byRecall = resolveProvenance({ labels: [], body: 'Origin: demo changes-requested from session recall' });
  assert.equal(byNumber.source, 'demo changes-requested');
  assert.deepEqual(byNumber, byRecall);
});

test('a parenthetical qualifier is a distinct class, not noise', () => {
  const plain = resolveProvenance({ labels: [], body: 'Origin: ledger resolve gate' });
  const ack = resolveProvenance({ labels: [], body: 'Origin: ledger resolve gate (acknowledged)' });
  assert.notEqual(plain.source, ack.source);
  assert.equal(ack.source, 'ledger resolve gate (acknowledged)');
});

test('a label beats an Origin line when both are present', () => {
  assert.deepEqual(
    resolveProvenance({ labels: ['by:capture'], body: 'Origin: wrap-up leftover from #42' }),
    { kind: 'producer', source: 'capture' }
  );
});

test('neither signal means human-filed', () => {
  assert.deepEqual(
    resolveProvenance({ labels: ['bug'], body: 'Just a description.' }),
    { kind: 'human', source: 'human' }
  );
  assert.deepEqual(resolveProvenance({}), { kind: 'human', source: 'human' });
});

test('Origin is only recognized at the start of a line', () => {
  // Prose mentioning the convention must not be read as a provenance claim.
  assert.deepEqual(
    resolveProvenance({ labels: [], body: 'We write Origin: wrap-up leftover in the body.' }),
    { kind: 'human', source: 'human' }
  );
});

test('structured Origins with "from ..." are preserved and not truncated', () => {
  // Emitted forms like these should NOT be truncated.
  const r1 = resolveProvenance({ labels: [], body: 'Origin: wrap-up leftover from #42' });
  assert.equal(r1.source, 'wrap-up leftover');

  const r2 = resolveProvenance({ labels: [], body: 'Origin: ledger resolve gate (acknowledged) from session recall' });
  assert.equal(r2.source, 'ledger resolve gate (acknowledged)');
});

test('a period inside a version/phase number (Phase 8.5) does NOT truncate', () => {
  // This is a real emitted context. The period in "8.5" is not a clause boundary.
  assert.deepEqual(
    resolveProvenance({ labels: [], body: 'Origin: /init doc registry (Phase 8.5) from #99' }),
    { kind: 'side-effect', source: '/init doc registry (phase 8.5)' }
  );
});

test('a period inside a filename (.md) followed by punctuation does NOT truncate', () => {
  // Legacy records may have prose like "specs/inbox.md', deleted by..."
  // The period in ".md" should NOT truncate; only comma+space should.
  const source = resolveProvenance({
    labels: [],
    body: "Origin: migrated from 'specs/inbox.md', deleted by the 6.36.0 legacy purge"
  }).source;
  assert.equal(source, "migrated from 'specs/inbox.md'");
});

test('clause boundary: comma followed by space truncates', () => {
  // Legacy records that differ only after the first comma should collapse.
  const a = resolveProvenance({
    labels: [],
    body: 'Origin: migrated from inbox.md, captured 2026-06-14. category: technical.'
  });
  const b = resolveProvenance({
    labels: [],
    body: 'Origin: migrated from inbox.md, captured 2026-06-13. category: technical.'
  });
  assert.equal(a.source, 'migrated from inbox.md');
  assert.deepEqual(a, b);
});

test('clause boundary: period followed by space truncates', () => {
  const source = resolveProvenance({
    labels: [],
    body: 'Origin: gap found while auditing v6.36.0. plan c task 6 was never executed.'
  }).source;
  assert.equal(source, 'gap found while auditing v6.36.0');
});

test('a source at exactly 60 characters or less is accepted as-is', () => {
  // Structured contexts within the limit are returned exactly.
  const source = resolveProvenance({
    labels: [],
    body: 'Origin: this context is exactly at the limit now'
  }).source;
  assert.ok(source.length <= 60);
  assert.notEqual(source, 'unstructured');
});

// Fix 1: Reverse order — clause-truncate FIRST, then strip trailing source
test('"from #N" followed by trailing period is correctly stripped', () => {
  // The trailing "from #42." pattern should be stripped even when followed by
  // punctuation. This requires truncating first, then stripping.
  const a = resolveProvenance({
    labels: [],
    body: 'Origin: wrap-up leftover from #42.'
  });
  const b = resolveProvenance({
    labels: [],
    body: 'Origin: wrap-up leftover from #91.'
  });
  assert.equal(a.source, 'wrap-up leftover');
  assert.deepEqual(a, b);
});

// Fix 2: Bracket-depth-aware clause boundaries
test('comma inside parentheses does NOT truncate the clause', () => {
  // A comma inside a parenthetical context should not be treated as a clause
  // boundary. "(acknowledged, needs re-check)" is a single semantic unit.
  const a = resolveProvenance({
    labels: [],
    body: 'Origin: ledger resolve gate (acknowledged, needs re-check)'
  });
  const b = resolveProvenance({
    labels: [],
    body: 'Origin: ledger resolve gate (acknowledged, already closed)'
  });
  // Both should capture the full context, not truncate at the internal comma.
  assert.equal(a.source, 'ledger resolve gate (acknowledged, needs re-check)');
  assert.equal(b.source, 'ledger resolve gate (acknowledged, already closed)');
  // They are distinct contexts, not merged.
  assert.notEqual(a.source, b.source);
});

// Fix 3: Blind slice can cause false merges; cap should return kind: 'unstructured'
test('a source exceeding 60 chars becomes kind "unstructured" to prevent false merges', () => {
  // A context that is still over 60 chars after truncation is not a structured
  // origin—it is freeform prose. Return kind: 'unstructured' to distinguish
  // overflow from side-effect. This is unforgeable by construction: a real
  // Origin line always yields kind: 'side-effect', never kind: 'unstructured'.
  const veryLong = 'this is an extremely long side-effect context that nobody should ever write because it defeats the trust table';
  const result = resolveProvenance({
    labels: [],
    body: 'Origin: ' + veryLong
  });
  assert.equal(result.kind, 'unstructured');
  assert.equal(result.source, 'unstructured');
});

// Fix Round 2, Finding A: Negative depth corrupts bracket tracking
test('unmatched closing bracket early on does NOT corrupt nested brackets later', () => {
  // An unmatched ')' should not drive depth negative, which would corrupt the
  // tracking of a subsequent well-formed '(...)' pair. Both records should stay
  // distinct despite sharing a prefix.
  const a = resolveProvenance({
    labels: [],
    body: 'Origin: a) (b, c), d'
  });
  const b = resolveProvenance({
    labels: [],
    body: 'Origin: a) (b, x), y'
  });
  // Both should capture the full '(b, ...)' unit, not truncate at the comma.
  assert.equal(a.source, 'a) (b, c)');
  assert.equal(b.source, 'a) (b, x)');
  // They are distinct, not merged.
  assert.notEqual(a.source, b.source);
});

test('unbalanced opening bracket is tolerated (prose artifact)', () => {
  // Text like "a (b, c" with unclosed paren should not crash; the bracket never
  // closes, so the comma never reads as depth-zero. This is defensive.
  const source = resolveProvenance({
    labels: [],
    body: 'Origin: a (b, c'
  }).source;
  // No truncation should occur; returns the full text.
  assert.equal(source, 'a (b, c');
});

test('unbalanced closing bracket at line start is tolerated', () => {
  // Text like ") b, c" should not crash. The closing bracket floors at depth zero.
  const source = resolveProvenance({
    labels: [],
    body: 'Origin: ) b, c'
  }).source;
  // Should truncate at the comma after "b", which is at depth zero.
  assert.equal(source, ') b');
});

// Fix Round 3: Overflow kind is unforgeable by construction
test('a genuine Origin line reading "unstructured" does NOT collide with overflow', () => {
  // A real Origin body line that is exactly the word "unstructured" yields
  // kind: 'side-effect' (it came from an Origin line). An overlong context
  // yields kind: 'unstructured' (it overflowed the length cap). Same source
  // value, different kind — no collision. kind: 'unstructured' is unforgeable
  // because only the length-cap code path sets it; real Origin prose cannot.
  const genuine = resolveProvenance({
    labels: [],
    body: 'Origin: unstructured'
  });
  const overflow = resolveProvenance({
    labels: [],
    body: 'Origin: ' + 'x'.repeat(70)
  });
  // Genuine Origin line: kind is 'side-effect', source is 'unstructured'.
  assert.equal(genuine.kind, 'side-effect');
  assert.equal(genuine.source, 'unstructured');
  // Overlong Origin line: kind is 'unstructured', source is 'unstructured'.
  assert.equal(overflow.kind, 'unstructured');
  assert.equal(overflow.source, 'unstructured');
  // They have the same source but different kinds — no collision.
  assert.notEqual(genuine.kind, overflow.kind);
});

// An Origin line that normalizes to nothing must not merge into a real class.
test('an Origin line that normalizes to empty is ungradable, never human', () => {
  // "Origin: ." truncates at the leading period and leaves nothing. Resolving
  // that to human:human would be a false MERGE into a real trust class — the
  // strictly worse direction. It resolves to the classifier's own bucket.
  for (const body of ['Origin: .', 'Origin: ,', 'Origin: . more text here', 'Origin:   ']) {
    assert.deepEqual(
      resolveProvenance({ labels: [], body }),
      { kind: 'unstructured', source: 'empty-origin' },
      `${JSON.stringify(body)} must not resolve to a real class`
    );
  }
});

test('a bare "Origin:" line is malformed provenance, not absent provenance', () => {
  // Same hazard as above, reached through the line regex rather than through
  // normalization: an Origin marker with no context at all is not the absence
  // of a marker, which is what human:human means.
  assert.deepEqual(
    resolveProvenance({ labels: [], body: 'Origin:\n\nSome description.' }),
    { kind: 'unstructured', source: 'empty-origin' }
  );
});

test('the empty-origin bucket is unforgeable by a genuine Origin line', () => {
  // A real body line reading "Origin: empty-origin" is a side-effect class,
  // keyed 'side-effect:empty-origin' — distinct from the classifier's own
  // 'unstructured:empty-origin'. Same collision argument as the overflow case.
  const genuine = resolveProvenance({ labels: [], body: 'Origin: empty-origin' });
  assert.equal(genuine.kind, 'side-effect');
  assert.equal(genuine.source, 'empty-origin');
});

test('"Origin: from #42" is a per-record split, not a merge into a real class', () => {
  // TRAILING_SOURCE requires whitespace before "from", so a bare leading
  // "from #42" is not stripped and this resolves to its own single-sample
  // side-effect class. That is a false SPLIT — the safe direction, and it can
  // never reach MIN_SAMPLES — so the normalizer is deliberately left alone
  // here. Pinned so the behavior is visible rather than assumed.
  const result = resolveProvenance({ labels: [], body: 'Origin: from #42' });
  assert.equal(result.kind, 'side-effect');
  assert.notEqual(result.source, 'human');
});

// Untested behavior change: reordering means trailing source inside clause is stripped
test('a "from #N" reference inside a clause boundary is stripped, not preserved', () => {
  // Reordering (truncate first, then strip) means that "captured from #42, ..."
  // truncates at the comma first, yielding "captured from #42", which then has
  // the "from #42" stripped, leaving just "captured". This is the intended
  // direction (normalizing away per-record references), but was not explicitly
  // tested until now.
  const source = resolveProvenance({
    labels: [],
    body: 'Origin: captured from #42, more details here'
  }).source;
  assert.equal(source, 'captured');
});

// Latent issue: unclosed opening bracket drives depth high, preventing truncation.
// Two such records differing only in a trailing id will overflow to kind: 'unstructured'.
// This is a recorded decision (safe-direction behavior), not accidental.
test('unclosed opening bracket stays high-depth, so long tails overflow to kind unstructured', () => {
  // An unclosed '(' drives depth to 1 and stays there; no comma after it can ever
  // trigger truncation. A very long tail after the bracket pushes past 60 chars
  // and overflows to kind: 'unstructured'. Two records differing only in a
  // trailing id will both overflow honestly as kind: 'unstructured' rather than
  // create a false named class. This is the safe direction — no bracket-repair
  // logic is added; we accept the overflow as correct.
  const a = resolveProvenance({
    labels: [],
    body: 'Origin: captured (incomplete context for ID #42 ' + 'x'.repeat(40) + ')'
  });
  const b = resolveProvenance({
    labels: [],
    body: 'Origin: captured (incomplete context for ID #91 ' + 'x'.repeat(40) + ')'
  });
  // Both overflow the 60-char cap (untruncated tail is very long).
  assert.equal(a.kind, 'unstructured');
  assert.equal(b.kind, 'unstructured');
  // They both have the same honest label, not a false shared named class.
  assert.deepEqual(a, b);
});

test('AC1.1: an untrusted author\'s Origin line joins no side-effect class', () => {
  assert.deepEqual(
    resolveProvenance({ labels: [], body: 'Origin: demo changes-requested from #7', authorTrust: 'untrusted' }),
    { kind: 'human', source: 'human' }
  );
});

test('AC2.1: a trusted author\'s Origin line still resolves its class', () => {
  assert.deepEqual(
    resolveProvenance({ labels: [], body: 'Origin: demo changes-requested from #7', authorTrust: 'trusted' }),
    { kind: 'side-effect', source: 'demo changes-requested' }
  );
});

test('AC2.1: an unknown author\'s Origin line still resolves its class (fail open)', () => {
  assert.deepEqual(
    resolveProvenance({ labels: [], body: 'Origin: demo changes-requested from #7', authorTrust: 'unknown' }),
    { kind: 'side-effect', source: 'demo changes-requested' }
  );
});

test('AC3.1: an omitted authorTrust leaves the Origin line resolving its class', () => {
  assert.deepEqual(
    resolveProvenance({ labels: [], body: 'Origin: demo changes-requested from #7' }),
    { kind: 'side-effect', source: 'demo changes-requested' }
  );
});

test('a producer label still wins for an untrusted author', () => {
  assert.deepEqual(
    resolveProvenance({ labels: ['by:capture'], body: 'Origin: demo changes-requested from #7', authorTrust: 'untrusted' }),
    { kind: 'producer', source: 'capture' }
  );
});

test('an untrusted malformed Origin line resolves human, not unstructured', () => {
  for (const body of ['Origin: .', 'Origin: ' + 'x'.repeat(80)]) {
    assert.deepEqual(
      resolveProvenance({ labels: [], body, authorTrust: 'untrusted' }),
      { kind: 'human', source: 'human' }
    );
  }
});

test('issueAuthorTrust classifies a record by its author', () => {
  const rows = [
    [{ authorAssociation: 'OWNER' }, 'trusted'],
    [{ authorAssociation: 'MEMBER' }, 'trusted'],
    [{ authorAssociation: 'COLLABORATOR' }, 'trusted'],
    [{ authorAssociation: 'NONE' }, 'untrusted'],
    [{ authorAssociation: 'CONTRIBUTOR' }, 'untrusted'],
    [{ authorAssociation: 'member' }, 'untrusted'],
    [{ author_association: 'MEMBER' }, 'trusted'],
    [{ author_association: 'NONE' }, 'untrusted'],
    [{ authorAssociation: 'CONTRIBUTOR', author: { is_bot: true } }, 'trusted'],
    [{ author_association: 'NONE', user: { type: 'Bot' } }, 'trusted'],
    [{ author: { is_bot: true } }, 'trusted'],
    [{ user: { type: 'Bot' } }, 'trusted'],
    [{}, 'unknown'],
    [{ author: { is_bot: false } }, 'unknown'],
    [null, 'unknown'],
    [{ authorAssociation: '' }, 'unknown'],
  ];
  for (const [record, expected] of rows) {
    assert.equal(issueAuthorTrust(record), expected, JSON.stringify(record));
  }
});

test('AC1.1: an Origin line under an ## Absorbed: section is not the record\'s own (#4502)', () => {
  const body = ['## Current State', 'x', '## Absorbed: 2026-10-30 — x', 'Origin: demo changes-requested from #7'].join('\n');
  assert.deepStrictEqual(resolveProvenance({ labels: [], body }), { kind: 'human', source: 'human' });
});
test('AC2.1: a body whose only Origin line is fenced resolves human (backtick and tilde)', () => {
  for (const f of ['```', '~~~']) {
    assert.deepStrictEqual(resolveProvenance({ labels: [], body: ['## Current State', f, 'Origin: ledger resolve gate', f].join('\n') }), { kind: 'human', source: 'human' }, f);
  }
});
test('AC3.1: an Origin line under ## Original request still resolves its class', () => {
  const body = ['## Current State', 'x', '## Original request', 'Origin: ledger resolve gate (#4368 review)'].join('\n');
  assert.deepStrictEqual(resolveProvenance({ labels: [], body }), { kind: 'side-effect', source: 'ledger resolve gate (#4368 review)' });
});
test('AC4.1: an own top line beats an absorbed one', () => {
  const body = ['Origin: wrap-up leftover from #3', '## Absorbed: 2026-10-30 — x', 'Origin: demo changes-requested from #7'].join('\n');
  assert.deepStrictEqual(resolveProvenance({ labels: [], body }), { kind: 'side-effect', source: 'wrap-up leftover' });
});
test('AC5.1: a line after the absorbed section\'s next ## heading counts again', () => {
  const body = ['## Absorbed: 2026-10-30 — x', 'Origin: demo scope-fork', '## Original request', 'Origin: ledger resolve gate'].join('\n');
  assert.deepStrictEqual(resolveProvenance({ labels: [], body }), { kind: 'side-effect', source: 'ledger resolve gate' });
});
test('AC6.1: a bare Origin: line still yields unstructured:empty-origin', () => {
  assert.deepStrictEqual(resolveProvenance({ labels: [], body: 'Origin:\n\n## Current State' }), { kind: 'unstructured', source: 'empty-origin' });
});
test('AC7.1: CRLF bodies resolve the same as LF', () => {
  const lines = ['## Absorbed: 2026-10-30 — x', 'Origin: demo scope-fork', '## Original request', 'Origin: ledger resolve gate'];
  assert.deepStrictEqual(resolveProvenance({ labels: [], body: lines.join('\r\n') }), resolveProvenance({ labels: [], body: lines.join('\n') }));
  const fencedOnly = ['```', 'Origin: ledger resolve gate', '```'];
  assert.deepStrictEqual(resolveProvenance({ labels: [], body: fencedOnly.join('\r\n') }), { kind: 'human', source: 'human' });
});
