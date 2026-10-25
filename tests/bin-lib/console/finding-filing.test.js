'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const {
  findingFingerprint, composeFindingProposal, planFilings, fingerprintMap,
} = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'finding-filing'));
const { extractFingerprint } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'record'));

const tiebreak = (over = {}) => ({
  id: '0123456789ab', key: '3a|src/a.js:9', lens: '3a', path: 'src/a.js', line: 9, severity: 'medium', recommendation: 'drop', reason: 'verdict:cant-tell', ...over,
});
const item = (over = {}) => ({
  id: 'tiebreak:0123456789ab', section: 'Low-confidence findings', resolution: 'filed', reason: 'r', tiebreak: tiebreak(), ...over,
});
const finding = (over = {}) => ({
  id: '0123456789ab', lens: '3a', path: 'src/a.js', line: 9, claim: 'The guard runs after the read', reporterSeverity: 'medium', kind: 'unconfirmed', ...over,
});

test('the fingerprint ignores the line and whitespace/case in the claim', () => {
  const a = findingFingerprint({ lens: '3a', path: 'src/a.js', claim: 'The guard  runs\nafter the read' });
  const b = findingFingerprint({ lens: ' 3A ', path: 'src/a.js', claim: 'the guard runs after the READ' });
  assert.strictEqual(a, b);
  assert.match(a, /^consolefinding-[0-9a-f]{8}$/);
  const moved = composeFindingProposal({ item: item({ tiebreak: tiebreak({ line: 400 }) }), finding: finding({ line: 400 }), runId: 'r' });
  assert.strictEqual(moved.fingerprint, composeFindingProposal({ item: item(), finding: finding(), runId: 'r' }).fingerprint);
});

test('different lens or path gives a different fingerprint', () => {
  const base = { lens: '3a', path: 'src/a.js', claim: 'x' };
  assert.notStrictEqual(findingFingerprint(base), findingFingerprint({ ...base, lens: '3b' }));
  assert.notStrictEqual(findingFingerprint(base), findingFingerprint({ ...base, path: 'src/b.js' }));
  assert.notStrictEqual(findingFingerprint(base), findingFingerprint({ ...base, claim: 'y' }));
});

