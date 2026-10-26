---
name: lib-module-split
description: Use when splitting a shared `plugin/bin/lib/` module into sub-modules behind a re-export facade, or reviewing such a split. Covers when a facade beats migrating call sites, the three-check pure-move proof (export surface, verbatim declarations, require cycles), and the stale-location sweep that finds claims the split made false (code comments, pointers to non-exported internals, skill bullets, journey `files:` frontmatter), plus the `docs/plugin-structure.md` update. Keywords - facade, re-export, split, pure move, export surface, require cycle, stale location, journey files, plugin-structure, record.js, #2805, #2822.
---

# Lib Module Split: prove the move was pure, then find the claims it made false

A split turns one `plugin/bin/lib/` module into a thin facade plus sub-modules. Two things go
wrong, and a build's own tests catch neither:

- The move was not pure. A declaration changed in transit, or a sub-module requires the facade
  and creates a cycle. Tests typically exercise only the exports, so they can stay green through
  either.
- Prose and code that describe where things live now lie. #2805 split
  `plugin/bin/lib/issues/record.js` into four sub-modules (PR #2822). The build's own docs
  curation updated one file. The review then found 15 stale claims across 16 files, fixed in
  `31cf39c0e`.

This skill is the checklist for both. The proof runs before the review. The sweep runs before
the docs are called done.

## When a facade beats migrating call sites

Keep the original path as a re-export facade when the fan-in is high or the importers are
outside your reach. Migrate the call sites instead when the split is meant to change what
consumers depend on.

| Situation | Choose |
|---|---|
| Many importers, especially skill prose (it ships in the payload and agents run its `node -e` require lines verbatim) | Facade |
| The installed build reads this repo's own committed config with older code (CLAUDE.md's expand-contract rule for shipped contracts) | Facade |
| The split is about internal cohesion, not a new consumer boundary | Facade |
| Few call sites, all code, and the point is a new consumer boundary | Migrate |

For #2805 the fan-in was 69 files, 17 of them under `plugin/skills/` as skill-prose requires (run
against `69bb514df^`; the same command on today's tree counts 75 because new consumers have
accrued since):

```
git grep -lE "issues/record['\"]|issues/record\.js['\"]|require\(['\"]\./record['\"]\)" -- plugin tests | wc -l
```

Migrating the 69 call sites is step 2 of expand-contract. What breaks the rule is removing the old
path while an installed build, including the prose it executes, still reads it. A facade keeps
that path alive, so nothing has to be migrated at once. The facade's header comment says new code
may require a sub-module directly (`plugin/bin/lib/issues/record.js` lines 7-16). A facade does
not forbid migration. It lets it happen later and one consumer at a time.

## The pure-move proof

"Pure move" means the base and head trees differ only in where declarations live. Prove it with
three checks run together. Each catches a defect the other two pass, so skipping one leaves a
hole (go-red controls below).

| Check | Question | Catches |
|---|---|---|
| 1. Export surface | Does the head facade export the same keys, with identical function source and equal values? | A dropped or renamed export, an edited exported function |
| 2. Verbatim declarations | Does every top-level declaration of the base file appear byte-for-byte in a new module? | An edited non-exported helper or constant, which check 1 cannot see |
| 3. Require cycles | Is the require graph of facade plus sub-modules acyclic, and does no sub-module require the facade? | A cycle Node resolves silently with a partial `module.exports` |

### Extract base and head

