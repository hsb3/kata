import { readUISnapshot } from '../api/generated'

export async function readAttentionCount(): Promise<number> {
  const result = await readUISnapshot({ view: 'all-open', status: ['open'] })
  if (result.status !== 200) throw new Error('Attention count unavailable')
  return (result.data.collection ?? []).filter((issue) =>
    ['needs-human', 'stuck'].includes(String(issue.metadata['work.attention'])),
  ).length
}
