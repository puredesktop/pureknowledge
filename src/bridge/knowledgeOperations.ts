import { KNOWLEDGE_APP_SLUG } from '../constants'
import { recordOperation, type PlatformOperationInput } from './platformBridge'

/** Record a user operation after its mutation/save succeeds. */
export function recordUserOperation(
  kind: string,
  summary: string,
  extra?: Partial<Pick<PlatformOperationInput, 'detail' | 'refs'>>,
): void {
  void recordOperation({
    lane: 'user',
    kind,
    appSlug: KNOWLEDGE_APP_SLUG,
    summary,
    ...extra,
  }).catch(() => undefined)
}
