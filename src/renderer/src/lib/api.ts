/** Thin typed wrapper over the preload bridge — the single import point for `window.loops`.
 *  Throws a readable error when the bridge is missing (preload failed / opened outside Electron). */

import type { IpcChannel, IpcSchema, LoopsApi, PushChannel, PushSchema } from '@shared/types/ipc'

function bridge(): LoopsApi {
  // Declared non-optional in preload/index.d.ts, but absent if preload failed — guard at runtime.
  const api = window.loops as LoopsApi | undefined
  if (!api) {
    throw new Error(
      'DeskMate bridge missing: window.loops is unavailable. The preload script did not load — ' +
        'this page must run inside the DeskMate Electron shell.'
    )
  }
  return api
}

export function invoke<C extends IpcChannel>(
  channel: C,
  req: IpcSchema[C]['req']
): Promise<IpcSchema[C]['res']> {
  return bridge().invoke(channel, req)
}

/** Subscribe to a main-process push. Returns an unsubscribe function. */
export function on<C extends PushChannel>(
  channel: C,
  cb: (payload: PushSchema[C]) => void
): () => void {
  return bridge().on(channel, cb)
}

export function platform(): LoopsApi['platform'] {
  return bridge().platform
}

export interface Api {
  invoke: typeof invoke
  on: typeof on
  platform: typeof platform
}

export const api: Api = Object.freeze({ invoke, on, platform })
