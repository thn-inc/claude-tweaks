// plugin/bin/lib/console/backfill-dispose.js — the Review Console backlog
// backfill's disposition table as code (#3950). Each work item (backfill.js)
// resolves to exactly one of: filed (a backlog record proposal), dropped (the
// tiebreak refuted it), digested (a materiality-digest line), or dismissed (a
// byte-identical staged duplicate) — no item is left pending, and a no-claim
// item is digested, never dropped. planBatch dedups the filings against the
// existing records' fingerprints and the digest lines against the digest's
// trusted comments, and emits the settled-entry list the apply step
// (backfill-apply.js) consumes. Pure apart from the default `readStaged`: no
// gh call, no write — the procedure files and posts, then fills each entry's
// `ref` (`null` here means "the procedure fills it").
'use strict';

const fs = require('fs');
const path = require('path');
const { SHADOW_DUP_RE, SECTIONS, runIdOf } = require('./resolve');
const { composeFindingProposal, findingFingerprint, fingerprintMap } = require('./finding-filing');
const { composeShadowDupProposal } = require('./shadow-dup-proposal');
const { digestTextOf, targetOf } = require('./staged-digest-text');
const { BACKFILL_OUTCOMES, BACKFILL_SOURCES } = require('./backfill-apply');
const { materialityEntryLine, materialityFingerprint, parseMaterialityFingerprints } = require('../health-core/materiality-digest');
const { fingerprintFromBasis } = require('../health-core/fingerprint');
const {
  extractFingerprint, checkFingerprint, defuse, FP_RE_WORK, FP_RE_WORK_PLAIN,
} = require('../issues/record');
const { isTrustedComment } = require('../issues/comment-trust');

const DIGEST_REASONS = Object.freeze({
  NO_CLAIM: 'console-backfill-no-claim',
  UNMAPPED_KIND: 'console-backfill-unmapped-kind',
  CONFIRMED_LOW: 'console-backfill-confirmed-low',
  CANT_TELL: 'tiebreak-cant-tell',
});

const OUTCOME_OF_ACTION = Object.freeze({ file: 'filed', digest: 'digested', drop: 'dropped', dismiss: 'dismissed' });
for (const outcome of Object.values(OUTCOME_OF_ACTION)) {
  if (!BACKFILL_OUTCOMES.includes(outcome)) throw new Error(`backfill-dispose: outcome ${outcome} is not one backfill-apply accepts`);
}
for (const source of ['tiebreak', 'staged-kind', 'digest']) {
  if (!BACKFILL_SOURCES.includes(source)) throw new Error(`backfill-dispose: source ${source} is not one backfill-apply accepts`);
}

const FINDING_FILED_SEVERITIES = new Set(['critical', 'high', 'medium']);
const KNOWN_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const DIGEST_FINDING_MAX = 200;
const DEFAULT_LIMIT = 24;

const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

// A digest entry field is one line and can never spell a marker (record.js's defuse): the entry's
// own fingerprint marker must be the only one on its line.
const oneLine = (s) => defuse(squash(s));

// A path under plugin/skills/{s}/ -> s; plugin/bin/lib/{m}/ -> m; any other plugin/bin/ file -> bin;
// else the path's first segment (tests, docs).
function areaOfPath(p) {
  const segs = String(p).replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(Boolean);
  let area = segs[0] || 'console';
  if (segs[0] === 'plugin' && segs[1] === 'skills') area = segs.length > 3 ? segs[2] : 'skills';
  else if (segs[0] === 'plugin' && segs[1] === 'bin') area = segs[2] === 'lib' && segs.length > 4 ? segs[3] : 'bin';
  return area.toLowerCase();
}

// An item that names a location (a finding, or a no-claim item standing for a located finding) takes
// its area from that path. No path to read an area from: a reflect staged finding is `reflect`,
// everything else `console`.
function areaFor(item) {
  if (item.finding && item.finding.path) return areaOfPath(item.finding.path);
  const name = item.staged && item.staged.name;
  return typeof name === 'string' && name.startsWith('reflect-') ? 'reflect' : 'console';
}

