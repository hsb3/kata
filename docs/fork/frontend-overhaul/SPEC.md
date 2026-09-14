# Web UI overhaul: recon and spec

Status: recon only, nothing built. Tracking: kata `jgfd` (Frontend overhaul: recon and spec).
Base: `upstream/main` f41a333 (kata v0.17.2-6). Branch: `fork/frontend-spec`.

## Summary

The web UI is a solid table-and-detail task manager, but it can't see the parts of
kata that agents rely on. Agent attention, close evidence, and blocked state are
stored and enforced by the daemon, and the UI shows none of them. It also scales
poorly to 40 projects on one daemon. The top fixes are to show agent state, show
proof of completion, and make the project list usable at scale.

## Goals

1. A human can tell in one glance which issues need them, across every project on a daemon.
2. A closed issue shows how it was closed (reason, message, typed evidence) without the CLI.
3. Blocked and ready work is visible in lists, not only in the CLI and the graph.
4. Navigation stays fast with 40+ projects, most of them idle.
5. Every generic defect found here is fixed in a way that could go upstream, keeping the fork's merge cost low.

## Non-goals

- No change to daemon APIs, the database schema, auth, the session model, or the daemon-switcher trust boundary (AGENTS.md "Web UI trust/threat model").
- No new frontend framework, component library, or state library. Stay on Svelte 5 + `@kenn-io/kit-ui`.
- No kanban board, no mobile app, no token or federation admin in the browser.
- No hosted-daemon operations work. The UI is tested against local isolated daemons only.

## How this recon was run

Everything ran against the fork binary with a throwaway `KATA_HOME`. The hosted daemon and the Homebrew kata were never touched.

```sh
make web-install && make build            # ./kata with embedded UI (build output is gitignored)
R=$(mktemp -d); mkdir -p $R/home $R/ws $R/rhome $R/rws
# $R/home/config.toml: [web] listen = "127.0.0.1:47911", plus two [[daemon]] entries
#   (local-spoke local=true; second-daemon url=http://127.0.0.1:47912, token, allow_insecure)
# $R/rhome/config.toml: listen = "127.0.0.1:47912", [auth] token = "..."
L() { (cd $R/ws && env -u KATA_SERVER -u KATA_AUTH_TOKEN -u KATA_AUTHOR -u KATA_DB KATA_HOME=$R/home ./kata "$@"); }
L daemon start
R=$R ./docs/fork/frontend-overhaul/seed.sh  # 39 projects, 36 issues (30 open, 6 closed), links, comments, attention, closes
```

Seed contents ([seed.sh](seed.sh)):
- Projects: 39 on one daemon (5 named ones plus `side-project-01..34`, most of them empty).
- Links: parent/child, blocks, and related, including one cross-project link.
- Agent state: `work.attention` set to ok, needs-human, and stuck, each with `work.attention_msg`.
- Dates: one overdue deadline and schedules.
- Closes: six issues, one for each close reason, with typed evidence.

Screenshots were taken with Playwright 1.61.1 (chromium headless shell) at 1440x900 in dark mode, plus 390x844 for the narrow shots. Accessibility was checked with `@axe-core/playwright` 4.10.2 on the list, detail, and graph views.

## Current state

