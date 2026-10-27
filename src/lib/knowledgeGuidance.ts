import type {
  GuidanceStatus,
  KnowledgeCheck,
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
  if (patch.lastChecked !== undefined && !isKnowledgeCheck(patch.lastChecked)) {
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
/** Guard display/agent reads without rewriting hand-edited page files. */
export function isKnowledgeCheck(value: unknown): value is KnowledgeCheck {
  if (!value || typeof value !== 'object') return false
  const check = value as Partial<KnowledgeCheck>
  return (
    (check.actorType === 'human' || check.actorType === 'agent') &&
    typeof check.actorName === 'string' &&
    !!check.actorName.trim() &&
    typeof check.at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(check.at) &&
    Number.isFinite(Date.parse(check.at)) &&
    new Date(check.at).toISOString().slice(0, 10) === check.at.slice(0, 10)
  )
}

export function localCheckDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatKnowledgeCheck(check: KnowledgeCheck): string {
  // Human checks select a calendar date; UTC midnight only encodes that date.
  const date =
    check.actorType === 'human'
      ? new Date(check.at).toLocaleDateString(undefined, { timeZone: 'UTC' })
      : new Date(check.at).toLocaleString(undefined, { timeZone: 'UTC' }) +
        ' UTC'
  return `${check.actorName}${
    check.actorType === 'agent' ? ' (agent)' : ''
  } · ${date}`
}

export function guidanceFilterLabel(filter: GuidanceFilter): string {
  return filter === 'all'
    ? 'All pages'
    : filter === 'unmarked'
    ? 'Unmarked'
    : GUIDANCE_LABELS[filter]
}

export function guidanceMetadata(page: KnowledgePage) {
  const knownStatus =
    typeof page.guidanceStatus === 'string' &&
    Object.hasOwn(GUIDANCE_LABELS, page.guidanceStatus)
  const lastChecked = isKnowledgeCheck(page.lastChecked)
    ? page.lastChecked
    : null
  return {
    guidanceStatus: knownStatus ? page.guidanceStatus! : null,
    statusLabel: knownStatus
      ? GUIDANCE_LABELS[page.guidanceStatus!]
      : page.guidanceStatus
      ? 'Unknown status'
      : 'Unmarked',
    lastChecked,
    ...(page.lastChecked && !lastChecked
      ? { lastCheckedUnavailable: true }
      : {}),
    replacementPageId: page.replacementPageId ?? null,
  }
}
