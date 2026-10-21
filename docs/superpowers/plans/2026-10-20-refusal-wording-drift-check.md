# Refusal-Wording Drift Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** If Claude Code rewords its worktree-isolation refusal, the upstream-drift sweep reports a finding, instead of `wd-guard-refusal` events quietly dropping to zero.

**Architecture:** One new dependency-free module (`plugin/bin/lib/hooks/harness-refusal.js`) owns the refusal-text fragments. The hook regex and the prefilter signature are both derived from it. A new `claude-code` entry in `tools/upstream-drift/manifest.yml` asserts those fragments against the installed Claude Code artifact. Claude Code ships as a single compiled binary whose embedded JS still contains the refusal template literals. A conformance test ties the manifest's literals to the module's fragments, so a wording update cannot change one side without the other. `checks.js` switches its assertion match from a decoded string to a raw Buffer, so a ~268 MB binary is never decoded into a JS string.

**Tech Stack:** Node 18+ CommonJS, `node --test`, the repo's hand-rolled manifest YAML subset (`tools/upstream-drift/manifest.js`).

**Spec:** `.claude-tweaks/pipelines/2026-10-20T195213-record-3304/work/3304-spec.md`

Scope keywords: Refusing to run it, is isolated in the worktree, HARNESS_ISOLATION_REFUSAL_RE, REFUSAL_SIGNATURE

## Global Constraints

- `plugin/bin/lib/hooks/bash-prefilter.js` stays dependency-light: it may require only `fs`, `./git-command`, and the new `./harness-refusal` module. `harness-refusal.js` itself requires nothing.
- Nothing under `plugin/bin/` may import from `tools/`. The import direction is `tools/` → `plugin/bin/lib/` only.
- `HARNESS_ISOLATION_REFUSAL_RE` must keep exactly today's source: `This session is isolated in the worktree [\s\S]*?Refusing to run it`. This record changes where the text lives, not which refusals match.
- `post-tool-use-failure.js` keeps exporting `HARNESS_ISOLATION_REFUSAL_RE` (re-exported from the new module).
- Manifest YAML subset: double-quoted scalars support only `\"` and `\\` escapes. Use single-quoted scalars (`''` escape) for values that contain `"`.

## Review Focus

- **No Claude Code on the machine (CI).** The `claude-code` entry must take the existing `absent`/`skipped` path, never an assertion failure. This is covered by existing `checkVersion`/`checkAssertions` behavior and needs no new code. Task 3 only has to keep `installed-probe` a `command` probe whose failure returns null.
- **Binary content with invalid UTF-8 around the literal.** The Buffer match must still find an ASCII literal surrounded by arbitrary bytes. Task 2 pins this.
- **Multi-byte literal under a Buffer match.** Existing assertions use ASCII literals, but a future `must-match` with an em dash must still match a UTF-8 file. Task 2 pins this.
- **`claude` resolved through a symlink.** The real binary sits at `~/.local/share/claude/versions/{v}`, and `command -v claude` returns a symlink. The root probe must resolve it: `readlink -f`, probed below.
- **A subagent's refusal (`This agent is isolated in the worktree …`).** The hook's regex matches only the session noun, so a subagent's refusal is not logged today. This is a pre-existing coverage gap, out of scope: the regex source is frozen by the Global Constraints. It is reported as a ledger follow-up, not folded in.

## Probes run at authoring time (verbatim-command check)

- `claude --version | cut -d ' ' -f 1` printed `2.1.302`.
- `readlink -f "$(command -v claude)"` printed `/Users/thomasholknielsen/.local/share/claude/versions/2.1.302`, a Mach-O arm64 binary of 267,956,720 bytes.
- Byte counts in that binary: `noun:"This session"` 1, ` is isolated in the worktree ` 9, `Refusing to run it` 5. The template literal reads `${h} is isolated in the worktree ${s}, but this command ${Ie}. Refusing to run it — …`. The noun comes from `function NI(e){return …?{noun:"This session",…}:{noun:"This agent",…}}`.
- `gh api "repos/anthropics/claude-code/contents/CHANGELOG.md?ref=v2.1.302" --jq '.path'` printed `CHANGELOG.md`, and the upstream tags are `v2.1.304`, `v2.1.303`, `v2.1.302`, and so on (tag-prefix `v`).

