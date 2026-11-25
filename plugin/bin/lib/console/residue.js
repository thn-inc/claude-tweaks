// plugin/bin/lib/console/residue.js — the "no human has reviewed this" predicate
// for a resolved Review Console, and the paste-ready lines that name it (#3370).
// An `unattended` run's console.json records items it deliberately left
// `pending` / `keep-staged`; nothing re-surfaced them once the run archived.
// Pure apart from the default fs readers: read-only toward staged/ and toward
// resolution. The only write in the feature (`--ack`) lives in the CLI.
// An unresolved item whose staged file has since vanished (a rename, a cleanup)
// is `missing` (#3772): nothing exists at the id the console recorded, so there
// is nothing a human can open from it; `splitMissing` takes it out of the count
// and the banner names it once instead. A PR console's `filing-failed` /
// `reverse-failed` outcome is residue as well (#4172), with no staged file to check.
// `filing-pending` (#4170) is residue too: a planned can't-tell filing (`console.json#filings`)
// with no `AUTO … filed as #N` line in decisions.md has no record behind it. It is DERIVED at
// read time from those two files, never stored — console.json is written once at resolve time,
// before the filing outcome exists, so a stored word would go stale the moment a re-run files it,
// and `UNRESOLVED_RESOLUTIONS` stays exactly `pending`/`keep-staged`.
// `digest-pending` (#4679) is its twin for a planned can't-tell digest entry (`console.json#digests`) with no
// `AUTO … digested (work-fingerprint …)` line, derived the same way.
// Leaf module (fs/path only): reconcile code loads it at module load and must not pull wrap-up/pack.js.
'use strict';

const fs = require('fs');
const path = require('path');

const UNRESOLVED_RESOLUTIONS = new Set(['pending', 'keep-staged']);
// #4172: a PR console's item whose filing or reverse failed is residue too; its
// `outcome` is the failed word, and its id names a PR row or a ruling's staged file
// (#3942: a ratified deferral whose record failed to land reads `filing-failed` too).
const FAILED_OUTCOMES = new Set(['filing-failed', 'reverse-failed']);
const MISSING_RESOLUTION = 'missing';
const FILING_PENDING_RESOLUTION = 'filing-pending';
// #4679: the digest twin of `filing-pending` — a planned can't-tell digest entry (`console.json#digests`) with no
// digested line in decisions.md has not reached the materiality digest. Derived at read time, never stored.
const DIGEST_PENDING_RESOLUTION = 'digest-pending';
// #6284: an approved `followup-recheck-{n}.md` proposal whose merge never landed — read-time only, never stored.
const RECHECK_APPROVED_RESOLUTION = 'recheck-approved';

// The one spelling of a can't-tell finding fingerprint (`consolefinding-{8 hex}`, finding-filing.js's
// findingFingerprint): the two AUTO-line patterns below and finding-filing.js's marker reader all build on it. It
// lives here because this module is a leaf (fs/path only) that finding-filing.js can require without a cycle.
const CONSOLE_FINDING_FP = 'consolefinding-[0-9a-f]{8}';

// An AUTO line recording a created or deduped filing. Anchored on `^- AUTO `: the same phrase in a
// STAGED/SKIP line (or quoted prose) is not evidence a record exists.
const FILED_LINE_RE = new RegExp(`^- AUTO .*?(?:already )?filed as #(\\d+) \\(work-fingerprint (${CONSOLE_FINDING_FP})\\)`);

// An AUTO line recording a digested or deduped can't-tell digest entry (#4679). Stricter than FILED_LINE_RE: it
// is anchored on the Queue-write step and a whitespace-free item token, exactly the shape log-decision.js's
// formatEntry writes (`- AUTO {hms} — Queue write: {item} digested (work-fingerprint …)`), so negative wording
// (`not digested`, `undigested`) or another step's line is never evidence.
const DIGESTED_LINE_RE = new RegExp(`^- AUTO \\S+ — Queue write: \\S+ (?:already )?digested \\(work-fingerprint (${CONSOLE_FINDING_FP})\\)`);

// decisions.md text -> Map<fingerprint, record number>; the first line for a fingerprint wins.
function filedRecords(decisions) {
  const out = new Map();
  for (const line of String(decisions || '').split('\n')) {
    const m = FILED_LINE_RE.exec(line);
    if (m && !out.has(m[2])) out.set(m[2], Number(m[1]));
  }
  return out;
}

