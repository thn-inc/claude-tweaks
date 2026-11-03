'use strict';

// Pure: the supervised trust table. Groups closed work records by
// (provenance x risk band) and tallies outcome signals per cell so a later
// phase can decide which classes of work have earned more autonomy. This
// module acts on nothing — it computes and returns rows for display only.
// Was docs/superpowers/plans/2026-08-07-supervised-trust-table.md — deleted (d83f0720).
const { resolveProvenance } = require('./provenance.js');
const { dispositionState, approvalProvenance } = require('./acceptance.js');
const { resolveValue } = require('../policy-schema.js');
const { hasNegativeEvidenceMarker } = require('./retry.js');

// At roughly ten closed records per class per month, eight is about a month
// of evidence — small enough to ever graduate, large enough that one lucky
// record cannot carry a cell. It is a starting value, deliberately
// conservative, and Phase 3 is where it earns or loses its keep.
const MIN_SAMPLES = 8;

// MIN_SAMPLES floors the cell; this floors the evidence *inside* it. The shipped
// rule asked only for one disposition, which on this repo's own data let a single
// approval grade a 40-record class 'clean' — 1 known outcome, 39 unknown. That was
// survivable while the table only rendered, because the counts sit beside the
// verdict and a human reads both. A governor reads the verdict alone.
//
// Five is the smallest run that is not an anecdote, and at roughly ten closed
// records per class per month it is reachable in weeks rather than quarters — the
// binding constraint on this number is that an unreachable floor makes the whole
// table decorative, which is the failure mode that already killed the `demo:pending` label.
const MIN_VERDICTS = 5;

// provenance.js's `unstructured` kind is not a trust class — it is that
// module's classifier saying "this record's Origin line could not be reduced
// to a class at all" (overflow past its length cap, or text that normalizes to
// nothing). A bucket whose only shared property is that nobody knows what is
// in it has no coherent class to earn trust *for*, so it is pinned to
// 'insufficient-evidence' at any sample count. Grading it would let Phase 3
// grant autonomy to an unclassifiable group the moment the bucket happened to
// cross MIN_SAMPLES — and it does accumulate: it is where every unrecognized
// Origin shape lands. Structurally ungradable, not merely short of evidence;
// `_shared/trust-table.md`'s Render section says so on the rendered row.
const UNGRADABLE_KIND = 'unstructured';

const RISK_LABEL_RE = /^risk:(.+)$/;

// Absence of a risk score is not evidence of safety — an unscored record
// bands as 'elevated', never 'low'. Conflicting evidence gets the same
// conservative default: any non-'low' risk label disqualifies 'low', even if
// a 'risk:low' label is also present. The taxonomy caps one risk label per
// record (record.js), so this defends an invariant rather than expecting a
// real violation — but the failure direction still matters, and 'elevated'
// is the safe one.
function riskBand(labels) {
  const names = Array.isArray(labels) ? labels : [];
  let sawLow = false;
  for (const name of names) {
    const match = RISK_LABEL_RE.exec(name);
    if (!match) continue;
    if (match[1] !== 'low') return 'elevated';
    sawLow = true;
  }
  return sawLow ? 'low' : 'elevated';
}

// A side-effect record's Origin line can name the record it descends from,
// e.g. "Origin: demo changes-requested from #7" (which of those descents count
// as follow-ups is decided below). Parsed BEFORE resolveProvenance normalizes
// the body — the normalizer strips exactly this trailing clause.
//
// Capture-then-normalize, same strategy as provenance.js's own ORIGIN_LINE +
// TRAILING_SOURCE pair: match the whole line first, then extract '#N' from
// the captured text, rather than hard-anchoring '#(\d+)' straight to the
// line's end. A single hard-anchored pattern breaks on any trailing
// punctuation after the digits (e.g. "from #7." never matches "from #7$"),
// which silently drops a real Origin-line variant and undercounts followUps
// — a negative signal, so undercounting it can falsely flip a cell's verdict
// from 'mixed' to 'clean'. Trailing punctuation is stripped before the '#N'
// match is attempted; the digits themselves are never touched, so '#71'
// still can never resolve to target 7.
const ORIGIN_LINE_RE = /^Origin:[ \t]*(.+?)[ \t]*$/m;
const TRAILING_PUNCTUATION_RE = /[.,;:)\]]+$/;
const FOLLOWUP_TAIL_RE = /\bfrom[ \t]+#(\d+)$/i;

