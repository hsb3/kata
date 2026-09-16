<script lang="ts">
  import { DetailDrawer, IconButton, TopBar, type TypeaheadOption } from '@kenn-io/kit-ui'
  import MonitorIcon from '@lucide/svelte/icons/monitor'
  import MenuIcon from '@lucide/svelte/icons/menu'
  import MoonIcon from '@lucide/svelte/icons/moon'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import SunIcon from '@lucide/svelte/icons/sun'
  import type { UIIssueReference } from '../lib/api/generated'
  import type { WebDaemonInfo } from '../lib/daemons/client'
  import type { KataRoute, ShareableFilters, SystemView } from '../lib/router'
  import {
    deriveKataAreas,
    defaultKataTaskSearchFilters,
    projectKataWorkspaceView,
  } from '../lib/kata/authority'
  import { createKataLinkFilters } from '../lib/kata/linkFilters'
  import { normalizeKataUISnapshot } from '../lib/kata/projection'
  import type {
    KataTaskMutationResponse,
    KataTaskCloseRequest,
    KataTaskEditPatch,
    KataTaskSearchFilters,
    KataTaskStatusFilter,
    KataTaskViewName,
  } from '../lib/kata/types'
  import type { UISnapshot } from '../lib/state/snapshot'
  import { defaultPreferences, type Preferences } from '../lib/state/preferences'
  import ActionQueue from './ActionQueue.svelte'
  import IssueCollection from './IssueCollection.svelte'
  import IssueDetail from './IssueDetail.svelte'
  import IssueFilters from './IssueFilters.svelte'
  import IssueGraph from './IssueGraph.svelte'
  import InboxProjectChooser from './InboxProjectChooser.svelte'
  import KataDaemonSwitcher from './KataDaemonSwitcher.svelte'
  import QuickCapture from './QuickCapture.svelte'
  import Sidebar from './Sidebar.svelte'

  type AppRoute = Exclude<KataRoute, { kind: 'route-error' }>

  interface Props {
    route: AppRoute
    snapshot: UISnapshot
    loading: boolean
    canMutate: boolean
    mutationPending: boolean
    mutationMessage?: string | undefined
    draftResetGeneration: number
    draftFenceGeneration?: number | undefined
    ownerOptions: TypeaheadOption[]
    preferences?: Preferences | undefined
    daemons?: WebDaemonInfo[] | undefined
    activeDaemonID?: string | undefined
    daemonSwitching?: boolean | undefined
    reconnecting?: boolean | undefined
    stale?: boolean | undefined
    readOnly?: boolean | undefined
    daemonError?: string | undefined
    onPreferencesChange?: ((preferences: Preferences) => void) | undefined
    onSelectDaemon?: ((id: string) => void) | undefined
    onNavigate: (route: AppRoute) => void | Promise<void>
    onReadAttentionCount?: (() => Promise<number>) | undefined
    onCreateProject: (name: string) => Promise<KataTaskMutationResponse>
    onDesignateInbox: (projectUID: string) => Promise<void>
    onCreateIssue: (title: string) => void | Promise<void>
    searchReferences: (query: string) => Promise<UIIssueReference[]>
    onMoveIssue: (toProjectUID: string) => boolean | Promise<boolean>
    onPatchMetadata: (uid: string, patch: Record<string, unknown>) => boolean | Promise<boolean>
    onAddComment: (uid: string, body: string) => boolean | Promise<boolean>
    onEditIssue: (uid: string, patch: KataTaskEditPatch) => boolean | Promise<boolean>
    onClaimIssue?: ((uid: string) => boolean | Promise<boolean>) | undefined
    onAssignOwner: (uid: string, owner: string) => boolean | Promise<boolean>
    onUnassignOwner: (uid: string) => boolean | Promise<boolean>
    onSetPriority: (uid: string, priority: number | null) => boolean | Promise<boolean>
    onAddLabel: (uid: string, label: string) => boolean | Promise<boolean>
    onRemoveLabel: (uid: string, label: string) => void | Promise<void>
    onCloseIssue: (request: KataTaskCloseRequest) => boolean | Promise<boolean>
    onReopenIssue: () => void | Promise<void>
    onDeleteIssue: () => boolean | Promise<boolean>
    onCreateRecurrence: (
      projectID: number,
      input: import('../lib/kata/types').KataCreateRecurrenceInput,
    ) => Promise<void>
    onPatchRecurrence: (
      id: number,
      input: import('../lib/kata/types').KataPatchRecurrenceInput,
      etag: string,
    ) => Promise<void>
    onDeleteRecurrence: (recurrence: import('../lib/kata/types').KataRecurrence) => Promise<boolean>
  }

  let {
    route,
    snapshot,
    loading,
    canMutate,
    mutationPending,
    mutationMessage = undefined,
    draftResetGeneration,
    draftFenceGeneration = 0,
    ownerOptions,
    preferences = defaultPreferences,
    daemons = [],
    activeDaemonID = undefined,
    daemonSwitching = false,
    reconnecting = false,
    stale = false,
    readOnly = false,
    daemonError = undefined,
    onPreferencesChange = () => {},
    onSelectDaemon = () => {},
    onNavigate,
    onReadAttentionCount,
    onCreateProject,
    onDesignateInbox,
    onCreateIssue,
    searchReferences,
    onMoveIssue,
    onPatchMetadata,
    onAddComment,
    onEditIssue,
    onClaimIssue,
    onAssignOwner,
    onUnassignOwner,
    onSetPriority,
    onAddLabel,
    onRemoveLabel,
    onCloseIssue,
    onReopenIssue,
    onDeleteIssue,
    onCreateRecurrence,
    onPatchRecurrence,
    onDeleteRecurrence,
  }: Props = $props()

  let needsYouCount = $state<number | undefined>()
  $effect(() => {
    void snapshot.cursor
    void activeDaemonID
    needsYouCount = undefined
    if (!onReadAttentionCount || stale) return
    let canceled = false
    void onReadAttentionCount()
      .then((count) => {
        if (!canceled) needsYouCount = count
      })
      .catch(() => {})
    return () => {
      canceled = true
    }
  })

  let captureOpen = $state(false)
  let inboxChooserOpen = $state(false)
  let mobileNavigationOpen = $state(false)
  let detailExpanded = $state(false)
  let linkFilters = $state(createKataLinkFilters('all'))
  let navigationGeneration = $state(0)
  let graphSelectedUID = $derived<string | null>(
    route.issueUID && route.graph ? route.issueUID : null,
  )

  let projection = $derived(normalizeKataUISnapshot(snapshot))
  let inboxProject = $derived(
    projection.projects.find((project) => project.metadata.role === 'inbox'),
  )
  let hasInbox = $derived(inboxProject !== undefined)
  let viewName = $derived(viewNameForRoute(route))
  let searchFilters = $derived(searchFiltersForRoute(route, viewName))
  let currentView = $derived(
    projectKataWorkspaceView({
      view: viewName,
      filters: searchFilters,
      snapshot: projection,
      issues: projection.issues,
    }),
  )
  let areas = $derived(deriveKataAreas(projection.projects))
  let selectedProject = $derived.by(() => {
    const scope = searchFilters.scope
    return scope.kind === 'project'
      ? projection.projects.find((project) => project.uid === scope.project_uid)
      : undefined
  })
  let selectedIssueUID = $derived(route.issueUID ?? null)

  function navigate(next: AppRoute): void {
    navigationGeneration += 1
    void onNavigate(next)
  }

  function openView(name: KataTaskViewName): void {
    mobileNavigationOpen = false
    navigate({
      kind: 'kata',
      view: systemViewName(name),
      graph: false,
      filters: emptyShareableFilters(),
    })
  }

  function openProject(projectUID: string): void {
    mobileNavigationOpen = false
    navigate({
      kind: 'kata',
      projectUID,
      graph: false,
      filters: emptyShareableFilters(),
    })
  }

  function updateFilters(
    filters: KataTaskSearchFilters,
    changed: keyof KataTaskSearchFilters,
  ): void {
    const shareable = shareableFilters(filters, viewName, changed)
    if (filters.scope.kind === 'project') {
      navigate({ ...route, projectUID: filters.scope.project_uid, filters: shareable })
      return
    }
    const next = { ...route, filters: shareable }
    delete next.projectUID
    navigate(next)
  }

  function selectIssue(issueUID: string): void {
    navigate({
      ...route,
      issueUID,
      graph: false,
      filters: route.filters,
    })
  }

  function openGraph(issueUID: string): void {
    navigate({
      ...route,
      issueUID,
      graph: true,
      filters: route.filters,
    })
  }

  function closeGraph(): void {
    if (!route.issueUID) return
    navigate({ ...route, graph: false })
  }

  function closeDetail(): void {
    const next = { ...route, graph: false }
    delete next.issueUID
    navigate(next)
  }

  function toggleSidebar(): void {
    onPreferencesChange({ ...preferences, sidebarCollapsed: !preferences.sidebarCollapsed })
  }

  function cycleTheme(): void {
    const theme =
      preferences.theme === 'system' ? 'light' : preferences.theme === 'light' ? 'dark' : 'system'
    onPreferencesChange({ ...preferences, theme })
  }

  function beginNewTask(): void {
    if (!canMutate || mutationPending) return
    if (selectedProject || hasInbox) captureOpen = true
    else inboxChooserOpen = true
  }

  async function chooseInbox(projectUID: string): Promise<void> {
    await onDesignateInbox(projectUID)
    inboxChooserOpen = false
    captureOpen = true
  }

  function themeLabel(): string {
    return preferences.theme[0]!.toUpperCase() + preferences.theme.slice(1)
  }

  function viewNameForRoute(current: AppRoute): KataTaskViewName {
    if (current.view) return current.view === 'all-open' ? 'all' : current.view
    return current.projectUID || current.issueUID ? 'all' : 'inbox'
  }

  function systemViewName(name: KataTaskViewName): SystemView {
    return name === 'all' ? 'all-open' : name
  }

  function searchFiltersForRoute(
    current: AppRoute,
    currentView: KataTaskViewName,
  ): KataTaskSearchFilters {
    const defaults = defaultKataTaskSearchFilters(currentView)
    return {
      scope: current.projectUID
        ? { kind: 'project', project_uid: current.projectUID }
        : { kind: 'all' },
      status: statusFilter(current.filters.status, defaults.status),
      owner: current.filters.owner.length === 1 ? current.filters.owner[0]! : '',
      label: current.filters.label.length === 1 ? current.filters.label[0]! : '',
      attention: current.filters.attention,
      query: current.filters.text ?? '',
      relationships: [...current.filters.relationship],
    }
  }

  function statusFilter(
    values: readonly string[],
    fallback: KataTaskStatusFilter,
  ): KataTaskStatusFilter {
    if (values.length !== 1) return values.length === 0 ? fallback : 'all'
    const value = values[0]
    return value === 'open' || value === 'ready' || value === 'closed' || value === 'all'
      ? value
      : 'all'
  }

  function shareableFilters(
    filters: KataTaskSearchFilters,
    currentView: KataTaskViewName,
    changed: keyof KataTaskSearchFilters,
  ): ShareableFilters {
    const defaultStatus = defaultKataTaskSearchFilters(currentView).status
    const result: ShareableFilters = {
      status:
        changed === 'status'
          ? filters.status === defaultStatus
            ? []
            : [filters.status]
          : [...route.filters.status],
      owner:
        changed === 'owner'
          ? filters.owner.trim()
            ? [filters.owner.trim()]
            : []
          : [...route.filters.owner],
      label:
        changed === 'label'
          ? filters.label.trim()
            ? [filters.label.trim()]
            : []
          : [...route.filters.label],
      relationship: [...(filters.relationships ?? [])],
      attention: filters.attention,
    }
    if (filters.query.trim()) result.text = filters.query.trim()
    return result
  }

  function emptyShareableFilters(): ShareableFilters {
    return { status: [], owner: [], label: [], relationship: [] }
  }

  function scopeLabel(): string {
    if (selectedProject) return selectedProject.name
    return (
      [
        { name: 'inbox', label: 'Inbox' },
        { name: 'today', label: 'Today' },
        { name: 'upcoming', label: 'Upcoming' },
        { name: 'deadlines', label: 'Deadlines' },
        { name: 'all', label: 'All Open' },
        { name: 'logbook', label: 'Logbook' },
        { name: 'needs-you', label: 'Needs you' },
        { name: 'ready', label: 'Ready' },
      ].find((view) => view.name === viewName)?.label ?? 'Kata'
    )
  }