// A live item is returned as-is; a PR item with a failed `outcome` is returned as
// a normalized copy so the residue renderers read it like any other item.
function unresolvedItems(consoleJson) {
  if (!consoleJson || typeof consoleJson !== 'object' || !Array.isArray(consoleJson.items)) return [];
  return consoleJson.items.flatMap((i) => {
    if (!i) return [];
    if (UNRESOLVED_RESOLUTIONS.has(i.resolution)) return [i];
    if (FAILED_OUTCOMES.has(i.outcome)) {
      return [{ ...i, section: i.section ?? i.kind, resolution: i.outcome, reason: i.reason ?? i.note }];
    }
    return [];
  });
}

// One item per planned filing (`console.json#filings`) whose fingerprint has no filed or deduped
// line in `decisions`: the console item it was planned for (a bare `{ id }` when none), re-worded
// `filing-pending`. Malformed entries are skipped; no `filings` array is no pending filing.
function pendingFilings(consoleJson, decisions) {
  if (!consoleJson || typeof consoleJson !== 'object' || !Array.isArray(consoleJson.filings)) return [];
  const filed = filedRecords(decisions);
  const digested = digestedFindings(decisions);
  const items = Array.isArray(consoleJson.items) ? consoleJson.items : [];
  return consoleJson.filings.flatMap((entry) => {
    if (!entry || typeof entry.item !== 'string' || typeof entry.fingerprint !== 'string') return [];
    // #4679: a previous-release run's `drop` item sits in `filings`; its default-selection re-run digests it, so
    // a digested line settles the entry as a filed line does (pendingDigests clears on a filed line the same way).
    if (digested.has(entry.fingerprint)) return [];
    if (filed.has(entry.fingerprint)) return [];
    const item = items.find((i) => i && i.id === entry.item);
    // #4620: a failed filing rewritten `carried` lives in the acceptance packet now, not in this run's residue.
    if (item && item.resolution === 'carried') return [];
    return [{
      ...(item || { id: entry.item }),
      resolution: FILING_PENDING_RESOLUTION,
      reason: "planned can't-tell filing has no record yet (no filed or deduped line in decisions.md)",
    }];
  });
}