// `Origin: ... from #N` is the shape of a record that names another record —
// but naming one is not the same as correcting it, and the rendered
// "Follow-ups" column means specifically "this work generated corrective
// work". Three `from #N` contexts are emitted today and only one is corrective:
//
//   demo changes-requested — a rejected verdict's linked gap record
//                            (`demo/SKILL.md` Step 3). Corrective; counts.
//   demo scope-fork        — new scope the human raised mid-demo.
//                            `demo/SKILL.md`'s scope-fork checkpoint states
//                            outright that this "isn't a changes-requested
//                            verdict, so it needs its own provenance marker" —
//                            the marker exists precisely so it is not read as
//                            a negative signal. Does not count.
//   wrap-up leftover       — routine carry-over of work a run could not finish
//                            (`wrap-up/leftover-routing.md`). Does not count.
//
// A denylist, not an allowlist, and deliberately so: undercounting follow-ups
// is the unsafe direction — a missed one flips a cell from 'mixed' to 'clean'
// — so a `from #N` context nobody has taught this module about is treated as
// corrective until it is listed here. Matched exactly rather than by prefix,
// for the same reason: a context carrying extra text is one this list does not
// actually describe, so it counts.
const NON_CORRECTIVE_ORIGINS = new Set(['demo scope-fork', 'wrap-up leftover']);

function correctiveFollowUpTarget(body) {
  const line = ORIGIN_LINE_RE.exec(typeof body === 'string' ? body : '');
  if (!line) return null;
  const trimmed = line[1].replace(TRAILING_PUNCTUATION_RE, '');
  const match = FOLLOWUP_TAIL_RE.exec(trimmed);
  if (!match) return null;
  const context = trimmed.slice(0, match.index).trim().toLowerCase();
  if (NON_CORRECTIVE_ORIGINS.has(context)) return null;
  return Number(match[1]);
}

// --- Operational outcome evidence (merged-and-unreverted) -----------------
//
// A closed record's outcome becomes known a second way, alongside demo-descent:
// merged and unreverted for at least `trust-revert-window-days` (default 14).
// Evaluated lazily at read time from record state + an injected git log — no
// scheduled job, no cached verdict file. An undiscoverable close stays
// unknown — never defaults to known-good or known-bad. That is the coverage
// boundary this module states about itself: a manual revert naming neither a
// `This reverts commit <sha>` trailer nor the record number is an
// out-of-scope false negative.
//
// A *discovered* revert is negative evidence (#268), not merely
// not-countable: it converts what would have been known-good into a
// known-bad outcome for the record's class, on the same lazy read — there is
// no stored verdict to invalidate, since nothing here is ever cached.
//
// Route 1 (a GitHub timeline `closed` event's commit reference) needs a
// per-issue GitHub API call this module cannot make itself — it is pure, no
// network. A caller that resolves it attaches the SHA(s) to the record as
// `closingCommitShas` before calling trustRows; discovery below prefers that
// signal outright when present. Route 2 (a commit-message scan for
// `(refs|closes|fixes) #N`, word-bounded) is load-bearing for this repo: its
// own convention writes `refs #N`, which creates no native GitHub close-link,
// so route 1 finds nothing here and route 2 is what actually resolves a
// closing commit.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_REVERT_WINDOW_DAYS = 14;
const CLOSING_REF_RE = /\b(?:refs|closes|fixes)\s+#(\d+)\b/gi;

const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';

