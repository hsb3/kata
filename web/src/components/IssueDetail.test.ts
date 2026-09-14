import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KataProjectSummary, KataTaskDetail } from '../lib/kata/types'

import IssueDetail from './IssueDetail.svelte'

type IssueDetailProps = ComponentProps<typeof IssueDetail>

function makeIssue(overrides: Partial<KataTaskDetail['issue']> = {}): KataTaskDetail {
  return {
    issue: {
      id: 1,
      uid: 'issue-1',
      project_id: 1,
      project_uid: 'project-1',
      project_name: 'Inbox',
      short_id: 'I-1',
      qualified_id: 'INBOX-1',
      title: 'Ship the thing',
      body: 'Initial body',
      status: 'open',
      metadata: { checklist: [{ id: 'item-1', text: 'Send', done: false }] },
      revision: 1,
      author: 'user-a',
      created_at: '2026-06-01T12:00:00Z',
      updated_at: '2026-06-01T12:00:00Z',
      ...overrides,
    },
    comments: [],
    labels: [
      { issue_id: 1, label: 'review', author: 'user-a', created_at: '2026-06-01T12:00:00Z' },
    ],
    links: [],
  }
}

function makeProject(uid: string, name: string, role = ''): KataProjectSummary {
  return {
    id: uid === 'project-1' ? 1 : 2,
    uid,
    name,
    metadata: role ? { role } : {},
    open_count: 1,
    revision: 1,
    created_at: '2026-06-01T12:00:00Z',
  }
}

function renderDetail(props: Partial<IssueDetailProps> = {}) {
  return render(IssueDetail, {
    props: {
      issue: makeIssue(),
      projects: [makeProject('project-1', 'Inbox', 'inbox'), makeProject('project-2', 'Roadmap')],
      ownerOptions: [],
      onMoveIssue: vi.fn(async () => true),
      onPatchMetadata: vi.fn(async () => true),
      onEditIssue: vi.fn(async () => true),
      onAssignOwner: vi.fn(async () => true),
      onUnassignOwner: vi.fn(async () => true),
      onSetPriority: vi.fn(async () => true),
      onAddLabel: vi.fn(async () => true),
      onRemoveLabel: vi.fn(),
      onCloseIssue: vi.fn(async () => true),
      onReopenIssue: vi.fn(),
      onDeleteIssue: vi.fn(async () => true),
      ...props,
    },
  })
}

async function openEditor(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'Edit issue' }))
}

