import type { KataOptionalTaskColumn } from './columns'

export const KATA_TASK_COLUMN_WIDTHS_STORAGE_KEY = 'kata:issue-column-widths/v1'
export const MIN_TASK_COLUMN_WIDTH = 56
export const MAX_TASK_COLUMN_WIDTH = 420

export type KataTaskColumnWidths = Partial<Record<KataOptionalTaskColumn, number>>

type ColumnWidthStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): ColumnWidthStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function clampTaskColumnWidth(value: number): number {
  return Math.min(MAX_TASK_COLUMN_WIDTH, Math.max(MIN_TASK_COLUMN_WIDTH, Math.round(value)))
}

export function loadKataTaskColumnWidths(
  storage: ColumnWidthStorage | null = browserStorage(),
): KataTaskColumnWidths {
  if (!storage) return {}
  try {
    const raw = storage.getItem(KATA_TASK_COLUMN_WIDTHS_STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const widths: KataTaskColumnWidths = {}
    for (const [column, width] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof width === 'number' && Number.isFinite(width)) {
        widths[column as KataOptionalTaskColumn] = clampTaskColumnWidth(width)
      }
    }
    return widths
  } catch {
    return {}
  }
}

export function persistKataTaskColumnWidths(
  widths: KataTaskColumnWidths,
  storage: ColumnWidthStorage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(KATA_TASK_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Browser storage is best-effort. Keep the in-memory preference usable.
  }
}
