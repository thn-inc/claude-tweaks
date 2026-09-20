const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Two records landed in one change, in the same two files and largely the same
// paragraphs: #124 supplied the *why* (the Subagent Contract is dispatch-correctness
// discipline, not the "token-saving infrastructure" it was once labelled) and #153
// the *who* (third-party agents are exempt, on a structural condition).
//
// They are mutually load-bearing, which is why the check guards both rather than
// either alone. The exemption argues *from* the correctness framing — "the contract
// buys dispatch correctness for agents we author, so a delegation adapts at the
// boundary instead" — and reads as arbitrary the moment the surrounding prose calls
// the contract a cost optimization again. In the other direction, the correctness
// framing loses its one worked example if the exemption goes.
//
// #153's acceptance criterion 8 asks for a durable artifact rather than a one-time
// instruction, on the grounds that "read #124 before editing" protects only the
// person who reads it. This is that artifact: an unrelated future edit that drops
// either clause fails the suite instead of silently leaving the file arguing against
// itself.

const ROOT = path.join(__dirname, '..');

const FILES = {
  'skills/_shared/subagent-output-contract.md': fs.readFileSync(
    path.join(ROOT, 'plugin', 'skills', '_shared', 'subagent-output-contract.md'),
    'utf8',
  ),
  'CLAUDE.md': fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8'),
};

// The fan-out section ("How to integrate at a dispatch site") and its "single assistant
// message" sentence moved to subagent-dispatch-core.md at #2019 — read separately since the
// clause-presence loop above (dispatch correctness / third-party exemption) still targets the
// parent contract file, which keeps those two clauses.
const DISPATCH_CORE = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', '_shared', 'subagent-dispatch-core.md'),
  'utf8',
);

