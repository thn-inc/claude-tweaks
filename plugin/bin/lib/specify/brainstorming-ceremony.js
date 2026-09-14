'use strict';
// bin/lib/specify/brainstorming-ceremony.js — pure composition logic behind
// bin/compose-brainstorm-args.js. Prepends a fixed consolidation-instruction
// sentence to /specify's `/superpowers:brainstorming` Skill-tool `args` text
// when the `design-ceremony` policy key (skills/_shared/policy-schema.md)
// resolves `fast-lane`; any other value (including `standard`, unset, or
// unrecognized) returns the input unchanged, byte-for-byte — record #1886's
// Acceptance Criterion 3. Full call-site procedure lives in
// skills/specify/brainstorming-ceremony.md; this module owns only the
// string composition, not the policy resolution.

const CONSOLIDATION_SENTENCE = 'Ceremony: fast-lane for this session — once the decision-carrying clarifying questions are answered and the approach is chosen, present the remaining design sections as one consolidated block rather than gating each section individually; the single approval point is the post-write spec review.';

// composeBrainstormingArgs(input, designCeremony) -> string
// `input` is exactly what would otherwise be passed as the
// `/superpowers:brainstorming` Skill tool call's `args` (a record's
// title+body, or a bare topic string). `designCeremony` is the resolved
// `design-ceremony` policy value. Only the literal string 'fast-lane'
// triggers the prefix — everything else (including 'standard', undefined,
// or a typo) passes `input` through unchanged.
function composeBrainstormingArgs(input, designCeremony) {
  if (designCeremony !== 'fast-lane') return input;
  return `${CONSOLIDATION_SENTENCE}\n\n${input}`;
}

module.exports = { composeBrainstormingArgs, CONSOLIDATION_SENTENCE };
