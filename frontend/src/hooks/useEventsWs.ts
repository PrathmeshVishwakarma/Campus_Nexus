import { useNexusEvents, type LiveEvent } from './useNexusEvents'

export type { LiveEvent }

/**
 * Backwards-compatible shim. Existing callers keep using useEventsWs, but it now
 * delegates to the single shared socket in useNexusEvents instead of opening its
 * own connection.
 */
export function useEventsWs(onEvent?: (e: LiveEvent) => void) {
  return useNexusEvents(onEvent)
}
