# Release bootstrap conflict marker gaps (#2323) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `CONFLICT_MARKERS` in `plugin/bin/lib/init/release-bootstrap.js` to detect three
more real-tooling shapes as conflicts — bare `goreleaser.yaml`/`goreleaser.yml`, semantic-release
configured under a `package.json` `release` key, and `standard-version` (`.versionrc*`) — so a
repo using any of them is no longer bootstrapped as `fresh` and layered with a second engine.

**Architecture:** `CONFLICT_MARKERS` is a flat array of `{ tool, test(name, isDir) }` entries
that `detectReleaseProcess` walks once per root directory entry. The two new filename shapes
(goreleaser, standard-version) slot into that array unchanged. The `package.json` `release` key
needs file content, not just a name, so it becomes a second detection pass run once, right after
the name-marker loop and before the existing `release-please-config.json` check — matching the
record's own instruction ("add it as a second detection pass after the name scan").

**Tech Stack:** Node.js (`node:test`), no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-09-14T203240-record-2323/work/2323-spec.md` (materialized
from GitHub issue #2323)

## Global Constraints

- Detection stays a self-contained presence check (file header comment, lines 9-16) — never
  `_shared/existing-convention-detection.md`'s genre-grammar procedure.
- Never treat `v*` tags as conflict evidence (unrelated to this change, but do not regress it).
- Match the surrounding style: one-line marker entries, `!isDir &&` guard, `evidence` is the bare
  matched path/dirname.

---

### Task 1: Add goreleaser/standard-version markers and the package.json release-key pass

**Files:**
- Modify: `plugin/bin/lib/init/release-bootstrap.js:44-49` (CONFLICT_MARKERS array), `:123-151`
  (`detectReleaseProcess`)
- Modify: `plugin/skills/init/bootstrap/step-21-release.md:23` (conflict row prose)
- Test: `tests/bin-lib/init/release-bootstrap.test.js`

**Interfaces:**
- Consumes: `readJson(file)` (already defined, `release-bootstrap.js:91`) — returns
  `{ parsed }` on success (including `{ parsed: undefined }` for ENOENT) or `{ error }` on
  failure; `rootEntries(root)` (already defined, `:56`) — returns `[{ name, isDir }]`.
- Produces: no new exported names — `CONFLICT_MARKERS` and `detectReleaseProcess` keep their
  existing signatures and are already exported (`module.exports`, `:399-404`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/init/release-bootstrap.test.js`, immediately after the existing
`'detectReleaseProcess: semantic-release, changesets, goreleaser markers -> conflict naming the
tool and evidence'` test (after line 31, before the `'detectReleaseProcess: a foreign
release-please config...'` test):

```javascript
test('detectReleaseProcess: bare goreleaser.yaml/.yml, package.json release key, .versionrc* -> conflict naming the tool (#2323)', () => {
  const a = tmp(); write(a, 'goreleaser.yaml', 'builds: []');
  assert.deepEqual(rb.detectReleaseProcess(a), { verdict: 'conflict', tool: 'goreleaser', evidence: 'goreleaser.yaml' });
  const b = tmp(); write(b, 'goreleaser.yml', 'builds: []');
  assert.equal(rb.detectReleaseProcess(b).tool, 'goreleaser');
  const c = tmp(); write(c, 'package.json', JSON.stringify({ name: 'x', release: { branches: ['main'] } }));
  assert.deepEqual(rb.detectReleaseProcess(c), { verdict: 'conflict', tool: 'semantic-release', evidence: 'package.json' });
  const d = tmp(); write(d, '.versionrc.json', '{}');
  assert.deepEqual(rb.detectReleaseProcess(d), { verdict: 'conflict', tool: 'standard-version', evidence: '.versionrc.json' });
  const e = tmp(); write(e, '.versionrc', '{}');
  assert.equal(rb.detectReleaseProcess(e).tool, 'standard-version');
});

test('detectReleaseProcess: package.json with no release key, or a non-object release value, stays fresh (#2323)', () => {
  const a = tmp(); write(a, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
  assert.deepEqual(rb.detectReleaseProcess(a), { verdict: 'fresh' });
  const b = tmp(); write(b, 'package.json', JSON.stringify({ name: 'x', release: 'v1' }));
  assert.deepEqual(rb.detectReleaseProcess(b), { verdict: 'fresh' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/init/release-bootstrap.test.js`
Expected: FAIL — `goreleaser.yaml`/`goreleaser.yml`/`.versionrc*` are not yet matched by any
`CONFLICT_MARKERS` entry, so `detectReleaseProcess` returns `{ verdict: 'fresh' }` instead of
`conflict` for those three, and the `package.json` `release` key is not yet read at all so that
fixture also returns `fresh`.

- [ ] **Step 3: Implement**

In `plugin/bin/lib/init/release-bootstrap.js`, replace the `CONFLICT_MARKERS` array (lines 44-49):

