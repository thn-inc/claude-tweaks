# 0030. Origin hosts with no positive GitHub signal are refused, never degraded

- **Status:** accepted
- **Date:** 2026-11-02
- **Context:** #4933 (origin-host gate, decided at its open question and plan review), #4951 (`stuck-open-prs.js` moved onto the same gate); extends the GitHub-host admission rule #4505 and #4854 set for the `GH_HOST` seam

## Context

The plugin's issues CLIs read owner/repo from the git origin when no `--repo` is typed. #4854
gated the gh host seam (`ghOptions`, `plugin/bin/lib/repo-resolve.js`) so `GH_HOST` is injected
only on a positive GitHub signal — a `*.ghe.com` host or a key in gh's `hosts.yml` — because gh
sends `GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN` to whatever host it is pointed at. A second
path skipped that gate entirely: `repoSlug` built a host-qualified `--repo host/owner/repo`, and the
same raw origin host was threaded into `gh api --hostname`, so a repo whose origin is GitLab, Gitea
or a typo'd host sent the enterprise token there. `ghOptions` never saw those calls, since it steps
aside for any argv that already names `--repo`/`--hostname`.

Closing that path forced a choice about what an origin host with no positive signal should do. It
was left as an explicit open question for the user rather than decided by an agent.

## Decision

Refuse. An origin-derived host passes only on a positive GitHub signal, checked in this order by
`gateOriginRepo` (`plugin/bin/lib/repo-resolve.js`):

1. A non-empty exported `GH_HOST` always wins. When it names the origin host, that host passes
   through host-qualified; when it names another host, the origin host is not named at all and the
   slug is bare, so gh goes where the user pointed it.
2. A normalized host of `github.com`.
3. A host ending in `.ghe.com`, or an exact key in gh's `hosts.yml` (the same `isKnownGhHost` test
   the seam uses — one function, not a second copy).

Anything else returns a refusal: the CLI writes `{cli}: {refusal}` to stderr — naming the host and
the `export GH_HOST={host}` opt-in. An SSH origin (scp-style, or an `ssh://`, `git+ssh://` or
`ssh+git://` URL) is instead told to export `GH_HOST` as the real host an SSH alias maps to (e.g.
`GH_HOST=github.com`), not the alias name, or, if it is GitHub Enterprise, as that server's host: it
never names its own host as a value, since an SSH host may be an alias that resolves only through
`~/.ssh/config` (#4794). The CLI exits with the code it already uses for an unresolvable
owner/repo, before any gh call that names a repo or host. Hook-side callers never exit: teardown
prints a `remote ref: skipped` line and post-merge returns the `unknown-host` failure word. A token
in the environment is never a signal. A user-typed `--repo` is not gated.

Two further rulings from #4933's plan review:

- An exported but **empty** (or whitespace-only) `GH_HOST` is not an opt-in, so an unknown origin
  host is still refused. Since #4794 `ghOptions` reads an empty value as unset too, so the gate and
  the seam agree.
- `parent-gate.js --facts-json` stays ungated: it makes no gh call and reads the origin only to judge
  a qualified `--closing` token. The `ORIGIN_GATED` conformance scan carries a named carve-out for
  that one site; its gh path goes through the gate.

## Alternatives considered

- **Drop to a bare `owner/repo`** (gh's default host). Rejected: it sends the github.com token
  instead and acts on whatever same-named repo exists on github.com — possibly a stranger's — while
  looking like normal operation. This was the reflex fix twice before the ruling held (#4951's
  review-time draft, #4952's planned skill rewrite); both were superseded.
- **Fall back to `github.com` explicitly** (`resolveGhHost(...) || 'github.com'`). The same failure
  as dropping, spelled out.
- **Treat an empty `GH_HOST` as an opt-in, matching the seam (the seam's behavior before #4794).** Rejected by the user at plan
  review: `GH_HOST` stops a refusal only as an explicit choice of host, and an empty value names
  none — so on this path, where a wrong guess sends a token to a non-GitHub host, it does not count.
- **One shared helper for the CLI-side refusal handling.** Rejected for the shape kept: each of the
  15 gated CLIs carries a five-line inline block (call the gate, print `{cli}: {refusal}`, return its
  own existing exit code), because each CLI keeps its own exit-code vocabulary. Drift is held by
  `tests/gh-host-seam-conformance.test.js`'s `ORIGIN_GATED` roster, which fails when a `plugin/bin`
  file reads the origin through `parseRepo` without the gate.

## Consequences

- Matches gh's own behavior: a bare `gh issue view` in such a repo already fails with "none of the
  git remotes … point to a known GitHub host". The plugin now fails the same way, but with the
  opt-in in the message.
- Accepted cost: a repo whose origin is on another forge but tracks issues on github.com must export
  `GH_HOST=github.com` (or add a GitHub remote). A GitHub Enterprise Server user relying on
  `GH_ENTERPRISE_TOKEN` alone, with no `hosts.yml` key and a host outside `.ghe.com`, is refused
  where the CLIs ran before — that is the decision, not a regression.
- Every new producer that derives a host from origin must call `gateOriginRepo`; the conformance
  roster makes forgetting it a test failure rather than a review catch.
- The gate judges the normalized host (`parseRepo(hostPathOf(remote))`: userinfo, port and scheme
  dropped, #4794), so a credentialed, ported or `ssh://` origin is admitted or refused exactly as its
  plain spelling is. A remote that read does not parse (a cloud sandbox's
  `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}` proxy remote, a local path) is neither;
  #4857 owns that case.
- Revisit if gh itself starts admitting hosts by another positive signal (the gate should follow
  gh's notion of a known host), or if a forge-agnostic work backend makes non-GitHub origins a
  supported configuration rather than a misconfiguration.
