# Wave 1 report

**A5 is resolved under the lead's corrected verifier. The requested main merge is complete. A10 has one remaining scope gap: owner-local Claim is rejected by the unchanged daemon allowlist.**

The seeded walkthrough was completed before the merge, as requested. Merge commit `c6c9ae3cf7fdd4a78ac01504682dd89c999af4c4` incorporates `origin/main` at `a91b7b29d4daaaaf720bf82e48954b7919e63617` into `fork/frontend-wave1`. The merge was clean. `bun run generate` completed without a generated-file diff; no generated file was hand-edited.

## Acceptance evidence

| Criterion | Result | Evidence |
|---|---|---|
| A1 | PASS | Seeded All Open showed needs-human and stuck; detail showed the exact runner-access message. [Screenshot](screenshots/wave1/A1-attention.png). |
| A2 | PASS | Exactly the three specified issues appeared before and after reloading the attention-filter URL. [Screenshot](screenshots/wave1/A2-attention-filter.png). |
| A3 | PASS | Stuck first, four issues and badge 4; a CLI metadata change reduced both to 3 without reload in 20 ms. [Initial view](screenshots/wave1/A3-needs-you.png), [live update](screenshots/wave1/A3-live-update.png). Post-merge polling coverage passed within the chosen 30-second bound. |
| A4 | PASS | Done reason, message, actor, timestamp, commit and test were visible; wontfix was checked; the duplicate link opened its target. [Close record](screenshots/wave1/A4-close-record.png), [duplicate](screenshots/wave1/A4-duplicate.png). |
| A5 | PASS | Per the lead correction, persisted evidence is verified through `kata events --project spoke-project --json`. The [recorded close event](screenshots/wave1/A5-cli-close-event.json) contains both typed items in `payload.evidence`. Five reasons and two evidence rows were exercised. [Dialog](screenshots/wave1/A5-repeatable-evidence.png). Post-merge live tests cover done and audit evidence persistence. |
| A6 | PASS | Exactly the three specified seeded issues carried blocker markers. Ready matched the CLI issue-UID set: eight initially, then nine after the A8 capture. The retained [comparison](screenshots/wave1/A6-ready-comparison.json) has identical CLI/browser arrays. [Blockers](screenshots/wave1/A6-blockers.png), [Ready](screenshots/wave1/A6-ready.png). |
| A7 | PASS | Project filter found only spoke-project; hide-empty showed eight entries; the pin survived reload at the top; New project stayed in view; all 39 projects were reachable with hide-empty off. [Screenshot](screenshots/wave1/A7-project-navigation.png). |
| A8 | PASS | Scoped Enter capture created `Wave scoped capture` in spoke-project without an Inbox chooser. Confirmed by [CLI list](screenshots/wave1/A8-cli-list.json). [Screenshot](screenshots/wave1/A8-scoped-capture.png). |
| A9 | PASS | Each rendered qualified ID was checked against its issue's full short ID and had `scrollWidth <= clientWidth`. [Screenshot](screenshots/wave1/A9-intact-ids.png). |
| A10 | GAP — Claim authorization | Direct Complete, reopen, the labelled toggle and the 1440px side-by-side default passed. [Screenshot](screenshots/wave1/A10-detail-actions.png). Claim returned HTTP 403; exact gap below. |
| A17 | PASS | Post-merge `make web-check web-test`, `make web-e2e`, and `make build` exited 0. The isolated `go test ./...` rerun also passed. [Validation log](screenshots/wave1/validation.log). |

The CLI comparisons used the branch binary inside the preserved throwaway workspace, with `KATA_SERVER`, `KATA_AUTH_TOKEN`, `KATA_AUTHOR` and `KATA_DB` unset. The A6 and A8 reads were `ready --project spoke-project --json` and `list --project spoke-project --json`. A5's retained event was captured with an explicit `--after 0 --limit 1000` window. No CLI or daemon contract was changed for the A5 correction; the tracked spec now names the corrected events verifier.

## Exact remaining gap

Clicking Claim on an unowned seeded issue sent the existing claim action and returned:

```json
{"status":403,"error":{"code":"web_local_operation_forbidden","message":"browser session authorization failed"}}
```

[Recorded response](screenshots/wave1/A10-claim-response.json), [rejected action screenshot](screenshots/wave1/A10-claim-rejected.png).

The local-browser [action allowlist](../../../internal/daemon/web_session.go#L476) permits assign, close, move, priority, reopen and unassign, but excludes claim. That file is unchanged by the requested main merge. This prevents the owner-local Claim flow from satisfying the broader A10 scope, although the criterion's Complete/default-layout checks pass. Resolving it requires an explicit decision about the daemon's SPA authorization boundary; the wave does not bypass the refusal or change that boundary.

## Main integration and verification

Teammate attribution remains in the generated API models, web snapshot projection, shared detail projection, and both comment renderers. A new [live browser check](../../../web/tests/wave1.spec.ts) creates a comment with separate author and teammate values, checks the snapshot field, and verifies `example-owner / example-agent` in both read and edit detail while the new Complete action remains available.

Post-merge toolchains: Bun 1.3.14, Go 1.27.0, Playwright 1.61.1 Chromium. Web checks passed; the web suite passed 401 tests, the shared-package suite passed 21 tests, and the separate packaging check passed. The browser suite passed 39 tests, including teammate attribution, polling updates, audit evidence and narrow-pane status visibility. The existing opt-in documentation screenshot test was skipped.

The additional ledger-required Go suite initially encountered host-config-sensitive resolver failures and a PostgreSQL fixture port-discovery failure. The complete rerun passed with an explicit throwaway `KATA_HOME` and short `TMPDIR`; no source change was needed for those environment failures.

## Scope and delivery

- Pins are per browser. Empty projects remain visible by default; the hide-empty toggle is optional. Prioritized queues remove general search, sorting, column controls and Inbox designation controls.
- The local update bound is 10 seconds; the visible polling-tab bound is 30 seconds. Polling was tested on an isolated daemon with polling advertised by the fixture. Hosted performance was not measured.
- The requested main merge imports upstream teammate attribution and its schema-27 changes. No additional wave-specific backend, schema, CLI, authentication or switcher changes were made.
- P2/P3 remain excluded. The existing Vite chunk-size warning is outside this wave's conditional code-splitting requirement. No new runtime dependency was added.
- Every started walkthrough daemon was stopped. The final process check found zero owned daemon/test processes.
- Branch: `fork/frontend-wave1` on origin. One wave-1 divergence row is maintained in `FORK_CHANGES.md`. No merge into main, GitHub PR, or GitHub comment was made.
