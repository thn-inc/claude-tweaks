// bin/lib/console/bundle.js
// Pure: the Review Console's proposal bundling (#6283). Staged record proposals that land in the
// same class and cite overlapping Key Files are composed into one bundle proposal (a checklist
// record, one `- [ ]` per member) so the console files one record instead of N.
//   parseProposal       staged file text -> { name, title, type, labels, deferReason, body, keyFiles, fingerprint }
//   classifyLandingClass  Labels header -> 'ready' | 'needs-definition' | 'parked' | null (closed rule)
//   planBundles         proposals -> { bundles, singletons, skipped }; hubs come from the open backlog
//   composeBundle       bundle -> the staged text of the bundle proposal
// No fs, no process: the CLI owns reading and writing. Member text is embedded through `defuse`
// (record-fingerprint.js) inside a fence, so extractFingerprints on the bundle reads only the
// trailing marker block this module appends, one marker per member in member order.
'use strict';

const { groupByFileOverlap, GROUP_SIZE_GUARD_DEFAULT, extractKeyFilesSection } = require('../issues/grouping');
const {
  specShapedBody, extractFingerprints, defuse, DEFER_REASONS, TIERS, TYPES, LABELS,
} = require('../issues/record');
const { parseRiskFlags, addRiskFlags } = require('../issues/record-risk-flags');
const { extractSection, fencedBlock } = require('../markdown-blocks');
const { findNearDuplicates, isStrongNearDuplicate, isRelatedCandidate } = require('../issues/near-duplicate');

const FILED_BY = 'review console proposal bundling';
const NO_CHANGE_NOTE = 'No user-visible change.';
const HEADER_RE = /^([A-Za-z][A-Za-z-]*):[ \t]*(.*)$/;
const DEFER_LINE_RE = /^Defer-reason: (\S+)[ \t]*$/m;

// name, text -> parsed proposal, or null when the header carries no `Title:`. The header is every
// line up to the first blank line, CRLF tolerated; the body is everything after it.
function parseProposal(name, text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let end = lines.findIndex((line) => line.trim() === '');
  if (end === -1) end = lines.length;
  const header = {};
  for (const line of lines.slice(0, end)) {
    const m = HEADER_RE.exec(line);
    if (m && !(m[1] in header)) header[m[1]] = m[2].trim();
  }
  if (!header.Title) return null;
  const body = lines.slice(end + 1).join('\n');
  const rawLabels = header.Labels ?? '';
  const labels = rawLabels === '' || rawLabels === 'none' ? [] : rawLabels.split(',').map((l) => l.trim()).filter(Boolean);
  const bodyReason = DEFER_LINE_RE.exec(body);
  const deferReason = header['Defer-reason'] || (bodyReason ? bodyReason[1] : null) || null;
  return {
    name,
    title: header.Title,
    type: header.Type || null,
    labels,
    deferReason,
    body,
    keyFiles: extractKeyFilesSection(body),
    // The member's own marker is the trailing one a producer appends; an earlier one is quoted text.
    fingerprint: extractFingerprints(body).at(-1) || null,
  };
}

// labels -> 'ready' | 'needs-definition' | 'parked' | null. Closed rule: the three states are the
// complete set; ready beside parked or needs:definition is contradictory and unrecognized.
function classifyLandingClass(labels) {
  const set = new Set(Array.isArray(labels) ? labels : []);
  const ready = set.has(LABELS.READY);
  const parked = set.has(LABELS.PARKED);
  const needsDefinition = set.has(LABELS.NEEDS_DEFINITION);
  if (parked && !ready) return 'parked';
  if (needsDefinition && !ready) return 'needs-definition';
  if (ready && !parked && !needsDefinition) return 'ready';
  return null;
}

