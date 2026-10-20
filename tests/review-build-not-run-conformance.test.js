'use strict';
// Pins #3767: /review Step 7 reads the plan steps /build logged as not run
// (build/dispatch.md's Folded verification task SKIP lines, marked
// "surfaced for /review") and lists them in the summary's "Not run by /build"
// section. The compact clean-PASS form omits that section.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const template = readText(path.join(SKILLS, 'review', 'review-summary-template.md'));
const steps = readText(path.join(SKILLS, 'review', 'code-mode-steps.md'));
const dispatch = readText(path.join(SKILLS, 'build', 'dispatch.md'));

// Both anchors must resolve; the end anchor is searched after the start so a
// repeated end string elsewhere in the file cannot pull the slice wider.
function between(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `anchor missing: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `anchor missing: ${end}`);
  return text.slice(from, to);
}

const section = between(template, '### Not run by /build', '### QA Validation (from /test)');
const compact = between(template, '## Compact form — clean PASS', '```markdown');
const step7 = between(steps, '## Step 7: Present Review Summary', '### Key Learnings for Wrap-Up');
const folded = between(dispatch, '**Folded verification task (#3118).**', '**Single-task fast-lane skip');

const REGIONS = { section, compact, step7, folded };

const FACTS = {
  step7: [
    { name: 'AC1.1 step7 pointer', re: /When `\$PIPELINE_RUN_DIR` is set, collect the plan steps `\/build` logged as not run from its `decisions\.md` per `review-summary-template\.md`'s "Not run by \/build" section/ },
  ],
  section: [
    { name: 'AC1.1 include', re: /Include when `\$PIPELINE_RUN_DIR\/decisions\.md` holds at least one line under its `## \/build` heading that begins `- SKIP` and carries `not run by \/build; surfaced for \/review`/ },
    { name: 'AC1.1 both shapes', re: /could not run \(`\(skipped\)`\) or ran only in part \(`\(degraded\)`\)/ },
    { name: 'AC1.1 table', re: /\| Plan step \| Outcome \| Condition \|/ },
    { name: 'AC2.1 omit', re: /Omit otherwise: no run dir, or no such line\./ },
    { name: 'AC2.1 exclusion', re: /Other `\/build` `SKIP` lines trace skipped pipeline steps, not plan verification/ },
  ],
  compact: [
    { name: 'AC2.1 compact', re: /No `\/build` plan step left not run/ },
  ],
  folded: [
    { name: 'AC3.1 degraded keeps tail', re: /logs `\(degraded\)` in place of `\(skipped\)`, keeps the rest of the line,/ },
    { name: 'AC3.1 reader pointer', re: /`review\/review-summary-template\.md`'s "Not run by \/build" section reads both/ },
  ],
};

function countMatches(text, re) {
  return (text.match(new RegExp(re.source, 'g')) || []).length;
}

// Names of the facts whose regex no longer matches the region.
function missing(region, facts) {
  return facts.filter(({ re }) => !re.test(region)).map(({ name }) => name);
}

const PREFIX_MARKER_RE = /begins `([^`]+)` and carries `([^`]+)`/;
const HEADING_RE = /under its `([^`]+)` heading/;
const WRITER_RE = /writes `(SKIP \{time\} — [^`]+)`/;

// The reader selector: lines under the given "## ..." heading that start with
// the prefix and include the marker.
function selectRows(text, prefix, marker, heading) {
  const rows = [];
  let current = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^## (.+)$/);
    if (h) {
      current = `## ${h[1]}`;
      continue;
    }
    if (current === heading && line.startsWith(prefix) && line.includes(marker)) rows.push(line);
  }
  return rows;
}

test('AC1.1/AC2.1/AC3.1: every fact is present, and matches exactly once in its region', () => {
  for (const [regionName, facts] of Object.entries(FACTS)) {
    const region = REGIONS[regionName];
    assert.deepStrictEqual(missing(region, facts), [], `${regionName}: missing facts`);
    for (const { name, re } of facts) {
      assert.strictEqual(countMatches(region, re), 1, `${name}: expected exactly one match`);
    }
  }
});

test('go-red: stripping each fact reports exactly that fact', () => {
  for (const [regionName, facts] of Object.entries(FACTS)) {
    const original = REGIONS[regionName];
    for (const { name, re } of facts) {
      const mutated = original.replace(re, '');
      assert.notEqual(mutated, original, `${name}: regex did not match its region`);
      assert.deepStrictEqual(missing(mutated, facts), [name], name);
    }
  }
});

test('AC1.1/AC3.1 twin: the reader selector picks both writer shapes and nothing else', () => {
  const [, prefix, marker] = section.match(PREFIX_MARKER_RE);
  const [, heading] = section.match(HEADING_RE);
  const [, writer] = folded.match(WRITER_RE);
  const buildLine = `- ${writer.replace('{time}', '01:02:03')}`;
  const degradedLine = buildLine.replace('(skipped)', '(degraded)');
  assert.notEqual(degradedLine, buildLine, 'writer template carries (skipped)');

  const fixture = [
    '## /build',
    buildLine,
    degradedLine,
    '- SKIP 23:43:17 — Spec Step 2.5 Manual Steps classification (skipped): condition: no Manual Steps section in record #1796 -> fallback: nothing probed. Reversibility: n/a.',
    '',
    '## /review',
    '- STAGED 23:12:18 — log-decision: Reproduction: lens 3c finding plugin/skills/build/dispatch.md:19 (\'surfaced for /review\' in the spec-fixed SKIP text — …) not reproduced. Staged to Review Console as low-confidence. Reversibility: high.',
    '',
    '## /test',
    `- ${writer.replace('{time}', '01:02:04')}`,
  ].join('\n');

  assert.deepStrictEqual(selectRows(fixture, prefix, marker, heading), [buildLine, degradedLine]);
});

test('twin go-red: a reworded marker in the template stops matching the writer', () => {
  const [, prefix, marker] = section.match(PREFIX_MARKER_RE);
  const [, heading] = section.match(HEADING_RE);
  const [, writer] = folded.match(WRITER_RE);
  const fixture = `## /build\n- ${writer.replace('{time}', '01:02:03')}`;
  assert.deepStrictEqual(selectRows(fixture, prefix, marker, heading).length, 1, 'baseline selects the writer');

  const mutated = section.replace(marker, 'surfaced for review');
  assert.notEqual(mutated, section);
  const [, mutatedPrefix, mutatedMarker] = mutated.match(PREFIX_MARKER_RE);
  assert.deepStrictEqual(selectRows(fixture, mutatedPrefix, mutatedMarker, heading), []);
});
