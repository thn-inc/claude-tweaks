// tests/impeccable-engine-skip-reasons.test.js
//
// Prose-code-twin pin (record #2980): plugin/skills/design-wrapper/
// impeccable-plugin.md's Degradation table must name every failure reason
// plugin/bin/lib/impeccable-engine/index.js can return, each with a fix or an
// explanation of why there isn't one. If the module adds, removes, or renames
// a reason, this test catches the doc going stale instead of a human noticing
// it by chance.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { FAILURE_REASONS } = require('../plugin/bin/lib/impeccable-engine');

const DOC = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'impeccable-plugin.md');

// Reasons the engine module documents with a canned `fix` string returned at
// runtime (resolve()/run() in index.js) vs. the two that carry `detail`
// instead, and `timeout`, which carries neither (index.js returns a bare
// `{ok: false, reason: 'timeout'}`) — the doc must still say what to do.
const REASONS_WITH_CANNED_FIX = new Set(['not-installed', 'upgrade-required', 'engine-not-installed']);
const REASONS_WITH_DETAIL = new Set(['shape-mismatch', 'exec-failed']);

test('impeccable-engine/index.js exports the six frozen failure reasons', () => {
  assert.deepStrictEqual(
    [...FAILURE_REASONS].sort(),
    ['engine-not-installed', 'exec-failed', 'not-installed', 'shape-mismatch', 'timeout', 'upgrade-required'],
    'FAILURE_REASONS changed shape — update this test\'s expectation deliberately, then the doc below'
  );
});

function degradationSection(doc) {
  const headingMatch = /^## Degradation\s*$/m.exec(doc);
  assert.notStrictEqual(headingMatch, null, 'impeccable-plugin.md must have a "## Degradation" heading');
  const start = headingMatch.index;
  const next = doc.indexOf('\n## ', start + headingMatch[0].length);
  return doc.slice(start, next === -1 ? doc.length : next);
}

test("impeccable-plugin.md's Degradation table names every engine failure reason", () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const section = degradationSection(doc);

  for (const reason of FAILURE_REASONS) {
    assert.ok(
      section.includes(`\`${reason}\``),
      `Degradation section does not name the \`${reason}\` failure reason`
    );
  }
});

test('every engine failure reason has a fix or a named reason there is none', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const section = degradationSection(doc);

  // Table rows look like `| `reason` | meaning | wording | fix text |`.
  const rows = new Map();
  for (const m of section.matchAll(/^\|\s*`([a-z-]+)`\s*\|(.*)\|(.*)\|(.*)\|\s*$/gm)) {
    rows.set(m[1], m[4].trim());
  }

  for (const reason of FAILURE_REASONS) {
    assert.ok(rows.has(reason), `Degradation table has no row for \`${reason}\``);
    const fixCell = rows.get(reason);
    assert.ok(fixCell.length > 0, `\`${reason}\`'s Fix cell is empty`);
    if (REASONS_WITH_CANNED_FIX.has(reason)) {
      assert.match(
        fixCell,
        /module/i,
        `\`${reason}\` carries a canned \`fix\` string from the module — the doc's Fix cell should say so`
      );
    } else if (REASONS_WITH_DETAIL.has(reason)) {
      assert.match(
        fixCell,
        /detail/i,
        `\`${reason}\` carries a \`detail\` field but no canned \`fix\` — the doc's Fix cell should point to \`detail\``
      );
    }
    // `timeout` carries neither `fix` nor `detail` (index.js returns a bare
    // {ok: false, reason: 'timeout'}) — only the non-empty-cell check above applies.
  }
});
