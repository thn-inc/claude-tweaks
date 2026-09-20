'use strict';

// Component-Skill Contract (CSC) registry.
//
// CLAUDE.md's Component-skill contract convention requires an explicit
// `## Component-Skill Contract` section, keyed on `$PIPELINE_RUN_DIR`, placed
// between `## Next Actions` and `## Anti-Patterns` -- for skills routinely
// invoked by other skills. Nothing enforced any of this corpus-wide before
// this file: presence, the `$PIPELINE_RUN_DIR` keying (found missing its `$`
// prefix in build and test's CSC prose -- fixed in the same change, not
// allowlisted), and the Next Actions < CSC < Anti-Patterns order.
//
// Two skills carry no CSC section at all -- `init` is a user-invoked entry
// point never read as a component by another skill; `ledger` documents its
// own exemption in-file (`## Invocation Model`): every caller reads it as a
// knowledge dependency, never through the Skill tool, so there is no
// `$PIPELINE_RUN_DIR` to key on. Seven more carry a CSC section
// that deliberately doesn't mention `$PIPELINE_RUN_DIR` -- two are always a
// component (no direct-invocation case to disambiguate: assess-agent-
// autonomy, flow), seven are never a component (standalone-only or
// machine-invoked-only, documented with near-identical "no
// `PIPELINE_RUN_DIR` signal" phrasing: browse, demo, help, intake,
// pipeline-smoke-test, routine-kickoff, tidy -- routine-kickoff's caller is a
// routine kernel's closing line, not a pipeline skill, so the same
// absence-of-signal reasoning applies; pipeline-smoke-test is human-invoked
// only by design (#44), never a pipeline component).
// PIPELINE_RUN_DIR_EXEMPT re-derives each exemption's
// justification from the file itself, mirroring house-structure.test.js's
// NO_NEXT_ACTIONS pattern -- if the justifying phrase disappears, the
// exemption stops being honored and the skill falls back to requiring
// `$PIPELINE_RUN_DIR` like every other component skill.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sectionIndex } = require('../health-core/skill-md-house-checks');
const { listSkillDirs, KNOWN_SKILLS } = require('../../../plugin/bin/lib/skill-audit/skill-catalog.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills');
// listSkillDirs takes the plugin payload root (`skills/` sits directly beneath it).
const SKILLS = listSkillDirs(path.join(ROOT, 'plugin'));

const readSkill = (name) => fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');

// house-structure.test.js's NO_NEXT_ACTIONS, mirrored: skills genuinely
// exempt from carrying a Component-Skill Contract section at all.
const NO_CSC = new Set(['init', 'ledger']);

// Skills whose CSC section legitimately omits `$PIPELINE_RUN_DIR` -- each
// entry's regex is the sentence in that skill's own file that justifies it.
const PIPELINE_RUN_DIR_EXEMPT = {
  'assess-agent-autonomy': /is \*\*always\*\* a component skill/,
  flow: /no parent-vs-direct branch to detect/,
  browse: /no `PIPELINE_RUN_DIR` signal/,
  demo: /no `PIPELINE_RUN_DIR` signal/,
  help: /no `PIPELINE_RUN_DIR` signal/,
  intake: /no `PIPELINE_RUN_DIR` signal/,
  'pipeline-smoke-test': /no `PIPELINE_RUN_DIR` signal/,
  'routine-kickoff': /no `PIPELINE_RUN_DIR` signal/,
  tidy: /no `PIPELINE_RUN_DIR` signal/,
};

const COMPONENT_SKILLS = SKILLS.filter((n) => !NO_CSC.has(n));

// Returns the text of `name`'s `## Component-Skill Contract` section, or null.
function cscBody(name) {
  const body = readSkill(name);
  const headings = [...body.matchAll(/^## .*$/gm)];
  const idx = headings.findIndex((m) => m[0] === '## Component-Skill Contract');
  if (idx === -1) return null;
  const start = headings[idx].index;
  const end = idx + 1 < headings.length ? headings[idx + 1].index : body.length;
  return body.slice(start, end);
}

test('the corpus resolves to every skill directory that has a SKILL.md', () => {
  assert.ok(SKILLS.length >= 30, `expected the whole skill corpus, found ${SKILLS.length}`);
  for (const known of KNOWN_SKILLS) {
    assert.ok(SKILLS.includes(known), `corpus is missing a known skill: ${known}`);
  }
});

test('every documented NO_CSC exception still names a skill that exists', () => {
  for (const name of NO_CSC) {
    assert.ok(SKILLS.includes(name), `stale exception: skills/${name}/SKILL.md is gone`);
  }
});

test("ledger's NO_CSC exemption is justified by the skill itself", () => {
  assert.ok(
    /the standard Component-Skill Contract .* does not apply here/s.test(readSkill('ledger')),
    'skills/ledger/SKILL.md no longer documents why it has no Component-Skill Contract',
  );
});

test('every documented PIPELINE_RUN_DIR_EXEMPT entry still names a component skill', () => {
  for (const name of Object.keys(PIPELINE_RUN_DIR_EXEMPT)) {
    assert.ok(COMPONENT_SKILLS.includes(name), `stale exception: ${name} is not a component skill`);
  }
});

for (const name of COMPONENT_SKILLS) {
  test(`${name}: carries a Component-Skill Contract section`, () => {
    assert.ok(
      sectionIndex(readSkill(name), '## Component-Skill Contract') > 0,
      `skills/${name}/SKILL.md is missing '## Component-Skill Contract'`,
    );
  });

  test(`${name}: Component-Skill Contract keys on $PIPELINE_RUN_DIR, or documents why not`, () => {
    const csc = cscBody(name);
    if (csc === null) return; // reported by the previous test
    const exemptPattern = PIPELINE_RUN_DIR_EXEMPT[name];
    if (exemptPattern) {
      assert.ok(
        exemptPattern.test(csc),
        `skills/${name}/SKILL.md's Component-Skill Contract no longer justifies its `
        + 'PIPELINE_RUN_DIR_EXEMPT entry in this file',
      );
      return;
    }
    assert.ok(
      csc.includes('$PIPELINE_RUN_DIR'),
      `skills/${name}/SKILL.md's Component-Skill Contract does not mention '$PIPELINE_RUN_DIR' -- `
      + 'either fix the keying or add a justified PIPELINE_RUN_DIR_EXEMPT entry in this file',
    );
  });

  test(`${name}: orders Next Actions before Component-Skill Contract before Anti-Patterns`, () => {
    const body = readSkill(name);
    const csc = sectionIndex(body, '## Component-Skill Contract');
    const ap = sectionIndex(body, '## Anti-Patterns');
    const na = sectionIndex(body, '## Next Actions');
    if (csc === -1) return; // reported by the presence test above
    assert.ok(ap > 0, `skills/${name}/SKILL.md is missing '## Anti-Patterns'`);
    assert.ok(
      csc < ap,
      `skills/${name}/SKILL.md orders Component-Skill Contract (${csc}) after Anti-Patterns (${ap})`,
    );
    if (na === -1) return; // NO_NEXT_ACTIONS-exempt skill (house-structure.test.js owns that check)
    assert.ok(
      na < csc,
      `skills/${name}/SKILL.md orders Next Actions (${na}) after Component-Skill Contract (${csc})`,
    );
  });
}
