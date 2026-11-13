// tests/rendered-ui-units-launch-sites.test.js — pins #5280: the four sites that launch a nested
// unit whose result feeds the rendered-UI check (visual-review page/journey agents, design-wrapper
// review Steps 3.7/3.8) name that child a rendered-UI unit and cite _shared/rendered-ui-units.md.
// Without the sentence the dispatcher has no cue that the child gets artifact-progress windows
// (or, for 3.7/3.8, that it gets none and its late result is staged).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const paragraphStartingWith = (text, prefix) => text.split('\n\n').find((p) => p.startsWith(prefix)) || '';

const VISUAL_FACTS = [
  [/rendered-UI\s+unit/, 'names the child a rendered-UI unit'],
  [/`(?:\.\.\/)*_shared\/rendered-ui-units\.md`/, 'cites the rendered-UI unit contract'],
  [/`\.claude-tweaks\/artifacts\/screenshots\/browse\/\{session\}\/`/, 'names the session screenshot directory'],
  [/absolute\s+path/, 'names the session directory as an absolute path'],
];
const DESIGN_FACTS = [
  [/rendered-UI\s+unit/, 'names the child a rendered-UI unit'],
  [/`\.\.\/\.\.\/_shared\/rendered-ui-units\.md`/, 'cites the rendered-UI unit contract'],
  [/no\s+artifact\s+directory/, 'states it has no artifact directory'],
];

const SITES = [
  ['visual-review/page-mode.md', (t) => lineStartingWith(t, '> **Contract:**'), VISUAL_FACTS],
  ['visual-review/discover-mode.md', (t) => lineStartingWith(t, '> **Parallel execution (conditional):**'), VISUAL_FACTS],
  ['design-wrapper/modes/review.md (Step 3.7)', (t) => paragraphStartingWith(t, '**Dispatch.** One `Task()` call, `subagent_type: impeccable-finish-reviewer`'), DESIGN_FACTS],
  ['design-wrapper/modes/review.md (Step 3.8)', (t) => lineStartingWith(t, '> **Contract:**'), DESIGN_FACTS],
];
const fileOf = (name) => path.join(SKILLS, ...name.split(' ')[0].split('/'));

test('AC1.1: each rendered-UI launch site names its child a rendered-UI unit and its artifact directory (#5280)', () => {
  for (const [name, region, facts] of SITES) {
    const text = region(readText(fileOf(name)));
    assert.ok(text.length > 0, `region not found in ${name}`);
    assert.deepEqual(missingFactsOf(facts)(text), [], `${name} is missing facts`);
  }
});

test('AC1.1: each launch-site fact goes red on its own (discrimination proof)', () => {
  for (const [name, region, facts] of SITES) {
    assertEachPatternGoesRed(region(readText(fileOf(name))), facts, missingFactsOf(facts));
  }
});