---

### Task 1: Shared refusal-text constant, both hooks derived from it

**Files:**
- Create: `plugin/bin/lib/hooks/harness-refusal.js`
- Modify: `plugin/bin/lib/hooks/post-tool-use-failure.js`
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js`
- Test: `tests/hooks-harness-refusal.test.js`

**Interfaces:**
- Produces: `harness-refusal.js` exports `{ SESSION_NOUN, ISOLATION_CLAUSE, REFUSAL_SIGNATURE, REFUSAL_FRAGMENTS, HARNESS_ISOLATION_REFUSAL_RE }`:
  - `SESSION_NOUN = 'This session'`
  - `ISOLATION_CLAUSE = ' is isolated in the worktree '` (leading and trailing space)
  - `REFUSAL_SIGNATURE = 'Refusing to run it'`
  - `REFUSAL_FRAGMENTS`: a frozen array `[SESSION_NOUN, ISOLATION_CLAUSE, REFUSAL_SIGNATURE]`
  - `HARNESS_ISOLATION_REFUSAL_RE`: a RegExp built from the escaped `SESSION_NOUN + ISOLATION_CLAUSE`, then `[\s\S]*?`, then the escaped `REFUSAL_SIGNATURE`. No flags.

- [ ] **Step 1: Write the failing test** in `tests/hooks-harness-refusal.test.js`:
  - `test('harness-refusal: the derived regex keeps the pre-#3304 source exactly', …)`: `assert.strictEqual(HARNESS_ISOLATION_REFUSAL_RE.source, String.raw\`This session is isolated in the worktree [\s\S]*?Refusing to run it\`)` and `assert.strictEqual(HARNESS_ISOLATION_REFUSAL_RE.flags, '')`.
  - `test('harness-refusal: fragments are the three literals in message order', …)`: `assert.deepStrictEqual([...REFUSAL_FRAGMENTS], ['This session', ' is isolated in the worktree ', 'Refusing to run it'])` and `assert.ok(Object.isFrozen(REFUSAL_FRAGMENTS))`.
  - `test('harness-refusal: post-tool-use-failure re-exports the same RegExp object', …)`: `assert.strictEqual(require('../plugin/bin/lib/hooks/post-tool-use-failure').HARNESS_ISOLATION_REFUSAL_RE, HARNESS_ISOLATION_REFUSAL_RE)`.
  - `test('harness-refusal: neither hook module spells the refusal text itself (one-place change)', …)`: for each of `post-tool-use-failure.js` and `bash-prefilter.js`, read the source, run `stripComments` from `tests/helpers/strip-comments.js`, and assert that `stripperVerdict(stripped)` reports a clean parse (follow the helper's own return shape; read `tests/helpers-strip-comments.test.js` for usage). Then assert that the stripped code includes none of `'Refusing to run it'`, `'is isolated in the worktree'`, `'This session'`, and that the raw source includes `require('./harness-refusal')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hooks-harness-refusal.test.js`
Expected: FAIL with "Cannot find module '../plugin/bin/lib/hooks/harness-refusal'"

- [ ] **Step 3: Implement `plugin/bin/lib/hooks/harness-refusal.js` and rewire both consumers**
  - The new module gets a header comment covering four points. It holds the Claude Code harness refusal-text fragments, measured 2026-10-16 against 2.1.x. It is the one place a wording update lands. `tools/upstream-drift/manifest.yml`'s `claude-code` entry asserts each fragment against the installed binary, and `tests/harness-refusal-drift-pin.test.js` keeps the manifest and this module in lockstep. It must require nothing, because `bash-prefilter.js` loads it on every failed Bash call. Escape regex metacharacters with a local `s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.
  - `post-tool-use-failure.js`: drop the inline regex, use `const { HARNESS_ISOLATION_REFUSAL_RE } = require('./harness-refusal');`, and keep `module.exports = { run, HARNESS_ISOLATION_REFUSAL_RE }`. Edit the header comment in place so it names `harness-refusal.js` as the text's home.
  - `bash-prefilter.js`: replace `const REFUSAL_SIGNATURE = 'Refusing to run it';` with `const { REFUSAL_SIGNATURE } = require('./harness-refusal');`. Update the `#2783` comment above it and the "Dependency-light by contract" line in the header to name `harness-refusal.js`, which requires nothing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-harness-refusal.test.js tests/hooks-post-tool-use-failure.test.js tests/hooks-bash-prefilter.test.js tests/friction-adhoc-enterworktree-roundtrip.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/harness-refusal.js plugin/bin/lib/hooks/post-tool-use-failure.js plugin/bin/lib/hooks/bash-prefilter.js tests/hooks-harness-refusal.test.js
git commit -m "Derive the refusal regex and prefilter signature from one constant — harness-refusal.js, refs #3304"
```

### Task 2: checkAssertions matches raw bytes, not a decoded string

**Files:**
- Modify: `tools/upstream-drift/checks.js` (inside `checkAssertions`'s `perRoot` callback, the `fs.readFileSync(fullPath, 'utf8')` and `content.includes(mustMatch)` lines)
- Test: `tools/upstream-drift/tests/checks.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `checkAssertions` behavior is unchanged for UTF-8 text files. It now reads `fs.readFileSync(fullPath)` (a Buffer) and matches with `Buffer.prototype.includes(mustMatch)`, which encodes the literal as UTF-8. Update the function's comment: still a LITERAL substring, never a regex, now byte-level, so a compiled single-file artifact (the `claude-code` entry) is never decoded into a JS string. V8 caps strings at about 2^29 characters, and the Claude Code binary is already 268 MB and growing.

- [ ] **Step 1: Write the failing tests** in `tools/upstream-drift/tests/checks.test.js`'s `checkAssertions` section (append to the existing file), reusing its `tmpDir`/`writeFile` helpers and the entry shape of the neighboring `checkAssertions: ok when the literal is present…` test:
  - `test('checkAssertions: matches an ASCII literal embedded in non-UTF-8 binary bytes', …)`: write a file whose bytes are `Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0xc3]), Buffer.from('noun:"This session"'), Buffer.from([0x80, 0x00])])` with `fs.writeFileSync` (not the string `writeFile` helper). Assert `status === 'ok'` for `must-match: 'noun:"This session"'`, and `'unmatched'` for `must-match: 'noun:"This agent"'`.
  - `test('checkAssertions: a root that is itself a file is read when upstream-path is "."', …)`: pass `{ root: <file path> }` with `upstream-path: '.'` and assert `status === 'ok'`. This is the single-file-artifact shape Task 3 relies on.
  - `test('checkAssertions: a multi-byte UTF-8 literal still matches byte-for-byte', …)`: a text file containing `Refusing to run it — a worktree-isolated` with a real U+2014. Assert `ok` for `must-match: 'run it — a'`.
  - `test('checkAssertions: never decodes the file to a string (reads a Buffer)', …)`: a source-text assertion over `checks.js` saying the `checkAssertions` body contains no `readFileSync(fullPath, 'utf8')`. Slice the source between `function checkAssertions` and `// ─── replayFixtures`. This is the go-red pin for the decode removal.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/upstream-drift/tests/checks.test.js`
Expected: FAIL after Step 1 in "never decodes the file to a string" (the first three may already pass under the utf8 decode, since an ASCII literal survives U+FFFD replacement. That is expected: they pin behavior across the change, not the change itself)

- [ ] **Step 3: Implement**: in `checkAssertions`, read `fs.readFileSync(fullPath)` and test `content.includes(mustMatch)` on the Buffer. Leave the error/`missing-file` branch and every detail string unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/upstream-drift/tests/checks.test.js tools/upstream-drift/tests/run.test.js tools/upstream-drift/tests/manifest.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add tools/upstream-drift/checks.js tools/upstream-drift/tests/checks.test.js
git commit -m "Match upstream-drift assertions on raw bytes — a compiled binary is never decoded to a string, refs #3304"
```

### Task 3: `claude-code` manifest entry, pinned to the shared constant

**Files:**
- Modify: `tools/upstream-drift/manifest.yml` (append a fifth dependency after `emilkowalski-skills`)
- Modify: `docs/hooks.md` (the Bash-prefilter bullet's `post-tool-use-failure` sentence, line 14)
- Test: `tests/harness-refusal-drift-pin.test.js`

**Interfaces:**
- Consumes: `REFUSAL_FRAGMENTS` from Task 1; `loadManifest` (`tools/upstream-drift/manifest.js`); `checkAssertions` (Task 2's byte matching, plus the `upstream-path: "."` single-file shape).
- Produces: a manifest entry named exactly `claude-code`:

```yaml
  - name: claude-code
    kind: native-cli
    installed-probe:
      type: command
      run: "claude --version | cut -d ' ' -f 1"
      root: 'readlink -f "$(command -v claude)"'
    pinned: "2.1.302"
    version-mode: floor
    upstream:
      repo: "anthropics/claude-code"
      tag-prefix: "v"
    contract-paths:
      - "CHANGELOG.md"
    assertions:
      - file: "plugin/bin/lib/hooks/harness-refusal.js"
        claims: "the isolation refusal's noun for a session-owned worktree is This session (SESSION_NOUN)"
        upstream-path: "."
        must-match: 'noun:"This session"'
      - file: "plugin/bin/lib/hooks/harness-refusal.js"
        claims: "the refusal names its worktree with the clause ' is isolated in the worktree ' (ISOLATION_CLAUSE)"
        upstream-path: "."
        must-match: " is isolated in the worktree "
      - file: "plugin/bin/lib/hooks/harness-refusal.js"
        claims: "every isolation refusal carries Refusing to run it (REFUSAL_SIGNATURE, the prefilter's gate)"
        upstream-path: "."
        must-match: "Refusing to run it"
    fixtures: []
```

  Above the entry, add a comment block in the style of the neighboring entries. It records five things. First, why this entry exists: post-tool-use-failure.js and bash-prefilter.js recognize the harness refusal by its text, so a reworded refusal silently zeroes the `wd-guard-refusal` events friction-events.js counts. Second, that the artifact is a single compiled binary whose embedded JS keeps the template literals. That is why `root` resolves the binary file itself and `upstream-path: "."` reads it, and the probe output above has the byte counts. Third, why `version-mode: floor`: Claude Code auto-updates near daily. Fourth, why `fixtures: []`: a headless probe that provokes a real refusal costs API tokens and depends on model behavior, while the template literal is deterministic and offline. Fifth, that `contract-paths` names CHANGELOG.md, the upstream repo's release notes, for the capability diff. Keep `must-match` values in lockstep with `harness-refusal.js`; the pin test below enforces it.

- [ ] **Step 1: Write the failing test** in `tests/harness-refusal-drift-pin.test.js`. Load the real manifest with `loadManifest(path.join(ROOT, 'tools/upstream-drift/manifest.yml'))` and take `const cc = manifest.dependencies.find((d) => d.name === 'claude-code')`. Define one helper, `function assertFragmentsPinned(entry, fragments)`, that asserts every fragment is a substring of some `entry.assertions[i]['must-match']`. Both the positive test and the go-red control call it.
  - `test('AC1.1: the claude-code entry asserts every refusal fragment harness-refusal.js matches on', …)`: `assert.ok(cc)`, then `assertFragmentsPinned(cc, REFUSAL_FRAGMENTS)`, plus `cc['installed-probe'].type === 'command'` and `cc['version-mode'] === 'floor'`.
  - `test('AC1.1 go-red: a fragment absent from the manifest fails the pin', …)`: `assert.throws(() => assertFragmentsPinned(cc, [...REFUSAL_FRAGMENTS, 'Declining to run it']))`.
  - `test('AC1.1: a reworded refusal in the installed artifact is reported as assertion drift', …)`: write a temp file that stands in for the binary. It holds non-UTF-8 bytes plus this excerpt, copied from 2.1.302's embedded source (`—` stays a literal backslash sequence, as in the binary): `function NI(e){return x?{noun:"This session",possessive:"a worktree-isolated session's"}:{noun:"This agent",possessive:"a worktree-isolated agent's"}}` and ``b=(Ie,De)=>`${h} is isolated in the worktree ${s}, but this command ${Ie}. Refusing to run it — ${y} git operations must target its own worktree. ${De}` ``. Assert `checkAssertions(cc, { root: file }).status === 'ok'`. Then write a second file with `Refusing to run it` replaced by `Declining to run it`, and assert `status === 'drift'` and that the `must-match === 'Refusing to run it'` result is `'unmatched'`.
  - `test('AC1.1: no installed Claude Code means skipped assertions, never drift', …)`: `checkAssertions(cc, { runCommand: () => null }).status === 'skipped'`.
  - `test('AC1.1: the reflect Friction lens transcript grep names the same signature', …)`: `plugin/skills/reflect/full-mode.md` also greps transcripts for the refusal, so it is a third consumer of the wording. Read it and assert it includes `` '`' + REFUSAL_SIGNATURE + '`' ``. The constant and this prose then move together.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/harness-refusal-drift-pin.test.js`
Expected: FAIL with "The expression evaluated to a falsy value" (`assert.ok(cc)`: no `claude-code` entry yet)

- [ ] **Step 3: Implement**: append the entry and its comment block to `manifest.yml` exactly as specified in Interfaces. In `docs/hooks.md` line 14, after the sentence ending `…the harness worktree-isolation refusal it logs always contains.`, add one sentence. It says that phrase and the hook's regex both come from `bin/lib/hooks/harness-refusal.js`, and that `tools/upstream-drift/manifest.yml`'s `claude-code` entry asserts each fragment against the installed Claude Code binary, so a reworded refusal surfaces as upstream drift instead of silently dropped `wd-guard-refusal` events.

- [ ] **Step 4: Run tests to verify they pass, plus a live probe against the real installed binary**

Run: `node --test tests/harness-refusal-drift-pin.test.js tools/upstream-drift/tests/manifest.test.js tools/upstream-drift/tests/run.test.js tools/upstream-drift/tests/checks.test.js`
Expected: PASS, 0 failures

Real-input probe, recorded in the task report: from the repo root, `node -e "const{loadManifest}=require('./tools/upstream-drift/manifest.js');const{checkVersion,checkAssertions}=require('./tools/upstream-drift/checks.js');const cc=loadManifest('./tools/upstream-drift/manifest.yml').dependencies.find(d=>d.name==='claude-code');console.log(JSON.stringify({v:checkVersion(cc).status,a:checkAssertions(cc).results.map(r=>r.status)}))"`
Expected: `{"v":"ok","a":["ok","ok","ok"]}` on this machine (Claude Code 2.1.302 installed)

- [ ] **Step 5: Commit**

```bash
git add tools/upstream-drift/manifest.yml docs/hooks.md tests/harness-refusal-drift-pin.test.js
git commit -m "Add a claude-code upstream-drift entry asserting the isolation-refusal wording, refs #3304"
```

---

## Scope-keyword hits reviewed, not modified (Check B)

Each of these files mentions the refusal frame but needs no edit. Each still describes behavior that holds after this change, since the hooks keep matching the same text:

- `plugin/skills/feedback/SKILL.md:81`, `docs/skill-authoring.md:184`, `plugin/skills/reflect/full-mode.md:55,122`: these are prose describing what the hooks recognize, or what to grep. reflect's signature literal is pinned in Task 3.
- `docs/journeys/*-2776.md`, `*-2783.md`, `*-3074.md`, `docs/superpowers/plans/2026-10-20-feedback-harness-refusal-attribution.md`: historical journeys and plans, never rewritten.
- `tests/hooks-post-tool-use-failure.test.js`, `tests/hooks-bash-prefilter.test.js`, `tests/friction-adhoc-enterworktree-roundtrip.test.js`: these use the refusal text as test input. Task 1 Step 4 re-runs all three unchanged as its regression proof. `tests/feedback-harness-refusal-attribution-conformance.test.js` pins feedback prose only.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1: drift check for the refusal wording (tools/upstream-drift entry) | Task 3 (entry), Task 2 (byte matching it needs) |
| Deliverable 2: regex and prefilter signature tied to one constant | Task 1 |
| AC1.1: a wording change fails a check instead of silently dropping events | Task 3, tests `AC1.1: …` |

Waived AC2.1: `npm test` passes. The full suite runs centrally at `/build` Common Step 5 through the verification runner, which also writes the pass stamp. Per-task steps run only the focused suites.
