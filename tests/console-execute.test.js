// tests/console-execute.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  decideConsoleExecute,
  isResolveTicked,
  parseItemTicks,
  isClaimReclaimable,
  readConsoleJson,
  consoleExecuteDetect,
  parseFixesMembers,
  fetchIssueGrant,
  renderExecutedLines,
  RECLAIM_STALE_MS,
} = require('../plugin/bin/lib/reconcile/console-execute');
const { reconcile } = require('../plugin/bin/lib/reconcile');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// --- isResolveTicked / parseItemTicks: pure string parsing, no I/O ---

test('isResolveTicked: ticked resolve row reads true', () => {
  const body = '<!-- console-item: resolve -->\n- [x] **Resolve console** — tick this last';
  assert.strictEqual(isResolveTicked(body), true);
});

test('isResolveTicked: unticked resolve row reads false', () => {
  const body = '<!-- console-item: resolve -->\n- [ ] **Resolve console** — tick this last';
  assert.strictEqual(isResolveTicked(body), false);
});

test('isResolveTicked: uppercase X still counts as ticked', () => {
  const body = '<!-- console-item: resolve -->\n- [X] **Resolve console**';
  assert.strictEqual(isResolveTicked(body), true);
});

test('isResolveTicked: no resolve marker at all reads false, never throws', () => {
  assert.strictEqual(isResolveTicked('nothing here'), false);
  assert.strictEqual(isResolveTicked(undefined), false);
  assert.strictEqual(isResolveTicked(null), false);
});

test('isResolveTicked: an item row that merely mentions "resolve" in its label does not false-positive', () => {
  const body = '<!-- console-item: staged-3 -->\n- [x] resolve the flaky test\n\n<!-- console-item: resolve -->\n- [ ] **Resolve console**';
  assert.strictEqual(isResolveTicked(body), false);
});

test('parseItemTicks: reads every item id to its tick state, resolve excluded', () => {
  const body = [
    '<!-- console-item: staged-1 -->',
    '- [x] item one',
    '',
    '<!-- console-item: q-2 -->',
    '- [ ] item two',
    '',
    '<!-- console-item: resolve -->',
    '- [x] **Resolve console**',
  ].join('\n');
  assert.deepStrictEqual(parseItemTicks(body), { 'staged-1': true, 'q-2': false });
});

test('parseItemTicks: bundle-qualified ids (spec-slug-kind-n) parse correctly', () => {
  const body = '<!-- console-item: console-on-pr-staged-5 -->\n- [x] a bundle item';
  assert.deepStrictEqual(parseItemTicks(body), { 'console-on-pr-staged-5': true });
});

test('parseItemTicks: no markers at all returns an empty object, never throws', () => {
  assert.deepStrictEqual(parseItemTicks('plain text'), {});
  assert.deepStrictEqual(parseItemTicks(undefined), {});
});

// --- isClaimReclaimable ---

test('isClaimReclaimable: no claim at all is reclaimable', () => {
  assert.strictEqual(isClaimReclaimable(undefined, Date.now()), true);
  assert.strictEqual(isClaimReclaimable(null, Date.now()), true);
  assert.strictEqual(isClaimReclaimable('', Date.now()), true);
});

test('isClaimReclaimable: a fresh claim is not reclaimable', () => {
  const now = Date.now();
  const claimedAt = new Date(now - 1000).toISOString();
  assert.strictEqual(isClaimReclaimable(claimedAt, now), false);
});

test('isClaimReclaimable: a claim exactly at the reclaim window is not yet reclaimable (strict >)', () => {
  const now = Date.now();
  const claimedAt = new Date(now - RECLAIM_STALE_MS).toISOString();
  assert.strictEqual(isClaimReclaimable(claimedAt, now), false);
});

test('isClaimReclaimable: a claim older than the reclaim window is reclaimable', () => {
  const now = Date.now();
  const claimedAt = new Date(now - RECLAIM_STALE_MS - 1000).toISOString();
  assert.strictEqual(isClaimReclaimable(claimedAt, now), true);
});

test('isClaimReclaimable: a corrupt timestamp fails open (reclaimable), never throws', () => {
  assert.strictEqual(isClaimReclaimable('not-a-date', Date.now()), true);
});