// Raw `git log --format='%H%x1f%B%x1e'` output -> the `[{ sha, message }]`
// shape every gitLog-consuming function below expects. The separator bytes are
// ASCII unit/record separators, which practically never appear in real commit
// text, so a multi-line commit message can be neither mistaken for a SHA nor
// split across records.
//
// Exported because three skill snippets feed trustRows a git log
// (`_shared/trust-table.md`, `backlog/refine-mode.md`, `capture/SKILL.md`) and
// each carried its own verbatim copy of this parse. One copy means a parse fix
// lands once instead of three times, and means the three call sites cannot
// silently disagree about the same underlying evidence `[IL-32]`.
function parseGitLog(raw) {
  const text = typeof raw === 'string' ? raw : '';
  // `git log --format='...%x1e'` writes a newline after each record
  // separator, so every record but the first begins with a stray leading
  // `\n` once split — trim it off, or a closing commit's SHA never matches
  // a revert trailer naming the same (clean) SHA.
  return text
    .split(RECORD_SEP)
    .map((entry) => entry.trim())
    // Drops empty fragments, and — deliberately — any fragment carrying no
    // field separator at all (a truncated write, or an embedded
    // record-separator byte splitting one commit's message in two). Slicing
    // such a fragment into a fabricated "sha" is the fail-open hazard: no
    // real revert trailer could ever name that phantom, so a genuinely
    // reverted record could grade known-good.
    .filter((entry) => entry.includes(FIELD_SEP))
    .map((entry) => {
      const sep = entry.indexOf(FIELD_SEP);
      return { sha: entry.slice(0, sep), message: entry.slice(sep + 1) };
    });
}

// (record, gitLog) -> string[] of closing commit SHAs, [] when neither route
// finds anything. `gitLog` is `[{ sha, message }]` — the integration branch's
// full history, `sha` a full commit SHA and `message` the FULL commit message
// (subject + body), as `parseGitLog` above yields. Route 1 wins outright when
// present; it does not merge with route 2's results.
function discoverClosingCommits(record, gitLog) {
  const fromTimeline = Array.isArray(record && record.closingCommitShas)
    ? record.closingCommitShas.filter((sha) => typeof sha === 'string' && sha)
    : [];
  if (fromTimeline.length > 0) return fromTimeline;

  const log = Array.isArray(gitLog) ? gitLog : [];
  const recordNumber = record && record.number;
  const shas = [];
  for (const entry of log) {
    if (!entry || typeof entry.sha !== 'string' || typeof entry.message !== 'string') continue;
    for (const match of entry.message.matchAll(CLOSING_REF_RE)) {
      if (Number(match[1]) === recordNumber) {
        shas.push(entry.sha);
        break;
      }
    }
  }
  return shas;
}

const REVERT_TRAILER_RE = /This reverts commit ([0-9a-f]{7,40})/gi;
const REVERT_SUBJECT_RE = /^Revert\b/i;

// (closingShas, recordNumber, gitLog) -> boolean. All-or-nothing: any one
// reverted closing commit disqualifies the whole record (multi-commit
// records are conservative-direction, never partial credit). Two detectors,
// checked per log entry:
//   (a) a `This reverts commit <sha>` trailer naming one of closingShas —
//       matched by SHA prefix in either direction, since `git revert` writes
//       the full SHA but a caller-supplied timeline SHA might be shortened.
//   (b) a revert-shaped commit (subject starting `Revert`) whose message
//       also references the same record number — the fallback for
//       squash/rebase-rewritten SHAs, where the trailer's named SHA no
//       longer matches anything in the (rewritten) log (IL-45).
// A manual revert with neither signal is the module's own stated coverage
// boundary (see the header comment above discoverClosingCommits).
function isClosingCommitReverted(closingShas, recordNumber, gitLog) {
  const shas = Array.isArray(closingShas) ? closingShas.filter(Boolean) : [];
  if (shas.length === 0) return false;
  const lowerShas = shas.map((sha) => String(sha).toLowerCase());
  const log = Array.isArray(gitLog) ? gitLog : [];

  for (const entry of log) {
    if (!entry || typeof entry.message !== 'string') continue;

    for (const match of entry.message.matchAll(REVERT_TRAILER_RE)) {
      const named = match[1].toLowerCase();
      if (lowerShas.some((sha) => sha.startsWith(named) || named.startsWith(sha))) return true;
    }

    const subject = entry.message.split('\n', 1)[0] || '';
    if (REVERT_SUBJECT_RE.test(subject)) {
      for (const match of entry.message.matchAll(CLOSING_REF_RE)) {
        if (Number(match[1]) === recordNumber) return true;
      }
    }
  }
  return false;
}

