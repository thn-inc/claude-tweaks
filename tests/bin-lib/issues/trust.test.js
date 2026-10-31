'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  riskBand, trustRows, MIN_SAMPLES, MIN_VERDICTS, parseGitLog, discoverClosingCommits,
  isClosingCommitReverted, resolveOperationalOutcome, DEFAULT_REVERT_WINDOW_DAYS,
} = require('../../../plugin/bin/lib/issues/trust.js');
const { attemptFailedCommentBody } = require('../../../plugin/bin/lib/issues/retry.js');

test('riskBand splits low from everything else', () => {
  assert.equal(riskBand(['risk:low']), 'low');
  assert.equal(riskBand(['risk:medium']), 'elevated');
  assert.equal(riskBand(['risk:high']), 'elevated');
});

test('an unscored record is elevated, never low', () => {
  // Absence of a score is not evidence of safety.
  assert.equal(riskBand([]), 'elevated');
  assert.equal(riskBand(undefined), 'elevated');
});

test('conflicting risk labels resolve to elevated, not low', () => {
  // Conflicting evidence gets the same conservative default as absent evidence.
  assert.equal(riskBand(['risk:low', 'risk:high']), 'elevated');
  assert.equal(riskBand(['risk:high', 'risk:low']), 'elevated');
});

test('rows key on provenance and band together', () => {
  const rows = trustRows([
    { number: 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
    { number: 2, labels: ['by:capture', 'risk:high', 'demo:approved'], body: '', state: 'CLOSED' },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.key).sort(), ['producer:capture|elevated', 'producer:capture|low']);
});

test('approved and changes-requested are tallied separately', () => {
  const rows = trustRows([
    { number: 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
    { number: 2, labels: ['by:capture', 'risk:low', 'demo:changes-requested'], body: '', state: 'CLOSED' },
  ]);
  assert.equal(rows[0].approved, 1);
  assert.equal(rows[0].changesRequested, 1);
});

test('an undispositioned record counts as unknown, never as success', () => {
  const rows = trustRows([
    { number: 1, labels: ['by:capture', 'risk:low'], body: '', state: 'CLOSED' },
  ]);
  assert.equal(rows[0].undispositioned, 1);
  assert.equal(rows[0].approved, 0);
  assert.equal(rows[0].verdict, 'insufficient-evidence');
});

test('a cell with many records but no verdicts is still insufficient evidence', () => {
  const many = Array.from({ length: MIN_SAMPLES + 10 }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low'], body: '', state: 'CLOSED',
  }));
  const rows = trustRows(many);
  assert.equal(rows[0].total, MIN_SAMPLES + 10);
  assert.equal(rows[0].verdict, 'insufficient-evidence');
});

