// bin/lib/console/finding-filing.js — plan the fileable backlog record for a
// can't-tell finding the Review Console resolved `filed` (#3949).
//
// At `autonomy: unattended` a can't-tell item routes by its recommendation (#4679): `file` files a
// verification task (`unattended: true` on composeFindingProposal / planFilings: a `Title:`/`Type:`/
// `Defer-reason: needs-verification` header with no `Labels:` line, and Acceptance Criteria requiring
// quoted evidence at the integration-branch tip), and `drop` digests (composeFindingDigest /
// planDigests: a materiality entry line carrying a `console-finding` marker, so a re-appearance
// dedupes by fingerprint). Without `unattended` (the human-present console) a can't-tell item files
// the `needs:definition` / Open Question record it always did. This module only PLANS the filings and
// digest lines (the header + spec-shaped body is the shape console/shadow-dup-proposal.js composes);
// writing them and deduplicating against existing records by fingerprint belongs to the consumer.
// The fingerprint excludes the line number so the same finding re-appearing at a shifted line in a
// later run dedupes to one record or line.
'use strict';

const { fingerprintFromBasis, normalizeText } = require('../health-core/fingerprint');
const { materialityEntryLine, CONSOLE_FINDING_PREFIX } = require('../health-core/materiality-digest');
const { isTrustedComment } = require('../issues/comment-trust');
const { CONSOLE_FINDING_FP } = require('./residue');
const {
  specShapedBody, recordPayload, fencedBlock, defuse, LABELS, extractFingerprints, checkFingerprint, recordFingerprint,
} = require('../issues/record');

const DEFER_REASON = 'needs-human-decision';
// The unattended can't-tell `file` shape: the filed task is the bounded check that settles the finding.
const CANT_TELL_DEFER_REASON = 'needs-verification';
// The digest line's Defer-reason for a can't-tell `drop`: an entry-format value, not a DEFER_REASONS member.
const DIGEST_DEFER_REASON = 'tiebreak-cant-tell';
const DIGEST_FINDING_MAX = 200;
const TITLE_CLAIM_MAX = 80;
const TITLE_MAX = 256;

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

