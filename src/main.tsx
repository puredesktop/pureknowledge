import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { KnowledgeLook } from './ui/look'
import './compact-in-room.css'

// held inside another app's page: it lies flat in that page rather than as a page of its own
if (window.parent !== window.top) document.documentElement.setAttribute('data-held-in-room', '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KnowledgeLook />
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
