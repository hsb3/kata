import { expect, test } from './fixtures'

test('attention filters, action views, and sidebar controls', async ({ page, kata }) => {
  const credentials = await kata.launch(page)
  const human = await kata.seedIssue(page, credentials, {
    title: 'Example human request',
    metadata: { 'work.attention': 'needs-human', 'work.attention_msg': 'Need runner access' },
  })
  await kata.seedIssue(page, credentials, {
    title: 'Example stuck request',
    metadata: { 'work.attention': 'stuck' },
  })
  await kata.seedIssue(page, credentials, { title: 'Example normal request' })
  await page.goto(`${kata.origin}/kata?view=all-open&attention=needs-human`)
  await expect(page.locator('.issue-row')).toHaveCount(1)
  await expect(page.locator('.issue-row')).toContainText('needs-human')
  await page.reload()
  await expect(page.locator('.issue-row')).toHaveCount(1)
  await page.getByRole('button', { name: /^Needs you/ }).click()
  await expect(page.locator('.issue-row')).toHaveCount(2)
  await expect(page.getByPlaceholder('Search tasks...')).toHaveCount(0)
  await expect(page.locator('.issue-row').first()).toContainText('Example stuck request')
  await expect(page.getByRole('button', { name: 'Needs you 2', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Filter projects', exact: true }).fill('example-project')
  await expect(page.locator('.project-select-button')).toHaveCount(1)
  await page.getByRole('button', { name: 'Pin example-project', exact: true }).click()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Unpin example-project', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeInViewport()
  const snapshot = await kata.snapshot(page, credentials)
  const inbox = (snapshot.catalog as Array<{ project: { uid: string; name: string } }>).find(
    (entry) => entry.project.name === 'example-inbox',
  )!
  await page.goto(`${kata.origin}/kata?scope=${inbox.project.uid}`)
  await expect(page.getByRole('button', { name: 'Needs you 2', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Needs you 2', exact: true }).click()
  const changed = await kata.request(
    page,
    credentials,
    'POST',
    `/api/v1/projects/${human.project_id}/issues/${human.short_id}/metadata`,
    { actor: 'example-agent', patch: { 'work.attention': 'ok' } },
    { 'If-Match': `"rev-${human.revision}"` },
  )
  expect(changed.ok(), await changed.text()).toBe(true)
  await expect(page.locator('.issue-row')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Needs you 1', exact: true })).toBeVisible()
})

test('project capture, complete in read detail, and intact IDs', async ({ page, kata }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await kata.launch(page)
  await page.goto(`${kata.origin}/kata?scope=${kata.projectUID}`)
  await page.getByRole('button', { name: 'New task', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Choose Inbox project' })).toHaveCount(0)
  const input = page.getByRole('textbox', { name: 'Quick capture' })
  await input.fill('Scoped example capture')
  await input.press('Enter')
  await expect(
    page.locator('.issue-row').filter({ hasText: 'Scoped example capture' }),
  ).toBeVisible()
  await page.locator('.issue-row').filter({ hasText: 'Scoped example capture' }).click()
  await expect(page.getByRole('button', { name: 'Complete', exact: true })).toBeVisible()
  const list = await page.locator('.list-column').boundingBox()
  const detail = await page.locator('.detail-column').boundingBox()
  expect(detail!.x).toBeGreaterThan(list!.x)
  await page.goto(`${kata.origin}/kata?view=all-open`)
  for (const cell of await page.locator('.cell-id').all()) {
    expect(await cell.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await cell.innerText()).toMatch(/[a-z0-9]{4}$/)
  }
})

test('close records retain two evidence items and links; blockers match ready authority', async ({
  page,
  kata,
}) => {
  const credentials = await kata.launch(page)
  const blocker = await kata.seedIssue(page, credentials, { title: 'Wave blocker' })
  const blocked = await kata.seedIssue(page, credentials, {
    title: 'Wave blocked task',
    links: [{ type: 'blocks', incoming: true, to_ref: blocker.short_id }],
  })
  await page.goto(`${kata.origin}/kata?scope=${kata.projectUID}`)
  await expect(page.locator('.issue-row').filter({ hasText: 'Wave blocked task' })).toContainText(
    '1 blockers',
  )
  await page.getByRole('button', { name: 'Ready', exact: true }).click()
  await expect(page.locator(`.issue-row[data-uid="${blocked.uid}"]`)).toHaveCount(0)
  await expect(page.locator(`.issue-row[data-uid="${blocker.uid}"]`)).toBeVisible()
  await page.goto(`${kata.origin}/kata?issue=${blocker.uid}`)
  await page.getByRole('button', { name: 'Complete', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Complete task' })
  await expect(dialog.getByRole('radio')).toHaveCount(5)
  await dialog.getByLabel('Evidence type', { exact: true }).selectOption('commit')
  await dialog.getByLabel('Evidence value', { exact: true }).fill('3f2a9c1')
  await dialog.getByRole('button', { name: 'Add evidence', exact: true }).click()
  await dialog.getByLabel('Evidence value', { exact: true }).nth(1).fill('go test ./internal/cli')
  await dialog
    .getByLabel(/Completion note/)
    .fill('Fixed typo in sync help text; verified help output snapshot test passes.')
  await dialog.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit issue', exact: true })).toHaveCount(0)
  await expect(page.locator('.shared-detail')).toContainText('3f2a9c1')
  await expect(page.locator('.shared-detail')).toContainText('go test ./internal/cli')
  const snapshot = await kata.snapshot(
    page,
    credentials,
    `view=logbook&selected_issue_uid=${blocker.uid}&include_history=true`,
  )
  const history = (snapshot.selected as { history: Array<{ type: string; payload: string }> })
    .history
  expect(
    JSON.parse(history.find((event) => event.type === 'issue.closed')!.payload).evidence,
  ).toEqual([
    { type: 'commit', sha: '3f2a9c1' },
    { type: 'test', command: 'go test ./internal/cli' },
  ])
  await page.goto(`${kata.origin}/kata?view=logbook`)
  await expect(page.locator(`.issue-row[data-uid="${blocker.uid}"]`)).toContainText('done')
  await page.goto(`${kata.origin}/kata?scope=${kata.projectUID}`)
  await expect(page.locator(`.issue-row[data-uid="${blocked.uid}"]`)).not.toContainText('blockers')
})

test('audit closes use the daemon evidence matrix', async ({ page, kata }) => {
  const credentials = await kata.launch(page)
  const issue = await kata.seedIssue(page, credentials, { title: 'Audit evidence contract' })
  await page.goto(`${kata.origin}/kata?issue=${issue.uid}`)
  await page.getByRole('button', { name: 'Complete', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Complete task' })
  await dialog.getByRole('radio', { name: /Audit/ }).check()
  await expect(dialog.getByRole('option', { name: 'Test command' })).toHaveCount(0)
  await dialog.getByLabel('Evidence value', { exact: true }).fill('No changes needed after review')
  await dialog.getByRole('button', { name: 'Add evidence', exact: true }).click()
  await dialog.getByLabel('Evidence value', { exact: true }).nth(1).fill('docs/reference/cli.md')
  await dialog
    .getByLabel(/Completion note/)
    .fill('Reviewed the documented behavior and confirmed no code changes are needed.')
  await dialog.getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
  const snapshot = await kata.snapshot(
    page,
    credentials,
    `view=logbook&selected_issue_uid=${issue.uid}&include_history=true`,
  )
  const history = (snapshot.selected as { history: Array<{ type: string; payload: string }> })
    .history
  expect(
    JSON.parse(history.find((event) => event.type === 'issue.closed')!.payload).evidence,
  ).toEqual([
    { type: 'no-change-audit', rationale: 'No changes needed after review' },
    { type: 'reviewed-paths', paths: ['docs/reference/cli.md'] },
  ])
})

test('Needs you refreshes polling authority within 30 seconds', async ({ page, kata }) => {
  test.setTimeout(45_000)
  await page.route('**/api/v1/ui/snapshot?*', async (route) => {
    const response = await route.fetch()
    if (response.status() !== 200) return route.fulfill({ response })
    const body = await response.json()
    body.capabilities.updates = 'poll'
    await route.fulfill({ response, json: body })
  })
  const credentials = await kata.launch(page)
  const issue = await kata.seedIssue(page, credentials, {
    title: 'Polling attention request',
    metadata: { 'work.attention': 'needs-human' },
  })
  await page.goto(`${kata.origin}/kata?view=needs-you`)
  const row = page.locator(`.issue-row[data-uid="${issue.uid}"]`)
  await expect(row).toBeVisible()
  const response = await kata.request(
    page,
    credentials,
    'POST',
    `/api/v1/projects/${issue.project_id}/issues/${issue.short_id}/metadata`,
    { actor: 'example-agent', patch: { 'work.attention': 'ok' } },
  )
  expect(response.ok(), await response.text()).toBe(true)
  await expect(row).toHaveCount(0, { timeout: 30_000 })
})