// Cut to at most `max` characters on a word boundary; a cut that ends in `…` never exceeds `max`.
// Applied after oneLine, because defuse lengthens text and the cap must hold on the emitted string.
function capWords(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  // Index max-1 is the first dropped character: when it is a space the slice already ends on a whole word.
  const space = cut.lastIndexOf(' ');
  if (text[max - 1] !== ' ' && space > 0) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

// A line the producer does not have is absent, not printed: the citation drops its `:line`.
function lineRef(line) {
  if (line === null || line === undefined || line === '' || String(line).toLowerCase() === 'unknown') return null;
  return String(line);
}

// `path:line`, or `path` alone when the line is absent.
function citation(path, line) {
  const ref = lineRef(line);
  return ref === null ? oneLine(path) : `${oneLine(path)}:${oneLine(ref)}`;
}

// A path under plugin/skills/{s}/ -> s; plugin/bin/lib/{m}/ -> m; any other plugin/bin/ file -> bin;
// else the path's first segment (tests, docs). (Moved from backfill-dispose.js in #4679.)
function areaOfPath(p) {
  const segs = String(p).replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(Boolean);
  let area = segs[0] || 'console';
  if (segs[0] === 'plugin' && segs[1] === 'skills') area = segs.length > 3 ? segs[2] : 'skills';
  else if (segs[0] === 'plugin' && segs[1] === 'bin') area = segs[2] === 'lib' && segs.length > 4 ? segs[3] : 'bin';
  // The area lands in a digest line the dedup readers scan for markers: the path's first segment is
  // producer-supplied text (a decisions.md verdict line), so it is defused and one line like every other field.
  return oneLine(area.toLowerCase());
}

// The Deliverables text and the Acceptance Criteria / Open Question field for one proposal shape.
function taskSections({ verification, confirmed, where }) {
  if (verification) {
    return {
      deliverables: `- [ ] at the integration-branch tip, quote the code at \`${where}\` and state whether the finding holds; fix it if it does, or close this record with that quoted evidence if it does not`,
      field: { acceptanceCriteria: `- [ ] the record quotes the code at \`${where}\` as it reads at the integration-branch tip\n- [ ] the finding is fixed there, or this record is closed with that quoted evidence showing it does not hold` },
    };
  }
  if (confirmed) {
    return {
      deliverables: '- [ ] fix the finding at the cited location',
      field: { acceptanceCriteria: `- [ ] the finding no longer holds at \`${where}\`, or this record is closed with evidence that it never did` },
    };
  }
  return {
    deliverables: '- [ ] decide whether the finding holds at the cited location; fix it if it does, or close this record if it does not',
    field: { openQuestion: `Does this finding hold at \`${where}\`?` },
  };
}

// { item, finding, runId, verdict?, staged?, unattended? } -> { fingerprint, title, proposal, claimMissing }
// `item` is a console item carrying `tiebreak`; `finding` is the review-findings.json entry whose
// `id` equals item.tiebreak.id, or null. With no entry the claim is `tiebreak:{id}` and
// `claimMissing` is true — except when a non-empty `staged.title` supplies the claim text, where
// `claimMissing` is false and the staged title is the fenced claim. Otherwise the record says the
// claim text was lost rather than read as a finding, and the caller reports the degrade
// (bin/console-filings.js). The id hashes the line, so such a record can twin a later run's filing of
// the same finding — accepted: the artifact is written before any tiebreak dispatch
// (review/step3-tiebreak.md), so only a hand-removed artifact gets here.
// `verdict` (#3950, the backlog backfill) is `{ kind: 'confirmed', evidence: { path, line, quote },
// mainSha }`: the tiebreak settled the finding as real, so the record says so instead of "can't-tell"
// — same fingerprint, so a confirmed filing and a can't-tell one of one finding dedup to one record.
// Without it the output is the pre-#3950 can't-tell record, byte for byte.
// `staged` (#4136, the backlog backfill) is `{ title, body, severity }` for a finding a pass already
// wrote up: a non-empty title replaces the prefixed title, the body is fenced under the claim, and the
// severity is staged.severity alone (no tiebreak severity). Without it the record is unchanged.
// `unattended: true` (#4679) turns a can't-tell item (neither `verdict` nor `staged`) into a
// verification task: `Defer-reason: needs-verification`, no `Labels:` header line and no Open
// Question, and Acceptance Criteria requiring the code quoted at the integration-branch tip. It is
// opt-in: absent or false, the can't-tell, confirmed and staged shapes are byte-identical to before.
// A line the tiebreak lacks ('unknown' or null) is omitted from every citation, never printed.
// Titles are cut on a word boundary (capWords); the fingerprint is always from the raw claim.
function composeFindingProposal({
  item, finding, runId, verdict, staged, unattended,
}) {
  const t = item.tiebreak;
  if (verdict !== undefined && !(verdict && verdict.kind === 'confirmed' && verdict.evidence)) {
    throw new TypeError("composeFindingProposal: verdict must be { kind: 'confirmed', evidence, mainSha }");
  }
  const confirmed = verdict !== undefined;
  const verification = unattended === true && !confirmed && !staged;
  const deferReason = verification ? CANT_TELL_DEFER_REASON : DEFER_REASON;
  const hasStagedTitle = Boolean(staged && squash(staged.title || ''));
  const hasStagedBody = Boolean(staged && squash(staged.body || ''));
  // A staged title supplies the claim text when the findings entry is absent, so the record is not reported as missing it.
  const findingClaimMissing = !(finding && typeof finding.claim === 'string' && finding.claim.trim());
  const claimMissing = findingClaimMissing && !hasStagedTitle;
  const claim = findingClaimMissing ? `tiebreak:${t.id}` : finding.claim;
  const fingerprint = findingFingerprint({ lens: t.lens, path: t.path, claim });
  const title = hasStagedTitle
    ? capWords(oneLine(staged.title), TITLE_MAX)
    : `Review finding (${confirmed ? 'confirmed' : "can't-tell"}): ${oneLine(t.path)} — ${capWords(oneLine(claim), TITLE_CLAIM_MAX)}`;
  const where = citation(t.path, t.line);
  const severity = oneLine((staged ? staged.severity : t.severity) ?? '');
  const severityNote = severity ? ` (severity ${severity})` : '';
  const claimLines = claimMissing
    ? [`Review lens \`${oneLine(t.lens)}\` reported a finding at \`${where}\`${severityNote}. Its claim text is unavailable: the run's review-findings.json has no entry for \`${defuse(`tiebreak:${t.id}`)}\`, so only the verdict line in the run's decisions.md names it.`]
    : [`Review lens \`${oneLine(t.lens)}\` reported a finding at \`${where}\`${severityNote}. The claim follows.`, fencedBlock(defuse(hasStagedTitle ? staged.title : claim))];
  const sections = taskSections({ verification, confirmed, where });
  const body = recordPayload({
    title,
    type: 'task',
    deferReason,
    fingerprint,
    body: specShapedBody({
      provenance: { origin: `wrap-up Review Console, run ${oneLine(runId)}: ${confirmed ? 'confirmed' : "can't-tell"} finding ${where}`, deferReason },
      currentState: [
        ...claimLines,
        ...(hasStagedBody ? ['The staged finding follows.', fencedBlock(defuse(staged.body))] : []),
        confirmed
          ? `The tiebreak confirmed it on ${oneLine(verdict.mainSha)}: ${citation(verdict.evidence.path, verdict.evidence.line)} \`${oneLine(verdict.evidence.quote)}\`.`
          : `The tiebreak could not settle it: can't-tell (${oneLine(t.reason)}). Recommendation: ${oneLine(t.recommendation || 'none')}. Run: ${oneLine(runId)}.`,
      ],
      deliverables: sections.deliverables,
      ...sections.field,
      releaseNote: 'No user-visible change.',
      filedBy: 'review-console',
      footer: '_Filed by `review-console` via specShapedBody._',
    }),
  }).body;
  return {
    fingerprint,
    title,
    proposal: `Title: ${title}\nType: task\n${verification ? '' : `Labels: ${LABELS.NEEDS_DEFINITION}\n`}Defer-reason: ${deferReason}\n\n${body}`,
    claimMissing,
  };
}

// { items, findings, runId, unattended? } -> [{ item, fingerprint, title, proposal, claimMissing }]: one per item resolved
// `filed` that carries `tiebreak`, deduplicated by fingerprint within the batch (first wins).
function planFilings({
  items, findings, runId, unattended,
}) {
  const byId = new Map((Array.isArray(findings) ? findings : []).map((f) => [f && f.id, f]));
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (item.resolution !== 'filed' || !item.tiebreak) continue;
    const composed = composeFindingProposal({
      item, finding: byId.get(item.tiebreak.id) || null, runId, unattended,
    });
    if (seen.has(composed.fingerprint)) continue;
    seen.add(composed.fingerprint);
    out.push({ item: item.id, ...composed });
  }
  return out;
}