```javascript
const CONFLICT_MARKERS = [
  { tool: 'semantic-release', test: (name, isDir) => !isDir && /^\.releaserc(\..+)?$/.test(name) },
  { tool: 'semantic-release', test: (name, isDir) => !isDir && /^release\.config\..+$/.test(name) },
  { tool: 'changesets', test: (name, isDir) => isDir && name === '.changeset' },
  { tool: 'goreleaser', test: (name, isDir) => !isDir && /^\.goreleaser\..+$/.test(name) },
  { tool: 'goreleaser', test: (name, isDir) => !isDir && /^goreleaser\.ya?ml$/.test(name) },
  { tool: 'standard-version', test: (name, isDir) => !isDir && /^\.versionrc(\..+)?$/.test(name) },
];
```

Then, in `detectReleaseProcess` (lines 123-151), insert the second detection pass immediately
after the name-marker loop and before the existing `CONFIG_FILE` check:

```javascript
function detectReleaseProcess(root, { integrationModel } = {}) {
  const entries = rootEntries(root);
  for (const { name, isDir } of entries) {
    for (const marker of CONFLICT_MARKERS) {
      if (marker.test(name, isDir)) return { verdict: 'conflict', tool: marker.tool, evidence: isDir ? `${name}/` : name };
    }
  }
  // Second pass: semantic-release configured under package.json's `release` key — this needs
  // file content, not just a name match, so it runs once here rather than as a CONFLICT_MARKERS
  // entry (whose `test(name, isDir)` signature only ever sees the bare directory listing).
  if (entries.some((e) => !e.isDir && e.name === 'package.json')) {
    const { parsed } = readJson(path.join(root, 'package.json'));
    if (parsed && typeof parsed === 'object' && parsed.release && typeof parsed.release === 'object') {
      return { verdict: 'conflict', tool: 'semantic-release', evidence: 'package.json' };
    }
  }
  if (entries.some((e) => !e.isDir && e.name === CONFIG_FILE)) {
    const result = readJson(path.join(root, CONFIG_FILE));
    if (result.error && result.error !== 'unparseable') {
      return { verdict: 'conflict', tool: `release-please (config unreadable: ${result.error})`, evidence: CONFIG_FILE };
    }
    if (!isBootstrapShaped(result.parsed)) return { verdict: 'conflict', tool: 'release-please (foreign config)', evidence: CONFIG_FILE };
    const manifestExists = entries.some((e) => !e.isDir && e.name === MANIFEST_FILE);
    if (manifestExists) {
      if (integrationModel === 'pr-first' && !lexists(path.join(root, WORKFLOW_FILE))) {
        return { verdict: 'fresh', partial: 'workflow' };
      }
      return { verdict: 'already-bootstrapped' };
    }
  }
  return { verdict: 'fresh' };
}
```

(Only the two new lines — the `CONFLICT_MARKERS` additions and the inserted `package.json`
release-key block — actually change; the rest of the function body is shown for placement
context and must remain byte-identical.)

In `plugin/skills/init/bootstrap/step-21-release.md`, replace line 23's conflict row:

```markdown
| `conflict` | Nothing — a competing tool was found: `.releaserc*` / `release.config.*` / a `package.json` `release` key (semantic-release), `.changeset/` (changesets), `.goreleaser.*` / bare `goreleaser.yaml` or `goreleaser.yml` (goreleaser), `.versionrc*` (standard-version), a foreign `release-please-config.json`, or a manifest/workflow already on disk with no config to match (`release-please (partial files)` — this step never overwrites a file it did not itself create) | `release: conflict — {tool}` (name the `evidence` path). Removing the tool clears it on the next `/init` run |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/init/release-bootstrap.test.js`
Expected: PASS — all tests in the file, including the two new ones and the pre-existing fixtures
(goreleaser dotfile, semantic-release dotfiles, changesets, plain `package.json` with no
`release` key, etc.).

Also run the prose-conformance suite, since it reads `step-21-release.md` verbatim:

Run: `node --test tests/init-release-bootstrap-conformance.test.js`
Expected: PASS — this suite only pins the `release: conflict — {tool}` literal, the verdict
words, and the stack-table agreement, none of which this change touches or removes.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/init/release-bootstrap.js plugin/skills/init/bootstrap/step-21-release.md tests/bin-lib/init/release-bootstrap.test.js
git commit -m "Release bootstrap: detect goreleaser.yaml, package.json release keys, and standard-version as conflicts

refs #2323"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (extend `CONFLICT_MARKERS` with the three shapes, package.json
  release key as a second JSON-read pass) — Task 1 Step 3. Deliverable 2 (mirror in
  `step-21-release.md`'s conflict row, add one fixture per shape to the test file) — Task 1 Steps
  1 and 3. Acceptance Criteria (goreleaser.yaml, package.json release object, .versionrc.json each
  yield conflict naming the tool; existing fixtures keep passing) — Task 1 Steps 1/2/4.
- **Placeholders:** none — every step shows the actual diff content.
- **Type consistency:** `detectReleaseProcess`'s return shape (`{ verdict, tool, evidence }` for
  conflict) is unchanged from the existing convention; the new markers/pass reuse the exact same
  shape as every existing conflict path in the function.
