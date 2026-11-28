// tests/health-sweep-filing-labels-conformance.test.js — #6374.
//
// The four health-sweep filings create their issue from a payload `recordPayload` built, and that
// payload's `labels` already leave `ready` off a body carrying a `Blocked by: … (left for …)` line.
// A filing that types `--label ready` itself undoes the withhold, so each filing applies every label
// in `payload.labels` instead (ci-health's idiom: title and body through session files, the Create
// row of `_shared/github-write-transport.md`, one `--label` per payload label). Each fact is proven
// red on its own with the shared helpers, and a frozen copy of the pre-fix create snippets proves the
// absence check can match what it bans.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const collapse = (text) => text.replace(/\s+/g, ' ');

// file: where the sweep's create prose lives; vars: the shell-variable prefix its fence uses.
const SWEEPS = [
  { name: 'code-health', file: 'code-health/filing.md', vars: 'CODE_HEALTH' },
  { name: 'docs-health', file: 'docs-health/SKILL.md', vars: 'DOCS_HEALTH' },
  { name: 'harness-health', file: 'harness-health/filing.md', vars: 'HARNESS_HEALTH' },
  { name: 'journey-health', file: 'journey-health/SKILL.md', vars: 'JOURNEY_HEALTH' },
];

const factsFor = ({ name, vars }) => [
  [/create the issue through `_shared\/github-write-transport\.md`'s Create row: title `payload\.title`, body `payload\.body`, every label in `payload\.labels`, never a hand-typed label list/, 'it creates through the Create row with every label in payload.labels'],
  [/`recordPayload` withholds `ready` from a body that carries a `Blocked by: … \(left for …\)` line, so a typed `ready` label would file what the payload withheld/, 'it says why a literal ready label is wrong'],
  [new RegExp(`${vars}_TITLE_FILE="\\$\\(node "\\$\\{CLAUDE_PLUGIN_ROOT\\}/bin/session-tmp-resolve\\.js" --value ${name}-title\\.txt\\)"`), 'the fence resolves the title file'],
  [new RegExp(`${vars}_BODY_FILE="\\$\\(node "\\$\\{CLAUDE_PLUGIN_ROOT\\}/bin/session-tmp-resolve\\.js" --value ${name}-body\\.md\\)"`), 'the fence resolves the body file'],
  [new RegExp(`runs the Create row's command with \`--title "\\$${vars}_TITLE"\`, \`--body-file "\\$${vars}_BODY_FILE"\` and one \`--label\` per entry of \`payload\\.labels\``), 'the call passes the title variable, the body file and one label per payload label'],
  [/`payload\.labels` never carries the type, so this step always applies it/, 'the type is still applied by the type branch'],
  [/omit `ready`, `risk:\*` and `size:\*` entirely/, 'the headless D5 exception still omits ready'],
];

// A create call that types a label `recordPayload` already decides: `ready`, a scoring tier, or the
// `by:` origin beside another --label (the create snippet's shape, not the index fetch's `--label by:x --state`).
const LITERAL_LABEL = /--(?:add-)?label[ =]"?(?:ready\b|risk:|size:|by:[a-z-]+"? --label)/;

// The create snippets as they stood before this fix, per sweep (a frozen control, never read from the tree).
const OLD_SNIPPETS = {
  'code-health': '  --label by:code-health \\\n  --label "risk:<tier>" \\\n  --label "size:<tier>" \\\n  --label ready',
  'docs-health': 'gh issue create --title "<payload.title>" --body "<payload.body>" --type task \\\n  --label by:docs-health --label risk:low --label size:low --label ready --label docs-health:additive',
  'harness-health': 'gh issue create --title "<payload.title>" --body "<payload.body>" --type task \\\n  --label by:harness-health --label risk:low --label size:low --label ready --label harness-health:additive',
  'journey-health': 'gh issue create --title "<payload.title>" --body "<payload.body>" --type task \\\n  --label by:journey-health --label risk:high --label size:medium --label ready --label journey-health:drift',
};

for (const sweep of SWEEPS) {
  test(`${sweep.name}: the filing applies every label in payload.labels and types no ready of its own`, () => {
    const text = readText(path.join(SKILLS, sweep.file));
    const facts = factsFor(sweep);
    const missing = missingFactsOf(facts);
    assert.deepEqual(missing(collapse(text)), [], `${sweep.file} states every fact`);
    assertEachPatternGoesRed(collapse(text), facts, missing);
    assert.equal(LITERAL_LABEL.test(text), false, `${sweep.file} still types a label the payload carries`);
    assert.equal(LITERAL_LABEL.test(OLD_SNIPPETS[sweep.name]), true, 'control: the old create snippet is matched');
  });
}

test('the literal-label check matches each way a create can type ready, and not an index fetch', () => {
  for (const line of ['--label ready', '--label "ready"', '--add-label ready', '--label=ready', '--label "risk:low"', '--label size:high', '--label by:docs-health --label risk:low']) {
    assert.equal(LITERAL_LABEL.test(line), true, line);
  }
  for (const line of ['gh issue list --label by:docs-health --state open --json number', '--label readyish', '`--label` per entry of `payload.labels`']) {
    assert.equal(LITERAL_LABEL.test(line), false, line);
  }
});
