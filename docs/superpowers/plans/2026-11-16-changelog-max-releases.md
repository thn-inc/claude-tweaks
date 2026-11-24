# Bounded CHANGELOG.md (changelog-max-releases) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `changelog-max-releases` policy key (default `0` = never trim) and a trim that keeps the header, the newest N release sections and an `## Older releases` footer, run by both release engines after a release, with the release probe, `extractChangelogRange` and `/claude-tweaks:tidy`'s Backfill respecting the footer's floor.

**Architecture:** All CHANGELOG grammar lives in `plugin/bin/lib/changelog.js` (footer parse/render, trim, footer-aware section parsing). A new `plugin/bin/lib/changelog-release-trim.js` holds the one engine-side procedure (read key, record tip, ancestry check, origin URL, call trim, never throw). `release-notes-publish.js` (pr-first) and `release-local.js` (local-merge) each call it and own their own commit. The probe imports the footer helper from `changelog.js`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI through injected `deps.git` runners.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T000512-record-5563/work/5563-spec.md` (record #5563; includes the plan-review Q1 decision of 2026-11-16 — the `Newest release removed:` footer line and the partial rule)

**Scope keywords:** changelog-max-releases, prependSection, applyToChangelogEntry, extractChangelogRange, parseChangelogVersions, Older releases

## Global Constraints

- Key: `changelog-max-releases`, `type: 'integer'`, `min: 0`, `default: 0`, `tier: 'advanced'`, `category: 'housekeeping'`. `0` means never trim. `-1`, `1.5`, `abc` resolve to `0` (AC15).
- Footer heading is exactly `## Older releases` (HEADER_RE must not match it). Its record line is exactly `Full file up to v{version}: commit {full sha}` and never changes after the first trim. Its second line is exactly `Newest release removed: v{version}`, rewritten by every trim that removes a section (spec, plan review Q1).
- Partial rule (spec, plan review Q1): `extractChangelogRange(...).partial` is `true` only when the file carries a footer and `compareVersions(oldVersion, newestRemoved) < 0`; `false` otherwise, including `oldVersion === newestRemoved`.
- Unreadable-policy line, exactly: `changelog trim: policy unreadable ({reason}); not trimmed`
- Failure line, exactly: `changelog trim: failed ({reason}); file left untrimmed`
- Trim-only commit subject, exactly: `chore: trim CHANGELOG.md to the newest {n} releases`. A commit carrying Highlights keeps `docs(changelog): append Highlights for {tag}`.
- "Newest" = file order; never sort. Header (text before the first HEADER_RE line) is kept byte-identical. A `## ` line HEADER_RE does not match belongs to the section above it (or the header).
- A release never fails because of the trim: on any trim error the file is left as it was and one line says so; the engine's exit code is what it would have been.
- With the key at `0`/absent, both engines make **no additional `git` calls** and write byte-identical files — existing tests in `tests/bin-lib/release-notes-publish.test.js`, `tests/bin-lib/release-local/` and `tests/changelog.test.js` must pass with no edit to their expectations (their fake `git` throws on any unexpected argv).
- This repository does not opt in: nothing under `CHANGELOG.md` or `.claude-tweaks/policy.yml` may appear in the branch diff.
- Do not trim inside release-please's own PR. #5508 is out of scope.
- Commit style: `{Verb} {what} — {detail}` with `refs #5563` (never `closes`/`fixes`).

Governing project skills (quoted verbatim):

