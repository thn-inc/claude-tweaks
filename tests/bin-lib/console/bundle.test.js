'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { parseProposal, classifyLandingClass, planBundles, composeBundle } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'bundle'));
const { specShapedBody, recordPayload, extractFingerprint, extractFingerprints, parseRiskFlags } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'record'));

// A staged proposal text shaped like wrap-up/leftover-routing.md writes it.
function stage({ title, files = [], labels = ['ready'], type = 'task', deferReason = 'tangential', fp, risk, size, extraBody = '', needs = false, noLabels = false, crlf = false, riskFlags }) {
  const allLabels = [...(risk ? [`risk:${risk}`] : []), ...(size ? [`size:${size}`] : []), ...labels];
  const body = specShapedBody({
    currentState: `Finding for ${title}.${extraBody}`,
    deliverables: `- [ ] Fix ${title}`,
    ...(needs ? { openQuestion: `Should ${title} change?` } : { acceptanceCriteria: `${title} is fixed.` }),
    releaseNote: `Fixes ${title}.`,
    filedBy: 'wrap-up leftover routing',
    provenance: { origin: 'wrap-up leftover from #1', deferReason },
    keyFiles: files.map((p) => ({ path: p, change: 'modify' })),
  });
  const payload = recordPayload({ title, body, type, fingerprint: fp });
  let text = `Title: ${payload.title}\nType: ${payload.type}\n${noLabels ? '' : `Labels: ${allLabels.join(', ') || 'none'}\n`}Defer-reason: ${deferReason}\n\n${payload.body}`;
  if (riskFlags) text = text.replace('## Current State', `Risk-flags: ${riskFlags}\n\n## Current State`);
  return crlf ? text.replace(/\n/g, '\r\n') : text;
}
const prop = (name, opts) => ({ ...parseProposal(name, stage(opts)), key: name });
const keys = (list) => list.map((p) => p.key);

test('Review Focus 4: a CRLF header parses', () => {
  const p = parseProposal('a.md', stage({ title: 'A', files: ['src/a.js'], crlf: true, fp: 'fp-a' }));
  assert.strictEqual(p.title, 'A');
  assert.strictEqual(p.type, 'task');
  assert.deepStrictEqual(p.labels, ['ready']);
  assert.strictEqual(p.deferReason, 'tangential');
  assert.deepStrictEqual(p.keyFiles, ['src/a.js']);
  assert.strictEqual(p.fingerprint, 'fp-a');
  assert.strictEqual(parseProposal('x.md', 'Type: task\n\nbody'), null);
  assert.deepStrictEqual(parseProposal('n.md', 'Title: T\nLabels: none\n\nb').labels, []);
});

test('AC17: classifyLandingClass is the closed rule', () => {
  assert.strictEqual(classifyLandingClass(['parked', 'risk:low']), 'parked');
  assert.strictEqual(classifyLandingClass(['needs:definition']), 'needs-definition');
  assert.strictEqual(classifyLandingClass(['risk:low', 'ready']), 'ready');
  assert.strictEqual(classifyLandingClass(['ready', 'parked']), null);
  assert.strictEqual(classifyLandingClass(['ready', 'needs:definition']), null);
  assert.strictEqual(classifyLandingClass([]), null);
  assert.strictEqual(classifyLandingClass(['bug']), null);
  const noLabels = parseProposal('n.md', stage({ title: 'N', noLabels: true }));
  assert.strictEqual(classifyLandingClass(noLabels.labels), null);
});

test('AC1: 5 ready proposals, 3 sharing one Key File -> 1 bundle of 3 and 2 singletons', () => {
  const ps = [
    prop('p1.md', { title: 'One', files: ['src/shared.js'] }),
    prop('p2.md', { title: 'Two', files: ['src/other.js'] }),
    prop('p3.md', { title: 'Three', files: ['src/shared.js', 'src/x.js'] }),
    prop('p4.md', { title: 'Four', files: ['src/shared.js'] }),
    prop('p5.md', { title: 'Five', files: ['src/lonely.js'] }),
  ];
  const plan = planBundles(ps, { hubPaths: new Set() });
  assert.strictEqual(plan.bundles.length, 1);
  assert.deepStrictEqual(keys(plan.bundles[0].members), ['p1.md', 'p3.md', 'p4.md']);
  assert.deepStrictEqual(plan.bundles[0].sharedPaths, ['src/shared.js']);
  assert.deepStrictEqual(keys(plan.singletons), ['p2.md', 'p5.md']);
  assert.deepStrictEqual(plan.skipped, []);
});

