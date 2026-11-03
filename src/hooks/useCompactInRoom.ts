import { useAdjacentApp } from '@purescience/platform-ui/bridge/react/useAdjacentApp'

/**
 * True only while PureKnowledge is held inside a page (a room, the Personal agent's). Everything compact hangs off this
 * one answer. Beside a room in split view it is the whole app, and a room's Full app says it is alone, which gives the
 * whole app back.
 */
export function useCompactInRoom(): boolean {
  return useAdjacentApp()?.heldInRoom === true
}
