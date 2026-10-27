import { useState } from 'react'
import styled from 'styled-components'
import { MenuButtonDropdown } from '@purescience/platform-ui/components/common/dropdown/MenuButtonDropdown'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { TextField } from '@purescience/platform-ui/components/common/inputs/TextField'
import {
  GUIDANCE_FILTERS,
  type GuidanceFilter,
  GUIDANCE_LABELS,
  guidanceMetadata,
  guidanceFilterLabel,
  localCheckDate,
  formatKnowledgeCheck,
  replacementFor,
  validateGuidancePatch,
  type GuidancePatch,
} from '../lib/knowledgeGuidance'
import { updateKnowledgePage } from '../lib/knowledgeStore'
import type { KnowledgePage, KnowledgeStore } from '../lib/knowledgeTypes'
import type { KnowledgeStoreUpdate } from '../hooks/useKnowledgeWorkspace'
import { recordUserOperation } from '../bridge/knowledgeOperations'

const Panel = styled.section`
  margin: 12px 0 20px;
  font-size: 13px;
  color: var(--platform-colors-text-secondary);
  details {
    margin-top: 8px;
  }
  summary {
    cursor: pointer;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  [role='note'] {
    padding: 12px;
    border: 1px solid currentColor;
    border-radius: 8px;
    margin-bottom: 8px;
  }
`

export function GuidanceDetails({
  page,
  store,
  onSave,
  onSelectPage,
}: {
  page: KnowledgePage
  store: KnowledgeStore
  onSave: (update: KnowledgeStoreUpdate) => void | Promise<void>
  onSelectPage: (id: string) => void
}) {
  const [date, setDate] = useState(() => localCheckDate())
  const [error, setError] = useState('')
  const target = replacementFor(store, page)
  const metadata = guidanceMetadata(page)
  const replacements = store.pages.filter(
    (candidate) =>
      candidate.id !== page.id &&
      store.spaces.some((space) => space.id === candidate.spaceId),
  )
  const replacementLabel = (candidate: KnowledgePage) => {
    const label = `${candidate.title} (${
      store.spaces.find((space) => space.id === candidate.spaceId)?.name
    })`
    const ambiguous = replacements.some(
      (other) =>
        other.id !== candidate.id &&
        other.title === candidate.title &&
        other.spaceId === candidate.spaceId,
    )
    return ambiguous ? `${label} · ${candidate.id}` : label
  }
  const apply = async (patch: GuidancePatch, summary: string) => {
    try {
      validateGuidancePatch(store, page, patch)
      setError('')
      let changed = false
      await onSave((current) => {
        if (!current.pages.some((candidate) => candidate.id === page.id)) {
          throw new Error('This page is no longer available in this notebook.')
        }
        const next = updateKnowledgePage(current, page.id, patch, {
          actor: { type: 'human', name: 'You' },
        })
        changed = next !== current
        return next
      })
      if (changed)
        recordUserOperation('page.update', summary, {
          refs: { resourceId: page.id },
        })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Panel aria-label="Page guidance">
      {page.guidanceStatus === 'retired' && (
        <div role="note">
          <strong>Retired guidance</strong> — retained for reference.
          {target ? (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => {
                // Resolve again at the navigation boundary; never fall back to a title.
                const available = replacementFor(store, page)
                if (available) onSelectPage(available.id)
              }}
            >
              Open replacement: {target.title}
            </Button>
          ) : (
            <p>
              {page.replacementPageId
                ? 'Replacement unavailable in this notebook.'
                : 'No replacement recorded.'}
            </p>
          )}
        </div>
      )}
      <div>
        {metadata.statusLabel}
        {metadata.lastChecked
          ? ` · Last checked by ${formatKnowledgeCheck(metadata.lastChecked)}`
          : page.lastChecked
          ? ' · Last check unavailable'
          : page.guidanceStatus
          ? ' · No check recorded'
          : ''}
      </div>
      {page.guidanceStatus === 'current' && (
        <p>
          Current is a recorded judgement, not automatic confirmation of
          correctness.
        </p>
      )}
      {page.guidanceStatus !== 'retired' &&
        page.replacementPageId &&
        !target && <p>Replacement unavailable in this notebook.</p>}
      <details>
        <summary>Guidance</summary>
        <MenuButtonDropdown
          label={`Status: ${metadata.statusLabel}`}
          items={[
            { id: 'unmarked', label: 'Unmarked (ordinary note)' },
            ...Object.entries(GUIDANCE_LABELS).map(([id, label]) => ({
              id,
              label,
            })),
          ]}
          onSelectItem={({ id }) =>
            apply(
              {
                guidanceStatus:
                  id === 'unmarked'
                    ? null
                    : (id as KnowledgePage['guidanceStatus']),
              },
              `Set guidance status for ${page.title} to ${
                id === 'unmarked'
                  ? 'Unmarked'
                  : GUIDANCE_LABELS[id as keyof typeof GUIDANCE_LABELS]
              }`,
            )
          }
        />
        <MenuButtonDropdown
          label={`Replacement: ${
            target?.title ?? (page.replacementPageId ? 'Unavailable' : 'None')
          }`}
          items={[
            { id: '__none', label: 'No replacement' },
            ...replacements.map((candidate) => ({
              id: candidate.id,
              label: replacementLabel(candidate),
            })),
          ]}
          onSelectItem={({ id }) =>
            apply(
              { replacementPageId: id === '__none' ? null : id },
              `Changed replacement for ${page.title}`,
            )
          }
        />
        <form
          onSubmit={(event) => {
            event.preventDefault()
            apply(
              {
                lastChecked: {
                  actorType: 'human',
                  actorName: 'You',
                  at: `${date}T00:00:00.000Z`,
                },
              },
              `You recorded a check of ${page.title} dated ${date}`,
            )
          }}
        >
          <span>Checked by You</span>
          <label>
            Check date{' '}
            <TextField
              aria-label="Check date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          <Button size="sm" type="submit">
            Record check
          </Button>
        </form>
        <p>Only Record check changes who checked this page and when.</p>
        {error && <p role="alert">{error}</p>}
      </details>
    </Panel>
  )
}

export function GuidanceSearchDetails({
  page,
  store,
}: {
  page: KnowledgePage
  store: KnowledgeStore
}) {
  const metadata = guidanceMetadata(page)
  const target = replacementFor(store, page)
  return (
    <small data-replacement-page-id={target?.id}>
      {metadata.statusLabel}
      {metadata.lastChecked
        ? ` · Checked by ${formatKnowledgeCheck(metadata.lastChecked)}`
        : page.lastChecked
        ? ' · Last check unavailable'
        : ''}
      {page.replacementPageId
        ? target
          ? ` · Replacement: ${target.title}`
          : ' · Replacement unavailable'
        : ''}
    </small>
  )
}

export function GuidanceStatusFilter({
  value,
  onChange,
}: {
  value: GuidanceFilter
  onChange: (value: GuidanceFilter) => void
}) {
  return (
    <MenuButtonDropdown
      label={`Status filter: ${guidanceFilterLabel(value)}`}
      items={GUIDANCE_FILTERS.map((id) => ({
        id,
        label: guidanceFilterLabel(id),
      }))}
      onSelectItem={({ id }) => onChange(id as GuidanceFilter)}
    />
  )
}
