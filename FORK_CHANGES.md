# Fork Changes — hsb3/kata

_The divergence ledger: one entry per deliberate difference between this fork's `dev`
and `kenn-io/kata` `main`. A file that differs from upstream and isn't listed here is a
bug: re-align it or add the row. During upstream merges this is the conflict-resolution
cheat sheet._

Status: active. Tracking: the existing `kata` project selected by this checkout's
name-only `.kata.toml` binding.

## Ground rules

- Public GitHub fork (light tier). `origin` = hsb3/kata, `upstream` = kenn-io/kata,
  fetch-only (`git remote set-url --push upstream DISABLED`).
- `dev` is the fork's maintained branch and GitHub default, tracking `origin/dev`:
  upstream code plus the divergences below. New fork PRs target `dev`.
- `refs/remotes/upstream/main` tracks upstream's default branch. Refresh it with
  `git fetch upstream`; no local mirror branch or sync automation is needed.
  Upstream intake is optional and deliberate. To integrate an update, create a
  temporary `fork/upstream-sync-<date>` branch from a clean `dev`, merge
  `refs/remotes/upstream/main`, resolve against this ledger, run the verify gate,
  then merge the reviewed result into `dev`. Never rebase published `dev`.
  Lockfiles: take upstream's and re-run the generator.
- The existing `main` is preserved as the earlier fork baseline, not an upstream
  mirror or an integration target. Changing the GitHub default does not deploy
  code or upgrade installed clients; those targets are managed separately.
- Upstream-bound fixes branch from `upstream/main` (never from fork `dev`), so their PRs
  carry no fork commits. They merge into fork `dev` too, with a ledger row whose merge
  rule is "drop when upstream merges it".