- `.claude/skills/policy-key-addition`: "**The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit." / "**The tier.** The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one." / "**The doc row** in `_shared/policy-schema.md`. Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent." / "An invalid value resolves to the default with `invalid: true`."
- `.claude/skills/gh-api-module-pattern`: "**An argv array stops shell injection, not flag injection.** A caller-supplied value that begins with `-` is still read as an *option* by the command itself, so any such value needs an end-of-options separator ahead of it. For `git` the separator is **`--end-of-options`, not `--`**: `--` switches `rev-parse --verify` and `merge-base` into pathspec mode and silently changes what they resolve".
- `.claude/skills/driver-skill-outcome-taxonomy`: the release outcome is unchanged by a trim failure — "released": nothing failed to land (spec Deliverable 4).
- Source-scan suites: no new `child_process` spawns (all git goes through the engines' injected `deps.git`); no bare `fs.existsSync`/`fs.realpathSync` in `plugin/bin/`.

## Review Focus

1. A file that already carries a footer and is still within the bound (key lowered or count unchanged) must come back byte-identical — no second footer, no re-written sha, no re-written `Newest release removed:` line (AC8 test covers the third trim; Task 2 adds the within-bound-with-footer case). A later trim that removes sections rewrites only the `Newest release removed:` line; every other footer byte stays.
2. A CHANGELOG whose header contains a stray `## ` line before the first release heading — header stays byte-identical (Task 2 AC10 test covers header placement).
3. A file with no release sections at all, or fewer than `count`, never gains a footer (Task 2 test `trimChangelog leaves a file within the bound unchanged`).
4. `release-notes-publish.js` with no Highlights to add *and* nothing to trim must still make no commit and no push (Task 4 test).
5. The release-local trim commit failing after the file was written must restore the file and the index, then still push the release (Task 5 AC4 test stubs the commit to throw, not only the trim).

---

### Task 1: Policy key and reader

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (add the `POLICY_KEYS` row near the other housekeeping keys)
- Modify: `plugin/bin/lib/policy.js` (add and export `readChangelogMaxReleases`)
- Modify: `plugin/skills/_shared/policy-schema.md` (one short table row; file is 49,189 B against the 52,500 B rail — the row must stay under ~400 B, leaving > 2,800 B headroom)
- Test: `tests/policy-schema.test.js` (bump `POLICY_KEYS.length` 109 → 110)
- Test: `tests/policy.test.js`

**Interfaces:**
- Produces: `readChangelogMaxReleases(readPolicy: () => string | null) -> { count: number, error: string | null }` in `plugin/bin/lib/policy.js`. `readPolicy` returns the raw `policy.yml` text, `null` when absent, and may throw. Absent → `{ count: 0, error: null }`; throw → `{ count: 0, error: <err.message> }`; otherwise `count = resolveValue('changelog-max-releases', parseFlatLines(raw)['changelog-max-releases'])`.

- [ ] **Step 1: Write the failing tests** in `tests/policy.test.js`:

```js
test('AC15.1: changelog-max-releases values -1, 1.5 and abc resolve to 0', () => {
  for (const v of ['-1', '1.5', 'abc']) {
    assert.deepStrictEqual(readChangelogMaxReleases(() => `changelog-max-releases: ${v}\n`), { count: 0, error: null });
  }
});
test('changelog-max-releases: absent file and absent key are 0; 50 is 50', () => {
  assert.deepStrictEqual(readChangelogMaxReleases(() => null), { count: 0, error: null });
  assert.deepStrictEqual(readChangelogMaxReleases(() => 'git-strategy: worktree\n'), { count: 0, error: null });
  assert.deepStrictEqual(readChangelogMaxReleases(() => 'changelog-max-releases: 50\n'), { count: 50, error: null });
});
test('changelog-max-releases: an unreadable policy file is reported, not read as 0 silently', () => {
  const r = readChangelogMaxReleases(() => { throw new Error('EISDIR: illegal operation on a directory'); });
  assert.strictEqual(r.count, 0);
  assert.match(r.error, /EISDIR/);
});
```
and bump the count pin in `tests/policy-schema.test.js` to `110`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/policy.test.js tests/policy-schema.test.js`
Expected: FAIL after Step 1 (`readChangelogMaxReleases is not a function`; length 109 !== 110)

- [ ] **Step 3: Implement** the `POLICY_KEYS` row (`summary` e.g. "Keeps only this many of the newest releases in CHANGELOG.md, moving the rest behind a footer that names where they are; 0 never trims."), `readChangelogMaxReleases` in `policy.js`, and the `policy-schema.md` row: `` | `changelog-max-releases` | `policy.yml` | `bin/lib/release-notes-publish.js`, `bin/release-local.js` | `0` (never trim) | … | `` — state: unset/`0` → no trim; a non-integer or negative value resolves to `0`; trimming leaves an `## Older releases` footer; detail lives in `docs/releasing.md`. Match the column layout of the neighbouring `release-hook` row.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/policy.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Add the changelog-max-releases policy key — integer, default 0 (never trim), refs #5563`

---

### Task 2: Footer, trim and footer-aware parsing in changelog.js

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/changelog.js`
- Test: `tests/changelog.test.js` (add tests only; existing expectations untouched)

**Interfaces:**
- Produces (all exported from `plugin/bin/lib/changelog.js`):
  - `FOOTER_HEADING = '## Older releases'`
  - `parseChangelogFooter(text: string) -> { index: number, sha: string, version: string, newestRemoved: string | null, repoUrl: string | null } | null` — `index` is the offset of the `## Older releases` line (multiline `^…$`); returns `null` unless that heading **and** a `Full file up to v(\d+\.\d+\.\d+): commit ([0-9a-f]{40}|[0-9a-f]{64})` line under it are both present. `newestRemoved` is read from a `Newest release removed: v(\d+\.\d+\.\d+)` line under the heading (`null` when that line is absent). `repoUrl` is read back from the footer's permanent-link line when present.
  - `renderChangelogFooter({ version, sha, newestRemoved, repoUrl }) -> string` — exactly:
    ```
    ## Older releases

    Full file up to v{version}: commit {sha}

    Newest release removed: v{newestRemoved}

        git show {sha}:CHANGELOG.md

    A release removed by a later trim keeps its notes in the file at its own tag, without the Highlights block added after the tag: `git show v<version>:CHANGELOG.md`.
    ```
    and, only when `repoUrl` is non-null, a blank line then
    ```
    - [CHANGELOG.md at {sha.slice(0, 12)}]({repoUrl}/blob/{sha}/CHANGELOG.md)
    - [All releases]({repoUrl}/releases)
    ```
    ending with one `\n`.
  - `trimChangelog(text: string, count: number, { sha, repoUrl }?: { sha?: string, repoUrl?: string | null }) -> { text: string, removed: string[] }` — `count` must be an integer ≥ 1 (else throw `TypeError`). Sections = HEADER_RE matches in file order, the last one ending at the footer's `index` when a footer exists. Within the bound → `{ text, removed: [] }` unchanged (no footer added). Otherwise: header + the first `count` sections' text verbatim (from heading start to the next section's heading, every byte kept — AC1 says byte-identical) + footer; only the gap between the last kept section and the footer is normalised (to exactly one blank line). The AC1 test also compares raw bytes: `r.text.slice(0, parseChangelogFooter(r.text).index)` equals the original text up to the 51st heading with only that final gap allowed to differ. Footer = the existing footer text with only its `Newest release removed: v…` line replaced by `removed[0]` (every other byte, the sha line included, unchanged; insert the line after the record line if an existing footer lacks it), else `renderChangelogFooter({ version: <first section's version>, sha, newestRemoved: removed[0], repoUrl: repoUrl ?? null })` — throw `Error('trimChangelog: a first trim needs a commit sha')` when no footer and no `sha`. `removed` = versions of the dropped sections in file order, so `removed[0]` is the newest removed.
  - `parseChangelogVersions` — unchanged shape; the last section's body now ends at the footer's `index` when a footer exists (AC11).
  - `extractChangelogRange` — unchanged array return; additionally sets a **non-enumerable** boolean property `partial` (via `Object.defineProperty`) on the returned array: `true` when a footer exists with a non-null `newestRemoved` and `compareVersions(oldVersion, newestRemoved) < 0`; else `false` (including `oldVersion` equal to `newestRemoved`, and a footer-less file). This is the plan-review Q1 rule; the release probe's floor (Task 6) stays the oldest retained section. Non-enumerable so existing `deepStrictEqual(range, [])` assertions still hold.

- [ ] **Step 1: Write the failing tests** (build fixtures programmatically: `sixty()` returns `{ text, header, versions }` — a `# Changelog\n\nintro prose\n\n` header, then 60 sections newest first cycling the three heading forms `## v1.0.N — title N`, `## [1.0.N](https://github.com/o/r/compare/v1.0.M...v1.0.N) (2026-01-01)` and `## 1.0.N (2026-01-01)`, each with a `### Features` body):

