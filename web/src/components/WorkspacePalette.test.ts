import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

import WorkspacePalette from './WorkspacePalette.svelte'

describe('WorkspacePalette', () => {
  afterEach(cleanup)

  test('resets list filters without changing the current project scope', async () => {
    const onReset = vi.fn()
    const onSortChange = vi.fn()
    const onColumnVisibilityChange = vi.fn()
    const onPreferencesChange = vi.fn()
    const onNewProject = vi.fn()
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
          fontSize: 16,
          fontFamily: 'system',
        },
        daemons: [],
        canMutate: true,
        mutationPending: false,
        onClose: vi.fn(),
        onFiltersChange: vi.fn(),
        onReset,
        onSortChange,
        onColumnVisibilityChange,
        onPreferencesChange,
        onSelectDaemon: vi.fn(),
        onNewTask: vi.fn(),
        onNewProject,
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

    await fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(onNewProject).toHaveBeenCalledOnce()

    await fireEvent.input(screen.getByRole('spinbutton', { name: 'Text size' }), {
      target: { value: '20' },
    })
    expect(onPreferencesChange).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 20 }))

    await fireEvent.click(screen.getByRole('button', { name: 'mono' }))
    expect(onPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({ fontFamily: 'mono' }),
    )
  })
})
