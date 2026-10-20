'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

// New filesystem-check code under plugin/bin/ routes through the shared
// plugin/bin/lib/path-guard/ module (lstatType / resolveLeaf /
// canonicalRealpath / resolveWithin) instead of reaching for a bare
// `fs.realpathSync(` or `fs.existsSync(`. Both are type-blind: existsSync
// answers "is something there", never "is it the kind of thing I am about to
// read, write or trust", and a realpathSync result compared against a value
// resolved a different way (JS realpath vs `.native` vs git's own output)
// misses on case-insensitive and symlinked checkouts (#3417; the IL-150 and
// IL-161 classes).
//
// The lint counts TOKENS, not call shapes: every `realpathSync` and every
// `existsSync` occurrence outside a comment. A call-shape regex misses
// `{ realpath = fs.realpathSync }` (a default later called as `realpath(p)`),
// `fs['realpathSync'](p)`, `fs.realpathSync?.(p)` and
// `const { existsSync: ex } = fs`; counting the identifier closes all of them
// at once. `existsSync` cannot be classified lexically as "used as a type
// check", so every occurrence counts. Every existing file with a non-zero
// count sits on the exact per-file ALLOWLIST below, with a `reason` an author
// judged by reading the site. A count that drifts either way (a new
// occurrence, or one migrated away) fails until the entry is updated — the
// allowlist is an audit record, not a ceiling. Entries whose reason starts
// `UNSAFE —` are known hazards recorded for follow-up, not endorsements.
const BIN_ROOT = path.join(__dirname, '..', 'plugin', 'bin');
const DONTS = path.join(__dirname, '..', 'docs', 'donts.md');

// Comments are blanked by the shared helper (tests/helpers/strip-comments.js),
// in one left-to-right pass that steps over string and template literals. Two
// separate replaces let a `/*` inside a line comment ("work/*-spec.md") open a
// block comment that blanks live code up to the next `*/`; four plugin/bin
// files were undercounted that way. Strings stay verbatim, so a token inside
// generated source text (statusline-wrapper-source.js) and a bracket-string
// form (`fs['realpathSync']`) still count.
//
// The stripper models regex literals: a quote, backtick, `//` or `/*` inside one
// stays code. Its one known ambiguity is a regex right after `)` or `}`, which it
// reads as division. `evaluate` fails the lint on any file whose stripped text
// stops compiling (`stripperVerdict`) instead of counting it as zero tokens, and
// a misread that still compiles goes unseen, as the helper's header says.
// Computed member access (`fs['realpath' + 'Sync']`, `fs[name]`) is also not seen.

// -> { realpathSync, existsSync } token counts in `src`, comments excluded.
// Calls, references (`{ realpath: fs.realpathSync.native }`), defaults
// (`{ realpath = fs.realpathSync }`), destructured aliases, bracket-string
// forms and optional chaining all count.
function countGuardedTokens(src) {
  const s = stripComments(src);
  return {
    realpathSync: (s.match(/\brealpathSync\b/g) || []).length,
    existsSync: (s.match(/\bexistsSync\b/g) || []).length,
  };
}

const KEYS = ['realpathSync', 'existsSync'];

