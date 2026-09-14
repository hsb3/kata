# Wave 1 report

**Blocked on A5 as written. Wave 1 is not accepted as complete.** Feature work stopped when the seeded walkthrough confirmed that the required CLI read cannot expose close evidence under its existing contract.

Implementation commit: `b42d5f242fadb6310e59259198e62b73b97c301c`.
Branch: `fork/frontend-wave1` on `origin`.
The requested first commit was `9c5e91a` (`fork: add wave 1 frontend brief`); fixture isolation and neutral actors are in `c2b8584`.

## Blocker: A5 names a CLI response without close history

The browser successfully closed the synthetic issue `spoke-project#kr0r` as `audit-no-change`, with two evidence items. The exact live [`show` response](screenshots/wave1/A5-cli-show.json) contains these top-level keys:

```json
["kata_api_version", "issue", "comments", "links", "labels"]
```

Its issue has `status: "closed"`, `closed_reason: "audit-no-change"`, and `closed_at`. There is no close event, message, or evidence field. The CLI [prints the daemon issue response directly](../../../cmd/kata/show.go#L60); the [response type has no close-history field](../../../internal/api/types.go#L695).

The existing events command independently confirms that both evidence items were persisted. The matching [event record](screenshots/wave1/A5-cli-close-event.json) contains:

```json
[
  {"type":"no-change-audit","rationale":"No changes needed after acceptance review"},
  {"type":"reviewed-paths","paths":["docs/reference/cli.md"]}
]
```

Reads used the fork binary in the seeded throwaway workspace, with the forbidden environment overrides unset:

```sh
(cd "$R/ws" && env -u KATA_SERVER -u KATA_AUTH_TOKEN -u KATA_AUTHOR -u KATA_DB \
  KATA_HOME="$R/home" "$K" show kr0r --project spoke-project --json)
(cd "$R/ws" && env -u KATA_SERVER -u KATA_AUTH_TOKEN -u KATA_AUTHOR -u KATA_DB \
  KATA_HOME="$R/home" "$K" events --project spoke-project --after 0 --limit 1000 --json)
```

**Decision needed to resume:** correct A5 to verify the persisted close event through `kata events` or the browser snapshot, or explicitly authorize a CLI output-contract change beyond the frontend brief. No CLI or daemon contract was changed to satisfy the verifier.

## Acceptance results

PASS records a completed check. FAIL / unproven records incomplete acceptance after the required stop; the evidence column identifies the coverage already available.

| Criterion | Result | Evidence |
|---|---|---|
| A1 | PASS | Seeded All Open showed both attention states; detail showed the exact runner-access message. [Screenshot](screenshots/wave1/A1-attention.png). |
| A2 | PASS | Exactly the three specified issues appeared before and after URL reload. [Screenshot](screenshots/wave1/A2-attention-filter.png). |
| A3 | PASS | Four seeded issues, stuck first, badge 4; a CLI metadata change reduced both list and badge to 3 in 20 ms without reload. [Initial view](screenshots/wave1/A3-needs-you.png), [live update](screenshots/wave1/A3-live-update.png). The isolated polling-mode browser test also passed within 30 seconds. |
| A4 | PASS | Seeded done message, actor, timestamp, commit and test were visible; wontfix was checked; the duplicate link opened its target. [Close record](screenshots/wave1/A4-close-record.png), [duplicate](screenshots/wave1/A4-duplicate.png). |
| A5 | FAIL — blocker | Five reasons and repeatable evidence work, and persistence is proven by the event record. The required `show --json` output cannot contain that evidence. [Dialog](screenshots/wave1/A5-repeatable-evidence.png), [closed UI at the blocked CLI check](screenshots/wave1/A5-cli-check-blocked.png), exact JSON responses above. |
| A6 | FAIL — unproven | Browser tests pass for active blockers, exclusion from Ready, and blocker removal after closure. The exact three seeded markers and CLI Ready set comparison were not reached. |
| A7 | FAIL — unproven | Browser tests pass for filtering, pin persistence and visible New project. Unit coverage includes finding the designated Inbox project through search. The seeded eight-entry and all-39-project checks were not reached. |
| A8 | FAIL — unproven | Browser coverage confirms scoped Enter capture without an Inbox chooser. The seeded `spoke-project` CLI confirmation was not reached. |
| A9 | FAIL — unproven | Full short-ID suffixes are preserved by the new cell layout; browser ID checks are present. The full seeded ID geometry sweep was not reached. |
| A10 | FAIL — unproven | Browser coverage confirms direct Complete and the desktop side-by-side default; component tests exercise claim and authority fencing. The seeded claim/reopen walkthrough was not reached. |
| A17 | PASS | `make web-check web-test`, `make web-e2e`, and `make build` exited 0. [Validation log](screenshots/wave1/validation.log). |

## Delivered and checked

The committed implementation includes attention chips and URL filtering, a global Needs you badge, focused Needs you and Ready queues, close records and reason chips, five close reasons with reason-appropriate repeatable evidence, active-blocker markers, project search/hide-empty/pins, scoped capture, intact ID suffixes, and direct detail actions with a labelled layout toggle. No new runtime dependency was added.

Verification used Bun 1.3.14, Go 1.27.0 and Playwright 1.61.1 Chromium. Web checks passed; 401 web tests, 19 shared-package tests and one packaging test passed. The full browser suite passed 38 tests. The existing opt-in documentation screenshot test was skipped. New coverage is in [wave1.spec.ts](../../../web/tests/wave1.spec.ts), the extended [accessibility spec](../../../web/tests/accessibility.spec.ts), and the [responsive spec](../../../web/tests/responsive.spec.ts).

Test-first failures covered missing attention/detail actions, close-record rendering, audit evidence choices, action-view routing and ordering, sidebar controls, column restoration, and clipped row status markers. The seeded walkthrough also caught the audit evidence matrix mismatch; the dialog now permits one audit rationale with optional reviewed paths, matching the unchanged daemon.

## Decisions, remaining work and isolation

- Pins are per browser; empty projects remain visible by default and can be hidden with the toggle. Project search also exposes projects omitted from the ordinary area list.
- Needs you sorts stuck groups before needs-human groups, then by age, with project grouping. Prioritized views remove general search, sorting, column controls and Inbox designation controls.
- Freshness bounds chosen for this wave: 10 seconds for direct local updates and 30 seconds for visible polling tabs. The polling test uses an isolated daemon with polling advertised in the fixture; hosted performance was not measured. Existing polling intervals and the switcher trust model were preserved.
- After the A5 decision, finish the seeded A6–A10 walkthrough and save its screenshots. No A6–A10 screenshot or full-wave acceptance is claimed here.
- P2/P3 remain out of scope. The existing Vite chunk-size warning remains; its removal was conditional on the excluded code-splitting work.
- Only branch-built binaries and throwaway daemon homes were used. Fixture dummy tokens were moved into temporary config files. The Homebrew client, hosted daemon, production databases, daemon APIs, schema, authentication/session model and switcher trust model were not modified.
- All started daemons were stopped; the final process check found zero owned daemon/test processes. The worktree and branch are retained for review and resumption. No merge, GitHub PR or GitHub comment was made.
