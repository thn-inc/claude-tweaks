# Agent-Trust-Scope Deny Rules (#2876) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close this repo's own `registry-access` and `credential-scope` agent-trust-scope gaps with committed `permissions.deny` rules, and record network-egress as an explicit accepted risk (ADR 0022).

**Architecture:** Config-only change to `.claude/settings.json` (add a `permissions.deny` array; nothing else in the file changes), one new ADR under `docs/decisions/`, and one small repo-posture conformance test that runs the existing generator (`scanAgentTrustScope`) against the repo root so a later edit that drops the guardrails goes red.

**Tech Stack:** JSON config, Markdown ADR, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T195248-record-2876/work/2876-spec.md`

## Global Constraints

- `.claude/settings.json` stays valid JSON; `worktree`, `enabledPlugins`, `extraKnownMarketplaces` and the existing `permissions.allow` entry (`["Read(node_modules/**)"]`) are unchanged — only `permissions.deny` is added.
- Never deny `WebFetch` outright while `/research` is expected to work in this repo.
- Committed `.claude/settings.json` reaches every cloud session and Routine sandbox, so a too-broad deny breaks those too.
- Deny rules use Claude Code permission-rule syntax (code.claude.com/docs/en/permissions.md): `Bash(cmd *)` also matches the bare `cmd` and applies to each subcommand of a compound command; `Read(...)` deny also blocks Edit/Write and recognized Bash file commands (`cat`, `head`, …) on that path; `~/` is the home directory, `**/` matches at any depth.
- Commit style: `{Verb} {what} — {detail}`, trailers `Refs #2876` and `Claude-Session: https://claude.ai/code/session_01NHSHnidCMBb9jpekgwXTWt`.

## Review Focus

- A deny rule that is valid Claude Code syntax but invisible to the generator's pattern lists — the finding stays open. Covered by Task 1's scan assertion.
- A rule that blocks a file this repo's own sessions legitimately read (e.g. a tracked `.env.example`). `git ls-files` currently matches none of the credential globs; Task 2 Step 1 re-checks.
- Accidentally rewriting `enabledPlugins`/`extraKnownMarketplaces`/`allow` while adding the deny key, breaking cloud parity. Covered by Task 1's structural assertions.
- A `wget`-only (or any narrow) network rule added "for coverage" — it would silence `network-egress` without bounding egress. Task 1 asserts `network-egress` is still reported, which also makes such a rule a test failure.
- `.claude-tweaks/policy.yml` autonomy lowered later: the scan then returns no candidates at all; Task 1 asserts only that the two closed dimensions are absent, plus that `network-egress` is present while autonomy is elevated.

---

### Task 1: Repo-posture conformance test (failing first)

**Files:**
- Create: `tests/agent-trust-scope-repo-posture.test.js`

**Interfaces:**
- Consumes: `scanAgentTrustScope(rootDir)` from `plugin/bin/lib/code-health/candidates-agent-trust-scope.js` → `{ candidates: [{ file, kind, evidence }], ... }`.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// #2876: this repo's own committed agent-trust-scope posture under autonomy: unattended.
// registry-access and credential-scope are closed by permissions.deny in .claude/settings.json;
// network-egress is an accepted risk recorded in docs/decisions/0022-*.md, so it must still be
// reported — a narrow rule that silences it without bounding egress is what this guards against.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scanAgentTrustScope } = require('../plugin/bin/lib/code-health/candidates-agent-trust-scope.js');

