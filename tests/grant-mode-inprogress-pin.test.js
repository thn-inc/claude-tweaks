'use strict';

// Conformance pin (#654): the headless grant posture's (formerly grant-mode.md,
// now backlog/refine-headless.md) not-already-claimed exclusion must keep using
// the exact filter expression refineWorklist's `inProgress` semantics use
// (bin/lib/issues/backlog.js). #1384 moved that filter's source of truth out
// of hand-composed skill prose (which now just names the CLI) into
// `filterCandidates` in the module below — so the pin lives here, where
// `node --test` exercises the expression instead of only its text. A rewrite
// of it, even a behaviorally equivalent one, fails loudly rather than
// silently drifting from `refineWorklist`'s semantics.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const MODULE_REL = 'plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js';
const FILTER_EXPR = '.filter((i) => !i.facets.bot.inProgress)';

test('backlog-grant-gate.js still contains the literal not-already-claimed filter expression', () => {
  const source = readText(path.join(__dirname, '..', MODULE_REL));
  assert.ok(
    source.includes(FILTER_EXPR),
    `expected the literal filter expression \`${FILTER_EXPR}\` in ${MODULE_REL}`,
  );
});
