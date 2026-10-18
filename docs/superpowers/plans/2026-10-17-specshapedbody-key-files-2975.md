# specShapedBody `keyFiles` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agent-composed records carry a parseable `## Technical Approach` / `### Key Files` section so build's micro-plan gate (condition 3) and dispatch's file-overlap grouping can read them.

**Architecture:** One additive optional parameter, `keyFiles`, on the shared composer `specShapedBody` (`plugin/bin/lib/issues/record.js`) — same additive pattern `premiseCheck`/`verifiedAsOf`/`templateStamp` used. The four health-sweep payload composers pass each finding's repo-relative target path; the three prose producers (`/capture`, `/reflect`, wrap-up leftover routing) gain one instruction each. No gate changes — `micro-plan.md` condition 3 and `grouping.js`'s `extractKeyFilesSection` already parse `### Key Files`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194123-record-2975/work/2975-spec.md` (record #2975)

## Global Constraints

- `specShapedBody` called without `keyFiles`, or with `keyFiles: []`, returns output byte-identical to today's (several tests and `tests/bin-lib/release-note-repair/fixtures.js` pin composed output).
- Bullet format is `specify/spec-template.md`'s: `` - `{path}` — {change} `` (em dash U+2014, single spaces).
- The new sections render as `## Technical Approach`, then `### Key Files`, then the bullets — placed after the `## Release Note` block and **before** the footer (the footer stays the body's last authored line).
- Only repo-relative paths go into `keyFiles`; an out-of-repo target (harness-health memory files under `--memory-dir`) is omitted, never passed absolute.
- Records filed before this change are not backfilled.
- Commit messages: `{Verb} {what} — {detail}` style, ending `refs #2975` — never `closes`/`fixes`.

## Review Focus

