// bin/lib/residue/render.js — the Outstanding table.
//
// Two rules are load-bearing. A row never renders blank in its Disposition
// column: a blank one is exactly the untracked transcript note this feature
// exists to eliminate. And an unrun probe renders `unknown` with its reason
// rather than contributing to a "No outstanding items" conclusion.
'use strict';

const DEFAULT_CAP = 20;

function renderOutstanding({ results = [], dispositions = {}, cap = DEFAULT_CAP } = {}) {
  const findings = results.filter((r) => r.ran).flatMap((r) => r.findings);
  const unrun = results.filter((r) => !r.ran);
  // A probe that ran on reduced input (e.g. the release probe's local-only
  // tag fallback, #2882) carries a reason too; its findings are less
  // trustworthy, so the note must be visible beside them, not only in --json.
  const degraded = results.filter((r) => r.ran && r.reason);

  const lines = [];
  const shown = findings.slice(0, cap);
  if (shown.length) {
    lines.push(`### Outstanding (${findings.length})`, '');
    lines.push('| # | What | Kind | Remedy | Disposition |', '|---|------|------|--------|-------------|');
    shown.forEach((f, i) => {
      lines.push(`| ${i + 1} | ${f.subject} — ${f.evidence} | ${f.kind} | ${f.remedy} | ${dispositions[f.id] || 'NEEDS DISPOSITION'} |`);
    });
    if (findings.length > shown.length) {
      lines.push('', `> ${findings.length - shown.length} more not shown (cap ${cap}).`);
    }
  } else if (!unrun.length) {
    lines.push('### Outstanding (0)', '', 'No outstanding items — every probe ran and found nothing.');
  } else {
    lines.push('### Outstanding (0)', '');
  }

  if (unrun.length) {
    lines.push('', 'Probes that did not run — these are `unknown`, not clean:', '');
    for (const r of unrun) lines.push(`- unknown: ${r.reason}`);
  }
  if (degraded.length) {
    lines.push('', 'Probes that ran on reduced input — their results may be incomplete:', '');
    for (const r of degraded) lines.push(`- degraded: ${r.reason}`);
  }
  return lines.join('\n');
}

module.exports = { renderOutstanding, DEFAULT_CAP };
