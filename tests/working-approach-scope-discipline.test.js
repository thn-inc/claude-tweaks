'use strict';
// Pins the scope-and-edit discipline adopted from the Fable 5.1 prompting
// guide (platform.claude.com/docs/en/build-with-claude/prompt-engineering/
// prompting-claude-fable-5-1) at its three plugin surfaces:
//
//   1. The Working Approach block in init's CLAUDE.md template — the rules an
//      /init-generated CLAUDE.md loads on every turn of a project session.
//   2. This repo's own CLAUDE.md, whose Working Approach section must stay
//      byte-conformant to that block under the same checker Update Mode runs
//      against adopting projects. Scoped to Working Approach only: the
//      `claude-tweaks Pipeline` section already differs from the template by
//      design (this repo carries its own Integration-model paragraph), and
//      the evals fixtures are frozen generator output, deliberately not synced.
//   3. /build's implementer injection, which quotes the same sentences into
//      implementer execution — pinned to the SAME literals as the template so
//      the two wordings cannot drift apart (docs/skill-graph.md, init → /build).
//
// Live-corpus read, per `[IL-80]`'s carve-out: the assertions pin shipped text
// that is itself the contract (Update Mode byte-compares it), so a fixture
// would only duplicate the template. The go-red control is in-test: the
// pre-change bullets are frozen below and asserted absent (`[IL-105]`).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  extractTemplateBody,
  splitSections,
  checkConformance,
} = require('../plugin/bin/lib/init/claude-md-conformance');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const TEMPLATE_SRC = read('plugin/skills/init/claude-md-template.md');
const CLAUDE_MD = read('CLAUDE.md');
const BUILD_SKILL = read('plugin/skills/build/SKILL.md');

// The three sentences the adoption added — one wording, shared by the template
// bullets and /build's quoted instruction.
const TEST_VOLUME_SENTENCE = 'Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch.';
const FOLLOW_UP_SENTENCE = 'Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it.';
const EDIT_IN_PLACE_SENTENCE = 'Don\'t reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.';

// Frozen pre-change bullets (origin/main before this adoption) — the go-red
// control: a revert of the template silently passes substring pins on the
// unchanged prefix, so assert the OLD full lines are gone too.
const OLD_SIMPLICITY_BULLET = '- **Simplicity first.** Write the minimum correct code for what was asked — nothing speculative, no abstractions for single-use code. ("Do it properly" above means correct, not more.)';
const OLD_SURGICAL_BULLET = '- **Surgical changes.** Touch only what the task requires. Don\'t reformat or "improve" adjacent code. Match the surrounding style.';

function templateWorkingApproach() {
  const section = splitSections(extractTemplateBody(TEMPLATE_SRC)).get('Working Approach');
  assert.ok(section, 'template has no "## Working Approach" section');
  return section;
}

test('the template Working Approach block carries the three adopted sentences inside its existing bullets', () => {
  const section = templateWorkingApproach();
  const bullets = section.split('\n').filter((l) => l.startsWith('- **'));
  const simplicity = bullets.find((l) => l.startsWith('- **Simplicity first.**'));
  const surgical = bullets.find((l) => l.startsWith('- **Surgical changes.**'));
  assert.ok(simplicity && simplicity.includes(TEST_VOLUME_SENTENCE), 'test-volume sentence missing from Simplicity first');
  assert.ok(surgical && surgical.includes(FOLLOW_UP_SENTENCE), 'follow-up sentence missing from Surgical changes');
  assert.ok(surgical && surgical.includes(EDIT_IN_PLACE_SENTENCE), 'edit-in-place sentence missing from Surgical changes');
  // Go-red control: the pre-change bullet lines must no longer exist verbatim.
  assert.ok(!bullets.includes(OLD_SIMPLICITY_BULLET), 'pre-change Simplicity first bullet is back');
  assert.ok(!bullets.includes(OLD_SURGICAL_BULLET), 'pre-change Surgical changes bullet is back');
});

