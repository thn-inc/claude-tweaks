// plugin/bin/lib/console/resolve.js — one-process resolution of an
// `unattended` Review Console (#1932). Pure through `deps`: reads the run
// dir's decisions.md, staged/ items, engine-state.json, the fact pack's
// member list, and member grants via an injected reader, into ONE snapshot,
// then maps each item to the stance `wrap-up/review-console.md`'s
// "Auto-resolution short-circuit" states. Computes the merge half; never
// executes it. The CLI (bin/console-resolve.js) owns every write.
'use strict';

const path = require('path');
const { evaluateMaturation } = require('../issues/grant-maturation');
const { resolveRecords } = require('../wrap-up/pack');

// Section names exactly as the console renders them (console-template.md;
// engine-render.js's SECTION_SPECS for the five curation sections).
const SECTIONS = {
  AUTO: 'Auto-applied',
  PENDING: 'Pending review',
  LOW: 'Low-confidence findings',
  CONTESTED: 'Contested findings',
  SKILL: 'Skill updates',
  DOC: 'Documentation updates',
  JOURNEY: 'Journey updates',
  CONFIG: 'Configuration updates',
  REF: 'Reference repairs',
  CLEANUP: 'Cleanup actions',
  QUEUE: 'Queue writes',
  MEMORY: 'Memory updates',
  UPSTREAM: 'Upstream feedback',
  REFUSED: 'Refused — no defer reason',
};

// Ordered: first match wins. Keyed on the staged file's id prefix — the
// `--id <kind>-<n>` stage-item.js wrote, or the filename a skill names.
// Verified against every `staged/…` prefix the skill corpus names (#1932
// plan, decision 6). An unknown prefix is NOT in this table on purpose:
// classifyStagedItem maps it to Pending review with reason 'unmapped-prefix'
// so a new producer can never slip past the console. A row's optional third
// element is a classification reason: a matched item carrying one resolves to
// `pending` regardless of its section's stance.
const SECTION_MAP = [
  // A sweep-shadow collision copy — `bin/lib/hooks/sweep-shadow.js` names them
  // `{preferred}.shadow-dup` / `{preferred}.shadow-dup-{n}` — is a duplicate of
  // some other staged file, not a proposal of its own. First row so it wins over
  // whatever prefix the copied name still carries; never auto-applied.
  [/\.shadow-dup(-\d+)?$/, SECTIONS.PENDING, 'shadow-dup-collision'],
  [/^review-unconfirmed-/, SECTIONS.LOW],
  [/^review-(contested|debate)-/, SECTIONS.CONTESTED],
  [/\.patch$/, SECTIONS.PENDING],
  [/^(polish-suggestion|visual-review|design-decision|build-deviation|simplify|deepen)-/, SECTIONS.PENDING],
  [/^wrap-up-skill(-|\b)/, SECTIONS.SKILL],
  [/^(wrap-up-doc|release-backfill|tidy-doc)-/, SECTIONS.DOC],
  [/^(wrap-up-journey|journeys)(-|\b)/, SECTIONS.JOURNEY],
  [/^(reflect|digest-promotion|leftover|ledger-record|upstream-unfiled|red-team|specify-overlap|specify-redteam|flaky-allowlist|tidy|plan-retention|feedback-drafts)(-|\b)/, SECTIONS.QUEUE],
  [/^wrap-up-memory-/, SECTIONS.MEMORY],
  [/^wrap-up-upstream-/, SECTIONS.UPSTREAM],
];

