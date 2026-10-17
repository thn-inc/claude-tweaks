// tests/bin-lib/residue/render.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderOutstanding } = require('../../../plugin/bin/lib/residue/render');
const { makeFinding } = require('../../../plugin/bin/lib/residue/finding');

const BRANCH = makeFinding({ kind: 'branch', scope: 'blast-radius', subject: 'origin/worktree-old', remedy: 'auto', evidence: 'merged, not deleted' });

test('a finding with a disposition renders it', () => {
  const out = renderOutstanding({ results: [{ ran: true, findings: [BRANCH] }], dispositions: { [BRANCH.id]: 'Fixed — a1b2c3d' } });
  assert.match(out, /Fixed — a1b2c3d/);
});

test('the table names its remedy column and shows each finding\'s remedy value', () => {
  const out = renderOutstanding({ results: [{ ran: true, findings: [BRANCH] }], dispositions: {} });
  assert.match(out, /\| # \| What \| Kind \| Remedy \| Disposition \|/, 'the header must name a Remedy column');
  assert.match(out, /\| 1 \| .* \| branch \| auto \| NEEDS DISPOSITION \|/, 'the row must render the finding\'s own remedy value');
});

test('a finding without a disposition renders NEEDS DISPOSITION, never blank', () => {
  const out = renderOutstanding({ results: [{ ran: true, findings: [BRANCH] }], dispositions: {} });
  assert.match(out, /NEEDS DISPOSITION/);
});

test('an unrun probe renders as unknown with its reason', () => {
  const out = renderOutstanding({ results: [{ ran: false, reason: 'gh unavailable', findings: [] }], dispositions: {} });
  assert.match(out, /unknown/);
  assert.match(out, /gh unavailable/);
});

test('an unrun probe is never rendered as finding nothing', () => {
  const out = renderOutstanding({ results: [{ ran: false, reason: 'gh unavailable', findings: [] }], dispositions: {} });
  assert.doesNotMatch(out, /No outstanding items/);
});

test('a clean run says so explicitly', () => {
  const out = renderOutstanding({ results: [{ ran: true, reason: null, findings: [] }], dispositions: {} });
  assert.match(out, /No outstanding items/);
});

test('a probe that ran on reduced input renders its reason, not only in --json (#2882)', () => {
  const reason = 'remote tag list unavailable (git ls-remote failed) — checked local tags only';
  const out = renderOutstanding({ results: [{ ran: true, reason, findings: [] }, { ran: true, reason: null, findings: [] }], dispositions: {} });
  assert.match(out, /degraded: remote tag list unavailable/);
  assert.strictEqual(out.split('degraded:').length - 1, 1, 'a clean probe (reason: null) adds no degraded line');
});

test('a truncated finding list reports the cap rather than hiding it', () => {
  const many = Array.from({ length: 30 }, (_, i) => makeFinding({ ...BRANCH, subject: `origin/b-${i}` }));
  const out = renderOutstanding({ results: [{ ran: true, findings: many }], dispositions: {}, cap: 10 });
  assert.match(out, /20 more/);
});

test('a deliberate suite skip is distinguishable from a genuine failure to run', () => {
  const skipped = renderOutstanding({ results: [{ ran: false, reason: 'skipped via --no-suite', findings: [] }], dispositions: {} });
  assert.match(skipped, /skipped via --no-suite/);
  assert.doesNotMatch(skipped, /could not run/);

  const broken = renderOutstanding({ results: [{ ran: false, reason: 'could not run the project test command', findings: [] }], dispositions: {} });
  assert.match(broken, /could not run/);
  assert.doesNotMatch(broken, /skipped via --no-suite/);
});
