# Fork Changes — hsb3/kata

_The divergence ledger: one entry per deliberate difference between this fork's `main`
and `kenn-io/kata` `main`. A file that differs from upstream and isn't listed here is a
bug: re-align it or add the row. During upstream merges this is the conflict-resolution
cheat sheet._

Status: active. Tracking: kata project `kata` on the hosted daemon (this checkout's
upstream `.kata.toml` binds to it unchanged); parent workstream `dev-journey#9bhq`.

## Ground rules

- Public GitHub fork (light tier). `origin` = hsb3/kata, `upstream` = kenn-io/kata,
  fetch-only (`git remote set-url --push upstream DISABLED`).
- `main` = upstream `main` + the divergences below. Sync with
  `git fetch upstream && git merge refs/remotes/upstream/main`; never rebase `main`.
  Lockfiles: take upstream's and re-run the generator.
- Upstream-bound fixes branch from `upstream/main` (never from fork `main`), so their PRs
  carry no fork commits. They merge into fork `main` too, with a ledger row whose merge
  rule is "drop when upstream merges it".
- Fork-only work lands on `fork/<topic>` branches, merged to `main` with its ledger row in
  the same commit. Divergence commits are prefixed `fork:`.
- Fork builds run from their own path only (never replace the installed `kata` client).
  Run them against an isolated home: unset `KATA_SERVER` and `KATA_AUTH_TOKEN`, set
  `KATA_HOME` to a temp dir. Upstream `main` is at DB schema 26; the hosted daemon is at
  25, so a fork daemon must not be pointed at the hosted database.
- Verify gate after every sync or fork change: `go test ./...`, `make web-check`
  when `web/` changed.
  - Run tests with `TMPDIR=/tmp/kt` (`mkdir -p /tmp/kt` first): the default macOS
    temp path is too long for the unix-socket tests.

## Divergences

| Date | What | Why | Move + merge rule |
|---|---|---|---|
| 2026-09-13 | Adopted this SOP and ledger (`FORK_CHANGES.md`) | Governance baseline | Addition; upstream never has this file |
| 2026-09-13 | Build mode: source reference only. Installed client stays Homebrew 0.16.0; the hosted daemon is not built from this fork | Keep live tooling stable while fork work is proven locally | Revisit when a fork change must run live |
| 2026-09-13 | internal/mcp/server.go: root not / if-then-else instead of root oneOf/allOf in tool input schemas (bfe11bb) | Messages API rejects top-level oneOf/allOf/anyOf; upstream PR kenn-io/kata#365 | Modify; keep ours (Henry 2026-09-14: upstream PRs are courtesy only) |
| 2026-09-13 | cmd/kata/mcp.go: requireMCPDaemonHealth retries transport failures ≤20s at startup (05e06e6); docs/fork/mcp-actor-connect.md | Claude Code never retries a stdio server that exits before initialize | Modify; keep ours, re-apply if upstream reworks requireDaemonAPIVersionHealth; candidate for an upstream PR |
| 2026-09-13 | docs/fork/frontend-overhaul/ (spec, seed.sh, screenshots) | Fork-only planning docs | Addition; keep ours |
| 2026-09-14 | Upstream PR kenn-io/kata#363 teammate attribution merged ahead of upstream (4ebf0ec): CLI/MCP teammate field, KATA_TEAMMATE/KATA_INBOX_USER, notify/inbox prerequisite from #359, DB schema 27 | Per-call actor attribution for shared MCP sessions (fork issue ec1e); Henry consented to the schema change 2026-09-14 | Modify; when upstream merges #363/#359 take theirs wholesale, otherwise keep ours. Hosted daemon must be upgraded to schema 27 before any fork binary talks to it |

## Kept deliberately

| What | Why it stays |
|---|---|
| Upstream `.kata.toml` (project name `kata`) | Binding it unchanged gives the fork its own board with zero merge tax |
| Upstream CI workflows | Need no secrets; free test coverage on fork pushes |
