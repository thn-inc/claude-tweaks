'use strict';
// routeDeferral (#5930): where a legitimately-deferred item goes — a filed
// record or the digest. The oracle below is written from
// plugin/skills/_shared/materiality-floor.md's prose, never from route.js.
//
// The prose pin reads the live materiality-floor.md on purpose [IL-80]:
// route.js is the authority and the prose its explanation, so the pin's job
// is to fail when the explanation drifts from the frozen text the code was
// written against (the floor section at base commit 05a65b7353; the Overrides
// text as rewritten by #5932).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { routeDeferral, VERDICTS, RULES, EVIDENCE_REASONS, EVIDENCE_EXEMPT_REASONS } = require('../../../plugin/bin/lib/deferral-route/route');
const { DEFER_REASONS } = require('../../../plugin/bin/lib/issues/record');
const { SEVERITIES } = require('../../../plugin/bin/lib/tiebreak');
const { readText } = require('../../helpers/read-skill');
const { sectionOf } = require('../../helpers/conformance-asserts');

const FLOOR_MD = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'materiality-floor.md');

function oracle(c) {
  const digestible = c.agentRaised && c.size === 'low' && c.priority === 'low' && c.risk === 'low'
    && c.deferReason !== 'tangential' && !['high', 'critical'].includes(c.severity);
  if (digestible) return { verdict: 'digest', rule: 'floor' };
  let rule;
  if (!c.agentRaised) rule = 'human';
  else if (['high', 'critical'].includes(c.severity)) rule = 'severity';
  else if (c.deferReason === 'tangential') rule = 'tangential';
  else rule = 'not-low';
  return { verdict: 'file', rule };
}

const LOW = { size: 'low', priority: 'low', risk: 'low' };

test('AC7.1 exhaustive: every combination matches the oracle and stays in the three verdicts', () => {
  assert.equal(DEFER_REASONS.length, 7);
  const axis = ['low', 'medium', 'high', undefined];
  const severities = [...SEVERITIES, undefined];
  let count = 0;
  for (const deferReason of DEFER_REASONS) {
    for (const agentRaised of [true, false]) {
      for (const size of axis) {
        for (const priority of axis) {
          for (const risk of axis) {
            for (const severity of severities) {
              const c = { deferReason, severity, size, priority, risk, agentRaised };
              const result = routeDeferral(c);
              assert.deepStrictEqual(result, oracle(c), JSON.stringify(c));
              assert.ok(VERDICTS.includes(result.verdict), JSON.stringify(c));
              count += 1;
            }
          }
        }
      }
    }
  }
  assert.equal(count, 5376);
});

test('vocabularies: SEVERITIES is the five finding severities', () => {
  assert.deepStrictEqual([...SEVERITIES], ['critical', 'high', 'medium', 'low', 'info']);
});

test('constants: VERDICTS and RULES are the frozen closed lists', () => {
  assert.deepStrictEqual([...VERDICTS], ['file', 'digest', 'refused']);
  assert.deepStrictEqual([...RULES], ['refused', 'human', 'severity', 'policy-reason', 'tangential', 'not-low', 'floor', 'no-evidence', 'run-cap']);
  assert.ok(Object.isFrozen(VERDICTS));
  assert.ok(Object.isFrozen(RULES));
});

test('a call with no argument is refused as data, never thrown', () => {
  const r = routeDeferral();
  assert.equal(r.verdict, 'refused');
  assert.equal(r.reason, `--defer-reason is required; one of: ${DEFER_REASONS.join(', ')}`);
});

test('AC10.1 rule order: tangential at severity high reports severity', () => {
  const r = routeDeferral({ deferReason: 'tangential', severity: 'high', ...LOW, agentRaised: true });
  assert.deepStrictEqual(r, { verdict: 'file', rule: 'severity' });
});

