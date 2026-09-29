'use strict';

const CS = '## Current State\n\nThe widget lookup is slow.\n';
const DEL = '## Deliverables\n\n1. Cache the widget lookup.\n';
const AC = '## Acceptance Criteria\n\n- [ ] Lookups are cached.\n';
const RN = '## Release Note\n\nMade widget lookups faster.\n';
const TA = '## Technical Approach\n\nUse a Map.\n';
const LINE = 'Made widget lookups faster.';
const join = (...parts) => parts.join('\n');

module.exports = {
  LINE,
  CS, DEL, AC, RN, TA, join,
  MISSING_RN: join(CS, DEL, AC, TA),
  REPAIRED: join(CS, DEL, AC, RN, TA),
  EMPTY_RN: join(CS, DEL, AC, '## Release Note\n', TA),
  MISSING_RN_AND_AC: join(CS, DEL, TA),
  CONFORMING: join(CS, DEL, AC, RN, TA),
  MISSING_RN_WITH_TBD: join(CS, DEL.replace('lookup.', 'lookup. TBD'), AC, TA),
  AC_LAST_WITH_FOOTER: `${join(CS, DEL, AC)}\n_Filed by \`ledger resolve gate\` via specShapedBody._\n`,
  MIDLINE_AC: '## Current State\n\nThe widget lookup is slow.\n\n## Deliverables\n\n1. Cache it. See ## Acceptance Criteria\n- [ ] Lookups are cached.\n',
};