```js
test('AC1.1 AC1.2: trim to 50 of a 60-section, three-grammar file keeps header and newest 50 byte-identical, adds the footer, returns the 10 removed', () => {
  const { text, header, versions } = sixty();
  const r = trimChangelog(text, 50, { sha: 'a'.repeat(40), repoUrl: 'https://github.com/o/r' });
  assert.ok(r.text.startsWith(header));
  assert.deepStrictEqual(parseChangelogVersions(r.text), parseChangelogVersions(text).slice(0, 50));
  assert.deepStrictEqual(r.removed, versions.slice(50));
  assert.ok(parseChangelogFooter(r.text));
});
test('AC1.3: a second run on its own output changes nothing', () => {
  const once = trimChangelog(sixty().text, 50, { sha: 'a'.repeat(40) }).text;
  assert.deepStrictEqual(trimChangelog(once, 50), { text: once, removed: [] });
});
test('AC10.1 AC10.2: a ## line HEADER_RE does not match stays inside the section above; it is neither counted nor removed on its own', () => {
  // fixture: 3 sections, a `## Notes` line inside the 2nd section; trim to 2
  // assert: kept text contains `## Notes`, removed has exactly 1 version (the 3rd), parseChangelogVersions(r.text).length === 2
});
test('AC11.1: the body extractChangelogRange returns for the oldest retained section does not include the footer', () => {
  const t = trimChangelog(sixty().text, 50, { sha: 'a'.repeat(40) }).text;
  const range = extractChangelogRange(t, '0.0.1', '9.9.9');
  assert.doesNotMatch(range[range.length - 1].body, /Older releases|Full file up to/);
});
test('AC6.1 AC6.2: a range starting below the newest removed version is partial; one starting at it is not', () => {
  // trimmed fixture (60 → 50); newestRemoved = versions[50]
  // oldVersion below newestRemoved → returns the sections it has, range.partial === true
  // oldVersion === newestRemoved → range.partial === false; a footer-less file → range.partial === false
  // parseChangelogFooter(trimmed).newestRemoved === versions[50]
});
test('a later trim rewrites only the Newest release removed line', () => {
  // trim 60 → 50, then 50 → 40 on its own output: sha and record line unchanged, newestRemoved === versions[40]
});
test('AC15.2: count 1 keeps one section and the footer', () => {
  const r = trimChangelog(sixty().text, 1, { sha: 'b'.repeat(40) });
  assert.strictEqual(parseChangelogVersions(r.text).length, 1);
  assert.ok(parseChangelogFooter(r.text));
});
test('trimChangelog leaves a file within the bound unchanged, with or without a footer, and never adds a footer then', () => { /* 3 sections, count 5 → same text; a footered file within bound → same text */ });
test('parseChangelogFooter: no origin → no links; heading without its record line → null', () => { /* renderChangelogFooter({repoUrl:null}) has no "](" ; a bare "## Older releases\n" → null */ });
```
Fill each commented test with concrete assertions as described in its comment.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/changelog.test.js`
Expected: FAIL after Step 1 (`trimChangelog is not a function`)