</script>

{#snippet navigationSidebar()}
  <Sidebar
    {areas}
    needsYouCount={onReadAttentionCount
      ? needsYouCount
      : projection.issues.filter(
          (issue) =>
            issue.status === 'open' &&
            ['needs-human', 'stuck'].includes(String(issue.metadata['work.attention'])),
        ).length}
    projects={projection.projects}
    currentView={{
      name: currentView.view,
      groups: currentView.groups,
      fetched_at: currentView.fetched_at,
    }}
    {searchFilters}
    projectCreationDisabled={!canMutate || mutationPending}
    {draftFenceGeneration}
    inboxProjectUID={inboxProject?.uid}
    inboxDesignationDisabled={!canMutate || mutationPending}
    onOpenView={openView}
    onOpenProject={openProject}
    {onCreateProject}
    {onDesignateInbox}
  />
{/snippet}

<section class="kata-feature" aria-label="Kata workspace">
  <TopBar class="kata-header" ariaLabel="Kata workspace">
    {#snippet left()}
      <h1 class="kata-brand">Kata</h1>
      {#if daemons.length > 0}
        <KataDaemonSwitcher
          {daemons}
          activeId={activeDaemonID}
          activeStatusLabel={daemonError ?? (reconnecting ? 'Reconnecting…' : undefined)}
          activeStatusTone={daemonError ? 'error' : undefined}
          disabled={daemonSwitching || mutationPending}
          onSelect={onSelectDaemon}
        />
      {:else if daemonError || reconnecting}
        <span
          class="daemon-fallback-status"
          class:error={daemonError}
          role="status"
          aria-label="Kata daemon status"
        >
          {daemonError ?? 'Reconnecting…'}
        </span>
      {/if}
    {/snippet}
    {#snippet right()}
      <div class="kata-header-actions">
        <span class="mobile-navigation-trigger">
          <IconButton
            ariaLabel="Open navigation"
            title="Open navigation"
            onclick={() => {
              mobileNavigationOpen = true
            }}
          >
            <MenuIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
        </span>
        <IconButton ariaLabel={`Theme: ${themeLabel()}`} title="Change theme" onclick={cycleTheme}>
          {#if preferences.theme === 'light'}
            <SunIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          {:else if preferences.theme === 'dark'}
            <MoonIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          {:else}
            <MonitorIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          {/if}
        </IconButton>
        <button
          type="button"
          onclick={toggleSidebar}
          aria-label={preferences.sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          class="layout-label"
          >{preferences.sidebarCollapsed ? 'Show navigation' : 'Hide navigation'}</button
        >
        <button
          type="button"
          class="accent-button header-action"
          disabled={!canMutate || mutationPending}
          title="New task"
          onclick={beginNewTask}
        >
          <PlusIcon size={13} strokeWidth={1.9} aria-hidden="true" />
          <span>New task</span>
        </button>
      </div>
    {/snippet}
  </TopBar>
  {#if stale || readOnly}
    <aside
      class="authority-status"
      role="status"
      aria-label={stale ? 'Stale Kata data' : 'Read-only Kata session'}
    >
      {stale
        ? 'Snapshot may be out of date. Changes are paused.'
        : 'This Kata session is read-only.'}
    </aside>
  {/if}
  <div
    class:sidebar-collapsed={preferences.sidebarCollapsed}
    class="kata-layout"
    aria-busy={loading}
  >
    <div class="desktop-navigation">
      {@render navigationSidebar()}
    </div>

    <div class="kata-main">
      {#if mutationMessage}
        <p class="mutation-message" role="alert">{mutationMessage}</p>
      {/if}
      {@render listPane()}
    </div>
  </div>
</section>

{#if mobileNavigationOpen}
  <DetailDrawer
    title="Kata navigation"
    width="min(320px, calc(100vw - 40px))"
    onclose={() => {
      mobileNavigationOpen = false
    }}
  >
    {@render navigationSidebar()}
  </DetailDrawer>
{/if}

{#if route.issueUID && !route.graph}
  <DetailDrawer
    ariaLabel="Task detail"
    closable={false}
    width={detailExpanded ? 'calc(100vw - 40px)' : 'min(720px, calc(100vw - 40px))'}
    onclose={closeDetail}
    header={detailHeader}
  >
    <div class="task-detail-content">{@render detailPane()}</div>
  </DetailDrawer>
{/if}

{#if route.issueUID && route.graph}
  <DetailDrawer
    ariaLabel="Reachable task graph"
    closable={false}
    width="calc(100vw - 40px)"
    onclose={closeGraph}
    header={graphHeader}
  >
    <div class="graph-overlay-content">
      {#if projection.selected_graph && projection.selected_detail}
        <IssueGraph
          graph={projection.selected_graph}
          sourceIssue={projection.selected_detail.issue}
          selectedUID={graphSelectedUID}
          layoutDirection={preferences.splitDirection === 'horizontal' ? 'LR' : 'TB'}
          onBack={closeGraph}
          onSelectIssue={(uid) => {
            graphSelectedUID = uid
          }}
        />
      {:else}
        <section class="detail-unavailable" role="status">
          The reachable graph is unavailable from the current authority.
        </section>
      {/if}
    </div>
  </DetailDrawer>
{/if}

{#snippet detailHeader()}
  <div class="overlay-header-actions">
    <button type="button" class="layout-label" onclick={() => (detailExpanded = !detailExpanded)}>
      {detailExpanded ? 'Restore detail' : 'Expand detail'}
    </button>
    <button type="button" class="layout-label" aria-label="Close detail" onclick={closeDetail}
      >Close</button
    >
  </div>
{/snippet}

{#snippet graphHeader()}
  <div class="overlay-header-actions">
    <button type="button" class="layout-label" aria-label="Close graph" onclick={closeGraph}
      >Close</button
    >
  </div>
{/snippet}

{#snippet listPane()}
  <div class="list-column kata-list">
    {#if viewName === 'needs-you' || viewName === 'ready'}
      {#if viewName === 'ready'}
        <label class="action-scope"
          >Project
          <select
            aria-label="Ready project"
            value={route.projectUID ?? ''}
            onchange={(event) =>
              updateFilters(
                {
                  ...searchFilters,
                  scope: event.currentTarget.value
                    ? { kind: 'project', project_uid: event.currentTarget.value }
                    : { kind: 'all' },
                },
                'scope',
              )}
          >
            <option value="">All projects</option
            >{#each projection.projects as project (project.uid)}<option value={project.uid}
                >{project.name}</option
              >{/each}
          </select>
        </label>
      {/if}
      <ActionQueue
        title={viewName === 'needs-you' ? 'Needs you' : 'Ready'}
        groups={currentView.groups}
        {selectedIssueUID}
        onSelect={(issue) => selectIssue(issue.uid)}
      />
    {:else}
      <IssueFilters
        filters={searchFilters}
        projects={projection.projects}
        onChange={updateFilters}
      />
      <IssueCollection
        {navigationGeneration}
        currentView={{
          name: currentView.view,
          groups: currentView.groups,
          fetched_at: currentView.fetched_at,
        }}
        issueCatalog={projection.issues}
        scopeLabel={scopeLabel()}
        scopedProjectName={selectedProject?.name ?? null}
        {selectedIssueUID}
        {loading}
        statusFilter={searchFilters.status}
        readyIssueUIDs={projection.member_issue_uid_set}
        onSelect={(issue) => selectIssue(issue.uid)}
        onOpenGraph={(issue) => openGraph(issue.uid)}
      />
    {/if}
  </div>
{/snippet}

{#snippet detailPane()}
  <div class="detail-column">
    {#if projection.selected_state === 'available' && projection.selected_detail}
      <IssueDetail
        issue={projection.selected_detail}
        events={[...projection.selected_history]}
        issueCatalog={projection.issues}
        {searchReferences}
        {linkFilters}
        onLinkFiltersChange={(next) => {
          linkFilters = next
        }}
        projects={[...projection.projects]}
        {ownerOptions}
        selectedRecurrences={[...projection.selected_recurrences]}
        actionsDisabled={!canMutate || mutationPending}
        authorityBlocked={!canMutate}
        {draftResetGeneration}
        {draftFenceGeneration}
        movePending={mutationPending}
        {onMoveIssue}
        {onPatchMetadata}
        {onAddComment}
        {onEditIssue}
        {onClaimIssue}
        {onAssignOwner}
        {onUnassignOwner}
        {onSetPriority}
        {onAddLabel}
        {onRemoveLabel}
        {onCloseIssue}
        {onReopenIssue}
        {onDeleteIssue}
        onSelectIssue={(target) => selectIssue(target.uid)}
        onOpenGraph={(issue) => openGraph(issue.uid)}
        {onCreateRecurrence}
        {onPatchRecurrence}
        {onDeleteRecurrence}
      />
    {:else}
      <section class="detail-unavailable" role="status">
        {projection.selected_state === 'archived'
          ? 'This issue is archived.'
          : 'This issue is unavailable from the current authority.'}
      </section>
    {/if}
  </div>
{/snippet}

<QuickCapture
  open={captureOpen}
  disabled={!canMutate || mutationPending}
  {draftFenceGeneration}
  onClose={() => {
    captureOpen = false
  }}
  onSubmit={onCreateIssue}
/>

<InboxProjectChooser
  open={inboxChooserOpen}
  projects={projection.projects.map((project) => ({ uid: project.uid, name: project.name }))}
  onClose={() => {
    inboxChooserOpen = false
  }}
  onSelect={chooseInbox}
/>

<style>
  .action-scope {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    align-items: center;
  }
  .action-scope select {
    min-width: 0;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 6px;
  }
  .layout-label {
    background: transparent;
    border: 0;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
  }
  .kata-feature {
    height: 100%;
    min-height: 0;
    background: var(--bg-app);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .kata-brand {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: 650;
    line-height: 1.2;
    white-space: nowrap;
  }

  .daemon-fallback-status {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  .daemon-fallback-status.error {
    color: var(--accent-red);
  }

  .authority-status {
    position: absolute;
    top: calc(var(--header-height, 44px) + var(--space-3));
    right: var(--space-3);
    z-index: 20;
    max-width: min(360px, calc(100% - 24px));
    border: 1px solid var(--accent-amber);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    box-shadow: var(--shadow-popover, 0 8px 24px rgb(15 23 42 / 14%));
    color: var(--text-primary);
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-sm);
    pointer-events: none;
  }

  .kata-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex: 0 0 auto;
  }

  .header-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
  }

  .accent-button {
    border: 1px solid var(--accent-blue);
    border-radius: var(--radius-sm);
    background: var(--accent-blue);
    color: var(--text-on-accent);
    min-height: 28px;
    padding: 4px 10px;
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  .accent-button:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .accent-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .kata-layout {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
  }

  .kata-layout.sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .kata-layout.sidebar-collapsed .desktop-navigation {
    display: none;
  }

  .desktop-navigation {
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .mobile-navigation-trigger {
    display: none;
  }

  .kata-main {
    min-width: 0;
    min-height: 0;
    display: flex;
    position: relative;
    overflow: hidden;
  }

  .list-column {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-primary);
    container-type: inline-size;
    container-name: list-pane;
  }

  .detail-column {
    min-width: 0;
    width: 100%;
    min-height: 0;
    display: flex;
  }

  .task-detail-content {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }

  .task-detail-content .detail-column {
    flex: 1 1 auto;
  }

  .graph-overlay-content {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }

  .graph-overlay-content :global(.kata-graph-pane) {
    flex: 1 1 auto;
  }

  .overlay-header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    width: 100%;
  }

  .detail-unavailable {
    margin: auto;
    padding: var(--space-6);
    color: var(--text-muted);
    text-align: center;
  }

  .mutation-message {
    position: absolute;
    z-index: 10;
    top: var(--space-3);
    right: var(--space-3);
    max-width: min(420px, calc(100% - 24px));
    margin: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-size-sm);
  }

  @media (max-width: 760px) {
    .kata-layout {
      grid-template-columns: 1fr;
    }

    .desktop-navigation {
      display: none;
    }

    .mobile-navigation-trigger {
      display: inline-flex;
    }

    :global(.kit-detail-drawer-overlay:has(.task-detail-content) .kit-detail-drawer) {
      width: 100vw !important;
      max-width: 100vw;
    }
  }
</style>
