# Brief: kata web UI overhaul, wave 1 (P0 + P1)

You are the frontend engineer for Henry's public fork of kata (`hsb3/kata`, upstream `kenn-io/kata`). Read this whole file before touching code.

## Where

- Repo: the worktree you were started in (a linked worktree of `/Users/henry/Developer/kata`). Branch `fork/frontend-wave1`, based on fork `main`.
- Spec: `docs/fork/frontend-overhaul/SPEC.md` (read it end to end, look at the screenshots it links). Seed script: `docs/fork/frontend-overhaul/seed.sh`.
- Frontend: `web/` (Svelte 5 + TypeScript + Vite, bun) and the shared package `packages/kata-ui/`. It is embedded into the Go binary via `internal/web` (`make web-embed`, `make build`).
- Repo rules: `AGENTS.md` at the repo root. They apply in full: test first (failing test before implementation), evidence-gated regression tests, neutral names only (`spoke-project`, `example-agent`, never Henry's real project or host names) in code, tests, fixtures and commits, no `roborev review`. Do not change the daemon API, database schema, auth, session model or the daemon-switcher trust model (SPEC.md "Non-goals" and the "Web UI trust/threat model" in AGENTS.md).
- Divergence ledger: `FORK_CHANGES.md`. Every commit is prefixed `fork:`. Add one ledger row for this wave in your final commit (What / Why / "Modify+Addition; keep ours on conflict, new components preferred over edits to hot files").

## Scope: SPEC.md Priority 0 and Priority 1, acceptance criteria A1 through A10 (and A17)

P0, agent visibility:
1. Attention chip (ok / needs-human / stuck) with `work.attention_msg` in list rows and detail; optional Attention column; URL-kept attention filter (A1, A2).
2. "Needs you" system view across all projects, stuck first then by age, sidebar badge count, live-updating (A3).
3. Close record in detail and Logbook: reason, message, actor, time, typed evidence rendered as code/links; Logbook reason chip; no "Edit issue" on closed issues; close dialog gains `audit-no-change` and repeatable evidence (A4, A5). If the close event payload with evidence does not reach the browser, stop and report exactly what the snapshot/event contains; do not change the daemon.
4. Blocked marker and "N blockers" hint in rows; a Ready view matching `kata ready` (A6).

P1, scale and flow:
5. Project sidebar at scale (A7). Henry's design constraints override the spec's defaults: (a) every project on the daemon must stay reachable somewhere in the UI, even when hidden from the default list; (b) any prioritized-action mode (Needs-you, Ready) removes irrelevant information rather than adding chrome. Within that, you design it: a filter box, hide-empty toggle, pins (per-browser storage is fine), "New project" reachable without scrolling.
6. New task respects the current project scope; inbox chooser only in system views, with a filter input (A8).
7. ID column never clips the short id (A9).
8. One detail mode: Complete / reopen / claim actions in read-only detail; side-by-side default at >= 1280 px with a labelled toggle (A10).

Out of scope for this wave: P2, P3, anything needing a daemon or schema change, kanban, mobile beyond no-breakage.

## Isolation (hard rules)

- Never run the Homebrew `kata` binary for anything. Never set or use `KATA_SERVER` / `KATA_AUTH_TOKEN`; the hosted daemon and its database are off limits.
- Run the fork binary only against a throwaway home: `env -u KATA_SERVER -u KATA_AUTH_TOKEN -u KATA_AUTHOR -u KATA_DB KATA_HOME=$(mktemp -d) ./kata daemon start` (see SPEC.md "How this recon was run"; `make web-dev` also launches an isolated branch daemon). Stop every daemon you start.
- Package installs: bun is pinned (`packageManager` in `web/package.json`); if `bun install` fails because of the machine's release-age cooldown, override per command (`--minimum-release-age 0`), never globally. Do not add new runtime dependencies.
- Do not merge to `main`, do not open GitHub PRs, do not comment on GitHub, do not touch anything outside this worktree.

## Definition of done

- `make web-check web-test` green; Playwright e2e (`make web-test-browser` or `bun run test:e2e` in `web/`) green with new specs for A1–A10 where a browser assertion is feasible (extend `web/tests/`, including the accessibility spec).
- `make build` succeeds; a manual run against `seed.sh` data passes each of A1–A10 as written in SPEC.md, with a fresh screenshot per criterion saved under `docs/fork/frontend-overhaul/screenshots/wave1/`.
- Commits small and `fork:`-prefixed; branch pushed to `origin` (hsb3/kata) as `fork/frontend-wave1`.
- Final report written to `docs/fork/frontend-overhaul/WAVE1-REPORT.md`: per criterion pass/fail with the command or screenshot that proves it, open questions, anything skipped and why. Reply in chat with only that file's path when done.