test('a follow-up record counts against the record it names', () => {
  const rows = trustRows([
    { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
    { number: 8, labels: [], body: 'Origin: demo changes-requested from #7', state: 'OPEN' },
  ]);
  const capture = rows.find((r) => r.key === 'producer:capture|low');
  assert.equal(capture.followUps, 1);
});

test('a follow-up record still counts despite trailing punctuation after #N', () => {
  for (const suffix of ['.', ',', ')']) {
    const rows = trustRows([
      { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
      { number: 8, labels: [], body: `Origin: demo changes-requested from #7${suffix}`, state: 'OPEN' },
    ]);
    const capture = rows.find((r) => r.key === 'producer:capture|low');
    assert.equal(capture.followUps, 1, `suffix ${JSON.stringify(suffix)} should still count`);
  }
});

test('a follow-up reference to #71 counts against #71, not #7', () => {
  const rows = trustRows([
    { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
    { number: 71, labels: ['by:docs-health', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
    { number: 8, labels: [], body: 'Origin: demo changes-requested from #71', state: 'OPEN' },
  ]);
  const capture = rows.find((r) => r.key === 'producer:capture|low');
  const docsHealth = rows.find((r) => r.key === 'producer:docs-health|low');
  assert.equal(capture.followUps, 0);
  assert.equal(docsHealth.followUps, 1);
});

test('only corrective Origin markers count as follow-ups', () => {
  // The Follow-ups column means "this work generated corrective work". Of the
  // three `... from #N` markers emitted today, only changes-requested is that.
  const cases = [
    ['demo changes-requested', 1],
    ['demo scope-fork', 0],
    ['wrap-up leftover', 0],
  ];
  for (const [context, expected] of cases) {
    const rows = trustRows([
      { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
      { number: 8, labels: [], body: `Origin: ${context} from #7`, state: 'OPEN' },
    ]);
    const capture = rows.find((r) => r.key === 'producer:capture|low');
    assert.equal(capture.followUps, expected, `"${context}" should contribute ${expected}`);
  }
});

test('a scope-fork alone leaves a cell clean; a changes-requested does not', () => {
  // The verdict consequence of the rule above: one miscounted scope-fork is
  // enough to force a whole cell from 'clean' to 'mixed'.
  const closed = Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED',
  }));
  const scopeFork = trustRows([
    ...closed,
    { number: 100, labels: [], body: 'Origin: demo scope-fork from #1', state: 'OPEN' },
  ]);
  assert.equal(scopeFork[0].verdict, 'clean');

  const changesRequested = trustRows([
    ...closed,
    { number: 100, labels: [], body: 'Origin: demo changes-requested from #1', state: 'OPEN' },
  ]);
  assert.equal(changesRequested[0].verdict, 'mixed');
});

test('an unrecognized "from #N" context still counts as a follow-up', () => {
  // Denylist, not allowlist: undercounting follow-ups flips a cell from
  // 'mixed' to 'clean', so an unknown marker is treated as corrective.
  const rows = trustRows([
    { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
    { number: 8, labels: [], body: 'Origin: some future corrective flow from #7', state: 'OPEN' },
  ]);
  assert.equal(rows.find((r) => r.key === 'producer:capture|low').followUps, 1);
});

test('the unstructured cell is ungradable at any sample count', () => {
  // A bucket defined by "these records could not be classified" has no
  // coherent class to earn trust for. Well past MIN_SAMPLES, fully
  // dispositioned, and clean on every negative signal — still ungradable.
  const overlong = 'Origin: ' + 'x'.repeat(80);
  const many = Array.from({ length: MIN_SAMPLES + 4 }, (_, i) => ({
    number: i + 1, labels: ['risk:low', 'demo:approved'], body: overlong, state: 'CLOSED',
  }));
  const rows = trustRows(many);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provenance, 'unstructured:unstructured');
  assert.equal(rows[0].total, MIN_SAMPLES + 4);
  assert.equal(rows[0].approved, MIN_SAMPLES + 4);
  assert.equal(rows[0].changesRequested, 0);
  assert.equal(rows[0].followUps, 0);
  assert.equal(rows[0].notPlanned, 0);
  assert.equal(rows[0].verdict, 'insufficient-evidence');
});

test('an identically-shaped classified cell does grade — the pin is the kind, not the shape', () => {
  // Control for the test above: same counts, same signals, real provenance.
  // Without this, "insufficient-evidence" could be coming from anything.
  const many = Array.from({ length: MIN_SAMPLES + 4 }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED',
  }));
  assert.equal(trustRows(many)[0].verdict, 'clean');
});

test('the empty-origin cell is ungradable too — same kind, same pin', () => {
  const many = Array.from({ length: MIN_SAMPLES + 4 }, (_, i) => ({
    number: i + 1, labels: ['risk:low', 'demo:approved'], body: 'Origin: .', state: 'CLOSED',
  }));
  const rows = trustRows(many);
  assert.equal(rows[0].provenance, 'unstructured:empty-origin');
  assert.equal(rows[0].verdict, 'insufficient-evidence');
});

test('NOT_PLANNED is tallied as its own negative-ish signal', () => {
  const rows = trustRows([
    { number: 1, labels: ['by:capture', 'risk:low'], body: '', state: 'CLOSED', stateReason: 'NOT_PLANNED' },
  ]);
  assert.equal(rows[0].notPlanned, 1);
});

test('open records are excluded — trust is about outcomes', () => {
  const rows = trustRows([
    { number: 1, labels: ['by:capture', 'risk:low'], body: '', state: 'OPEN' },
  ]);
  assert.equal(rows.length, 0);
});

test('parent-linked sub-issues do not count toward a cell reaching MIN_SAMPLES', () => {
  // Seven un-dispositioned sub-issues plus one approved parent must not grade a cell
  // `clean` — the sub-issues were never judged, and total is what makes 8 mean 8.
  const subIssues = Array.from({ length: 7 }, (_, i) => ({
    number: i + 1, state: 'CLOSED', labels: [], body: '', hasParent: true,
  }));
  const parent = { number: 99, state: 'CLOSED', labels: ['demo:approved'], body: '' };
  const rows = trustRows([...subIssues, parent]);
  assert.equal(rows.every((r) => r.total < MIN_SAMPLES), true);
  assert.equal(rows.every((r) => r.verdict === 'insufficient-evidence'), true);
});

test('rows are returned in a stable order', () => {
  const input = [
    { number: 1, labels: ['by:docs-health', 'risk:low'], body: '', state: 'CLOSED' },
    { number: 2, labels: ['by:capture', 'risk:low'], body: '', state: 'CLOSED' },
  ];
  assert.deepEqual(trustRows(input).map((r) => r.key), trustRows(input.reverse()).map((r) => r.key));
});

test('one verdict cannot grade a class of forty', () => {
  // The shipped rule was `dispositioned >= 1`. Measured against this repo, that
  // let a single approval grade a 40-record cell 'clean' — 1 known, 39 unknown.
  // Harmless while the table only rendered; a live grant once a governor reads it.
  const records = Array.from({ length: 40 }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low'], body: '', state: 'CLOSED',
  }));
  records[0].labels = ['by:capture', 'risk:low', 'demo:approved'];
  const row = trustRows(records)[0];
  assert.equal(row.total, 40);
  assert.equal(row.dispositioned, 1);
  assert.equal(row.verdict, 'insufficient-evidence');
});

test('the verdict floor is MIN_VERDICTS, and it is a floor on verdicts not records', () => {
  const build = (approvals) => {
    const records = Array.from({ length: 40 }, (_, i) => ({
      number: i + 1, labels: ['by:capture', 'risk:low'], body: '', state: 'CLOSED',
    }));
    for (let i = 0; i < approvals; i += 1) {
      records[i].labels = ['by:capture', 'risk:low', 'demo:approved'];
    }
    return trustRows(records)[0];
  };
  assert.equal(build(MIN_VERDICTS - 1).verdict, 'insufficient-evidence');
  assert.equal(build(MIN_VERDICTS).verdict, 'clean');
});

test('sample floor and verdict floor are both required', () => {
  // MIN_VERDICTS verdicts in a cell too small to be a class yet: still ungraded.
  const records = Array.from({ length: MIN_VERDICTS }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED',
  }));
  const row = trustRows(records)[0];
  assert.ok(row.total < MIN_SAMPLES, 'fixture must sit below the sample floor');
  assert.equal(row.dispositioned, MIN_VERDICTS);
  assert.equal(row.verdict, 'insufficient-evidence');
});

