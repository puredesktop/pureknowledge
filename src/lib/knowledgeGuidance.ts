import type {
  GuidanceStatus,
  KnowledgePage,
  KnowledgeStore,
} from './knowledgeTypes'

export const GUIDANCE_LABELS = {
  draft: 'Draft',
  current: 'Current',
  retired: 'Retired',
} as const
export const GUIDANCE_FILTERS = [
  'all',
  'unmarked',
  'draft',
  'current',
  'retired',
] as const
export type GuidanceFilter = (typeof GUIDANCE_FILTERS)[number]
export type GuidancePatch = {
  guidanceStatus?: GuidanceStatus | null
  lastChecked?: KnowledgePage['lastChecked']
  replacementPageId?: string | null
}

// Replacement references use exact identity in the bound notebook. As with
// existing wiki navigation, every space in that notebook is accessible.
export function replacementFor(
  store: KnowledgeStore,
  page: KnowledgePage,
): KnowledgePage | null {
  return (
    store.pages.find(
      (candidate) =>
        candidate.id === page.replacementPageId &&
        candidate.id !== page.id &&
        store.spaces.some((space) => space.id === candidate.spaceId),
    ) ?? null
  )
}

export function validateGuidancePatch(
  store: KnowledgeStore,
  page: KnowledgePage,
  patch: GuidancePatch,
): void {
  if (
    patch.guidanceStatus !== undefined &&
    patch.guidanceStatus !== null &&
    !Object.hasOwn(GUIDANCE_LABELS, patch.guidanceStatus)
  )
    throw new Error('Status must be Draft, Current, Retired or unmarked.')
  if (patch.lastChecked !== undefined) {
    const check = patch.lastChecked
    if (
      !check ||
      !['human', 'agent'].includes(check.actorType) ||
      !check.actorName?.trim() ||
      typeof check.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(check.at) ||
      !Number.isFinite(Date.parse(check.at)) ||
      new Date(check.at).toISOString().slice(0, 10) !== check.at.slice(0, 10)
    )
      throw new Error('Record a reviewer and a valid ISO review date/time.')
  }
  if (
    patch.replacementPageId !== undefined &&
    patch.replacementPageId !== null
  ) {
    if (
      typeof patch.replacementPageId !== 'string' ||
      !replacementFor(store, {
        ...page,
        replacementPageId: patch.replacementPageId,
      })
    )
      throw new Error(
        'Replacement must be an existing accessible page in this notebook, other than this page.',
      )
  }
}

export function guidancePriority(page: KnowledgePage): number {
  return page.guidanceStatus === 'current'
    ? 0
    : page.guidanceStatus === 'draft'
    ? 1
    : page.guidanceStatus === 'retired'
    ? 3
    : 2
}
export function matchesGuidanceFilter(
  page: KnowledgePage,
  filter: GuidanceFilter,
): boolean {
  return (
    filter === 'all' ||
    (filter === 'unmarked'
      ? !page.guidanceStatus
      : page.guidanceStatus === filter)
  )
}
export function guidanceMetadata(page: KnowledgePage) {
  return {
    guidanceStatus: page.guidanceStatus ?? null,
    statusLabel: page.guidanceStatus
      ? GUIDANCE_LABELS[page.guidanceStatus]
      : 'Unmarked',
    lastChecked: page.lastChecked ?? null,
    replacementPageId: page.replacementPageId ?? null,
  }
}