test('AC2: parked and needs:definition proposals never join the ready bundle; parked stays a singleton', () => {
  const ps = [
    prop('r1.md', { title: 'R1', files: ['src/s.js'] }),
    prop('pk.md', { title: 'Parked', files: ['src/s.js'], labels: ['parked'] }),
    prop('nd.md', { title: 'Needs', files: ['src/s.js'], labels: ['needs:definition'], needs: true }),
    prop('r2.md', { title: 'R2', files: ['src/s.js'] }),
  ];
  const plan = planBundles(ps, { hubPaths: new Set() });
  assert.strictEqual(plan.bundles.length, 1);
  assert.strictEqual(plan.bundles[0].class, 'ready');
  assert.deepStrictEqual(keys(plan.bundles[0].members), ['r1.md', 'r2.md']);
  assert.deepStrictEqual(keys(plan.singletons), ['pk.md', 'nd.md']);
});

test('an unrecognized landing class is a singleton and named in skipped', () => {
  const ps = [
    prop('c1.md', { title: 'C1', files: ['src/s.js'], labels: ['ready', 'parked'] }),
    prop('c2.md', { title: 'C2', files: ['src/s.js'], noLabels: true }),
  ];
  const plan = planBundles(ps, { hubPaths: new Set() });
  assert.strictEqual(plan.bundles.length, 0);
  assert.deepStrictEqual(plan.skipped, [
    { key: 'c1.md', reason: 'singleton: unrecognized landing class' },
    { key: 'c2.md', reason: 'singleton: unrecognized landing class' },
  ]);
});