test('a declined record is not a quality failure and never blocks a verdict', () => {
  // NOT_PLANNED means the record was declined — no work product exists to judge.
  // Counting it as a negative made two of this repo's four real cells
  // permanently ungradable, since the table has no time window to age it out.
  const records = Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED',
  }));
  records.push({
    number: 99, labels: ['by:capture', 'risk:low'], body: '',
    state: 'CLOSED', stateReason: 'NOT_PLANNED',
  });
  const row = trustRows(records)[0];
  assert.equal(row.notPlanned, 1, 'still counted and still rendered');
  assert.equal(row.verdict, 'clean', 'but not a verdict input');
});

test('changes-requested and follow-ups remain verdict inputs', () => {
  // Control for the test above: removing notPlanned from the clean test must not
  // remove the two signals that ARE about work quality.
  const base = () => Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED',
  }));

  const rejected = base();
  rejected[0].labels = ['by:capture', 'risk:low', 'demo:changes-requested'];
  assert.equal(trustRows(rejected)[0].verdict, 'mixed');

  const followedUp = [...base(), { number: 100, labels: [], body: 'Origin: demo changes-requested from #1', state: 'OPEN' }];
  assert.equal(trustRows(followedUp)[0].verdict, 'mixed');
});

test('coverage is reported and is dispositioned over total', () => {
  const records = Array.from({ length: 10 }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low'], body: '', state: 'CLOSED',
  }));
  for (let i = 0; i < 5; i += 1) records[i].labels = ['by:capture', 'risk:low', 'demo:approved'];
  const row = trustRows(records)[0];
  assert.equal(row.dispositioned, 5);
  assert.equal(row.coverage, 0.5);
});

test('an unstructured cell stays ungradable however many verdicts it collects', () => {
  // Task 2 denies this kind independently; this asserts the pin still holds
  // after the floor change, so the two defenses stay genuinely independent.
  const overlong = 'Origin: ' + 'x'.repeat(80);
  const records = Array.from({ length: MIN_SAMPLES + MIN_VERDICTS }, (_, i) => ({
    number: i + 1, labels: ['risk:low', 'demo:approved'], body: overlong, state: 'CLOSED',
  }));
  const row = trustRows(records)[0];
  assert.equal(row.provenance, 'unstructured:unstructured');
  assert.ok(row.dispositioned >= MIN_VERDICTS);
  assert.equal(row.verdict, 'insufficient-evidence');
});

const MS_PER_DAY_FIXTURE = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-09T00:00:00Z');

function closedDaysAgo(days) {
  return new Date(NOW - days * MS_PER_DAY_FIXTURE).toISOString();
}

test('DEFAULT_REVERT_WINDOW_DAYS is 14', () => {
  assert.equal(DEFAULT_REVERT_WINDOW_DAYS, 14);
});

test('resolveOperationalOutcome is unknown for a currently-open record', () => {
  // Non-empty, matching gitLog — an empty log would make this pass whether
  // or not the state guard actually fired (discoverClosingCommits finds
  // nothing either way), which is exactly the confounding this fixture avoids.
  const record = { number: 1, state: 'OPEN', closedAt: closedDaysAgo(30) };
  const gitLog = [commitFor(1)];
  assert.deepEqual(resolveOperationalOutcome(record, gitLog, NOW, 14), { known: false });
});

test('resolveOperationalOutcome is unknown with no closedAt at all', () => {
  // Non-empty, matching gitLog — see the state-guard test above for why an
  // empty log can't discriminate whether the closedAt guard actually fired.
  const record = { number: 1, state: 'CLOSED' };
  const gitLog = [commitFor(1)];
  assert.deepEqual(resolveOperationalOutcome(record, gitLog, NOW, 14), { known: false });
});

test('resolveOperationalOutcome counts a merge past the window with a discoverable, unreverted closing commit', () => {
  const record = { number: 1, state: 'CLOSED', closedAt: closedDaysAgo(15) };
  const gitLog = [{ sha: 'sha-1', message: 'refs #1' }];
  assert.deepEqual(
    resolveOperationalOutcome(record, gitLog, NOW, 14),
    { known: true, grade: 'good', source: 'operational' },
  );
});

test('the window boundary is inclusive at exactly the configured number of days', () => {
  const record = { number: 1, state: 'CLOSED', closedAt: closedDaysAgo(14) };
  const gitLog = [{ sha: 'sha-1', message: 'refs #1' }];
  assert.equal(resolveOperationalOutcome(record, gitLog, NOW, 14).known, true);
});

test('one day short of the window boundary does not count', () => {
  const record = { number: 1, state: 'CLOSED', closedAt: closedDaysAgo(13) };
  const gitLog = [{ sha: 'sha-1', message: 'refs #1' }];
  assert.equal(resolveOperationalOutcome(record, gitLog, NOW, 14).known, false);
});

test('resolveOperationalOutcome is unknown with no discoverable closing commit', () => {
  const record = { number: 1, state: 'CLOSED', closedAt: closedDaysAgo(30) };
  assert.deepEqual(resolveOperationalOutcome(record, [], NOW, 14), { known: false });
});