// The dedup marker a console-finding digest line carries beside its materiality marker (#4679).
function consoleFindingMarker(fp) {
  return `<!-- ${CONSOLE_FINDING_PREFIX}: ${fp} -->`;
}

// { item, finding, runId } -> { fingerprint, line, entry, claimMissing }: the digest line for a can't-tell
// item the console resolved `digested` (a `drop` recommendation). The fingerprint is composeFindingProposal's,
// so a finding digested in one run and filed in another is one finding; a missing claim degrades to
// `tiebreak:{id}` exactly as the proposal does. Every producer-supplied field is defused and one line.
function composeFindingDigest({ item, finding, runId }) {
  const t = item.tiebreak;
  const claimMissing = !(finding && typeof finding.claim === 'string' && finding.claim.trim());
  const claim = claimMissing ? `tiebreak:${t.id}` : finding.claim;
  const fingerprint = findingFingerprint({ lens: t.lens, path: t.path, claim });
  const entry = {
    area: areaOfPath(t.path),
    finding: oneLine(claim).slice(0, DIGEST_FINDING_MAX),
    fileRefs: citation(t.path, t.line),
    deferReason: DIGEST_DEFER_REASON,
    provenance: oneLine(runId),
  };
  return {
    fingerprint, line: `${materialityEntryLine(entry)} ${consoleFindingMarker(fingerprint)}`, entry, claimMissing,
  };
}