Archive the whole directory, not just the one file, so the base facade's own sibling requires
(`./facet-shape` in #2805) resolve. Make each command its own Bash call, and `mkdir -p` the
target directories first.

```
mkdir -p {scratch}/base {scratch}/head
git archive -o {scratch}/base.tar {base} plugin/bin/lib/issues
git archive -o {scratch}/head.tar {head} plugin/bin/lib/issues
tar -xf {scratch}/base.tar -C {scratch}/base
tar -xf {scratch}/head.tar -C {scratch}/head
```

For #2805 the base was `69bb514df^` and the head `69bb514df` (PR #2822's squash merge). Where
the split is still a branch, use the branch tip as head.

### Run the checks

Save the script to a scratch file with the Write tool and run it with `node`. In a worktree
session never use a heredoc `node -e`: the worktree Bash guard refuses it.

```
node {scratch}/pure-move.js <baseRoot> <headRoot> <facade-rel-path> <new-module-rel-path>...
```

```js
// pure-move.js <baseRoot> <headRoot> <facade-rel-path> <new-module-rel-path>...
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [baseRoot, headRoot, facade, ...mods] = process.argv.slice(2);

// Check 1: export surface + function-source identity
const b = require(path.resolve(baseRoot, facade));
const h = require(path.resolve(headRoot, facade));
assert.deepEqual(Object.keys(h).sort(), Object.keys(b).sort(), 'export surface differs');
for (const k of Object.keys(b)) {
  if (typeof b[k] === 'function') assert.equal(h[k].toString(), b[k].toString(), `source differs: ${k}`);
  else assert.deepStrictEqual(h[k], b[k], `value differs: ${k}`);
}
console.log(`check 1: ${Object.keys(b).length} exports, same keys, same source/values`);

// Check 2: every base top-level declaration appears verbatim in a new module
const DECL = /^(?:async\s+)?(?:function\*?\s|const\s|let\s|var\s|class\s)/;
const lines = fs.readFileSync(path.resolve(baseRoot, facade), 'utf8').split('\n');
const chunks = [];
for (let i = 0; i < lines.length; i++) {
  if (!DECL.test(lines[i]) || /\brequire\(/.test(lines[i])) continue;
  let j = i;
  while (j < lines.length - 1 && (!/;\s*$|^[}\])]/.test(lines[j]) || (j === i && /[{([]\s*$/.test(lines[j])))) j++;
  chunks.push(lines.slice(i, j + 1).join('\n'));
  i = j;
}
const corpus = mods.map((m) => fs.readFileSync(path.resolve(headRoot, m), 'utf8')).join('\n');
const missing = chunks.filter((c) => !corpus.includes(c));
console.log(`check 2: ${chunks.length - missing.length}/${chunks.length} top-level declarations verbatim`);
for (const c of missing) console.log('  MISSING:', c.split('\n')[0]);

// Check 3: require graph among facade + new modules is acyclic and never reaches back to the facade
const dir = path.dirname(facade);
const edges = {};
for (const m of [facade, ...mods]) {
  const src = fs.readFileSync(path.resolve(headRoot, m), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  edges[m] = [...src.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)]
    .map((x) => path.join(path.dirname(m), x[1]).replace(/(\.js)?$/, '.js'));
}
const cycles = [];
const visit = (n, stack) => {
  if (stack.includes(n)) { const c = [...stack, n].join(' -> '); if (!cycles.includes(c)) cycles.push(c); return; }
  for (const e of edges[n] || []) visit(e, [...stack, n]);
};
for (const m of mods) visit(m, []);
const backToFacade = mods.filter((m) => (edges[m] || []).includes(path.join(dir, path.basename(facade))));
console.log(`check 3: ${cycles.length} cycles, ${backToFacade.length} sub-modules requiring the facade`);
for (const c of cycles) console.log('  CYCLE:', c);
process.exitCode = missing.length || cycles.length || backToFacade.length ? 1 : 0;
```

Run for #2805 (the module paths are relative to each root, and `{scratch}` is your scratchpad):

```
node {scratch}/pure-move.js {scratch}/base {scratch}/head plugin/bin/lib/issues/record.js plugin/bin/lib/issues/record-vocabulary.js plugin/bin/lib/issues/record-payload.js plugin/bin/lib/issues/record-fingerprint.js plugin/bin/lib/issues/record-dependencies.js
```

It exits 1 when any check fails. Recorded output on the real #2805 trees:

```
check 1: 37 exports, same keys, same source/values
check 2: 60/60 top-level declarations verbatim
check 3: 0 cycles, 0 sub-modules requiring the facade
```

Independent count: PR #2822's review verdict says "the facade exports the same 37 keys" and
"all 62 top-level declarations moved verbatim". The 62 vs 60 gap is the base facade's two
`require` lines (`nodePath`, `facet-shape`). Check 2 skips `require(` lines on purpose, because
a split always rewrites them.

### Why all three: go-red controls

Each control was run on a scratch copy of the head tree. Re-run the ones relevant to a new
split so you know the checks bite on your module too.

- **Exported function edited.** Re-space one `return null;` inside `buildNativeDependencyQuery`.
  Check 1 goes red: `AssertionError ... source differs: buildNativeDependencyQuery`.
- **Non-exported constant edited.** Change `DEP_RE` from `/^Blocked by #/` to
  `/^Blocked  by #/`. **Check 1 stays green**, because no exported function's own source text
  changed and `DEP_RE` is not exported. Check 2 goes red:
  `59/60 ... MISSING: const DEP_RE = /^Blocked by #(\d+)\b/gm;`.
- **Cycle introduced.** Append `const _cyc = require('./record');` to `record-fingerprint.js`.
  **Checks 1 and 2 stay green.** Check 3 goes red: `1 cycles, 1 sub-modules requiring the
  facade`, with `CYCLE: ...record-fingerprint.js -> ...record.js -> ...record-fingerprint.js`.

- **Check 2 is why an export comparison is not enough.** An internal-constant drift is a
  behavior change that no export comparison can see.
- **Check 3 is why a green test suite is not enough.** Node resolves a require cycle silently
  with a partial `module.exports`, so checks 1 and 2 stay green.
- **Check 3 strips whole-line `//` comments before matching `require(`.** Without that it
  false-positived on `record.js`'s own header comment, which quotes `require('./record')`.

### Limits of the proof

- Check 2 matches declarations at column 0 that start with `function`, `async function`,
  `const`, `let`, `var`, or `class`, and compares them as text. A module that declares through
  `module.exports.x = ...` or `exports.x = ...` needs a different matcher. A declaration with no
  terminating `;` is read as running to the next line that ends in `;` or starts with a closing
  bracket, so it can show up as a false `MISSING`. Read the script before trusting a green result
  on an unusual module.
- A "same key" check does not prove the sub-module wiring is right, only that the facade hands
  back the same things. The existing suites still own behavior.
- Run it against the base of the split commit, not against a base that already contains other
  edits to the file. Any unrelated edit to a declaration reads as a failed move.

## The stale-location sweep

After a split, four shapes of text claim something about the old file that is no longer true.
Each needs its own search, because no single grep finds all four. #2805's review found 15 stale
claims across 16 files, and every command below was run on the pre-fix tree (`31cf39c0e^`).

Substitute your facade name for `record.js` in each command.

### Import path vs definition location

Before editing any hit, classify it. The test is: **does the claim still hold if the reader only
ever does `require('{facade}')`?**

| Class | Holds after the split? | Action | #2805 example |
|---|---|---|---|
| Import-path reference: an exported symbol obtained through the facade | Yes | Keep | `plugin/skills/specify/record-creation-linking.md:61`: "`record.js`'s `parseDependencyAssumptions` reads the trailing text ...". It is re-exported, so the facade still hands it to you. 31cf39c0e left it unchanged on the very line where it repointed `DEP_RE`. The "the pairs live in `record.js`'s `TYPE_LABELS`" lines (for example in capture, code-health, harness-health, journey-health, and specify, among others such as `_shared/health-finding-shapes.md:18`) were kept for the same reason |
| Definition-location claim: a claim about the file's own text (its requires, comments, docs, internals, or "a function in this file") | No | Repoint | `autonomy.js:17`: "record.js requires only ./facet-shape" (the facade now requires the four sub-modules). And "`record.js`'s `DEP_RE`": `DEP_RE` is not exported and now lives in `record-dependencies.js` |

Repointing every hit to a sub-module is the opposite error. It churns correct import advice and
tells readers to bypass the facade.

### 1. Code comments claiming what a file requires or where code lives

```
git grep -nE "requires (only|nothing)|imports only|depends only on" -- plugin .claude docs
```

Keep only the hits that name the split file. On `31cf39c0e^` this found:

- `plugin/bin/lib/issues/autonomy.js:17`: `// record.js requires only ./facet-shape; this import is one-directional by`
- `.claude/skills/gh-api-module-pattern/batching-failure-posture.md:4`: "`record.js` requires nothing but `./facet-shape`"

Other hits name different files and are noise. The facade's own header claim ("lives here",
`record.js:4`) is found by the content-location grep in shape 3. 31cf39c0e rewrote it to "is
exposed here (defined in the sub-modules below)".

