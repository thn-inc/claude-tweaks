'use strict';

// Pure: the static reachability lens for assess-agent-autonomy's grant-check
// mode (#2674). Inspects a skill's `allowed-tools:` frontmatter line or an
// MCP server config entry ({command, args, env}) and reports what
// filesystem/network/secrets surface is DECLARED — never a live probe, never
// an execution of the audited skill/server. Plugin4Shell
// (https://www.air.security/blog-posts/plugin4shell) is a zero-click RCE
// class exploited through a skill/MCP integration reaching further than a
// host session intended; grant-check judged record *content* but had no
// signal on what a skill/server can technically touch before extending an
// unattended (routine) grant — this module is that signal.
//
// Static-manifest-read limitation (state this wherever the output is
// surfaced): this can only flag *declared* reach (a tool allowlist, an MCP
// server's command/args/env) — never runtime behavior a skill's own code
// might exhibit beyond what it declares. A clean result is not a safety
// guarantee.
//
// Fails closed throughout: an unparseable/unreadable/malformed input is
// never silently graded narrow — see `unreadableResult` below, which both
// `auditSkillManifest` and `auditMcpServerConfig` return verbatim on any
// input they cannot make sense of, grading it as full reach (the opposite of
// "resolved toward more autonomy").

const { splitFrontmatterFence } = require('../health-core/frontmatter-list');

// Tool name -> declared reach. `fs` is 'read' | 'write' | undefined.
// `network`/`secrets` are booleans. Bash and Task are graded as full reach
// (fs write, network, secrets) rather than guessed narrower — a shell or a
// dispatched subagent can reach anything the host process can reach.
const TOOL_REACH = {
  Read: { fs: 'read' },
  Glob: { fs: 'read' },
  Grep: { fs: 'read' },
  Write: { fs: 'write' },
  Edit: { fs: 'write' },
  NotebookEdit: { fs: 'write' },
  WebFetch: { network: true },
  WebSearch: { network: true },
  AskUserQuestion: {},
  Skill: {},
  Bash: { fs: 'write', network: true, secrets: true },
  Task: { fs: 'write', network: true, secrets: true },
};

// Any tool name this table doesn't recognize — including every MCP tool
// (`mcp__{server}__{tool}`), whose actual reach is the server's own
// implementation, invisible to a static read — is graded the same
// conservative way: full reach. `unknownTools` on the result names exactly
// which tools drove that grade, so a caller sees the reason, not just a
// worst-case number.
function reachForTool(name) {
  const known = TOOL_REACH[name];
  if (known) return known;
  return { fs: 'write', network: true, secrets: true, unknown: true };
}

// `allowed-tools:` is a single scalar frontmatter line, comma-separated
// (skills/harness-health/SKILL.md etc.: "Read, Grep, Glob, Bash,
// AskUserQuestion") — not a YAML bullet list, so
// health-core/frontmatter-list.js's list-field parser doesn't fit; this
// reuses only its fence-splitting half.
// Returns: an array of tool names, [] when the key is present but empty,
// or null when there's no frontmatter fence at all, or no `allowed-tools:`
// key within it — distinct from [], since "declares nothing" and "declares
// an empty list" both legitimately parse but mean different things to a
// caller deciding whether this was even an audit-shaped input.
function parseAllowedTools(content) {
  const split = splitFrontmatterFence(content);
  if (!split) return null;
  const line = split.frontmatter.find((l) => /^allowed-tools:\s*/.test(l));
  if (!line) return null;
  const raw = line.replace(/^allowed-tools:\s*/, '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function unreadableResult(reason) {
  return {
    ok: false,
    kind: 'unreadable',
    reason,
    filesystem: 'write',
    network: true,
    secrets: true,
    flags: ['filesystem:write', 'network', 'secrets', 'unreadable'],
    clean: false,
  };
}

// content: the raw SKILL.md file text (frontmatter + body).
function auditSkillManifest(content) {
  if (typeof content !== 'string' || content.trim() === '') {
    return unreadableResult('empty or non-string manifest content');
  }
  const tools = parseAllowedTools(content);
  if (tools === null) {
    return unreadableResult('no allowed-tools frontmatter field found');
  }
  const unknownTools = [];
  let filesystem = null; // null | 'read' | 'write'
  let network = false;
  let secrets = false;
  for (const tool of tools) {
    const reach = reachForTool(tool);
    if (reach.unknown) unknownTools.push(tool);
    if (reach.fs === 'write') filesystem = 'write';
    else if (reach.fs === 'read' && filesystem !== 'write') filesystem = 'read';
    if (reach.network) network = true;
    if (reach.secrets) secrets = true;
  }
  const flags = [];
  if (filesystem === 'write') flags.push('filesystem:write');
  if (network) flags.push('network');
  if (secrets) flags.push('secrets');
  return {
    ok: true,
    kind: 'skill',
    tools,
    unknownTools,
    filesystem,
    network,
    secrets,
    flags,
    clean: flags.length === 0,
  };
}

const SECRET_ENV_RE = /token|secret|key|password|credential|auth/i;

// config: a single MCP server entry shape, e.g. { command, args, env }, as
// found under an `mcpServers.{name}` key in a `.mcp.json`-style config.
// Every MCP server is itself an arbitrary out-of-process program the host
// spawns unsandboxed — it inherits full filesystem/network reach by
// construction, not by anything it happens to declare in argv. This grades
// every syntactically valid server entry as broad reach (`clean` is always
// false), while still surfacing which env vars look secret-ish, since that
// detail is useful even though it never narrows the baseline grade.
function auditMcpServerConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return unreadableResult('mcp server config is not an object');
  }
  const { command } = config;
  if (typeof command !== 'string' || command.trim() === '') {
    return unreadableResult('mcp server config has no command to run');
  }
  const envObj = (config.env && typeof config.env === 'object' && !Array.isArray(config.env))
    ? config.env : {};
  const secretEnvVars = Object.keys(envObj).filter((k) => SECRET_ENV_RE.test(k));
  const flags = ['filesystem:write', 'network'];
  if (secretEnvVars.length > 0) flags.push('secrets');
  return {
    ok: true,
    kind: 'mcp-server',
    command,
    filesystem: 'write',
    network: true,
    secrets: secretEnvVars.length > 0,
    secretEnvVars,
    flags,
    clean: false,
  };
}

module.exports = {
  TOOL_REACH, reachForTool, parseAllowedTools, auditSkillManifest, auditMcpServerConfig,
};