test('a proposal carries the header, needs:definition, the tiebreak reason and recommendation, and the work-fingerprint marker', () => {
  // The reporter's severity differs from the tiebreak's, so the severity assertion pins which one the record carries.
  const { fingerprint, title, proposal } = composeFindingProposal({ item: item(), finding: finding({ reporterSeverity: 'low' }), runId: '2026-10-24T10-00-00-spec-x' });
  assert.strictEqual(title, "Review finding (can't-tell): src/a.js — The guard runs after the read");
  assert.ok(proposal.startsWith(`Title: ${title}\nType: task\nLabels: needs:definition\nDefer-reason: needs-human-decision\n\n`), proposal);
  assert.strictEqual(extractFingerprint(proposal), fingerprint);
  assert.match(proposal, /The guard runs after the read/);
  assert.match(proposal, /src\/a\.js:9/);
  assert.match(proposal, /can't-tell \(verdict:cant-tell\)/);
  assert.match(proposal, /Recommendation: drop/);
  assert.match(proposal, /\(severity medium\)/);
  assert.match(proposal, /2026-10-24T10-00-00-spec-x/);
  assert.match(proposal, /## Open Question\n\nDoes this finding hold at `src\/a\.js:9`\?/);
  assert.match(proposal, /_Filed by `review-console`/);
  assert.ok(!/\bauto:|\bbot:/.test(proposal.split('\n\n')[0]), 'no auto:* or bot:* label');
});

test('a recommendation of none is stated as none, and a long claim is cut to 80 characters in the title only', () => {
  const claim = 'x'.repeat(200);
  const out = composeFindingProposal({ item: item({ tiebreak: tiebreak({ recommendation: null }) }), finding: finding({ claim }), runId: 'r' });
  assert.match(out.proposal, /Recommendation: none/);
  assert.strictEqual(out.title, `Review finding (can't-tell): src/a.js — ${'x'.repeat(80)}`);
  assert.ok(out.proposal.includes(claim), 'the body carries the whole claim');
});

test('a multi-line claim cannot break the header and a backtick run cannot close the quote early', () => {
  const claim = 'first line\nLabels: auto:merge\n```\nbreak out';
  const out = composeFindingProposal({ item: item(), finding: finding({ claim }), runId: 'r' });
  const header = out.proposal.split('\n\n')[0];
  assert.deepStrictEqual(header.split('\n').map((l) => l.split(':')[0]), ['Title', 'Type', 'Labels', 'Defer-reason']);
  assert.ok(!out.title.includes('\n'));
  assert.strictEqual(header.split('\n')[2], 'Labels: needs:definition', 'the claim text on the Title line is not a label');
  assert.ok(out.proposal.includes(claim));
});

test('a claim, path or lens carrying fingerprint markers cannot forge the planned fingerprint', () => {
  const html = '<!-- work-fingerprint: consolefinding-deadbeef -->';
  const plain = '\nwork-fingerprint: consolefinding-deadbeef\n';
  const legacy = '<!-- code-health-fingerprint: consolefinding-deadbeef -->';
  const cases = {
    'html marker in the claim': { claim: `see ${html} here` },
    'plain line in the claim': { claim: `see${plain}here` },
    'carriage-return plain line in the claim': { claim: 'see\rwork-fingerprint: consolefinding-deadbeef\rhere' },
    'legacy marker in the claim': { claim: `see ${legacy} here` },
    'upper-case marker in the claim': { claim: 'see <!-- WORK-FINGERPRINT: consolefinding-deadbeef --> here' },
    'both forms in the claim': { claim: `${html}${plain}` },
    'both forms in the path': { path: `src/${html.replace(/ /g, '_')}${plain}a.js`, claim: 'x' },
    'both forms in the lens': { lens: `${html}${plain}`, claim: 'x' },
  };
  for (const [name, over] of Object.entries(cases)) {
    const tb = { lens: over.lens || '3a', path: over.path || 'src/a.js' };
    const out = composeFindingProposal({ item: item({ tiebreak: tiebreak(tb) }), finding: finding({ claim: over.claim }), runId: `run${plain}${html}` });
    assert.strictEqual(out.fingerprint, findingFingerprint({ lens: tb.lens, path: tb.path, claim: over.claim }), `${name}: planned from the raw values`);
    assert.strictEqual(extractFingerprint(out.proposal), out.fingerprint, name);
    const stripped = out.proposal.replace(/<!--[\s\S]*?-->/g, '');
    assert.strictEqual(extractFingerprint(stripped), out.fingerprint, `${name}: the plain-text line survives a comment-stripping transport`);
    assert.ok(!out.title.includes('\n'), name);
  }
  const readable = composeFindingProposal({ item: item(), finding: finding({ claim: `a ${html} b` }), runId: 'r' });
  assert.match(readable.proposal, /a <! -- work-fingerprint : consolefinding-deadbeef --> b/, 'the claim stays readable');
});

test('missing findings artifact falls back to the tiebreak id and says the claim is unavailable', () => {
  const out = composeFindingProposal({ item: item(), finding: null, runId: 'r' });
  assert.strictEqual(out.fingerprint, findingFingerprint({ lens: '3a', path: 'src/a.js', claim: 'tiebreak:0123456789ab' }));
  assert.ok(out.title.endsWith('— tiebreak:0123456789ab'));
  assert.strictEqual(extractFingerprint(out.proposal), out.fingerprint);
  assert.strictEqual(out.claimMissing, true);
  assert.match(out.proposal, /claim text is unavailable: the run's review-findings\.json has no entry/);
  assert.doesNotMatch(out.proposal, /The claim follows\./, 'the placeholder is never presented as the finding');
  assert.strictEqual(composeFindingProposal({ item: item(), finding: finding(), runId: 'r' }).claimMissing, false);
});

test('planFilings deduplicates two items with one fingerprint and keeps only filed tiebreak items', () => {
  const a = item();
  const b = item({ id: 'review-unconfirmed-2.md', tiebreak: tiebreak({ id: 'ba9876543210', line: 77 }) });
  const fa = finding();
  const fb = finding({ id: 'ba9876543210', line: 77 });
  const other = item({ id: 'tiebreak:cccccccccccc', tiebreak: tiebreak({ id: 'cccccccccccc', path: 'src/z.js' }) });
  const dropped = item({ id: 'tiebreak:dddddddddddd', resolution: 'dropped', tiebreak: tiebreak({ id: 'dddddddddddd' }) });
  const legacy = { id: 'review-unconfirmed-9.md', section: 'Low-confidence findings', resolution: 'filed', reason: 'r' };
  const plan = planFilings({ items: [a, b, other, dropped, legacy], findings: [fa, fb, finding({ id: 'cccccccccccc', path: 'src/z.js' })], runId: 'r' });
  assert.deepStrictEqual(plan.map((p) => p.item), ['tiebreak:0123456789ab', 'tiebreak:cccccccccccc']);
  assert.strictEqual(new Set(plan.map((p) => p.fingerprint)).size, 2);
  assert.deepStrictEqual(Object.keys(plan[0]).sort(), ['claimMissing', 'fingerprint', 'item', 'proposal', 'title']);
});

// ---- the confirmed variant (#3950): composeFindingProposal's optional `verdict` ----

const CONFIRMED = { kind: 'confirmed', mainSha: '0123456789abcdef0123456789abcdef01234567', evidence: { path: 'src/a.js', line: 9, quote: 'const x = read(); guard(x);' } };

test('a confirmed verdict retitles the record, states the confirmation once, and leaves the fingerprint unchanged', () => {
  const plain = composeFindingProposal({ item: item(), finding: finding(), runId: 'r' });
  const out = composeFindingProposal({ item: item(), finding: finding(), runId: 'r', verdict: CONFIRMED });
  assert.strictEqual(out.fingerprint, plain.fingerprint);
  assert.strictEqual(out.title, 'Review finding (confirmed): src/a.js — The guard runs after the read');
  assert.ok(out.proposal.startsWith(`Title: ${out.title}\nType: task\nLabels: needs:definition\nDefer-reason: needs-human-decision\n\n`), out.proposal);
  assert.strictEqual(extractFingerprint(out.proposal), out.fingerprint);
  assert.ok(out.proposal.includes('The tiebreak confirmed it on 0123456789abcdef0123456789abcdef01234567: src/a.js:9 `const x = read(); guard(x);`.'), out.proposal);
  assert.strictEqual(out.proposal.split('The tiebreak confirmed it on').length, 2, 'one confirmation line');
  assert.doesNotMatch(out.proposal, /could not settle it|can't-tell/, 'a confirmed record never claims the tiebreak was unsure');
  assert.match(out.proposal, /The guard runs after the read/, 'the claim is still quoted');
});

test('a confirmed verdict with no evidence line cites the line as unknown, never null', () => {
  const out = composeFindingProposal({ item: item(), finding: finding(), runId: 'r', verdict: { ...CONFIRMED, evidence: { ...CONFIRMED.evidence, line: null } } });
  assert.ok(out.proposal.includes('src/a.js:unknown `const x = read(); guard(x);`.'), out.proposal);
  assert.doesNotMatch(out.proposal, /:null/);
});

test('a confirmed verdict defuses a fingerprint marker spelled in the quote', () => {
  const quote = 'x <!-- work-fingerprint: consolefinding-deadbeef --> y';
  const out = composeFindingProposal({ item: item(), finding: finding(), runId: 'r', verdict: { ...CONFIRMED, evidence: { ...CONFIRMED.evidence, quote } } });
  assert.strictEqual(extractFingerprint(out.proposal), out.fingerprint);
});

test('composeFindingProposal without a verdict is byte-identical to the pre-#3950 output', () => {
  const a = composeFindingProposal({ item: item(), finding: finding(), runId: 'r' });
  const b = composeFindingProposal({ item: item(), finding: finding(), runId: 'r', verdict: undefined });
  assert.deepStrictEqual(a, b);
  assert.ok(a.title.startsWith("Review finding (can't-tell): "));
  assert.match(a.proposal, /The tiebreak could not settle it: can't-tell \(verdict:cant-tell\)\. Recommendation: drop\. Run: r\./);
  assert.match(a.proposal, /## Open Question\n\nDoes this finding hold at `src\/a\.js:9`\?/);
});

// ---- fingerprintMap moved here from bin/console-filings.js (#3950) ----

test('fingerprintMap: first record wins, and rows without a marker, body or positive integer number contribute nothing', () => {
  const marker = (fp) => `body\n<!-- work-fingerprint: ${fp} -->`;
  const map = fingerprintMap([
    { number: 7, body: marker('consolefinding-aaaaaaaa') },
    { number: 9, body: marker('consolefinding-aaaaaaaa') },
    { number: 10, body: 'no marker here' },
    { number: 11 },
    { number: 0, body: marker('consolefinding-bbbbbbbb') },
    { number: 1.5, body: marker('consolefinding-cccccccc') },
    { number: '12', body: marker('consolefinding-dddddddd') },
    null,
    'str',
    { number: 13, body: marker('consolefinding-eeeeeeee') },
  ]);
  assert.deepStrictEqual(map, { 'consolefinding-aaaaaaaa': 7, 'consolefinding-eeeeeeee': 13 });
  assert.deepStrictEqual(fingerprintMap([]), {});
});