| View | Screenshot | What it shows |
|---|---|---|
| All Open | [01](screenshots/01-all-open.png) | Table: ID, title, updated, priority, due, owner, tags. Search, project, status, relationship, owner, and label filters. |
| Inbox / Today / Upcoming / Deadlines / Logbook | [02](screenshots/02-inbox.png) [03](screenshots/03-today.png) [04](screenshots/04-upcoming.png) [05](screenshots/05-deadlines.png) [06](screenshots/06-logbook.png) | System views. Inbox needs a designated inbox project. |
| Project scope | [07](screenshots/07-project-scope.png) [07b](screenshots/07b-project-expanded.png) | Children collapse under parents; "Expand all" reveals them. |
| Sidebar with 39 projects | [08](screenshots/08-sidebar-40-projects-scrolled.png) | Flat alphabetical list under "UNFILED". "New project" is at the very bottom. |
| Issue detail (read-only) | [09](screenshots/09-detail-agent-issue.png) [10](screenshots/10-detail-needs-human.png) [09b](screenshots/09b-detail-side-by-side.png) | Bottom split by default. A header icon toggles the split direction. |
| Closed issue | [11](screenshots/11-detail-closed-evidence.png) | Status chip plus a "closed (done)" event, nothing else. |
| Graph | [12](screenshots/12-graph.png) | ELK layout, filters, minimap. Detail sits underneath. |
| Edit mode | [13](screenshots/13-edit-issue.png) | A separate editor. The Complete button lives here. |
| New task | [14](screenshots/14-new-task.png) | Opens a "Choose Inbox project" modal. |
| Search / owner filter / columns | [15](screenshots/15-text-search.png) [16](screenshots/16-owner-filter.png) [17](screenshots/17-columns.png) | Filters are kept in the URL. The column picker offers 5 columns. |
| Daemon switcher | [18](screenshots/18-daemon-switcher.png) [40](screenshots/40-second-daemon.png) [41](screenshots/41-daemon-down.png) | Works. An unreachable target is shown only as a small red dot. |
| Close dialog | [21](screenshots/21-close-dialog.png) | Four reasons, one evidence field, a note of at least 40 characters. |
| Error / empty | [19](screenshots/19-route-error.png) [20](screenshots/20-empty-project.png) | Plain text messages with no way forward. |
| Narrow (390px) | [30](screenshots/30-narrow-all-open.png) [31](screenshots/31-narrow-detail.png) [32](screenshots/32-narrow-drawer.png) | Table clips horizontally. The sidebar becomes a drawer. |

Measured on this seed: All Open loaded in 883 ms (goto to first "New task" button), 879 DOM nodes, about 711 KB of compressed JS over 5 requests. No console errors or page errors. The build puts all the main JS in one 2.17 MB chunk (674 KB gzip) and Vite warns about it. axe found nothing on the list or detail views. On the graph it found `label` (critical, 3 nodes), `color-contrast` (serious, 11), and `nested-interactive` (serious, 8).

## Pain points

**O** means I saw it in a screenshot or reproduced it. **I** means inferred from source or docs and not reproduced. Ranked by impact on Henry's actual use: many projects, agents working them.

### P1. Agent attention is invisible (O)
- Seeded `work.attention=needs-human` plus `work.attention_msg="cannot repro locally; need CI runner access"` on `spoke-project#398b`. Neither value appears in the list ([01](screenshots/01-all-open.png)), the detail ([10](screenshots/10-detail-needs-human.png)), or edit mode.
- A DOM text probe on the detail page found only the event lines `updated work.attention` and `updated work.attention_msg`, with no values.
- The column picker ([17](screenshots/17-columns.png)) has no attention column, and there is no attention filter or view.
- Source check: `grep -rn attention web/src` (excluding generated code) returns nothing.
- Why it matters: finding "what needs me" across 40 projects currently takes the CLI (`kata list --meta work.attention=needs-human`), one project at a time.

### P2. Close reason, message, and evidence are invisible (O)
- `spoke-project#9tv8` was closed with `--commit 3f2a9c1 --test "go test ./internal/cli"` and a message. Its detail ([11](screenshots/11-detail-closed-evidence.png)) shows only a `closed` chip and a `closed (done)` event. The page text contains neither `3f2a9c1` nor `go test`.
- Logbook ([06](screenshots/06-logbook.png)) lists done, wontfix, duplicate, and audit-no-change closes identically.
- Close dialog ([21](screenshots/21-close-dialog.png)) differences from the CLI:
  - It offers 4 reasons. The CLI has 5; `audit-no-change` is missing.
  - It takes one evidence item. The CLI accepts repeatable `--evidence`.
- "Edit issue" is still offered on a closed issue.

### P3. Blocked and ready state are not shown in lists (O)
- `kata list` marks `8vt5`, `84cc`, and `9vxp` as blocked (●).
- In the UI those rows look the same as unblocked rows, even with children expanded ([07b](screenshots/07b-project-expanded.png)).
- No view matches `kata ready` or `kata next`. Blocking is only visible in detail links and the graph.

### P4. Many-project navigation doesn't scale (O)
- Sidebar ([01](screenshots/01-all-open.png), [08](screenshots/08-sidebar-40-projects-scrolled.png)):
  - 39 projects in one alphabetical list, and 31 of them have 0 open issues.
  - No project search, pinning, recents, or hide-empty option.
  - The busiest project (`spoke-project`, 11 open) sorts last.
  - "New project" is only reachable by scrolling to the bottom.
