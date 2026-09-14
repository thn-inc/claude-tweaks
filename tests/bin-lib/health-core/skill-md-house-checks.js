'use strict';

// Shared, parameterized SKILL.md house-structure checks -- factored out
// because the four health skills' tests/skill-md.test.js files duplicated the
// majority of these assertion bodies verbatim (the "has the required house
// sections in order" ordering test, "carries the standard interaction-style
// directive", the "$PIPELINE_RUN_DIR" check, the "no emojis" check, and the
// required-token forEach loop), with nothing enforcing that the copies stay in
// sync when CLAUDE.md's own documented SKILL.md house-structure convention
// changes.
//
// All four health skills' test files now consume this module: docs-health
// migrated first (2026-07-20 review-findings fix, Task 5), and code-health,
// harness-health, and journey-health followed. The three late migrations
// mattered for correctness, not just duplication: harness-health's and
// journey-health's copies still used a bare body.indexOf(), which made their
// ordering assertion vacuous (see sectionIndex below).
//
// The corpus-wide counterpart lives in
// tests/bin-lib/skill-audit/house-structure.test.js, which applies the subset
// of these rules that holds for every skill in skills/*/SKILL.md -- not just
// the health four. It reuses sectionIndex and EMOJI_RE from here rather than
// carrying a third copy.

// Anchored heading lookup: matches a heading only when it occupies its own
// full line, not a bare substring anywhere in the file. SKILL.md's
// boilerplate "> **Interaction style:**" directive and Component-Skill
// Contract prose both mention headings like "## Next Actions" inline as
// backticked references; a plain body.indexOf() resolves to the first of
// those mentions instead of the real section heading further down.
function sectionIndex(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = body.match(new RegExp(`^${escaped}$`, 'm'));
  return m ? m.index : -1;
}

// Registers the standard "has the required house sections in order" test:
// When to Use / Anti-Patterns / Component-Skill Contract / Next Actions, each
// present and in the documented order (Next Actions -> Component-Skill
// Contract -> Anti-Patterns). Relationship to Other Skills was removed from
// every skill in v6.34.0; its edges live in docs/skill-graph.md.
function registerHouseSectionOrderTest(test, assert, read) {
  test('has the required house sections in order', () => {
    const body = read();
    const idx = (s) => sectionIndex(body, s);
    assert.ok(idx('## When to Use') > 0);
    assert.ok(idx('## Anti-Patterns') > 0);
    assert.ok(idx('## Component-Skill Contract') > 0);
    assert.ok(idx('## Next Actions') > 0);
    assert.ok(idx('## Next Actions') < idx('## Component-Skill Contract'));
    assert.ok(idx('## Component-Skill Contract') < idx('## Anti-Patterns'));
  });
}

function registerInteractionStyleTest(test, assert, read) {
  // #1909: the directive moved out of every SKILL.md into a single
  // SessionStart-hook injection (plugin/bin/lib/hooks/interaction-style.js,
  // wired in session-start.js) — pinned there by
  // tests/hooks-session-start.test.js, not per-skill file content any more.
  // This test now guards the inverse: no skill silently reintroduces its own copy.
  test('does not carry its own inline interaction-style directive (moved to the SessionStart hook)', () => {
    assert.ok(!read().includes('> **Interaction style:**'));
  });
}

function registerPipelineRunDirTest(test, assert, read) {
  test('Component-Skill Contract is keyed on $PIPELINE_RUN_DIR', () => {
    assert.ok(read().includes('$PIPELINE_RUN_DIR'));
  });
}

// Common emoji ranges: U+1F300-U+1FAFF (Misc Symbols, Emoticons, etc.).
// Non-global on purpose -- a /g regex carries lastIndex state between .test()
// calls, which would make a shared module-level instance answer differently
// depending on what ran before it.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}]/u;

function registerNoEmojiTest(test, assert, read) {
  test('no emojis (common emoji unicode sequences)', () => {
    assert.ok(!EMOJI_RE.test(read()), 'SKILL.md must not contain emojis');
  });
}

function registerRequiredTokenTests(test, assert, read, tokens) {
  tokens.forEach((token) => {
    test(`contains required token '${token}'`, () => {
      const content = read();
      assert.ok(content.includes(token), `missing required token: ${token}`);
    });
  });
}

module.exports = {
  sectionIndex,
  EMOJI_RE,
  registerHouseSectionOrderTest,
  registerInteractionStyleTest,
  registerPipelineRunDirTest,
  registerNoEmojiTest,
  registerRequiredTokenTests,
};