test('AC10.2 rule order: a bad reason is refused before severity', () => {
  const r = routeDeferral({ deferReason: 'not-a-reason', severity: 'high', ...LOW, agentRaised: true });
  assert.equal(r.verdict, 'refused');
  assert.equal(r.rule, 'refused');
  assert.ok(r.reason.includes('"not-a-reason"'), r.reason);
  assert.ok(r.reason.includes('pre-existing-outside-diff'), r.reason);
});

test('AC10.3 rule order: human with a bad reason is refused', () => {
  const r = routeDeferral({ deferReason: 'not-a-reason', ...LOW, agentRaised: false });
  assert.equal(r.verdict, 'refused');
  assert.equal(r.rule, 'refused');
});

test('refused: missing reason, non-boolean agentRaised, bad severity', () => {
  const reasons = DEFER_REASONS.join(', ');
  const severities = SEVERITIES.join(', ');
  for (const deferReason of [undefined, null]) {
    assert.deepStrictEqual(routeDeferral({ deferReason, ...LOW, agentRaised: true }), {
      verdict: 'refused', rule: 'refused', reason: `--defer-reason is required; one of: ${reasons}`,
    });
  }
  for (const agentRaised of [undefined, null, 'true', 1]) {
    assert.deepStrictEqual(routeDeferral({ deferReason: 'genuinely-larger', ...LOW, agentRaised }), {
      verdict: 'refused', rule: 'refused', reason: 'exactly one of --agent-raised or --human is required',
    });
  }
  for (const severity of ['High', 'urgent', '']) {
    assert.deepStrictEqual(routeDeferral({ deferReason: 'genuinely-larger', severity, ...LOW, agentRaised: true }), {
      verdict: 'refused', rule: 'refused', reason: `--severity "${severity}" is not one of: ${severities}`,
    });
  }
  assert.deepStrictEqual(routeDeferral({ deferReason: 'genuinely-larger', severity: null, ...LOW, agentRaised: true }),
    { verdict: 'digest', rule: 'floor' });
});

test('refused: the first failing check names the reason — reason, then origin, then severity', () => {
  const reasons = DEFER_REASONS.join(', ');
  assert.equal(routeDeferral({ deferReason: 'not-a-reason', severity: 'urgent', ...LOW, agentRaised: 'yes' }).reason,
    `--defer-reason "not-a-reason" is not one of: ${reasons}`);
  assert.equal(routeDeferral({ severity: 'urgent', ...LOW, agentRaised: 'yes' }).reason,
    `--defer-reason is required; one of: ${reasons}`);
  assert.equal(routeDeferral({ deferReason: 'genuinely-larger', severity: 'urgent', ...LOW, agentRaised: 'yes' }).reason,
    'exactly one of --agent-raised or --human is required');
});

test('not-low: case-variant and garbage axis values file', () => {
  for (const risk of ['Low', 'zzz']) {
    assert.deepStrictEqual(routeDeferral({ deferReason: 'genuinely-larger', ...LOW, risk, agentRaised: true }),
      { verdict: 'file', rule: 'not-low' });
  }
});

// #5932: the policy-reason rule — a listed Defer-reason digests an agent-raised
// item, behind the human and severity protections.
const LIST = ['pre-existing-outside-diff', 'tangential'];

function policyOracle(c, list) {
  if (!c.agentRaised) return { verdict: 'file', rule: 'human' };
  if (['high', 'critical'].includes(c.severity)) return { verdict: 'file', rule: 'severity' };
  if (list.includes(c.deferReason)) return { verdict: 'digest', rule: 'policy-reason' };
  return oracle(c);
}

function allCombinations() {
  const axis = ['low', 'medium', 'high', undefined];
  const severities = [...SEVERITIES, undefined];
  const out = [];
  for (const deferReason of DEFER_REASONS) {
    for (const agentRaised of [true, false]) {
      for (const size of axis) {
        for (const priority of axis) {
          for (const risk of axis) {
            for (const severity of severities) {
              out.push({ deferReason, severity, size, priority, risk, agentRaised });
            }
          }
        }
      }
    }
  }
  return out;
}