// A decision line (`- STAGED HH:MM:SS — {step label}: {text}`) without its log prefix, and without up to
// two short step labels (`log-decision: `, `Step 3 reproduction: `, `Reproduction: `): the prefix costs
// the digest line's 200-character budget and says nothing about the finding. A label is a short run of
// plain words ending `: `, so a sentence that merely contains a colon is never cut. Anything else is returned as is.
// A `decision:` console id (the item's only trace when its source line is gone) is the same line cut to
// 58 characters plus a `#hash`: it loses the hash too. The producer's closing boilerplate ("Staged to
// Review Console as low-confidence. Reversibility: high.") goes as well; it is on every such line.
function withoutLogPrefix(context) {
  const prefix = /^(-\s+|decision:)(?:STAGED|AUTO)\s+\d{2}:\d{2}:\d{2}\s+—\s+/.exec(context);
  if (!prefix) return context;
  let rest = context.slice(prefix[0].length);
  if (prefix[1] === 'decision:') rest = rest.replace(/#[0-9a-f]{8}(?:-\d+)?$/, '');
  for (let n = 0; n < 2; n++) {
    const label = /^([A-Za-z0-9][A-Za-z0-9 _-]*): /.exec(rest);
    if (!label || label[1].length >= 40) break;
    rest = rest.slice(label[0].length);
  }
  return rest.replace(/\s*Staged to Review Console as low-confidence\.?/g, '').replace(/\s*Reversibility: \w+\.?/g, '').trim();
}

// The item's own stable identity: `consolebackfill-{hash}` of its id (the R8 fingerprint). A finding's
// filing and digest line both carry it, so a record or line landed before a crashed apply is still found
// when the claim heuristics changed in between (the claim-keyed fingerprints would then miss).
const itemFingerprint = (item) => fingerprintFromBasis('consolebackfill', [item.itemId]);
const ITEM_MARKER_PREFIX = 'consolebackfill-item';
const itemMarkerOf = (item) => `<!-- ${ITEM_MARKER_PREFIX}: ${itemFingerprint(item)} -->`;

// `marked`: the line also carries the item marker, after the materiality marker, so `{provenance}`
// stays the bare run id digest-sweep.md dates expiry from (the entry's fields, and so its
// fingerprint, are unchanged).
function digestEntryOf({ item, finding, fileRefs, deferReason, runId, marked = false }) {
  const entry = {
    area: oneLine(areaFor(item)),
    finding: oneLine(finding).slice(0, DIGEST_FINDING_MAX),
    fileRefs: oneLine(fileRefs),
    deferReason,
    provenance: oneLine(runId),
  };
  const line = marked ? `${materialityEntryLine(entry)} ${itemMarkerOf(item)}` : materialityEntryLine(entry);
  return { entry, line, fingerprint: materialityFingerprint(entry) };
}

const locationOf = (f) => (f.line === null || f.line === undefined ? f.path : `${f.path}:${f.line}`);

function result(item, action, source, extra) {
  return { itemId: item.itemId, action, outcome: OUTCOME_OF_ACTION[action], source, ...extra };
}

// The can't-tell record shape composeFindingProposal reads, built from a work item. A finding with no
// line has none to cite, so the record names `unknown` rather than printing "null".
function findingProposal(item, verdict, runId, confirmed) {
  const f = item.finding;
  const composed = composeFindingProposal({
    item: {
      tiebreak: {
        id: item.itemId,
        lens: f.lens,
        path: f.path,
        line: f.line === null || f.line === undefined ? 'unknown' : f.line,
        severity: verdict.severity || f.reporterSeverity,
        reason: verdict.reason || 'unspecified',
        recommendation: verdict.recommendation,
      },
    },
    finding: { claim: item.claimText },
    runId,
    ...(confirmed ? { verdict: { kind: 'confirmed', evidence: verdict.evidence, mainSha: confirmed.mainSha } } : {}),
  });
  // The record is filed under its claim fingerprint (the first marker, which extractFingerprint reads);
  // the item's own marker follows it.
  const fp = itemFingerprint(item);
  const text = `${composed.proposal}${composed.proposal.endsWith('\n') ? '' : '\n'}<!-- work-fingerprint: ${fp} -->\nwork-fingerprint: ${fp}\n`;
  return { fingerprint: composed.fingerprint, itemFingerprint: fp, title: composed.title, text };
}

// A finding's digest entry; both digest outcomes (can't-tell, confirmed-low) build it from the same
// area, claim and location, and materialityFingerprint omits deferReason.
const findingDigest = (item, deferReason, runId) => digestEntryOf({
  item, finding: item.claimText, fileRefs: locationOf(item.finding), deferReason, runId, marked: true,
});

function disposeFinding({ item, verdict, runId, mainSha }) {
  const digestFor = (deferReason) => result(item, 'digest', 'tiebreak', { digest: findingDigest(item, deferReason, runId) });
  switch (verdict.outcome) {
    case 'confirmed': {
      const severity = KNOWN_SEVERITIES.has(verdict.severity) ? verdict.severity : 'medium';
      if (!FINDING_FILED_SEVERITIES.has(severity)) return digestFor(DIGEST_REASONS.CONFIRMED_LOW);
      return result(item, 'file', 'tiebreak', { proposal: findingProposal(item, { ...verdict, severity }, runId, { mainSha }) });
    }
    case 'drop': {
      const ev = verdict.evidence;
      if (!ev) throw new TypeError('a drop verdict carries no evidence');
      return result(item, 'drop', 'tiebreak', { ref: squash(`${ev.path}:${ev.line ?? 'unknown'} "${ev.quote}"`) });
    }
    case 'console':
      return result(item, 'file', 'tiebreak', { proposal: findingProposal(item, verdict, runId, null) });
    case 'digest':
      return digestFor(DIGEST_REASONS.CANT_TELL);
    default:
      throw new TypeError(`unknown verdict outcome: ${JSON.stringify(verdict.outcome)}`);
  }
}

// A no-claim item that stands for a located finding names the location(s); otherwise `general`.
function noClaimFileRefs(item) {
  const where = Array.isArray(item.locations) && item.locations.length ? item.locations : [item.finding];
  const refs = [...new Set(where.filter((f) => f && f.path).map(locationOf))];
  return refs.length ? refs.join(', ') : 'general';
}

function disposeNoClaim({ item, runId }) {
  return result(item, 'digest', 'digest', {
    digest: digestEntryOf({
      item,
      finding: `No claim recoverable (${item.noClaimReason}): ${withoutLogPrefix(String(item.context))}`,
      fileRefs: noClaimFileRefs(item),
      deferReason: DIGEST_REASONS.NO_CLAIM,
      runId,
    }),
  });
}

// A filing whose text carries no work-fingerprint marker of its own (a shadow-dup reconcile record, a
// Queue-writes proposal without one) gets one minted from the item's content-derived id and appended
// as record.js's recordPayload writes it, so a record filed before a crashed apply is found by the next
// run's existing-records map instead of being filed a second time. A marker already in the text wins.
function withFingerprint(item, text) {
  const own = extractFingerprint(text);
  if (own) return { fingerprint: own, text };
  const fingerprint = itemFingerprint(item);
  const gap = text.endsWith('\n') ? '\n' : '\n\n';
  return { fingerprint, minted: true, text: `${text}${gap}<!-- work-fingerprint: ${fingerprint} -->\nwork-fingerprint: ${fingerprint}\n` };
}

// A backfill filing never adds or removes an auto:* / bot:* label by itself (they are granted, not
// filed): any in the staged text's `Labels:` header line come out, the other labels stay, and a
// header line left with none is dropped. Only the header (up to the first blank line) is read.
function stripGrantLabels(text) {
  const blank = /\r?\n[ \t]*\r?\n/.exec(text);
  const split = blank ? blank.index : text.length;
  const head = text.slice(0, split).split('\n').map((line) => {
    const m = /^Labels:(.*?)(\r?)$/i.exec(line);
    if (!m) return line;
    const labels = m[1].split(',').map((l) => l.trim()).filter(Boolean);
    const kept = labels.filter((l) => !/^(?:auto|bot):/i.test(l));
    if (kept.length === labels.length) return line;
    return kept.length ? `Labels: ${kept.join(', ')}${m[2]}` : null;
  }).filter((line) => line !== null);
  return head.join('\n') + text.slice(split);
}

function disposeStaged({ item, runId, readStaged }) {
  const s = item.staged;
  const read = (name) => readStaged(item.consoleDir, name);
  const shadow = typeof s.name === 'string' ? SHADOW_DUP_RE.exec(s.name) : null;

  if (s.outcome === 'shadow-dup-duplicate' && shadow) {
    return result(item, 'dismiss', 'staged-kind', { ref: `duplicate of staged/${shadow[1]}` });
  }
  let text = null;
  if (shadow && (s.outcome === 'shadow-dup-divergent' || s.outcome === 'shadow-dup-collision')) {
    text = read(s.name);
    const composed = composeShadowDupProposal({ name: s.name, text, anchorText: read(shadow[1]), runId });
    if (composed.ok) {
      const { fingerprint, minted, text: proposal } = withFingerprint(item, composed.proposal);
      return result(item, 'file', 'staged-kind', { proposal: { fingerprint, minted, title: composed.title, text: proposal } });
    }
  } else if (typeof s.name === 'string' && s.reason !== 'engine-row') {
    text = read(s.name);
    if (s.section === SECTIONS.QUEUE && !s.reason && typeof text === 'string' && text.startsWith('Title:')) {
      const stripped = stripGrantLabels(text);
      const title = squash(/^Title:(.*)$/m.exec(stripped)[1]);
      const { fingerprint, minted, text: proposal } = withFingerprint(item, stripped);
      return result(item, 'file', 'staged-kind', { proposal: { fingerprint, minted, title, text: proposal } });
    }
  }

  // Anything else: digested, with the file's name and why it had no mapping.
  const label = `${s.name === null || s.name === undefined ? 'unnamed engine row' : s.name} (${s.reason || s.section})`;
  const first = typeof text === 'string' ? digestTextOf(text) : '';
  const files = typeof text === 'string' && typeof s.name === 'string' && s.name.startsWith('reflect-') ? /^\*\*Files:\*\*[ \t]*(.+)$/m.exec(text) : null;
  // The files the line names: a reflect file's **Files:** value, else a patch proposal's Target:, else `general`.
  const target = typeof text === 'string' ? targetOf(text) : null;
  const fileRefs = (files && squash(files[1])) || (target && squash(target)) || 'general';
  return result(item, 'digest', 'digest', {
    digest: digestEntryOf({
      item,
      finding: first ? `${label}: ${first}` : label,
      fileRefs,
      deferReason: DIGEST_REASONS.UNMAPPED_KIND,
      runId,
    }),
  });
}

// ENOENT reads as absent (null); any other failure throws — an unreadable file is not an absent one.
// A name that is not a plain file name (`../x`, `a/b`, `..`) reads as absent too: the item then digests
// as unmapped with its name in the line, instead of reading outside the staged directory or blocking the batch.
const defaultReadStaged = (consoleDir, name) => {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || name.includes('\\') || path.basename(name) !== name) return null;
  try { return fs.readFileSync(path.join(consoleDir, 'staged', name), 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
};

// { item, verdict?, runId, mainSha, readStaged? } -> { itemId, action, outcome, source, ref?, proposal?, digest? }.
// `verdict` is resolve-tiebreak's JSON and is required for a `finding` item. `readStaged(consoleDir,
// name)` returns a staged file's text, or null when it is absent.
function disposeItem({ item, verdict, runId, mainSha, readStaged = defaultReadStaged }) {
  if (item.kind === 'finding') {
    if (!verdict) throw new TypeError('verdict required for a finding item');
    return disposeFinding({ item, verdict, runId, mainSha });
  }
  if (item.kind === 'no-claim') return disposeNoClaim({ item, runId });
  if (item.kind === 'staged-kind') return disposeStaged({ item, runId, readStaged });
  throw new TypeError(`unknown work item kind: ${JSON.stringify(item.kind)}`);
}

// A title compared as the filing procedure would see it: trimmed, internal whitespace collapsed, case kept.
const normalizeTitle = (t) => squash(String(t));

// title -> record number from `gh issue list --json number,title,body` rows; the first row with a title wins.
function titleMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.title !== 'string' || !Number.isInteger(row.number) || row.number <= 0) continue;
    const key = normalizeTitle(row.title);
    if (key !== '' && !map.has(key)) map.set(key, row.number);
  }
  return map;
}

