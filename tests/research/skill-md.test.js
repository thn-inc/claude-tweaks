const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKILL_PATH = path.join(REPO_ROOT, 'plugin', 'skills', 'research', 'SKILL.md');

function readSkill() {
  return fs.readFileSync(SKILL_PATH, 'utf8');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-z-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2];
  }
  return fm;
}

const VERIFY_MODE_PATH = path.join(REPO_ROOT, 'plugin', 'skills', 'research', 'verify-mode.md');

function readVerifyMode() {
  return fs.readFileSync(VERIFY_MODE_PATH, 'utf8');
}

const SOURCE_REGISTRY_PATH = path.join(REPO_ROOT, 'plugin', 'skills', 'research', 'source-registry.md');

function readSourceRegistry() {
  return fs.readFileSync(SOURCE_REGISTRY_PATH, 'utf8');
}

const REGISTRY_SOURCES = [
  'runtime', 'codebase', 'repo-prose', 'tests',
  'history', 'telemetry', 'deps', 'web', 'human',
];

test('SKILL.md exists', () => {
  assert.ok(fs.existsSync(SKILL_PATH), `Expected ${SKILL_PATH} to exist`);
});

test('SKILL.md frontmatter has required fields', () => {
  const fm = parseFrontmatter(readSkill());
  assert.ok(fm, 'frontmatter block missing');
  assert.strictEqual(fm.name, 'research');
  assert.ok(fm.description && fm.description.length > 20, 'description must be present and substantive');
  assert.match(fm.description, /research/i, 'description must mention research');
});

// #1909: the directive moved to a single SessionStart-hook injection
// (plugin/bin/lib/hooks/interaction-style.js) rather than being restated in
// every SKILL.md — pinned there by tests/hooks-session-start.test.js.
test('SKILL.md does not carry its own inline interaction style directive', () => {
  const body = readSkill();
  assert.ok(!body.includes('> **Interaction style:**'));
});