const COMBINATIONS = allCombinations();

test('#5932 AC1.1 an explicit empty digestReasons routes exactly as #5930', () => {
  let count = 0;
  for (const c of COMBINATIONS) {
    assert.deepStrictEqual(routeDeferral({ ...c, digestReasons: [] }), oracle(c), JSON.stringify(c));
    count += 1;
  }
  assert.equal(count, 5376);
});

test('#5932 exhaustive with a digest list: every combination matches the policy oracle', () => {
  let count = 0;
  for (const list of [LIST, [...DEFER_REASONS], ['genuinely-larger']]) {
    for (const c of COMBINATIONS) {
      const result = routeDeferral({ ...c, digestReasons: list });
      assert.deepStrictEqual(result, policyOracle(c, list), JSON.stringify({ ...c, list }));
      assert.ok(VERDICTS.includes(result.verdict), JSON.stringify(c));
      count += 1;
    }
  }
  assert.equal(count, 16128);
});

test('#5932 AC2.1 a listed pre-existing-outside-diff at size high, risk medium digests by policy-reason', () => {
  const r = routeDeferral({ deferReason: 'pre-existing-outside-diff', size: 'high', risk: 'medium', agentRaised: true, digestReasons: LIST });
  assert.deepStrictEqual(r, { verdict: 'digest', rule: 'policy-reason' });
});

test('#5932 AC3.1 a listed tangential digests by policy-reason', () => {
  const r = routeDeferral({ deferReason: 'tangential', ...LOW, agentRaised: true, digestReasons: LIST });
  assert.deepStrictEqual(r, { verdict: 'digest', rule: 'policy-reason' });
});

test('#5932 AC3.2 the same item from a human files by human', () => {
  const r = routeDeferral({ deferReason: 'tangential', ...LOW, agentRaised: false, digestReasons: LIST });
  assert.deepStrictEqual(r, { verdict: 'file', rule: 'human' });
});

test('#5932 AC4.1 a listed reason at severity high or critical files by severity', () => {
  for (const severity of ['high', 'critical']) {
    const r = routeDeferral({ deferReason: 'pre-existing-outside-diff', severity, ...LOW, agentRaised: true, digestReasons: LIST });
    assert.deepStrictEqual(r, { verdict: 'file', rule: 'severity' });
  }
});

test('#5932 AC5.1 an unlisted genuinely-larger at not-low axes files by not-low', () => {
  const r = routeDeferral({ deferReason: 'genuinely-larger', size: 'high', priority: 'medium', risk: 'medium', agentRaised: true, digestReasons: LIST });
  assert.deepStrictEqual(r, { verdict: 'file', rule: 'not-low' });
});

test('#5932 a refusal ignores digestReasons', () => {
  const input = { deferReason: 'not-a-reason', agentRaised: true };
  const withAll = routeDeferral({ ...input, digestReasons: [...DEFER_REASONS] });
  assert.equal(withAll.verdict, 'refused');
  assert.deepStrictEqual(withAll, routeDeferral({ ...input, digestReasons: [] }));
});

test('#5932 review focus 5: a string digestReasons never digests by substring', () => {
  const digestReasons = 'pre-existing-outside-diff, tangential';
  assert.deepStrictEqual(routeDeferral({ deferReason: 'pre-existing-outside-diff', ...LOW, agentRaised: true, digestReasons }),
    { verdict: 'digest', rule: 'floor' });
  assert.deepStrictEqual(routeDeferral({ deferReason: 'tangential', ...LOW, agentRaised: true, digestReasons }),
    { verdict: 'file', rule: 'tangential' });
});