// --- decideConsoleExecute: pure, covers the full skip/ready decision tree ---

test('decideConsoleExecute: no console.json at all -> skip no-console', () => {
  assert.deepStrictEqual(decideConsoleExecute(null, [], Date.now()), { action: 'skip', reason: 'no-console' });
});

test('decideConsoleExecute: unparseable console.json -> skip, fails closed', () => {
  assert.deepStrictEqual(decideConsoleExecute(undefined, [], Date.now()), { action: 'skip', reason: 'unparseable-console-json' });
});

test('decideConsoleExecute: already resolved -> skip, never re-detected as ready', () => {
  const consoleJson = { resolved: true, commentIds: ['IC_1'], prNumber: 1, items: [] };
  assert.deepStrictEqual(decideConsoleExecute(consoleJson, [], Date.now()), { action: 'skip', reason: 'already-resolved' });
});

// #1130 review: consoles written before the write order also set
// `resolved: true` carry only `executedAt` — an executed console whose
// executingAt claim has gone stale (past RECLAIM_STALE_MS, with the PR's
// Resolve checkbox still ticked) must never re-detect as ready, or every
// later reconcile pass re-applies Q#/M#/U# items that have no drift guard.
// Same acceptance rule as archive-merged.js's readConsoleState.
test('decideConsoleExecute: executedAt-only console (pre-resolved-field writer) -> skip already-resolved, even with a stale claim', () => {
  const now = Date.now();
  const consoleJson = {
    executedAt: new Date(now - 60 * 60 * 1000).toISOString(),
    executingAt: new Date(now - 60 * 60 * 1000).toISOString(), // stale — reclaimable
    commentIds: ['IC_1'], prNumber: 1, items: [],
  };
  assert.deepStrictEqual(decideConsoleExecute(consoleJson, [], now), { action: 'skip', reason: 'already-resolved' });
});

test('decideConsoleExecute: whitespace-only executedAt is not a completion stamp -> falls through past already-resolved', () => {
  const consoleJson = { executedAt: '   ', commentIds: [], prNumber: 1, items: [] };
  // Falls past the completion check to the next ladder rung (no-comment-ids here).
  assert.deepStrictEqual(decideConsoleExecute(consoleJson, [], Date.now()), { action: 'skip', reason: 'no-comment-ids' });
});

test('decideConsoleExecute: a fresh claim by another executor -> skip claimed', () => {
  const now = Date.now();
  const consoleJson = { resolved: false, executingAt: new Date(now - 1000).toISOString(), commentIds: ['IC_1'], prNumber: 1, items: [] };
  assert.deepStrictEqual(decideConsoleExecute(consoleJson, [], now), { action: 'skip', reason: 'claimed' });
});

test('decideConsoleExecute: no commentIds -> skip no-comment-ids', () => {
  const consoleJson = { resolved: false, commentIds: [], prNumber: 1, items: [] };
  assert.deepStrictEqual(decideConsoleExecute(consoleJson, [], Date.now()), { action: 'skip', reason: 'no-comment-ids' });
});

test('decideConsoleExecute: no prNumber -> skip no-pr-number', () => {
  const consoleJson = { resolved: false, commentIds: ['IC_1'], items: [] };
  assert.deepStrictEqual(decideConsoleExecute(consoleJson, [], Date.now()), { action: 'skip', reason: 'no-pr-number' });
});

test('decideConsoleExecute: primary comment not found among fetched comments -> skip comment-not-found', () => {
  const consoleJson = { resolved: false, commentIds: ['IC_missing'], prNumber: 1, items: [] };
  const comments = [{ id: 'IC_other', body: '- [x] whatever' }];
  assert.deepStrictEqual(decideConsoleExecute(consoleJson, comments, Date.now()), { action: 'skip', reason: 'comment-not-found' });
});

test('decideConsoleExecute: Resolve unticked -> skip not-resolved-yet', () => {
  const consoleJson = { resolved: false, commentIds: ['IC_1'], prNumber: 1, items: [] };
  const comments = [{ id: 'IC_1', body: '<!-- console-item: resolve -->\n- [ ] **Resolve console**' }];
  assert.deepStrictEqual(decideConsoleExecute(consoleJson, comments, Date.now()), { action: 'skip', reason: 'not-resolved-yet' });
});