1. An absolute path (`/Users/...`, `C:\...`) or a `..`-escaping path passed in `keyFiles` → `specShapedBody` throws naming `keyFiles` (grouping would otherwise compare machine-local paths across records). Test in Task 1.
2. A `path` containing a newline or a backtick, or an empty `path` → throws (a backtick breaks `grouping.js`'s `` BACKTICKED_RE `` parse; a newline breaks the bullet). Test in Task 1.
3. With `keyFiles` present, `extractSection(body, 'Release Note')` still returns only the release-note text — the new heading terminates it, nothing from Key Files bleeds in, and the footer still ends the body. Test in Task 1.
4. A harness-health finding whose target resolves outside the repo root (a memory file), or a new-skill candidate (no existing file), composes with no `## Technical Approach` section at all. Test in Task 2.
5. A code-health anchor carrying a `#symbol` suffix (`src/api/user.js#getUser`) yields the bare path `src/api/user.js` in Key Files, not the anchor. Test in Task 2.

---

### Task 1: `specShapedBody` gains `keyFiles`

**Files:**
- Modify: `plugin/bin/lib/issues/record.js` (`specShapedBody`, ~line 842; its doc comment above it)
- Test: `tests/bin-lib/issues/record.test.js` (append beside the existing `specShapedBody` tests, ~line 915-1020)

**Interfaces:**
- Produces: `specShapedBody({ ..., keyFiles })` where `keyFiles?: Array<{ path: string, change?: string }>`. Exported unchanged from `record.js`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/record.test.js`, reusing the file's existing `BASE` constant `{ currentState: 'c', deliverables: 'd', filedBy: 'x', releaseNote: 'r' }`):

```js
test('AC1.1: specShapedBody with keyFiles emits ## Technical Approach then ### Key Files after ## Release Note', () => {
  const body = specShapedBody({ header: 'H', ...BASE, acceptanceCriteria: 'a',
    keyFiles: [{ path: 'plugin/bin/x.js', change: 'add the thing' }] });
  assert.strictEqual(body, [
    'H', '## Current State', 'c', '## Deliverables', 'd', '## Acceptance Criteria', 'a', '## Release Note', 'r',
    '## Technical Approach', '### Key Files', '- `plugin/bin/x.js` — add the thing',
    '_Filed by `x`. Close to resolve; label `wontfix` to suppress future reports of this finding._',
  ].join('\n\n'));
});
test('AC1.1: multiple keyFiles render one bullet per entry, newline-joined; change defaults to "modify"', () => {
  // expect the bullets block to equal '- `a.js` — modify\n- `tests/a.test.js` — cover it'
});
test('AC2.1: keyFiles absent or [] is byte-identical to the pre-change composition', () => {
  // compare specShapedBody({header:'H',...BASE,acceptanceCriteria:'a'}) against the same call with keyFiles: [] and keyFiles: undefined, and against the literal array in the existing "no new args is byte-identical" test
});
test('AC3.1: a composed body with keyFiles passes compose-record.js --check', () => {
  // write the AC1.1 body to a temp file under fs.mkdtempSync(os.tmpdir()), run
  // execFileSync(process.execPath, [<repo>/plugin/bin/compose-record.js, '--check', file]) → must not throw (exit 0)
});
test('specShapedBody: keyFiles keeps the Release Note section clean and the footer last', () => {
  // extractSection(body, 'Release Note', { trim: true }) === 'r'; body.endsWith('wontfix` to suppress future reports of this finding._')
});
test('specShapedBody: keyFiles rejects absolute, ..-escaping, empty, multi-line, or backticked paths', () => {
  // each of '/abs/x.js', 'C:\\x.js', '../x.js', 'a/../../x.js', '', 'a\nb.js', 'a`b.js' → assert.throws(..., /keyFiles/)
  // a multi-line change string → throws /keyFiles/; keyFiles that is not an array (e.g. 'a.js') → throws /keyFiles/
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js`
Expected: FAIL — the AC1.1 / AC3.1 / rejection tests fail (no `## Technical Approach` emitted, no throw); AC2.1 passes already.

- [ ] **Step 3: Implement `keyFiles` in `specShapedBody`**

Add `keyFiles` to the destructured params. Validate before composing (throw `Error('specShapedBody: keyFiles ...')`, same style as `premiseCheck`): must be an array when supplied; each entry an object whose `path` is a non-empty string with no `\n`, no backtick, not absolute (`path.isAbsolute` on both posix and win32 — `require('node:path').posix.isAbsolute(p) || require('node:path').win32.isAbsolute(p)`), and with no `..` segment (split on `/` and `\`); `change`, when present, a single-line non-empty string, default `'modify'`. When `keyFiles` is non-empty, after `parts.push('## Release Note', block(releaseNote))` and before the footer branch, push `'## Technical Approach'`, `'### Key Files'`, and the bullets joined with `'\n'`. Extend the doc comment with one paragraph naming `keyFiles` (#2975), why it exists (micro-plan condition 3 + `grouping.js` `extractKeyFilesSection`), and the repo-relative rule.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/release-note-repair/ tests/health-filing-parity.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record.js tests/bin-lib/issues/record.test.js
git commit -m "Add keyFiles to specShapedBody — emits Technical Approach / Key Files after Release Note, refs #2975"
```

---

### Task 2: Health-sweep payload composers pass `keyFiles`

**Files:**
- Modify: `plugin/bin/lib/code-health/issue-payload.js` (`toIssuePayloadV2` only — v1 `toIssuePayload` is frozen legacy, do not touch)
- Modify: `plugin/bin/lib/docs-health/issue-payload.js` (`toIssuePayload`)
- Modify: `plugin/bin/lib/harness-health/issue-payload.js` (`toIssuePayload`, new `options.repoRoot`)
- Modify: `plugin/bin/harness-health.js` (~line 285, `toIssuePayloadSelfChecked` passes `repoRoot: root`)
- Modify: `plugin/bin/lib/journey-health/issue-payload.js` (`toIssuePayload`)
- Test: `tests/bin-lib/code-health/issue-payload.test.js`, `tests/bin-lib/docs-health/issue-payload.test.js`, `tests/bin-lib/harness-health/issue-payload.test.js`, `tests/bin-lib/journey-health/issue-payload.test.js`

**Interfaces:**
- Consumes: `specShapedBody({ ..., keyFiles: [{ path, change }] })` from Task 1.
- Produces: harness-health `toIssuePayload(finding, verifiedAsOf, pluginVersion, options = { premiseSelfCheck?, repoRoot? })`.

Target path per sweep (each passes exactly one entry):
- code-health: `finding.anchor` with any `#…` suffix stripped and trimmed (the same split `grouping.js`'s `ANCHOR_RE` applies); change `'address the finding at this anchor'`.
- docs-health: the already-computed `docPath` (`docs/${finding.target}.md`); change `'apply the proposed documentation edit'`.
- harness-health: `finding.path` made relative to `options.repoRoot` (`path.relative`, separators normalized to `/`); omit `keyFiles` when `finding.kind === 'new-skill'`, when `finding.path` or `options.repoRoot` is absent, or when the relative path starts with `..` or is absolute (out-of-repo memory files); change `'remove the named content'` when `finding.intent === 'remove'`, else `'apply the proposed change'`.
- journey-health: `docs/journeys/${finding.journey}.md` (the path `journey-health/scope.js`'s `listJourneys` reads); change `'fix the journey document'`.

- [ ] **Step 1: Write the failing tests** — one per payload test file, each using that file's existing valid-finding fixture:

```js
// code-health issue-payload.test.js
test('AC4.1: toIssuePayloadV2 lists the anchor path under ### Key Files', () => {
  // fixture anchor 'src/api/user.js#getUser' → body includes '### Key Files\n\n- `src/api/user.js` — address the finding at this anchor'
  // and extractKeyFilesSection(body) deep-equals ['src/api/user.js'] (require grouping.js)
});
// docs-health: body includes '- `docs/{target}.md` — apply the proposed documentation edit'
// journey-health: body includes '- `docs/journeys/{journey}.md` — fix the journey document'
// harness-health:
test('AC4.1: harness payload lists the repo-relative target under ### Key Files', () => {
  // finding.path = path.join('/repo', 'plugin/skills/foo/SKILL.md'), options { repoRoot: '/repo' } → body includes '- `plugin/skills/foo/SKILL.md` — apply the proposed change'
});
test('harness payload omits Technical Approach for an out-of-repo target, a missing repoRoot, or a new-skill candidate', () => {
  // finding.path '/home/u/.claude/memory/x.md' with repoRoot '/repo' → !body.includes('## Technical Approach'); same with no repoRoot; same for kind:'new-skill'
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/code-health/issue-payload.test.js tests/bin-lib/docs-health/issue-payload.test.js tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/journey-health/issue-payload.test.js`
Expected: FAIL after Step 1 — the new AC4.1 assertions fail (no Key Files section); the omission test passes vacuously before the change.

- [ ] **Step 3: Pass `keyFiles` from each composer** per the target table above; in `plugin/bin/harness-health.js`, add `repoRoot: root` to the options object `toIssuePayloadSelfChecked` passes. Update each composer's comment block with one line naming `keyFiles` (#2975).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/code-health/ tests/bin-lib/docs-health/ tests/bin-lib/harness-health/ tests/bin-lib/journey-health/ tests/health-filing-parity.test.js`
Expected: PASS, 0 failures. Any pre-existing test that pinned a whole health body byte-for-byte and now fails because of the new section: update that pin to include the section (the change is intended), never delete the assertion.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/issue-payload.js plugin/bin/lib/docs-health/issue-payload.js plugin/bin/lib/harness-health/issue-payload.js plugin/bin/harness-health.js plugin/bin/lib/journey-health/issue-payload.js tests/bin-lib/code-health/issue-payload.test.js tests/bin-lib/docs-health/issue-payload.test.js tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/journey-health/issue-payload.test.js
git commit -m "Pass finding target paths as keyFiles from the four health-sweep composers — refs #2975"
```

---

### Task 3: Prose producers name `keyFiles`; micro-plan condition 3 fixture

**Files:**
- Modify: `plugin/skills/capture/SKILL.md` (Shaped-body branch, step 3 "Score and file born-ready", ~line 300; 40,663 bytes today — ~10 KB headroom under the 51,200-byte ceiling, no file-specific pin)
- Modify: `plugin/skills/reflect/SKILL.md` (tangential staged-finding compose, ~lines 157-176; 22,846 bytes)
- Modify: `plugin/skills/wrap-up/leftover-routing.md` (step 1 "Compose the body", ~line 40, and the `$WRAP_UP_LEFTOVER_ARGS` shape line, ~line 55; 16,222 bytes)
- Test: `tests/build-micro-plan-conformance.test.js` (append)

**Interfaces:**
- Consumes: `specShapedBody` `keyFiles` (Task 1); `extractKeyFilesSection` from `plugin/bin/lib/issues/grouping.js`; `computeDiffFacts` from `plugin/bin/lib/dispatch/ceremony-derive.js` (the test/docs exclusion `micro-plan.md` condition 3 cites).

- [ ] **Step 1: Write the failing tests** (append to `tests/build-micro-plan-conformance.test.js`):

```js
test('AC5.1: a record composed with one implementation file in keyFiles satisfies micro-plan condition 3', () => {
  // body = specShapedBody({ currentState:'c', deliverables:'d', acceptanceCriteria:'a', releaseNote:'r', filedBy:'capture',
  //   footer:'_Filed by `capture` via specShapedBody._',
  //   keyFiles:[{path:'plugin/bin/lib/dream/scan.js',change:'fix'},{path:'tests/bin-lib/dream/scan.test.js',change:'cover'}] })
  // files = extractKeyFilesSection(body) → deep-equals ['plugin/bin/lib/dream/scan.js','tests/bin-lib/dream/scan.test.js']
  // computeDiffFacts(files.map(p => ({ path: p, additions: 1, deletions: 0 }))).implFiles === 1
});
test('AC5.1 control: a specShapedBody record without keyFiles yields no parseable Key Files (falls through)', () => {
  // extractKeyFilesSection(same call minus keyFiles) deep-equals [] and body has no '### Key Files'
});
for (const rel of ['plugin/skills/capture/SKILL.md', 'plugin/skills/reflect/SKILL.md', 'plugin/skills/wrap-up/leftover-routing.md']) {
  test(`AC6.1: ${rel} instructs passing keyFiles when the composer knows the affected files`, () => {
    // readText(path.join(ROOT, rel)) matches /keyFiles/ and /repo-relative/
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/build-micro-plan-conformance.test.js`
Expected: FAIL — the three AC6.1 tests fail (no `keyFiles` in the prose); AC5.1 passes once Task 1 has landed.

- [ ] **Step 3: Add one instruction to each producer**

- `capture/SKILL.md` step 3 (and the `needs:definition` step 1 `specShapedBody` call): pass `keyFiles: [{ path, change }]` when the composer knows the affected files — from a `### Key Files` list in the supplied `$BODY` (its bullets, which the section split would otherwise drop) or from the caller; repo-relative paths only, omitted when unknown.
- `reflect/SKILL.md` tangential compose: add `keyFiles` (the files the finding names, repo-relative) to the parenthesized arg list; update the `{specShapedBody output — …}` template line to note `## Technical Approach` / `### Key Files` when `keyFiles` is passed.
- `wrap-up/leftover-routing.md` step 1: add `keyFiles` = the section's touched/remaining files, repo-relative, when known; add `keyFiles?` to the `compose: {...}` shape line.
Each sentence names why in one clause: it lets build's micro-plan gate and dispatch's file-overlap grouping read the record.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-micro-plan-conformance.test.js tests/deferral-gate-conformance.test.js tests/bin-lib/skill-audit/`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/capture/SKILL.md plugin/skills/reflect/SKILL.md plugin/skills/wrap-up/leftover-routing.md tests/build-micro-plan-conformance.test.js
git commit -m "Name keyFiles in capture, reflect and leftover-routing composes — refs #2975"
```

---

### Final verification

| AC | Covered by |
|---|---|
| AC7.1 | full `npm test` run centrally at /build Common Step 5 |

`npm test > {scratch}/npm-test.log 2>&1; echo exit=$?` — full suite (AC7.1); run centrally by `/build` Common Step 5, not per task.
