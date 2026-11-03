// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAdjacentApp } from '@purescience/platform-ui/bridge/react/useAdjacentApp'
import { useCompactInRoom } from './useCompactInRoom'

vi.mock('@purescience/platform-ui/bridge/react/useAdjacentApp', () => ({ useAdjacentApp: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, container: HTMLDivElement, seen: boolean | undefined
function Probe() { seen = useCompactInRoom(); return null }
const holder = (name: string) => ({ tabId: 'tab-2', name, heldInRoom: true })
const besideInSplit = (name: string) => ({ tabId: 'tab-2', name })

beforeEach(() => {
  seen = undefined
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()) })

it('is true while held in a page', async () => {
  vi.mocked(useAdjacentApp).mockReturnValue(holder('the room'))
  await act(async () => root.render(<Probe />))
  expect(seen).toBe(true)
})

it.each(['PureKnowledge', 'PureMail', 'Executive', 'the room', ''])(
  'is false beside %j in split view: it is the whole app', async name => {
    vi.mocked(useAdjacentApp).mockReturnValue(besideInSplit(name))
    await act(async () => root.render(<Probe />))
    expect(seen).toBe(false)
  })

it('is false with no neighbour, and turns off when the room lets go (Full app)', async () => {
  vi.mocked(useAdjacentApp).mockReturnValue(null)
  await act(async () => root.render(<Probe />))
  expect(seen).toBe(false)
  vi.mocked(useAdjacentApp).mockReturnValue(holder('the room'))
  await act(async () => root.render(<Probe />))
  expect(seen).toBe(true)
  vi.mocked(useAdjacentApp).mockReturnValue(null)
  await act(async () => root.render(<Probe />))
  expect(seen).toBe(false)
})
