import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { DEFAULT_CI } from '@shared/invoice'
import { safeWriteFile, setAppDataDir, setProtectedPaths } from './safety'

const file = () => join(app.getPath('userData'), 'settings.json')

export async function loadSettings(): Promise<Settings> {
  setAppDataDir(app.getPath('userData'))
  let s: Settings = structuredClone(DEFAULT_SETTINGS)
  try {
    const saved = JSON.parse(await readFile(file(), 'utf8')) as Partial<Settings>
    s = {
      ...s,
      ...saved,
      company: { ...s.company, ...(saved.company ?? {}) },
      defaults: { ...DEFAULT_CI, ...(saved.defaults ?? {}) },
      shippingIndexes: Array.isArray(saved.shippingIndexes) ? saved.shippingIndexes : []
    }
  } catch {
    /* first run */
  }
  setProtectedPaths(s)
  return s
}

export async function saveSettings(s: Settings): Promise<Settings> {
  setAppDataDir(app.getPath('userData'))
  setProtectedPaths(s)
  await safeWriteFile(file(), JSON.stringify(s, null, 2))
  return s
}