- Clicking **New task** while scoped to `spoke-project` does not create the task there. It opens a "Choose Inbox project" modal with an unfilterable 39-item list ([14](screenshots/14-new-task.png)).
- Inbox shows "No tasks" and doesn't explain that no inbox project is designated, even though a project named `inbox` exists with 1 issue ([02](screenshots/02-inbox.png)).
- The "UNFILED" header suggests projects can be grouped, but there is no visible way to group them (source not traced; see open questions).

### P5. Cross-project IDs are cut off exactly where they're unique (O)
- The ID column is fixed-width, so qualified IDs lose their suffix: `spoke-project#398b` renders as `spoke-project#398`, `side-project-07#kxxx` as `side-project-07#k`, `spoke-project#rk56` as `spoke-project#rk5` ([01](screenshots/01-all-open.png), [15](screenshots/15-text-search.png)).
- The short id is the unique part, and the project name is already shown in group headers.
- Repro: All Open with any project name of 13 or more characters.

### P6. Detail layout costs too much list (O)
- The default bottom split leaves about 11 list rows at 1440x900 ([09](screenshots/09-detail-agent-issue.png)).
- The graph gets about 330 px of height ([12](screenshots/12-graph.png)).
- A header icon button (tooltip "Side-by-side (list left, detail right)") switches layouts, but side-by-side is not the default. It also squeezes the list: titles wrap to two lines, only 4 columns fit, and the ID column still takes about a third of the list width ([09b](screenshots/09b-detail-side-by-side.png)).
- Read and edit are separate modes. **Complete** only appears after **Edit issue** ([09](screenshots/09-detail-agent-issue.png) vs [13](screenshots/13-edit-issue.png)), so closing takes an extra click and a mode change.

### P7. Smaller defects (O)
- **Search count mismatch.** Searching "sync" gives a header of "9 tasks" but "RESULTS 4" in the table ([15](screenshots/15-text-search.png)). Matching children are hidden under a collapsed parent.
- **Overdue dates look normal.**
  - Sep 12 (overdue) and Sep 16 render the same in All Open and Deadlines ([05](screenshots/05-deadlines.png)).
  - The detail shows the raw text `Deadline: 2026-09-12`.
- **Dead ends.**
  - An invalid route is a full-page message with no link back ([19](screenshots/19-route-error.png)).
  - An empty project shows "No tasks" with no create action ([20](screenshots/20-empty-project.png)).
- **Unreachable daemon.** Picking a stopped daemon leaves you on the current one. The only signal is a small red square beside the daemon name, with no message ([41](screenshots/41-daemon-down.png)).
- **Narrow screens.** At 390 px the table clips (priority is cut off; due, owner, and tags are off-screen), and the ID column takes about 40% of the width ([30](screenshots/30-narrow-all-open.png)). Detail and list are both cramped ([31](screenshots/31-narrow-detail.png)).
- **Sticky sort.** A single header click (Owner) kept that sort in every later view in the session ([18](screenshots/18-daemon-switcher.png), [20](screenshots/20-empty-project.png)). Minor, and possibly intended.
- **Graph accessibility.** The axe violations listed above.

### P8. Inferred and not reproduced (I)
- **No cross-project activity view.** The router's `systemViews` has no activity or timeline entry. Digest and audit exist only in the CLI.
- **No global keyboard shortcuts.** Key handlers in `web/src` are local Enter/Escape/Cmd-Enter only. The accessibility e2e test asserts there is no command palette. Agents create work faster than a human can triage it by mouse.
- **Daemon isn't in the URL.** After switching daemons the URL stayed `?view=all-open` ([40](screenshots/40-second-daemon.png)), so a link to a hosted-daemon issue can't identify its daemon.
- **Claims look like plain owners.** An agent's claim can't be told apart from a human owner, and there's no claim action in read-only detail.
- **Remote freshness.** Per AGENTS.md, remote workspaces poll because proxied SSE is disabled. Staleness on the hosted daemon was not measured.
- **Scale.** Performance with hundreds of issues per project was not measured. This seed has 36.

## Proposed changes

Each item names its merge-tax class:
- **U (upstream-able):** a generic defect or feature; better sent upstream than carried.
- **F (fork-only):** Henry-specific workflow; must be carried.
- **U?:** needs an upstream conversation first.

### Priority 0: agent visibility
1. **Attention everywhere (U?).**
   - Show an attention chip (ok / needs-human / stuck) with `attention_msg` as its tooltip or subtitle in list rows and detail.
   - Add an optional Attention column and an attention filter kept in the URL (`attention=needs-human`).
   - Upstream fit: `work.attention` is already documented in `docs/reference/metadata.md`.
