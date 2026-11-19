'use strict';
// routeDeferral (#5930): where a legitimately-deferred item goes — a filed
// record or the digest. The oracle below is written from
// plugin/skills/_shared/materiality-floor.md's prose, never from route.js.
//
// The prose pin reads the live materiality-floor.md on purpose [IL-80]:
// route.js is the authority and the prose its explanation, so the pin's job
// is to fail when the explanation drifts from the frozen text the code was
// written against (base commit 05a65b7353).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { routeDeferral, VERDICTS, RULES } = require('../../../plugin/bin/lib/deferral-route/route');
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
  assert.deepStrictEqual([...RULES], ['refused', 'human', 'severity', 'policy-reason', 'tangential', 'not-low', 'floor']);
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

- \`Defer-reason: tangential\` always clears the floor and files as an ordinary issue — a tangential
  finding is a new idea the finding suggests, not residue of the current work, and ideas are
  intent, not exhaust (\`_shared/deferral-gate.md\`'s vocabulary).
- A finding carrying severity \`high\` or \`critical\` always clears the floor and files as an ordinary
  issue. The three axes score the record's filing size, not the finding's severity, so without
  this a small fix to a high-severity finding could be digested where no gate that blocks on it
  (release Step 3's \`high-severity finding\` token) ever looks again.
- Human-typed \`/capture\` input is out of this contract's scope entirely — human input is intent,
  never exhaust, and never routes to the digest.
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

  const tangentialLine = '- `Defer-reason: tangential` always clears the floor and files as an ordinary issue — a tangential\n';
  const noTangential = text.replace(tangentialLine, '');
  assert.notEqual(noTangential, text);
  assert.throws(() => assertProsePinned(noTangential));
});
