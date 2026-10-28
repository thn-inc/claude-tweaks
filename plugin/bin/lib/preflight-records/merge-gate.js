// bin/lib/preflight-records/merge-gate.js
// Multi-spec merge-state gate (#2733). A target whose own ## Deliverables /
// ## Prerequisites text demands that an in-run blocked-by prerequisite be
// merged into the integration branch can never be satisfied inside one shared
// multi-spec branch — the prerequisite is built there, not merged. Such a
// target and its in-run transitive dependents are split out of the run before
// claiming. Content-satisfiable phrasings ("must be merged first", "until #N
// is merged") deliberately don't match: the shared branch already carries the
// prerequisite's content ahead of the dependent's build. Decision + corpus
// evidence: skills/flow/multispec-merge-gate.md.
'use strict';

const { escapeRegExp } = require('../shared-primitives');
const { fencedLineMask } = require('../issues/record-payload');

// integrationBranch (default 'main') -> the strict merge-state RegExp. A demand
// that a prerequisite be "actually merged", or merged/landed to/into/on the
// integration branch — never the content-satisfiable "merged first" forms.
function buildMergeStateRe(integrationBranch = 'main') {
  const b = escapeRegExp(integrationBranch);
  const target = `(?:the\\s+)?(?:\`?(?:origin\\/)?${b}\\b\`?(?:\\s+branch\\b)?|integration\\s+branch\\b)`;
  return new RegExp(`\\bactually\\s+merged\\b|\\b(?:merge[sd]?\\s+(?:in)?to|land(?:s|ed)?\\s+(?:on|in|into))\\s+${target}`, 'i');
}
const MERGE_STATE_RE = buildMergeStateRe('main');
const SECTION_RE = /^##\s+(?:Deliverables|Prerequisites)\b/i;
const H2_RE = /^##\s/;
const REF_RE = /#(\d+)\b/g;

// body, candidate prerequisite numbers, the strict regex to test against
// (default MERGE_STATE_RE, the 'main' instance) -> [{requires, line}] — one
// entry per (strict line, candidate ref) pair, in body order, candidates
// deduped per line.
function mergeStateDemands(body, candidates, re = MERGE_STATE_RE) {
  const wanted = new Set(candidates);
  const out = [];
  let inSection = false;
  const lines = String(body || '').split(/\r?\n/);
  // A heading-shaped line inside a fenced block is quoted content, not a
  // section boundary (#4369) — it stays section content, minus its heading role.
  // An unclosed fence is read as text, not as a block hiding every later heading:
  // this is a gate, and a stray fence must not silently drop a demand.
  const fenced = fencedLineMask(lines, { unclosedAsText: true });
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!fenced[i] && H2_RE.test(raw)) { inSection = SECTION_RE.test(raw); continue; }
    if (!inSection || !re.test(raw)) continue;
    const seen = new Set();
    for (const m of raw.matchAll(REF_RE)) {
      const n = Number(m[1]);
      if (wanted.has(n) && !seen.has(n)) { seen.add(n); out.push({ requires: n, line: raw.trim() }); }
    }
  }
  return out;
}

// issues: Map<number, {body}>, records: buildRecords output, numbers: the run's
// targets in run order, integrationBranch (default 'main') -> { gates, deferred, kept, rerun }.
function planMergeGateSplit({ issues, records, numbers, integrationBranch = 'main' }) {
  const re = buildMergeStateRe(integrationBranch);
  const inRun = new Set(numbers);
  const blockersOf = (n) => ((records[String(n)] || {}).blockedBy || []).filter((b) => inRun.has(b) && b !== n);
  const gates = [];
  for (const n of numbers) {
    const issue = issues.get(n);
    const demands = mergeStateDemands(issue ? issue.body : '', blockersOf(n), re);
    if (demands.length === 0) continue;
    gates.push({ record: n, requires: [...new Set(demands.map((d) => d.requires))], line: demands[0].line });
  }
  const deferredSet = new Set(gates.map((g) => g.record));
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of numbers) {
      if (!deferredSet.has(n) && blockersOf(n).some((b) => deferredSet.has(b))) { deferredSet.add(n); grew = true; }
    }
  }
  const deferred = numbers.filter((n) => deferredSet.has(n));
  const kept = numbers.filter((n) => !deferredSet.has(n));
  const rerun = deferred.length ? `/claude-tweaks:flow ${deferred.map((n) => `#${n}`).join(',')}` : null;
  return { gates, deferred, kept, rerun };
}

module.exports = { MERGE_STATE_RE, buildMergeStateRe, mergeStateDemands, planMergeGateSplit };