test('resolveOperationalOutcome grades a discovered revert as negative evidence, not merely not-countable (#268)', () => {
  const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const record = { number: 1, state: 'CLOSED', closedAt: closedDaysAgo(30) };
  const gitLog = [
    { sha, message: 'refs #1' },
    { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', message: `This reverts commit ${sha}.` },
  ];
  assert.deepEqual(
    resolveOperationalOutcome(record, gitLog, NOW, 14),
    { known: true, grade: 'bad', source: 'revert' },
  );
});

test('resolveOperationalOutcome respects a widened window passed in explicitly', () => {
  const record = { number: 1, state: 'CLOSED', closedAt: closedDaysAgo(15) };
  const gitLog = [{ sha: 'sha-1', message: 'refs #1' }];
  assert.equal(resolveOperationalOutcome(record, gitLog, NOW, 21).known, false, '15 days is short of a 21-day window');
});

test('parseGitLog splits a %H\\x1f%B\\x1e dump into { sha, message } records', () => {
  const raw = 'aaaa\x1fFix the thing\n\nrefs #42\x1ebbbb\x1fUnrelated\x1e';
  assert.deepEqual(parseGitLog(raw), [
    { sha: 'aaaa', message: 'Fix the thing\n\nrefs #42' },
    { sha: 'bbbb', message: 'Unrelated' },
  ]);
});

test('parseGitLog keeps a multi-line body whole rather than splitting it into records', () => {
  // The record separator is what bounds a commit — a blank line inside a body
  // must not start a new one, or a trailer would be attributed to the wrong SHA.
  const [entry] = parseGitLog('aaaa\x1fSubject\n\nBody line\n\nThis reverts commit bbbb.\x1e');
  assert.equal(entry.sha, 'aaaa');
  assert.ok(entry.message.includes('This reverts commit bbbb.'));
});

test('parseGitLog returns [] for empty or non-string input', () => {
  assert.deepEqual(parseGitLog(''), []);
  assert.deepEqual(parseGitLog(undefined), []);
  assert.deepEqual(parseGitLog(null), []);
});

test('regression: parseGitLog drops a fragment with no field separator instead of fabricating a garbage sha', () => {
  // A truncated write, or a commit message containing a literal embedded
  // record-separator byte, can leave a fragment with no \x1f at all. Slicing
  // it into a fake "sha" would fabricate a closing-commit candidate no real
  // revert trailer can ever match — fail-open against this module's own
  // stated guarantee. Dropping the fragment is the fail-closed behavior.
  assert.deepEqual(parseGitLog('aaaabbbb'), []);
  assert.deepEqual(parseGitLog('good\x1fSubject\x1ejunk-with-no-separator\x1e'), [
    { sha: 'good', message: 'Subject' },
  ]);
  // A well-formed record after a malformed one is still parsed correctly.
  assert.deepEqual(parseGitLog('nofieldsep\x1egood\x1fSubject\x1e'), [
    { sha: 'good', message: 'Subject' },
  ]);
});

test('parseGitLog strips the leading newline git log actually writes after each %x1e record separator', () => {
  // `git log --format='%H%x1f%B%x1e'` emits a literal newline immediately
  // after every %x1e byte — so every record but the first begins with "\n"
  // once split on the separator. A hand-built fixture without that newline
  // (as every other test in this file uses) can't catch a regression here;
  // this fixture reproduces the real byte shape git actually writes.
  const raw = 'aaaa\x1fFirst\x1e\nbbbb\x1fSecond\x1e\ncccc\x1fThird\x1e\n';
  assert.deepEqual(parseGitLog(raw), [
    { sha: 'aaaa', message: 'First' },
    { sha: 'bbbb', message: 'Second' },
    { sha: 'cccc', message: 'Third' },
  ]);
});

test('regression: a trailer-based revert is still detected end-to-end against real git-log byte shape (leading newline present)', () => {
  // Reproduces the actual bug through the FULL real pipeline
  // (parseGitLog -> discoverClosingCommits -> isClosingCommitReverted), not
  // a hand-typed clean SHA — the corruption is on the closing commit's own
  // parsed `sha` field, which only discoverClosingCommits produces. Without
  // the trim in parseGitLog, that closing record is the SECOND record in the
  // log (leading "\n" on its sha), so it never matches the clean sha the
  // revert trailer names — the primary (trailer) detector silently went
  // inert for every record but the first in a real log. Full-length SHAs are
  // required: REVERT_TRAILER_RE only matches 7-40 hex chars.
  const closingSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const revertSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const raw = `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\x1frefs #999\x1e\n`
    + `${closingSha}\x1frefs #1\x1e\n`
    + `${revertSha}\x1fThis reverts commit ${closingSha}.\x1e\n`;
  const gitLog = parseGitLog(raw);
  const record = { number: 1, closedAt: '2026-01-01T00:00:00Z', state: 'CLOSED' };
  const closingShas = discoverClosingCommits(record, gitLog);
  assert.deepEqual(closingShas, [closingSha], 'discoverClosingCommits must return the clean sha, not a newline-corrupted one');
  assert.equal(isClosingCommitReverted(closingShas, 1, gitLog), true);
});

test('discoverClosingCommits finds a commit via a word-bounded refs/closes/fixes scan', () => {
  const gitLog = [
    { sha: 'aaaa1111111111111111111111111111111111', message: 'Fix the thing\n\nrefs #42' },
    { sha: 'bbbb2222222222222222222222222222222222', message: 'unrelated commit' },
  ];
  assert.deepEqual(discoverClosingCommits({ number: 42 }, gitLog), ['aaaa1111111111111111111111111111111111']);
});

test('discoverClosingCommits recognizes closes and fixes, not just refs', () => {
  assert.deepEqual(discoverClosingCommits({ number: 7 }, [{ sha: 'sha-a', message: 'closes #7' }]), ['sha-a']);
  assert.deepEqual(discoverClosingCommits({ number: 7 }, [{ sha: 'sha-b', message: 'Fixes #7' }]), ['sha-b']);
});

test('discoverClosingCommits is word-bounded — #427 never matches record #42', () => {
  assert.deepEqual(discoverClosingCommits({ number: 42 }, [{ sha: 'sha-x', message: 'refs #427' }]), []);
});

test('discoverClosingCommits returns every commit that references the record, not just the first', () => {
  const gitLog = [
    { sha: 'sha-1', message: 'refs #9' },
    { sha: 'sha-2', message: 'unrelated' },
    { sha: 'sha-3', message: 'closes #9' },
  ];
  assert.deepEqual(discoverClosingCommits({ number: 9 }, gitLog), ['sha-1', 'sha-3']);
});

test('discoverClosingCommits returns [] when nothing references the record', () => {
  assert.deepEqual(discoverClosingCommits({ number: 1 }, [{ sha: 'sha-1', message: 'refs #999' }]), []);
});

test('discoverClosingCommits returns [] for an empty or missing git log', () => {
  assert.deepEqual(discoverClosingCommits({ number: 1 }, []), []);
  assert.deepEqual(discoverClosingCommits({ number: 1 }, undefined), []);
});

test('discoverClosingCommits prefers a caller-supplied timeline SHA over the git-log scan (route 1 over route 2)', () => {
  const gitLog = [{ sha: 'from-log', message: 'refs #5' }];
  const record = { number: 5, closingCommitShas: ['from-timeline'] };
  assert.deepEqual(discoverClosingCommits(record, gitLog), ['from-timeline']);
});

test('discoverClosingCommits ignores a closingCommitShas array of falsy/empty entries and falls through to route 2', () => {
  const gitLog = [{ sha: 'from-log', message: 'refs #5' }];
  const record = { number: 5, closingCommitShas: [null, ''] };
  assert.deepEqual(discoverClosingCommits(record, gitLog), ['from-log']);
});

test('isClosingCommitReverted detects a trailer naming the closing commit', () => {
  const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const gitLog = [
    { sha, message: 'refs #1' },
    { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', message: `Revert "Fix the thing"\n\nThis reverts commit ${sha}.` },
  ];
  assert.equal(isClosingCommitReverted([sha], 1, gitLog), true);
});

test('isClosingCommitReverted falls back to a Revert-subject commit referencing the same record number', () => {
  // Squash/rebase rewrote the SHA, so the trailer no longer names anything in
  // this log — the subject-based fallback is what catches this (IL-45).
  const gitLog = [{ sha: 'revert-sha', message: 'Revert "Fix the thing"\n\nrefs #1' }];
  assert.equal(isClosingCommitReverted(['some-other-sha-not-in-any-trailer'], 1, gitLog), true);
});

test('isClosingCommitReverted is false when nothing reverts the closing commit', () => {
  assert.equal(isClosingCommitReverted(['sha-1'], 1, [{ sha: 'sha-1', message: 'refs #1' }]), false);
});

test('isClosingCommitReverted is all-or-nothing: one reverted commit among several disqualifies all', () => {
  const shaA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const shaB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const gitLog = [
    { sha: shaA, message: 'refs #2' },
    { sha: shaB, message: 'refs #2' },
    { sha: 'cccccccccccccccccccccccccccccccccccccccc', message: `This reverts commit ${shaA}.` },
  ];
  assert.equal(isClosingCommitReverted([shaA, shaB], 2, gitLog), true);
});

test('isClosingCommitReverted returns false for an empty closing-commit list', () => {
  assert.equal(isClosingCommitReverted([], 1, [{ sha: 'x', message: 'This reverts commit x.' }]), false);
});

test('a Revert-subject commit for a DIFFERENT record does not revert this one', () => {
  const gitLog = [{ sha: 'revert-sha', message: 'Revert "Something else"\n\nrefs #999' }];
  assert.equal(isClosingCommitReverted(['sha-1'], 1, gitLog), false);
});

test('isClosingCommitReverted returns false for an empty or missing git log', () => {
  assert.equal(isClosingCommitReverted(['sha-1'], 1, []), false);
  assert.equal(isClosingCommitReverted(['sha-1'], 1, undefined), false);
});

function sha40(n) {
  return n.toString(16).padStart(40, '0');
}

function operationalFixture(number, daysAgo) {
  return {
    number,
    labels: ['by:capture', 'risk:low'],
    body: '',
    state: 'CLOSED',
    closedAt: closedDaysAgo(daysAgo),
  };
}

function commitFor(number) {
  return { sha: sha40(number), message: `refs #${number}` };
}

test('AC1: operational evidence clears MIN_SAMPLES and grades a class that was insufficient-evidence', () => {
  const records = Array.from({ length: MIN_SAMPLES }, (_, i) => operationalFixture(i + 1, 15));
  const gitLog = records.map((r) => commitFor(r.number));

  const short = trustRows(records.slice(0, MIN_SAMPLES - 1), gitLog, NOW, {});
  assert.equal(short[0].verdict, 'insufficient-evidence');

  const full = trustRows(records, gitLog, NOW, {});
  assert.equal(full[0].total, MIN_SAMPLES);
  assert.equal(full[0].operationalGood, MIN_SAMPLES);
  assert.equal(full[0].dispositioned, MIN_SAMPLES);
  assert.equal(full[0].verdict, 'clean');
});

test('AC2: the revert window is inclusive at the boundary, both directions', () => {
  const atBoundaryRecords = Array.from({ length: MIN_SAMPLES }, (_, i) => operationalFixture(i + 1, 14));
  const atBoundaryLog = atBoundaryRecords.map((r) => commitFor(r.number));
  const atBoundary = trustRows(atBoundaryRecords, atBoundaryLog, NOW, {});
  assert.equal(atBoundary[0].operationalGood, MIN_SAMPLES);

  const oneShortRecords = Array.from({ length: MIN_SAMPLES }, (_, i) => operationalFixture(i + 1, 13));
  const oneShortLog = oneShortRecords.map((r) => commitFor(r.number));
  const belowBoundary = trustRows(oneShortRecords, oneShortLog, NOW, {});
  assert.equal(belowBoundary[0].operationalGood, 0);
  assert.equal(belowBoundary[0].undispositioned, MIN_SAMPLES);
});

test('AC3 (#267): a reverted closing commit does not count as known-good — it counts as negative evidence instead (#268)', () => {
  const record = operationalFixture(1, 30);
  const gitLog = [commitFor(1), { sha: sha40(999), message: `This reverts commit ${sha40(1)}.` }];
  const rows = trustRows([record], gitLog, NOW, {});
  assert.equal(rows[0].operationalGood, 0);
  assert.equal(rows[0].undispositioned, 0);
  assert.equal(rows[0].negativeEvidence, 1);
});

test('AC4: no discoverable closing commit contributes nothing, asserted explicitly', () => {
  const record = operationalFixture(1, 30);
  const rows = trustRows([record], [], NOW, {});
  assert.equal(rows[0].operationalGood, 0);
  assert.equal(rows[0].undispositioned, 1);
});

test('AC5: a configured window widens what counts; the default applies when absent; malformed falls back', () => {
  const record = operationalFixture(1, 15);
  const gitLog = [commitFor(1)];

  const wider = trustRows([record], gitLog, NOW, { 'trust-revert-window-days': 21 });
  assert.equal(wider[0].operationalGood, 0, '15-day-old merge must not count under a 21-day window');

  const defaulted = trustRows([record], gitLog, NOW, {});
  assert.equal(defaulted[0].operationalGood, 1, 'the default (14 days) still applies when the key is absent');

  const malformed = trustRows([record], gitLog, NOW, { 'trust-revert-window-days': 0 });
  assert.equal(malformed[0].operationalGood, 1, 'a malformed value (0) falls back to the default rather than throwing');
});

test('AC7: only closedAt (whatever the caller supplies as the latest close) and current state matter — a currently-open record contributes nothing', () => {
  // The module tracks no reopen history of its own — "latest close" is
  // whatever closedAt the caller supplies (GitHub's own closedAt already
  // reflects the record's most recent close, reopen or not), so this
  // deliberately does not construct a reopen-then-reclose sequence: there
  // is no such sequence in the code to construct. What genuinely needs
  // covering, and is covered here, is the reopen's *other* consequence —
  // a record that is currently OPEN (mid-reopen, not yet reclosed)
  // contributes nothing, however old its closedAt from a prior close.
  const reclosed = operationalFixture(1, 20);
  const gitLog = [commitFor(1)];
  const closedRows = trustRows([reclosed], gitLog, NOW, {});
  assert.equal(closedRows[0].operationalGood, 1);

  const stillOpen = { ...reclosed, state: 'OPEN' };
  const openRows = trustRows([stillOpen], gitLog, NOW, {});
  assert.equal(openRows.length, 0, 'an open record forms no cell at all — trust is about outcomes');
});

test('AC8: two closing commits, one reverted, disqualifies the whole record (all-or-nothing)', () => {
  const record = { ...operationalFixture(1, 30), closingCommitShas: [sha40(1), sha40(2)] };
  const gitLog = [{ sha: sha40(999), message: `This reverts commit ${sha40(2)}.` }];
  const rows = trustRows([record], gitLog, NOW, {});
  assert.equal(rows[0].operationalGood, 0);
});

test('gotcha: one operational known-good among 39 unknowns must not grade a class clean', () => {
  const good = operationalFixture(1, 30);
  const rest = Array.from({ length: 39 }, (_, i) => operationalFixture(i + 2, 1)); // too young to count
  const records = [good, ...rest];
  const gitLog = [commitFor(1), ...rest.map((r) => commitFor(r.number))];
  const rows = trustRows(records, gitLog, NOW, {});
  assert.equal(rows[0].total, 40);
  assert.equal(rows[0].operationalGood, 1);
  assert.equal(rows[0].dispositioned, 1);
  assert.equal(rows[0].verdict, 'insufficient-evidence', 'MIN_VERDICTS=5 must still gate a single operational sample');
});

test('backward compatibility: trustRows(records) with no gitLog/now/policy behaves exactly as before', () => {
  const rows = trustRows([
    { number: 1, labels: ['by:capture', 'risk:low'], body: '', state: 'CLOSED', closedAt: '2020-01-01T00:00:00Z' },
  ]);
  assert.equal(rows[0].undispositioned, 1);
  assert.equal(rows[0].operationalGood, 0);
  assert.equal(rows[0].verdict, 'insufficient-evidence');
});

test('demo-descent still wins over operational evidence when both are present', () => {
  // A demo:approved record never falls through to the operational path —
  // dispositionState resolves it first, exactly as before this leaf.
  const record = { ...operationalFixture(1, 30), labels: ['by:capture', 'risk:low', 'demo:approved'] };
  const gitLog = [commitFor(1)];
  const rows = trustRows([record], gitLog, NOW, {});
  assert.equal(rows[0].approved, 1);
  assert.equal(rows[0].operationalGood, 0);
});

test('regression: a demo:pending record is never promoted to operational known-good', () => {
  // demo:pending IS a demo:* disposition (an outstanding, unresolved human
  // review request) — it must stay undispositioned, exactly like a record
  // with no operational evidence at all, never silently graded known-good
  // just because a human hasn't run /demo yet.
  const record = {
    ...operationalFixture(1, 30),
    labels: ['by:capture', 'risk:low', 'demo:pending'],
  };
  const gitLog = [commitFor(1)];
  const rows = trustRows([record], gitLog, NOW, {});
  assert.equal(rows[0].operationalGood, 0);
  assert.equal(rows[0].undispositioned, 1);
  assert.equal(rows[0].approved, 0);
  assert.equal(rows[0].changesRequested, 0);
});

// --- Negative evidence: failure classifications and reverts (#268) --------

function negativeEvidenceFixture(number, classification) {
  return {
    number,
    labels: ['by:capture', 'risk:low'],
    body: '',
    state: 'CLOSED',
    // Fresh close, well inside the revert window and with no closing commit
    // in the fixture git log — the operational path must find nothing here,
    // isolating the marker-based negative-evidence path under test.
    closedAt: closedDaysAgo(1),
    comments: [{
      body: attemptFailedCommentBody({ attemptNumber: 1, reason: 'boom', classification }),
    }],
  };
}

test('AC1 (#268): one correctness-classified failure marker pins a class below clean; removing it restores clean', () => {
  const goodOperational = Array.from({ length: 7 }, (_, i) => operationalFixture(i + 1, 30));
  const gitLog = goodOperational.map((r) => commitFor(r.number));

  const withMarker = [...goodOperational, negativeEvidenceFixture(100, 'correctness')];
  const withMarkerRows = trustRows(withMarker, gitLog, NOW, {});
  assert.equal(withMarkerRows[0].total, 8);
  assert.equal(withMarkerRows[0].operationalGood, 7);
  assert.equal(withMarkerRows[0].negativeEvidence, 1);
  assert.equal(withMarkerRows[0].dispositioned, 8);
  assert.equal(withMarkerRows[0].verdict, 'mixed', 'negative evidence pins the class below clean');

  const withoutMarker = [...goodOperational, { ...negativeEvidenceFixture(100, 'correctness'), comments: [] }];
  const withoutMarkerRows = trustRows(withoutMarker, gitLog, NOW, {});
  assert.equal(withoutMarkerRows[0].negativeEvidence, 0);
  assert.equal(withoutMarkerRows[0].verdict, 'clean', 'removing the marker restores clean');
});

test('AC2 (#268): a transient-classified failure writes no negative evidence and leaves the verdict unchanged', () => {
  const goodOperational = Array.from({ length: 7 }, (_, i) => operationalFixture(i + 1, 30));
  const gitLog = goodOperational.map((r) => commitFor(r.number));

  const withTransient = [...goodOperational, negativeEvidenceFixture(100, 'transient')];
  const rows = trustRows(withTransient, gitLog, NOW, {});
  assert.equal(rows[0].negativeEvidence, 0);
  assert.equal(rows[0].undispositioned, 1, 'a transient marker leaves the record undispositioned, not negative');
  assert.equal(rows[0].verdict, 'clean');
});

test('AC3 (#268): a revert on a previously-counted known-good record downgrades the class verdict with no other state change', () => {
  const good = Array.from({ length: 8 }, (_, i) => operationalFixture(i + 1, 30));
  const cleanLog = good.map((r) => commitFor(r.number));
  const clean = trustRows(good, cleanLog, NOW, {});
  assert.equal(clean[0].verdict, 'clean');
  assert.equal(clean[0].total, 8);

  // Revert record #1's closing commit — same record set, same total, only
  // its own contribution flips from operationalGood to negativeEvidence.
  const revertedLog = [...cleanLog, { sha: sha40(999), message: `This reverts commit ${sha40(1)}.` }];
  const reverted = trustRows(good, revertedLog, NOW, {});
  assert.equal(reverted[0].total, 8, 'no other state change — same records, same total');
  assert.equal(reverted[0].operationalGood, 7, 'exactly one contribution flipped');
  assert.equal(reverted[0].negativeEvidence, 1);
  assert.equal(reverted[0].verdict, 'mixed', 'the class verdict downgrades on the next read');
});

test('AC4 (#268): two failed attempts on the same record still contribute one unit of negative evidence, not two', () => {
  const goodOperational = Array.from({ length: 7 }, (_, i) => operationalFixture(i + 1, 30));
  const gitLog = goodOperational.map((r) => commitFor(r.number));

  const record = {
    ...negativeEvidenceFixture(100, 'correctness'),
    comments: [
      { body: attemptFailedCommentBody({ attemptNumber: 1, reason: 'a', classification: 'correctness' }) },
      { body: attemptFailedCommentBody({ attemptNumber: 2, reason: 'b', classification: 'ambiguous' }) },
    ],
  };
  const rows = trustRows([...goodOperational, record], gitLog, NOW, {});
  assert.equal(rows[0].negativeEvidence, 1, 'two failed attempts on one record still count as one unit');
});

test('a demo:approved record carrying an earlier failed-attempt marker keeps its approved disposition (scoped to disposition: none)', () => {
  // Negative-evidence reading only applies when there is no demo:* verdict
  // already recorded (symmetric with the pre-existing operational-good
  // path) — an eventual approval is not retroactively contradicted by an
  // earlier failed attempt on the way to it.
  const record = {
    number: 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED',
    comments: [{ body: attemptFailedCommentBody({ attemptNumber: 1, reason: 'x', classification: 'correctness' }) }],
  };
  const rows = trustRows([record]);
  assert.equal(rows[0].approved, 1);
  assert.equal(rows[0].negativeEvidence, 0);
});

test('approvedBatch is tallied from the demo:approved-batch marker, and only from it', () => {
  const rows = trustRows([
    { number: 1, labels: ['by:capture', 'risk:low', 'demo:approved', 'demo:approved-batch'], body: '', state: 'CLOSED' },
    { number: 2, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED' },
  ]);
  assert.equal(rows[0].approved, 2, 'both records are approved regardless of provenance');
  assert.equal(rows[0].approvedBatch, 1, 'only the batch-marked record counts toward approvedBatch');
});

test('AC3.2: accept:approved-batch counts as approvedBatch and batchOnly, exactly as demo:approved-batch does', () => {
  const rows = trustRows([
    { number: 1, labels: ['by:capture', 'risk:low', 'accept:approved', 'accept:approved-batch'], body: '', state: 'CLOSED' },
    { number: 2, labels: ['by:capture', 'risk:low', 'accept:approved'], body: '', state: 'CLOSED' },
    { number: 3, labels: ['by:capture', 'risk:low', 'demo:approved', 'accept:approved-batch'], body: '', state: 'CLOSED' },
  ]);
  assert.equal(rows[0].approved, 3, 'all three records are approved regardless of spelling');
  assert.equal(rows[0].approvedBatch, 2, 'both accept:approved-batch markers count, beside a demo:approved verdict too');

  const batchOnly = trustRows(Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: i + 1,
    labels: ['by:capture', 'risk:low', 'accept:approved', 'accept:approved-batch'],
    body: '', state: 'CLOSED',
  })))[0];
  assert.equal(batchOnly.approved, MIN_SAMPLES);
  assert.equal(batchOnly.approvedBatch, MIN_SAMPLES);
  assert.equal(batchOnly.batchOnly, true);
  assert.equal(batchOnly.verdict, 'mixed');

  // Mixed provenance keeps the cell eligible for clean, as the demo:* twin does.
  const walkthroughBacked = trustRows(Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: i + 1,
    labels: i === 0 ? ['by:capture', 'risk:low', 'accept:approved'] : ['by:capture', 'risk:low', 'accept:approved', 'accept:approved-batch'],
    body: '', state: 'CLOSED',
  })))[0];
  assert.equal(walkthroughBacked.approvedBatch, MIN_SAMPLES - 1);
  assert.equal(walkthroughBacked.batchOnly, false);
  assert.equal(walkthroughBacked.verdict, 'clean');
});

