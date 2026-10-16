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

const MERGE_STATE_RE = /\bactually\s+merged\b|\bmerge[sd]?\s+(?:in)?to\s+(?:`?(?:origin\/)?main\b`?|the\s+integration\s+branch\b)/i;
const SECTION_RE = /^##\s+(?:Deliverables|Prerequisites)\b/i;
const H2_RE = /^##\s/;
const REF_RE = /#(\d+)\b/g;

// body, candidate prerequisite numbers -> [{requires, line}] — one entry per
// (strict line, candidate ref) pair, in body order, candidates deduped per line.
function mergeStateDemands(body, candidates) {
  const wanted = new Set(candidates);
  const out = [];
  let inSection = false;
  for (const raw of String(body || '').split(/\r?\n/)) {
    if (H2_RE.test(raw)) { inSection = SECTION_RE.test(raw); continue; }
    if (!inSection || !MERGE_STATE_RE.test(raw)) continue;
    const seen = new Set();
    for (const m of raw.matchAll(REF_RE)) {
      const n = Number(m[1]);
      if (wanted.has(n) && !seen.has(n)) { seen.add(n); out.push({ requires: n, line: raw.trim() }); }
    }
  }
  return out;
}

// issues: Map<number, {body}>, records: buildRecords output, numbers: the run's
// targets in run order -> { gates, deferred, kept, rerun }.
function planMergeGateSplit({ issues, records, numbers }) {
  const inRun = new Set(numbers);
  const blockersOf = (n) => ((records[String(n)] || {}).blockedBy || []).filter((b) => inRun.has(b) && b !== n);
  const gates = [];
  for (const n of numbers) {
    const issue = issues.get(n);
    const demands = mergeStateDemands(issue ? issue.body : '', blockersOf(n));
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

module.exports = { MERGE_STATE_RE, mergeStateDemands, planMergeGateSplit };