// proposals (manifest order, each with a unique `key`), { hubPaths, groupSizeGuard } -> plan.
function planBundles(proposals, options = {}) {
  const hubPaths = options.hubPaths instanceof Set ? options.hubPaths : new Set();
  const guard = options.groupSizeGuard ?? GROUP_SIZE_GUARD_DEFAULT;
  if (!Number.isInteger(guard) || guard < 2) throw new TypeError(`planBundles: groupSizeGuard must be an integer >= 2 (got ${guard})`);
  const bundles = [];
  const singletons = [];
  const skipped = [];
  const byClass = { ready: [], 'needs-definition': [] };

  for (const proposal of proposals) {
    const cls = classifyLandingClass(proposal.labels);
    if (cls === 'parked') singletons.push(proposal);
    else if (cls === null) {
      singletons.push(proposal);
      skipped.push({ key: proposal.key, reason: 'singleton: unrecognized landing class' });
    } else if (!DEFER_REASONS.includes(proposal.deferReason)) {
      singletons.push(proposal);
      skipped.push({ key: proposal.key, reason: 'singleton: no valid Defer-reason' });
    } else byClass[cls].push(proposal);
  }

  const found = [];
  for (const cls of Object.keys(byClass)) {
    const items = byClass[cls];
    const byKey = new Map(items.map((p) => [p.key, p]));
    const groups = groupByFileOverlap(items.map((p) => ({ id: p.key, keyFiles: p.keyFiles })), { hubPaths });
    for (const group of groups) {
      const members = group.map((key) => byKey.get(key));
      for (let i = 0; i < members.length; i += guard) {
        const slice = members.slice(i, i + guard);
        // A slice cut from a transitively-joined group can hold members that no longer overlap:
        // regroup inside the slice so only members that share a path stay together.
        const sliceByKey = new Map(slice.map((p) => [p.key, p]));
        const subGroups = slice.length === 1
          ? [[slice[0].key]]
          : groupByFileOverlap(slice.map((p) => ({ id: p.key, keyFiles: p.keyFiles })), { hubPaths });
        for (const sub of subGroups) {
          const subMembers = sub.map((key) => sliceByKey.get(key));
          if (subMembers.length === 1) singletons.push(subMembers[0]);
          else found.push({ class: cls, members: subMembers, sharedPaths: sharedPathsOf(subMembers, hubPaths) });
        }
      }
    }
  }
  const order = new Map(proposals.map((p, i) => [p.key, i]));
  found.sort((a, b) => order.get(a.members[0].key) - order.get(b.members[0].key));
  bundles.push(...found);
  singletons.sort((a, b) => order.get(a.key) - order.get(b.key));
  return { bundles, singletons, skipped };
}

