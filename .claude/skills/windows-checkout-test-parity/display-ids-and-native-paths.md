# Display IDs and native paths are two contracts

A path the code shows or compares as an ID (a JSON report row, a git-style repo-relative name, a glob) is a repo-display ID and uses `/` on every OS. A path the code then opens with `fs` stays native. Normalize the first at the producer with `shared-primitives.js`'s `toPosix(p, sep = path.sep)`, and never apply it to the second:

```js
// plugin/bin/lib/skill-audit/context-cost.js (#2767)
out.push({ skill: name, file: toPosix(path.relative(dir, p)), ...measuredBytes(p) });
```

`context-cost.js` wraps its three display sites this way (`measureSubFiles`, `measureComposed`'s source IDs, `findComposeCallSites`) and leaves every `fs` path native. `toPosix`'s own win32 branch is pinned on any host with `path.win32.sep` (`tests/bin-lib/shared-primitives.test.js`). A call site that takes the default `sep` is not covered by that pin: dropping its `toPosix` stays green on Linux CI.

On the test side, the matching rule is the `path.resolve` row in `SKILL.md`'s Anti-Patterns. Build the expected value with `path.resolve`/`path.join` when the code under test resolves or joins the path (`tests/bin-lib/verify/report.test.js`'s `gitDir` pins, `tests/bin-lib/wrap-up/ledger-write.test.js`'s `path.join('/run', 'ledger.md')`). Fix the producer, not the expectation, when the value is a display ID: a per-fixture `.replace(/\\/g, '/')` hides a producer that is still wrong.

When the ID is composed from a fixed prefix and an `fs` entry name rather than from a native path, build it with a `/` template instead of `path.join`: `` `docs/superpowers/plans/${f}` `` in `plugin/bin/release-local.js`'s `listPlanFiles`, `` `${entry.name}/${child.file}` `` in `plugin/bin/lib/residue/probes/artifacts.js`'s newest-file walkers (#4288). No native separator enters, so there is nothing for `toPosix` to fix, and an ID re-joined to a root before an `fs` read (`listPlanFiles` through `deps.readFile`) still opens on win32. The prefix must itself be a `/` literal: a prefix constant built with `path.join` is a native path, so a `/` template on top of it still emits `\` on win32. `artifacts.js`'s `ARTIFACT_ROOTS` was `path.join('.claude-tweaks', 'artifacts', …)`, so its `subject` and `failed` entries carried `\` until #4396 wrote the roots as `/` literals, built both IDs as `` `${rel}/${entry.name}` ``, and split a root into native segments only for the `fs` read (`path.join(root, ...rel.split('/'))`). When a record names the ID sites, check the constants they are built from too. A test's own `path.relative` listing compared with `/` literals or a `/`-keyed allowlist is the same kind of ID: wrap it in `toPosix` where the listing is built (`relFiles` in `tests/bin-lib/code-health/scope.test.js`, the listings in `tests/integration-model.test.js` and `tests/payload-boundary.test.js`). On Linux `path.join` and `toPosix` are identities, so no Linux runtime assertion tells either fix from the code it replaced; the per-file read of a `windows-regression.yml` dispatch on the branch is the proof.

For a `path.relative` result that becomes an ID, call `shared-primitives.js`'s `relativeDisplayId(from, to, pathImpl = path)`, which is `toPosix(pathImpl.relative(from, to), pathImpl.sep)`, rather than composing the two at each site. Give the producer a `{ pathImpl = path }` option that feeds only that call, and keep its `fs` paths on the native `path` (`checkA`/`checkB` in `plugin/bin/lib/plan-audit/checks.js`, `computeInboundReferences` in `plugin/bin/lib/docs-health/findability.js`, #3315). Injecting plain `path.win32` does not pin such a call site: for POSIX-rooted fixture paths on a POSIX host, the native `path.relative` and `relativeDisplayId` under `path.win32` give the same `/` ID, so reverting the site to `path.relative` keeps the test green. Wrap the module with a counting `relative` and assert it was called:

```js
// tests/bin-lib/plan-audit/checks.test.js
function countingWin32() {
  const calls = [];
  const pathImpl = { ...path.win32, relative: (a, b) => (calls.push([a, b]), path.win32.relative(a, b)) };
  return { calls, pathImpl };
}
// checkA(entries, repo, { pathImpl }); then assert the exact ID and calls.length > 0
```

`tests/bin-lib/docs-health/findability.test.js` builds the same wrapper inline.