const verdictOf = (verdicts, id) => {
  if (!verdicts) return undefined;
  if (verdicts instanceof Map) return verdicts.get(id);
  return Object.hasOwn(verdicts, id) ? verdicts[id] : undefined;
};

// The fingerprint composeFindingProposal files this finding under (same lens, path and claim), or null
// when the item carries no claim to hash.
function prefiledFingerprint(item) {
  const f = item.finding;
  if (!f || typeof item.claimText !== 'string' || !item.claimText.trim()) return null;
  return findingFingerprint({ lens: f.lens, path: f.path, claim: item.claimText });
}

const WORK_MARKER_RES = [new RegExp(FP_RE_WORK.source, 'g'), new RegExp(FP_RE_WORK_PLAIN.source, 'gm')];

// fingerprint -> record number over EVERY work-fingerprint marker in each row's body (fingerprintMap
// reads only the first): a backfill finding filing carries its item marker after its claim marker.
function everyMarkerMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.body !== 'string' || !Number.isInteger(row.number) || row.number <= 0) continue;
    for (const re of WORK_MARKER_RES) {
      for (const m of row.body.matchAll(re)) if (!map.has(m[1])) map.set(m[1], row.number);
    }
  }
  return map;
}

// The record a finding was filed as: by its claim fingerprint, else by its item marker (the claim
// heuristics changed since it was filed). Null when neither has a record.
function filedRecordOf(item, fp, known, markers) {
  const byClaim = fp ? checkFingerprint(known, fp) : null;
  if (byClaim !== null) return byClaim;
  return item.kind === 'finding' && markers.has(itemFingerprint(item)) ? markers.get(itemFingerprint(item)) : null;
}