// { items, findings, runId } -> [{ item, fingerprint, line, claimMissing }]: one per item resolved `digested`
// that carries `tiebreak`, deduplicated by fingerprint within the batch (first wins), like planFilings.
function planDigests({ items, findings, runId }) {
  const byId = new Map((Array.isArray(findings) ? findings : []).map((f) => [f && f.id, f]));
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (item.resolution !== 'digested' || !item.tiebreak) continue;
    const { fingerprint, line, claimMissing } = composeFindingDigest({ item, finding: byId.get(item.tiebreak.id) || null, runId });
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({
      item: item.id, fingerprint, line, claimMissing,
    });
  }
  return out;
}

// The unattended can't-tell rule (#4679), stated once for every consumer (resolveAll, console-filings.js's
// default selection, the backfill's disposeFinding): a tiebreak recommending `drop` digests, any other
// recommendation (`file`, or none) files a verification task.
function isDropRecommended(tiebreak) {
  return Boolean(tiebreak) && tiebreak.recommendation === 'drop';
}

// planDigests for items resolved `digested`, minus any finding a filing in the same batch already covers (the
// record wins, as an existing record wins over a digest line). `shadowed` names the digested items that
// rode on a filing, so a caller that stores resolutions can rewrite them to `filed`.
function planDigestsBesideFilings({ items, findings, runId, filings }) {
  const filed = new Set(filings.map((p) => p.fingerprint));
  const planned = planDigests({ items, findings, runId });
  return {
    digests: planned.filter((d) => !filed.has(d.fingerprint)),
    shadowed: new Set(planned.filter((d) => filed.has(d.fingerprint)).map((d) => d.item)),
  };
}

// The `consolefinding-*` fingerprints a digest already holds: the markers in a trusted comment (an array of
// comment objects, either association spelling), or in the whole string when it is a local-files body.
// Anything else holds none.
function heldConsoleFindings(digestComments) {
  const marker = new RegExp(`<!-- ${CONSOLE_FINDING_PREFIX}: (${CONSOLE_FINDING_FP}) -->`, 'g');
  let texts = [];
  if (typeof digestComments === 'string') texts = [digestComments];
  else if (Array.isArray(digestComments)) texts = digestComments.filter((c) => isTrustedComment(c) && typeof c.body === 'string').map((c) => c.body);
  const held = new Set();
  for (const text of texts) for (const m of text.matchAll(marker)) held.add(m[1]);
  return held;
}

// The fingerprint -> record number map from `gh issue list` rows. First record wins on a repeated
// fingerprint; a row with no marker, no body, or no positive-integer number contributes nothing.
// (Moved from bin/console-filings.js in #3950: the backlog backfill's batch planner dedups the same way.)
function fingerprintMap(rows) {
  const map = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (!Number.isInteger(row.number) || row.number <= 0) continue;
    for (const fp of extractFingerprints(row.body)) if (checkFingerprint(map, fp) === null) recordFingerprint(map, fp, row.number);
  }
  return map;
}

module.exports = {
  findingFingerprint, composeFindingProposal, planFilings, fingerprintMap, capWords, oneLine,
  CANT_TELL_DEFER_REASON, DIGEST_DEFER_REASON, DIGEST_FINDING_MAX, areaOfPath, consoleFindingMarker, composeFindingDigest, planDigests, heldConsoleFindings,
  isDropRecommended, planDigestsBesideFilings,
};