### 2. Pointers to non-exported internals

The form is "`{file}`'s `{symbol}`", or a bare mention of both on the same line. The symbol is
one that a sub-module declares at top level and the facade does not export, so the pointer now
resolves to nothing in the facade. Grep alone is too noisy for this (English words, other
`*record.js` files) and missed `ranking.js:77` ("record.js's line-anchored DEP_RE"), so classify
per line. Save this script to a scratch file, run it from the repo root at the head being
checked (the facade is `require`d live), and pipe a broad grep into it:

```
git grep -n -F "record.js" -- plugin .claude docs | node {scratch}/stale-pointers.js <facade> <sub-module>...
```

```js
// stale-pointers.js <facade> <sub-module>... < git-grep-output
// Prints each grep hit that names the facade AND a symbol some sub-module declares at top
// level but the facade does not export: a pointer to a moved internal.
const fs = require('node:fs');
const path = require('node:path');
const [facade, ...mods] = process.argv.slice(2).map((p) => path.resolve(p));
const exported = new Set(Object.keys(require(facade)));
const internal = new Set();
for (const m of mods) {
  for (const d of fs.readFileSync(m, 'utf8').matchAll(/^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/gm)) {
    if (!exported.has(d[1])) internal.add(d[1]);
  }
}
const esc = path.basename(facade).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = new RegExp(`(?<![\\w-])${esc}`);
for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
  if (!names.test(line)) continue;
  const hits = [...internal].filter((s) => new RegExp(`(?<![\\w$])${s.replace(/\$/g, '\\$')}(?![\\w$])`).test(line));
  if (hits.length) console.log(`${hits.join(',')}\t${line.slice(0, 140)}`);
}
```

