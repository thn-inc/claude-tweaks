# Dream Scan Redaction (#2968) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every transcript-derived string the dream scan writes into a staged proposal, `report.md`, or `decisions.md` passes through one redaction function covering absolute paths and well-known credential shapes.

**Architecture:** `plugin/bin/lib/dream/scan.js` gains a best-effort `redactSecrets` (pattern table) and a composed `redact(s)` = `redactPaths(redactSecrets(s))`. Every site that today calls `redactPaths` (error excerpt, normalized signature line) switches to `redact`, and the two unredacted fields — the Bash `command` and the Bash `commandVerb` — gain it. `plugin/skills/harness-health/dream-pass.md` states exactly what is redacted.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-10-04T173247-spec-2968/work/2968-spec.md` (GitHub issue #2968)

## Global Constraints

- The plugin payload is `plugin/` only; tests live in `tests/`.
- Commit style: `{Verb} {what} — {detail}`, imperative, no conventional-commit prefix; reference the record as `refs #2968` (never `closes`/`fixes` in a commit).
- Keep `redactPaths` exported with its current behavior — `tests/bin-lib/dream/scan.test.js`'s existing `redactPaths` test pins it.
- One plain command per Bash call (worktree-isolated session guard); no shell variables as the program.
- Decision recorded in the run's `decisions.md` (Spec Step 3): deliverable 3 resolves to **implement** best-effort credential redaction and document its exact coverage — not merely narrow the doc.

## Review Focus

1. **A secret in the error's first line** — it becomes part of the grouping signature and the proposal's `**Pattern:**` line; `normalizeErrorLine` must redact secrets too, not only paths. Pinned by Task 1's `normalizeErrorLine` test.
2. **A Bash command whose first token is an absolute path** (`/Users/alice/bin/tool --x`) — `commandVerb` flows into the signature, the Pattern line, `report.md`, and the `decisions.md` STAGED text written by `plugin/bin/dream-scan.js:121-124`. Pinned by Task 1's verb test.
3. **A quoted secret value containing spaces or slashes** (`AWS_SECRET_ACCESS_KEY="wJalr.../K7MDENG/..."`) — must redact the whole quoted value, not leave a slash-bearing tail for the path regex to half-eat. Pinned by Task 1's `redactSecrets` table test.
4. **A non-string or absent `command`** (non-Bash tools) — must stay `null`, never throw. Covered by the existing `extractErrorFindings` tests (non-Bash path) plus Task 1's guard.
5. **Benign over-redaction** (`--max_tokens=100` → `--max_tokens=<secret>`) — acceptable by design (best-effort, errs toward hiding); the doc says so. No test needed beyond the doc statement.

---

### Task 1: Redact every transcript-derived field in the dream scan

**Files:**
- Modify: `plugin/bin/lib/dream/scan.js:30-44` (redaction helpers), `:115` (normalizeErrorLine), `:148-161` (finding construction), `:288-301` (exports)
- Modify: `plugin/skills/harness-health/dream-pass.md:31-35` (Scope bullet)
- Test: `tests/bin-lib/dream/scan.test.js`

**Interfaces:**
- Consumes: existing `redactPaths(s)`, `truncate(s, max)`, `bashCommandVerb(command)`, `extractErrorFindings({ filePath, sessionId, deps })`, `composeProposalMarkdown(group, opts)`.
- Produces: exported `redactSecrets(s: string): string` and `redact(s: string): string` from `plugin/bin/lib/dream/scan.js`. `redact` = `redactPaths(redactSecrets(s))`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/dream/scan.test.js`, extend the require block (add `redactSecrets`, `redact`, `normalizeErrorLine` to the destructured names — `normalizeErrorLine` is already exported by `scan.js`):

```js
const {
  listTranscriptFiles,
  extractErrorFindings,
  groupFindings,
  filterByEvidenceBar,
  composeProposalMarkdown,
  runScan,
  bashCommandVerb,
  normalizeErrorLine,
  redactPaths,
  redactSecrets,
  redact,
  MIN_SESSIONS_FLOOR,
} = require('../../../plugin/bin/lib/dream/scan');
```

Append these tests at the end of the file:

```js
test('redactSecrets: known credential shapes become <secret>, ordinary text is untouched', () => {
  const cases = [
    ['curl -H "Authorization: Bearer abcDEF1234567890xyz" x', 'curl -H "Authorization: Bearer <secret>" x'],
    ['GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 gh api user', 'GITHUB_TOKEN=<secret> gh api user'],
    ['export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"', 'export AWS_SECRET_ACCESS_KEY=<secret>'],
    ['mysql --password=hunter22 -u root', 'mysql --password=<secret> -u root'],
    ['tool --api-key sk-proj-abcdefghijklmnopqrstuvwx run', 'tool --api-key <secret> run'],
    ['aws s3 ls # AKIAIOSFODNN7EXAMPLE', 'aws s3 ls # <secret>'],
    ['git stash pop', 'git stash pop'],
  ];
  for (const [input, expected] of cases) assert.equal(redactSecrets(input), expected, input);
});