test('decideConsoleExecute: Resolve ticked -> ready, with every item\'s approved tick resolved from the comment', () => {
  const consoleJson = {
    resolved: false,
    commentIds: ['IC_1'],
    prNumber: 42,
    items: [
      { id: 'staged-1', kind: 'staged', summary: 'a finding', stagedHash: 'abc' },
      { id: 'q-2', kind: 'queue', summary: 'a queue write', stagedHash: 'def' },
    ],
  };
  const comments = [{
    id: 'IC_1',
    body: [
      '<!-- console-item: staged-1 -->',
      '- [x] a finding',
      '',
      '<!-- console-item: q-2 -->',
      '- [ ] a queue write',
      '',
      '<!-- console-item: resolve -->',
      '- [x] **Resolve console**',
    ].join('\n'),
  }];
  const result = decideConsoleExecute(consoleJson, comments, Date.now());
  assert.strictEqual(result.action, 'ready');
  assert.strictEqual(result.prNumber, 42);
  assert.deepStrictEqual(result.items, [
    { id: 'staged-1', kind: 'staged', summary: 'a finding', stagedHash: 'abc', approved: true },
    { id: 'q-2', kind: 'queue', summary: 'a queue write', stagedHash: 'def', approved: false },
  ]);
});

// --- #1294: mergeCheckVerdict pass-through — console.json is the only source, never the comment body ---

test('decideConsoleExecute: persisted mergeCheckVerdict: needs-human passes through on the ready result', () => {
  const consoleJson = {
    resolved: false,
    commentIds: ['IC_1'],
    prNumber: 42,
    mergeCheckVerdict: 'needs-human',
    items: [{ id: 'staged-1', kind: 'staged', summary: 'branch-finish', isMergeRow: true }],
  };
  const comments = [{
    id: 'IC_1',
    body: '<!-- console-item: staged-1 -->\n- [x] branch-finish\n\n<!-- console-item: resolve -->\n- [x] **Resolve console**',
  }];
  const result = decideConsoleExecute(consoleJson, comments, Date.now());
  assert.strictEqual(result.action, 'ready');
  assert.strictEqual(result.mergeCheckVerdict, 'needs-human');
});

test('decideConsoleExecute: no mergeCheckVerdict on console.json -> null, never assumed cleared', () => {
  const consoleJson = { resolved: false, commentIds: ['IC_1'], prNumber: 42, items: [] };
  const comments = [{ id: 'IC_1', body: '<!-- console-item: resolve -->\n- [x] **Resolve console**' }];
  const result = decideConsoleExecute(consoleJson, comments, Date.now());
  assert.strictEqual(result.action, 'ready');
  assert.strictEqual(result.mergeCheckVerdict, null);
});

test('decideConsoleExecute: an unrecognized mergeCheckVerdict value reads as null, fails safe', () => {
  const consoleJson = {
    resolved: false, commentIds: ['IC_1'], prNumber: 42, mergeCheckVerdict: 'auto-merge', items: [],
  };
  const comments = [{ id: 'IC_1', body: '<!-- console-item: resolve -->\n- [x] **Resolve console**' }];
  const result = decideConsoleExecute(consoleJson, comments, Date.now());
  assert.strictEqual(result.mergeCheckVerdict, null);
});

// --- #1966/#1802: mergeGrantGap — the mechanized ungranted-member exception ---

function mergeRowConsoleJson(overrides = {}) {
  return {
    resolved: false,
    commentIds: ['IC_1'],
    prNumber: 42,
    items: [{ id: 'staged-1', kind: 'staged', summary: 'branch-finish', isMergeRow: true }],
    ...overrides,
  };
}
const RESOLVED_COMMENTS = [{
  id: 'IC_1',
  body: '<!-- console-item: staged-1 -->\n- [x] branch-finish\n\n<!-- console-item: resolve -->\n- [x] **Resolve console**',
}];

test('parseFixesMembers: one Fixes line per record, deduplicated and in order', () => {
  const body = 'Some text\n\nFixes #12\nFixes #34\nFixes #12\n\nmore text';
  assert.deepStrictEqual(parseFixesMembers(body), [12, 34]);
});

