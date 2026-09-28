import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), read: vi.fn(), write: vi.fn() }))
vi.mock('@purescience/platform-ui/bridge/client', () => ({ bridge: { call: mocks.call } }))
vi.mock('@purescience/platform-ui/bridge/preferences', () => ({ getPlatformPreferences: vi.fn() }))
vi.mock('@purescience/platform-ui/bridge/fs', () => ({ readPlatformFileBinary: mocks.read, writePlatformFileBinary: mocks.write }))
import { savePlatformBinaryFileAs } from './platformBridge'
beforeEach(() => vi.resetAllMocks())
it('writes original image bytes to the selected destination', async () => {
  mocks.call.mockResolvedValue({ path: '/exports/image.png' })
  mocks.read.mockResolvedValue({ base64: 'aW1hZ2U=', truncated: false })
  await expect(savePlatformBinaryFileAs('/wiki/example.knowledge/assets/image.png', 'image.png')).resolves.toBe('/exports/image.png')
  expect(mocks.call).toHaveBeenCalledWith('dialog.saveFile', [{ defaultName: 'image.png', filters: [{ name: 'PNG image', extensions: ['png'] }] }])
  expect(mocks.read).toHaveBeenCalledWith('/wiki/example.knowledge/assets/image.png', 24 * 1024 * 1024)
  expect(mocks.write).toHaveBeenCalledWith('/exports/image.png', 'aW1hZ2U=')
})
it('does not read or write when the dialog is cancelled', async () => {
  mocks.call.mockResolvedValue({ path: null })
  await expect(savePlatformBinaryFileAs('/wiki/image.png', 'image.png')).resolves.toBeNull()
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.write).not.toHaveBeenCalled()
})
it('does not write a truncated image', async () => {
  mocks.call.mockResolvedValue({ path: '/exports/image.png' })
  mocks.read.mockResolvedValue({ base64: 'partial', truncated: true })
  await expect(savePlatformBinaryFileAs('/wiki/image.png', 'image.png')).rejects.toThrow('24 MB')
  expect(mocks.write).not.toHaveBeenCalled()
})