2. **"Needs you" system view (F, U? later).** One view across all projects listing `needs-human` and `stuck` issues, grouped by project and sorted stuck first, then by age. It gets a sidebar badge count.
3. **Close record in detail and Logbook (U).**
   - Detail shows the close reason, message, actor, time, and each typed evidence item. Commit, PR, and test values render as code or links.
   - Logbook rows get a reason chip.
   - Hide or relabel "Edit issue" on closed issues.
   - Close dialog adds `audit-no-change` and repeatable evidence.
4. **Blocked and ready markers (U).** A blocked glyph and an "N blockers" hint in list rows, plus a Ready view that matches `kata ready`.

### Priority 1: scale and flow
5. **Project sidebar at scale (U).** A project filter box, a "hide projects with no open issues" toggle, pinned projects at the top, and New project moved next to the section header. Store pins in UI preferences, not project metadata. If they must persist across machines, see open questions.
6. **New task respects scope (U).** In a project scope, New task creates in that project. The inbox chooser appears only in system views, and it gets a filter input.
7. **ID column fix (U).** Never clip the short id. Either truncate the project prefix with an ellipsis, or show project and short id as separate cells.
8. **One detail mode (U).** Complete, reopen, and owner/claim actions become available in read-only detail. Side-by-side becomes the default at 1280 px and wider, and the toggle gets a visible label.

### Priority 2: polish and robustness
9. **Overdue styling (U).** Relative dates in detail.
10. **Dead-end states get actions (U).** Route error links to All Open; empty project offers New task; Inbox without a designated project explains itself and offers to choose one; an unreachable daemon shows an inline error naming the target and keeps the previous daemon selected.
11. **Consistent counts in search (U).**
12. **Graph accessibility (U).** Fix the 3 axe rule classes.
13. **Narrow layout (U).** Below 700 px, rows become two-line cards (title, then ID and priority and owner) instead of a clipped table.
14. **Keyboard (U?).** `/` focuses search, `j`/`k` move the selection, `Enter` opens, `e` edits, `c` completes, `Esc` closes. Show a `?` help overlay.
15. **Activity view (F).** A cross-project event feed with an actor filter, the browser version of `kata digest`.

### Priority 3
16. **Code-split the 2.17 MB main chunk (U).**
17. **Daemon name in the URL (U?).** Only if it can be done without touching the switcher trust model.

## Acceptance criteria

The fixture for every check:
1. Build the branch with `make build`.
2. Start an isolated daemon as in "How this recon was run".
3. Run `seed.sh`.
4. Open `http://127.0.0.1:47911/kata` at 1440x900 unless a check says otherwise.

Each check below can be done by hand or as a Playwright assertion.