test('parseFixesMembers: a solo run\'s single Fixes line is still a one-member group', () => {
  assert.deepStrictEqual(parseFixesMembers('### Resume\n\nFixes #1966\n'), [1966]);
});

test('parseFixesMembers: no Fixes line, or a non-string body, returns an empty list', () => {
  assert.deepStrictEqual(parseFixesMembers('nothing here'), []);
  assert.deepStrictEqual(parseFixesMembers(undefined), []);
  assert.deepStrictEqual(parseFixesMembers(null), []);
});

test('decideConsoleExecute: isMergeRow forwarded onto the resolved item when true, omitted otherwise', () => {
  const withRow = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now());
  assert.strictEqual(withRow.items[0].isMergeRow, true);
  const withoutRow = decideConsoleExecute(
    { resolved: false, commentIds: ['IC_1'], prNumber: 42, items: [{ id: 'staged-1', kind: 'staged', summary: 'x' }] },
    RESOLVED_COMMENTS,
    Date.now(),
  );
  assert.strictEqual('isMergeRow' in withoutRow.items[0], false);
});

test('decideConsoleExecute: isRulingRow forwarded onto the resolved item when true, omitted otherwise', () => {
  const withRow = decideConsoleExecute(
    mergeRowConsoleJson({ items: [{ id: 'staged-1', kind: 'staged', summary: 'ruling', isRulingRow: true }] }),
    RESOLVED_COMMENTS,
    Date.now(),
  );
  assert.strictEqual(withRow.items[0].isRulingRow, true);
  const withoutRow = decideConsoleExecute(
    mergeRowConsoleJson({ items: [{ id: 'staged-1', kind: 'staged', summary: 'x' }] }),
    RESOLVED_COMMENTS,
    Date.now(),
  );
  assert.strictEqual('isRulingRow' in withoutRow.items[0], false);
});

test('decideConsoleExecute: no isMergeRow item at all -> mergeGrantGap null regardless of ctx', () => {
  const consoleJson = { resolved: false, commentIds: ['IC_1'], prNumber: 42, items: [] };
  const result = decideConsoleExecute(consoleJson, RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #1', memberGrants: { 1: { labels: [], pendingSince: null } },
  });
  assert.strictEqual(result.mergeGrantGap, null);
});

test('decideConsoleExecute: isMergeRow present but no ctx supplied (legacy call shape) -> mergeGrantGap null, unchanged', () => {
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now());
  assert.strictEqual(result.mergeGrantGap, null);
});

test('decideConsoleExecute: a solo record (one Fixes line) carrying auto:merge -> mergeGrantGap null, merge row floor-clearing', () => {
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #1966', memberGrants: { 1966: { labels: ['auto:merge'], pendingSince: null } },
  });
  assert.strictEqual(result.mergeGrantGap, null);
});

test('decideConsoleExecute: a solo record with auto:build only, no auto:merge -> mergeGrantGap names it (#1966\'s reported bug)', () => {
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #1966', memberGrants: { 1966: { labels: ['auto:build'], pendingSince: null } },
  });
  assert.deepStrictEqual(result.mergeGrantGap.member, 1966);
  assert.match(result.mergeGrantGap.reason, /no auto:merge-pending label/);
});

test('decideConsoleExecute: a matured auto:merge-pending clears the gap', () => {
  // pendingSince arrives as a Date instance in production — fetchIssueGrant's
  // extractPendingGrantedAt (bin/lib/issues/grant-maturation.js) returns Date | null,
  // never a string; evaluateMaturation only accepts `instanceof Date`.
  const pendingSince = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30h ago
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #7', memberGrants: { 7: { labels: ['auto:merge-pending'], pendingSince } }, vetoWindowHours: 24,
  });
  assert.strictEqual(result.mergeGrantGap, null);
});