// (record, gitLog, now, windowDays) ->
//   { known: false }
//   | { known: true, grade: 'good', source: 'operational' }
//   | { known: true, grade: 'bad', source: 'revert' }
// `now` is epoch milliseconds (the injected clock). The window anchors on
// the record's tracker `closedAt` — never a git commit date or a PR
// `merged_at` (this repo's squash/rebase conventions rewrite commit dates,
// and a direct-push close has no PR at all). `closedAt` on a currently-CLOSED
// record is GitHub's own latest-close timestamp — a record reopened and
// re-closed is evaluated against that latest close with no extra bookkeeping
// here; a record that is currently OPEN never needs to reach this function
// meaningfully, since trustRows only builds cells from records whose `state`
// is `'CLOSED'` in the first place.
//
// The revert branch (#268) only fires once the record has already cleared
// the revert window and a closing commit was discovered — a young or
// undiscoverable close still returns `{ known: false }` regardless of any
// revert entry in the log, exactly as before. Only a *discovered* revert on
// an otherwise-known-good record becomes negative evidence.
function resolveOperationalOutcome(record, gitLog, now, windowDays) {
  if (!record || record.state !== 'CLOSED') return { known: false };
  const closedAtMs = typeof record.closedAt === 'string' ? Date.parse(record.closedAt) : NaN;
  if (!Number.isFinite(closedAtMs)) return { known: false };

  const ageDays = (now - closedAtMs) / MS_PER_DAY;
  if (ageDays < windowDays) return { known: false };

  const closingShas = discoverClosingCommits(record, gitLog);
  if (closingShas.length === 0) return { known: false };

  if (isClosingCommitReverted(closingShas, record.number, gitLog)) {
    return { known: true, grade: 'bad', source: 'revert' };
  }

  return { known: true, grade: 'good', source: 'operational' };
}

// raw policy['trust-revert-window-days'] -> a validated integer >= 1.
// Malformed-value coercion is owned centrally by bin/lib/policy-schema.js —
// this is the one place trust.js asks it, and the caller of this function
// (trustRows, below) trusts what comes back without re-checking it.
function resolveRevertWindowDays(policy) {
  const raw = policy && policy['trust-revert-window-days'];
  return resolveValue('trust-revert-window-days', raw);
}

