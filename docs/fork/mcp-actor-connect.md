# MCP actor attribution and plugin connect failures

Fork investigation notes (kata v0.16.0 client, hosted daemon, Claude Code 2.1.266 to 2.1.270,
kata plugin 0.1.2 with its Python stdio shim). Private names are replaced with placeholders.

## 1. MCP calls always act as the session root actor

### Root cause

Two layers combine:

- **Claude Code** starts one stdio MCP server per session, shared by the main agent and every
  subagent. The child env is built from the Claude Code process env at spawn time
  (`env:{...Di(), CLAUDE_PROJECT_DIR, CLAUDE_CODE_SESSION_ID, CLAUDECODE:"1", ...config.env}` in
  the 2.1.270 binary). Later env changes (Bash-tool exports, per-subagent identity) never reach it.
- **kata** reads the MCP actor once at startup (`cmd/kata/mcp.go`: `resolveActor(ctx, flags.As,
  nil)` -> `--as` > `$KATA_AUTHOR` > `$USER` > git) and no MCP tool accepts a per-call actor.

The per-subagent identity (`<root>/<agent_type>/<agent_id[:6]>`) comes from the plugin's
`kata-identity` PreToolUse hook. That hook rewrites Bash `kata ...` commands to add `--as`, and
MCP tool calls never pass through it. So CLI writes from subagents are attributed per agent, and
MCP writes from the same subagents are attributed to the root (`$KATA_AUTHOR`, set machine-wide as
`claude@<host>` in the shell's zshenv).

The daemon is not the cause. `actorFor` only replaces the request actor when the principal carries
one (DB-backed tokens). Evidence: a CLI comment sent with `--as ec1e-probe-actor` against the
hosted daemon was stored with author `ec1e-probe-actor`.

### Evidence

- `kata whoami --json` -> `{"actor":"<root>","source":"env"}`
- `kata mcp serve` initialize response: `All tools are fixed to project kata and actor <root>`
- `kata comment ec1e --as ec1e-probe-actor ...` then `kata show ec1e --json` -> author
  `ec1e-probe-actor` (the daemon keeps the client actor)
- `kata digest --all-projects --since 90d --json` -> many `<root>/atelier.manager/<id>` actors
  (CLI writes via the hook) alongside the root actor
- Plugin source `plugins/kata/hooks/kata-identity/README.md`: "PreToolUse on Bash ... gets
  `--as <actor>` injected"; the installed plugin 0.1.2 cache has no `hooks/` directory at all

### Proposed fix

Layer: **kata** (per-call attribution) plus **plugin hook** (stamping MCP calls).

1. kata: let shared MCP sessions carry a per-call identity. Upstream kenn-io/kata#363 ("support
   agent swarms with teammate attribution") does exactly this with a per-call `teammate` under the
   fixed accountable actor. It needs schema 27 / API 0.18 (a persisted schema change), so it is not
   ported to this fork; adopt it when it merges.
2. Plugin: extend `kata-identity` with a `PreToolUse` matcher on the kata MCP tools that sets the
   per-call teammate (`updatedInput`) from `agent_type`/`agent_id`, mirroring the Bash `--as` rule.
3. Until then: treat MCP writes as root-attributed and have subagents use the CLI for writes.

Not fixed on this branch: the kata part is a missing feature with an upstream design in flight
and requires a database change, not a defect in the current contract (the server instructions
already state the actor is fixed at startup).

## 2. Plugin MCP server fails to connect at session start

### Root cause

Fourteen failed connects in 52 Claude Code MCP logs
(`~/Library/Caches/claude-cli-nodejs/<project>/mcp-logs-plugin-kata-kata/*.jsonl`), three
distinct causes:

| Count | stderr | Cause | Layer |
|---|---|---|---|
| 9 | `daemon "<name>": token_env "KATA_AUTH_TOKEN" is unset or empty` | Every one is `entrypoint=claude-desktop`. The desktop app's process env never sourced zshenv, so `KATA_SERVER` and `KATA_AUTH_TOKEN` are absent; kata falls back to `active_daemon` in `~/.kata/config.toml`, whose token env is empty, and exits. | Claude desktop launch env + plugin `.mcp.json` (no env block) |
| 4 | `FileNotFoundError: ... 'kata'` from the shim | Launched with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` (a GUI-launched `claude` process was observed with exactly this env); the shim runs bare `kata`. | Shim / launch env |
| 1 | `kata server not responding: <url> (KATA_SERVER)` after 5054 ms | A single 5s startup probe timeout against the hosted daemon; a manual reconnect 2m40s later connected in 420 ms. | **kata** (fatal single-shot startup probe) |

Why it "sticks": Claude Code does not retry a stdio server that fails its initial connect. The
logs show no automatic retry after any of the 14 failures; each later attempt is a new log
file or a manual reconnect. For the env-caused failures, every reconnect in the same process fails
again (one desktop session failed at 21:51 and again at 23:34), because the MCP child env is the
unchanged process env. No 15-minute TTL was found for stdio servers: the only 900000 ms constant
near a retry schedule in the 2.1.270 binary belongs to the GitHub PR-status poller. The ~15 minutes
is **unverified** and most likely the time until a manual `/mcp` reconnect or a new session.

Startup latency is not the problem: `kata mcp serve` answered `initialize` in 0.27 to 0.36 s
against the hosted daemon (three runs).

### Fixes

- **kata (fixed on this branch):** `kata mcp serve` now retries transport-level failures of its
  startup health check (timeouts, refused or reset connections) for up to 20s, under Claude Code's
  30s connect timeout. A daemon that answers with a rejection (too-old API, auth error) still fails
  immediately. Upstream main no longer probes during resolution; the startup request is the
  `/api/v1/health` check, which had the same single-shot behavior.
- **Plugin `.mcp.json` / shim (proposed):** do not depend on the launching shell. Give the server
  an explicit `env` block (`KATA_SERVER`), resolve the token in the shim (for example from the
  Keychain when `KATA_AUTH_TOKEN` is empty), and resolve the binary with `shutil.which` plus
  `/opt/homebrew/bin/kata` and `/usr/local/bin/kata` fallbacks, failing with a message that names
  the missing piece.
- **Claude Code (upstream request, proposed):** retry a stdio server whose initial connect fails,
  with backoff. (The binary has an "attempting automatic reconnection" path for closed
  transports; whether it covers stdio was not verified, and the logs show it did not fire after a
  failed initial connect.)