// The short-circuit's stances, verbatim from review-console.md:
// - every batch section resolves as "Approve all" — Pending review patches
//   apply (after git apply --check), curation rows approve;
// - Low-confidence / Contested rows have no pre-checked default ("the user
//   decides whether to apply, ignore, or escalate") — Approve-all applies
//   nothing, so they stay staged (never auto-applied);
// - Q#/M# resolve to Apply, their pre-checked default;
// - U# resolves to FILED — the one point where unattended diverges from an
//   interactive Approve all (#347's Decision Rationale).
const SECTION_STANCES = {
  [SECTIONS.AUTO]: { resolution: 'applied', reason: 'already in commits — override = revert' },
  [SECTIONS.PENDING]: { resolution: 'apply', reason: 'Approve-all default (patch validated with git apply --check first)' },
  [SECTIONS.LOW]: { resolution: 'keep-staged', reason: 'unconfirmed finding — no Approve-all default; never auto-applied' },
  [SECTIONS.CONTESTED]: { resolution: 'keep-staged', reason: 'debate inconclusive — no Approve-all default; never auto-applied' },
  [SECTIONS.SKILL]: { resolution: 'approve', reason: 'Approve-all default' },
  [SECTIONS.DOC]: { resolution: 'approve', reason: 'Approve-all default' },
  [SECTIONS.JOURNEY]: { resolution: 'approve', reason: 'Approve-all default' },
  [SECTIONS.CONFIG]: { resolution: 'approve', reason: 'Approve-all default (stage-only row — the write happens at execution, never silently)' },
  [SECTIONS.REF]: { resolution: 'approve', reason: 'Approve-all default' },
  [SECTIONS.CLEANUP]: { resolution: 'approve', reason: 'Approve-all default — cleanup-procedures.md items run as planned' },
  [SECTIONS.QUEUE]: { resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' },
  [SECTIONS.MEMORY]: { resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' },
  [SECTIONS.UPSTREAM]: { resolution: 'filed', reason: 'unattended files upstream feedback like M#/Q# (#347)' },
  [SECTIONS.REFUSED]: { resolution: 'refused', reason: 'no default; excluded from Approve all and from consoleAutoResolve (refused-proposals.md)' },
};

const ENGINE_ROW_SECTIONS = { skills: SECTIONS.SKILL, docs: SECTIONS.DOC, journeys: SECTIONS.JOURNEY, 'claude-md': SECTIONS.CONFIG, 'decision-records': SECTIONS.CONFIG, references: SECTIONS.REF };

function classifyStagedItem(filename) {
  for (const [re, section, reason] of SECTION_MAP) if (re.test(filename)) return reason ? { section, reason } : { section };
  return { section: SECTIONS.PENDING, reason: 'unmapped-prefix' };
}

function readText(deps, file) {
  try { return deps.readFile(file); } catch { return null; }
}

function readJson(deps, file) {
  const text = readText(deps, file);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Members: the fact pack's resolved record list when a pack exists (#1930
// gathers it before the console), else pack.js's shared resolveRecords
// ladder (run dir's own headers, the worktree mirror, a parent multi-spec
// run's manifest.yml + spec-*/work/ headers — #2028).
function readMembers(deps, runDir) {
  const pack = readJson(deps, path.join(runDir, 'wrap-up-pack.json'));
  const fromPack = pack && pack.inputs && Array.isArray(pack.inputs.records) ? pack.inputs.records.map(Number).filter(Number.isFinite) : [];
  if (fromPack.length) return fromPack;
  const state = readJson(deps, path.join(runDir, 'run-state.json'));
  const worktree = state && typeof state.worktree === 'string' ? state.worktree : null;
  return resolveRecords(deps, runDir, worktree).records;
}

function parseInvariant(patchText) {
  const m = /^Invariant:\s*(.+)$/m.exec(patchText || '');
  return m ? m[1].trim() : null;
}

// Everything resolveAll reads, read once. No resolution is computed here.
function readSnapshot({ runDir, deps }) {
  const decisions = readText(deps, path.join(runDir, 'decisions.md')) || '';
  const stagedDir = path.join(runDir, 'staged');
  const staged = deps.readdir(stagedDir).filter((n) => !n.startsWith('.')).sort().map((name) => ({
    name,
    path: path.join(stagedDir, name),
    text: name.endsWith('.patch') ? readText(deps, path.join(stagedDir, name)) : null,
  }));
  const engineState = readJson(deps, path.join(runDir, 'engine-state.json'));
  const members = readMembers(deps, runDir);
  let grants = null;
  let grantsError = null;
  if (members.length) {
    try { grants = deps.readGrants(members) || {}; } catch (err) { grantsError = err; }
  }
  const patchChecks = {};
  for (const item of staged) {
    if (item.name.endsWith('.patch')) patchChecks[item.name] = deps.gitApplyCheck(item.path);
  }
  return { decisions, staged, engineState, members, grants, grantsError, patchChecks };
}

function decisionLines(decisions) {
  return decisions.split('\n').filter((l) => /^- (AUTO|STAGED|SKIP|KEPT-PROMPT|SCANNED|REFUSED|FAILED) /.test(l));
}

// `refused-proposals.md`'s refused row, logged as
// `REFUSED {time} — Queue write {Q#}: no valid Defer-reason on {staged path};
// kept staged.` — the staged path it names IS the item. Extension-anchored the
// same way coordinationItems is, so trailing punctuation never joins the name.
function refusedStagedNames(decisions) {
  const out = new Set();
  for (const line of decisionLines(decisions)) {
    if (!/^- REFUSED /.test(line)) continue;
    const m = /staged\/([A-Za-z0-9_-]+\.(?:md|patch))/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

function needsHumanVerdict(decisions) {
  return decisionLines(decisions).find((l) => /needs-human/i.test(l) && /merge-check|assess-agent-autonomy/i.test(l)) || null;
}

function mergeResolution(snapshot, deps) {
  const verdict = needsHumanVerdict(snapshot.decisions);
  if (verdict) return { resolution: 'leave-open', reason: `merge-check verdict needs-human takes precedence: ${verdict.replace(/^- /, '')}` };
  if (!snapshot.members.length) return { resolution: 'leave-open', reason: 'members-unresolved' };
  if (snapshot.grantsError) return { resolution: 'leave-open', reason: 'grants-unreadable' };
  for (const n of snapshot.members) {
    const g = snapshot.grants[n] || { labels: [], pendingSince: null };
    const labels = g.labels || [];
    const mat = evaluateMaturation({
      hasMergeLabel: labels.includes('auto:merge'),
      hasPendingLabel: labels.includes('auto:merge-pending'),
      pendingSince: g.pendingSince || null,
      vetoWindowHours: deps.vetoWindowHours,
      now: deps.now(),
    });
    if (!mat.mature) return { resolution: 'leave-open', reason: `#${n} lacks auto:merge and a matured auto:merge-pending (${mat.reason})` };
  }
  return { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' };
}

function stagedItems(snapshot) {
  // Refusal is a decisions.md fact about the item, not a fact about its name —
  // so it is decided before SECTION_MAP ever runs and outranks every stance.
  const refused = refusedStagedNames(snapshot.decisions);
  return snapshot.staged.map((s) => {
    if (refused.has(s.name)) return { id: s.name, section: SECTIONS.REFUSED, ...SECTION_STANCES[SECTIONS.REFUSED] };
    const { section, reason } = classifyStagedItem(s.name);
    if (reason) return { id: s.name, section, resolution: 'pending', reason };
    const stance = SECTION_STANCES[section];
    if (s.name.endsWith('.patch')) {
      const check = snapshot.patchChecks[s.name] || { ok: false, error: 'not checked' };
      if (!check.ok) {
        const inv = parseInvariant(s.text);
        return { id: s.name, section, resolution: 'stale', reason: `git apply --check failed (${check.error || 'unknown'}) — re-derive from Invariant: ${inv || '(no Invariant: line)'}` };
      }
    }
    return { id: s.name, section, resolution: stance.resolution, reason: stance.reason };
  });
}

// engine-state.json: { results: { <rowId>: { result, findings: [{target, action, commit?, stagePath?}] } } }
// (engine-render.js's worklistRows/collectFindings shape). A staged finding
// whose stagePath names a staged/ file is the same item as that file.
function engineItems(snapshot, stagedIds) {
  const out = [];
  const results = (snapshot.engineState && snapshot.engineState.results) || {};
  for (const [rowId, section] of Object.entries(ENGINE_ROW_SECTIONS)) {
    const entry = results[rowId];
    if (!entry || entry.result !== 'findings') continue;
    for (const f of entry.findings || []) {
      if (f.action === 'staged') {
        const base = f.stagePath ? path.basename(f.stagePath) : null;
        if (base && stagedIds.has(base)) continue; // already an item via staged/
        out.push({ id: `${rowId}:${f.target}`, section, resolution: SECTION_STANCES[section].resolution, reason: SECTION_STANCES[section].reason });
      } else if (f.action === 'applied') {
        out.push({ id: `${rowId}:${f.target}`, section, resolution: 'applied', reason: `applied (${f.commit || 'commit unknown'})` });
      }
    }
  }
  return out;
}

// decisions.md STAGED lines from review coordination that have no staged/
// file of their own (single-read unconfirmed findings). A line naming a
// staged/ path that exists is the same item as that file.
function coordinationItems(snapshot, stagedIds) {
  const out = [];
  for (const line of decisionLines(snapshot.decisions)) {
    if (!/^- STAGED /.test(line)) continue;
    // Extension-anchored so trailing sentence punctuation (a period ending
    // the decisions.md line right after ".md") is never captured into the
    // filename — `.` is deliberately excluded from the body class.
    const named = /staged\/([A-Za-z0-9_-]+\.(?:md|patch))/.exec(line);
    if (named && stagedIds.has(named[1])) continue;
    let section = null;
    if (/low-confidence|not directly verified|unconfirmed/i.test(line)) section = SECTIONS.LOW;
    else if (/contested|debate/i.test(line)) section = SECTIONS.CONTESTED;
    if (section) out.push({ id: `decision:${line.slice(2, 60)}`, section, resolution: 'keep-staged', reason: SECTION_STANCES[section].reason });
  }
  return out;
}

// Every cell is escaped, ids included: a staged filename is producer-supplied
// text, so an unescaped `|` in one silently splits the row.
function cell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function renderRows({ items, cleanup, merge, intro }) {
  const lines = ['### Wrap-Up Review Console (auto-resolved at unattended)', '', intro, '', '| # | Section | Item | Resolution | Reason |', '|---|---|---|---|---|'];
  items.forEach((it, i) => lines.push(`| ${i + 1} | ${cell(it.section)} | ${cell(it.id)} | AUTO-RESOLVED: ${cell(it.resolution)} | ${cell(it.reason)} |`));
  lines.push(`| ${items.length + 1} | Cleanup actions | cleanup-procedures.md items | AUTO-RESOLVED: ${cell(cleanup.resolution)} | ${cell(cleanup.reason)} |`);
  lines.push('', `Merge: **${merge.resolution}** — ${merge.reason}`);
  return lines.join('\n');
}

function renderTable(result) {
  const autoCount = decisionLines(result.snapshot.decisions).filter((l) => /^- AUTO /.test(l)).length;
  return renderRows({ items: result.items, cleanup: result.sections.cleanup, merge: result.merge, intro: `Auto-applied entries in decisions.md: ${autoCount} (already in commits — override = revert).` });
}

// The idempotent re-render: a console.json already carrying `resolved: true`
// is re-shown verbatim (#1932 I3) — no snapshot is read and nothing is
// re-resolved, so the stored items ARE the table. Two item shapes reach here:
// this CLI's own ({section, resolution, reason}) and `_shared/console-on-pr.md`'s
// ({kind, summary, stagedHash, commentId}) once the reconciler has executed a
// PR-rendered console. Every column falls back per field so the second shape
// renders as recorded data rather than a row of `undefined`.
function renderStoredTable(consoleJson) {
  const cj = consoleJson || {};
  const items = (Array.isArray(cj.items) ? cj.items : []).map((it) => ({
    id: it.id || it.kind || '—',
    section: it.section || '—',
    resolution: it.resolution || 'recorded',
    reason: it.reason || it.summary || '',
  }));
  return renderRows({
    items,
    cleanup: SECTION_STANCES[SECTIONS.CLEANUP],
    merge: cj.merge || { resolution: 'unknown', reason: 'not recorded in console.json' },
    intro: `Already resolved at ${cj.at || 'an unrecorded time'} — re-rendered from console.json; nothing re-resolved.`,
  });
}

function resolveAll({ runDir, policy, deps }) {
  if (policy !== 'console-auto') throw new RangeError(`unsupported policy: ${policy} (expected console-auto)`);
  const snapshot = readSnapshot({ runDir, deps });
  const stagedIds = new Set(snapshot.staged.map((s) => s.name));
  const items = [...stagedItems(snapshot), ...engineItems(snapshot, stagedIds), ...coordinationItems(snapshot, stagedIds)];
  const sections = { cleanup: { ...SECTION_STANCES[SECTIONS.CLEANUP] } };
  const merge = mergeResolution(snapshot, deps);
  const result = { ceiling: 'unattended', items, sections, merge, snapshot };
  result.table = renderTable(result);
  return result;
}

module.exports = { SECTIONS, SECTION_MAP, SECTION_STANCES, classifyStagedItem, readSnapshot, resolveAll, renderTable, renderStoredTable };
