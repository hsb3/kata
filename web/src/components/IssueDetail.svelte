<script lang="ts">
  import {
    IssueDetail as SharedIssueDetail,
    projectIssueDetail,
    type KataIssueHostAction,
  } from '@kenn-io/kata-ui'
  import { Button, Chip, Typeahead } from '@kenn-io/kit-ui'
  import type { ComponentProps } from 'svelte'

  import IssueStateDialog from './IssueStateDialog.svelte'
  import IssueEditor from './IssueEditor.svelte'
  import IssueHistory from './IssueHistory.svelte'
  import RecurrencePanel from './RecurrencePanel.svelte'

  let props: ComponentProps<typeof IssueEditor> = $props()
  let editing = $state(false)

  const detail = $derived(projectIssueDetail(props.issue))
  const visibleRecurrences = $derived.by(() => {
    const recurrences = props.selectedRecurrences ?? []
    const attachedID = props.issue.issue.recurrence_id
    if (attachedID === undefined) return recurrences
    const attached = recurrences.find((recurrence) => recurrence.id === attachedID)
    return attached ? [attached] : []
  })
  const actions = $derived.by(() => {
    const actionsFenced = (props.actionsDisabled ?? false) || (props.authorityBlocked ?? false)
    const next: KataIssueHostAction[] =
      props.issue.issue.status === 'closed'
        ? []
        : [
            {
              id: 'edit',
              label: 'Edit issue',
              disabled: actionsFenced,
              invoke: () => {
                editing = true
              },
            },
          ]

    if (props.issue.issue.status === 'open' && !props.issue.issue.owner && props.onClaimIssue) {
      next.push({
        id: 'claim',
        label: 'Claim',
        disabled: actionsFenced,
        invoke: () => {
          void props.onClaimIssue?.(props.issue.issue.uid)
        },
      })
    }
    if (props.workspaceAction?.onClick) {
      next.push({
        id: 'workspace',
        label: props.workspaceAction.label,
        disabled: actionsFenced || (props.workspaceAction.disabled ?? false),
        busy: props.workspaceAction.busy ?? false,
        invoke: props.workspaceAction.onClick,
      })
    }
    if (props.onOpenGraph) {
      next.push({
        id: 'graph',
        label: 'Open reachable graph',
        disabled: actionsFenced,
        invoke: () => props.onOpenGraph?.(props.issue.issue),
      })
    }

    return next
  })
</script>

<section class="editor-mode" aria-label="Kata issue editor" hidden={!editing}>
  <div class="editor-toolbar">
    <Button size="sm" label="Done editing" onclick={() => (editing = false)} />
  </div>
  <IssueEditor {...props} />
</section>
{#if !editing}
  <div class="shared-detail">
    {#if props.issue.issue.status === 'open' && props.issue.issue.metadata['work.attention']}
      <Chip size="sm" tone="muted" uppercase={false}
        >{String(props.issue.issue.metadata['work.attention'])}</Chip
      >
      <p>{String(props.issue.issue.metadata['work.attention_msg'] ?? '')}</p>
    {/if}
    {#key `${props.issue.issue.uid}:${props.draftFenceGeneration ?? 0}`}
      <IssueStateDialog
        issue={props.issue}
        onCloseIssue={props.onCloseIssue}
        onReopenIssue={props.onReopenIssue}
        disabled={(props.actionsDisabled ?? false) || (props.authorityBlocked ?? false)}
      />
    {/key}
    <SharedIssueDetail {detail} {actions} />
    {#if props.issue.issue.status === 'open'}
      <Typeahead
        options={props.ownerOptions}
        value={props.issue.issue.owner ?? ''}
        placeholder="Owner"
        triggerPrefix="Owner:"
        fallbackLabel="Unassigned"
        allowClear
        clearLabel="Unassign"
        disabled={(props.actionsDisabled ?? false) || (props.authorityBlocked ?? false)}
        onselect={(owner) =>
          owner
            ? props.onAssignOwner(props.issue.issue.uid, owner)
            : props.onUnassignOwner(props.issue.issue.uid)}
      />
    {/if}
    {#if visibleRecurrences.length > 0}
      <RecurrencePanel recurrences={visibleRecurrences} readOnly />
    {/if}
    <IssueHistory
      events={props.events ?? []}
      onOpenReference={async (reference) => {
        const matches = await props.searchReferences?.(reference)
        const target = matches?.find((match) => match.qualified_id === reference)
        if (target) await props.onSelectIssue?.({ uid: target.uid })
      }}
    />
  </div>
{/if}

<style>
  .editor-mode[hidden] {
    display: none;
  }

  .shared-detail {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: var(--bg-primary);
    padding: 18px 22px;
  }

  .editor-mode {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
  }

  .editor-toolbar {
    display: flex;
    justify-content: flex-end;
    border-bottom: 1px solid var(--border-default);
    padding: 8px 22px;
    background: var(--bg-primary);
  }
</style>