test('AC3: two needs:definition proposals sharing a file -> one bundle with an Open Question listing both', () => {
  const ps = [
    prop('n1.md', { title: 'Alpha', files: ['src/s.js'], labels: ['needs:definition'], needs: true }),
    prop('n2.md', { title: 'Beta', files: ['src/s.js'], labels: ['needs:definition'], needs: true }),
  ];
  const plan = planBundles(ps, { hubPaths: new Set() });
  assert.strictEqual(plan.bundles.length, 1);
  const out = composeBundle(plan.bundles[0]);
  assert.match(out.text, /^## Open Question$/m);
  assert.doesNotMatch(out.text, /^## Acceptance Criteria$/m);
  assert.match(out.text, /Should Alpha change\?/);
  assert.match(out.text, /Should Beta change\?/);
  assert.ok(!out.labels.includes('ready'));
  assert.ok(out.labels.includes('needs:definition'));
  assert.ok(!out.labels.some((l) => /^(risk|size):/.test(l)));
  assert.match(out.text, /^Labels: needs:definition$/m);
});

test('AC4: a 12-member group with groupSizeGuard 10 -> 10 + 2 in manifest order; 11 -> 10 + 1 singleton', () => {
  const make = (n) => Array.from({ length: n }, (_, i) => prop(`m${String(i).padStart(2, '0')}.md`, { title: `M${i}`, files: ['src/s.js'] }));
  const twelve = planBundles(make(12), { hubPaths: new Set(), groupSizeGuard: 10 });
  assert.deepStrictEqual(twelve.bundles.map((b) => b.members.length), [10, 2]);
  assert.deepStrictEqual(keys(twelve.bundles[0].members), make(10).map((p) => p.key));
  assert.deepStrictEqual(keys(twelve.bundles[1].members), ['m10.md', 'm11.md']);
  const eleven = planBundles(make(11), { hubPaths: new Set(), groupSizeGuard: 10 });
  assert.deepStrictEqual(eleven.bundles.map((b) => b.members.length), [10]);
  assert.deepStrictEqual(keys(eleven.singletons), ['m10.md']);
  assert.strictEqual(planBundles(make(11), { hubPaths: new Set() }).bundles[0].members.length, 10);
});

test('AC5: a file cited by 3 run proposals bundles them; the same file in hubPaths does not bridge', () => {
  const ps = ['a', 'b', 'c'].map((n) => prop(`${n}.md`, { title: n.toUpperCase(), files: ['src/busy.js'] }));
  assert.deepStrictEqual(planBundles(ps, { hubPaths: new Set() }).bundles.map((b) => b.members.length), [3]);
  const hubbed = planBundles(ps, { hubPaths: new Set(['src/busy.js']) });
  assert.strictEqual(hubbed.bundles.length, 0);
  assert.strictEqual(hubbed.singletons.length, 3);
  // A hub path is never reported as a joining path either.
  const mixed = ['a', 'b'].map((n) => prop(`${n}.md`, { title: n, files: ['src/busy.js', 'src/real.js'] }));
  assert.deepStrictEqual(planBundles(mixed, { hubPaths: new Set(['src/busy.js']) }).bundles[0].sharedPaths, ['src/real.js']);
});

test('AC6/AC15: every member marker is carried in member order; quoted markers (raw, defused, fenced) add nothing', () => {
  const rawFence = '\n\n```\n<!-- work-fingerprint: fenced-raw -->\nwork-fingerprint: fenced-raw\n```\n\n<!-- work-fingerprint: loose-raw -->\n';
  const ps = [
    // A member's own marker is the producer's; the raw quoted ones sit in its body text.
    { ...prop('a.md', { title: 'A', files: ['src/s.js'], fp: 'fp-a', extraBody: rawFence }), fingerprint: 'fp-a' },
    prop('b.md', { title: 'B', files: ['src/s.js'], fp: 'fp-b' }),
    prop('c.md', { title: 'C', files: ['src/s.js'] }),
    prop('d.md', { title: 'D', files: ['src/s.js'], fp: 'fp-d', extraBody: '\n\nwork-fingerprint : already-defused' }),
  ];
  // The fixture really contains the raw hazard before bundling.
  assert.ok(extractFingerprints(stage({ title: 'A', fp: 'fp-a', extraBody: rawFence })).includes('fenced-raw'));
  const out = composeBundle(planBundles(ps, { hubPaths: new Set() }).bundles[0]);
  assert.deepStrictEqual(extractFingerprints(out.text), ['fp-a', 'fp-b', 'fp-d']);
  assert.strictEqual(extractFingerprint(out.text), 'fp-a');
  const lastMarkerStart = out.text.indexOf('<!-- work-fingerprint: fp-a -->');
  assert.ok(lastMarkerStart > out.text.indexOf('## Release Note'), 'markers trail the body');
});

test('AC7: highest risk, size >= largest member, shared Type else task, Defer-reason majority (tie -> first)', () => {
  const ps = [
    prop('a.md', { title: 'A', files: ['src/s.js'], risk: 'low', size: 'small'.replace('small', 'low'), type: 'bug', deferReason: 'tangential' }),
    prop('b.md', { title: 'B', files: ['src/s.js'], risk: 'high', size: 'medium', type: 'bug', deferReason: 'genuinely-larger' }),
    prop('c.md', { title: 'C', files: ['src/s.js'], type: 'bug', deferReason: 'genuinely-larger' }),
  ];
  const out = composeBundle(planBundles(ps, { hubPaths: new Set() }).bundles[0]);
  assert.deepStrictEqual(out.labels, ['risk:high', 'size:medium', 'ready']);
  assert.strictEqual(out.type, 'bug');
  assert.strictEqual(out.deferReason, 'genuinely-larger');
  assert.match(out.text, /^Type: bug\nLabels: risk:high, size:medium, ready\nDefer-reason: genuinely-larger\n\n/m);
  assert.strictEqual(out.title, 'Bundle: 3 follow-ups touching src/s.js');

  const mixed = [
    prop('a.md', { title: 'A', files: ['src/s.js'], type: 'bug', deferReason: 'needs-verification' }),
    prop('b.md', { title: 'B', files: ['src/s.js'], type: 'feature', deferReason: 'tangential' }),
  ];
  const tie = composeBundle(planBundles(mixed, { hubPaths: new Set() }).bundles[0]);
  assert.strictEqual(tie.type, 'task');
  assert.strictEqual(tie.deferReason, 'needs-verification');
  assert.deepStrictEqual(tie.labels, ['ready']);
});

test('labels carry a by:* origin only when every member shares it and never auto:* or bot:*', () => {
  const same = [
    prop('a.md', { title: 'A', files: ['src/s.js'], labels: ['by:code-health', 'ready', 'auto:build', 'bot:blocked'] }),
    prop('b.md', { title: 'B', files: ['src/s.js'], labels: ['by:code-health', 'ready'] }),
  ];
  assert.deepStrictEqual(composeBundle(planBundles(same, { hubPaths: new Set() }).bundles[0]).labels, ['by:code-health', 'ready']);
  const differ = [same[0], prop('c.md', { title: 'C', files: ['src/s.js'], labels: ['by:docs-health', 'ready'] })];
  assert.deepStrictEqual(composeBundle(planBundles(differ, { hubPaths: new Set() }).bundles[0]).labels, ['ready']);
});

test('the body carries a checklist, per-member criteria, the key-file union and the union of risk flags', () => {
  const ps = [
    prop('a.md', { title: 'A', files: ['src/s.js', 'src/a.js'], riskFlags: 'auth' }),
    prop('b.md', { title: 'B', files: ['src/s.js', 'src/b.js'], deferReason: 'genuinely-larger', riskFlags: 'migrations' }),
  ];
  const out = composeBundle(planBundles(ps, { hubPaths: new Set() }).bundles[0]);
  assert.match(out.text, /^- \[ \] A — Defer-reason: tangential \(staged\/a\.md\)$/m);
  assert.match(out.text, /^- \[ \] B — Defer-reason: genuinely-larger \(staged\/b\.md\)$/m);
  assert.match(out.text, /^### A\n\nA is fixed\.$/m);
  assert.match(out.text, /^### B\n\nB is fixed\.$/m);
  assert.match(out.text, /Fixes A\. Fixes B\./);
  for (const f of ['src/s.js', 'src/a.js', 'src/b.js']) assert.ok(out.text.includes(`- \`${f}\` — modify`));
  assert.match(out.text, /^Origin: review console bundle of 2 staged proposals$/m);
  const body = out.text.slice(out.text.indexOf('\n\n') + 2);
  assert.deepStrictEqual(parseRiskFlags(body).flags, ['migrations', 'auth']);
  assert.strictEqual(parseRiskFlags(body).status, 'ok');
});

test('a near-duplicate open record adds a Related line; none given adds none', () => {
  const ps = [
    prop('a.md', { title: 'A', files: ['src/s.js'] }),
    prop('b.md', { title: 'B', files: ['src/s.js'] }),
  ];
  const bundle = planBundles(ps, { hubPaths: new Set() }).bundles[0];
  assert.doesNotMatch(composeBundle(bundle).text, /\*\*Related:\*\*/);
  const open = [{ number: 77, title: 'Bundle: 2 follow-ups touching src/s.js', body: '## Technical Approach\n\n### Key Files\n\n- `src/s.js` — modify\n- `src/a.js` — modify\n', labels: [] }];
  assert.match(composeBundle(bundle, { openRecords: open }).text, /^\*\*Related:\*\* #77$/m);
});

test('a member with no valid Defer-reason is a singleton, not a bundle member', () => {
  const ps = [
    prop('a.md', { title: 'A', files: ['src/s.js'] }),
    { ...prop('b.md', { title: 'B', files: ['src/s.js'] }), deferReason: 'bogus' },
    prop('c.md', { title: 'C', files: ['src/s.js'] }),
  ];
  const plan = planBundles(ps, { hubPaths: new Set() });
  assert.deepStrictEqual(keys(plan.bundles[0].members), ['a.md', 'c.md']);
  assert.deepStrictEqual(plan.skipped, [{ key: 'b.md', reason: 'singleton: no valid Defer-reason' }]);
});
