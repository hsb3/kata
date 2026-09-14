import { describe, expect, it } from 'vitest'
import { parseRoute, serializeRoute } from '../router'
import { snapshotIntentForRoute } from '../state/snapshot'
import { buildKataTaskView } from './view'
import type { KataTaskSummary } from './types'

const issue = (uid: string, attention: string, created_at: string): KataTaskSummary => ({
  id: 1,
  uid,
  project_id: 1,
  project_uid: 'project',
  project_name: 'spoke-project',
  short_id: uid,
  qualified_id: `spoke-project#${uid}`,
  title: uid,
  status: 'open',
  metadata: { 'work.attention': attention },
  revision: 1,
  author: 'example-agent',
  created_at,
  updated_at: created_at,
})
describe('wave 1 action views', () => {
  it('round trips attention and requests existing daemon ready authority', () => {
    const route = parseRoute(new URL('http://localhost/kata?view=ready&attention=needs-human'))
    expect(route.kind).toBe('kata')
    if (route.kind !== 'kata') throw new Error('Expected valid route')
    expect(serializeRoute(route)).toBe('/kata?view=ready&attention=needs-human')
    expect(snapshotIntentForRoute(route)).toMatchObject({ view: 'all-open', statuses: ['ready'] })
  })
  it('orders stuck before human requests and older requests first, excluding closed and ok', () => {
    const issues = [
      issue('new1', 'needs-human', '2026-06-03'),
      issue('ok01', 'ok', '2026-06-01'),
      issue('old1', 'needs-human', '2026-06-01'),
      issue('stck', 'stuck', '2026-06-04'),
      { ...issue('done', 'stuck', '2026-06-01'), status: 'closed' as const },
    ]
    const view = buildKataTaskView({ view: 'needs-you', issues, projects: [] })
    expect(view.groups.flatMap((group) => group.issues.map((item) => item.uid))).toEqual([
      'stck',
      'old1',
      'new1',
    ])
  })
})
