// bin/lib/issues/risk-flag-facts.js
// Pure: a record body and its plan -> the entries the acceptance packet gather's `--flags`
// and `--proofs` inputs take (#4618). The flag line is read through parseRiskFlags, the one
// reader, and a proof through plan-audit's readPlanProofs and isSubstantiveProof, the ones
// Check G reads, so the packet cannot disagree with the gate about what was kept, what
// counts as a proof, or when a plan could not be read. No I/O; `bin/risk-flags.js facts` is
// the caller.
//
// A flag entry is `{ id, unconfirmed?, text? }`: `id` the bare slug (the gather adds the
// `flag:` prefix and encodes the key), `unconfirmed: true` only when the marker reads true,
// `text` only when the line reads unknown, saying why (by `reason`). A proof entry is
// `{ id, text }`: the first substantive `Proof(<slug>)` line for a kept slug, its text
// through inertEvidence. `unclassified` and a clean `none` give no entries at all.
//
// `planParse` ('ok' | 'could-not-parse') is present only when a plan was given and the record
// has flags to prove (Check G skips the rest): 'could-not-parse' means the plan had no tasks,
// a near-miss proof line or an unclosed fence, so an empty `proofs` there is "not read", not
// "no proof written".
'use strict';

const { parseRiskFlags } = require('./record-risk-flags');
const { inertEvidence } = require('./risk-flag-classify');
const { readPlanProofs, isSubstantiveProof } = require('../plan-audit/checks');

// By the parse reason: `malformed` is a line that does not read at all, `unknown-slug` one
// that reads but names a category nobody declared.
const UNREADABLE_FLAG_TEXT = Object.freeze({
  malformed: 'unreadable flag line',
  'unknown-slug': 'flag line names an unknown category',
});

// A reason this table does not know (a future parse reason) reads as the plain malformed
// wording, never as a missing `text`, which JSON would drop without a trace.
const unreadableText = (reason) => (Object.hasOwn(UNREADABLE_FLAG_TEXT, reason) ? UNREADABLE_FLAG_TEXT[reason] : UNREADABLE_FLAG_TEXT.malformed);

// specText, planText | null, { extraCategories } -> { status, flags, proofs, planParse? }.
function riskFlagEntries(specText, planText, { extraCategories = [] } = {}) {
  const parsed = parseRiskFlags(specText, { extraCategories });
  if (parsed.flags.length === 0) return { status: parsed.status, flags: [], proofs: [] };

  const flags = parsed.flags.map((slug) => ({
    id: slug,
    ...(parsed.unconfirmed ? { unconfirmed: true } : {}),
    ...(parsed.status === 'unknown' ? { text: unreadableText(parsed.reason) } : {}),
  }));
  if (planText === null || planText === undefined) return { status: parsed.status, flags, proofs: [] };

  const { proofs: planned, problems } = readPlanProofs(String(planText).replace(/\r\n?/g, '\n'));
  const proofs = [];
  for (const slug of parsed.flags) {
    const found = planned.find((proof) => proof.slug === slug && isSubstantiveProof(slug, proof.text) === null);
    if (found) proofs.push({ id: slug, text: inertEvidence(found.text) });
  }
  return { status: parsed.status, flags, proofs, planParse: problems.length === 0 ? 'ok' : 'could-not-parse' };
}

module.exports = { riskFlagEntries, UNREADABLE_FLAG_TEXT, unreadableText };
