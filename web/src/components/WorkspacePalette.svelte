<script lang="ts">
  import { tick } from 'svelte'
  import type { WebDaemonInfo } from '../lib/daemons/client'
  import type { KataProjectSummary, KataTaskSearchFilters } from '../lib/kata/types'
  import { toggleKataTaskSort, type KataTaskSort, type KataTaskSortKey } from '../lib/kata/sort'
  import type { KataTaskColumnVisibility } from '../lib/kata/columns'
  import { MAX_FONT_SIZE, MIN_FONT_SIZE, type Preferences } from '../lib/state/preferences'
  import ColumnPicker from './ColumnPicker.svelte'
  import IssueFilters from './IssueFilters.svelte'
  import KataDaemonSwitcher from './KataDaemonSwitcher.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    open: boolean
    trigger?: HTMLButtonElement | null
    filters: KataTaskSearchFilters
    projects: readonly KataProjectSummary[]
    sort: KataTaskSort
    columnVisibility: KataTaskColumnVisibility
    preferences: Preferences
    daemons: WebDaemonInfo[]
    activeDaemonID?: string | undefined
    daemonSwitching?: boolean | undefined
    reconnecting?: boolean | undefined
    daemonError?: string | undefined
    canMutate: boolean
    mutationPending: boolean
    onClose: () => void
    onFiltersChange: (filters: KataTaskSearchFilters, changed: keyof KataTaskSearchFilters) => void
    onReset: () => void
    onSortChange: (sort: KataTaskSort) => void
    onColumnVisibilityChange: (visibility: KataTaskColumnVisibility) => void
    onPreferencesChange: (preferences: Preferences) => void
    onSelectDaemon: (id: string) => void
    onNewTask: () => void
    onNewProject: () => void
    onOpenView: (name: 'inbox' | 'today' | 'ready' | 'all') => void
  }

  let {
    open,
    trigger = null,
    filters,
    projects,
    sort,
    columnVisibility,
    preferences,
    daemons,
    activeDaemonID = undefined,
    daemonSwitching = false,
    reconnecting = false,
    daemonError = undefined,
    canMutate,
    mutationPending,
    onClose,
    onFiltersChange,
    onReset,
    onSortChange,
    onColumnVisibilityChange,
    onPreferencesChange,
    onSelectDaemon,
    onNewTask,
    onNewProject,
    onOpenView,
  }: Props = $props()

  let palette = $state<HTMLElement | null>(null)

  $effect(() => {
    if (!open) return
    void tick().then(() => palette?.querySelector<HTMLElement>('[data-palette-focus]')?.focus())
  })

  function close(): void {
    onClose()
    queueMicrotask(() => trigger?.focus())
  }

  function setSort(key: KataTaskSortKey): void {
    onSortChange(toggleKataTaskSort(sort, key))
  }

  function showAllColumns(): void {
    onColumnVisibilityChange({
      attention: true,
      updated: true,
      priority: true,
      due: true,
      owner: true,
      tags: true,
    })
  }

  function setTheme(theme: Preferences['theme']): void {
    onPreferencesChange({ ...preferences, theme })
  }

  function setGraphDirection(splitDirection: Preferences['splitDirection']): void {
    onPreferencesChange({ ...preferences, splitDirection })
  }

  function setFontSize(fontSize: number): void {
    if (!Number.isFinite(fontSize)) return
    onPreferencesChange({
      ...preferences,
      fontSize: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(fontSize))),
    })
  }

  function setFontFamily(fontFamily: Preferences['fontFamily']): void {
    onPreferencesChange({ ...preferences, fontFamily })
  }
</script>

<Modal
  {open}
  title="Workspace palette"
  ariaLabel="Workspace palette"
  width={680}
  showClose
  onClose={close}
