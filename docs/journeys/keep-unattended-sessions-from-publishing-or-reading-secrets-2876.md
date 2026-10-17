---
files:
  - .claude/settings.json
  - docs/decisions/0022-unattended-runs-keep-network-egress.md
  - tests/agent-trust-scope-repo-posture.test.js
---

# Keep Unattended Sessions in This Repo From Publishing Packages or Reading Secrets

**Persona:** the claude-tweaks maintainer who leaves this repo running at `autonomy: unattended`. Records get built by `/claude-tweaks:dispatch` firings, cloud sessions and scheduled Routines while nobody watches. Later the maintainer reads an agent-trust-scope sweep, or a `/claude-tweaks:review` of a change to `.claude/settings.json`.
**Goal:** an unattended agent working in this repo can't publish a package or read a credential file on its own initiative, and `/claude-tweaks:research` keeps its web access. The one dimension left open, network egress, stays visible in sweeps as a recorded decision, not as an unexplained gap.
**Entry point:** any agent session in this repo, local or cloud or Routine, that loads the committed `.claude/settings.json`.
**Success state:** a publish or credential read written as a tool call is refused by Claude Code's permission check. The agent-trust-scope scan of this repo returns `["network-egress"]` only, and ADR 0022 explains why that one stays.

## Steps

### 1. An unattended agent tries a guarded action — any session in this repo
- **URL:** a Bash tool call such as `npm publish`, `cd plugin && npm login`, or `pnpm publish`; or a Read/Edit/`cat` of `.env`, `.env.local`, `id_rsa`, `*.pem`, `.netrc`, `.aws/…`, `.ssh/…`, `~/.npmrc`, `~/.git-credentials`, or `~/.config/gh/hosts.yml`
- **Action:** the agent attempts the action while working on a dispatched record.
- **Should feel:** a firm stop with no prompt. Nobody is there to answer one, so the denial ends that attempt and the agent carries on with the task by other means or reports that it can't.
- **Should understand:** these are `permissions.deny` rules in the committed `.claude/settings.json`, so every local, cloud and Routine session gets them. A `Bash(npm publish *)` rule also matches the bare command and any part of a compound command. A `Read(...)` deny also blocks Edit, Write and recognized Bash file commands on that path. They are guardrails, not a sandbox: a script that does the same thing indirectly (`sh -c`, a node subprocess) is not stopped, as ADR 0022 says.
- **Red flags:** a session that can still `cat .env`, or `npm publish`, run as a direct tool call. A legitimate workflow in this repo (tests, `/claude-tweaks:release`, `/claude-tweaks:research`) newly hitting a denial.

### 2. The agent researches the web — `/claude-tweaks:research`
- **URL:** `/claude-tweaks:research {question}` in this repo
- **Action:** the research fan-out fetches its sources with `WebFetch`.
- **Should feel:** unchanged. No denial, no prompt.
- **Should understand:** network egress is deliberately not denied here (ADR 0022). A blanket `WebFetch`/`curl` deny would break research in every session. A narrow rule, such as a `wget`-only deny or a pipe-to-shell pattern, would only hide the finding: it leaves the same reach through `curl`, `WebFetch`, `node` and `gh`.
- **Red flags:** a `WebFetch`, `curl` or `wget` entry appearing in `.claude/settings.json`'s `permissions.deny`. `tests/agent-trust-scope-repo-posture.test.js` fails in that case.

### 3. The maintainer reads an agent-trust-scope result — later
- **URL:** `/claude-tweaks:code-health focus=agent-trust-scope`, or `/claude-tweaks:review` Step 6.65 on a diff touching `.claude/settings.json`; or directly: `node -e "console.log(JSON.stringify(require('./plugin/bin/lib/code-health/candidates-agent-trust-scope.js').scanAgentTrustScope(process.cwd()).candidates.map(c=>c.kind)))"`
- **Action:** read which dimensions are still reported.
- **Should feel:** expected. Exactly one dimension, `network-egress`, at medium severity, with the reason already written down.
- **Should understand:** registry-access and credential-scope are closed because the generator recognizes the deny rules. Network-egress stays reported by design: `docs/decisions/0022-unattended-runs-keep-network-egress.md` names the uses that need it and when to revisit. The posture test pins this end state, including a check that runs the real generator against the committed deny list regardless of this repo's own autonomy setting.
- **Red flags:** registry-access or credential-scope reappearing after an edit to `.claude/settings.json`. Network-egress disappearing without a matching change to ADR 0022.

## Origin

Built by #2876 (agent-trust-scope deny rules and ADR 0022), run `2026-10-16T195248-record-2876`.