test('AC3.2: accept:* verdicts land in the same buckets as their demo:* twins', () => {
  // The fixture carries operational evidence (an old closed record with a closing
  // commit), so a label read as "no acceptance state" lands in operationalGood and
  // is told apart from a pending one.
  const bucket = (labels) => {
    const record = { ...operationalFixture(1, 30), labels: ['by:capture', 'risk:low', ...labels] };
    const [row] = trustRows([record], [commitFor(1)], NOW, {});
    return { approved: row.approved, changesRequested: row.changesRequested, undispositioned: row.undispositioned, operationalGood: row.operationalGood };
  };
  assert.deepEqual(bucket(['accept:approved']), bucket(['demo:approved']));
  assert.deepEqual(bucket(['accept:changes-requested']), bucket(['demo:changes-requested']));
  assert.deepEqual(bucket(['accept:pending']), bucket(['demo:pending']));
  assert.deepEqual(bucket([]), { approved: 0, changesRequested: 0, undispositioned: 0, operationalGood: 1 });
  assert.equal(bucket(['accept:approved']).approved, 1);
  assert.equal(bucket(['accept:changes-requested']).changesRequested, 1);
  assert.equal(bucket(['accept:pending']).undispositioned, 1);
  assert.equal(bucket(['accept:pending']).operationalGood, 0);
});