>
  <div class="workspace-palette" bind:this={palette}>
    {#if daemons.length > 0}
      <section class="daemon-row" aria-label="Daemon selection">
        <span>Daemon</span><KataDaemonSwitcher
          {daemons}
          activeId={activeDaemonID}
          activeStatusLabel={daemonError ?? (reconnecting ? 'Reconnecting…' : undefined)}
          activeStatusTone={daemonError ? 'error' : undefined}
          disabled={daemonSwitching || mutationPending}
          onSelect={onSelectDaemon}
        />
      </section>
    {/if}
    <section aria-label="Search and filters">
      <div class="section-heading">
        <h2>Find tasks</h2>
        <div class="action-group">
          <button
            data-palette-focus
            type="button"
            class="button-action"
            disabled={!canMutate || mutationPending}
            onclick={onNewTask}>New task</button
          >
          <button
            type="button"
            class="button-action"
            disabled={!canMutate || mutationPending}
            onclick={onNewProject}>New project</button
          >
          <button type="button" onclick={onReset}>Reset filters</button>
        </div>
      </div>
      <p class="hint">Reset keeps the current project scope.</p>
      <IssueFilters {filters} {projects} onChange={onFiltersChange} />
    </section>
    <section aria-label="List settings">
      <h2>List</h2>
      <div class="control-row">
        <span>Sort</span>
        {#each ['updated', 'priority', 'title', 'owner'] as key (key)}
          <button
            type="button"
            aria-pressed={sort.key === key}
            onclick={() => setSort(key as KataTaskSortKey)}>{key}</button
          >
        {/each}
        <ColumnPicker
          visibility={columnVisibility}
          onchange={onColumnVisibilityChange}
          onShowAll={showAllColumns}
        />
      </div>
    </section>
    <section aria-label="Workspace actions">
      <h2>Workspace</h2>
      <div class="control-row">
        <button type="button" onclick={() => onOpenView('inbox')}>Inbox</button>
        <button type="button" onclick={() => onOpenView('today')}>Today</button>
        <button type="button" onclick={() => onOpenView('ready')}>Ready</button>
        <button type="button" onclick={() => onOpenView('all')}>All Open</button>
      </div>
      <div class="control-row">
        <span>Appearance</span>
        {#each ['system', 'light', 'dark'] as theme (theme)}<button
            type="button"
            aria-pressed={preferences.theme === theme}
            onclick={() => setTheme(theme as Preferences['theme'])}>{theme}</button
          >{/each}
      </div>
      <div class="control-row">
        <span>Text size</span>
        <input
          type="number"
          class="font-size-input"
          aria-label="Text size"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step="1"
          value={preferences.fontSize}
          oninput={(event) => setFontSize(event.currentTarget.valueAsNumber)}
        />
        <span class="font-size-unit">px</span>
      </div>
      <div class="control-row">
        <span>Font</span>
        {#each ['system', 'rounded', 'mono'] as fontFamily (fontFamily)}<button
            type="button"
            aria-pressed={preferences.fontFamily === fontFamily}
            onclick={() => setFontFamily(fontFamily as Preferences['fontFamily'])}
            >{fontFamily}</button
          >{/each}
      </div>
      <div class="control-row">
        <span>Graph layout</span>
        <button
          type="button"
          aria-pressed={preferences.splitDirection === 'horizontal'}
          onclick={() => setGraphDirection('horizontal')}>Left to right</button
        >
        <button
          type="button"
          aria-pressed={preferences.splitDirection === 'vertical'}
          onclick={() => setGraphDirection('vertical')}>Top to bottom</button
        >
      </div>
    </section>
  </div>
</Modal>

<style>
  .workspace-palette {
    display: grid;
    gap: var(--space-7);
    padding: var(--space-6);
    max-height: min(70vh, 680px);
    overflow-y: auto;
  }
  section {
    display: grid;
    gap: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
  }
  .section-heading,
  .control-row {
    display: flex;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    flex-wrap: wrap;
  }
  .section-heading button {
    margin-left: 0;
  }
  .action-group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-left: auto;
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }
  button {
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-xs);
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    border-color: var(--accent-blue);
    color: var(--accent-blue);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .button-action {
    border-color: var(--accent-blue);
    color: var(--accent-blue);
    font-weight: 600;
  }
  .button-action:hover:not(:disabled) {
    background: var(--accent-blue-soft);
  }
  .control-row > span {
    min-width: 88px;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }
  .font-size-input {
    width: 4.5em;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-xs);
  }
  .font-size-unit {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }
  .daemon-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding-bottom: var(--space-5);
    border-bottom: 1px solid var(--border-default);
  }
  .daemon-row > span {
    min-width: 88px;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
  }
  :global(.workspace-palette .kata-search-panel) {
    padding: 0;
    border: 0;
    background: transparent;
  }
  :global(.workspace-palette .kata-search-toolbar) {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  :global(.workspace-palette .query-field) {
    flex-basis: 100%;
  }
</style>
