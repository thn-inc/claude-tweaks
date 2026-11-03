// bin/lib/issues/risk-flag-facts.js
// Pure: a record body and its plan -> the entries the acceptance packet gather's `--flags`
// and `--proofs` inputs take (#4618). The flag line is read through parseRiskFlags, the one
// reader, and a proof through plan-audit's extractProofLines and isSubstantiveProof, the
// ones Check G reads, so the packet cannot disagree with the gate about what was kept or
// what counts as a proof. No I/O; `bin/risk-flags.js facts` is the caller.
//
// A flag entry is `{ id, unconfirmed?, text? }`: `id` the bare slug (the gather adds the
// `flag:` prefix and encodes the key), `unconfirmed: true` only when the marker reads true,
// `text` only when the line reads unknown, saying so. A proof entry is `{ id, text }`: the
// first substantive `Proof(<slug>)` line for a kept slug, its text through inertEvidence.
// `unclassified` and a clean `none` give no entries at all.
'use strict';

const { parseRiskFlags } = require('./record-risk-flags');
const { inertEvidence } = require('./risk-flag-classify');
const { extractProofLines } = require('../plan-audit/parser');
const { isSubstantiveProof } = require('../plan-audit/checks');

const UNREADABLE_FLAG_TEXT = 'unreadable flag line';

// specText, planText | null, { extraCategories } -> { status, flags, proofs }.
function riskFlagEntries(specText, planText, { extraCategories = [] } = {}) {
  const parsed = parseRiskFlags(specText, { extraCategories });
  if (parsed.flags.length === 0) return { status: parsed.status, flags: [], proofs: [] };

  const flags = parsed.flags.map((slug) => ({
    id: slug,
    ...(parsed.unconfirmed ? { unconfirmed: true } : {}),
    ...(parsed.status === 'unknown' ? { text: UNREADABLE_FLAG_TEXT } : {}),
  }));

  const planned = planText === null || planText === undefined ? [] : extractProofLines(planText).proofs;
  const proofs = [];
  for (const slug of parsed.flags) {
    const found = planned.find((proof) => proof.slug === slug && isSubstantiveProof(slug, proof.text) === null);
    if (found) proofs.push({ id: slug, text: inertEvidence(found.text) });
  }
  return { status: parsed.status, flags, proofs };
}

module.exports = { riskFlagEntries, UNREADABLE_FLAG_TEXT };