const ROOT = path.join(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
const autonomy = (fs.readFileSync(path.join(ROOT, '.claude-tweaks', 'policy.yml'), 'utf8').match(/^autonomy:\s*["']?([a-z-]+)/m) || [])[1];

test('the committed deny list closes registry-access and credential-scope', () => {
  const kinds = scanAgentTrustScope(ROOT).candidates.map((c) => c.kind);
  assert.ok(!kinds.includes('registry-access'), `registry-access still reported: ${kinds}`);
  assert.ok(!kinds.includes('credential-scope'), `credential-scope still reported: ${kinds}`);
});

test('network-egress stays reported while autonomy is elevated (accepted risk, ADR 0022)', () => {
  if (autonomy !== 'unattended' && autonomy !== 'trusted') return;
  const kinds = scanAgentTrustScope(ROOT).candidates.map((c) => c.kind);
  assert.ok(kinds.includes('network-egress'), 'network-egress silenced — a deny rule now hides an accepted risk ADR 0022 says stays visible');
});

test('ADR 0022 records the network-egress accepted risk and the uses that need it', () => {
  const dir = path.join(ROOT, 'docs', 'decisions');
  const file = fs.readdirSync(dir).find((f) => /^0022-.*\.md$/.test(f));
  assert.ok(file, 'docs/decisions/0022-*.md missing');
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const needle of ['network-egress', 'WebFetch', '/claude-tweaks:research', 'curl', '**Status:** accepted']) {
    assert.ok(text.includes(needle), `ADR 0022 does not mention ${needle}`);
  }
});

test('the deny key is additive — allow, plugins, marketplaces and worktree are untouched', () => {
  assert.deepStrictEqual(settings.permissions.allow, ['Read(node_modules/**)']);
  assert.deepStrictEqual(settings.worktree, { baseRef: 'head' });
  assert.ok(settings.enabledPlugins && settings.enabledPlugins['claude-tweaks@claude-tweaks-marketplace'] === true);
  assert.ok(settings.extraKnownMarketplaces && settings.extraKnownMarketplaces['claude-tweaks-marketplace']);
  assert.ok(!settings.permissions.deny.some((r) => /^WebFetch(\(|$)/.test(r)), 'WebFetch must not be denied while /research needs it');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agent-trust-scope-repo-posture.test.js`
Expected: FAIL — test 1 reports `registry-access still reported`, test 3 reports `docs/decisions/0022-*.md missing`, test 4 throws on `settings.permissions.deny` being undefined. Test 2 passes.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/agent-trust-scope-repo-posture.test.js
git commit -m "Add repo agent-trust-scope posture test — red until #2876's deny rules and ADR land" -m "Refs #2876"
```

### Task 2: `permissions.deny` for registry-access and credential-scope

**Files:**
- Modify: `.claude/settings.json` (the `permissions` object only)

**Interfaces:**
- Consumes: Task 1's test.
- Produces: `settings.permissions.deny` (array of strings).

- [ ] **Step 1: Re-check no tracked file would be blocked**

Run: `git ls-files | grep -iE "(^|/)\.env(\.|$)|id_rsa|\.pem$|\.netrc|(^|/)\.aws/|(^|/)\.ssh/"`
Expected: no output.

- [ ] **Step 2: Add the deny list** — replace the `permissions` object with:

```json
  "permissions": {
    "allow": [
      "Read(node_modules/**)"
    ],
    "deny": [
      "Bash(npm publish *)",
      "Bash(npm login *)",
      "Bash(npm adduser *)",
      "Bash(npm config set registry *)",
      "Bash(yarn publish *)",
      "Bash(pnpm publish *)",
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(**/id_rsa*)",
      "Read(**/*.pem)",
      "Read(**/.netrc)",
      "Read(~/.netrc)",
      "Read(**/.aws/**)",
      "Read(~/.aws/**)",
      "Read(**/.ssh/**)",
      "Read(~/.ssh/**)"
    ]
  },
```

- [ ] **Step 3: Run the scan from the acceptance criteria**

Run: `node -e "console.log(JSON.stringify(require('./plugin/bin/lib/code-health/candidates-agent-trust-scope.js').scanAgentTrustScope(process.cwd()).candidates.map(c=>c.kind)))"`
Expected: `["network-egress"]`

- [ ] **Step 4: Run Task 1's test**

Run: `node --test tests/agent-trust-scope-repo-posture.test.js`
Expected: tests 1, 2, 4 PASS; test 3 still FAIL (ADR not written yet).

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json
git commit -m "Deny registry publishing and credential reads in this repo's own settings — #2876" -m "Refs #2876"
```

### Task 3: ADR 0022 — network-egress stays an accepted risk

**Files:**
- Create: `docs/decisions/0022-unattended-runs-keep-network-egress.md`

**Interfaces:**
- Consumes: Task 1's test (test 3), Task 2's deny list (cited in the ADR).

- [ ] **Step 1: Write the ADR**

```markdown
# 0022. Unattended runs in this repo keep network egress, on purpose

- **Status:** accepted
- **Date:** 2026-10-16
- **Context:** #2876

## Context

This repo runs with `autonomy: unattended` (`.claude-tweaks/policy.yml`). The agent-trust-scope
check (`plugin/bin/lib/code-health/candidates-agent-trust-scope.js`, #2749) audits three
dimensions of an unattended agent's standing reach against the committed
`.claude/settings.json` `permissions.deny` list. #2876 closed two of them with deny rules:
**registry-access** (`npm`/`yarn`/`pnpm` publish, login, adduser, registry config) and
**credential-scope** (reads of `.env`, `.env.*`, `id_rsa*`, `*.pem`, `.netrc`, `.aws/`, `.ssh/`,
in the project and the home directory). Nothing in this repo needs either: `package.json` is
`"private": true`, the plugin ships through the marketplace repo rather than a package registry,
and no workflow reads secret-shaped paths.

The third dimension, **network-egress** (`WebFetch`, `curl`, `wget`), is different. This repo's
own sessions use it:

- `/claude-tweaks:research` (`plugin/skills/research/SKILL.md`, `source-registry.md`) fetches its
  web sources with `WebFetch`.
- The cloud-setup path resolves a pinned plugin ref with `curl -fsSL`
  (`scripts/claude-cloud-setup.sh:129`, and the same snippet `/claude-tweaks:init` writes,
  `plugin/skills/init/bootstrap/step-14-cloud-routine-parity.md:175`). That `curl` runs as a
  `node` `execFileSync` subprocess, which Claude Code permission rules do not govern at all.

## Decision

Add no network-egress deny rule. Unattended runs in this repo keep `WebFetch` and `curl` reach
deliberately, and the agent-trust-scope scan is expected to keep reporting `network-egress` for
this repo — now at medium severity, since a `permissions.deny` list exists.
`tests/agent-trust-scope-repo-posture.test.js` pins that it stays reported.

## Alternatives considered

- **Blanket deny of `WebFetch`, `curl` and `wget`.** Breaks `/claude-tweaks:research` in every
  local, cloud and Routine session, since the committed settings reach all of them.
- **A narrow rule that keeps those uses working.** None bounds egress. A pipe-to-shell rule such as
  `Bash(curl * | sh)` never matches, because Claude Code splits a command on `|` before matching
  each part. Rules keyed on `curl` flags are documented as bypassable by reordering options or
  indirection. A `wget`-only deny (nothing here uses `wget`) would make the scan stop reporting
  network-egress while `curl`, `WebFetch`, `node` and `gh` keep the same reach: it would silence the
  finding without changing the agent's reach, which #2876's own Gotchas rule out.
- **A `WebFetch(domain:…)` allowlist plus sandbox network isolation.** This is the documented real
  boundary (permission rules are guardrails, not a security boundary — they do not stop
  `/usr/bin/npm` or `sh -c` forms either). It is a separate change to how sessions here run, with
  its own cost to `/research`'s open-ended source list, and is out of #2876's scope.

## Consequences

- The agent-trust-scope scan of this repo returns `network-egress` only. A future reader seeing it
  should treat it as this accepted risk, not a new gap — unless the uses above have gone away.
- The registry and credential deny rules are guardrails against an agent writing those commands
  or reads directly; they do not stop a script that does the same thing indirectly.
- Revisit this decision if this repo adopts sandbox network isolation or a `WebFetch` domain
  allowlist, or if `/claude-tweaks:research` stops needing open web access.
```

- [ ] **Step 2: Run Task 1's test**

Run: `node --test tests/agent-trust-scope-repo-posture.test.js`
Expected: PASS (4/4).

- [ ] **Step 3: Run the full suite**

Run: `npm test > /tmp/npm-test-2876.log 2>&1; echo "exit=$?"; grep -E "^# (pass|fail)" /tmp/npm-test-2876.log`
Expected: `exit=0`, `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0022-unattended-runs-keep-network-egress.md
git commit -m "Record network egress as an accepted risk for unattended runs — ADR 0022" -m "Refs #2876"
```