test('#5932 a non-DEFER_REASONS entry in digestReasons is inert', () => {
  const digestReasons = ['not-a-reason'];
  assert.deepStrictEqual(routeDeferral({ deferReason: 'genuinely-larger', ...LOW, agentRaised: true, digestReasons }),
    { verdict: 'digest', rule: 'floor' });
  assert.deepStrictEqual(routeDeferral({ deferReason: 'genuinely-larger', ...LOW, size: 'high', agentRaised: true, digestReasons }),
    { verdict: 'file', rule: 'not-low' });
});

// #5933: the no-evidence and run-cap frictions, after the floor, on an
// agent-raised item that would file by tangential or not-low.
const NEEDS_EVIDENCE = ['pre-existing-outside-diff', 'genuinely-larger', 'tangential'];

function frictionOracle(c, list, f) {
  const base = policyOracle(c, list);
  if (base.verdict !== 'file' || !c.agentRaised || base.rule === 'severity') return base;
  if (f.evidenceRequired && NEEDS_EVIDENCE.includes(c.deferReason) && !f.evidenceValid) return { verdict: 'digest', rule: 'no-evidence' };
  if (f.cap !== undefined && f.filedCount >= f.cap) return { verdict: 'digest', rule: 'run-cap' };
  return base;
}

const FRICTIONS = [
  { evidenceRequired: false, evidenceValid: false, cap: undefined, filedCount: 0 },
  { evidenceRequired: true, evidenceValid: false, cap: undefined, filedCount: 0 },
  { evidenceRequired: true, evidenceValid: true, cap: undefined, filedCount: 0 },
  { evidenceRequired: false, evidenceValid: false, cap: 1, filedCount: 0 },
  { evidenceRequired: false, evidenceValid: false, cap: 1, filedCount: 1 },
  { evidenceRequired: false, evidenceValid: false, cap: 0, filedCount: 0 },
  { evidenceRequired: true, evidenceValid: false, cap: 1, filedCount: 1 },
  { evidenceRequired: true, evidenceValid: true, cap: 1, filedCount: 2 },
];

test('#5933 characterization: friction inputs that are off change no verdict', () => {
  let count = 0;
  for (const list of [[], LIST]) {
    for (const c of COMBINATIONS) {
      const off = { evidenceRequired: false, evidenceValid: false, cap: undefined, filedCount: 99 };
      assert.deepStrictEqual(routeDeferral({ ...c, digestReasons: list, ...off }), policyOracle(c, list), JSON.stringify(c));
      count += 1;
    }
  }
  assert.equal(count, 10752);
});

test('#5933 every DEFER_REASONS member is in exactly one evidence group', () => {
  assert.deepStrictEqual([...EVIDENCE_REASONS], ['pre-existing-outside-diff', 'genuinely-larger', 'tangential']);
  assert.deepStrictEqual([...EVIDENCE_EXEMPT_REASONS],
    ['needs-human-decision', 'blocked-external', 'blocked-dependency', 'needs-verification']);
  assert.deepStrictEqual(EVIDENCE_REASONS.filter((r) => EVIDENCE_EXEMPT_REASONS.includes(r)), []);
  assert.deepStrictEqual([...EVIDENCE_REASONS, ...EVIDENCE_EXEMPT_REASONS].sort(), [...DEFER_REASONS].sort());
  assert.ok(Object.isFrozen(EVIDENCE_REASONS));
  assert.ok(Object.isFrozen(EVIDENCE_EXEMPT_REASONS));
});

test('#5933 exhaustive with frictions: every combination matches the friction oracle', () => {
  let count = 0;
  for (const list of [[], LIST]) {
    for (const f of FRICTIONS) {
      for (const c of COMBINATIONS) {
        const result = routeDeferral({ ...c, digestReasons: list, ...f });
        assert.deepStrictEqual(result, frictionOracle(c, list, f), JSON.stringify({ ...c, list, ...f }));
        assert.ok(VERDICTS.includes(result.verdict), JSON.stringify(c));
        count += 1;
      }
    }
  }
  assert.equal(count, 86016);
});