function trustRows(records, gitLog, now, policy) {
  const all = Array.isArray(records) ? records : [];
  const clock = Number.isFinite(now) ? now : Date.now();
  const windowDays = resolveRevertWindowDays(policy);
  // A decomposed sub-issue is not independently graded work — its parent issue
  // carries the one verdict. Counting sub-issues here would let `total >= 8` be
  // satisfied by records nobody judged.
  const closed = all.filter((r) => r && r.state === 'CLOSED' && r.hasParent !== true);

  // Build cells from closed records only. Key on kind:source (never source
  // alone — see provenance.js) plus the risk band, joined with '|'.
  const cells = new Map();
  const cellByNumber = new Map();

  for (const record of closed) {
    const { kind, source } = resolveProvenance({ labels: record.labels, body: record.body });
    const band = riskBand(record.labels);
    const key = `${kind}:${source}|${band}`;

    let cell = cells.get(key);
    if (!cell) {
      cell = {
        key,
        kind,
        provenance: `${kind}:${source}`,
        band,
        total: 0,
        approved: 0,
        // Of `approved` above, the subset whose approved-batch marker (either
        // label spelling) says the verdict came from a #N,#M batch invocation rather than a
        // per-record walkthrough (acceptance.js's `approvalProvenance`).
        // Always <= approved; never its own disposition.
        approvedBatch: 0,
        changesRequested: 0,
        operationalGood: 0,
        negativeEvidence: 0,
        undispositioned: 0,
        notPlanned: 0,
        followUps: 0,
      };
      cells.set(key, cell);
    }

    cell.total += 1;
    if (record.stateReason === 'NOT_PLANNED') cell.notPlanned += 1;

    const disposition = dispositionState(record.labels);
    if (disposition === 'approved') {
      cell.approved += 1;
      if (approvalProvenance(record.labels) === 'batch') cell.approvedBatch += 1;
    } else if (disposition === 'changes-requested') {
      cell.changesRequested += 1;
    } else if (disposition === 'none') {
      // No acceptance disposition at all — try the operational path, then the
      // failure-classification marker, before giving up. Scoped to 'none'
      // deliberately, symmetric with the pre-existing operational branch: a
      // record already carrying a definitive acceptance verdict (approved,
      // changes-requested, or pending below) keeps that verdict as its own
      // disposition — an earlier failed attempt on the way to an eventual
      // approval is not read as contradicting that approval.
      const operational = resolveOperationalOutcome(record, gitLog, clock, windowDays);
      if (operational.known && operational.grade === 'good') {
        cell.operationalGood += 1;
      } else if (operational.known && operational.grade === 'bad') {
        // A discovered revert (#268) — negative evidence, not "undiscoverable".
        cell.negativeEvidence += 1;
      } else if (hasNegativeEvidenceMarker(record.comments)) {
        // A correctness/ambiguous-classified failed attempt somewhere in this
        // record's history (dispatch's Settle step, see settle-and-merge.md
        // Step 6.5) — negative evidence for the record's class even though
        // the record itself eventually closed with no acceptance disposition.
        cell.negativeEvidence += 1;
      } else {
        cell.undispositioned += 1;
      }
    } else {
      // 'pending' — an outstanding, unresolved human-review request. It IS an
      // acceptance disposition, so it must never reach the operational path above
      // and be silently promoted to known-good just because a human hasn't
      // gotten to acceptance yet. Any unrecognized state lands here too, undispositioned.
      cell.undispositioned += 1;
    }

    cellByNumber.set(record.number, cell);
  }

  // Open records are still scanned for follow-up Origin references — an open
  // follow-up is evidence about the closed record it names, even though the
  // follow-up itself never forms a cell of its own.
  for (const record of all) {
    const target = correctiveFollowUpTarget(record.body);
    if (target === null) continue;
    const cell = cellByNumber.get(target);
    if (cell) cell.followUps += 1;
  }

  const rows = Array.from(cells.values()).map((cell) => {
    // negativeEvidence counts toward dispositioned like every other real
    // outcome signal — a known-bad record is not "unknown", so folding it
    // into undispositioned instead would understate coverage in the safe
    // direction's opposite (a class with real negative history would read as
    // less-observed than it is, when the honest read is the reverse).
    const dispositioned = cell.approved + cell.changesRequested + cell.operationalGood + cell.negativeEvidence;
    const coverage = cell.total === 0 ? 0 : dispositioned / cell.total;
    // True when every positive-evidence signal in this cell is a batch-sourced
    // approval — no walkthrough-backed approval and no operational corroboration
    // (resolveOperationalOutcome above) backs it. A batch sign-off is legitimate
    // (#365's originating finding), but it is not itself the human verification
    // this table exists to grade autonomy on, so a cell resting entirely on it
    // does not earn 'clean' — see the verdict computation below.
    const batchOnly = cell.approved > 0 && cell.approvedBatch === cell.approved && cell.operationalGood === 0;
    let verdict = 'insufficient-evidence';
    if (
      cell.kind !== UNGRADABLE_KIND &&
      cell.total >= MIN_SAMPLES &&
      dispositioned >= MIN_VERDICTS
    ) {
      // notPlanned is deliberately absent. A record closed NOT_PLANNED was
      // declined — no work product was ever produced for this class to be judged
      // on — so reading it as a quality failure is a category error. It was also
      // an unrecoverable one: this table has no time window, so the single
      // NOT_PLANNED in this repo's `human:human|elevated` cell and the three in
      // `producer:capture|elevated` would have pinned both to 'mixed' forever,
      // whatever evidence arrived afterward. It stays counted and stays rendered
      // — it says something real about a class's filing precision — but it is not
      // a verdict input.
      //
      // negativeEvidence (#268) is a precedence rule layered on top of this
      // same clean/mixed split, not a reuse of the changesRequested/followUps
      // check it sits beside: a correctness/ambiguous-classified failure or a
      // discovered revert pins the verdict below 'clean' regardless of how
      // many positive (approved/operationalGood) outcomes the cell also
      // holds — one known-bad outcome in the sample is disqualifying, full
      // stop, the same as one changes-requested already was.
      const clean = cell.changesRequested === 0 && cell.followUps === 0 && cell.negativeEvidence === 0 && !batchOnly;
      verdict = clean ? 'clean' : 'mixed';
    }
    return { ...cell, dispositioned, coverage, batchOnly, verdict };
  });

  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows;
}

module.exports = {
  riskBand, trustRows, MIN_SAMPLES, MIN_VERDICTS, DEFAULT_REVERT_WINDOW_DAYS,
  parseGitLog, discoverClosingCommits, isClosingCommitReverted, resolveOperationalOutcome,
};
