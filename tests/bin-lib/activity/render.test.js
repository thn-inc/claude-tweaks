'use strict';
// tests/bin-lib/activity/render.test.js — #2757: the renderer trusts facts.json only. A ref
// absent from the facts is dropped with the exact warning; an ambiguous commit prefix is
// dropped; schemaVersion != 1 on either side is rejected; an empty period renders the honest
// one-line report; refs: [] renders unchanged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render, validateFacts, validateNarratives, citableRefs, SchemaError } = require('../../../plugin/bin/lib/activity/render');

const R = 'acme/widgets';
function facts(overrides = {}) {
  return {
    schemaVersion: 1, generatedAt: '2026-09-22T10:00:00Z', actor: 'octocat',
    period: { from: '2026-09-15', to: '2026-09-22', preset: '7d' }, repos: [R],
    merged_prs: [{ repo: R, number: 10, title: 'Merged one', url: 'https://x/pull/10', mergedAt: '', additions: 1, deletions: 0, labels: [] }],
    closed_issues: [], issues_raised: [], reviews_given: [], in_flight: [],
    commits: [
      { repo: R, sha: 'abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', subject: 'One', date: '', url: 'https://x/c/1' },
      { repo: R, sha: 'abc1234bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', subject: 'Two', date: '', url: 'https://x/c/2' },
      { repo: R, sha: 'def5678cccccccccccccccccccccccccccccccccc', subject: 'Three', date: '', url: 'https://x/c/3' },
    ],
    failures: [],
    ...overrides,
  };
}
function narratives(items, register = 'retro') {
  return { schemaVersion: 1, register, sections: [{ heading: 'Shipped', items }] };
}

test('AC5: an absent ref is dropped with the exact warning and the item text survives', () => {
  const { markdown, warnings } = render(facts(), narratives([{ text: 'Did a thing', refs: ['acme/widgets#9999'] }]));
  assert.ok(markdown.includes('Did a thing'));
  assert.equal(markdown.includes('#9999'), false);
  assert.deepEqual(warnings, ['warning: dropped citation acme/widgets#9999 — not present in facts.json']);
});

test('AC5: an ambiguous commit prefix is dropped with the ambiguous-citation warning', () => {
  const { markdown, warnings } = render(facts(), narratives([{ text: 'Committed', refs: ['acme/widgets@abc1234'] }]));
  assert.deepEqual(warnings, ['warning: ambiguous citation acme/widgets@abc1234 — matches 2 commits']);
  assert.equal(markdown.includes('abc1234'), false);
});

test('a present number ref and a unique commit prefix render as markdown links to the fact url', () => {
  const { markdown, warnings } = render(facts(), narratives([{ text: 'Shipped it', refs: ['acme/widgets#10', 'acme/widgets@def5678'] }]));
  assert.deepEqual(warnings, []);
  assert.ok(markdown.includes('- Shipped it ([acme/widgets#10](https://x/pull/10), [acme/widgets@def5678](https://x/c/3))'));
  assert.ok(markdown.startsWith('# Activity — 2026-09-15 to 2026-09-22 (retro)\n'));
  assert.ok(markdown.includes('\n## Shipped\n'));
  assert.ok(markdown.includes('\n## Notes\n'));
});

test('refs come only from refs[]: a #123 typed inside text is prose and is left as-is', () => {
  const { markdown, warnings } = render(facts(), narratives([{ text: 'Mentioned #123 in passing', refs: [] }]));
  assert.ok(markdown.includes('- Mentioned #123 in passing\n'));
  assert.deepEqual(warnings, []);
});

test('AC6: an empty period renders the one-line empty report with no section headings', () => {
  const empty = facts({ merged_prs: [], commits: [] });
  const { markdown, warnings } = render(empty, { schemaVersion: 1, register: 'retro', sections: [] });
  assert.equal(markdown, '# Activity — 2026-09-15 to 2026-09-22 (retro)\n\nNo activity found for 2026-09-15..2026-09-22 in acme/widgets.\n');
  assert.deepEqual(warnings, []);
});

test('a failures[] entry renders a Partial gather section verbatim', () => {
  const f = facts({ failures: [{ query: 'merged_prs', repo: R, error: 'HTTP 503: No server is currently available' }] });
  const { markdown } = render(f, narratives([]));
  assert.ok(markdown.includes('\n## Partial gather\n'));
  assert.ok(markdown.includes('- merged_prs on acme/widgets: HTTP 503: No server is currently available'));
});

test('AC7 (module half): schemaVersion other than 1 is rejected on either side, and a non-string ref names its path', () => {
  assert.throws(() => render(facts({ schemaVersion: 2 }), narratives([])), (e) => e instanceof SchemaError && /facts\.schemaVersion/.test(e.message));
  assert.throws(() => render(facts(), { schemaVersion: '1', register: 'retro', sections: [] }), (e) => e instanceof SchemaError && /narratives\.schemaVersion/.test(e.message));
  const bad = validateNarratives({ schemaVersion: 1, register: 'retro', sections: [{ heading: 'S', items: [{ text: 't', refs: ['ok#1', 42] }] }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.path), ['sections[0].items[0].refs[1]']);
  assert.deepEqual(validateFacts(facts()), { ok: true, errors: [] });
  assert.equal(validateNarratives({ schemaVersion: 1, register: 'boss', sections: [] }).ok, false);
});

test('citableRefs unions every numbered array per repo and lists commits per repo', () => {
  const f = facts({ in_flight: [{ repo: R, number: 50, title: 't', url: 'https://x/pull/50', isDraft: false, updatedAt: '' }] });
  const refs = citableRefs(f);
  assert.deepEqual([...refs.numbers.get(R).keys()].sort((a, b) => a - b), [10, 50]);
  assert.equal(refs.commits.get(R).length, 3);
});

test('the footer notes the empty-commits case only when other actor arrays are non-empty', () => {
  const withoutCommits = render(facts({ commits: [] }), narratives([])).markdown;
  assert.ok(withoutCommits.includes('no commits were matched'));
  const withCommits = render(facts(), narratives([])).markdown;
  assert.equal(withCommits.includes('no commits were matched'), false);
});