test('decideConsoleExecute: an unmatured grant whose untrusted marker comment was passed over names that comment in the gap reason (#3358)', () => {
  const note = 'skipped marker comment https://x/issues/7#c1 by eve (NONE) — not an owner, member, or collaborator';
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #7', memberGrants: { 7: { labels: ['auto:merge-pending'], pendingSince: null, skippedUntrusted: [note] } },
  });
  assert.strictEqual(result.mergeGrantGap.member, 7);
  assert.match(result.mergeGrantGap.reason, /could not be determined from the audit trail/);
  assert.ok(result.mergeGrantGap.reason.endsWith(` — ${note}`), result.mergeGrantGap.reason);
});

test('decideConsoleExecute: an empty or absent skippedUntrusted leaves the gap reason exactly the maturation reason (#3358)', () => {
  const run = (grant) => decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #7', memberGrants: { 7: grant },
  }).mergeGrantGap.reason;
  const bare = run({ labels: ['auto:merge-pending'], pendingSince: null });
  assert.strictEqual(run({ labels: ['auto:merge-pending'], pendingSince: null, skippedUntrusted: [] }), bare);
  assert.ok(!bare.includes('skipped marker comment'));
});

// --- renderExecutedLines: the `hooks.js resolve-console` success output ---

test('renderExecutedLines: the summary line is unchanged when nothing was passed over (characterization)', () => {
  const result = { outcomes: [{ id: '1', outcome: 'executed' }, { id: '2', outcome: 'declined' }], resolved: false, prNumber: 42, skippedUntrusted: [] };
  assert.strictEqual(
    renderExecutedLines(result, 'run-x'),
    'claude-tweaks: console resolved for run-x (PR #42) — 1:executed, 2:declined — Resolve left unticked (not every item cleared)\n',
  );
  assert.strictEqual(
    renderExecutedLines({ ...result, resolved: true, outcomes: [{ id: '1', outcome: 'executed' }] }, 'run-x'),
    'claude-tweaks: console resolved for run-x (PR #42) — 1:executed\n',
  );
});

test('renderExecutedLines: each passed-over untrusted reply comment gets its own line after the summary (#3358)', () => {
  const n1 = 'skipped marker comment https://x/c9 by eve (NONE) — not an owner, member, or collaborator';
  const n2 = 'skipped marker comment https://x/c10 by mallory (CONTRIBUTOR) — not an owner, member, or collaborator';
  const out = renderExecutedLines({ outcomes: [{ id: '1', outcome: 'executed' }], resolved: true, prNumber: 42, skippedUntrusted: [n1, n2] }, 'run-x');
  assert.deepStrictEqual(out.split('\n'), [
    'claude-tweaks: console resolved for run-x (PR #42) — 1:executed',
    `claude-tweaks: ${n1}`,
    `claude-tweaks: ${n2}`,
    '',
  ]);
});

test('decideConsoleExecute: an auto:merge-pending still inside the veto window withholds', () => {
  const pendingSince = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #7', memberGrants: { 7: { labels: ['auto:merge-pending'], pendingSince } }, vetoWindowHours: 24,
  });
  assert.strictEqual(result.mergeGrantGap.member, 7);
  assert.match(result.mergeGrantGap.reason, /veto window/);
});

test('decideConsoleExecute: a bundle with one ungranted member among several granted ones still withholds', () => {
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #1\nFixes #2\nFixes #3',
    memberGrants: {
      1: { labels: ['auto:merge'], pendingSince: null },
      2: { labels: ['auto:build'], pendingSince: null },
      3: { labels: ['auto:merge'], pendingSince: null },
    },
  });
  assert.strictEqual(result.mergeGrantGap.member, 2);
});

test('decideConsoleExecute: isMergeRow present, ctx.prBody has no Fixes line -> members-unresolved, fails closed', () => {
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'no fixes line here', memberGrants: {},
  });
  assert.strictEqual(result.mergeGrantGap.member, null);
  assert.strictEqual(result.mergeGrantGap.reason, 'members-unresolved');
});

test('decideConsoleExecute: isMergeRow present, a named member missing from memberGrants -> grant-unreadable, fails closed', () => {
  const result = decideConsoleExecute(mergeRowConsoleJson(), RESOLVED_COMMENTS, Date.now(), {
    prBody: 'Fixes #99', memberGrants: {},
  });
  assert.strictEqual(result.mergeGrantGap.member, 99);
  assert.strictEqual(result.mergeGrantGap.reason, 'grant-unreadable');
});