test('redact: applies secret redaction, then path redaction', () => {
  assert.equal(
    redact('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 node /Users/alice/repo/bin/x.js'),
    'GITHUB_TOKEN=<secret> node <path>',
  );
});

test('extractErrorFindings: the quoted command and a path-shaped verb are redacted', () => {
  const dir = tmpConfigDir();
  const file = path.join(dir, 'session-r.jsonl');
  writeTranscript(file, [
    assistantToolUse('t1', 'Bash', { command: 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 /Users/alice/bin/deploy --to /Users/alice/repo/out' }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', 'Exit code 1\ndeploy: failed', '2026-10-01T00:00:01Z'),
  ]);
  const [finding] = extractErrorFindings({ filePath: file, sessionId: 'session-r' });
  assert.ok(!finding.command.includes('/Users/alice'), finding.command);
  assert.ok(!finding.command.includes('ghp_'), finding.command);
  assert.ok(finding.command.includes('<path>') && finding.command.includes('<secret>'), finding.command);
  assert.equal(finding.commandVerb, '<path>');
  assert.ok(!finding.signature.includes('/Users/alice'), finding.signature);
});

test('normalizeErrorLine: a secret in the first error line never reaches the signature', () => {
  const line = normalizeErrorLine('Exit code 1\nauth failed for GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123');
  assert.ok(!line.includes('ghp_'), line);
  assert.ok(line.includes('<secret>'), line);
});

test('composeProposalMarkdown: a proposal built from real findings quotes no raw path or token', () => {
  const dir = tmpConfigDir();
  const events = (sid) => [
    assistantToolUse('t1', 'Bash', { command: 'curl -H "Authorization: Bearer abcDEF1234567890xyz" -o /Users/alice/tmp/out.json https://example.com' }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', 'Exit code 22\ncurl: (22) The requested URL returned error: 401', '2026-10-01T00:00:01Z'),
  ];
  writeTranscript(path.join(dir, 'a.jsonl'), events('a'));
  writeTranscript(path.join(dir, 'b.jsonl'), events('b'));
  const findings = [
    ...extractErrorFindings({ filePath: path.join(dir, 'a.jsonl'), sessionId: 'a' }),
    ...extractErrorFindings({ filePath: path.join(dir, 'b.jsonl'), sessionId: 'b' }),
  ];
  const [group] = groupFindings(findings);
  const md = composeProposalMarkdown(group, { windowDays: 14 });
  assert.ok(!md.includes('/Users/alice'), md);
  assert.ok(!md.includes('abcDEF1234567890xyz'), md);
  assert.ok(md.includes('Bearer <secret>'), md);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dream/scan.test.js`
Expected: FAIL — `redactSecrets is not a function` / `redact is not a function` for the first two; the extract/normalize/compose tests fail on the `!includes('/Users/alice')` or `!includes('ghp_')` assertions.

- [ ] **Step 3: Implement**

In `plugin/bin/lib/dream/scan.js`, directly after the existing `redactPaths` function, add:

```js
// Best-effort credential redaction (#2968). Pattern-based, so it errs toward
// hiding: anything that merely looks like a credential is replaced (e.g.
// `--max_tokens=100` is redacted too). It is not a guarantee that a secret of
// an unrecognized shape cannot reach a staged proposal — dream-pass.md says so.
const SECRET_NAME = '[A-Za-z0-9_-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL)[A-Za-z0-9_-]*';
const SECRET_PATTERNS = [
  // `Authorization: Bearer x` / `Authorization: token x` / `Authorization: x`
  [/\b(authorization:\s*)(?:(bearer|basic|token)\s+)?[^\s'"]+/gi, (m, header, scheme) => `${header}${scheme ? `${scheme} ` : ''}<secret>`],
  // a bare `Bearer x` / `Basic x` credential outside an Authorization header
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, (m, scheme) => `${scheme} <secret>`],
  // `NAME=value` and `--name=value`, NAME containing a credential word; quoted values whole
  [new RegExp(`(\\b${SECRET_NAME}=)("[^"]*"|'[^']*'|[^\\s'"]+)`, 'gi'), '$1<secret>'],
  // `--name value`
  [new RegExp(`(--${SECRET_NAME}\\s+)("[^"]*"|'[^']*'|[^\\s'"-][^\\s'"]*)`, 'gi'), '$1<secret>'],
  // well-known token prefixes: GitHub, OpenAI-style, Slack, AWS access key ids
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '<secret>'],
];

function redactSecrets(s) {
  return SECRET_PATTERNS.reduce((acc, [re, replacement]) => acc.replace(re, replacement), s);
}

// The one redaction every transcript-derived field goes through before it
// can reach a staged proposal, report.md, or decisions.md. Secrets first, so
// a slash-bearing secret value is replaced whole rather than half-eaten by
// the path pattern.
function redact(s) {
  return redactPaths(redactSecrets(s));
}
```

In `normalizeErrorLine`, change `redactPaths(first)` to `redact(first)`:

```js
  return truncate(redact(first).toLowerCase().replace(/\s+/g, ' ').trim(), MAX_NORMALIZED_CHARS);
```

In `extractErrorFindings`, change the `commandVerb` line and the `command`/`errorExcerpt` fields:

```js
        const commandVerb = toolName === 'Bash' ? redact(bashCommandVerb(command)) : toolName;
```

```js
          command: typeof command === 'string' ? truncate(redact(command), MAX_COMMAND_CHARS) : null,
          errorExcerpt: truncate(redact(errorText.trim()), MAX_ERROR_CHARS),
```

Add `redactSecrets` and `redact` to `module.exports` (keep `redactPaths`):

```js
  normalizeErrorLine,
  redactPaths,
  redactSecrets,
  redact,
};
```

In `plugin/skills/harness-health/dream-pass.md`, replace the Scope bullet's last three lines (lines 33-35 — from "  another account's transcripts on a shared machine. Quoted excerpts are truncated (command to 200" through "  proposal or this file.") with:

```markdown
  another account's transcripts on a shared machine. Every transcript-derived field — the quoted
  command, the error excerpt, the grouping signature's error line, and a Bash command's leading
  verb — passes through one `redact()` (`bin/lib/dream/scan.js`) before it reaches a staged
  proposal, `report.md`, or `decisions.md`: absolute paths become `<path>`, and well-known
  credential shapes (`Authorization`/`Bearer`/`Basic` values, `NAME=value` and `--name value`
  where NAME contains TOKEN/SECRET/PASSWORD/API_KEY/ACCESS_KEY/PRIVATE_KEY/CREDENTIAL, and
  GitHub/`sk-`/Slack/AWS-key-id token prefixes) become `<secret>`. Secret redaction is
  pattern-based and best-effort — it over-redacts rather than under-redacts, and a credential of
  an unrecognized shape can still appear, so review a proposal before copying its evidence into a
  committed file. Quoted excerpts are then truncated (command to 200 chars, error text to 300).
```

(Keep the bullet's first two lines — lines 31-32, "- **Scope is this account's own session history only** — … `config-dir` defaults to `$CLAUDE_CONFIG_DIR` (falling back to `~/.claude`) — never widened to" — unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dream/scan.test.js`
Expected: PASS (all tests, including the pre-existing `redactPaths` and `bashCommandVerb` tests).

Then the real-input probe (read-only — `runScan` returns objects and writes nothing): run from the worktree root

Run: `node -e "const {runScan}=require('./plugin/bin/lib/dream/scan');const os=require('os');const r=runScan({configDir:require('path').join(os.homedir(),'.claude'),windowDays:2});const leaks=r.findings.filter(f=>(f.command||'').includes(os.homedir())||f.signature.includes(os.homedir())||f.errorExcerpt.includes(os.homedir()));console.log(JSON.stringify({scanned:r.scannedFiles,findings:r.findings.length,leaks:leaks.length}))"`
Expected: `scanned` > 0, `findings` > 0, `leaks` 0. Pair it with the independent count: save the pre-fix module (`git show HEAD:plugin/bin/lib/dream/scan.js`, before Step 5's commit) to a scratch file outside the repo, run the same one-liner requiring that scratch file instead, and confirm it reports `leaks` > 0 on the same window — proving the probe can see a leak at all. Quote both raw output lines in the task report.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dream/scan.js plugin/skills/harness-health/dream-pass.md tests/bin-lib/dream/scan.test.js
```

```bash
git commit -m "Redact every transcript-derived dream-scan field — command and verb gain path redaction, all fields gain best-effort secret redaction, refs #2968"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (command through redaction before truncation) → Step 3 `command:` line. Deliverable 2 (discriminating test) → Step 1's extract/compose tests, red at Step 2. Deliverable 3 (decide secrets) → implemented `redactSecrets` + doc statement. AC "no absolute path in Command or Error lines" → compose test asserts the rendered markdown. AC "doc exactly true for every field composeProposalMarkdown writes" → doc names command, error excerpt, signature line (Pattern), verb (Pattern + report + decisions). AC "`npm test` passes" → run centrally after the task.
- **Placeholders:** none.
- **Type consistency:** `redact`, `redactSecrets`, `redactPaths`, `normalizeErrorLine` names match between Step 1 requires, Step 3 code, and exports.
- **Review Focus:** items 1-3 each have a Step 1 test; 4 is the existing guard (`typeof command === 'string'`) kept as-is; 5 is a documented, deliberate behavior.