// files: { relPosixPath: source }; allowlist: { relPosixPath: { realpathSync?,
// existsSync?, reason } } -> one offender line per count mismatch, one per
// allowlist entry whose file is gone, and one per entry without a non-empty
// `reason` (the reason is the audit record; an entry without one is a bare
// count).
function evaluate(files, allowlist) {
  const offenders = [];
  for (const [rel, entry] of Object.entries(allowlist)) {
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      offenders.push(`${rel}: allowlist entry has no reason`);
    }
  }
  for (const [rel, src] of Object.entries(files)) {
    const verdict = stripperVerdict(src);
    if (verdict !== 'ok') offenders.push(`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    const actual = countGuardedTokens(src);
    const allowed = allowlist[rel] || {};
    for (const key of KEYS) {
      const want = allowed[key] || 0;
      if (actual[key] !== want) offenders.push(`${rel}: ${key} x${actual[key]} (allowlisted: ${want})`);
    }
  }
  for (const rel of Object.keys(allowlist)) {
    if (!(rel in files)) offenders.push(`${rel}: allowlist entry has no matching file under plugin/bin/`);
  }
  return offenders;
}

function readTree(root = BIN_ROOT) {
  const files = {};
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (rel === 'lib/path-guard') continue; // the helper itself owns these calls
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        files[rel] = fs.readFileSync(full, 'utf8');
      }
    }
  })(root);
  return files;
}

const ALLOWLIST = {
  'calibration-report.js': { existsSync: 2, reason: 'line 52 probes the archive dir before readdirSync and returns null when absent; line 113 sits inside a printed `node -e` suggestion string that this file never runs.' },
  'claude-tweaks-statusline.js': { realpathSync: 1, reason: 'realpaths the nearest-.git toplevel to match a port-registry lease path; ports/registry.js stores leases from the same JS fs.realpathSync, so both sides resolve alike, and any throw falls to the renderer try/catch.' },
  'docs-health.js': { existsSync: 1, reason: 'find-refs guard that only selects the "could not read file" message and exit code for the target path before it is handed to computeInboundReferences; presence is the question.' },
  'hooks.js': { existsSync: 6, reason: 'run-dir marker probes (isInitializedRunDir, the archive copy-out of decisions.md / report.md / staged/, and the work/ tracked-content check at 1178-1179); each is a presence question about a path this plugin wrote, and the copy or readdir that follows throws loudly on a wrong type rather than acting on it.' },
  'init-verify-scope.js': { existsSync: 1, reason: 'decides only whether verify-scope.yml already exists so an existing file is never overwritten; wrapped in try/catch and any occupant, whatever its type, blocks the write.' },
  'lib/code-health/candidates-agent-trust-scope.js': { existsSync: 2, reason: 'presence of policy.yml (absent means not-applicable) and .claude/settings.json (absent means no settings) before reading them; both reads sit in try/catch, so a wrong-type occupant surfaces as an unreadable/skipped file, never as a trusted one.' },
  'lib/console/residue.js': { existsSync: 2, reason: 'itemLines only decides whether to print a paste-ready hint (`see "decisions.md"`, `cat "staged/<id>"`) next to an unresolved console item; nothing at either path is read, written or trusted here, so presence alone is the question and a wrong-type occupant costs the reader one unhelpful hint line.' },
  'lib/docs-health/findability.js': { existsSync: 3, reason: 'candidate-list assembly for the findability scan (docs/ dir, README.md, CLAUDE.md); each is added only when present, and every candidate is read inside try/catch-continue, so a wrong-type occupant is skipped.' },
  'lib/docs-health/freshness.js': { existsSync: 1, reason: 'splits referenced paths into existing vs missing for the freshness report; existence is the question (a drift finding), the kind of the occupant is not.' },
  'lib/flow/manifest.js': { existsSync: 1, reason: 'distinguishes an absent manifest (start a fresh one) from an unreadable one (refuse with unreadable-manifest) after readManifest already returned nothing; presence is the whole question.' },
  'lib/harness-health/scope.js': { existsSync: 3, reason: 'scope enumeration: SKILL.md present in a skill dir, CLAUDE.md present at root, first existing design-artifact search path; each only decides whether a target joins the sweep scope, and the type of the occupant is not consulted.' },
  'lib/hooks/close-run-state.js': { existsSync: 4, reason: 'work/ presence marks a run as holding unarchived work (two sites), runDir existence decides the "missing" status, and prev.worktree existence is a liveness probe for a recorded worktree; none acts on the occupant type.' },
  'lib/hooks/context.js': { realpathSync: 7, existsSync: 3, reason: 'realpathSync sites canonicalize the compared worktree / exclude-dir / run-dir values with the same JS fs.realpathSync on both sides of every comparison, each falling back to the as-given path on throw; existsSync at 56-57 probes run-state.json / decisions.md for mint adoption and at 544 whether a recorded worktree still exists.' },
  'lib/hooks/post-tool-use.js': { existsSync: 2, reason: 'rate-limit marker presence (306) and a guard that ctx.cwd still exists before shelling out to git worktree list (316); both are presence questions whose wrong answer only costs a skipped or repeated best-effort check.' },
  'lib/hooks/pre-tool-use.js': { realpathSync: 1, existsSync: 1, reason: 'the one realpathSync token is safeReal (429), the JS-form helper still used by the E1/worktree-identity comparisons and the teardown gate\'s own-cwd containment (both sides of each go through safeReal); isPolicyFile no longer uses it: both sides resolve through path-guard\'s .native resolveLeaf / canonicalRealpath (#3495). The existsSync at 2018 asks only whether the run dir already has a config.yml, any occupant counting as present.' },
  'lib/hooks/resume-freshness.js': { existsSync: 1, reason: 'a recorded worktree path that no longer exists is the "worktree-gone" safe verdict; the type of whatever is there is irrelevant to that verdict.' },
  'lib/hooks/run-dir-resolve.js': { realpathSync: 1, existsSync: 1, reason: 'safeReal canonicalizes PIPELINE_RUN_DIR before the anchored-under-root check against wtDetect.safeReal (the same JS realpath); existsSync at 88 is the staleness liveness probe for a recorded worktree.' },
  'lib/hooks/run-integrity.js': { realpathSync: 1, existsSync: 2, reason: 'realpathOrSelf resolves both the target and every `git worktree list` entry with the same JS realpath before comparing; existsSync on <entry>/.git deliberately accepts a file or a directory (a linked worktree\'s .git is a file) to spot a dangling prunable entry.' },
  'lib/hooks/staged-inventory.js': { existsSync: 1, reason: 'reports staged paths listed in decisions.md that are missing from the run dir; presence is the finding.' },
  'lib/hooks/sweep-shadow.js': { realpathSync: 3, reason: 'canonicalizes the run root and the worktree shadow with the same JS realpath that realDir() applies to the run dir it is compared against; a throw means the path is absent and is handled as such (no sweep / not-same-path).' },
  'lib/hooks/teardown-run.js': { existsSync: 1, reason: 'post-prune report line: is the worktree directory still on disk after git removed its registration; presence, not type, picks the message.' },
  'lib/hooks/worktree-detect.js': { realpathSync: 1, existsSync: 2, reason: 'safeReal is the shared JS-realpath helper (exported and used on both sides of every comparison in this module); existsSync at 29 walks up to the nearest existing ancestor after the leaf-is-a-file case is handled by statSync, and at 151 finds the nearest dir holding .claude-tweaks/policy.yml.' },
  'lib/impeccable-engine/index.js': { realpathSync: 1, existsSync: 1, reason: 'default deps for injectable tests: `exists` backs only the launcher presence check (the plugins-file read goes through installed-plugins.readInstalledPlugins, which reports ENOENT itself; a non-executable launcher fails at spawn and is reported as a probe failure), and `realpath` is `fs.realpathSync.native`, the same native call superpowers-version.js uses, so a mis-cased cwd still matches its project entry.' },
  'lib/init/release-bootstrap.js': { realpathSync: 2, reason: 'realpaths the project root and the just-created parent directory of each bootstrap file, then isPathContained() rejects any write that resolves outside the root, after assertSafeWriteTarget has run.' },
  'lib/init/verify-scope-starter.js': { existsSync: 1, reason: 'detection helper for project marker files (package.json, ...) through an injectable fs, wrapped in try/catch so a throw reads as absent; file contents come from the separate read-and-catch readText().' },
  'lib/journey-health/scope.js': { existsSync: 1, reason: 'journey-health "does this referenced path exist" check for a non-glob reference; existence is exactly the finding.' },
  'lib/plan-audit/checks.js': { existsSync: 7, reason: 'UNSAFE — Check A treats existsSync(parent) at 62 / 74 and nearestExistingAncestor at 46 as proof that a Create/Test bullet\'s parent DIRECTORY exists, so a plan that creates a file under a path that is currently a regular file passes the audit and fails at write time; the other sites (88, 182, 224, 436) are plain presence checks. Tracked in #3493.' },
  'lib/ports/ensure.js': { realpathSync: 1, reason: 'realpaths the checkout root to compare against lease.path, which lib/ports/registry.js stores from the same JS fs.realpathSync.' },
  'lib/ports/env-file.js': { existsSync: 1, reason: 'decides whether a Compose file exists so a root .env is also written; any occupant named like a Compose file counts, and the .env write does not depend on its type.' },
  'lib/ports/registry.js': { realpathSync: 3, existsSync: 2, reason: 'allocate / reallocate / release key leases by the JS fs.realpathSync of the checkout (release falls back to the as-given path on throw), the single canonical form every reader compares with; existsSync distinguishes a fresh registry from a corrupt one (59) and prunes leases whose checkout is gone (84).' },
  'lib/reconcile/archive-merged.js': { existsSync: 19, reason: 'run-dir archival moves: every site asks whether a source or destination entry (config.yml, work/, decisions.md, archive dir, spec dirs, stragglers) is present before a rename, content-hash comparison or readdir; presence/absence is what steers each branch (skip, already-archived, twin comparison), and the moves themselves run in try/catch with a typed outcome.' },
  'lib/reconcile/cache.js': { existsSync: 1, reason: 'prunes failure-cache keys whose target path is gone; a path that still exists as any type keeps its entry.' },
  'lib/reconcile/reap-merged.js': { realpathSync: 1, existsSync: 1, reason: 'realpathSync (123) is the default of gitCommittedToRemoval\'s injectable `realpath`, applied to each `git worktree list` path and compared with `real`, which the caller produced with worktree-detect\'s safeReal, the same JS fs.realpathSync, so both sides of the comparison resolve alike (ENOENT skips the entry, any other failure fails closed); existsSync (156) is the post-rmSync verification that the worktree directory is really gone, any surviving occupant being a failure regardless of type.' },
  'lib/residue/detect-test-script.js': { realpathSync: 1, existsSync: 1, reason: 'realpath of cwd is only the walk-up start (fallback path.resolve on throw); existsSync on <dir>/.git deliberately accepts a file or directory as the repo boundary (a linked worktree\'s .git is a file).' },
  'lib/skill-audit/skill-catalog.js': { existsSync: 1, reason: 'lists skill directories that contain a SKILL.md; presence is the filter.' },
  'lib/statusline-wrapper-source.js': { existsSync: 1, reason: 'inside the generated wrapper source text: exits 0 when the resolved statusline target is absent so a statusline failure never breaks the host session; the wrapper then requires or spawns it under its own error handling.' },
  'lib/superpowers-version.js': { realpathSync: 2, reason: 'both tokens are `fs.realpathSync.native`: the default dep (64) and the notice-time dep (113); installed-plugins.js\'s selectEntry/safeRealpath and the projectPath vs projectDir comparison at 118 all go through that one injected .native form, so a pair is never resolved two ways and a mis-cased cwd still matches.' },
  'lib/timing/transcript.js': { realpathSync: 2, reason: 'both tokens inject `fsImpl.realpathSync` (the JS form this reader has always used) into path-guard\'s canonicalRealpath / resolveLeaf, so the projects root and each transcript leaf compared by isAncestorOrSelf resolve with the same function; the isFile check follows on the resolved path.' },
  'lib/verify/baseline.js': { realpathSync: 1, existsSync: 3, reason: 'tryRealpath canonicalizes cwd, the git repo root and the scratch worktree with the same JS realpath before path.relative compares them (falling back to the given path on throw); existsSync gates whether a failing test file exists on disk / in a checkout (the file is then hashed or run, and a miss makes the entry ineligible) and verifies the scratch worktree was removed.' },
  'lib/visual-decide/cli.js': { existsSync: 2, reason: 'polls for and reads the daemon\'s server-stopped marker file (stopped vs crashed); presence of the marker is the entire signal.' },
  'lib/wrap-up/engine-verify.js': { existsSync: 13, reason: 'wrap-up verification checks: each asks whether a run artifact (verify-expectations.json, manifest.yml, engine-state.json, archive path, work/, .superpowers/sdd, docs/plans, recorded worktree) is present; absence or presence is the check result, and the reads that follow (expectations, engine-state, console.json) sit in try/catch.' },
  'lib/wrap-up/facts.js': { existsSync: 1, reason: 'records whether .claude/skills exists as a boolean fact for the wrap-up report; the directory is not read from here.' },
  'lib/wrap-up/ledger-write.js': { realpathSync: 4, existsSync: 5, reason: 'lines 27 and 29 each hold three tokens (the `const` name, `deps.` override, `fs.` default) for the injectable existsSync/realpathSync seams; an explicit ledger path must exist (36) and then, realpath-resolved by the same injected realpathSync as the run-dir and worktree roots it is tested against (37), sit under one of them; 47 is presence of the run-dir ledger.md fast path.' },
  'load-delta.js': { realpathSync: 4, reason: 'both sides of every containment check are resolved with the same JS fs.realpathSync (repo root and file or plugin root), isPathContained decides, and the read path additionally requires statSync(real).isFile().' },
  'phase-timing.js': { realpathSync: 1, reason: 'canonical() lstat-checks for a symlink first and keeps the literal path in that case, realpathing only a real directory; used to dedupe subagent dirs, with the literal path as fallback on throw.' },
  'release-local.js': { realpathSync: 2, reason: 'writeInsideRoot realpaths the root and the target\'s parent directory with the same JS realpath and refuses a parent outside the root; the leaf is then opened with O_NOFOLLOW so a symlinked leaf is refused by the kernel.' },
  'resolve-profile.js': { existsSync: 2, reason: 'optional inputs (policy.yml, frontier-tally.log): absent means defaults / zero, present is parsed in try/catch or read for a line count.' },
  'skill-load-report.js': { realpathSync: 2, reason: 'realpaths the root and each file read, then isPathContained() and statSync().isFile() must both hold before the read, inside try/catch.' },
  'sweep-stray-run-dirs.js': { existsSync: 3, reason: 'archival fold: events.jsonl present in the stray dir (89), already present at the archive destination (94) so the content is appended not clobbered, and a stray dir already handled by an earlier pass (132); all three are pure presence questions.' },
  'verify.js': { realpathSync: 1, reason: 'realpathOrNull canonicalizes both --git-dir values with the same JS realpath before the foreign-git-dir comparison; null (unresolvable) is treated as foreign, never as a match.' },
  'wrap-up-engine.js': { existsSync: 1, reason: 'requireEngineState: presence of engine-state.json in the run dir, else usage error "run plan first"; a wrong-type occupant fails the read that follows.' },
};

test('scanner counts tokens — calls, references, defaults, aliases, bracket and optional forms — not comments', () => {
  const fixture = [
    "const fs = require('fs');",
    'fs.realpathSync(a);', // 1 realpathSync
    'fs.realpathSync.native(b);', // 2
    'fsImpl.realpathSync(c);', // 3
    'fs.existsSync(d);', // 1 existsSync
    '// fs.realpathSync(e)', // comment: 0
    '/* existsSync(f) */', // comment: 0
    'const deps = { realpath: fs.realpathSync.native };', // 4 (a reference)
    'function reap(real, { realpath = fs.realpathSync } = {}) { return realpath(real); }', // 5 (a default, called as realpath())
    "fs['realpathSync'](g);", // 6 (bracket-string form)
    'fs.realpathSync?.(h);', // 7 (optional chaining)
    'const { existsSync: ex } = fs; ex(i);', // 2 existsSync (destructured alias)
  ].join('\n');
  assert.deepEqual(countGuardedTokens(fixture), { realpathSync: 7, existsSync: 2 });
});

test('scanner does not let a /* inside a line comment swallow live code (proves the single-pass stripper)', () => {
  // The two-replace stripper (block comments, then line comments) reads the
  // `/*` in the first comment as a block-comment opener that closes at the
  // `*/` two lines down, blanking the real existsSync call between them.
  const fixture = [
    '// archives work/*-spec.md for the run',
    'if (fs.existsSync(p)) go();',
    '/* trailing note */',
    "const note = 'http://example.test/x'; fs.realpathSync(q);",
    "const gen = `if (!fs.existsSync(t)) process.exit(0);`;",
  ].join('\n');
  assert.deepEqual(countGuardedTokens(fixture), { realpathSync: 1, existsSync: 2 });
});

test('a comment-stripper mis-parse is reported, not counted as zero tokens', () => {
  assert.deepEqual(evaluate({ 'lib/x.js': 'if (b) /"/.test(b); const c = "//"; fs.existsSync(c);' }, {}), [
    'lib/x.js: the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned — see tests/helpers/strip-comments.js',
  ]);
});

test('AC3.1: a bare fs.realpathSync( in a new plugin/bin/lib/ file is flagged', () => {
  // A one-file tree against the full ALLOWLIST would also report every
  // allowlisted file as absent (stale), so the new file is judged against an
  // empty allowlist instead.
  const files = { 'lib/new-reader.js': "const fs = require('fs');\nmodule.exports = (p) => fs.realpathSync(p);\n" };
  assert.ok(!('lib/new-reader.js' in ALLOWLIST), 'the fixture path must not be allowlisted');
  const offenders = evaluate(files, {});
  assert.equal(offenders.length, 1);
  assert.match(offenders[0], /lib\/new-reader\.js/);
  assert.match(offenders[0], /realpathSync/);
  // Allowlisting the exact count clears it.
  assert.deepEqual(evaluate(files, { 'lib/new-reader.js': { realpathSync: 1, reason: 'x' } }), []);
});

test('an allowlisted count ABOVE the actual count is flagged (a migrated-away call must shrink its entry)', () => {
  const files = { 'lib/a.js': 'module.exports = (p) => fs.realpathSync(p);\n' };
  const offenders = evaluate(files, { 'lib/a.js': { realpathSync: 2, reason: 'x' } });
  assert.equal(offenders.length, 1);
  assert.match(offenders[0], /lib\/a\.js: realpathSync x1 \(allowlisted: 2\)/);
});

test('an allowlist entry with a missing, empty or blank reason is flagged', () => {
  const files = { 'lib/a.js': 'module.exports = (p) => fs.existsSync(p);\n' };
  for (const entry of [{ existsSync: 1 }, { existsSync: 1, reason: '' }, { existsSync: 1, reason: '   ' }]) {
    const offenders = evaluate(files, { 'lib/a.js': entry });
    assert.equal(offenders.length, 1, JSON.stringify(entry));
    assert.match(offenders[0], /lib\/a\.js: allowlist entry has no reason/);
  }
  assert.deepEqual(evaluate(files, { 'lib/a.js': { existsSync: 1, reason: 'x' } }), []);
});

test('a stale allowlist entry is flagged', () => {
  const offenders = evaluate({}, { 'lib/gone.js': { existsSync: 1, reason: 'x' } });
  assert.equal(offenders.length, 1);
  assert.match(offenders[0], /lib\/gone\.js/);
});

test('AC3.1: passes on the current tree', () => {
  assert.deepEqual(
    evaluate(readTree(), ALLOWLIST),
    [],
    'a realpathSync / existsSync token under plugin/bin/ is new or its count changed — route it through plugin/bin/lib/path-guard (lstatType / resolveLeaf / canonicalRealpath / resolveWithin), or, when existence alone really is the question, add or update the file\'s ALLOWLIST entry in this test with a reason specific to that file',
  );
});

test('AC2.1: the three named call sites import path-guard', () => {
  const files = readTree();
  for (const rel of ['lib/timing/transcript.js', 'lib/installed-plugins.js', 'lib/hooks/pre-tool-use.js']) {
    assert.ok(rel in files, `${rel} must exist`);
    assert.match(
      files[rel],
      /require\(\s*['"](?:\.\.?\/)+path-guard(?:\/index(?:\.js)?)?['"]\s*\)/,
      `${rel} must require the shared path-guard module`,
    );
  }
});

test("AC4.1: docs/donts.md's IL-150 and IL-161 lines name the helper", () => {
  const lines = fs.readFileSync(DONTS, 'utf8').split('\n');
  for (const tag of ['[IL-150]', '[IL-161]']) {
    const tagged = lines.filter((l) => l.includes(tag));
    assert.ok(tagged.length > 0, `docs/donts.md has no line carrying ${tag}`);
    for (const line of tagged) {
      assert.ok(line.includes('plugin/bin/lib/path-guard'), `${tag} line must name plugin/bin/lib/path-guard: ${line.slice(0, 120)}`);
    }
  }
});