test('decideConsoleExecute: overflow comments — an item\'s ticks are read from ITS OWN comment, not the primary\'s', () => {
  const consoleJson = {
    resolved: false,
    commentIds: ['IC_primary', 'IC_overflow'],
    prNumber: 42,
    items: [
      { id: 'staged-1', kind: 'staged', summary: 'in primary' },
      { id: 'staged-9', kind: 'staged', summary: 'in overflow', commentId: 'IC_overflow' },
    ],
  };
  const comments = [
    { id: 'IC_primary', body: '<!-- console-item: staged-1 -->\n- [x] in primary\n\n<!-- console-item: resolve -->\n- [x] **Resolve console**' },
    { id: 'IC_overflow', body: '<!-- console-item: staged-9 -->\n- [x] in overflow' },
  ];
  const result = decideConsoleExecute(consoleJson, comments, Date.now());
  assert.strictEqual(result.action, 'ready');
  const overflowItem = result.items.find((i) => i.id === 'staged-9');
  assert.strictEqual(overflowItem.approved, true);
});

// --- fetchIssueGrant (#3358): the pending-grant marker only counts from a trusted comment ---
// fetchIssueGrant shells to `gh issue view` with no injection point, so tests
// intercept at the spawn boundary with a `gh` wrapper first on PATH (same
// technique as tests/bin-lib/reconcile/pr-state.test.js).

async function withFakeGh(json, fn) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(wrapperPath, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(json)}\nEOF\n`);
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  try { return await fn(); } finally { process.env.PATH = originalPath; }
}

const GRANT_MARKER = '<!-- grant-mode-audit: date=2020-01-01T00:00:00Z auto-merge=pending -->';

test('fetchIssueGrant: a planted pending-grant marker authored NONE leaves pendingSince null and is named in skippedUntrusted', { skip: process.platform === 'win32' }, async () => {
  const res = await withFakeGh({
    labels: [{ name: 'auto:merge-pending' }],
    comments: [{ body: GRANT_MARKER, url: 'https://x/issues/7#c1', author: { login: 'eve' }, authorAssociation: 'NONE' }],
  }, () => fetchIssueGrant(process.cwd(), 7));
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.labels, ['auto:merge-pending']);
  assert.strictEqual(res.pendingSince, null);
  assert.deepStrictEqual(res.skippedUntrusted, ['skipped marker comment https://x/issues/7#c1 by eve (NONE) — not an owner, member, or collaborator']);
});

test('fetchIssueGrant: the same marker authored MEMBER is that date, with nothing skipped', { skip: process.platform === 'win32' }, async () => {
  const res = await withFakeGh({
    labels: [{ name: 'auto:merge-pending' }],
    comments: [{ body: GRANT_MARKER, authorAssociation: 'MEMBER' }],
  }, () => fetchIssueGrant(process.cwd(), 7));
  assert.strictEqual(res.pendingSince.toISOString(), '2020-01-01T00:00:00.000Z');
  assert.deepStrictEqual(res.skippedUntrusted, []);
});

test('fetchIssueGrant: a non-marker comment authored NONE is silent -- skippedUntrusted stays []', { skip: process.platform === 'win32' }, async () => {
  const res = await withFakeGh({
    labels: [], comments: [{ body: 'hello', url: 'https://x/c', author: { login: 'eve' }, authorAssociation: 'NONE' }],
  }, () => fetchIssueGrant(process.cwd(), 7));
  assert.strictEqual(res.pendingSince, null);
  assert.deepStrictEqual(res.skippedUntrusted, []);
});

// consoleExecuteDetect carries fetchIssueGrant's skippedUntrusted into the decision (#3358): a pending
// grant whose only marker comment is untrusted stays withheld, and the ready entry's mergeGrantGap
// reason names the passed-over comment. Real git repo + run dir; `gh` is a PATH wrapper that answers
// `pr view` and `issue view` with fixed JSON.
test('consoleExecuteDetect: a withheld merge grant names the untrusted pending-grant comment it passed over', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-grant-')));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);
  const runDir = path.join(dir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-test');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify(mergeRowConsoleJson()));

  const pr = { comments: RESOLVED_COMMENTS, body: 'Fixes #7' };
  const issue = {
    labels: [{ name: 'auto:merge-pending' }],
    comments: [{ body: GRANT_MARKER, url: 'https://x/issues/7#c1', author: { login: 'eve' }, authorAssociation: 'NONE' }],
  };
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-ghwrap-'));
  fs.writeFileSync(path.join(wrapperDir, 'gh'), `#!/bin/sh\ncase "$1" in\n  pr) cat <<'EOF'\n${JSON.stringify(pr)}\nEOF\n  ;;\n  issue) cat <<'EOF'\n${JSON.stringify(issue)}\nEOF\n  ;;\nesac\n`);
  fs.chmodSync(path.join(wrapperDir, 'gh'), 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  let result;
  try { result = await consoleExecuteDetect({ cwd: dir }); } finally { process.env.PATH = originalPath; }
  assert.strictEqual(result.ready.length, 1, JSON.stringify(result));
  const gap = result.ready[0].mergeGrantGap;
  assert.strictEqual(gap.member, 7);
  assert.ok(gap.reason.endsWith(' — skipped marker comment https://x/issues/7#c1 by eve (NONE) — not an owner, member, or collaborator'), gap.reason);
});