// Non-hub, non-directory paths cited by two or more members, sorted.
function sharedPathsOf(members, hubPaths) {
  const counts = new Map();
  for (const member of members) {
    for (const file of new Set(member.keyFiles || [])) {
      if (hubPaths.has(file) || file.endsWith('/')) continue;
      counts.set(file, (counts.get(file) || 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => n >= 2).map(([file]) => file).sort();
}

function maxTier(members, prefix) {
  let best = -1;
  for (const member of members) {
    for (const label of member.labels) {
      if (!label.startsWith(`${prefix}:`)) continue;
      best = Math.max(best, TIERS.indexOf(label.slice(prefix.length + 1)));
    }
  }
  return best === -1 ? null : `${prefix}:${TIERS[best]}`;
}

// The most common value; a tie goes to the first member's among the tied values.
function majority(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const top = Math.max(...counts.values());
  return values.find((v) => counts.get(v) === top);
}

function sectionOf(body, heading) {
  return defuse(extractSection(body, heading, { trim: true, stopPattern: '1,2' })).trim();
}

function perMember(members, render) {
  return members.map((m) => `### ${defuse(m.title)}\n\n${render(m)}`);
}

// bundle, { openRecords } -> { title, type, labels, deferReason, text }.
function composeBundle(bundle, options = {}) {
  const { members } = bundle;
  const n = members.length;
  const needsDefinition = bundle.class === 'needs-definition';
  const types = [...new Set(members.map((m) => m.type))];
  const type = types.length === 1 && TYPES.includes(types[0]) ? types[0] : 'task';
  const deferReason = majority(members.map((m) => m.deferReason).filter((r) => DEFER_REASONS.includes(r)));
  if (!deferReason) throw new Error('composeBundle: no member carries a valid Defer-reason');

  const origins = members.map((m) => m.labels.find((l) => l.startsWith('by:')));
  const labels = [];
  if (origins[0] && origins.every((o) => o === origins[0])) labels.push(origins[0]);
  if (!needsDefinition) {
    const risk = maxTier(members, 'risk');
    const size = maxTier(members, 'size');
    if (risk) labels.push(risk);
    if (size) labels.push(size);
    labels.push(LABELS.READY);
  } else labels.push(LABELS.NEEDS_DEFINITION);

  const title = `Bundle: ${n} follow-ups touching ${bundle.sharedPaths[0] ?? 'related files'}`;
  const note = (m) => sectionOf(m.body, 'Release Note');
  const notes = [...new Set(members.map(note).filter((s) => s && s !== NO_CHANGE_NOTE))];
  const fallback = (m) => `See the embedded finding for ${defuse(m.title)}.`;
  const keyFiles = [...new Set(members.flatMap((m) => m.keyFiles || []))].map((path) => ({ path, change: 'modify' }));
  // Union through the reader and writer. A member that is unconfirmed, or unclassified beside a
  // classified one, makes the union unconfirmed; every member reading `none` writes `none`.
  const reads = members.map((m) => parseRiskFlags(m.body));
  const classified = reads.filter((r) => r.status !== 'unclassified');
  const flags = [...new Set(classified.flatMap((r) => r.flags))];
  const unconfirmed = reads.some((r) => r.unconfirmed) || (classified.length > 0 && classified.length < reads.length);

  const compose = (header) => {
    const body = specShapedBody({
      header,
      currentState: perMember(members, (m) => `Source: staged/${m.name}\n\n${fencedBlock(defuse(m.body))}`),
      deliverables: members.map((m) => `- [ ] ${defuse(m.title)} — Defer-reason: ${m.deferReason} (staged/${m.name})`).join('\n'),
      ...(needsDefinition
        ? { openQuestion: perMember(members, (m) => sectionOf(m.body, 'Open Question') || fallback(m)) }
        : { acceptanceCriteria: perMember(members, (m) => sectionOf(m.body, 'Acceptance Criteria') || fallback(m)) }),
      releaseNote: notes.length > 0 ? notes.join(' ') : NO_CHANGE_NOTE,
      filedBy: FILED_BY,
      provenance: { origin: `review console bundle of ${n} staged proposals`, deferReason },
      footer: `_Filed by \`${FILED_BY}\` via specShapedBody._`,
      keyFiles,
    });
    return classified.length > 0 ? addRiskFlags(body, flags, { unconfirmed }) : body;
  };

  // The near-duplicate screen runs once, on the composed body; a hit adds a Related line.
  let related = '';
  if (Array.isArray(options.openRecords) && options.openRecords.length > 0) {
    const hits = findNearDuplicates({ title, body: compose(''), labels }, options.openRecords)
      .filter((hit) => isStrongNearDuplicate(hit) || isRelatedCandidate(hit));
    related = hits.map((hit) => `**Related:** #${hit.number}`).join('\n');
  }

  const markers = members.filter((m) => m.fingerprint)
    .map((m) => `<!-- work-fingerprint: ${m.fingerprint} -->\nwork-fingerprint: ${m.fingerprint}`);
  const body = [compose(related), ...markers].join('\n\n');
  const text = `Title: ${title}\nType: ${type}\nLabels: ${labels.join(', ') || 'none'}\nDefer-reason: ${deferReason}\n\n${body}`;
  return { title, type, labels, deferReason, text };
}

module.exports = { parseProposal, classifyLandingClass, planBundles, composeBundle };
