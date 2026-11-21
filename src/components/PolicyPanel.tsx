import { useEffect, useRef, useState } from 'react'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { TextField } from '@purescience/platform-ui/components/common/inputs/TextField'
import type { KnowledgePage } from '../lib/knowledgeTypes'
import { isPolicy, knowledgeStatus, publishKnowledgePage } from '../lib/organisationKnowledge.mjs'

function parsePolicySources(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 20)
}

/** Human-only publication controls. No agent tool accepts publication metadata. */
export function PolicyPanel({
  page,
  editing,
  onChange,
}: {
  page: KnowledgePage
  editing: boolean
  onChange: (page: KnowledgePage) => void
}): React.ReactElement {
  const [error, setError] = useState('')
  const governance = page.governance ?? { category: 'policy' as const }
  const propOwner = governance.owner ?? ''
  const propReviewDue = governance.reviewDue ?? ''
  const propSourcesText = (governance.sources ?? []).join('\n')

  const [ownerDraft, setOwnerDraft] = useState(propOwner)
  const [reviewDueDraft, setReviewDueDraft] = useState(propReviewDue)
  const [sourcesDraft, setSourcesDraft] = useState(propSourcesText)
  const focusedFieldRef = useRef<'owner' | 'reviewDue' | 'sources' | null>(null)

  useEffect(() => {
    focusedFieldRef.current = null
    setOwnerDraft(propOwner)
    setReviewDueDraft(propReviewDue)
    setSourcesDraft(propSourcesText)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])

  useEffect(() => {
    if (focusedFieldRef.current !== 'owner') setOwnerDraft(propOwner)
  }, [propOwner])

  useEffect(() => {
    if (focusedFieldRef.current !== 'reviewDue') setReviewDueDraft(propReviewDue)
  }, [propReviewDue])

  useEffect(() => {
    if (focusedFieldRef.current !== 'sources') setSourcesDraft(propSourcesText)
  }, [propSourcesText])

  if (!isPolicy(page)) return <></>

  let publishedBody = 'The saved publication needs repair. Its text was preserved on disk.'
  if (governance.publication) {
    try {
      const saved = JSON.parse(governance.publication.content)
      if (typeof saved.body === 'string') publishedBody = saved.body
    } catch {
      /* Keep malformed saved metadata from blanking the editor. */
    }
  }

  const update = (patch: Partial<NonNullable<KnowledgePage['governance']>>) =>
    onChange({ ...page, governance: { ...governance, ...patch } })

  const commitOwner = () => {
    focusedFieldRef.current = null
    if (ownerDraft !== propOwner) update({ owner: ownerDraft })
  }

  const commitReviewDue = () => {
    focusedFieldRef.current = null
    if (reviewDueDraft !== propReviewDue) update({ reviewDue: reviewDueDraft })
  }

  const commitSources = () => {
    focusedFieldRef.current = null
    const parsed = parsePolicySources(sourcesDraft)
    const current = governance.sources ?? []
    if (
      parsed.length !== current.length ||
      parsed.some((line, index) => line !== current[index])
    ) {
      update({ sources: parsed })
    }
  }

  const pageWithDrafts = (): KnowledgePage => ({
    ...page,
    governance: {
      ...governance,
      owner: ownerDraft,
      reviewDue: reviewDueDraft,
      sources: parsePolicySources(sourcesDraft),
    },
  })

  return (
    <section
      aria-label="Policy publication"
      style={{
        border: '1px solid var(--platform-colors-border)',
        borderRadius: 10,
        padding: 16,
        display: 'grid',
        gap: 10,
      }}
    >
      <strong>Policy · {knowledgeStatus(page).replaceAll('-', ' ')}</strong>
      <p>
        Only the human-published version is company policy. Working edits remain
        drafts; agents cannot publish them.
      </p>
      <label>
        Accountable owner
        <TextField
          aria-label="Policy owner"
          value={ownerDraft}
          onFocus={() => {
            focusedFieldRef.current = 'owner'
          }}
          onChange={e => setOwnerDraft(e.target.value)}
          onBlur={commitOwner}
        />
      </label>
      <label>
        Review date
        <TextField
          aria-label="Policy review date"
          type="date"
          value={reviewDueDraft}
          onFocus={() => {
            focusedFieldRef.current = 'reviewDue'
          }}
          onChange={e => setReviewDueDraft(e.target.value)}
          onBlur={commitReviewDue}
        />
      </label>
      <label>
        Sources · one per line
        <textarea
          aria-label="Policy sources"
          rows={3}
          value={sourcesDraft}
          onFocus={() => {
            focusedFieldRef.current = 'sources'
          }}
          onChange={e => setSourcesDraft(e.target.value)}
          onBlur={commitSources}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          size="sm"
          variant="primary"
          data-pureknowledge-primary
          disabled={editing}
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            try {
              onChange(publishKnowledgePage(pageWithDrafts(), 'You'))
              setError('')
            } catch (e) {
              setError(String(e))
            }
          }}
        >
          Publish current policy
        </Button>
        <Button
          size="sm"
          variant="subtle"
          disabled={editing}
          onMouseDown={e => e.preventDefault()}
          onClick={() =>
            onChange({
              ...pageWithDrafts(),
              governance: {
                ...pageWithDrafts().governance!,
                archived: !governance.archived,
              },
            })
          }
        >
          {governance.archived ? 'Restore policy' : 'Archive policy'}
        </Button>
        {editing && <small> Finish editing the text before publishing.</small>}
      </div>
      {governance.publication && (
        <details>
          <summary>
            Published version · {governance.publication.at.slice(0, 10)}
          </summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{publishedBody}</pre>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
