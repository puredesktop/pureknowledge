import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@purescience/platform-ui/components/common/overlays/Modal'
import { TextField } from '@purescience/platform-ui/components/common/inputs/TextField'
import { styled } from 'styled-components'
import { rankKnowledgePages } from '../lib/knowledgeStore'
import type { KnowledgeStore } from '../lib/knowledgeTypes'

const StyledSwitcherWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
`

const StyledSwitcherList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 340px;
  overflow-y: auto;
  border: 1px solid var(--pureknowledge-border);
  border-radius: var(--pureknowledge-radius-control);
`

const StyledSwitcherItem = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-bottom: 1px solid var(--pureknowledge-border-soft);
  background: ${({ $selected }) =>
    $selected ? 'var(--pure-chrome-selection, var(--pure-chrome-hover))' : 'transparent'};
  color: var(--pureknowledge-text);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: var(--pure-chrome-hover);
  }

  small {
    color: var(--pureknowledge-muted);
    white-space: nowrap;
  }
`

const StyledEmpty = styled.p`
  margin: 8px 0;
  color: var(--pureknowledge-muted);
  text-align: center;
`

export function QuickPageSwitcher({
  open,
  store,
  onSelectPage,
  onClose,
}: {
  open: boolean
  store: KnowledgeStore
  onSelectPage: (pageId: string) => void
  onClose: () => void
}): React.ReactElement | null {
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setFilter('')
      setSelectedIndex(0)
    }
  }, [open])

  const hits = useMemo(
    () => rankKnowledgePages(store, filter, 15, 'all'),
    [filter, store],
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  useEffect(() => {
    setSelectedIndex(current =>
      hits.length ? Math.min(current, hits.length - 1) : 0,
    )
  }, [hits.length])

  if (!open) return null

  const spaceNameById = new Map(store.spaces.map(space => [space.id, space.name]))

  const pick = (pageId: string) => {
    onClose()
    onSelectPage(pageId)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Jump to page"
      size="md"
      closeOnEscape
      closeOnBackdropClick
      initialFocusRef={inputRef}
    >
      <StyledSwitcherWrap>
        <TextField
          ref={inputRef}
          autoFocus
          aria-label="Jump to page"
          placeholder="Search pages by title, alias, tag, or content…"
          value={filter}
          onChange={event => setFilter(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelectedIndex(current =>
                hits.length ? (current + 1) % hits.length : 0,
              )
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelectedIndex(current =>
                hits.length ? (current - 1 + hits.length) % hits.length : 0,
              )
            } else if (event.key === 'Enter' && hits[selectedIndex]) {
              event.preventDefault()
              pick(hits[selectedIndex]!.page.id)
            }
          }}
        />
        {hits.length ? (
          <StyledSwitcherList role="listbox" aria-label="Matching pages">
            {hits.map((hit, index) => (
              <li key={hit.page.id} role="option" aria-selected={index === selectedIndex}>
                <StyledSwitcherItem
                  type="button"
                  $selected={index === selectedIndex}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => pick(hit.page.id)}
                >
                  <span>{hit.page.title}</span>
                  <small>
                    {hit.page.kind === 'note' ? 'Note' : 'Wiki'}
                    {store.spaces.length > 1
                      ? ` · ${spaceNameById.get(hit.page.spaceId) ?? ''}`
                      : ''}
                  </small>
                </StyledSwitcherItem>
              </li>
            ))}
          </StyledSwitcherList>
        ) : (
          <StyledEmpty role="status">No matching pages.</StyledEmpty>
        )}
      </StyledSwitcherWrap>
    </Modal>
  )
}
