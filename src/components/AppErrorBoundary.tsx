import { Component, type ErrorInfo, type ReactNode } from 'react'
import { styled } from 'styled-components'

//#region styled-components

const StyledFallback = styled.div`
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 32px;
  background: var(--platform-colors-bg, #faf9f6);
  color: var(--platform-colors-text, #1c1a17);
  font-family: var(--platform-typography-font-family, system-ui, sans-serif);
`

const StyledPanel = styled.section`
  width: min(100%, 760px);
  padding: 28px;
  border: 1px solid var(--platform-colors-border, #e7e4dd);
  border-radius: var(--platform-radius-md);
  background: var(--platform-colors-surface, #ffffff);
  box-shadow: var(--platform-shadow-lg);
`

const StyledTitle = styled.h1`
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
`

const StyledMessage = styled.p`
  margin: 10px 0 0;
  color: var(--platform-colors-text-secondary, #6b665e);
  font-size: 15px;
  line-height: 1.45;
`

const StyledDetails = styled.pre`
  max-height: 320px;
  overflow: auto;
  margin: 20px 0 0;
  padding: 14px;
  border-radius: var(--platform-radius-sm);
  background: var(--platform-colors-surface-hover, #f0ede7);
  color: var(--platform-colors-text, #1c1a17);
  font-family: var(
    --platform-typography-font-family-mono,
    ui-monospace,
    monospace
  );
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
`

//#endregion

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
  }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<AppErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    console.error('[pureknowledge] render failed', error, info.componentStack)
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <StyledFallback>
        <StyledPanel>
          <StyledTitle>pure knowledge could not render</StyledTitle>
          <StyledMessage>
            The app hit a render error while opening the knowledge workspace.
            Your local knowledge store has not been modified.
          </StyledMessage>
          <StyledDetails>
            {error.stack ?? error.message}
            {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
          </StyledDetails>
        </StyledPanel>
      </StyledFallback>
    )
  }
}