test('#5933 AC2.1 required: genuinely-larger at not-low axes without valid evidence digests by no-evidence', () => {
  const r = routeDeferral({ deferReason: 'genuinely-larger', size: 'high', agentRaised: true, evidenceRequired: true, evidenceValid: false });
  assert.deepStrictEqual(r, { verdict: 'digest', rule: 'no-evidence' });
});

test('#5933 AC2.2 with valid evidence it files', () => {
  const r = routeDeferral({ deferReason: 'genuinely-larger', size: 'high', agentRaised: true, evidenceRequired: true, evidenceValid: true });
  assert.deepStrictEqual(r, { verdict: 'file', rule: 'not-low' });
});

test('#5933 AC5.1 required: needs-human-decision with no evidence files', () => {
  const r = routeDeferral({ deferReason: 'needs-human-decision', size: 'high', agentRaised: true, evidenceRequired: true, evidenceValid: false });
  assert.deepStrictEqual(r, { verdict: 'file', rule: 'not-low' });
});

test('#5933 AC6.1 cap 1: the first would-file files and the second digests by run-cap', () => {
  const input = { deferReason: 'genuinely-larger', size: 'high', agentRaised: true, cap: 1 };
  assert.deepStrictEqual(routeDeferral({ ...input, filedCount: 0 }), { verdict: 'file', rule: 'not-low' });
  assert.deepStrictEqual(routeDeferral({ ...input, filedCount: 1 }), { verdict: 'digest', rule: 'run-cap' });
});

test('#5933 AC6.2 severity high files past the cap, and the next plain call digests', () => {
  const input = { deferReason: 'genuinely-larger', size: 'high', agentRaised: true, cap: 1 };
  assert.deepStrictEqual(routeDeferral({ ...input, severity: 'high', filedCount: 1 }), { verdict: 'file', rule: 'severity' });
  assert.deepStrictEqual(routeDeferral({ ...input, filedCount: 2 }), { verdict: 'digest', rule: 'run-cap' });
});

test('#5933 AC10.1 cap reached: an exempt needs-human-decision digests by run-cap', () => {
  const r = routeDeferral({ deferReason: 'needs-human-decision', size: 'high', agentRaised: true, cap: 1, filedCount: 1 });
  assert.deepStrictEqual(r, { verdict: 'digest', rule: 'run-cap' });
});

test('#5933 AC10.2 the same item from a human files', () => {
  const r = routeDeferral({ deferReason: 'needs-human-decision', size: 'high', agentRaised: false, cap: 1, filedCount: 1 });
  assert.deepStrictEqual(r, { verdict: 'file', rule: 'human' });
});

test('#5933 the floor and a policy reason beat the frictions', () => {
  assert.deepStrictEqual(
    routeDeferral({ deferReason: 'genuinely-larger', ...LOW, agentRaised: true, evidenceRequired: true, evidenceValid: false }),
    { verdict: 'digest', rule: 'floor' });
  assert.deepStrictEqual(
    routeDeferral({ deferReason: 'tangential', ...LOW, agentRaised: true, digestReasons: LIST, cap: 0, filedCount: 0 }),
    { verdict: 'digest', rule: 'policy-reason' });
});

test('#5933 cap 0 digests every agent-raised would-file item', () => {
  for (const deferReason of DEFER_REASONS) {
    assert.deepStrictEqual(routeDeferral({ deferReason, size: 'high', agentRaised: true, cap: 0, filedCount: 0 }),
      { verdict: 'digest', rule: 'run-cap' }, deferReason);
  }
});

