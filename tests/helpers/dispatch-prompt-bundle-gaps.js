'use strict';
// The documented #1995 gaps: `_shared/` citations in dispatch/task-prompt.md's dispatched text
// with no compose step behind them yet. tests/dispatch-prompt-bundle-citations.test.js owns the
// rule and its stale-gap check; any other suite that restates the no-`_shared/` rule for a part
// of task-prompt.md reads the same list, so the two can never disagree about what is exempt.
// `_shared/rendered-ui-units.md` (#5280) is cited by the wait rule's exception sentence in all
// three task-prompt.md copies; nothing composes it into a bundle.
const GAPS = ['_shared/run-dir-resolution.md', '_shared/integration-model.md', '_shared/rendered-ui-units.md'];

// Text with every documented gap citation removed, for a no-`_shared/` assertion.
function withoutGaps(text) {
  return GAPS.reduce((acc, gap) => acc.split(gap).join(''), text);
}

module.exports = { GAPS, withoutGaps };