// A held comment's URL — the `ref` of a digest duplicate — or null when it carries none (a local-files body).
const commentRef = (comment) => (comment && typeof comment.url === 'string' && comment.url ? comment.url : null);

// The trusted digest comment already holding this digest line — by its materiality fingerprint, or, for
// a finding, by its item marker — or null. A string (a local-files body) is single-writer and trusted.
function heldDigestComment(digestComments, digest, item) {
  const marker = item && item.kind === 'finding' ? itemMarkerOf(item) : null;
  const holds = (text) => typeof text === 'string' && (parseMaterialityFingerprints(text).includes(digest.fingerprint) || (marker !== null && text.includes(marker)));
  if (typeof digestComments === 'string') return holds(digestComments) ? { url: null } : null;
  for (const c of Array.isArray(digestComments) ? digestComments : []) {
    if (isTrustedComment(c) && holds(c.body)) return c;
  }
  return null;
}

// One batch of the work list, in order. Walks `workList.runs`; a finding with no verdict yet is listed
// under `awaitingVerdict` and takes no slot — unless its filing fingerprint already has a record, which
// settles it as a `reuse` with no verdict, and so does one whose digest line a trusted digest comment
// already carries (settled `digested`, listed under `digest.duplicates`); stops after `limit` dispositions.
//   existingIssues  `gh issue list --state all --json number,title,body` rows (the fingerprint map's source; the titles dedup a minted-fingerprint staged proposal)
//   digestComments  the open digest issue's comment objects, with their author association
// Returns { dispositions, file, reuse, digest: { lines, duplicates, sameAs }, entries, awaitingVerdict }:
//   file     new records to create (a fingerprint-less proposal is always new)
//   reuse    a filing that already has a record (`number`), or repeats an earlier item of this batch
//            (`number: null`, `sameAs` that item)
//   digest   the lines to post; `duplicates` are items whose line is already posted or repeats one;
//            `sameAs` pairs each repeat with the earlier item of this batch whose line it repeats
//   entries  the settled list for backfill-apply; `ref` is pre-filled for drop/dismiss, for an
//            existing record and for an already-posted digest line (its comment's URL), `null` where
//            the procedure fills it (a new filing, a new digest comment, a same-batch twin's).
function planBatch({ workList, verdicts, existingIssues, digestComments, limit = DEFAULT_LIMIT, readStaged }) {
  const rows = Array.isArray(existingIssues) ? existingIssues : [];
  const known = fingerprintMap(rows);
  const markers = everyMarkerMap(rows);
  const titles = titleMap(rows);
  const out = {
    dispositions: [], file: [], reuse: [], digest: { lines: [], duplicates: [], sameAs: [] }, entries: [], awaitingVerdict: [],
  };
  const batchFiled = new Map();
  const batchDigested = new Map();

  for (const run of workList.runs) {
    for (const item of run.items) {
      if (out.dispositions.length >= limit) return out;
      const verdict = item.kind === 'finding' ? verdictOf(verdicts, item.itemId) : undefined;
      if (item.kind === 'finding' && !verdict) {
        // A finding whose record already exists (filed by an earlier, interrupted run that never reached
        // apply) settles as that record without a verdict: re-judging it could drop a finding that is
        // already filed, orphaning the record. It takes a slot like any other disposition.
        const fp = prefiledFingerprint(item);
        const number = filedRecordOf(item, fp, known, markers);
        if (number !== null) {
          out.dispositions.push(result(item, 'file', 'tiebreak', { prefiled: true, proposal: { fingerprint: fp, title: null } }));
          out.reuse.push({ itemId: item.itemId, number });
          out.entries.push({
            runDir: run.runDir, itemId: item.itemId, itemHash: item.itemHash, outcome: 'filed', source: 'tiebreak', ref: `#${number}`,
          });
          continue;
        }
        // Likewise a finding whose digest line a trusted comment already carries (digested by an interrupted
        // run), by fingerprint or by item marker. The fingerprint does not depend on the verdict (findingDigest).
        if (item.finding && typeof item.claimText === 'string' && item.claimText.trim()) {
          const prefiledDigest = findingDigest(item, DIGEST_REASONS.CANT_TELL, runIdOf(item.consoleDir));
          const held = heldDigestComment(digestComments, prefiledDigest, item);
          if (held) {
            out.dispositions.push(result(item, 'digest', 'tiebreak', { prefiled: true, digest: prefiledDigest }));
            out.digest.duplicates.push(item.itemId);
            out.entries.push({
              runDir: run.runDir, itemId: item.itemId, itemHash: item.itemHash, outcome: 'digested', source: 'tiebreak', ref: commentRef(held),
            });
            continue;
          }
        }
        out.awaitingVerdict.push(item.itemId);
        continue;
      }

      const d = disposeItem({
        item, verdict, runId: runIdOf(item.consoleDir), mainSha: workList.mainSha, ...(readStaged ? { readStaged } : {}),
      });
      out.dispositions.push(d);
      let ref = d.ref === undefined ? null : d.ref;

      if (d.action === 'file') {
        const fp = d.proposal.fingerprint;
        // A staged proposal whose fingerprint was minted here (its text carried no marker) cannot match a record
        // filed before the backfill existed, so it also dedups by exact title. Anything with a marker of its own,
        // and every finding filing, is fingerprint-only.
        const number = filedRecordOf(item, fp, known, markers);
        const byTitle = number === null && d.source === 'staged-kind' && d.proposal.minted === true ? titles.get(normalizeTitle(d.proposal.title)) : undefined;
        const matched = number !== null ? number : (byTitle === undefined ? null : byTitle);
        if (matched !== null) {
          out.reuse.push({ itemId: d.itemId, number: matched });
          ref = `#${matched}`;
        } else if (fp && batchFiled.has(fp)) {
          out.reuse.push({ itemId: d.itemId, number: null, sameAs: batchFiled.get(fp) });
        } else {
          if (fp) batchFiled.set(fp, d.itemId);
          out.file.push({ itemId: d.itemId, fingerprint: fp, title: d.proposal.title, text: d.proposal.text });
        }
      } else if (d.action === 'digest') {
        // A duplicate's ref is the comment holding its entry: an already-posted one's URL now; a same-pass
        // twin's once that line is posted (`sameAs`, resolved by the procedure as a filing's is).
        const held = batchDigested.has(d.digest.fingerprint) ? null : heldDigestComment(digestComments, d.digest, item);
        if (batchDigested.has(d.digest.fingerprint)) {
          out.digest.duplicates.push(d.itemId);
          out.digest.sameAs.push({ itemId: d.itemId, sameAs: batchDigested.get(d.digest.fingerprint) });
        } else if (held) {
          out.digest.duplicates.push(d.itemId);
          ref = commentRef(held);
        } else {
          batchDigested.set(d.digest.fingerprint, d.itemId);
          out.digest.lines.push(d.digest.line);
        }
      }
      out.entries.push({
        runDir: run.runDir, itemId: d.itemId, itemHash: item.itemHash, outcome: d.outcome, source: d.source, ref,
      });
    }
  }
  return out;
}

module.exports = {
  DIGEST_REASONS, areaFor, disposeItem, planBatch,
};
