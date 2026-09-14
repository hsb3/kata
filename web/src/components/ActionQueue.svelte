<script lang="ts">
  import type { KataTaskGroup, KataTaskSummary } from '../lib/kata/types'
  let {
    title,
    groups,
    selectedIssueUID,
    onSelect,
  }: {
    title: string
    groups: KataTaskGroup[]
    selectedIssueUID?: string | null | undefined
    onSelect: (issue: KataTaskSummary) => void
  } = $props()
</script>

<section class="action-queue" aria-label={title}>
  <h2>{title} <small>{groups.reduce((count, group) => count + group.issues.length, 0)}</small></h2>
  {#if groups.every((group) => group.issues.length === 0)}<p>No tasks</p>{/if}
  {#each groups as group (group.id)}
    {#if group.issues.length > 0}
      <h3>{group.title}</h3>
      {#each group.issues as issue (issue.uid)}
        <button
          type="button"
          class="issue-row"
          class:selected={selectedIssueUID === issue.uid}
          data-uid={issue.uid}
          onclick={() => onSelect(issue)}
        >
          <strong>{issue.title}</strong>
          <span class="cell-id">{issue.project_name}#{issue.short_id}</span>
          {#if issue.metadata['work.attention']}<span
              >{String(issue.metadata['work.attention'])}</span
            >{/if}
          {#if issue.metadata['work.attention_msg']}<span
              >{String(issue.metadata['work.attention_msg'])}</span
            >{/if}
        </button>
      {/each}
    {/if}
  {/each}
</section>

<style>
  .action-queue {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 16px;
  }
  h2 {
    margin: 0 0 16px;
    font-size: var(--font-size-lg);
  }
  h3 {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 16px 0 8px;
  }
  small {
    color: var(--text-secondary);
    font-weight: 400;
  }
  .issue-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    width: 100%;
    text-align: left;
    padding: 12px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    margin-bottom: 8px;
    overflow-wrap: anywhere;
  }
  .issue-row strong {
    flex-basis: 100%;
  }
  .issue-row span {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }
  .issue-row:hover,
  .issue-row.selected {
    background: var(--bg-row-selected);
  }
  .issue-row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .cell-id {
    font-family: var(--font-mono);
  }
</style>
