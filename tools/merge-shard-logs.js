#!/usr/bin/env node
'use strict';

// Merges the TAP output of `.github/workflows/test.yml`'s parallel shard jobs into one suite log,
// printed by that workflow's `test` job. `.claude-tweaks/verify-scope.json`'s `ci` source reads
// exactly one job's log (`plugin/skills/test/ci-source.md`), and verify.js's extractor takes the
// first `# tests` / `# pass` / `# fail` summary it finds, so the merged log carries every shard's
// test blocks and a single summary whose counts are the shards' sums.
//
// Usage: node tools/merge-shard-logs.js --expect <n> <dir>
// Reads `<dir>/shard-<i>.tap` for i = 1..n. Each must end in node's TAP summary (`1..N` plan, then
// `# tests` … `# duration_ms`). Exit codes: 0 every shard merged and none failed or cancelled; 1 the
// merged counts carry a failure or cancellation; 2 a shard log is missing or has no TAP summary (the
// shards that did parse are still printed, under a `# merge-shard-logs:` comment naming the gap, so
// the log never passes for a complete run).

const fs = require('fs');
const path = require('path');

const SUMMARY_KEYS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'];
const SUMMARY_RE = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\d+(?:\.\d+)?)$/;
const PLAN_RE = /^1\.\.(\d+)$/;

// Splits one shard's TAP text into its body and its trailing summary. Only the last contiguous run of
// summary lines counts, so a test's own `# tests 3` comment earlier in the body is left alone. Throws
// when the tail is not a summary carrying at least tests, pass and fail.
function splitSummary(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;
  const counts = {};
  let start = end;
  while (start > 0) {
    const m = SUMMARY_RE.exec(lines[start - 1]);
    if (!m) break;
    counts[m[1]] = Number(m[2]);
    start -= 1;
  }
  for (const key of ['tests', 'pass', 'fail']) {
    if (!(key in counts)) throw new Error(`no TAP summary at the end (missing "# ${key}")`);
  }
  let plan = null;
  if (start > 0) {
    const m = PLAN_RE.exec(lines[start - 1]);
    if (m) {
      plan = Number(m[1]);
      start -= 1;
    }
  }
  return { body: lines.slice(0, start).join('\n'), plan, counts };
}

// Merges parsed shards into one TAP text: the bodies in order, one plan (when every shard had one),
// and one summary. Counts are summed; duration_ms is the slowest shard's, since the shards ran at once.
function mergeParsed(parsed) {
  const counts = {};
  for (const key of SUMMARY_KEYS) {
    const values = parsed.map((p) => p.counts[key]).filter((v) => v !== undefined);
    if (values.length === 0) continue;
    counts[key] = key === 'duration_ms' ? Math.max(...values) : values.reduce((a, b) => a + b, 0);
  }
  const out = parsed.map((p) => p.body).filter((b) => b !== '');
  if (parsed.length && parsed.every((p) => p.plan !== null)) out.push(`1..${parsed.reduce((n, p) => n + p.plan, 0)}`);
  for (const key of SUMMARY_KEYS) if (key in counts) out.push(`# ${key} ${counts[key]}`);
  return { text: `${out.join('\n')}\n`, counts };
}

function run(argv, { readFile = (p) => fs.readFileSync(p, 'utf8'), stdout = process.stdout, stderr = process.stderr } = {}) {
  const usage = 'usage: node tools/merge-shard-logs.js --expect <n> <dir>';
  if (argv.length !== 3 || argv[0] !== '--expect' || !/^[1-9]\d*$/.test(argv[1])) {
    stderr.write(`merge-shard-logs.js: ${usage}\n`);
    return 2;
  }
  const expect = Number(argv[1]);
  const dir = argv[2];
  const parsed = [];
  const problems = [];
  for (let i = 1; i <= expect; i++) {
    const file = path.join(dir, `shard-${i}.tap`);
    let text;
    try {
      text = readFile(file);
    } catch (err) {
      problems.push(`shard ${i}/${expect}: ${file} could not be read (${err.code || err.message})`);
      continue;
    }
    try {
      parsed.push(splitSummary(text));
    } catch (err) {
      problems.push(`shard ${i}/${expect}: ${file} has ${err.message}`);
    }
  }
  const merged = mergeParsed(parsed);
  if (problems.length) {
    // Before the summary, so a reader of the counts sees they cover only part of the suite.
    const lines = merged.text.replace(/\n$/, '').split('\n');
    const summaryAt = lines.findIndex((l) => PLAN_RE.test(l) || SUMMARY_RE.test(l));
    const note = problems.map((p) => `# merge-shard-logs: ${p} — the counts below cover ${parsed.length} of ${expect} shards`);
    lines.splice(summaryAt === -1 ? lines.length : summaryAt, 0, ...note);
    stdout.write(`${lines.join('\n')}\n`);
    for (const p of problems) stderr.write(`merge-shard-logs.js: ${p}\n`);
    return 2;
  }
  stdout.write(merged.text);
  return (merged.counts.fail || 0) > 0 || (merged.counts.cancelled || 0) > 0 ? 1 : 0;
}

module.exports = { splitSummary, mergeParsed, run, SUMMARY_KEYS };

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}