It flags a line only when the line names the facade and a moved internal. On `31cf39c0e^` it
printed exactly 5 hits, all fixed:

| Symbol | Where |
|---|---|
| `parseIssueNumbers` | `plugin/bin/lib/health-core/materiality-digest.js:54` |
| `DEP_RE` | `plugin/bin/lib/issues/ranking.js:77` |
| `DEP_RE` | `plugin/skills/_shared/dependency-narration-check.md:43` |
| `DEP_RE` | `plugin/skills/_shared/observation-plan.md:65` |
| `DEP_RE` | `plugin/skills/specify/record-creation-linking.md:61` |

On `main` after the fix it still printed one hit, `record-creation-linking.md:61`, and that one is
a false positive: the line names `record.js` for `parseDependencyAssumptions` (exported, valid)
and correctly attributes `DEP_RE` to `record-dependencies.js`. (This skill, its journey, and its
plan also name `record.js` and `DEP_RE`, so they print as hits too. Ignore them.) Its output is a
candidate list to read, not a verdict. Apply the import-path vs definition-location test to each line.

### 3. Skill bullets and doc pointers stating a definition location

```
git grep -nE "(function|doc|comment|builder|header|lives?) (in|here)|record\.js\`?'s own|same \`?record\.js\`? file" -- plugin .claude docs/plugin-structure.md | grep -F "record.js"
```