test('SKILL.md has the required sections', () => {
  const body = readSkill();
  assert.match(body, /## When to Use/);
  assert.match(body, /## Anti-Patterns/);
  assert.match(body, /## Next Actions/);
});

test('SKILL.md mode picker mentions all four modes with standard recommended', () => {
  const body = readSkill();
  assert.match(body, /quick/i);
  assert.match(body, /standard/i);
  assert.match(body, /deep/i);
  assert.match(body, /ultradeep/i);
  assert.match(body, /standard.*recommended|recommended.*standard/i);
});

test('SKILL.md output path is project-local under .claude-tweaks/research/', () => {
  const body = readSkill();
  assert.match(body, /\.claude-tweaks\/research\//);
  assert.doesNotMatch(body, /~\/Documents/, 'should not reference upstream ~/Documents path');
});

test('SKILL.md describes delegation to the built-in /deep-research', () => {
  const body = readSkill();
  assert.match(body, /deep-research/, 'must reference the built-in /deep-research');
  assert.match(body, /Dynamic Workflow/i, 'must name the Dynamic Workflows feature');
});

test('SKILL.md describes an inline fallback path', () => {
  const body = readSkill();
  assert.match(body, /fallback/i, 'must describe a fallback');
  assert.match(body, /methodology\.md/, 'fallback must point at reference/methodology.md');
});

test('SKILL.md includes the built-in setup/enablement note', () => {
  const body = readSkill();
  assert.match(body, /2\.1\.154/, 'must state the minimum Claude Code version');
  assert.match(body, /disableWorkflows|CLAUDE_CODE_DISABLE_WORKFLOWS/, 'must mention how the feature is gated');
});

test('SKILL.md has a Component-Skill Contract keyed on PIPELINE_RUN_DIR', () => {
  const body = readSkill();
  assert.match(body, /## Component-Skill Contract/);
  assert.match(body, /\$PIPELINE_RUN_DIR/);
});

test('verify-mode.md exists', () => {
  assert.ok(fs.existsSync(VERIFY_MODE_PATH), `Expected ${VERIFY_MODE_PATH} to exist`);
});

test('verify-mode.md documents the no-brief path so skipping /challenge does not skip grounding', () => {
  const body = readVerifyMode();
  // [IL-66]: tolerate both the hyphenated "No-brief case" heading and the prose
  // "a record with no brief" — the phrase appears in both shapes in the file.
  assert.match(body, /no[\s-]brief/i, 'must name the no-brief case');
  assert.match(
    body,
    /generate\s+the\s+candidate\s+set\s+from\s+the\s+topic/i,
    'must say the candidate set is generated from the topic directly',
  );
});

test('verify-mode.md resolves the bare-verify ambiguity by presenting a choice', () => {
  const body = readVerifyMode();
  assert.match(
    body,
    /ambiguous[\s\S]{0,300}AskUserQuestion/i,
    'must resolve the bare-verify ambiguity by presenting a choice, not merely mention both',
  );
});

test('verify-mode.md states that verify is not reachable from /flow', () => {
  const body = readVerifyMode();
  assert.match(body, /\/claude-tweaks:flow|\/flow/, 'must name /flow');
  assert.match(
    body,
    /not\s+reachable[\s\S]{0,80}flow/i,
    'must tie "not reachable" to /flow specifically, not merely contain the phrase',
  );
});

test('SKILL.md argument-hint accepts the verify mode', () => {
  const fm = parseFrontmatter(readSkill());
  assert.ok(fm, 'frontmatter block missing');
  assert.match(fm['argument-hint'], /verify/, 'argument-hint must document the verify form');
});

test('SKILL.md ## Input documents both the bare-topic and verify forms', () => {
  const body = readSkill();
  const start = body.indexOf('## Input');
  const end = body.indexOf('## Mode Picker');
  assert.ok(start !== -1 && end > start, 'expected ## Input to precede ## Mode Picker');
  const input = body.slice(start, end);
  assert.match(input, /verify/, '## Input must document the verify form');
  assert.match(input, /topic/i, '## Input must still document the bare-topic form');
  // The two assertions above pass even on an inverted ## Input that says a leading
  // `verify` token is NOT accepted — verified. This one anchors the grammar itself.
  assert.match(
    input,
    /first\s+token[\s\S]{0,200}verify/i,
    '## Input must key the verify form on the first token',
  );
});

test('SKILL.md references verify-mode.md by a stub naming the file', () => {
  const body = readSkill();
  assert.match(
    body,
    /read\s+`?verify-mode\.md`?\s+in\s+this\s+skill's\s+directory/i,
    'must use the canonical sub-file stub wording',
  );
});

test('verify-mode.md states the consequence filter as a two-outcome question', () => {
  const body = readVerifyMode();
  assert.match(body, /would\s+the\s+design\s+change/i, 'must state the filter question verbatim');
  // Anchored, not a bare /drop/i: "drop" appears ~11 times in the finished file, so the
  // bare form survives this row being reworded to "Drop it silently." — the exact opposite
  // of the requirement. Verified to discriminate during plan authoring ([IL-78]).
  assert.match(
    body,
    /drop\s+it,?\s+and\s+log\s+the\s+drop/i,
    'must state that the drop outcome is logged, not silent',
  );
});

test('verify-mode.md logs every filter drop to decisions.md in the shared entry format', () => {
  const body = readVerifyMode();
  assert.match(body, /decisions\.md/, 'must name decisions.md');
  assert.match(body, /auto-decision-log\.md/, 'must cite the canonical line format');
  assert.match(body, /Reversibility:/, 'must quote the entry schema');
});

test('verify-mode.md routes unfalsifiable questions to survey and bounds tiers to survey breadth', () => {
  const body = readVerifyMode();
  assert.match(body, /unfalsifiable/i, 'must name the unfalsifiable shape');
  assert.match(body, /ultradeep/, 'must name the existing depth tiers');
  assert.match(body, /bounds?\s+survey\s+breadth\s+only/i, 'tiers must bound survey breadth only');
  // Anchors the two terms together so a swapped routing table fails. The three
  // assertions above all pass on an inverted table — verified. Gap is 160, not
  // 120: the real row is 118 chars wide and 120 leaves no margin ([IL-78]).
  assert.match(
    body,
    /unfalsifiable[\s\S]{0,160}(?:survey|landscape)/i,
    'must route unfalsifiable questions to survey, not merely mention both words',
  );
});

test('verify-mode.md states that absence is a finding', () => {
  const body = readVerifyMode();
  assert.match(body, /no\s+precedent\s+exists/i, 'absence must be reported, not omitted');
});

test('verify-mode.md resolves survey depth through the documented precedence chain', () => {
  const body = readVerifyMode();
  assert.match(body, /auto-mode-contract\.md/, 'must cite the contract');
  assert.match(
    body,
    /CLI[\s-]?arg[\s\S]{0,160}pipeline[\s-]?config[\s\S]{0,160}project[\s-]?policy[\s\S]{0,160}skill[\s-]?default/i,
    'must state the full four-step precedence chain (whitespace-flexible across line wraps)',
  );
});

test('source-registry.md exists', () => {
  assert.ok(fs.existsSync(SOURCE_REGISTRY_PATH), `Expected ${SOURCE_REGISTRY_PATH} to exist`);
});

for (const source of REGISTRY_SOURCES) {
  test(`source-registry.md has an entry for ${source}`, () => {
    const body = readSourceRegistry();
    assert.match(
      body,
      new RegExp(`\\|\\s*\`${source}\`\\s*\\|`),
      `registry must carry a table row for the ${source} source`,
    );
  });
}

test('source-registry.md keys every entry by what it falsifies, not by tool', () => {
  const body = readSourceRegistry();
  assert.match(body, /falsif/i, 'must speak in terms of falsification');
  // The header row must name all three required columns. Anchoring to the header
  // rather than to any one row's text is what makes this fail if a column is dropped.
  assert.match(
    body,
    /\|\s*Source\s*\|\s*What\s+it\s+can\s+falsify\s*\|\s*Confidence\s*\|\s*Read\s+mechanism\s*\|/i,
    'registry table must carry Source / What it can falsify / Confidence / Read mechanism columns',
  );
});

test('source-registry.md runtime entry cites the bounded-output form', () => {
  const body = readSourceRegistry();
  assert.match(body, /exit=/, 'must show the bounded-output exit-status capture');
  assert.match(body, /judge-procedure\.md/, 'must cite docs-health as the technique it reuses');
});

test('source-registry.md human entry is a terminator that dispatches no agent', () => {
  const body = readSourceRegistry();
  assert.match(
    body,
    /dispatches\s+no\s+agent/i,
    'the human entry must state it dispatches no agent',
  );
  // Gap-tolerant: the prose reads "stop researching **it** and ask", so an
  // adjacency-only /stop\s+researching\s+and\s+ask/ returns zero. Caught by running
  // this regex against the planned prose during plan authoring, not after ([IL-66]).
  assert.match(
    body,
    /stop\s+researching[\s\S]{0,20}and\s+ask/i,
    'routing to human must terminate research for that question',
  );
});

test('source-registry.md deps entry records the node_modules denial and its fallback', () => {
  const body = readSourceRegistry();
  assert.match(body, /node_modules/, 'must name node_modules');
  assert.match(
    body,
    /node_modules[\s\S]{0,40}structurally\s+denied/i,
    'must state the denial is structural, not a transient permission prompt',
  );
  assert.match(
    body,
    /node_modules[\s\S]{0,400}public\s+documentation/i,
    'the reduced-confidence fallback must sit with the deps denial, not merely appear somewhere',
  );
});

test('verify-mode.md points at source-registry.md by name', () => {
  const body = readVerifyMode();
  assert.match(body, /source-registry\.md/, 'verify-mode.md must name the registry sub-file');
});

test('source-registry.md routes a question to every source that could falsify it', () => {
  const body = readSourceRegistry();
  assert.match(
    body,
    /goes\s+to\s+\*\*every\s+source\s+that\s+could\s+falsify/i,
    'must state the route-to-all rule as the rule, not merely mention the phrase',
  );
  // Both assertions bind the full claim structure, not a keyword. Inversion-tested:
  // rewording to "the single best source" / "a single source per question is the
  // normal case" fails both ([IL-78]).
  assert.match(
    body,
    /multiple\s+sources\s+per\s+question\s+is\s+the\s+(?:normal|default)\s+case/i,
    'multiplicity must be stated as the default, not the exception',
  );
});

test('source-registry.md verdict carries per-source confidence and the checked-against sha', () => {
  const body = readSourceRegistry();
  // Anchored to the template line, not the bare token. Inversion-tested: a bare
  // /checked-at/ still matches prose reading "we deliberately omit any checked-at
  // stamping; it is not needed" ([IL-78]).
  assert.match(
    body,
    /checked-at:\s*\{sha\}/,
    'the verdict template must carry a checked-at sha field',
  );
  assert.match(body, /outcome:\s*verified\s*\|\s*falsified\s*\|\s*unverified/i, 'must define the three outcomes');
  // Anchored to the claim, not to the word "confidence" (which appears in the
  // registry table header and several rows) ([IL-78]).
  assert.match(
    body,
    /confidence\s+is\s+per-source,?\s+not\s+per-report/i,
    'must state that confidence is carried per source, not per report',
  );
});

test('source-registry.md dispatch inlines a literal output template', () => {
  const body = readSourceRegistry();
  assert.match(body, /OUTPUT\s+FORMAT\s+\(required\)/, 'must inline a literal output template block');
  // The point of inlining is that a reference does not reach the agent. Assert the
  // template's own field names are present in the dispatch block, not merely that
  // the contract file is cited somewhere.
  assert.match(
    body,
    /OUTPUT\s+FORMAT\s+\(required\)[\s\S]{0,600}checked-at/,
    'the inlined template must carry the verdict fields, not just name the contract',
  );
});

test('source-registry.md dispatch uses Form B and the four-value status line', () => {
  const body = readSourceRegistry();
  assert.match(body, /Parallel execution:/, 'must carry the Form B parallel-execution directive');
  assert.match(
    body,
    /DONE\s*\|\s*DONE_WITH_CONCERNS\s*\|\s*NEEDS_CONTEXT\s*\|\s*BLOCKED/,
    'must inline the four-value status line, not merely mention BLOCKED',
  );
});

test('source-registry.md dispatch states the agents are read-only with no git access', () => {
  const body = readSourceRegistry();
  // Anchored to the claim about the agents. Inversion-tested: a bare /read-only/i
  // survives flipping "The agents are read-only" to "The agents may write", because
  // the phrase "bounded read-only commands" later in the same paragraph keeps it
  // green ([IL-78]).
  assert.match(
    body,
    /agents\s+are\s+read-only/i,
    'must state the agents themselves are read-only',
  );
  assert.match(
    body,
    /no\s+git\s+access|never\s+given\s+git|without\s+git\s+access/i,
    'must state the agents carry no git access',
  );
});