// decisions.md text -> Set<fingerprint> of the digested or already-digested lines (#4679).
function digestedFindings(decisions) {
  const out = new Set();
  for (const line of String(decisions || '').split('\n')) {
    const m = DIGESTED_LINE_RE.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

// One item per planned digest entry (`console.json#digests`) whose fingerprint has no digested line, and no
// filed line either (an existing record wins over a digest), in `decisions`: the console item it was planned for (a bare `{ id }` when none), re-worded `digest-pending`.
// The mirror of pendingFilings; malformed entries are skipped, and no `digests` array is none pending.
function pendingDigests(consoleJson, decisions) {
  if (!consoleJson || typeof consoleJson !== 'object' || !Array.isArray(consoleJson.digests)) return [];
  const digested = digestedFindings(decisions);
  const filed = filedRecords(decisions);
  const items = Array.isArray(consoleJson.items) ? consoleJson.items : [];
  return consoleJson.digests.flatMap((entry) => {
    if (!entry || typeof entry.item !== 'string' || typeof entry.fingerprint !== 'string') return [];
    if (digested.has(entry.fingerprint) || filed.has(entry.fingerprint)) return [];
    const item = items.find((i) => i && i.id === entry.item);
    return [{
      ...(item || { id: entry.item }),
      resolution: DIGEST_PENDING_RESOLUTION,
      reason: "planned can't-tell digest entry has no digested line in decisions.md",
    }];
  });
}

const RECHECK_ID_RE = /^followup-recheck-(\d+)\.md$/;
// A PR-rendered console's row id (`q-{n}`, or `{spec-slug}-q-{n}`), whose approval names its staged file in `stagedFile`.
const PR_QUEUE_ITEM_RE = /^(?:[A-Za-z0-9._-]+-)?q-\d+$/;

// #6284: the `followup-recheck-{n}.md` staged file an item stands for — its own id, or a PR-rendered `q-{n}` row's
// `stagedFile` (recheck-followups.js approve --item). null for any other item.
function recheckStagedId(item) {
  if (!item || typeof item !== 'object') return null;
  if (RECHECK_ID_RE.test(String(item.id))) return item.id;
  if (PR_QUEUE_ITEM_RE.test(String(item.id)) && typeof item.stagedFile === 'string' && RECHECK_ID_RE.test(item.stagedFile)) return item.stagedFile;
  return null;
}

// The paste-ready re-check verbs (#6284). `approve` takes no --pr: the CLI derives it from the run itself.
const recheckBin = (pluginRoot) => (pluginRoot ? `node "${pluginRoot}/bin/recheck-followups.js"` : 'recheck-followups.js');
function recheckApproveCommand({ consoleDir, pluginRoot, id }) {
  return `${recheckBin(pluginRoot)} approve --run "${consoleDir}" --id ${id}`;
}
function recheckExecuteCommand({ consoleDir, pluginRoot, id }) {
  return `${recheckBin(pluginRoot)} execute --run "${consoleDir}" --id ${id}`;
}

// #6284: a `followup-recheck-{n}.md` item `recheck-followups.js approve` left `pending` with an `approval` field is
// approved but unexecuted (its merge never landed or `execute` was never run). Re-worded `recheck-approved` at read
// time only; `execute` rewrites a settled one to `applied`/`dropped`, which `unresolvedItems` never yields.
// `readStaged(id)` (optional) supplies the proposal text so the reason can name `close` or `narrow`.
function rewordRecheckApproved(item, readStaged) {
  const stagedId = recheckStagedId(item);
  const m = stagedId && RECHECK_ID_RE.exec(stagedId);
  if (!m || item.resolution !== 'pending' || !item.approval || typeof item.approval !== 'object') return item;
  let action = 're-check proposal';
  try {
    const head = String((readStaged && readStaged(stagedId)) || '').replace(/\r\n/g, '\n').split('\n\n')[0];
    const a = /^Action:[ \t]*(close|narrow)[ \t]*$/m.exec(head);
    if (a) action = a[1];
  } catch { /* the staged file is gone: the generic wording stands */ }
  const pr = item.approval.pr === 'local' ? 'local merge' : `PR #${item.approval.pr}`;
  return { ...item, resolution: RECHECK_APPROVED_RESOLUTION, reason: `approved #${m[1]} ${action} waits on ${pr}` };
}

function consoleResidueItems(consoleJson, decisions = '', readStaged) {
  return [
    ...unresolvedItems(consoleJson).map((i) => rewordRecheckApproved(i, readStaged)),
    ...pendingFilings(consoleJson, decisions), ...pendingDigests(consoleJson, decisions),
  ];
}

// Partition unresolved items into those a human can still review and those
// whose `staged/{id}` is gone from `consoleDir`. An item with no usable id, a
// `decision:` item (it lives in decisions.md, not staged/), an engine-row id
// (`docs:CLAUDE.md` — a `{row}:{label}` item with no staged file of its own),
// or an id that is not a bare file name is never classified missing — only a
// plain staged-file id can be proven absent. A failed PR outcome (#4172) is never
// missing either: it is residue whether or not its staged file (a ruling row's id) exists. Nor is a
// `filing-pending` item (#4170): its absent record is the residue, whatever its id looks like.
function splitMissing(items, consoleDir, exists = fs.existsSync) {
  const kept = [];
  const missing = [];
  for (const item of items) {
    const id = item && item.id;
    const checkable = typeof id === 'string' && id !== '' && !id.includes(':') && path.basename(id) === id
      && !FAILED_OUTCOMES.has(item.resolution) && item.resolution !== FILING_PENDING_RESOLUTION
      && item.resolution !== DIGEST_PENDING_RESOLUTION && item.resolution !== RECHECK_APPROVED_RESOLUTION;
    if (checkable && !exists(path.join(consoleDir, 'staged', id))) {
      missing.push({ ...item, resolution: MISSING_RESOLUTION, reason: `staged file absent (was ${item.resolution})` });
    } else {
      kept.push(item);
    }
  }
  return { items: kept, missing };
}

const defaultReadFile = (p) => fs.readFileSync(p, 'utf8');
const defaultReaddir = (p) => {
  try { return fs.readdirSync(p); } catch { return []; }
};

// `path` on each console is the ABSOLUTE console.json path. A console.json that
// is absent is the normal case (no console, or a spec dir without one) and is
// silent; one that exists but cannot be read or parsed is listed in
// `unreadable` instead, so a caller can say its items could not be checked
// rather than let it read as "no residue".
function readRunResidue(runDir, { readFile = defaultReadFile, readdir = defaultReaddir, exists } = {}) {
  const candidates = [path.join(runDir, 'console.json')];
  for (const name of readdir(runDir).filter((n) => /^spec-/.test(n)).sort()) {
    candidates.push(path.join(runDir, name, 'console.json'));
  }
  const consoles = [];
  const missingOnly = [];
  const unreadable = [];
  for (const p of candidates) {
    let parsed;
    try { parsed = JSON.parse(readFile(p)); } catch (err) {
      if (!(err && err.code === 'ENOENT')) unreadable.push(p);
      continue;
    }
    // Valid JSON that is not an object (`null`, a number) is a malformed console, not "no residue".
    if (!parsed || typeof parsed !== 'object') { unreadable.push(p); continue; }
    let decisions = '';
    if ([parsed.filings, parsed.digests].some((list) => Array.isArray(list) && list.length > 0)) {
      try { decisions = readFile(path.join(path.dirname(p), 'decisions.md')); } catch { decisions = ''; }
    }
    const readStaged = (id) => readFile(path.join(path.dirname(p), 'staged', id));
    const { items, missing } = splitMissing(consoleResidueItems(parsed, decisions, readStaged), path.dirname(p), exists);
    const acknowledged = typeof parsed.residueAcknowledgedAt === 'string';
    if (items.length === 0) {
      // Not residue (nothing a human can open), but its missing items are still
      // named in the run's `not counted` line when another console is listed.
      if (missing.length > 0) missingOnly.push({ path: p, missing, acknowledged });
      continue;
    }
    consoles.push({ path: p, items, missing, acknowledged });
  }
  return { dir: runDir, consoles, missingOnly, unreadable };
}

const shown = (v) => (v === undefined || v === null || v === '' ? '—' : v);

// The paste-ready `console-filings.js` re-run for a console's planned filings and digest entries (#4679): the
// default (unattended) selection, never `--only` — `filing-pending` and `digest-pending` exist only for unattended
// runs, and `--only` composes the human-present `needs:definition` shape. One command settles both kinds:
// already-filed items dedup against `--existing`, held digests against `--digest-comments`, so the command
// depends on no item id. Without a `pluginRoot` the CLI is named bare.
function consoleRerunCommand({ consoleDir, pluginRoot }) {
  const bin = pluginRoot ? `node "${pluginRoot}/bin/console-filings.js"` : 'console-filings.js';
  return `${bin} --run "${consoleDir}" --existing <issues.json> --out-dir <dir> --digest-comments <comments.json>`;
}

// #4170: a `filing-pending` item clears only on a logged filed/deduped line (FILED_LINE_RE), so the remedy
// names the log lines, not just the create — a session that died after the create re-runs to a `deduped` entry,
// which console-filings.js logs itself (#4026), leaving only its `logFailures` to hand-log.
const FILING_LOG_REMEDY = "file each printed `file` entry and log it as '{item} filed as #{n} (work-fingerprint {fp})', hand-log any `logFailures` item as '{item} already filed as #{n} (work-fingerprint {fp})' (the CLI logs each `deduped` entry itself; a `drop` item's re-run logs its digested line instead), via log-decision.js `--run` that console's dir, per wrap-up/review-console.md's Can't-tell filings";

// #4679: a `digest-pending` item clears only on a logged digested line (DIGESTED_LINE_RE).
// DIGESTED_LINE_RE accepts only the `AUTO … Queue write: …` shape, so the remedy names the full command (no `--spec`).
// `{item}` and `{fp}` stay placeholders (they vary per entry); the console dir and plugin root are filled in, and
// the CLI is named bare without a `pluginRoot`, as consoleRerunCommand does.
function digestLogRemedy({ consoleDir, pluginRoot }) {
  const bin = pluginRoot ? `node "${pluginRoot}/bin/log-decision.js"` : 'log-decision.js';
  return 'post each printed digest line to the materiality digest and log it with '
    + `\`${bin} --run "${consoleDir}" --status AUTO --section "/wrap-up" --step "Queue write" --text '{item} digested (work-fingerprint {fp})' --reversibility n/a\``
    + " (no `--spec`), hand-logging a held entry with the text '{item} already digested (work-fingerprint {fp})'";
}

function pendingKindOf(resolution) {
  if (resolution === FILING_PENDING_RESOLUTION) return 'filing';
  if (resolution === DIGEST_PENDING_RESOLUTION) return 'digest';
  return null;
}

// One item line plus its pointer: a `cat` of the staged file, or for a
// `decision:` item (no staged file — it lives in decisions.md) a `see` line.
// An item without a usable id is still listed, as `(no id)`, but gets no
// pointer — a malformed item must never throw and hide every other banner.
// `printed` is one console's state ({ rerun, kinds }): the re-run command prints once per console, and each
// pending kind's remedy once, however many items of either kind it holds.
function itemLines(item, consoleDir, pluginRoot, printed = { rerun: false, kinds: new Set() }) {
  const hasId = typeof item.id === 'string' && item.id !== '';
  const lines = [`  - ${hasId ? item.id : '(no id)'} — ${shown(item.section)}: ${item.resolution} (${shown(item.reason)})`];
  if (!hasId) return lines;
  if (item.id.startsWith('decision:')) {
    const decisions = path.join(consoleDir, 'decisions.md');
    if (fs.existsSync(decisions)) lines.push(`    see "${decisions}"`);
    return lines;
  }
  const recheckId = recheckStagedId(item);
  const staged = path.join(consoleDir, 'staged', recheckId || item.id);
  if (fs.existsSync(staged)) lines.push(`    cat "${staged}"`);
  if (item.resolution === RECHECK_APPROVED_RESOLUTION && recheckId) {
    const local = item.approval && item.approval.pr === 'local';
    lines.push(`    execute: ${recheckExecuteCommand({ consoleDir, pluginRoot, id: recheckId })}${local ? '   (local merge: add --local-merged only after the push landed)' : ''}`);
    return lines;
  }
  // C1: an unapproved re-check proposal (the unattended `followup-recheck-human-call` pending item) — without an
  // approve line, `--ack` would archive the run and the proposal with it.
  if (recheckId && item.resolution === 'pending' && !item.approval) {
    lines.push(`    approve: ${recheckApproveCommand({ consoleDir, pluginRoot, id: recheckId })}`);
    lines.push(`    then after the merge: ${recheckExecuteCommand({ consoleDir, pluginRoot, id: recheckId })}`);
    return lines;
  }
  const kind = pendingKindOf(item.resolution);
  if (kind) {
    const first = !printed.rerun;
    if (first) lines.push(`    re-run ${kind}: ${consoleRerunCommand({ consoleDir, pluginRoot })}`);
    printed.rerun = true;
    if (!printed.kinds.has(kind)) {
      printed.kinds.add(kind);
      const lead = first ? '' : 'same re-run; ';
      lines.push(kind === 'filing'
        ? `      (${lead}<issues.json>: gh issue list --state all --json number,body --limit <N>; <comments.json>: the materiality digest's comments; ${FILING_LOG_REMEDY})`
        : `      (${lead}<comments.json>: the materiality digest's comments; ${digestLogRemedy({ consoleDir, pluginRoot })})`);
    }
  }
  return lines;
}

// One header per run; `maxItems` caps item lines across the whole run, not
// per console. With several consoles each gets a `(relative path)` sub-line.
function formatResidueLines({ dir, consoles, missingOnly = [] }, { pluginRoot, maxItems = 5 }) {
  if (!consoles || consoles.length === 0) return [];
  const single = consoles.length === 1;
  const total = consoles.reduce((n, c) => n + c.items.length, 0);
  const lines = [`- ${path.basename(dir)}: ${total} item(s) no human has reviewed${single ? ` (${path.relative(dir, consoles[0].path)})` : ''}`];
  let count = 0;
  for (const c of consoles) {
    if (count >= maxItems) break;
    const consoleDir = path.dirname(c.path);
    if (!single) lines.push(`  (${path.relative(dir, c.path)})`);
    const printed = { rerun: false, kinds: new Set() };
    for (const item of c.items) {
      if (count >= maxItems) break;
      lines.push(...itemLines(item, consoleDir, pluginRoot, printed));
      count += 1;
    }
  }
  if (total > count) {
    lines.push(`  … and ${total - count} more — see "${single ? consoles[0].path : dir}"`);
  }
  const gone = [...consoles, ...missingOnly].flatMap((c) => {
    const stagedDir = path.join(path.dirname(c.path), 'staged');
    return (c.missing || []).map((m) => path.relative(dir, path.join(stagedDir, m.id)));
  });
  if (gone.length > 0) lines.push(`  not counted — staged file(s) no longer on disk: ${gone.join(', ')}`);
  lines.push(`  mark reviewed: node "${pluginRoot}/bin/console-residue.js" --ack --run "${dir}"`);
  return lines;
}

module.exports = {
  CONSOLE_FINDING_FP, UNRESOLVED_RESOLUTIONS, FAILED_OUTCOMES, MISSING_RESOLUTION, FILING_PENDING_RESOLUTION, DIGEST_PENDING_RESOLUTION, RECHECK_APPROVED_RESOLUTION, FILED_LINE_RE, DIGESTED_LINE_RE,
  FILING_LOG_REMEDY, digestLogRemedy, recheckStagedId, recheckApproveCommand, recheckExecuteCommand,
  filedRecords, digestedFindings, unresolvedItems, pendingFilings, pendingDigests, consoleResidueItems, splitMissing, consoleRerunCommand,
  readRunResidue, formatResidueLines,
};
