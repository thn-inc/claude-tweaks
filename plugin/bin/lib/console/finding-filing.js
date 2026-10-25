// bin/lib/console/finding-filing.js — plan the fileable backlog record for a
// can't-tell finding the Review Console resolved `filed` (#3949).
//
// At `autonomy: unattended` an agent that could not tell whether a finding holds
// is not licensed to drop it, so every can't-tell item is filed as a
// needs:definition record instead. This module only PLANS the filings
// (a `Title:`/`Type:`/`Labels:`/`Defer-reason:` header + spec-shaped body, the
// shape console/shadow-dup-proposal.js composes); writing them and deduplicating
// against existing records by fingerprint belongs to the consumer. The
// fingerprint excludes the line number so the same finding re-appearing at a
// shifted line in a later run dedupes to one record.
'use strict';

const { fingerprintFromBasis, normalizeText } = require('../health-core/fingerprint');
const {
  specShapedBody, recordPayload, fencedBlock, defuse, LABELS, extractFingerprint, checkFingerprint, recordFingerprint,
} = require('../issues/record');

const DEFER_REASON = 'needs-human-decision';
const TITLE_CLAIM_MAX = 80;

// { lens, path, claim } -> `consolefinding-{8 hex}`. No line number: it moves between runs.
function findingFingerprint({ lens, path, claim }) {
  return fingerprintFromBasis('consolefinding', [String(lens).trim().toLowerCase(), String(path).trim(), normalizeText(claim)]);
}

// The claim, lens and path are producer-supplied text. The header is single-line by construction
// (whitespace collapsed before the cut), and the claim reaches the body only through fencedBlock.
// A fence does not stop extractFingerprint, so every producer-supplied value is defused
// (record.js's `defuse`) before it is interpolated; the fingerprint itself is computed from the raw
// values, so the key stays stable.
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const oneLine = (s) => defuse(squash(s));

// { item, finding, runId, verdict? } -> { fingerprint, title, proposal, claimMissing }
// `item` is a console item carrying `tiebreak`; `finding` is the review-findings.json entry whose
// `id` equals item.tiebreak.id, or null. With no entry the claim is `tiebreak:{id}` and
// `claimMissing` is true: the record says the claim text was lost rather than read as a finding,
// and the caller reports the degrade (bin/console-filings.js). The id hashes the line, so such a
// record can twin a later run's filing of the same finding — accepted: the artifact is written
// before any tiebreak dispatch (review/step3-tiebreak.md), so only a hand-removed artifact gets here.
// `verdict` (#3950, the backlog backfill) is `{ kind: 'confirmed', evidence: { path, line, quote },
// mainSha }`: the tiebreak settled the finding as real, so the record says so instead of "can't-tell"
// — same fingerprint, so a confirmed filing and a can't-tell one of one finding dedup to one record.
// Without it the output is the pre-#3950 can't-tell record, byte for byte.
function composeFindingProposal({
  item, finding, runId, verdict,
}) {
  const t = item.tiebreak;
  if (verdict !== undefined && !(verdict && verdict.kind === 'confirmed' && verdict.evidence)) {
    throw new TypeError("composeFindingProposal: verdict must be { kind: 'confirmed', evidence, mainSha }");
  }
  const confirmed = verdict !== undefined;
  const claimMissing = !(finding && typeof finding.claim === 'string' && finding.claim.trim());
  const claim = claimMissing ? `tiebreak:${t.id}` : finding.claim;
  const fingerprint = findingFingerprint({ lens: t.lens, path: t.path, claim });
  const title = `Review finding (${confirmed ? 'confirmed' : "can't-tell"}): ${oneLine(t.path)} — ${defuse(squash(claim).slice(0, TITLE_CLAIM_MAX))}`;
  const where = `${oneLine(t.path)}:${oneLine(t.line)}`;
  const claimLines = claimMissing
    ? [`Review lens \`${oneLine(t.lens)}\` reported a finding at \`${where}\` (severity ${oneLine(t.severity)}). Its claim text is unavailable: the run's review-findings.json has no entry for \`${defuse(`tiebreak:${t.id}`)}\`, so only the verdict line in the run's decisions.md names it.`]
    : [`Review lens \`${oneLine(t.lens)}\` reported a finding at \`${where}\` (severity ${oneLine(t.severity)}). The claim follows.`, fencedBlock(defuse(claim))];
  const body = recordPayload({
    title,
    type: 'task',
    deferReason: DEFER_REASON,
    fingerprint,
    body: specShapedBody({
      provenance: { origin: `wrap-up Review Console, run ${oneLine(runId)}: ${confirmed ? 'confirmed' : "can't-tell"} finding ${where}`, deferReason: DEFER_REASON },
      currentState: [
        ...claimLines,
        confirmed
          ? `The tiebreak confirmed it on ${oneLine(verdict.mainSha)}: ${oneLine(verdict.evidence.path)}:${oneLine(verdict.evidence.line ?? 'unknown')} \`${oneLine(verdict.evidence.quote)}\`.`
          : `The tiebreak could not settle it: can't-tell (${oneLine(t.reason)}). Recommendation: ${oneLine(t.recommendation || 'none')}. Run: ${oneLine(runId)}.`,
      ],
      deliverables: confirmed
        ? '- [ ] fix the finding at the cited location'
        : '- [ ] decide whether the finding holds at the cited location; fix it if it does, or close this record if it does not',
      ...(confirmed
        ? { acceptanceCriteria: `- [ ] the finding no longer holds at \`${where}\`, or this record is closed with evidence that it never did` }
        : { openQuestion: `Does this finding hold at \`${where}\`?` }),
      releaseNote: 'No user-visible change.',
      filedBy: 'review-console',
      footer: '_Filed by `review-console` via specShapedBody._',
    }),
  }).body;
  return {
    fingerprint,
    title,
    proposal: `Title: ${title}\nType: task\nLabels: ${LABELS.NEEDS_DEFINITION}\nDefer-reason: ${DEFER_REASON}\n\n${body}`,
    claimMissing,
  };
}

// { items, findings, runId } -> [{ item, fingerprint, title, proposal, claimMissing }]: one per item resolved
// `filed` that carries `tiebreak`, deduplicated by fingerprint within the batch (first wins).
function planFilings({ items, findings, runId }) {
  const byId = new Map((Array.isArray(findings) ? findings : []).map((f) => [f && f.id, f]));
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (item.resolution !== 'filed' || !item.tiebreak) continue;
    const composed = composeFindingProposal({ item, finding: byId.get(item.tiebreak.id) || null, runId });
    if (seen.has(composed.fingerprint)) continue;
    seen.add(composed.fingerprint);
    out.push({ item: item.id, ...composed });
  }
  return out;
}

// The fingerprint -> record number map from `gh issue list` rows. First record wins on a repeated
// fingerprint; a row with no marker, no body, or no positive-integer number contributes nothing.
// (Moved from bin/console-filings.js in #3950: the backlog backfill's batch planner dedups the same way.)
function fingerprintMap(rows) {
  const map = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const fp = extractFingerprint(row.body);
    if (fp && Number.isInteger(row.number) && row.number > 0 && checkFingerprint(map, fp) === null) recordFingerprint(map, fp, row.number);
  }
  return map;
}

module.exports = {
  findingFingerprint, composeFindingProposal, planFilings, fingerprintMap,
};