- Fork-only work lands on `fork/<topic>` branches, merged to `dev` with its ledger row in
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
| 2026-09-21 | Handle Columns picker Escape before the containing modal, restoring focus to its trigger | Dismiss only the active popup while keeping the workspace palette open | Modify; preserve one-layer dismissal and focus restoration when merging picker or modal changes |
| 2026-09-21 | Preserve explicit `SDKROOT` in isolated development and lifecycle-test builds; align browser checks with the palette and independent overlays | Allow compatible installed macOS SDKs and verify the fork's current interactions | Modify; retain toolchain selection without inheriting daemon targets or credentials, and preserve the UX contract when updating browser tests |
| 2026-09-21 | Set GitHub default to `dev`, retain `main` as the earlier fork baseline, and use `upstream/main` as the upstream tracking ref | Make the divergent fork the primary code and keep upstream intake deliberate | Modify; preserve the branch roles and verified temporary-branch merge procedure above |
| 2026-09-15 | Persisted sidebar collapse plus independent task-detail and reachable-graph overlays, with fullscreen and nested-dialog keyboard behavior | Give task content room without losing the list, filters, or navigation context | Modify; preserve the interaction contract in `docs/fork/frontend-overhaul/UX-PATTERNS.md` when merging shell and modal changes |
| 2026-09-15 | Guard the close-reason schema constructor's required property before accessing its constant | Preserve MCP validation semantics while satisfying the existing NilAway check | Modify; retain the constructor invariant when upstream schema construction changes |
| 2026-09-15 | Canonical `.agents/skills` with Claude/Codex links, project frontend plugin settings, and official Svelte MCP configuration | Share project guidance and load tools relevant to the Svelte/Vite/Bun frontend | Modify+Addition; preserve shared skills and project overrides; keep generated roles and machine-specific Codex settings local |
| 2026-09-15 | Ignore machine-local agent activation configuration | Keep local hook policy and machine-specific setup out of the public fork | Addition; retain local-only ignores |
| 2026-09-15 | Fork-controlled reusable test workflow, hosted Linux runners, and push validation on `dev` and preserved `main` | Keep fork CI independent of upstream workflow and runner configuration | Modify; retain fork-local workflow reference, branch triggers, and read-only permissions while incorporating upstream test improvements |
| 2026-09-15 | Adopt `dev` as the maintained fork branch; remove the obsolete project identity field; declare `docs/fork/frontend-overhaul/UX-PATTERNS.md` | Preserve the existing board and make the requested palette and overlay behavior explicit before implementation | Modify+Addition; retain the fork branch model and name-only project binding |
| 2026-09-13 | Adopted this SOP and ledger (`FORK_CHANGES.md`) | Governance baseline | Addition; upstream never has this file |
| 2026-09-14 | Build mode: built from the checkout. Macs: `make install` with mise's pinned Go/Bun (`GOBIN=$HOME/.local/bin`, which precedes `/opt/homebrew/bin` on PATH, so it shadows the Homebrew client — done on BigMac 2026-09-14 from 6756dde, M5 1002; Homebrew 0.16.0 keg kept pinned as rollback). Daemon: `deploy/railway/Dockerfile` + `entrypoint.sh` + `Dockerfile.dockerignore` (fork-only directory), documented in `docs/fork/migration/BUILD.md` (ark1). Version stamp stays upstream's `git describe` output; fork builds are identified by the `g<sha>` suffix | One documented way to produce fork binaries for both targets before the Railway cutover; no fork tags or release automation, per AGENTS.md | Addition; upstream has no container build. Hosted daemon runs the fork build from `deploy/railway/Dockerfile` at 6756dde since 2026-09-14 (M4 j3v2: `railway up` snapshot, deployment 721ec69c, schema 27; repo-connect deferred to M7). Second Mac still on Homebrew 0.16.0 until M5 completes there |
| 2026-09-13 | internal/mcp/server.go: root not / if-then-else instead of root oneOf/allOf in tool input schemas (bfe11bb) | Messages API rejects top-level oneOf/allOf/anyOf; upstream PR kenn-io/kata#365 | Modify; keep ours (Henry 2026-09-14: upstream PRs are courtesy only) |
| 2026-09-13 | cmd/kata/mcp.go: requireMCPDaemonHealth retries transport failures ≤20s at startup (05e06e6); docs/fork/mcp-actor-connect.md | Claude Code never retries a stdio server that exits before initialize | Modify; keep ours, re-apply if upstream reworks requireDaemonAPIVersionHealth; candidate for an upstream PR |
| 2026-09-13 | docs/fork/frontend-overhaul/ (spec, seed.sh, screenshots) | Fork-only planning docs | Addition; keep ours |
| 2026-09-14 | Upstream PR kenn-io/kata#363 teammate attribution merged ahead of upstream (4ebf0ec): CLI/MCP teammate field, KATA_TEAMMATE/KATA_INBOX_USER, notify/inbox prerequisite from #359, DB schema 27 | Per-call actor attribution for shared MCP sessions (fork issue ec1e); Henry consented to the schema change 2026-09-14 | Modify; when upstream merges #363/#359 take theirs wholesale, otherwise keep ours. Hosted daemon must be upgraded to schema 27 before any fork binary talks to it |
| 2026-09-13 | Frontend wave 1: attention and Ready views, close evidence and actions, project navigation, scoped capture, ID layout, tests and acceptance report; integrated origin/main a91b7b2 with teammate attribution | Make agent state and completion evidence visible and improve navigation at scale; A5 uses persisted events, while owner-local Claim remains excluded by the existing daemon allowlist | Modify+Addition; keep ours on conflict, new components preferred over edits to hot files |
| 2026-09-14 | internal/daemon/web_session.go: `webLocalIssueRequestAllowed` also allows `POST /actions/claim` for the owner-local browser principal (table row in `internal/daemon/web_session_test.go`) | UI Claim returned 403 `web_local_operation_forbidden` (wave 1 acceptance A10, fork issue jgfd). Claim resolves its actor through the same `attributedActor(ctx, in.Body.Actor)` path as the already-allowed assign/unassign, so it grants no authority the local-web session did not already have; Henry ruled it allowed 2026-09-14 | Modify; keep ours. Re-apply if upstream reworks the SPA action allowlist |

## Kept deliberately

| What | Why it stays |
|---|---|
| `.kata.toml` project name `kata` | Preserve the existing board; the legacy repository identity is no longer needed |
| Existing CI checks and release snapshot validation | Keep backend, browser, package, and build coverage with fork-controlled workflows; publishing remains external |
