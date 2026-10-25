// bin/lib/console/finding-outcomes.js — which can't-tell findings a run holds, and which of them
// are already filed (#4171).
//
// An auto-merge path merges with no Review Console, so a can't-tell tiebreak finding the run held
// could be lost at archive time. One producer writes the filed evidence this module reads, as an
// `AUTO` decisions.md line naming the finding's `work-fingerprint`: `wrap-up/review-console.md`'s
// Can't-tell filings commands, invoked from the console itself and also from
// `wrap-up/auto-merge-short-circuit.md`'s Can't-tell findings step and the dispatch bundle
// Auto-merge gate (`dispatch/settle-and-merge.md`). Consumers: `console-filings.js --fyi` (the FYI
// table) and the archive guard in `reconcile/archive-merged.js` (refuses to archive a run with an
// unfiled finding).
// Read-only over the run dir; never calls `gh` — evidence is the run's own decisions.md.
'use strict';

const { findingItems, runIdOf, cell, renderDroppedBlock } = require('./resolve');
const { planFilings } = require('./finding-filing');
const { FILED_LINE_RE, filedRecords } = require('./residue');

// One row per Low-confidence / Contested item, in findingItems' order. A can't-tell item carries a
// fingerprint (the one planFilings keys its filing on); a legacy row (a staged finding file or a
// STAGED coordination line with no tiebreak verdict) has none and is never counted unfiled.
function cantTellOutcomes({ runDir, deps }) {
  const { items, findings, decisions, dropped } = findingItems({ runDir, deps });
  const filed = filedRecords(decisions);
  const runId = runIdOf(runDir);
  const rows = items.map((item) => {
    const fingerprint = item.tiebreak
      ? planFilings({ items: [{ ...item, resolution: 'filed' }], findings, runId })[0].fingerprint
      : null;
    const filedAs = fingerprint ? (filed.get(fingerprint) ?? null) : null;
    return { id: item.id, section: item.section, tiebreak: item.tiebreak || null, fingerprint, filedAs };
  });
  return { rows, dropped };
}

// The can't-tell findings with no filed evidence: one per distinct fingerprint, first item wins.
function unfiledCantTell({ runDir, deps }) {
  const seen = new Set();
  const out = [];
  for (const row of cantTellOutcomes({ runDir, deps }).rows) {
    if (!row.fingerprint || row.filedAs !== null || seen.has(row.fingerprint)) continue;
    seen.add(row.fingerprint);
    out.push({ item: row.id, fingerprint: row.fingerprint });
  }
  return out;
}

function orDash(value) {
  return value === null || value === undefined || value === '' ? '—' : value;
}

function renderSection(section, rows) {
  const lines = [`#### ${section}`, '', '| Item | Path:Line | Severity | Lens | Recommendation | Filed as |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    const t = r.tiebreak;
    const where = t ? `${t.path}:${t.line}` : null;
    lines.push(`| ${cell(r.id)} | ${cell(orDash(where))} | ${cell(orDash(t && t.severity))} | ${cell(orDash(t && t.lens))} | ${cell(orDash(t && t.recommendation))} | ${r.filedAs === null ? '—' : `#${r.filedAs}`} |`);
  }
  return lines;
}

// The FYI a run with no Review Console shows: every held finding and its filed record, plus the
// read-only dropped block. '' when the run holds nothing.
function renderFindingFyi({ rows, dropped }) {
  const lines = [];
  for (const section of ['Low-confidence findings', 'Contested findings']) {
    const mine = rows.filter((r) => r.section === section);
    if (!mine.length) continue;
    if (lines.length) lines.push('');
    lines.push(...renderSection(section, mine));
  }
  const block = renderDroppedBlock(dropped);
  lines.push(...(lines.length ? block : block.slice(1)));
  return lines.join('\n');
}

module.exports = { FILED_LINE_RE, filedRecords, cantTellOutcomes, unfiledCantTell, renderFindingFyi };