// The exemption's own text, isolated from the rest of the file, so the
// structural-signal assertions below prove the condition sits *inside* the
// exemption rather than somewhere unrelated that happens to mention `agents/`.
// The _shared file carries a dedicated section; CLAUDE.md carries one paragraph.
function sectionRegion(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return '';
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

function exemptionRegion(text) {
  const section = sectionRegion(text, '## Exemption: third-party agents');
  if (section) return section;
  const para = text.search(/\*\*Third-party agents are exempt\*\*/);
  if (para === -1) return '';
  const end = text.indexOf('\n\n', para);
  return text.slice(para, end === -1 ? text.length : end);
}

// Both clauses must be readable from EITHER entry point: a reader arriving at
// CLAUDE.md and a reader arriving at the _shared file have to land on the same rule
// ([IL-17] — correcting one occurrence is never enough, the fact recurs reworded).
for (const [name, text] of Object.entries(FILES)) {
  test(`${name}: the contract's rationale is stated as dispatch correctness (#124)`, () => {
    assert.match(
      text,
      /dispatch correctness/i,
      `${name} must name "dispatch correctness" as what the Subagent Contract buys. That is ` +
        "#124's reframing — the contract's load-bearing value is correctness (status protocol, " +
        'working-directory discipline, output templates), not unmeasured token savings. Do not ' +
        "delete the framing: #153's third-party exemption argues directly from it.",
    );
  });

  test(`${name}: third-party agents are exempt, on a structural condition (#153)`, () => {
    assert.match(
      text,
      /third-party agents[^.]{0,80}exempt|exemption:\s*third-party agents/i,
      `${name} must state that third-party agents are exempt from this contract. Without it, ` +
        'the next reader concludes the impeccable-finish-reviewer dispatch ' +
        '(skills/design-wrapper/modes/review.md Step 3.7) is non-compliant and "fixes" it.',
    );

    // AC1: the condition is where the agent's definition lives — never a judgment
    // call about whose output is convenient to parse.
    const region = exemptionRegion(text);
    assert.ok(region.length > 0, `${name} must carry a locatable third-party exemption passage`);
    // Both spellings of the same directory are accepted: the payload cites it
    // payload-relative (`agents/`), CLAUDE.md repo-root-relative since the #418
    // cutover moved the payload under `plugin/` (`plugin/agents/`).
    assert.match(
      region,
      /`(?:plugin\/)?agents\/`/,
      `${name}'s exemption must name its structural condition inside the exemption itself: the ` +
        "agent's definition lives outside the `agents/` directory this plugin owns. " +
        '"Any agent whose output is inconvenient" must not be a readable interpretation.',
    );
    // Emphasis stripped first: both files bold parts of this sentence ("is **never**
    // exempt"), and a pattern that spans the markers matches the rendering rather
    // than the claim.
    assert.match(
      region.replace(/\*/g, ''),
      /never exempt/i,
      `${name}'s exemption must say a claude-tweaks-authored agent is NEVER exempt. A carve-out ` +
        'that only says who is released, and not who is not, is the judgment-shaped reading ' +
        'AC1 rules out.',
    );
  });
}

test('the exemption releases the agent but not the caller (#153 AC2)', () => {
  const region = exemptionRegion(FILES['skills/_shared/subagent-output-contract.md']);

  // Exempting the agent from the protocol does not exempt the dispatcher from
  // handling its outcomes — the status line is gone, so the caller carries what it
  // would have routed.
  const obligations = [
    [/normaliz/i, 'normalizing the foreign output at the boundary'],
    [/availability/i, 'checking availability at the agent level, not the plugin level'],
    [/returned nothing|empty|unparseable/i, 'handling an agent that fails or returns nothing'],
  ];
  for (const [pattern, what] of obligations) {
    assert.match(
      region,
      pattern,
      `The exemption must still bind the caller to ${what}. Exempting the agent from the ` +
        'protocol does not exempt the caller from its outcomes.',
    );
  }
});

test('the rationale section itself leads with correctness, not cost (#124)', () => {
  const contract = FILES['skills/_shared/subagent-output-contract.md'];
  const start = contract.indexOf('## Why this exists');
  assert.notStrictEqual(start, -1, 'the contract must keep a "Why this exists" section');
  const why = contract.slice(start, contract.indexOf('\n## ', start + 1));

  assert.match(
    why,
    /dispatch correctness/i,
    'The rationale section — not merely some later paragraph — must be the one that names ' +
      'dispatch correctness. #124\'s root cause was a cost label sitting where the reason ' +
      'should be, which made a removal\'s scope ambiguous.',
  );
  assert.doesNotMatch(
    why,
    /60-80%|token-saving infrastructure/i,
    'The unmeasured "cuts output by 60-80%" claim and the "token-saving infrastructure" label ' +
      'are exactly what #124 removed. Cost may appear as an acknowledged side effect; it must ' +
      'not return as the justification.',
  );
});

test('the exempt dispatch names itself in both the contract and the call site (#153)', () => {
  // A carve-out with no named instance drifts into a general licence. The contract
  // names the one dispatch it covers; the call site names the carve-out it relies on.
  assert.match(
    FILES['skills/_shared/subagent-output-contract.md'],
    /impeccable-finish-reviewer/,
    'The exemption must name its one current exempt dispatch, so the carve-out stays a ' +
      'specific delegation rather than a general licence.',
  );

  const reviewMode = fs.readFileSync(
    path.join(ROOT, 'plugin', 'skills', 'design-wrapper', 'modes', 'review.md'),
    'utf8',
  );
  assert.match(
    reviewMode,
    /Exemption: third-party agents/,
    'review.md Step 3.7 must cite the exemption section by name, so a reader who arrives at ' +
      'the dispatch and wonders why it carries no status line lands on the carve-out in one hop.',
  );
});

// #649: the fan-out prose said "parallel" but never stated the mechanism (emit every
// Agent/Task call of a fan-out as tool_use blocks in one assistant message) — an
// evaluated /specify run serialized 18 persona dispatches into 18 separate messages,
// 7s apart, because nothing in the plugin's text said otherwise. These tests pin the
// one canonical sentence (never duplicated) and every named fan-out site's citation of
// it (never a restatement of the mechanism).

test('the fan-out section states the single-assistant-message rule exactly once (#649 AC1)', () => {
  const matches = DISPATCH_CORE.match(/single assistant message/g) || [];
  assert.strictEqual(
    matches.length,
    1,
    'skills/_shared/subagent-dispatch-core.md must contain the exact phrase ' +
      '"single assistant message" exactly once — the canonical fan-out sentence (#649). A ' +
      'second occurrence means the sentence was duplicated instead of cited; zero means it ' +
      'was dropped or reworded away from the pinned phrase.',
  );

  const section = sectionRegion(DISPATCH_CORE, '## How to integrate at a dispatch site');
  assert.notStrictEqual(
    section,
    '',
    'subagent-dispatch-core.md must keep its "How to integrate at a dispatch site" section — ' +
      'the fan-out sentence lives there (moved from subagent-output-contract.md at #2019)',
  );
  assert.match(
    section,
    /single assistant message/,
    'the "single assistant message" sentence must live inside the fan-out section itself, not ' +
      'somewhere unrelated that happens to mention it',
  );
});

const FAN_OUT_SITES = {
  '/browse': 'skills/browse/SKILL.md',
  '/dispatch': 'skills/dispatch/task-prompt.md',
  '/help': 'skills/help/status-scan.md',
  '/init': 'skills/init/SKILL.md',
  '/review': 'skills/review/step3-lens-dispatch.md',
  '/specify': 'skills/specify/red-team.md',
  '/test': 'skills/test/qa-prompts.md',
  '/tidy': 'skills/tidy/scan-execution.md',
  '/visual-review': 'skills/visual-review/page-mode.md',
};

function readSite(relPath) {
  return fs.readFileSync(path.join(ROOT, 'plugin', relPath), 'utf8');
}

for (const [skillName, relPath] of Object.entries(FAN_OUT_SITES)) {
  test(`${skillName} cites the fan-out single-assistant-message rule (#649)`, () => {
    assert.match(
      readSite(relPath),
      /single-assistant-message rule/,
      `${relPath} must cite the fan-out rule by name ("single-assistant-message rule") rather ` +
        "than leaving the fan-out mechanism unstated. Cite _shared/subagent-dispatch-core.md's " +
        'fan-out section — do not restate the mechanism text itself (#649).',
    );
  });
}

// red-team is the one site whose batching unit is not "the whole fan-out": personas
// batch per sub-issue, so the citation alone underdetermines the dispatch.
test('red-team.md states its own per-sub-issue batching unit (#649)', () => {
  const redTeam = readSite(FAN_OUT_SITES['/specify']);
  assert.match(
    redTeam,
    /one message per sub-issue/,
    "red-team.md must state its own dispatch batching unit: one message per sub-issue's " +
      "persona set (#649's Deliverables)",
  );
  assert.match(
    redTeam,
    /fast-lane[^.]*joins the next/i,
    "red-team.md must state that a fast-lane sub-issue's single Skeptical Reviewer call joins " +
      'the next sub-issue\'s message rather than spending a whole message on one agent',
  );
});

test('subagent-output-contract.md states the Scratch rule inside Input Discipline (#2022)', () => {
  const contract = FILES['skills/_shared/subagent-output-contract.md'];
  const section = sectionRegion(contract, '## Input Discipline');
  assert.notStrictEqual(section, '', 'contract must keep its Input Discipline section');
  assert.match(
    section,
    /\*\*Scratch rule\.\*\*/,
    'Input Discipline must state the Scratch rule as a bold-led paragraph, matching the ' +
      'section\'s existing "**A file allowlist...**" / "**Inherited project context...**" style',
  );
  assert.match(
    section,
    /never under the repository tree/,
    'the Scratch rule must say an agent-created verification file never goes under the ' +
      'repository tree',
  );
  assert.match(
    section,
    /deletes what it created/,
    'the Scratch rule must require the agent to delete what it created before its status word',
  );
});