test('AC3.2: an accept:pending record is never promoted to operational known-good', () => {
  const record = { ...operationalFixture(1, 30), labels: ['by:capture', 'risk:low', 'accept:pending'] };
  const rows = trustRows([record], [commitFor(1)], NOW, {});
  assert.equal(rows[0].operationalGood, 0);
  assert.equal(rows[0].undispositioned, 1);
  assert.equal(rows[0].approved, 0);
  assert.equal(rows[0].changesRequested, 0);
});

test('#431: a cell resting entirely on batch sign-offs demotes from clean to mixed', () => {
  // Every closed record here is demo:approved AND demo:approved-batch — no
  // walkthrough-backed approval, no operational corroboration. The shipped
  // rule (pre-#431) would have graded this 'clean' on approved-count alone;
  // the provenance-aware rule must not.
  const records = Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: i + 1,
    labels: ['by:capture', 'risk:low', 'demo:approved', 'demo:approved-batch'],
    body: '', state: 'CLOSED',
  }));
  const row = trustRows(records)[0];
  assert.equal(row.approved, MIN_SAMPLES);
  assert.equal(row.approvedBatch, MIN_SAMPLES);
  assert.equal(row.batchOnly, true);
  assert.equal(row.verdict, 'mixed');
});

test('#431: one walkthrough-backed approval among otherwise-batch evidence keeps a cell eligible for clean', () => {
  // Orthogonal-category check against the demotion test above: mixed provenance
  // (not all-batch) must not itself trigger the batchOnly demotion — the record
  // still needs to be free of changes-requested/follow-ups/negative-evidence to
  // grade 'clean', same as before this record.
  const records = Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: i + 1,
    labels: ['by:capture', 'risk:low', 'demo:approved', 'demo:approved-batch'],
    body: '', state: 'CLOSED',
  }));
  records[0].labels = ['by:capture', 'risk:low', 'demo:approved'];
  const row = trustRows(records)[0];
  assert.equal(row.approved, MIN_SAMPLES);
  assert.equal(row.approvedBatch, MIN_SAMPLES - 1);
  assert.equal(row.batchOnly, false);
  assert.equal(row.verdict, 'clean');
});

test('#431: a pre-existing demo:approved with no marker is walkthrough-backed and never demotes a cell', () => {
  // Backward compatibility: every demo:approved label applied before this
  // signal existed carries no demo:approved-batch marker at all.
  const records = Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: i + 1, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED',
  }));
  const row = trustRows(records)[0];
  assert.equal(row.approvedBatch, 0);
  assert.equal(row.batchOnly, false);
  assert.equal(row.verdict, 'clean');
});