// --- readConsoleJson: real temp files, matching archive-merged.js's own convention ---

test('readConsoleJson: absent file reads as null (distinct from unparseable)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-'));
  assert.strictEqual(readConsoleJson(dir), null);
});

test('readConsoleJson: valid JSON parses through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ resolved: false, prNumber: 7 }));
  assert.deepStrictEqual(readConsoleJson(dir), { resolved: false, prNumber: 7 });
});

test('readConsoleJson: unparseable content reads as undefined, distinct from absent (fails closed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-'));
  fs.writeFileSync(path.join(dir, 'console.json'), '{not json');
  assert.strictEqual(readConsoleJson(dir), undefined);
});

// --- consoleExecuteDetect: real repo fixture, no live gh/PR (mirrors
// pr-state.js's own consumers — no test in this suite hits a real PR) ---

test('consoleExecuteDetect: outside any repo returns empty ready/skipped, never throws', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-norepo-'));
  const result = await consoleExecuteDetect({ cwd: dir });
  assert.deepStrictEqual(result, { ready: [], skipped: [] });
});

test('consoleExecuteDetect: a run dir with no console.json is reported as no-console, never crashes', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-run-')));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);

  const runDir = path.join(dir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-test');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = await consoleExecuteDetect({ cwd: dir });
  assert.deepStrictEqual(result.ready, []);
  assert.ok(result.skipped.some((s) => s.reason === 'no-console'));
});

test('consoleExecuteDetect: a run with console.json but no reachable PR is reported skipped (gh-absent or network-failure), never crashes or reports ready', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-run2-')));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);

  const runDir = path.join(dir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-test');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    resolved: false, commentIds: ['IC_fake'], prNumber: 999999, items: [],
  }));

  const result = await consoleExecuteDetect({ cwd: dir });
  assert.deepStrictEqual(result.ready, []);
  const entry = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(entry, 'the run must be reported, not silently dropped');
  assert.ok(['gh-absent', 'network-failure'].includes(entry.reason), `unexpected skip reason: ${entry.reason}`);
});

// --- Wiring: reconcile()'s new `console` check reaches this module ---

test('reconcile(): the console check is wired in and reachable via ALL_CHECKS on a pr-first project', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-reconcile-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\nintegration-branch: main\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);
  git(['remote', 'add', 'origin', 'https://github.com/example/example.git'], dir);

  const r = await reconcile({ cwd: dir });
  assert.notStrictEqual(r.console, null, 'the console check must have run under pr-first');
  assert.deepStrictEqual(r.console, { ready: [], skipped: [] });
});

test('reconcile(): local-merge skips the console check under the same combined skip entry as mirror/release/archive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ce-lm-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\nintegration-branch: main\n');

  const r = await reconcile({ cwd: dir });
  assert.strictEqual(r.console, null);
  assert.deepStrictEqual(r.skipped, [{ check: 'mirror,release,archive,archive-branches,remote-prune,console', reason: 'local-merge-model' }]);
});
