import { styled } from 'styled-components'
import { meaningSearchNote, type KnowledgeMeaningReadiness } from '../lib/knowledgeMeaning'

const Line = styled.p`
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--platform-colors-text-secondary);
  button {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
`

/** Says when a search is not by meaning, and offers to change that: never worse results as if nothing had changed. */
export function MeaningSearchLine({ state, onSetUp, onRetry }: {
  state: KnowledgeMeaningReadiness
  onSetUp: () => Promise<void>
  onRetry: () => void
}) {
  const note = meaningSearchNote(state)
  if (!note || state.state === 'checking') return null
  if (state.state === 'absent') {
    const size = state.totalBytes ? ` (${Math.round(state.totalBytes / 1_000_000)} MB)` : ''
    return (
      <Line role="status">
        {`Exact words only. To find pages by what they mean too, add a search model${size} that stays on this computer.`}
        <button type="button" onClick={() => void onSetUp().catch(() => undefined)}>Set up…</button>
      </Line>
    )
  }
  if (state.state === 'downloading') {
    const share = state.totalBytes && state.receivedBytes ? ` ${Math.round((state.receivedBytes / state.totalBytes) * 100)}%` : ''
    return <Line role="status">{`Getting the search model${share}. Exact words only until it is here.`}</Line>
  }
  if (state.state === 'indexing') {
    return <Line role="status">{`Reading your pages for search by meaning: ${state.indexed ?? 0} of ${state.total ?? 0} passages. The rest are matched by exact words.`}</Line>
  }
  return (
    <Line role="status">
      {note}
      {state.state === 'failed' ? <button type="button" onClick={onRetry}>Try again</button> : null}
    </Line>
  )
}
