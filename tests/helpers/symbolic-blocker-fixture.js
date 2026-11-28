'use strict';
// A spec-shaped record body whose only blocker is a symbolic `Blocked by: {part} (left for
// owner/name)` line (#6374). Every surface test for that form builds its body from here so the
// line, its name and the body's shape are spelled once.

const SYMBOLIC_LINE = 'Blocked by: Skill steps (left for thn-inc/other)';
const SYMBOLIC_REF = 'Skill steps (left for thn-inc/other)';

// extraLines land directly after SYMBOLIC_LINE.
function symbolicBody(extraLines = []) {
  return [
    'Surface: infra',
    'Risk-flags: none',
    'Acceptance-target: local',
    SYMBOLIC_LINE,
    ...extraLines,
    '',
    '## Current State',
    '',
    '- The docs step is filed in this repository; the skill step waits on another one.',
    '',
    '## Deliverables',
    '',
    '1. Update the docs step.',
    '',
    '## Acceptance Criteria',
    '',
    '1. The docs step reads the new wording.',
    '',
    '## Release Note',
    '',
    'The docs step reads the new wording.',
    '',
  ].join('\n');
}

module.exports = { SYMBOLIC_LINE, SYMBOLIC_REF, symbolicBody };
