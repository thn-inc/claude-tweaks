// bin/lib/wrap-up/render.js — render the wrap-up State block.
//
// Every line is emitted even when its value is unknown. Omitting a line makes an
// unknown fact indistinguishable from an absent one, which is the failure this
// block exists to prevent.
'use strict';

const UNKNOWN = 'unknown';
const PAD = 10;

function field(label, value) {
  return `${label.padEnd(PAD)}${value}`;
}

function branchValue(s) {
  if (!s || !s.isRepo) return UNKNOWN;
  // Detached HEAD takes the same commits + push suffix as a branch: it is the
  // state where commits are reachable from no ref at all, so it is the LAST
  // place to omit how many there are and whether they left the machine.
  const head = s.branch ? s.branch : (s.detachedAt ? `detached at ${s.detachedAt}` : null);
  if (!head) return UNKNOWN;
  const n = s.commitsInScope;
  const commits = n === null || n === undefined ? `${UNKNOWN} commits` : `${n} commit${n === 1 ? '' : 's'}`;

  // pushedVia === 'remote-ref': judged from the branch's own
  // origin/{branch} remote-tracking ref rather than a configured upstream
  // (no upstream configured at all, or one configured but naming something
  // else — the #1860 inherited-upstream shape). Keyed on the exact string
  // 'remote-ref' rather than truthiness so a hand-built state object that
  // predates this field (no `pushedVia` at all) falls through to the
  // upstream-keyed rendering below, unchanged.
  if (s.pushedVia === 'remote-ref') {
    // pushed is boolean|null: null means the remote-tracking ref resolved
    // but the ahead/behind read failed, so the push state was never
    // measured. Say so — printing UNPUSHED here would claim a definite
    // false for an unknown.
    if (s.pushed === null) return `${head} — ${commits}, push status unknown (${s.remoteRef})`;
    return s.pushed
      ? `${head} — ${commits}, pushed (${s.remoteRef}; no upstream configured)`
      : `${head} — ${commits}, UNPUSHED (${s.remoteRef}; no upstream configured)`;
  }

  // pushedVia === null (not merely absent) means readState actually probed
  // both refs and found neither: no configured upstream AND no
  // origin/{branch} remote-tracking ref. Distinguishable from a legacy
  // "no upstream" fixture, which never sets pushedVia at all (undefined).
  if (s.pushedVia === null && !s.upstream && s.branch) {
    return `${head} — ${commits}, UNPUSHED (no upstream, origin/${s.branch} absent)`;
  }

  if (!s.upstream) return `${head} — ${commits}, UNPUSHED (no upstream)`;
  // pushed is boolean|null: null means the upstream resolved but the
  // ahead/behind read failed, so the push state was never measured. Say so —
  // printing UNPUSHED here would claim a definite false for an unknown.
  if (s.pushed === null) return `${head} — ${commits}, push status unknown (${s.upstream})`;
  return s.pushed
    ? `${head} — ${commits}, pushed to ${s.upstream}`
    : `${head} — ${commits}, UNPUSHED (${s.upstream})`;
}

function renderState({ state, ops, since, sinceDate } = {}) {
  const lines = [
    field('Branch', branchValue(state)),
    field('Worktree', state && state.isRepo ? (state.linkedWorktree ? 'linked worktree' : 'main checkout') : UNKNOWN),
    field('Scope', since ? `since ${since} (${sinceDate || UNKNOWN})` : UNKNOWN),
  ];
  const list = Array.isArray(ops) ? ops : [];
  if (list.length) {
    lines.push('');
    lines.push(`History ops in window (${list.length})`);
    for (const o of list) lines.push(`  ${String(o.op).padEnd(12)}${o.sha}  ${o.date}  ${o.message || ''}`);
  }
  return lines.join('\n');
}

module.exports = { renderState };