On `31cf39c0e^` it surfaced, all fixed:

- The gh-api-module-pattern builder bullet, lines 4-5 ("a pure function in
  `plugin/bin/lib/issues/record.js`"; "the same `record.js` file's fourth builder").
- Four copies of `// specShapedBody's own verifiedAsOf doc in record.js for why.` (the
  `issue-payload.js` of code-health, docs-health, harness-health, and journey-health).
- `plugin/bin/materialize.js:96`: "(record.js's own comment".
- `record.js:4`: "lives here".

It also surfaced the `TYPE_LABELS` lines from the table above. Those are import-path
references. Leave them. The `| grep -F "record.js"` filter also matches other `*record.js` files
(`engine-record.js`, `compose-record.js`); those hits are noise.

### 4. Journey `files:` frontmatter naming the split file

```
git grep -n -F "plugin/bin/lib/issues/record.js" -- docs/journeys
```

On `31cf39c0e^` it found three journeys:

- `give-an-agent-filed-record-a-key-files-list-2975.md`
- `merge-a-record-with-a-conventional-subject-2251.md`
- `triage-backlog-via-funnel-overview.md`

Each kept its `record.js` entry, because the facade still exists. Each gained the sub-module(s)
whose symbols its steps exercise (`record-payload.js`; `record-vocabulary.js` plus
`record-payload.js`; `record-vocabulary.js`).

This one is silent, not wrong prose, so it is the easiest to skip:

- `/visual-review` matches the changed-file set against `files:` (`plugin/skills/visual-review/SKILL.md:88`).
- `/journey-health` ranks journeys by git churn on their `files:` paths (`why: "hotspot"`,
  `plugin/skills/journey-health/SKILL.md:54`).
- After a split, edits land in the sub-modules, so a journey that lists only the facade stops
  matching both.

## A leaf module when the facade reaches the caller

The facade shape assumes the importers sit outside the module family. When a module the facade
transitively requires also needs one of the family's functions, importing the facade closes a cycle
(#4153: `run-liveness/index.js` reaches `hooks/context.js` through `hooks/run-integrity.js` and
`run-liveness/probes.js`, so `context.js` could not require `index.js`). Move that function, and the
helpers it uses, into a leaf sub-module that requires nothing (`run-liveness/owner-pid-probe.js`),
and have the facade and the other importer both require the leaf. Check 3 of the pure-move proof
still applies. The leaf's requires-nothing property is what the proof does not state, so pin it with
its own test: strip comments with the shared stripper, assert no `require(` remains, and assert the
export keys (`tests/bin-lib/run-liveness/owner-pid-probe.test.js`). Register that test as a
stripper caller (`bin-source-scan-conformance`).

## Update `docs/plugin-structure.md`

The `plugin/bin/lib/{family}/` line there is the single module-family entry (for #2805, the
`plugin/bin/lib/issues/` line, `docs/plugin-structure.md:28`). Rewrite the facade's clause the
way #2805 did: name the facade and its size, then each sub-module with its one-phrase
responsibility, and say that every consumer still imports the facade unchanged. For example:
"record.js (#2805: a 47-line re-export aggregator over record-vocabulary.js [label/facet
vocabulary + parsing], record-payload.js [...], record-fingerprint.js [...], and
record-dependencies.js [...] - every consumer still imports record.js unchanged)".

This is the only file #2805's own docs curation updated. Everything in the four shapes above was
found later, by the review. Treat this update as the easy part, not the whole sweep.

## Done when

1. `pure-move.js` prints all three check lines with `0` missing, `0` cycles, and `0` facade
   requirers, and exits 0.
2. Each of the four shape commands has been run against the head tree, and every hit is either
   repointed or classified as an import-path reference and kept.
3. `docs/plugin-structure.md` names the facade and each sub-module.
4. The full suite is green (`npm test`, redirected to a file), because conformance tests pin
   prose and a repointed sentence can trip one.
