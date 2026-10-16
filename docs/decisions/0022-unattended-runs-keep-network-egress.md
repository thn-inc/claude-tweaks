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
**credential-scope** (reads of `.env`, `.env.*`, `id_rsa*`, `*.pem` under the session's working
directory, and `.netrc`, `.aws/`, `.ssh/`, `.npmrc`, `.git-credentials`, and
`.config/gh/hosts.yml` in both the project and the home directory). Nothing in this repo needs
either: `package.json` is `"private": true`, the plugin ships through the marketplace repo rather
than a package registry, and no workflow reads secret-shaped paths.

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
- **Deny `Bash(curl *)` and `Bash(wget *)` while keeping `WebFetch`.** `WebFetch` alone still
  leaves egress unbounded — the same hide-the-finding problem as the `wget`-only rule below — and
  this repo's own `/claude-tweaks:build` runs plan-dictated `curl` commands once, read-only, under
  its Verbatim-command run-once check (`plugin/skills/build/plan-authoring-checks.md:11`), which a
  `Bash(curl *)` deny would break.
- **A narrow rule that keeps those uses working.** None bounds egress. A pipe-to-shell rule such as
  `Bash(curl * | sh)` never matches, because Claude Code splits a command on `|` before matching
  each part. Rules keyed on `curl` flags are documented as bypassable by reordering options or
  indirection. A `wget`-only deny (nothing here uses `wget`) would make the scan stop reporting
  network-egress while `curl`, `WebFetch`, `node` and `gh` keep the same reach — it would hide the
  finding without bounding egress. The spec's Gotchas say to take option (b) "instead of forcing a
  lossy deny" when no narrow rule keeps the needed uses working, and this is exactly that case.
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
