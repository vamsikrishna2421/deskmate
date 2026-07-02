/** The one frozen bridge (`window.loops`). Invoke and subscribe are gated by the hard-coded
 *  channel allowlists from the shared contract — arbitrary channel strings are rejected here,
 *  before they ever reach the main process. No other exposure, no logic. */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, PUSH_CHANNELS } from '../shared/types/ipc'
import type { IpcChannel, IpcSchema, LoopsApi, PushChannel, PushSchema } from '../shared/types/ipc'

const invokeAllowlist: ReadonlySet<string> = new Set(IPC_CHANNELS)
const pushAllowlist: ReadonlySet<string> = new Set(PUSH_CHANNELS)

const api: LoopsApi = {
  invoke<C extends IpcChannel>(channel: C, req: IpcSchema[C]['req']): Promise<IpcSchema[C]['res']> {
    if (!invokeAllowlist.has(channel)) {
      return Promise.reject(new Error(`loops: channel "${String(channel)}" is not allowed`))
    }
    return ipcRenderer.invoke(channel, req) as Promise<IpcSchema[C]['res']>
  },
  on<C extends PushChannel>(channel: C, cb: (payload: PushSchema[C]) => void): () => void {
    if (!pushAllowlist.has(channel)) {
      throw new Error(`loops: channel "${String(channel)}" is not allowed`)
    }
    const listener = (_event: IpcRendererEvent, payload: PushSchema[C]): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  platform: process.platform as LoopsApi['platform']
}

contextBridge.exposeInMainWorld('loops', Object.freeze(api))
