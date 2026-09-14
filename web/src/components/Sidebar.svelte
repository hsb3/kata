<script lang="ts">
  import AlarmClockIcon from '@lucide/svelte/icons/alarm-clock'
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days'
  import CheckCircleIcon from '@lucide/svelte/icons/check-circle-2'
  import InboxIcon from '@lucide/svelte/icons/inbox'
  import LayersIcon from '@lucide/svelte/icons/layers'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import StarIcon from '@lucide/svelte/icons/star'
  import { Checkbox, ScrollBox, showFlash, Typeahead, type TypeaheadOption } from '@kenn-io/kit-ui'

  import GroupedSidebarSection from './GroupedSidebarSection.svelte'

  import type {
    KataProjectSummary,
    KataTaskMutationResponse,
    KataTaskSearchFilters,
    KataTaskViewName,
  } from '../lib/kata/types'
  import type { KataAreaSummary, KataCurrentView } from '../lib/kata/authority'

  interface Props {
    needsYouCount?: number | undefined
    areas: KataAreaSummary[]
    projects: readonly KataProjectSummary[]
    currentView: KataCurrentView
    searchFilters: KataTaskSearchFilters
    projectCreationDisabled: boolean
    draftFenceGeneration?: number | undefined
    inboxProjectUID?: string | undefined
    inboxDesignationDisabled: boolean
    onOpenView: (name: KataTaskViewName) => void | Promise<void>
    onOpenProject: (projectUID: string) => void | Promise<void>
    onCreateProject: (name: string) => Promise<KataTaskMutationResponse>
    onDesignateInbox: (projectUID: string) => Promise<void>
  }

  let {
    areas,
    needsYouCount,
    projects,
    currentView,
    searchFilters,
    projectCreationDisabled,
    draftFenceGeneration = 0,
    inboxProjectUID,
    inboxDesignationDisabled,
    onOpenView,
    onOpenProject,
    onCreateProject,
    onDesignateInbox,
  }: Props = $props()

  const systemViews: Array<{
    name: KataTaskViewName
    label: string
    icon: typeof InboxIcon
  }> = [
    { name: 'needs-you', label: 'Needs you', icon: AlarmClockIcon },
    { name: 'ready', label: 'Ready', icon: CheckCircleIcon },
    { name: 'inbox', label: 'Inbox', icon: InboxIcon },
    { name: 'today', label: 'Today', icon: StarIcon },
    { name: 'upcoming', label: 'Upcoming', icon: CalendarDaysIcon },
    { name: 'deadlines', label: 'Deadlines', icon: AlarmClockIcon },
    { name: 'all', label: 'All Open', icon: LayersIcon },
    { name: 'logbook', label: 'Logbook', icon: CheckCircleIcon },
  ]

  let projectQuery = $state('')
  let hideEmpty = $state(false)
  let pinned = $state<string[]>(loadPins())
  function loadPins(): string[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('kata:pinned-projects/v1') ?? '[]')
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }
  function togglePin(uid: string): void {
    pinned = pinned.includes(uid) ? pinned.filter((value) => value !== uid) : [...pinned, uid]
    try {
      localStorage.setItem('kata:pinned-projects/v1', JSON.stringify(pinned))
    } catch {
      /* Preferences remain usable in memory. */
    }
  }
  const visibleAreas = $derived.by(() => {
    const visible = (project: KataProjectSummary) =>
      project.name.toLowerCase().includes(projectQuery.trim().toLowerCase()) &&
      (!hideEmpty || project.open_count > 0)
    const remaining = (projectQuery.trim() ? projects : []).filter(
      (project) => !areas.some((area) => area.projects.some((entry) => entry.uid === project.uid)),
    )
    return [
      { name: 'Pinned', projects: projects.filter((project) => pinned.includes(project.uid)) },
      ...areas.map((area) => ({
        ...area,
        projects: area.projects.filter((project) => !pinned.includes(project.uid)),
      })),
      {
        name: 'Other projects',
        projects: remaining.filter((project) => !pinned.includes(project.uid)),
      },
    ]
      .map((area) => ({ ...area, projects: area.projects.filter(visible) }))
      .filter((area) => area.projects.length > 0)
  })

  let creatingProject = $state(false)
  let createDraft = $state('')
  let createSaving = $state(false)
  let createInput: HTMLInputElement | null = $state(null)
  let collapsedAreas = $state<string[]>([])
  let inboxError = $state('')
  let lastDraftFenceGeneration = $state<number | null>(null)
  const inboxOptions = $derived.by<TypeaheadOption[]>(() =>
    projects
      .map((project) => ({ name: project.uid, label: project.name }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
  )

  $effect(() => {
    const nextGeneration = draftFenceGeneration
    if (lastDraftFenceGeneration === null) {
      lastDraftFenceGeneration = nextGeneration
      return
    }
    if (nextGeneration === lastDraftFenceGeneration) return
    lastDraftFenceGeneration = nextGeneration
    cancelCreatingProject()
  })

  function toggleArea(name: string): void {
    collapsedAreas = collapsedAreas.includes(name)
      ? collapsedAreas.filter((area) => area !== name)
      : [...collapsedAreas, name]
  }

  function viewCount(name: KataTaskViewName): number | undefined {
    const inboxProject = projects.find((project) => project.metadata.role === 'inbox')
    if (name === 'needs-you') return needsYouCount
    if (name === 'inbox') return inboxProject?.open_count
    if (name === 'today' && currentView.name === 'today' && searchFilters.scope.kind === 'all') {
      return currentView.groups.reduce((sum, group) => sum + group.issues.length, 0)
    }
    return undefined
  }

  function isProjectActive(uid: string): boolean {
    return searchFilters.scope.kind === 'project' && searchFilters.scope.project_uid === uid
  }

  function startCreatingProject(): void {
    if (projectCreationDisabled) return
    creatingProject = true
    createDraft = ''
    queueMicrotask(() => createInput?.focus())
  }

  function cancelCreatingProject(): void {
    creatingProject = false
    createDraft = ''
  }

  async function submitCreateProject(): Promise<void> {
    const name = createDraft.trim()
    if (!name || createSaving || projectCreationDisabled) return
    createSaving = true
    try {
      await onCreateProject(name)
      creatingProject = false
      createDraft = ''
    } catch (err) {
      showFlash(err instanceof Error ? err.message : 'Could not create project.', {
        tone: 'danger',
      })
    } finally {
      createSaving = false
    }
  }

  async function designateInbox(projectUID: string): Promise<boolean> {
    inboxError = ''
    try {
      await onDesignateInbox(projectUID)
      return true
    } catch (err) {
      inboxError = err instanceof Error ? err.message : 'Could not designate the Inbox project.'
      return false
    }
  }
</script>

<div class="kata-sidebar" aria-label="Kata navigation">
  <ScrollBox label="Kata navigation">
    <nav class="kata-nav" aria-label="System views">
      {#each systemViews as view (view.name)}
        {@const Icon = view.icon}
        {@const count = viewCount(view.name)}
        <button
          type="button"
          class:active={searchFilters.scope.kind === 'all' && currentView.name === view.name}
          aria-label={count !== undefined ? `${view.label} ${count}` : view.label}
          onclick={() => {
            void onOpenView(view.name)
          }}
        >
          <span class="nav-icon"><Icon size={14} strokeWidth={1.75} /></span>
          <span class="nav-label">{view.label}</span>
          {#if count !== undefined}
            <span class="nav-count">{count}</span>
          {/if}
        </button>
      {/each}
    </nav>

    {#if currentView.name !== 'needs-you' && currentView.name !== 'ready'}
      <div class="inbox-project-control">
        <Typeahead
          options={inboxOptions}
          value={inboxProjectUID ?? ''}
          fallbackLabel="Choose a project"
          placeholder="Inbox project"
          triggerPrefix="Inbox project:"
          emptyLabel="No projects available"
          disabled={inboxDesignationDisabled || projects.length === 0}
          error={inboxError}
          onselect={designateInbox}
        />
      </div>
    {/if}

    <div class="project-create">
      {#if creatingProject}
        <form
          class="project-create-form"
          onsubmit={(event) => {
            event.preventDefault()
            void submitCreateProject()
          }}
        >
          <input
            bind:this={createInput}
            aria-label="New project name"
            placeholder="Project name"
            bind:value={createDraft}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitCreateProject()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelCreatingProject()
              }
            }}
            disabled={createSaving || projectCreationDisabled}
          />
        </form>
      {:else}
        <button
          type="button"
          class="project-create-button"
          disabled={projectCreationDisabled}
          onclick={startCreatingProject}
        >
          <PlusIcon size={13} strokeWidth={1.9} />
          <span>New project</span>
        </button>
      {/if}
    </div>
    <div class="project-tools">
      <input aria-label="Filter projects" placeholder="Filter projects" bind:value={projectQuery} />
      <Checkbox
        label="Hide empty projects"
        checked={hideEmpty}
        onchange={(checked) => {
          hideEmpty = checked
        }}
      />
    </div>
    {#each visibleAreas as area (area.name)}
      <GroupedSidebarSection
        label={area.name}
        count={area.projects.length}
        collapsed={collapsedAreas.includes(area.name)}
        onclick={() => toggleArea(area.name)}
      >
        {#each area.projects as project (project.uid)}
          <div class="project-row">
            <button
              type="button"
              class="project-select-button"
              class:active={isProjectActive(project.uid)}
              onclick={() => void onOpenProject(project.uid)}
            >
              <span class="project-name">{project.name}</span>
              <span class="project-count count">{project.open_count}</span>
            </button>
            <button
              type="button"
              class="pin-button"
              aria-label={`${pinned.includes(project.uid) ? 'Unpin' : 'Pin'} ${project.name}`}
              aria-pressed={pinned.includes(project.uid)}
              onclick={() => togglePin(project.uid)}><StarIcon size={13} /></button
            >
          </div>
        {/each}
      </GroupedSidebarSection>
    {/each}
  </ScrollBox>
</div>

<style>
  .project-tools {
    display: grid;
    gap: 8px;
    padding: 0 12px 12px;
    font-size: var(--font-size-xs);
  }
  .project-tools > input {
    width: 100%;
    min-width: 0;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    padding: 6px;
    border-radius: 4px;
  }
  .project-row {
    display: flex;
    align-items: center;
  }
  .pin-button {
    background: transparent;
    color: var(--text-secondary);
    border: 0;
    padding: 6px;
    cursor: pointer;
  }
  .pin-button[aria-pressed='true'] {
    color: var(--accent-amber);
  }
  .kata-sidebar {
    --sidebar-list-border: var(--border-default);
    --sidebar-row-bg: transparent;
    --sidebar-row-hover-bg: var(--bg-surface-hover);
    --sidebar-row-padding: 6px 10px;

    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--border-default);
    background: var(--bg-inset);
  }

  .kata-nav {
    display: grid;
    gap: 4px;
    padding: 12px;
  }

  .inbox-project-control {
    padding: 0 12px 12px;
  }

  .inbox-project-control :global(.kit-typeahead) {
    width: 100%;
  }

  .kata-nav button,
  .project-select-button,
  .project-create-button {
    width: 100%;
    min-height: 30px;
    border: 0;
    border-radius: 6px;
    background: var(--sidebar-row-bg);
    color: var(--text-secondary);
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--sidebar-row-padding);
    text-align: left;
    font: inherit;
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .kata-nav button:hover,
  .project-select-button:hover,
  .project-create-button:hover {
    background: var(--sidebar-row-hover-bg);
    color: var(--text-primary);
  }

  .kata-nav button.active,
  .project-select-button.active {
    background: var(--bg-row-selected);
    color: var(--text-primary);
  }

  .nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .kata-nav button.active .nav-icon {
    color: var(--accent-blue);
  }

  .project-select-button.active .project-count,
  .kata-nav button.active .nav-count {
    color: var(--text-primary);
  }

  .kata-nav button.active .nav-label,
  .project-select-button.active .project-name {
    font-weight: 650;
  }

  .nav-label,
  .project-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-count,
  .project-count {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
  }

  .project-create {
    padding: 12px;
  }

  .project-select-button {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .project-create-form input {
    width: 100%;
    min-height: 30px;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    padding: 5px 8px;
  }

  .project-create-form input:focus {
    outline: none;
    border-color: var(--accent-blue);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-blue) 18%, transparent);
  }
</style>
