import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type Api } from '@shared/ipc'

const api = Object.fromEntries(API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(m, ...args)])) as unknown as Api

contextBridge.exposeInMainWorld('api', api)
