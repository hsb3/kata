import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

import WorkspacePalette from './WorkspacePalette.svelte'

describe('WorkspacePalette', () => {
  afterEach(cleanup)

  test('resets list filters without changing the current project scope', async () => {
    const onReset = vi.fn()
    const onSortChange = vi.fn()
    const onColumnVisibilityChange = vi.fn()
    render(WorkspacePalette, {
      props: {
        open: true,
        filters: {
          scope: { kind: 'project', project_uid: 'project-a' },
          status: 'closed',
          owner: 'owner-a',
          label: 'label-a',
          attention: 'stuck',
          query: 'query',
          relationships: ['blocks'],
        },
        projects: [],
        sort: { key: 'updated', direction: 'desc' },
        columnVisibility: {
          attention: false,
          updated: true,
          priority: true,
          due: true,
          owner: true,
          tags: true,
        },
        preferences: {
          theme: 'system',
          columns: [],
          splitDirection: 'vertical',
          splitSize: 420,
          sidebarCollapsed: false,
          collapsedGroups: [],
        },
        daemons: [],
        canMutate: true,
        mutationPending: false,
        onClose: vi.fn(),
        onFiltersChange: vi.fn(),
        onReset,
        onSortChange,
        onColumnVisibilityChange,
        onPreferencesChange: vi.fn(),
        onSelectDaemon: vi.fn(),
        onNewTask: vi.fn(),
        onOpenView: vi.fn(),
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(onReset).toHaveBeenCalledOnce()

    await fireEvent.click(screen.getByRole('button', { name: 'priority' }))
    expect(onSortChange).toHaveBeenCalledWith({ key: 'priority', direction: 'asc' })

    await fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Owner' }))
    expect(onColumnVisibilityChange).toHaveBeenCalledWith({
      attention: false,
      updated: true,
      priority: true,
      due: true,
      owner: false,
      tags: true,
    })
  })
})
