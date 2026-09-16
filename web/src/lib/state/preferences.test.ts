import { describe, expect, it, vi } from 'vitest'

import {
  defaultPreferences,
  loadPreferences,
  originStabilityWarning,
  preferencesStorageKey,
  savePreferences,
} from './preferences'

describe('origin-local preferences', () => {
  it('defaults to side by side at wide desktop widths', () => {
    vi.stubGlobal('innerWidth', 1440)
    expect(loadPreferences(new MapStorage()).splitDirection).toBe('horizontal')
    vi.unstubAllGlobals()
  })

  it('defaults to the source stacked layout and pixel sash size', () => {
    expect(loadPreferences(new MapStorage())).toMatchObject({
      splitDirection: 'vertical',
      splitSize: 420,
    })
  })

  it('persists only presentation preferences under the versioned key', () => {
    const storage = new MapStorage()
    savePreferences(
      {
        ...defaultPreferences,
        theme: 'dark',
        columns: ['owner', 'priority'],
        splitDirection: 'vertical',
        splitSize: 520,
        collapsedGroups: ['system'],
        session: 'must-not-persist',
      },
      storage,
    )

    const raw = [...storage.values()][0]
    expect(raw).toContain('"theme":"dark"')
    expect(raw).not.toContain('session')
    expect(loadPreferences(storage)).toMatchObject({
      theme: 'dark',
      columns: ['owner', 'priority'],
      splitDirection: 'vertical',
      splitSize: 520,
      collapsedGroups: ['system'],
    })
  })

  it('persists collapsed desktop navigation without changing workspace preferences', () => {
    const storage = new MapStorage()
    savePreferences({ ...defaultPreferences, sidebarCollapsed: true }, storage)

    expect(loadPreferences(storage)).toMatchObject({
      sidebarCollapsed: true,
      splitDirection: 'vertical',
      splitSize: 420,
    })
  })

  it('persists a selected font size and font family', () => {
    const storage = new MapStorage()
    savePreferences({ ...defaultPreferences, fontSize: 20, fontFamily: 'mono' }, storage)

    expect(loadPreferences(storage)).toMatchObject({ fontSize: 20, fontFamily: 'mono' })
  })

  it('clamps a restored font size to the 8-24 range and falls back to 16 when invalid', () => {
    const storage = new MapStorage()
    storage.setItem(preferencesStorageKey, JSON.stringify({ ...defaultPreferences, fontSize: 40 }))
    expect(loadPreferences(storage).fontSize).toBe(24)

    storage.setItem(preferencesStorageKey, JSON.stringify({ ...defaultPreferences, fontSize: 2 }))
    expect(loadPreferences(storage).fontSize).toBe(8)

    storage.setItem(
      preferencesStorageKey,
      JSON.stringify({ ...defaultPreferences, fontSize: 'huge' }),
    )
    expect(loadPreferences(storage).fontSize).toBe(16)
  })

  it('reports degraded origins without copying preference state', () => {
    expect(originStabilityWarning(false)).toContain('temporary browser origin')
    expect(originStabilityWarning(true)).toBeUndefined()
  })
})

class MapStorage implements Storage {
  readonly #data = new Map<string, string>()

  get length(): number {
    return this.#data.size
  }

  clear(): void {
    this.#data.clear()
  }

  getItem(key: string): string | null {
    return this.#data.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#data.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#data.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#data.set(key, value)
  }

  values(): IterableIterator<string> {
    return this.#data.values()
  }
}
