import { bridge } from '@purescience/platform-ui/bridge/client'
import { getPlatformPreferences } from '@purescience/platform-ui/bridge/preferences'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import { KNOWLEDGE_APP_SLUG } from '../constants'
import type {
  KnowledgeAppSettings,
  PlatformAppSettingsUpdateRequest,
  ShellPreferences,
} from '../types'

export { bridge }

export async function fetchShellPreferences(): Promise<ShellPreferences> {
  return getPlatformPreferences() as Promise<ShellPreferences>
}

export async function fetchKnowledgeSettings(): Promise<KnowledgeAppSettings> {
  return bridge.call<KnowledgeAppSettings>(
    PLATFORM_BRIDGE_METHODS.SETTINGS_APP_GET,
    [KNOWLEDGE_APP_SLUG],
  )
}

export async function updateKnowledgeSettings(
  patch: Partial<KnowledgeAppSettings>,
): Promise<KnowledgeAppSettings> {
  const request: PlatformAppSettingsUpdateRequest = {
    appSlug: KNOWLEDGE_APP_SLUG,
    patch,
  }
  return bridge.call<KnowledgeAppSettings>(
    PLATFORM_BRIDGE_METHODS.SETTINGS_APP_UPDATE,
    [request],
  )
}

export async function readTextFile(path: string): Promise<string> {
  return bridge.call<string>(PLATFORM_BRIDGE_METHODS.FS_READ, [path])
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  await bridge.call(PLATFORM_BRIDGE_METHODS.FS_WRITE, [path, content])
}

export interface CatalogOpenRequest {
  path: string
  name?: string
  appSlug?: string
}

export async function catalogOpen(request: CatalogOpenRequest): Promise<void> {
  await bridge.call(PLATFORM_BRIDGE_METHODS.CATALOG_OPEN, [request])
}


// ---- Platform operations ledger ---------------------------------------------
// Suite-wide record of user/agent interactions in two lanes ('user'|'agent'),
// stored by the shell and rendered live by the PureAssistant tab. Building
// rule (see AGENTS.md "Operations ledger"): record every meaningful user or
// agent interaction this app performs, and when you find legacy activity/feed
// code duplicating this, tag it `DEPRECATED(operations-ledger)` for cleanup.
import {
  listPlatformOperations as listPlatformOperationsBridge,
  onPlatformOperationRecorded as onPlatformOperationRecordedBridge,
  recordPlatformOperation as recordPlatformOperationBridge,
} from '@purescience/platform-ui/bridge/operations'
import type {
  PlatformOperation,
  PlatformOperationInput,
  PlatformOperationsListQuery,
  PlatformOperationsListResult,
} from '@purescience/platform-ui/bridge/operations'

export type {
  PlatformOperation,
  PlatformOperationInput,
  PlatformOperationsListQuery,
  PlatformOperationsListResult,
}

function operationsBridgeAvailable(): boolean {
  return !(import.meta.env.DEV && window.parent === window)
}

/** Record one interaction into the ledger (the shell pins appSlug to this app). */
export async function recordOperation(
  input: PlatformOperationInput,
): Promise<PlatformOperation | null> {
  if (!operationsBridgeAvailable()) return null
  return recordPlatformOperationBridge(input)
}

/** List recorded operations, newest first. */
export async function listOperations(
  query?: PlatformOperationsListQuery,
): Promise<PlatformOperationsListResult> {
  if (!operationsBridgeAvailable()) return { operations: [] }
  return listPlatformOperationsBridge(query)
}

/** Subscribe to live ledger appends. Returns unsubscribe. */
export function onOperationRecorded(
  listener: (operation: PlatformOperation) => void,
): () => void {
  if (!operationsBridgeAvailable()) return () => undefined
  return onPlatformOperationRecordedBridge(listener)
}