test('#5933 guards: only true, and only a non-negative integer cap, count', () => {
  const base = { deferReason: 'genuinely-larger', size: 'high', agentRaised: true };
  assert.deepStrictEqual(routeDeferral({ ...base, evidenceRequired: 'true' }), { verdict: 'file', rule: 'not-low' });
  assert.deepStrictEqual(routeDeferral({ ...base, evidenceRequired: true, evidenceValid: 'yes' }),
    { verdict: 'digest', rule: 'no-evidence' });
  for (const cap of ['1', -1, 1.5, null, NaN]) {
    assert.deepStrictEqual(routeDeferral({ ...base, cap, filedCount: 5 }), { verdict: 'file', rule: 'not-low' }, String(cap));
  }
  assert.deepStrictEqual(routeDeferral({ ...base, cap: 1, filedCount: '9' }), { verdict: 'file', rule: 'not-low' });
});

test('#5933 a refusal ignores the friction inputs', () => {
  const input = { deferReason: 'not-a-reason', agentRaised: true };
  const withAll = routeDeferral({ ...input, evidenceRequired: true, evidenceValid: false, cap: 0, filedCount: 9 });
  assert.equal(withAll.verdict, 'refused');
  assert.deepStrictEqual(withAll, routeDeferral(input));
});

const FLOOR_SECTION = `## The floor

Route to the digest only when the item would be filed at **all three**: \`size:low\` AND
\`priority:low\` AND \`risk:low\` (\`_shared/work-record.md\`'s Label taxonomy table — Risk/Size/Priority
rows), judged at filing time by the routing skill itself — not read off an existing label, since
most filing paths never stamp \`priority:*\` (it is an optional family; only \`/backlog refine\`,
\`/backlog attention\`, \`/dispatch\`, and \`/specify\`'s \`next\` mode write it). The routing skill judges
all three axes as it would score a fresh filing, including the unstamped priority axis. An axis the
routing skill genuinely cannot judge, or judges ambiguously, counts as **not low** — the floor
fails toward filing an ordinary issue, never toward the digest.
`;

const OVERRIDES_SECTION = `## Overrides

Checked in this order, ahead of the floor; the first that applies decides:

1. Human-typed \`/capture\` input files as an ordinary issue and is out of this contract's scope
   entirely — human input is intent, never exhaust, and never routes to the digest.
2. A finding carrying severity \`high\` or \`critical\` files as an ordinary issue. The three axes
   score the record's filing size, not the finding's severity, so without this a small fix to a
   high-severity finding could be digested where no gate that blocks on it (release Step 3's
   \`high-severity finding\` token) ever looks again.
3. An agent-raised item whose \`Defer-reason:\` is listed in policy key \`deferral-digest-reasons\`
   (default empty; \`_shared/policy-schema-deferral-routing.md\`) goes to the digest whatever its
   three axes, rule \`policy-reason\`. This relies on the digest lifecycle in \`tidy/digest-sweep.md\`:
   a promotion proposal, filed on approval, once three entries share an area, expiry after 90 days
   un-promoted. Changing either changes this policy's effect.
4. \`Defer-reason: tangential\` files as an ordinary issue — a tangential finding is a new idea the
   finding suggests, not residue of the current work.
`;

function assertProsePinned(text) {
  assert.equal(sectionOf(text, '## The floor'), FLOOR_SECTION);
  assert.equal(sectionOf(text, '## Overrides'), OVERRIDES_SECTION);
}

test('prose pin: floor and overrides sentences are byte-equal to materiality-floor.md', () => {
  assertProsePinned(readText(FLOOR_MD));
});

test('prose pin go-red: deleting the risk axis from the floor fails the pin', () => {
  const text = readText(FLOOR_MD);
  const noRisk = text.replace('AND `risk:low`', '');
  assert.notEqual(noRisk, text);
  assert.throws(() => assertProsePinned(noRisk));

  const tangentialLine = '4. `Defer-reason: tangential` files as an ordinary issue — a tangential finding is a new idea the\n';
  const noTangential = text.replace(tangentialLine, '');
  assert.notEqual(noTangential, text);
  assert.throws(() => assertProsePinned(noTangential));
});
