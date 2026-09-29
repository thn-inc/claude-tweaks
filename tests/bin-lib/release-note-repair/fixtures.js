'use strict';

const CS = '## Current State\n\nThe widget lookup is slow.\n';
const DEL = '## Deliverables\n\n1. Cache the widget lookup.\n';
const AC = '## Acceptance Criteria\n\n- [ ] Lookups are cached.\n';
const RN = '## Release Note\n\nMade widget lookups faster.\n';
const TA = '## Technical Approach\n\nUse a Map.\n';
const LINE = 'Made widget lookups faster.';
const join = (...parts) => parts.join('\n');

// A closed fenced markdown example inside Acceptance Criteria whose own content contains a
// `## `-looking line — must never be mistaken for the section's real end.
const AC_FENCED = '## Acceptance Criteria\n\n- [ ] Lookups are cached.\n\n```markdown\n## Example heading\n```\n';
// Same, but the fence is never closed before the next real heading — an ambiguous input the
// repair must refuse rather than guess at.
const AC_UNTERMINATED_FENCE = '## Acceptance Criteria\n\n- [ ] Lookups are cached.\n\n```markdown\n## Never closed\n';

module.exports = {
  LINE,
  CS, DEL, AC, RN, TA, AC_FENCED, AC_UNTERMINATED_FENCE, join,
  MISSING_RN: join(CS, DEL, AC, TA),
  REPAIRED: join(CS, DEL, AC, RN, TA),
  EMPTY_RN: join(CS, DEL, AC, '## Release Note\n', TA),
  MISSING_RN_AND_AC: join(CS, DEL, TA),
  CONFORMING: join(CS, DEL, AC, RN, TA),
  MISSING_RN_WITH_TBD: join(CS, DEL.replace('lookup.', 'lookup. TBD'), AC, TA),
  AC_LAST_WITH_FOOTER: `${join(CS, DEL, AC)}\n_Filed by \`ledger resolve gate\` via specShapedBody._\n`,
  MIDLINE_AC: '## Current State\n\nThe widget lookup is slow.\n\n## Deliverables\n\n1. Cache it. See ## Acceptance Criteria\n- [ ] Lookups are cached.\n',
  MISSING_RN_WITH_FENCE: join(CS, DEL, AC_FENCED, TA),
  UNTERMINATED_FENCE_BODY: join(CS, DEL, AC_UNTERMINATED_FENCE, TA),
};
