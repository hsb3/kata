# Frontend interaction patterns

The next polish pass follows the requested top-rail palette, collapsible navigation,
and independent detail and graph surfaces. It builds on the existing wave-1 UI.

## Layers

- The list MUST remain the base workspace. Opening detail or a reachable graph MUST
  place it above the workspace, outside table overflow and split-pane constraints.
- Detail MUST offer visible expand/restore and close controls. The graph MUST have
  its own viewport-sized overlay and close control.
- The palette MUST open from the top rail. Dialogs opened from detail MUST remain
  usable above detail, with focus confined to the active dialog.

## Space allocation

- Desktop navigation MUST collapse without losing the active project, pins, or
  filters. A visible top-rail toggle MUST remain available when collapsed.
- Sidebar collapse MUST persist per browser. Small screens MUST retain a temporary
  navigation drawer rather than reserve a sidebar column.
- Detail MUST use the available viewport height. Its expanded mode MUST occupy at
  least 90 percent of viewport width at 1440 by 900; narrow screens MUST use the
  full available width. The graph MUST not inherit a table or list-pane height cap.

## Navigation

- Selected issue and reachable-graph state MUST remain addressable through the
  existing URL. Browser Back, reload, and direct links MUST preserve that contract.
- Closing detail MUST return to the current list and preserve its filters and
  scroll context. Closing a graph MUST restore the issue/list context that opened it.
- Selecting a graph node MUST not discard the graph root. Escape MUST close only
  the active overlay; closing nested forms MUST leave their parent detail intact.

## Keyboard and discoverability

- The rail MUST expose labelled controls for navigation and the palette. Ctrl/Cmd+K
  MUST open the palette; Escape MUST dismiss it and restore focus to its trigger.
- The palette MUST consolidate workspace/list search, filters, sorting, columns,
  appearance, daemon selection, and common creation/navigation actions. It MUST
  reuse existing state and callbacks instead of maintaining parallel filter state.
- Form fields and contextual detail/graph controls MUST stay with their content.
  Moving workspace controls MUST preserve labels, keyboard use, and disabled states.
- Space controls MUST have visible buttons and discoverable keyboard behavior;
  shortcuts MUST not steal ordinary input while someone is editing text.

## Density and hierarchy

- The list MUST prioritize task content, result counts, and current scope. Less-used
  controls belong in the palette; active filters MUST remain discoverable.
- Detail MUST retain the existing action, evidence, relationship, and activity
  information. Authority, pending-write, and stale-session restrictions MUST apply
  identically when a control moves into an overlay.
- Empty and error states MUST offer a relevant next step. Narrow layouts MUST keep
  primary actions and task identifiers readable without horizontal page overflow.

## Non-goals

- This pass MUST NOT change daemon APIs, persisted schemas, authentication policy,
  deployment infrastructure, or the installed Kata client.
- The existing Svelte/Vite/Bun stack and component styling MUST remain the basis;
  this is an interaction and layout change, not a design-system replacement.
- Remaining broader spec work MUST stay separately tracked rather than be implied
  complete by this polish pass.

## Mapping the remaining spec

| Spec work | Pattern and disposition |
|---|---|
| Sidebar collapse and detail focus | Space allocation and layers; implement in this pass |
| Reachable graph layout | Layers and navigation; implement in this pass |
| P2 overdue styling and relative dates, A11 | Density and accessible status; separate follow-up |
| P2 dead-end actions, A12 | Navigation and empty states; separate follow-up |
| P2 search counts, A13 | Density and one filter state; verify while consolidating controls |
| P2 graph accessibility, A14 | Keyboard and active-dialog focus; verify overlay behavior now, track broader audit separately |
| P2 narrow layout, A15 | Space allocation; prevent overlay regressions now, track responsive row redesign separately |
| P2 activity view | Density and hierarchy; separate follow-up |
| P3 shortcut help, A16 | Keyboard and discoverability; palette and overlay shortcuts now, broader shortcut help separately |
| P3 code splitting, A17 | Separate performance follow-up after measuring the built output |
| P3 daemon name in URL | Navigation; separate routing follow-up |
