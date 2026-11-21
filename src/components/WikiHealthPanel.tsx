import { Badge } from '@purescience/platform-ui/components/common/feedback/Badge'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'
import { Heading } from '@purescience/platform-ui/components/common/typography/Heading'
import { styled } from 'styled-components'
import type { KnowledgeReviewFinding } from '../lib/knowledgeStore'
import type { KnowledgeSpace } from '../lib/knowledgeTypes'

const StyledHealthPane = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--pureknowledge-bg);
`

const StyledHealthHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--pureknowledge-space-md);
  padding: var(--pureknowledge-space-lg) var(--pureknowledge-space-xl);
  border-bottom: 1px solid var(--pureknowledge-border);
  background: var(--pureknowledge-panel);
`

const StyledHealthSubtitle = styled.p`
  margin: 4px 0 0;
  color: var(--pureknowledge-muted);
  font-size: var(--pure-chrome-ui-size);
`

const StyledHealthBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--pureknowledge-space-xl);
  display: grid;
  align-content: start;
  gap: var(--pureknowledge-space-lg);
`

const StyledHealthGroup = styled.section`
  border: 1px solid var(--pureknowledge-border);
  border-radius: var(--pureknowledge-radius-panel);
  background: var(--pureknowledge-panel);
  overflow: hidden;
`

const StyledHealthGroupHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--pureknowledge-border-soft);
  font-size: var(--pure-chrome-label-size);
  font-weight: 600;
  letter-spacing: var(--pure-chrome-label-tracking);
  text-transform: uppercase;
  color: var(--pureknowledge-muted);
`

const StyledHealthRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pureknowledge-space-md);
  padding: 10px 16px;
  border-bottom: 1px solid var(--pureknowledge-border-soft);

  &:last-child {
    border-bottom: 0;
  }
`

const StyledHealthRowInfo = styled.div`
  min-width: 0;

  strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    display: block;
    margin-top: 2px;
    color: var(--pureknowledge-muted);
  }
`

const StyledHealthActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`

const GROUPS: Array<{
  kind: KnowledgeReviewFinding['kind']
  label: string
}> = [
  { kind: 'brokenLink', label: 'Broken wikilinks' },
  { kind: 'orphan', label: 'Orphan pages' },
  { kind: 'stale', label: 'Stale pages' },
  { kind: 'duplicateTitle', label: 'Duplicate titles' },
]

function extractBrokenLinkTarget(detail: string): string | null {
  const match = /\[\[([^\]]+)\]\]/.exec(detail)
  return match?.[1]?.trim() || null
}

export function WikiHealthPanel({
  activeSpace,
  findings,
  onJumpToPage,
  onCreateMissingPage,
  onClose,
}: {
  activeSpace: KnowledgeSpace
  findings: KnowledgeReviewFinding[]
  onJumpToPage: (pageId: string) => void
  onCreateMissingPage: (sourcePageId: string, missingTitle: string) => void
  onClose: () => void
}): React.ReactElement {
  return (
    <StyledHealthPane>
      <StyledHealthHeader>
        <div>
          <Heading level={1}>Wiki health</Heading>
          <StyledHealthSubtitle>
            {findings.length
              ? `${findings.length} finding${findings.length === 1 ? '' : 's'} in ${activeSpace.name}`
              : `No issues found in ${activeSpace.name}`}
          </StyledHealthSubtitle>
        </div>
        <Button variant="subtle" size="sm" onClick={onClose}>
          Close
        </Button>
      </StyledHealthHeader>
      <StyledHealthBody>
        {findings.length === 0 ? (
          <EmptyState
            title="Wiki looks healthy"
            message="No broken wikilinks, orphan pages, stale pages, or duplicate titles were found in this space."
          />
        ) : (
          GROUPS.map(group => {
            const items = findings.filter(item => item.kind === group.kind)
            if (!items.length) return null
            return (
              <StyledHealthGroup key={group.kind}>
                <StyledHealthGroupHeader>
                  <span>{group.label}</span>
                  <Badge tone="neutral">{items.length}</Badge>
                </StyledHealthGroupHeader>
                {items.map((finding, index) => {
                  const missingTarget =
                    finding.kind === 'brokenLink'
                      ? extractBrokenLinkTarget(finding.detail)
                      : null
                  return (
                    <StyledHealthRow
                      key={`${finding.kind}-${finding.pageId}-${index}`}
                    >
                      <StyledHealthRowInfo>
                        <strong>{finding.pageTitle}</strong>
                        <small>{finding.detail}</small>
                      </StyledHealthRowInfo>
                      <StyledHealthActions>
                        {missingTarget ? (
                          <Button
                            variant="subtle"
                            size="sm"
                            onClick={() =>
                              onCreateMissingPage(finding.pageId, missingTarget)
                            }
                          >
                            Create “{missingTarget}”
                          </Button>
                        ) : null}
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => onJumpToPage(finding.pageId)}
                        >
                          Open page
                        </Button>
                      </StyledHealthActions>
                    </StyledHealthRow>
                  )
                })}
              </StyledHealthGroup>
            )
          })
        )}
      </StyledHealthBody>
    </StyledHealthPane>
  )
}