- [ ] **Step 3: Implement** the Interfaces above in `changelog.js`. Reuse `HEADER_RE` via `matchAll`; the footer regexes are declared once beside it and used by every footer reader (no other file may hold its own footer pattern).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/changelog.test.js`
Expected: PASS (all old and new tests)

- [ ] **Step 5: Commit** — `Add trimChangelog and the Older releases footer to changelog.js — footer-aware parsing and partial ranges, refs #5563`

---

### Task 3: Engine-side trim procedure

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/changelog-release-trim.js`
- Test: `tests/bin-lib/changelog-release-trim.test.js`

**Interfaces:**
- Consumes: `readChangelogMaxReleases` (Task 1), `trimChangelog` (Task 2), `parseGitHubRemote` from `plugin/bin/lib/release-local/changelog.js`.
- Produces: `prepareTrim({ text, readPolicy, git, ancestorRefs, stderr, trim = trimChangelog }) -> { text: string, count: number, removed: string[] } | null`
  - `readPolicy`: `() => string | null`, may throw. `git(args: string[]) -> string`, throws on failure. `ancestorRefs`: ordered candidate refs (e.g. `['refs/remotes/origin/main', 'refs/heads/main']`); the first that `git rev-parse --verify --quiet --end-of-options <ref>^{commit}` resolves is the default branch ref.
  - Order: (1) `readChangelogMaxReleases(readPolicy)`; `error` → `stderr('changelog trim: policy unreadable ({error}); not trimmed\n')`, return `null`; `count === 0` → return `null` **with no git call**. (2) Inside one `try`: `sha = git(['rev-parse', 'HEAD']).trim()`; resolve the default ref (none resolves → throw `no default branch ref among …`); `git(['merge-base', '--is-ancestor', '--end-of-options', sha, ref])` throwing → throw `Error(`${sha} is not an ancestor of ${ref}`)`; `repoUrl` = `parseGitHubRemote(git(['remote', 'get-url', 'origin']))?.url` with a throwing `remote get-url` read as no origin (`null`); `result = trim(text, count, { sha, repoUrl })`; `result.text === text` → return `null`; else return `{ text: result.text, count, removed: result.removed }`. (3) `catch (err)` → `stderr('changelog trim: failed ({err.message}); file left untrimmed\n')`, return `null`. Never throws.

- [ ] **Step 1: Write the failing tests** — fake-git tests for the branches, plus real-git fixtures (`tests/helpers/git-fixtures.js`'s `committedRepo`/`cleanGitEnv` or a local `git(cwd, …)` like `tests/bin-lib/residue/probes-release-remote.test.js`):

```js
test('key 0 or absent: returns null and makes no git call', () => { /* git fake records calls; assert calls.length === 0 */ });
test('AC13.2 (helper): an unreadable policy prints the unreadable line and returns null', () => { /* stderr === 'changelog trim: policy unreadable (EISDIR …); not trimmed\n' */ });
test('AC14.1 (helper): a HEAD that is not an ancestor of the default branch is not trimmed and prints the failure line', () => { /* merge-base fake throws; result null; stderr matches /^changelog trim: failed \(.* is not an ancestor of refs\/heads\/main\); file left untrimmed\n$/ */ });
test('AC4 (helper): a trim function that throws leaves the text untrimmed and prints one failure line', () => { /* trim: () => { throw new Error('boom') } → null, stderr exactly one line containing (boom) */ });
test('AC8.1: the footer commit is the same string after a second and a third trim', () => {
  // real repo: commit a 6-section CHANGELOG; prepareTrim count 4 → write+commit; add a section via prependSection-equivalent text edit + commit; trim again; again for a third time
  // parseChangelogFooter(final).sha === parseChangelogFooter(first).sha === the sha recorded at the first trim
});
test('AC8.2: a fixture repository with no origin gets a footer with the sha and no link', () => { /* no `git remote`; footer has the sha line and no "](" */ });
test('AC9.1 AC9.2: a version removed by a later trim is absent from the file at the footer commit and present in the file at its own tag', () => {
  // count 1. Tagged releases v1.0.0, v1.0.1 → trim #1 (footer records v1.0.1 at sha S, removes 1.0.0).
  // Tagged release v1.0.2 (its tag holds 1.0.2 + 1.0.1 + footer) → trim #2 removes 1.0.1.
  // Tagged release v1.0.3 → trim #3 removes 1.0.2.
  // For v = '1.0.2': no heading in `git show S:CHANGELOG.md`; heading present in `git show v1.0.2:CHANGELOG.md`; absent from HEAD's file.
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/changelog-release-trim.test.js`
Expected: FAIL (`Cannot find module '../../plugin/bin/lib/changelog-release-trim.js'`)

- [ ] **Step 3: Implement** `prepareTrim` per Interfaces; module header comment names its two callers.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/changelog-release-trim.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Add the engine-side CHANGELOG trim procedure — key read, tip ancestry check, origin links, never throws, refs #5563`

---

### Task 4: Trim in release-notes-publish (pr-first)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/release-notes-publish.js`
- Modify: `plugin/bin/release-notes-publish.js` (CLI wrapper: a `readPolicy` dep, defaulted to an fs read of `{root}/.claude-tweaks/policy.yml`)
- Test: `tests/bin-lib/release-notes-publish.test.js` (add tests; existing expectations untouched — AC2.2)

**Interfaces:**
- Consumes: `prepareTrim` (Task 3); `resolvePolicyKeys` from `plugin/bin/lib/policy-schema.js` for `integration-branch`.
- Produces: `run(argv, deps)` (lib) gains optional `deps.trimChangelog` (default `changelog.js`'s `trimChangelog`), passed as `prepareTrim`'s `trim`, and optional `deps.readPolicy: () => string | null` (may throw; absent → the key reads as `0`). The CLI wrapper `plugin/bin/release-notes-publish.js` supplies `readPolicy` from its **own** injectable `deps.readPolicy`, defaulting to an fs read of `{root}/.claude-tweaks/policy.yml` (ENOENT → `null`) — never through `deps.readFile`, so the CLI test asserting `seen.reads` equals exactly `[CHANGELOG.md]` (tests/bin-lib/release-notes-publish.test.js ~line 268) and the one-release `readFile: fail` test (~line 276) stay green unedited (AC2).

Behavior: the key is read **first**, through `readChangelogMaxReleases(deps.readPolicy ?? (() => null))`. With the key at `0` (or the policy absent) the run is exactly today's: no extra read, no extra git call, the early exits unchanged. With the key above `0`: restructure `run` so the "fewer than 2 releases" and "no Release-Note: trailers" exits skip only the Highlights work (keep their existing stdout lines verbatim). Then: `changelog = deps.readFile('CHANGELOG.md')` — on the early-exit paths this read happens only when the key is above `0`, and any read or trim error there is caught by the never-throw guard (failure line, exit code unchanged); `highlighted = (pair && block) ? applyToChangelogEntry(changelog, block) : null`; `base = highlighted ?? changelog`; an unreadable policy is reported by `prepareTrim`'s unreadable line (pass `readPolicy` through to it); default branch = `integration-branch` from `resolvePolicyKeys(['integration-branch'], { policyRaw })` → else `git symbolic-ref --short refs/remotes/origin/HEAD` stripped of `origin/` → else `main` — these branch reads happen **only when the key is above 0** (resolve the branch lazily inside a thunk, or read the key first); `ancestorRefs = ['refs/remotes/origin/{branch}', 'refs/heads/{branch}']`; `trimmed = prepareTrim({ text: base, … })`. If `changelog` is null skip the trim. Final text = `trimmed?.text ?? highlighted`. When non-null: write, `git add CHANGELOG.md`, commit with the Highlights subject when `highlighted !== null` else `chore: trim CHANGELOG.md to the newest {n} releases`, `git push`, one stdout line. When both null: today's "skipped" line, no commit, no push.

- [ ] **Step 1: Write the failing tests** (extend `makeDeps` locally in new tests, e.g. a `files['.claude-tweaks/policy.yml']` entry and git keys `rev-parse HEAD`, `rev-parse --verify --quiet --end-of-options refs/remotes/origin/main^{commit}`, `merge-base --is-ancestor --end-of-options <sha> refs/remotes/origin/main`, `remote get-url origin`, `symbolic-ref --short refs/remotes/origin/HEAD`):

```js
test('AC2.1 (publish): with the key 0 or absent the written CHANGELOG is byte-identical to the base behavior', () => { /* run with policy 'changelog-max-releases: 0' and with none; compare state.files['CHANGELOG.md'] against applyToChangelogEntry(original, block) */ });
test('AC3.1 (publish): key 2 and four sections → one commit holding the Highlights block, two sections and the footer', () => { /* four-section changelog (newest = the release); assert one `commit -m docs(changelog): append Highlights for v1.3.0`, parseChangelogVersions(written).length === 2, Highlights present, parseChangelogFooter(written) non-null */ });
test('AC4.1 (publish): trimChangelog stubbed to throw → Highlights still committed, file untrimmed, one failure line, exit 0', () => {});
test('AC12.2: the Highlights writer over a footer-bearing file leaves the footer byte-identical and last', () => { /* applyToChangelogEntry on a 1-section + footer fixture; footer text endsWith-equal */ });
test('AC13.1: key 2 with no Release-Note: trailers still trims and commits with the trim-only subject', () => { /* commitBodies with no trailers; git log shows `commit -m chore: trim CHANGELOG.md to the newest 2 releases` */ });
test('AC13.2: a policy.yml that exists and cannot be read is not trimmed and prints the unreadable line', () => { /* readFile throws for .claude-tweaks/policy.yml; stderr has `changelog trim: policy unreadable (`; no trim commit */ });
test('AC14.2 (publish): a tip that is not an ancestor of the default branch is not trimmed and prints the failure line', () => {});
test('publish: no Highlights and nothing to trim → no commit, no push', () => {});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/release-notes-publish.test.js`
Expected: FAIL after Step 1 (new tests: no trim commit / missing footer)

- [ ] **Step 3: Implement** the behavior above; update the module header's exit-code paragraph to say a trim failure never changes the exit code.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/release-notes-publish.test.js`
Expected: PASS (old and new — including, unedited, the CLI test asserting `seen.reads` is exactly `[CHANGELOG.md]` and `an absolute --root works when deps.cwd() throws (deleted cwd)`)

- [ ] **Step 5: Commit** — `Trim CHANGELOG.md in release-notes-publish when changelog-max-releases is set — rides the Highlights commit, refs #5563`

---

### Task 5: Trim in release-local (local-merge)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/release-local.js`
- Test: `tests/bin-lib/release-local/changelog.test.js` (AC12.1 prependSection)
- Test: `tests/bin-lib/release-local/cli.test.js` (or `acceptance.test.js`, whichever already drives `run` against a real git fixture — read both first; add tests, edit no expectation)

**Interfaces:**
- Consumes: `prepareTrim` (Task 3).
- Produces: `run(argv, deps)` honours optional `deps.trimChangelog` (default `changelog.js`'s `trimChangelog`).

Behavior: after `stage = 'tagged'` and **before** the push, call `prepareTrim({ text: deps.readFile('CHANGELOG.md'), readPolicy: () => policyRaw, git: deps.git, ancestorRefs: [`refs/heads/${branch}`], stderr: deps.stderr, trim })` (local ref: the release commit is not pushed yet). On a non-null result, in its own `try`: write, `git add -- CHANGELOG.md`, `withIndexLockRetry(deps.git)(['commit', '-m', 'chore: trim CHANGELOG.md to the newest {n} releases'])`; on a throw, write the original text back, `git add -- CHANGELOG.md` (index back to HEAD), print `changelog trim: failed ({reason}); file left untrimmed`, and continue. Never touch `stage`, `editedPaths` or the partial-state recovery messages. The tag stays on the release commit (full file at the tag — AC9's route).

- [ ] **Step 1: Write the failing tests**

```js
test('AC12.1: prependSection over a footer-bearing file leaves the footer byte-identical and still the last section', () => {});
test('AC2.1 (local): with the key 0 or absent the released CHANGELOG is byte-identical to base and no extra git call runs', () => {});
test('AC3.2 (local): key 2 and a four-section file → the release commit holds the new section; HEAD holds two sections plus the footer; the tag holds the untrimmed file', () => {});
test('AC4.2 (local): trimChangelog stubbed to throw → released exit 0, file untrimmed, one failure line', () => {});
test('local: the trim commit throwing restores CHANGELOG.md and the index, prints the failure line, and the release still exits 0', () => {});
test('AC14.3 (local): a HEAD that is not an ancestor of the local branch is not trimmed and prints the failure line', () => { /* inject a git wrapper that throws for merge-base --is-ancestor */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/release-local/changelog.test.js tests/bin-lib/release-local/cli.test.js`
Expected: FAIL after Step 1 (new trim tests)

- [ ] **Step 3: Implement** the behavior above.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/release-local/`
Expected: PASS (whole directory, old and new)

- [ ] **Step 5: Commit** — `Trim CHANGELOG.md after a local-merge release when changelog-max-releases is set — separate trim commit after the tag, refs #5563`

---

### Task 6: Release probe floor and tidy Backfill

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/residue/probes/release.js`
- Modify: `plugin/skills/tidy/SKILL.md` (Backfill row, line ~136; 43,676 B, ample headroom)
- Test: `tests/bin-lib/residue/probes-release-remote.test.js`

**Interfaces:**
- Consumes: `parseChangelogFooter`, `parseChangelogVersions`, `compareVersions` from `plugin/bin/lib/changelog.js` (`require('../../changelog')`).

Behavior: after reading `changelog`, when `parseChangelogFooter(changelog)` is non-null, `floor` = the minimum (by `versionGte`) of the file's retained heading versions; the tag → heading loop skips any `v` with `!versionGte(v, floor)`. No footer → today's behavior exactly (AC5.2). Backfill row gains: "When the file ends in an `## Older releases` footer, insert the heading above the footer, in version order." (Probe-respecting-the-floor is what keeps tidy from re-adding trimmed headings.)

- [ ] **Step 1: Write the failing tests**

```js
test('AC5.1: tags v1.0.0–v1.0.5, bootstrap 1.0.0, a trimmed file with 1.0.3–1.0.5 plus the footer → no finding', () => {});
test('AC5.2: the same file without the footer reports the three missing versions, as today', () => { /* subjects for v1.0.0, v1.0.1, v1.0.2 */ });
```
Build the footer with `renderChangelogFooter` from `changelog.js` (real producer, not hand-typed).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/residue/probes-release-remote.test.js`
Expected: FAIL after Step 1 (AC5.1 reports three findings)

- [ ] **Step 3: Implement** the floor and the Backfill clause.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/residue/`
Expected: PASS

- [ ] **Step 5: Commit** — `Respect the CHANGELOG footer floor in the release probe and tidy Backfill, refs #5563`

---

### Task 7: Docs — version-check notice and releasing guide

**Role:** integration

**Files:**
- Modify: `plugin/skills/init/bootstrap/version-check.md` (6,297 B)
- Modify: `docs/releasing.md`

Behavior:
- `version-check.md`: the snippet prints `JSON.stringify({ entries: r, partial: r.partial })` where `r = extractChangelogRange(…)`, and the missing-file branch prints `{"entries":[],"partial":false}` (one output shape on both branches); the "An empty array means…" paragraph is rewritten to describe the object (empty `entries` → skip silently). The Changelog notice policy paragraph says: when `partial` is `true`, the range reaches below the trimmed file's floor, so tell the reader the summary is partial and point at the footer's `git show {sha}:CHANGELOG.md` for older notes.
- `docs/releasing.md`: a short section on `changelog-max-releases` — off by default; when set, both engines trim after a release (pr-first in the Highlights commit of `release-notes-publish.js`, local-merge in a separate commit after the tag); the `## Older releases` footer and its two routes to removed notes (the recorded commit, and `git show v<version>:CHANGELOG.md`, without Highlights); a trim never fails a release; opt in only once every session runs this release or newer (an older build reports trimmed versions as missing and its tidy would add them back); after opting in, check the first release-please PR leaves the footer last.

- [ ] **Step 1: Write the failing test** in `tests/changelog.test.js`:

```js
test('AC6.3: version-check.md prints the partial flag and tells the reader the summary is partial', () => {
  const text = readText('plugin/skills/init/bootstrap/version-check.md'); // tests/helpers/read-skill
  assert.match(text, /partial: r\.partial/);
  assert.match(text, /summary is partial/);
  assert.match(text, /entries: \[\], partial: false/); // the missing-file branch prints the same shape
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/changelog.test.js`
Expected: FAIL after Step 1 (no `partial: r.partial` in version-check.md)

- [ ] **Step 3: Edit** both docs as described.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/changelog.test.js tests/payload-boundary.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — `Document changelog-max-releases — version-check partial notice and the releasing guide, refs #5563`

---

### Task 8: AC7 proof on a copy (no commit)

**Role:** transcription

**Files:**
- Waived `CHANGELOG.md`: read-only input copied to the scratchpad; never modified (AC7.3).

- [ ] **Step 1:** Copy `CHANGELOG.md` to the session scratchpad, run `trimChangelog(text, 50, { sha: <git rev-parse HEAD>, repoUrl: 'https://github.com/thn-inc/claude-tweaks' })` from a scratch node script, and print: bytes before/after, `parseChangelogVersions` count after (expect 50), header byte-identical (`after.startsWith(text.slice(0, firstHeadingIndex))` → true), footer parsed (true).
- [ ] **Step 2:** Write the full output to `"$PIPELINE_RUN_DIR/evidence/ac7-trim-copy.txt"` (absolute run-dir path, `mkdir -p` first, plain Bash redirect) and log one `decisions.md` entry with `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file …` naming AC7.1/AC7.2, the command shape, the before/after sizes and the evidence path.
- [ ] **Step 3:** Confirm `git diff --name-only origin/main...HEAD` lists neither `CHANGELOG.md` nor `.claude-tweaks/policy.yml` (AC7.3); the PR body states the before/after sizes (AC7.2) — added at the PR checklist refresh.

Covers AC7.1 (header byte-identical, 50 sections and the footer), AC7.2 (sizes stated in the PR), AC7.3 (nothing under `CHANGELOG.md` or `.claude-tweaks/policy.yml` in the diff).

Waived AC7.1: a scratch proof on a copy (Task 8 Steps 1-2, recorded as AC evidence), not a committed test — the spec forbids committing the trimmed file.
Waived AC7.2: stated in the PR body, not testable in-suite (Task 8 Step 3).
Waived AC7.3: a diff-name check in Task 8 Step 3, not a committed test.
Waived AC2.2: proven by Tasks 4 and 5 Step 4 and Common Step 5's full suite running those files' existing tests unedited; `git diff origin/main...HEAD -- tests/changelog.test.js tests/bin-lib/release-notes-publish.test.js tests/bin-lib/release-local/` must show added lines only.