| # | Change | Check |
|---|---|---|
| A1 | Attention | In All Open, the row "Flaky test: TestSyncReconnect times out on CI" shows `needs-human`. Its detail shows the text `cannot repro locally; need CI runner access`. The row "Retry budget exhausted silently on 503" shows `stuck`. |
| A2 | Attention filter | `?view=all-open&attention=needs-human` lists exactly 3 issues: Flaky test…, Rate-limit token exchange endpoint, Verify backup restore on staging. Reloading the URL gives the same 3. |
| A3 | Needs-you view | The view lists those 3 plus "Retry budget exhausted silently on 503", with the stuck issue first. The sidebar badge reads 4. After `kata meta set <ref> work.attention ok` on one of them, the view and badge drop to 3 without a manual reload. The live-update bound needs a decision; see Q5. |
| A4 | Close record | Logbook → "Fix typo in CLI help for sync" shows reason `done`, the message "Fixed typo in sync help text; verified help output snapshot test passes.", `commit 3f2a9c1`, and `test go test ./internal/cli`. "Spike: CRDT merge for offline edits" shows `wontfix`. "Idea: attention digest email" shows `duplicate` and links to the inbox issue. |
| A5 | Close dialog parity | The dialog offers 5 reasons including audit-no-change. Two evidence rows can be added, and after completion both appear in the close event's `payload.evidence` from `kata events --project spoke-project --json`. |
| A6 | Blocked marker | In spoke-project with Expand all, exactly "Remove legacy poller after rollout", "Roll out sync engine behind flag", and "Add sync_cursor migration" carry the blocked marker. A Ready view's issue set equals `kata ready --project spoke-project --json`. |
| A7 | Sidebar | Typing `spoke` in the project filter leaves only `spoke-project`. With hide-empty on, the project list has 8 entries. A pinned project stays at the top after reload. New project is visible without scrolling. |
| A8 | New task scope | Scoped to spoke-project, New task → type a title → Enter creates the issue in spoke-project (confirm with `kata list --project spoke-project`) and never shows the inbox chooser. |
| A9 | IDs | In All Open, every qualified ID cell's visible text ends with the issue's full 4-character short id. Assert with `innerText` plus `scrollWidth <= clientWidth`. |
| A10 | One detail mode | On the read-only detail of an open issue, a Complete button is visible without clicking Edit issue. At 1440 px the detail opens to the right of the list by default. |
| A11 | Overdue | In Deadlines, the Flaky test row's due cell has a distinct overdue style: a different color token and an `aria-label` containing "overdue". The Rotate TLS row does not. |
| A12 | Dead ends | `/kata?view=nope` shows a link that navigates to All Open. `side-project-03` scope shows a New task action. With second-daemon stopped, selecting it shows a message containing "second-daemon" and "unreachable" (or equivalent), and the list stays on local-spoke. |
| A13 | Search counts | Searching `sync` shows equal numbers in the header count and the results count. |
| A14 | Accessibility | axe on All Open, detail, graph, Needs-you, and Logbook: 0 critical and 0 serious violations. Existing `web/tests/accessibility.spec.ts` is extended and passes. |
| A15 | Narrow | At 390x844 All Open has no horizontal scroll (`document.scrollingElement.scrollWidth <= 390`), and each row shows title, short id, and priority. |
| A16 | Keyboard | With focus on body: `/` focuses search; `j` then `Enter` opens the first row's detail; `Esc` closes it. |
| A17 | No regression | `make web-check web-test web-e2e` passes. `make build` has no Vite chunk-size warning (only if item 16 is taken). |

## Merge tax

- **Upstream churn in `web/`.** Last 90 days of `upstream/main`: 27 of 199 commits touched `web/`, and 15 of those came in the last 30 days.
- **Hottest files:**
  - `web/src/lib/api/schema.d.ts`: 15 commits (generated).
  - `App.svelte`: 9.
  - `AppShell.svelte`: 7.
  - `lib/api/client.ts`: 5.
  - `lib/state/snapshot.ts` and `lib/kata/projection.ts`: 4 each.
- **Guidance:**
  - Send U items upstream. Every carried change to `AppShell.svelte`, `App.svelte`, or the snapshot and projection layer will conflict regularly.
  - Build F items (Needs-you view, activity view) as new components and a new `systemViews` entry. Keep edits to hot files to a few lines of wiring.
  - Never hand-edit `lib/api/generated/` or `schema.d.ts`.
  - Anything that needs a new API field is a daemon change and falls outside this spec's non-goals. The UI snapshot already includes `issue.metadata` (the editor reads `metadata.scheduled_on`), so attention needs no API change. Whether the close event payload with evidence reaches the browser event list is **unverified**; A4 may need a daemon read change.
- **Upstream norms.** Upstream contribution rules apply: test-first, evidence-gated regression tests, neutral names, no testing section in PRs.

## Open questions for Henry

1. **Upstream appetite.** Should U items go upstream as PRs from this fork (someone other than this agent opens them), or should the fork carry everything?
2. **Attention placement.** Is `work.attention` upstream-worthy UI (it is an upstream-documented convention), or fork-only?
3. **Layout.** Keep table and detail with side-by-side as the default, or do you want a board or triage-queue layout for the Needs-you view?
4. **Project scale.** Hide empty projects by default? Is "pinned" per-browser enough, or must pins follow you across both Macs (which would need daemon-side storage, a larger change)?
5. **Live updates on the hosted daemon.** Through the switcher, remote workspaces poll. Is a polling delay acceptable for Needs-you (what bound: 10 s, 30 s?), or is this blocked on proxied SSE?
6. **Grouping.** The sidebar shows an "UNFILED" group, so some project-grouping mechanism exists (`GroupedSidebarSection`), but I did not trace how projects get filed. Do you use it or want it?
7. **Keyboard.** Is a shortcut set wanted, and should it match the TUI's keys?
8. **Mobile.** Is narrow width a real use case, or only a no-breakage bar?