describe('IssueDetail', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('claims an unowned issue directly from read detail', async () => {
    const onClaimIssue = vi.fn(async () => true)
    renderDetail({ onClaimIssue })
    await fireEvent.click(screen.getByRole('button', { name: 'Claim' }))
    expect(onClaimIssue).toHaveBeenCalledWith('issue-1')
  })

  it('shows attention and completion without entering edit mode', () => {
    renderDetail({
      issue: makeIssue({
        metadata: { 'work.attention': 'needs-human', 'work.attention_msg': 'Need runner access' },
      }),
    })
    expect(screen.getByText('needs-human')).toBeTruthy()
    expect(screen.getByText('Need runner access')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Complete' })).toBeTruthy()
  })

  it('renders close evidence and offers reopen instead of edit', () => {
    renderDetail({
      issue: makeIssue({ status: 'closed', closed_reason: 'done' }),
      events: [
        {
          event_id: 2,
          event_uid: 'event-close',
          origin_instance_uid: 'instance-example',
          project_id: 1,
          project_uid: 'project-1',
          project_name: 'spoke-project',
          type: 'issue.closed',
          actor: 'example-agent',
          created_at: '2026-06-01T12:31:00Z',
          payload: {
            reason: 'done',
            message: 'Fixed the output and checked the help text.',
            evidence: [
              { type: 'commit', sha: '3f2a9c1' },
              { type: 'test', command: 'go test ./internal/cli' },
            ],
          },
        },
      ],
    })
    expect(
      within(document.querySelector('.shared-detail') as HTMLElement).getByText(
        'Fixed the output and checked the help text.',
      ),
    ).toBeTruthy()
    expect(
      within(document.querySelector('.shared-detail') as HTMLElement).getByText('3f2a9c1'),
    ).toBeTruthy()
    expect(
      within(document.querySelector('.shared-detail') as HTMLElement).getByText(
        'go test ./internal/cli',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit issue' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy()
  })

  it('submits repeatable audit evidence from read detail and fences stale actions', async () => {
    const onCloseIssue = vi.fn(async () => true)
    const view = renderDetail({ onCloseIssue })
    await fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5)
    await fireEvent.click(within(dialog).getByRole('radio', { name: /Audit/ }))
    expect(within(dialog).queryByRole('option', { name: 'Test command' })).toBeNull()
    await fireEvent.input(within(dialog).getByLabelText('Evidence value'), {
      target: { value: 'No changes required after review' },
    })
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Add evidence' }))
    await fireEvent.change(within(dialog).getAllByLabelText('Evidence type')[1]!, {
      target: { value: 'reviewed-paths' },
    })
    await fireEvent.input(within(dialog).getAllByLabelText('Evidence value')[1]!, {
      target: { value: 'docs/reference/cli.md' },
    })
    await fireEvent.input(within(dialog).getByLabelText(/Completion note/), {
      target: { value: 'Reviewed the behavior and confirmed no changes are needed.' },
    })
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Complete' }))
    expect(onCloseIssue).toHaveBeenCalledWith({
      reason: 'audit-no-change',
      message: 'Reviewed the behavior and confirmed no changes are needed.',
      evidence: [
        { type: 'no-change-audit', rationale: 'No changes required after review' },
        { type: 'reviewed-paths', paths: ['docs/reference/cli.md'] },
      ],
    })
    await view.rerender({ actionsDisabled: true, authorityBlocked: true })
    expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('renders the package-owned presentation before entering Kata editing mode', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T13:00:00Z'))
    renderDetail()

    const detail = screen.getByRole('region', { name: 'Kata issue detail' })
    expect(within(detail).getByRole('heading', { name: 'Ship the thing' })).toBeTruthy()
    expect(within(detail).getByText('INBOX-1')).toBeTruthy()
    expect(within(detail).getByText('Initial body')).toBeTruthy()
    expect(within(detail).getByRole('button', { name: 'Edit issue' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Task detail' })).toBeNull()
  })

  it('shows recurrence and history to read-only users without mutation controls', () => {
    const view = renderDetail({
      actionsDisabled: true,
      events: [
        {
          event_id: 1,
          event_uid: 'event-1',
          origin_instance_uid: 'instance-example',
          type: 'issue.commented',
          project_id: 1,
          project_uid: 'project-1',
          project_name: 'example-project',
          actor: 'user-a',
          created_at: '2026-06-01T12:31:00Z',
        },
      ],
      selectedRecurrences: [
        {
          id: 1,
          uid: 'recurrence-1',
          project_id: 1,
          rrule: 'FREQ=WEEKLY;COUNT=2',
          dtstart: '2026-06-01',
          timezone: 'UTC',
          template_title: 'Weekly example',
          template_body: '',
          template_labels: [],
          template_metadata: {},
          next_occurrence_key: '2026-06-08',
          author: 'user-a',
          revision: 1,
          created_at: '2026-06-01T12:00:00Z',
          updated_at: '2026-06-01T12:00:00Z',
        },
      ],
    })
    const sharedDetail = view.container.querySelector('.shared-detail')
    expect(sharedDetail).not.toBeNull()
    const shared = within(sharedDetail as HTMLElement)

    expect(shared.getByText('Weekly example')).toBeTruthy()
    expect(shared.getByText('commented')).toBeTruthy()
    expect(shared.getByRole('heading', { name: 'Events' })).toBeTruthy()
    expect((shared.getByRole('button', { name: 'Edit issue' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(shared.queryByRole('button', { name: /New recurrence/ })).toBeNull()
    expect(shared.queryByRole('button', { name: 'Delete recurrence' })).toBeNull()
    expect(shared.queryByRole('button', { name: 'Weekly example' })).toBeNull()
  })

  it('edits title and description through the issue edit callback', async () => {
    const onEditIssue = vi.fn(async () => true)
    renderDetail({ onEditIssue })
    await openEditor()

    await fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    await fireEvent.input(screen.getByLabelText('Edit title'), {
      target: { value: 'Updated title' },
    })
    await fireEvent.keyDown(screen.getByLabelText('Edit title'), { key: 'Enter' })

    expect(onEditIssue).toHaveBeenCalledWith('issue-1', { title: 'Updated title' })

    await fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    await fireEvent.input(screen.getByLabelText('Edit description'), {
      target: { value: 'Updated body' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onEditIssue).toHaveBeenCalledWith('issue-1', { body: 'Updated body' })
  })

  it('preserves editor drafts when returning to the shared presentation', async () => {
    renderDetail()
    await openEditor()

    await fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    await fireEvent.input(screen.getByLabelText('Edit description'), {
      target: { value: 'Keep this body draft' },
    })
    await fireEvent.input(screen.getByLabelText('Comment'), {
      target: { value: 'Keep this comment draft' },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Done editing' }))
    await openEditor()

    expect(
      (screen.getByRole('textbox', { name: 'Edit description' }) as HTMLTextAreaElement).value,
    ).toBe('Keep this body draft')
    expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe(
      'Keep this comment draft',
    )
  })

  it('keeps unrelated drafts visible for manual copying after local authority expires', async () => {
    const onEditIssue = vi.fn(async () => true)
    const view = renderDetail({ onEditIssue })
    await openEditor()

    await fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    await fireEvent.input(screen.getByLabelText('Edit description'), {
      target: { value: 'Keep this unrelated body draft' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    await fireEvent.input(screen.getByLabelText('Edit title'), {
      target: { value: 'Accepted title' },
    })
    await fireEvent.keyDown(screen.getByLabelText('Edit title'), { key: 'Enter' })

    await view.rerender({ actionsDisabled: true })

    expect(
      (screen.getByRole('region', { name: 'Task detail' }) as HTMLElement & { inert: boolean })
        .inert,
    ).toBe(true)
    expect((screen.getByRole('textbox', { name: 'Edit title' }) as HTMLInputElement).value).toBe(
      'Accepted title',
    )
    expect(
      (screen.getByRole('textbox', { name: 'Edit description' }) as HTMLTextAreaElement).value,
    ).toBe('Keep this unrelated body draft')

    await view.rerender({ actionsDisabled: true, draftResetGeneration: 1 })
    await view.rerender({ actionsDisabled: false })

    expect(screen.queryByRole('textbox', { name: 'Edit title' })).toBeNull()
    expect(
      (screen.getByRole('textbox', { name: 'Edit description' }) as HTMLTextAreaElement).value,
    ).toBe('Keep this unrelated body draft')
    expect(onEditIssue).toHaveBeenCalledWith('issue-1', { title: 'Accepted title' })
  })

  it('preserves a newer selection draft when an older mutation reset arrives', async () => {
    const view = renderDetail({
      issue: makeIssue({ uid: 'issue-2', short_id: 'I-2', qualified_id: 'INBOX-2' }),
    })
    await openEditor()

    await fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    await fireEvent.input(screen.getByLabelText('Edit description'), {
      target: { value: 'Draft on the newer task' },
    })

    await view.rerender({ actionsDisabled: true, draftResetGeneration: 1 })
    await view.rerender({ actionsDisabled: false })

    expect(
      (screen.getByRole('textbox', { name: 'Edit description' }) as HTMLTextAreaElement).value,
    ).toBe('Draft on the newer task')
  })

  it('resets title and description drafts after authentication authority changes', async () => {
    const view = renderDetail({ draftFenceGeneration: 0 })
    await openEditor()

    await fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    await fireEvent.input(screen.getByLabelText('Edit title'), {
      target: { value: 'Old authority title' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    await fireEvent.input(screen.getByLabelText('Edit description'), {
      target: { value: 'Old authority body' },
    })

    await view.rerender({ draftFenceGeneration: 1 })

    expect(screen.queryByRole('textbox', { name: 'Edit title' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Edit description' })).toBeNull()
  })

  it('moves the issue from the task actions menu', async () => {
    const onMoveIssue = vi.fn(async () => true)
    renderDetail({ onMoveIssue })
    await openEditor()

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move to another project' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Roadmap 1' }))

    expect(onMoveIssue).toHaveBeenCalledWith('project-2')
  })

  it('shows recurrence creation only for an open issue without a recurrence', async () => {
    const view = renderDetail({ issue: makeIssue({ metadata: {} }), selectedRecurrences: [] })
    await openEditor()

    expect(screen.getByRole('region', { name: 'Recurrences' })).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: /\+ New recurrence/ }) as HTMLButtonElement).disabled,
    ).toBe(false)

    await view.rerender({ issue: makeIssue({ status: 'closed', metadata: {} }) })
    expect(screen.queryByRole('region', { name: 'Recurrences' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Create recurrence...' })).toBeNull()
  })

  it('closes a recurrence draft after authentication authority changes', async () => {
    const view = renderDetail({
      issue: makeIssue({ metadata: {} }),
      selectedRecurrences: [],
      draftFenceGeneration: 0,
    })
    await openEditor()
    await fireEvent.click(screen.getByRole('button', { name: /\+ New recurrence/ }))
    const recurrenceDialog = screen.getByRole('dialog')
    await fireEvent.input(within(recurrenceDialog).getByLabelText(/Title/i), {
      target: { value: 'Old authority recurrence' },
    })

    await view.rerender({ draftFenceGeneration: 1 })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('composes the ported checklist, recurrence, comments, links, and history sections', async () => {
    const onAddComment = vi.fn(async () => true)
    renderDetail({
      issue: {
        ...makeIssue({ metadata: {} }),
        comments: [
          {
            id: 1,
            issue_id: 1,
            author: 'user-a',
            body: 'Accepted comment',
            created_at: '2026-06-01T12:30:00Z',
          },
        ],
      },
      events: [
        {
          event_id: 1,
          event_uid: 'event-1',
          origin_instance_uid: 'instance-example',
          type: 'issue.commented',
          project_id: 1,
          project_uid: 'project-1',
          project_name: 'example-project',
          actor: 'user-a',
          created_at: '2026-06-01T12:31:00Z',
        },
      ],
      selectedRecurrences: [
        {
          id: 1,
          uid: 'recurrence-1',
          project_id: 1,
          rrule: 'FREQ=WEEKLY;COUNT=2',
          dtstart: '2026-06-01',
          timezone: 'UTC',
          template_title: 'Weekly example',
          template_body: '',
          template_labels: [],
          template_metadata: {},
          next_occurrence_key: '2026-06-08',
          author: 'user-a',
          revision: 1,
          created_at: '2026-06-01T12:00:00Z',
          updated_at: '2026-06-01T12:00:00Z',
        },
      ],
      onAddComment,
    } as Partial<IssueDetailProps>)
    await openEditor()

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Add checklist' }))
    expect(screen.getByRole('region', { name: 'Checklist' })).not.toBeNull()
    expect(screen.getByText('Weekly example')).not.toBeNull()
    expect(screen.getByText('Accepted comment')).not.toBeNull()
    expect(screen.getByText('commented')).not.toBeNull()

    await fireEvent.input(screen.getByLabelText('Comment'), {
      target: { value: 'New comment' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Add comment' }))
    expect(onAddComment).toHaveBeenCalledWith('issue-1', 'New comment')
  })

  it('opens the reachable graph for the selected task', async () => {
    const onOpenGraph = vi.fn()
    renderDetail({ onOpenGraph })

    await fireEvent.click(screen.getByRole('button', { name: 'Open reachable graph' }))

    expect(onOpenGraph).toHaveBeenCalledWith(expect.objectContaining({ uid: 'issue-1' }))
  })

  it.each([{ actionsDisabled: true }, { authorityBlocked: true }])(
    'disables the workspace action when mutation authority is fenced',
    async (fence) => {
      const onClick = vi.fn()
      renderDetail({
        ...fence,
        workspaceAction: { label: 'Open workspace', onClick },
      })

      const action = screen.getByRole('button', { name: 'Open workspace' }) as HTMLButtonElement
      expect(action.disabled).toBe(true)
      await fireEvent.click(action)
      expect(onClick).not.toHaveBeenCalled()
    },
  )

  it('falls back to project UID when the issue omits project name', async () => {
    renderDetail({
      issue: makeIssue({
        project_id: 1,
        project_uid: 'project-2',
        project_name: '',
      }),
    })
    await openEditor()

    expect(screen.getByText('Roadmap')).toBeTruthy()
  })
})
