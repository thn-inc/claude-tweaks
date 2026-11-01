# Pass --hostname on fetch-sub-issues.js GraphQL calls (#4806) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `plugin/bin/fetch-sub-issues.js`'s schema probe and every batched GraphQL page carry `--hostname {host}` right after `graphql` when the resolved host is not github.com, and reduce `plugin/bin/lib/issues/parent-gate.js`'s workaround accordingly.

**Architecture:** `run()` already resolves `{host, owner, repo}`. It builds a host-aware runner once, which inserts `--hostname {host}` at index 2 of any `['api', 'graphql', ...]` argv when `host !== 'github.com'`, and hands that runner to `probeSchemaStrict` and `fetchNativeSubIssues`. The REST retry keeps its existing trailing `--hostname`. `parent-gate.js`'s `enumerateSubIssues` then stops wrapping the fetcher's runner in `onHost`, because every argv the fetcher sends already carries its host. `onHost` stays for the reads the gate sends itself (shape 2 `fetchNativeParent`, 4d REST, 8 `api user`).

**Tech Stack:** Node 18+, CommonJS, `node --test`, injectable fake runners (no real `gh`).

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191925-record-4806/work/4806-spec.md`

**Scope keywords:** fetch-sub-issues, onHost

## Global Constraints

- `gh-api-module-pattern` skill, `.claude/skills/gh-api-module-pattern/SKILL.md` (governs both files: they shell out to `gh` through an injectable runner), quoted verbatim: "The same holds when a host-qualified `--repo` feeds `gh api graphql`: the host travels as `--hostname {host}` placed right after `graphql`, omitted for `github.com` or no host. `plugin/bin/lib/issues/resolved-refusal.js`'s `fetchResolvedRefusalEvidence` (#3597) is the instance — a fake-runner test on the exact argv for a GHE host pins it, since a dropped flag silently queries `github.com`."
- Same skill, quoted verbatim: "A REST call with no `--repo`/`-R` flag needs `--hostname` instead, from the same `parseRepo` host field." The REST retry at `fetch-sub-issues.js:143-144` already does this. Leave it unchanged, trailing `--hostname`, exactly once.
- Keep the `pinGhHost` wiring in `fetch-sub-issues.js` (`realDeps.pinGhHost` and the `deps.pinGhHost(repoSpec)` call). `tests/gh-host-seam-conformance.test.js`'s `PIN_WIRED` roster pins both halves. The pin is still needed for a bare `--repo owner/name` (github.com) on a GHE origin, where no `--hostname` is sent and `ghOptions` would otherwise inject the origin's `GH_HOST`.
- Do not change `plugin/bin/lib/issues/capabilities-probe.js` or `plugin/bin/lib/issues/native-dependencies.js`. They are shared with other callers (`preflight-records.js`, `resolve-blockers.js`, `backlog-grant-gate.js`, `/init`'s probes). The host belongs in the fetcher's runner, not in the libraries.
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4806` (never `closes`/`fixes`).

## Review Focus

1. **Host from the origin remote, no `--repo`.** On a GHE `git@ghe.example.com:acme/widget.git` origin, the probe and pages must carry `--hostname ghe.example.com` as well, not only on an explicit `--repo`. The Task 1 test pins this.
2. **More than one chunk (over 50 numbers).** Every page carries the flag, not only the first. The Task 1 test sends 51 numbers, so it gets two pages.
3. **No duplicate flag through parent-gate.** After `onHost` is removed from the fetcher runner, a GHE gate run sends each probe/page argv with exactly one `--hostname`, at index 2. The Task 1 parent-gate assertion pins the exact argv.
4. **REST retry unchanged.** On the retry path, `--hostname` stays trailing and appears once. The existing `#2240`/`#2444` tests in `tests/fetch-sub-issues-cli.test.js` cover this and must pass unedited.
5. **github.com stays bare.** A bare `--repo o/r` or a github.com origin sends no `--hostname` anywhere. The Task 1 test pins this.

---

### Task 1: Thread the host into the fetcher's GraphQL calls and drop parent-gate's workaround for them

**Role:** integration

**Files:**
- Modify: `plugin/bin/fetch-sub-issues.js:74-76` (the `#4505` comment above `pinGhHost`: the probe and batch now carry their own host off github.com, and the pin covers the github.com case), `:115-133` (pass the host-aware runner to `probeSchemaStrict` and `fetchNativeSubIssues`)
- Modify: `plugin/bin/lib/issues/parent-gate.js:25-28` (the shape-4 legend: 4a/4b now show `api graphql --hostname {host}` off github.com, sent by the fetcher), `:119-126` (`onHost` comment: only `fetchNativeParent`'s GraphQL read and the gate's own REST/`api user` reads take no host), `:161-167` (fetcher deps: `runner: (args) => caller.call(args)`)
- Test: `tests/fetch-sub-issues-cli.test.js` (new test, appended after the `#2444` tests)
- Test: `tests/bin-lib/issues/parent-gate.test.js:668-717` (the GHE test: the probe/page shapes are now host-after-`graphql`)
- No change (classified by the behavior-change prose sweep): `docs/plugin-structure.md:227`, which describes exit codes and retry and makes no host claim. Also `.claude/skills/gh-api-module-pattern/SKILL.md:29,61`, which cover the timeout and REST-path rules and make no host claim.