test("this repo's CLAUDE.md Working Approach is byte-conformant to the template (Update Mode's own checker)", () => {
  const r = checkConformance({ templateSource: TEMPLATE_SRC, projectClaudeMd: CLAUDE_MD });
  assert.deepStrictEqual(
    r.drifted.filter((d) => d.section === 'Working Approach').map((d) => ({ expected: d.expected, actual: d.actual })),
    [],
  );
  assert.ok(r.conformant.includes('Working Approach'), `Working Approach not conformant: ${JSON.stringify(r, null, 2)}`);
});

test('/build quotes the same three sentences into implementer execution, after the maturity table, with composition rules', () => {
  const start = BUILD_SKILL.indexOf('### Common Step 2: Execute the Plan');
  assert.ok(start > -1, 'build SKILL.md must carry "### Common Step 2: Execute the Plan"');
  const nextH3 = BUILD_SKILL.indexOf('\n### ', start + 1);
  const step = BUILD_SKILL.slice(start, nextH3 === -1 ? undefined : nextH3);
  const posMaturity = step.indexOf('**Maturity-scaled test discipline');
  const posScope = step.indexOf('**Scope and edit discipline (both strategies, every maturity):**');
  assert.ok(posMaturity > -1, 'maturity-scaled paragraph missing');
  assert.ok(posScope > posMaturity, 'scope-and-edit paragraph must follow the maturity table its composition rule refers to');
  const paragraph = step.slice(posScope).split('\n\n')[0];
  for (const sentence of [TEST_VOLUME_SENTENCE, FOLLOW_UP_SENTENCE, EDIT_IN_PLACE_SENTENCE]) {
    assert.ok(paragraph.includes(sentence), `build paragraph does not quote the template sentence: ${sentence}`);
  }
  // The quoted text must be the template's own words, not a paraphrase.
  assert.ok(paragraph.includes('in exactly these words'));
  // Composition rule 1: a maturity-mandated test is never an "extra".
  assert.ok(paragraph.includes('the quoted instruction limits extras, never a mandated test'));
  // Composition rule 2: reported follow-ups have a consumer (Common Step 4's
  // ledger / capture routing), so the instruction cannot become an implicit deferral.
  assert.ok(paragraph.includes('a blocking one goes to the open-items ledger and a non-blocking one is filed via `/claude-tweaks:capture`, both per Common Step 4 below'));
  const step4 = BUILD_SKILL.indexOf('### Common Step 4');
  assert.ok(step4 > start, 'Common Step 4 must exist after Step 2 for the routing reference to resolve');
  // Composition rule 3 (#3117): the quoted rule binds the implementer mid-task;
  // the deferral gate's fix-now test decides the reported follow-up's disposition.
  const COMPOSITION_SENTENCE = "The quoted rule limits what an implementer changes mid-task, not a reported follow-up's disposition: `_shared/deferral-gate.md`'s fix-now test decides that before the follow-up reaches the ledger or `/claude-tweaks:capture`.";
  assert.ok(paragraph.includes(COMPOSITION_SENTENCE), 'build paragraph does not carry the deferral-gate composition sentence');
  assert.ok(paragraph.indexOf(COMPOSITION_SENTENCE) > paragraph.indexOf(EDIT_IN_PLACE_SENTENCE), 'composition sentence must sit after the quoted Working Approach text');
});

test('working-approach: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const FILE = path.join(ROOT, 'plugin/skills/build/SKILL.md');
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  const start = text.indexOf('### Common Step 2: Execute the Plan');
  const nextH3 = text.indexOf('\n### ', start + 1);
  const step = text.slice(start, nextH3 === -1 ? undefined : nextH3);
  const paragraph = step.slice(step.indexOf('**Scope and edit discipline (both strategies, every maturity):**')).split('\n\n')[0];
  assert.ok(paragraph.includes('in exactly these words'));
});