**Interfaces:**
- Consumes: `probeSchemaStrict(runner)`, which calls `runner(['api','graphql','-f','query={ __type(name: "Issue") { fields { name } } }'])`. Also `fetchNativeSubIssues({numbers, owner, repo, runner})`, which calls `runner(['api','graphql','-f','query=…','-f','owner=…','-f','repo=…'])`.
- Produces: no new export. `run(argv, deps)`'s argv contract to `deps.runner` is that a GraphQL argv is `['api','graphql','--hostname',host, ...rest]` when `host !== 'github.com'`, and is otherwise unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/fetch-sub-issues-cli.test.js`, add `test('#4806: the schema probe and every GraphQL page carry --hostname right after graphql off github.com, and none on github.com', …)`. Build 51 positional numbers (`Array.from({ length: 51 }, (_, i) => String(i + 1))`) and use the file's `deps()` fixture, whose runner records every argv into `d.calls`. Then:
- `run([...nums, '--repo', 'ghe.example.com/o/r'], d)` → exit `0`. Let `gql = d.calls.filter((a) => a[1] === 'graphql')`. Assert `gql.length === 3`, i.e. one probe and two pages. For each, assert `assert.deepStrictEqual(a.slice(0, 4), ['api', 'graphql', '--hostname', 'ghe.example.com'])` and `a.filter((x) => x === '--hostname').length === 1`.
- The same with no `--repo` and `remoteUrl: () => 'git@ghe.example.com:acme/widget.git'`. The same three assertions hold.
- `run([...nums, '--repo', 'o/r'], d2)` → exit `0`. Assert `d2.calls.every((a) => !a.includes('--hostname'))`, and the probe argv `deepStrictEqual`s `['api', 'graphql', '-f', 'query={ __type(name: "Issue") { fields { name } } }']`.

In `tests/bin-lib/issues/parent-gate.test.js`'s `'with an Enterprise host every read carries the host-qualified slug or --hostname'` test, add `const graphqlOnGhe = (args) => ['api', 'graphql', '--hostname', GHE, ...args.slice(2)];` and use it for `SHAPE.probe()` and `SHAPE.page(10)` in all three native argv assertions. Keep `onGhe` (trailing `--hostname`) for `SHAPE.parent(11)`, `SHAPE.rest(10)`, `SHAPE.login()` and the `--repo` reads. Also extend `makeGheGh`'s `plain` mapping so it strips `--hostname GHE` at indexes 2-3 of an `api graphql` argv, as it already strips the trailing pair. Example expected list: `[onGhe(SHAPE.parent(11)), graphqlOnGhe(SHAPE.probe()), graphqlOnGhe(SHAPE.page(10)), onGhe(SHAPE.sub(11)), onGhe(SHAPE.sub(12)), onGhe(SHAPE.labels(10))]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/fetch-sub-issues-cli.test.js tests/bin-lib/issues/parent-gate.test.js`
Expected: FAIL. In the CLI test, the probe argv is `['api','graphql','-f',…]` with no `--hostname`. In the parent-gate test, the probe/page argv carries `--hostname` trailing (`onHost`), not at index 2.

- [ ] **Step 3: Implement**

In `fetch-sub-issues.js` `run()`, after `const { host, owner, repo } = repoSpec;` and the `.`/`..` guard, define the runner the probe and the batch use. It is `deps.runner` itself when `host === 'github.com'`. Otherwise it is `(args) => deps.runner(args[0] === 'api' && args[1] === 'graphql' ? ['api', 'graphql', '--hostname', host, ...args.slice(2)] : args)`. Pass it to `probeSchemaStrict(...)` and to `fetchNativeSubIssues({ …, runner })`. Leave the REST retry on `deps.runner` with its own trailing `--hostname`. In `parent-gate.js`, change the fetcher deps' `runner` to `(args) => caller.call(args)`, and update the three comment sites listed in Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/fetch-sub-issues-cli.test.js tests/bin-lib/issues/parent-gate.test.js tests/gh-host-seam-conformance.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js`
Expected: PASS, 0 failures. Every pre-existing test in these files passes unedited, except the one parent-gate GHE test changed in Step 1.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/fetch-sub-issues.js plugin/bin/lib/issues/parent-gate.js tests/fetch-sub-issues-cli.test.js tests/bin-lib/issues/parent-gate.test.js
git commit -m "Pass --hostname on fetch-sub-issues.js GraphQL calls — probe and pages reach GHE hosts; parent-gate drops its onHost wrap of the fetcher, refs #4806"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (probe and every page carry `--hostname` right after `graphql` off github.com) is Step 3 plus the CLI test. Deliverable 2 (the parent-gate workaround is reduced) is Step 3's `runner: (args) => caller.call(args)` plus the parent-gate argv assertion. AC 1 is the CLI test: a GHE `--repo ghe.example.com/o/r` run includes the flag on the probe and each page, and a github.com run includes none. AC 2 is Step 4's unedited pre-existing tests.
- **Placeholders:** none.
- **Proportion:** one task, two source files, two test files.
