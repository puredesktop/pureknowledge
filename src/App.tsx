import { CollectionImage } from '@purescience/platform-editor/extensions/collectionImage.ts'
import { useKnowledgeDrop } from './hooks/useKnowledgeDrop'
import { embedKnowledgeVideos } from './lib/knowledgeDrop'
import { prepareCollectionDocumentHtml, normalizeCollectionDocumentHtml } from '@purescience/platform-ui/bridge/collectionDocumentHtml'
import { readPlatformFileBinary } from '@purescience/platform-ui/bridge/fs'
import { toMd, type DocumentEditorHandle } from '@purescience/platform-editor'
import { Badge } from '@purescience/platform-ui/components/common/feedback/Badge'
import { Button } from '@purescience/platform-ui/components/common/buttons/Button'
import {
  AppSidebar,
  EditorToolbar,
  MetaText,
  ReadingSurface,
  SidebarSectionLabel,
  ToolbarSelect,
} from '@purescience/platform-ui/components/common/containers/AppChrome'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'
import { Heading } from '@purescience/platform-ui/components/common/typography/Heading'
import { Modal } from '@purescience/platform-ui/components/common/overlays/Modal'
import { PathBreadcrumbs } from '@purescience/platform-ui/components/common/navigation/PathBreadcrumbs'
import { PlatformIcon } from '@purescience/platform-ui/components/chrome/PlatformIcon'
import { SearchField } from '@purescience/platform-ui/components/common/inputs/SearchField'
import { SegmentedControl } from '@purescience/platform-ui/components/common/buttons/SegmentedControl'
import { TextField } from '@purescience/platform-ui/components/common/inputs/TextField'
import { WorkspacePicker } from '@purescience/platform-ui/components/common/inputs/WorkspacePicker'
import {
  ChevronDown,
  Clock,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { usePlatformBridge } from '@purescience/platform-ui/bridge/react/usePlatformBridge'
import { usePlatformViewportResource } from '@purescience/platform-ui/bridge/react/usePlatformViewportResource'
import {
  DocumentEditor,
  toHtml,
  useEditorExtensions,
  type SlashCommandItem,
} from '@purescience/platform-ui/editor'
import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { usePlatformDeepLink } from '@purescience/platform-ui/bridge/react/usePlatformDeepLink'
import { styled } from 'styled-components'
import {
  catalogOpen,
  recordOperation,
  type PlatformOperationInput,
} from './bridge/platformBridge'
import { KNOWLEDGE_APP_SLUG } from './constants'
import { useKnowledgeAgentTools } from './hooks/useKnowledgeAgentTools'
import { useKnowledgeWorkspace } from './hooks/useKnowledgeWorkspace'
import { usePureKnowledgeBoot } from './hooks/usePureKnowledgeBoot'
import {
  acceptKnowledgeAgentChange,
  addKnowledgeLink,
  createDirectoryIndexBody,
  createKnowledgePage,
  createKnowledgeSpace,
  deleteKnowledgePage,
  extractWikiLinks,
  normalizeWikiLinkEscapes,
  findPageByWikiTitle,
  findPagePath,
  findWikiBacklinks,
  getChildWikiPages,
  getWikiPagesForSpace,
  isKnowledgeDirectoryPage,
  rankKnowledgePages,
  rejectKnowledgeAgentChange,
  updateKnowledgePage,
} from './lib/knowledgeStore'
import type {
  KnowledgeAgentChange,
  KnowledgeActivity,
  KnowledgeLink,
  KnowledgePage,
  KnowledgeSpace,
  KnowledgeStore,
} from './lib/knowledgeTypes'
import type { KnowledgeBootState } from './types'

const HUMAN_ACTIVITY_ACTOR = { type: 'human' as const, name: 'You' }

/**
 * Operations-ledger helper: every meaningful user interaction records
 * here after its store mutation succeeds (playbook rule). Agent-lane
 * writes record in the applyKnowledgeChange handler.
 */
function recordUserOperation(
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

/** Sentinel breadcrumb path for the space root (pages use their ids). */
const SPACE_ROOT_CRUMB = '__space-root__'

type KnowledgeView = 'wiki' | 'agent-review'
type AgentReviewSort = 'newest' | 'agent'

//#region styled-components

// One chrome for every app: the --pureknowledge-* names are aliases of the
// platform's --pure-chrome-* tokens (measures, faces, theme colours) so the
// panels read one system while the wiki's own layout stays put.
const StyledAppRoot = styled.div`
  --pureknowledge-bg: var(--platform-colors-bg);
  --pureknowledge-well: var(--pure-chrome-well);
  --pureknowledge-panel: var(--pure-chrome-surface);
  --pureknowledge-panel-subtle: var(--pure-chrome-well);
  --pureknowledge-panel-hover: var(--pure-chrome-hover);
  --pureknowledge-content-bg: var(--pure-chrome-paper);
  --pureknowledge-content-subtle: var(--pure-chrome-well);
  --pureknowledge-content-text: var(--platform-colors-text);
  --pureknowledge-content-muted: var(--pure-chrome-soft);
  --pureknowledge-content-faint: var(--pure-chrome-muted);
  --pureknowledge-content-border: var(--pure-chrome-line);
  --pureknowledge-content-border-soft: var(--pure-chrome-line);
  --pureknowledge-border: var(--pure-chrome-line);
  --pureknowledge-border-soft: var(--pure-chrome-line);
  --pureknowledge-text: var(--platform-colors-text);
  --pureknowledge-muted: var(--pure-chrome-soft);
  --pureknowledge-faint: var(--pure-chrome-muted);
  --pureknowledge-accent: var(--pure-chrome-accent);
  --pureknowledge-focus: var(--pure-chrome-accent);
  --pureknowledge-font-display: var(--platform-typography-font-family-content);
  --pureknowledge-font-mono: var(--platform-typography-font-family-mono);
  --pureknowledge-font-size-label: var(--pure-chrome-label-size);
  --pureknowledge-font-size-meta: var(--pure-chrome-meta-size);
  --pureknowledge-font-size-body: var(--pure-chrome-reading-size);
  --pureknowledge-font-size-title: var(--platform-typography-font-size-lg);
  --pureknowledge-font-size-document-title: 32px;
  --pureknowledge-line-height-ui: var(--platform-typography-line-height-base);
  --pureknowledge-line-height-content: var(--pure-chrome-reading-line);
  --pureknowledge-space-xs: var(--platform-spacing-xs);
  --pureknowledge-space-sm: var(--platform-spacing-sm);
  --pureknowledge-space-md: var(--platform-spacing-md);
  --pureknowledge-space-lg: var(--platform-spacing-lg);
  --pureknowledge-space-xl: var(--platform-spacing-xl);
  --pureknowledge-radius-control: var(--platform-radius-sm);
  --pureknowledge-radius-panel: var(--platform-radius-md);
  --platform-empty-state-padding: var(--pureknowledge-space-xl);
  --platform-empty-state-title-size: var(--pureknowledge-font-size-title);
  --platform-empty-state-title-weight: var(
    --platform-typography-font-weight-medium
  );
  --platform-empty-state-message-width: 34ch;
  --platform-empty-state-align: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--pureknowledge-bg);
  color: var(--pureknowledge-text);
  font-family: var(--platform-typography-font-family);
  font-size: var(--pure-chrome-ui-size);
`

const StyledWorkspace = styled.div`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-columns: var(--pure-chrome-sidebar-width) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`

// The space switcher, save state and agent-log toggle live in the 36px
// editor toolbar; the app header itself is shell-drawn.
const StyledAppHeader = styled(EditorToolbar).attrs({ as: 'header' })`
  grid-column: 1 / -1;
  gap: var(--pureknowledge-space-sm);
`

const StyledSpaceMenuWrap = styled.div`
  position: relative;
`

const StyledSpaceButton = styled(ToolbarSelect)`
  cursor: pointer;

  &:hover {
    background: var(--pure-chrome-hover);
  }
`

const StyledSpaceMenuPanel = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 8;
  width: 320px;
  padding: var(--pureknowledge-space-md);
  border: 1px solid var(--pureknowledge-border);
  border-radius: var(--pureknowledge-radius-panel);
  background: var(--pureknowledge-panel);
  box-shadow: var(--platform-shadow-lg);
`

const StyledSpaceMenuPath = styled.div`
  overflow: hidden;
  margin-top: var(--pureknowledge-space-md);
  padding-top: var(--pureknowledge-space-md);
  border-top: 1px solid var(--pureknowledge-border-soft);
  color: var(--pureknowledge-faint);
  font-family: var(--pureknowledge-font-mono);
  font-size: var(--pure-chrome-meta-size);
  text-overflow: ellipsis;
  white-space: nowrap;
`

const StyledHeaderSpacer = styled.div`
  flex: 1;
`

const StyledSavedDot = styled(MetaText)<{ $saving: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;

  &::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${({ $saving }) =>
      $saving ? 'var(--platform-colors-warning)' : 'var(--platform-colors-success)'};
  }
`

const StyledExternalNotice = styled(MetaText)`
  overflow: hidden;
  max-width: 340px;
  text-overflow: ellipsis;
`

const StyledReviewBadge = styled(ToolbarSelect)<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? 'var(--pure-chrome-selection)' : 'transparent'};
  cursor: pointer;

  &:hover {
    background: var(--pure-chrome-hover);
  }
`

const StyledReviewBadgeCount = styled.span`
  padding: 1px 7px;
  border-radius: var(--pureknowledge-radius-control);
  background: var(--pure-chrome-accent);
  color: var(--pure-chrome-on-accent);
  font-family: var(--pureknowledge-font-mono);
  font-size: var(--pure-chrome-meta-size);
  font-weight: 700;
`

// The platform sidebar: 264 wide, sidebar colour, hairline.
const StyledSidebar = styled(AppSidebar)``


const StyledSection = styled.section`
  padding: var(--pureknowledge-space-md) var(--pureknowledge-space-lg);
  border-bottom: 1px solid var(--pureknowledge-border);
`


const StyledInlineForm = styled.form`
  display: flex;
  gap: var(--pureknowledge-space-sm);
  margin-top: var(--pureknowledge-space-sm);
`

const StyledSubtle = styled.div`
  margin-top: 4px;
  color: var(--pureknowledge-muted);
  font-size: var(--pure-chrome-ui-size);
  line-height: var(--pureknowledge-line-height-ui);
`

const StyledQuietForm = styled(StyledInlineForm)`
  align-items: center;
  max-width: 760px;
  margin-top: 8px;
`

const StyledTagFieldLane = styled.div`
  max-width: 280px;
`

const StyledSearch = styled.div`
  display: flex;
  gap: var(--pureknowledge-space-sm);
  padding: var(--pureknowledge-space-md) var(--pureknowledge-space-lg);
  border-bottom: 1px solid var(--pureknowledge-border);

  input {
    font-size: var(--pure-chrome-ui-size);
  }
`




const StyledPageList = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0 0 var(--pureknowledge-space-xl);
`

const StyledTreeLabel = styled(SidebarSectionLabel)``

const StyledTreeItem = styled.div`
  margin-bottom: 0;
`

const StyledPageRow = styled.div<{ $active: boolean; $depth?: number }>`
  position: relative;
  display: grid;
  grid-template-columns: 18px 22px minmax(0, 1fr) 28px;
  align-items: center;
  gap: var(--pureknowledge-space-xs);
  width: 100%;
  min-height: var(--pure-chrome-row-height);
  overflow: hidden;
  padding: 2px var(--pureknowledge-space-lg) 2px var(--pureknowledge-space-md);
  padding-left: ${({ $depth = 0 }) => 14 + $depth * 16}px;
  border: 0;
  border-left: 3px solid
    ${({ $active }) => ($active ? 'var(--pure-chrome-accent)' : 'transparent')};
  border-radius: 0;
  background: ${({ $active }) =>
    $active ? 'var(--pure-chrome-selection)' : 'transparent'};
  color: var(--pureknowledge-text);
  font-size: var(--pure-chrome-ui-size);
  text-align: left;

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    background: ${({ $active }) =>
      $active ? 'var(--pure-chrome-accent)' : 'transparent'};
    content: '';
  }

  &:hover {
    background: var(--pure-chrome-hover);
  }

  &:hover .tree-tools,
  &:focus-within .tree-tools {
    opacity: 1;
    pointer-events: auto;
  }

  &:hover .tree-count,
  &:focus-within .tree-count {
    opacity: 0;
  }
`

const StyledPageSelect = styled.button`
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:focus {
    outline: none;
  }
`

const StyledPageTitle = styled.div`
  overflow: hidden;
  color: var(--pureknowledge-text);
  font-family: var(--platform-typography-font-family);
  font-weight: 500;
  font-size: var(--pure-chrome-ui-size);
  line-height: var(--pureknowledge-line-height-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
`

const StyledPageMeta = styled(MetaText)`
  text-align: right;
  transition: opacity 120ms ease;
  font-variant-numeric: tabular-nums;
`

const StyledPageIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--pureknowledge-muted);

  svg {
    width: 16px;
    height: 16px;
    stroke-width: 1.7;
  }
`

const StyledTreeObjectIcon = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--pureknowledge-radius-control);
  background: transparent;
  color: var(--pureknowledge-muted);
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
    stroke-width: 1.7;
  }

  &:hover {
    background: var(--pureknowledge-panel-hover);
    color: var(--pureknowledge-text);
  }

  &:focus-visible {
    outline: 2px solid
      color-mix(in srgb, var(--pureknowledge-focus) 34%, transparent);
    outline-offset: 1px;
  }
`

const StyledTreeAction = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--pureknowledge-radius-control);
  background: transparent;
  color: var(--pureknowledge-muted);
  font: inherit;
  font-weight: 500;
  cursor: pointer;

  svg {
    width: 15px;
    height: 15px;
    stroke-width: 1.7;
  }

  &:hover {
    background: var(--pureknowledge-panel-hover);
    color: var(--pureknowledge-text);
  }

  &:focus-visible {
    outline: 2px solid
      color-mix(in srgb, var(--pureknowledge-focus) 34%, transparent);
    outline-offset: 1px;
  }
`

const StyledTreeTools = styled.div`
  position: absolute;
  right: 10px;
  top: 50%;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  justify-content: flex-end;
  max-width: calc(100% - 64px);
  padding: 2px;
  border-radius: var(--pureknowledge-radius-panel);
  background: var(--pureknowledge-panel);
  box-shadow: var(--platform-shadow-sm);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  transition: opacity 120ms ease;
`

const StyledInlineTreeAction = styled(StyledTreeAction)`
  flex: 0 0 auto;
  width: 28px;
  height: 28px;

  svg {
    width: 16px;
    height: 16px;
  }
`

const StyledNotesSection = styled.div`
  margin-top: var(--pureknowledge-space-md);
  padding-top: var(--pureknowledge-space-sm);
  border-top: 1px solid var(--pureknowledge-border-soft);
`

const StyledNotesHeading = styled(SidebarSectionLabel).attrs({
  as: 'button',
})`
  display: flex;
  align-items: center;
  gap: var(--pureknowledge-space-sm);
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    color: var(--pureknowledge-text);
  }
`

const StyledExplorerActions = styled.div`
  display: flex;
  gap: var(--pureknowledge-space-md);
  margin: 0 var(--pureknowledge-space-lg) var(--pureknowledge-space-md);
`

const StyledExplorerButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pureknowledge-accent);
  font-family: var(--platform-typography-font-family);
  font-size: var(--pure-chrome-ui-size);
  font-weight: 500;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`

const StyledSmallComposer = styled.form<{ $depth?: number }>`
  display: flex;
  gap: var(--pureknowledge-space-sm);
  margin: 2px 12px 4px;
  padding-left: ${({ $depth = 0 }) => 50 + $depth * 18}px;
`

const StyledChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pureknowledge-space-sm);
  margin-top: var(--pureknowledge-space-sm);
`

const StyledContextMeta = styled(MetaText)`
  line-height: var(--pureknowledge-line-height-ui);
  font-variant-numeric: tabular-nums;
`

const StyledEditorPane = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--pureknowledge-well);
  color: var(--pureknowledge-content-text);
`

const StyledReviewPane = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--pureknowledge-bg);
`

const StyledReviewHeader = styled.header`
  box-sizing: border-box;
  min-height: 88px;
  padding: var(--pureknowledge-space-lg) var(--pureknowledge-space-xl);
  border-bottom: 1px solid var(--pureknowledge-border);
  background: var(--pureknowledge-panel);
`

const StyledReviewToolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--pureknowledge-space-md);
  margin-top: var(--pureknowledge-space-md);
`

const StyledReviewBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--pureknowledge-space-xl);
`

const StyledReviewTable = styled.div`
  overflow: hidden;
  border: 1px solid var(--pureknowledge-border);
  border-radius: var(--pureknowledge-radius-panel);
  background: var(--pureknowledge-panel);
`

const StyledReviewRow = styled.div<{ $header?: boolean }>`
  display: grid;
  grid-template-columns: minmax(180px, 1.2fr) 120px 140px minmax(220px, 1.5fr) 190px;
  align-items: center;
  gap: var(--pureknowledge-space-md);
  min-height: ${({ $header }) => ($header ? '38px' : '64px')};
  padding: var(--pureknowledge-space-sm) var(--pureknowledge-space-lg);
  border-bottom: 1px solid var(--pureknowledge-border-soft);
  color: ${({ $header }) =>
    $header ? 'var(--pureknowledge-muted)' : 'var(--pureknowledge-text)'};
  font-family: ${({ $header }) =>
    $header
      ? 'var(--pureknowledge-font-mono)'
      : 'var(--platform-typography-font-family)'};
  font-size: ${({ $header }) =>
    $header ? 'var(--pure-chrome-label-size)' : 'var(--pure-chrome-ui-size)'};
  font-weight: ${({ $header }) => ($header ? 500 : 400)};
  letter-spacing: ${({ $header }) =>
    $header ? 'var(--pure-chrome-label-tracking)' : '0'};
  text-transform: ${({ $header }) => ($header ? 'uppercase' : 'none')};

  &:last-child {
    border-bottom: 0;
  }

  @media (max-width: 1180px) {
    grid-template-columns: minmax(180px, 1fr) 110px minmax(220px, 1.3fr) 160px;

    > :nth-child(3) {
      display: none;
    }
  }
`

const StyledProposalTitle = styled.div`
  min-width: 0;

  strong {
    display: block;
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const StyledReviewActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--pureknowledge-space-sm);
`


// The page path reads as a section label: mono, tracked, uppercase, muted.
const StyledBreadcrumbLane = styled.div`
  margin-bottom: 4px;

  &,
  *,
  button,
  button:disabled,
  span {
    color: var(--pureknowledge-muted);
    font-family: var(--pureknowledge-font-mono);
    font-size: var(--pure-chrome-label-size);
    letter-spacing: var(--pure-chrome-label-tracking);
    text-transform: uppercase;
  }
`

const StyledEditorBody = styled.div`
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
`

const StyledMainEditor = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 22px 40px 40px;
  background: var(--pureknowledge-content-bg);
  color: var(--pureknowledge-content-text);
`

const StyledContext = styled.aside`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: var(--pureknowledge-space-xl);
  border-left: 1px solid var(--pureknowledge-border);
  background: var(--pureknowledge-panel);

  label,
  div,
  strong {
    color: var(--pureknowledge-muted);
  }

  > label {
    position: relative;
    margin-left: 10px;
    color: var(--pureknowledge-accent);
  }

  > label::before {
    position: absolute;
    top: 0.08em;
    bottom: 0.08em;
    left: -10px;
    width: 3px;
    background: var(--pureknowledge-accent);
    content: '';
  }
`

// Labels on the page (fields, footers, index headings) are section labels
// without the sidebar inset.
const StyledFieldLabel = styled(SidebarSectionLabel).attrs({ as: 'label' })`
  margin: var(--pureknowledge-space-lg) 0 var(--pureknowledge-space-sm);
  padding: 0;
`

const StyledTitleInput = styled.input`
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: var(--pureknowledge-space-xs) var(--pureknowledge-space-sm) 6px;
  border: 1px solid transparent;
  border-radius: var(--pureknowledge-radius-control);
  background: var(--pureknowledge-content-bg);
  color: var(--pureknowledge-content-text);
  font-family: var(--pureknowledge-font-display);
  font-size: var(--pureknowledge-font-size-document-title);
  font-weight: 600;
  letter-spacing: -0.01em;

  &:hover {
    border-color: var(--pureknowledge-content-border);
    background: var(--pureknowledge-content-subtle);
  }

  &:focus {
    border-color: var(--pureknowledge-content-border);
    background: var(--pureknowledge-content-bg);
    outline: 2px solid
      color-mix(in srgb, var(--pureknowledge-focus) 34%, transparent);
    outline-offset: 2px;
  }
`

const StyledReadTitle = styled.h1`
  margin: 0 0 4px;
  color: var(--pureknowledge-content-text);
  font-family: var(--pureknowledge-font-display);
  font-size: var(--pureknowledge-font-size-document-title);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.01em;
`


const StyledLinkRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--pureknowledge-space-sm);
  padding: var(--pureknowledge-space-sm) 0;
  border-bottom: 1px solid var(--pureknowledge-content-border-soft);
`

const StyledActivityRow = styled.div`
  padding: var(--pureknowledge-space-sm) 0 var(--pureknowledge-space-sm)
    var(--pureknowledge-space-md);
  border-left: 1px solid var(--pureknowledge-content-border);
  color: var(--pureknowledge-content-muted);
  font-size: var(--pure-chrome-ui-size);
  line-height: var(--pureknowledge-line-height-ui);
`

const StyledWikiLinkGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px var(--pureknowledge-space-md);
`

const StyledWikiLinkButton = styled.button`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--pureknowledge-accent);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  text-align: left;
  cursor: pointer;

  span:first-child {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  &:hover {
    background: var(--pureknowledge-content-bg);
  }
`

const StyledWikiIndex = styled.section`
  max-width: 760px;
  margin-top: var(--pureknowledge-space-md);
  padding-top: var(--pureknowledge-space-sm);
  border-top: 1px solid var(--pureknowledge-content-border-soft);

  ${StyledSubtle} {
    color: var(--pureknowledge-content-muted);
  }
`

const StyledWikiSurface = styled.article`
  width: 100%;
  min-width: 0;
  max-width: 860px;
`

const StyledPageFooter = styled.footer`
  margin-top: var(--pureknowledge-space-md);
  padding-top: var(--pureknowledge-space-sm);
  border-top: 1px solid var(--pureknowledge-content-border-soft);
`

const StyledFooterLabel = styled(SidebarSectionLabel)`
  margin-bottom: 4px;
  padding: 0;
`

const StyledFooterSection = styled.div`
  & + & {
    margin-top: var(--pureknowledge-space-lg);
  }
`

const StyledActivityWrap = styled.div`
  position: relative;
`

const StyledActivityPanel = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 8;
  width: 320px;
  max-height: 360px;
  overflow: auto;
  padding: var(--pureknowledge-space-md);
  border: 1px solid var(--pureknowledge-border);
  border-radius: var(--pureknowledge-radius-panel);
  background: var(--pureknowledge-panel);
  box-shadow: var(--platform-shadow-lg);
`

const StyledIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--pure-chrome-control-height);
  height: var(--pure-chrome-control-height);
  border: 1px solid var(--pure-chrome-line);
  border-radius: 7px;
  background: var(--pure-chrome-surface);
  color: var(--pureknowledge-content-muted);
  cursor: pointer;

  &:hover {
    background: var(--pure-chrome-hover);
    color: var(--pureknowledge-content-text);
  }
`

const StyledReviewOverlayBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgb(0 0 0 / 0.28);
`

const StyledReviewOverlay = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 21;
  display: flex;
  flex-direction: column;
  width: min(760px, 94vw);
  overflow: hidden;
  border-left: 1px solid var(--pureknowledge-border);
  background: var(--pureknowledge-panel);
  box-shadow: var(--platform-shadow-lg);
`

const StyledWikiMeta = styled(MetaText)`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: var(--pureknowledge-space-lg);
  line-height: var(--pureknowledge-line-height-ui);
  white-space: normal;

  button {
    color: var(--pureknowledge-accent);
  }
`

// Edit page is the one accent control on the page: an outlined 28px control.
const StyledEditPageButton = styled(Button)`
  && {
    min-height: var(--pure-chrome-control-height);
    padding: 0 12px;
    border: 1px solid var(--pure-chrome-line);
    border-radius: 7px;
    background: var(--pure-chrome-surface);
    color: var(--pureknowledge-accent);
    font-family: var(--platform-typography-font-family);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    box-shadow: none;
  }

  &&:hover:not(:disabled) {
    border-color: var(--pure-chrome-soft);
    background: var(--pure-chrome-hover);
    color: var(--pureknowledge-accent);
  }
`

const StyledWikiPageHeader = styled.div`
  margin-bottom: 2px;
`

const StyledWikiRule = styled.hr`
  margin: 6px 0 var(--pureknowledge-space-md);
  border: 0;
  border-top: 1px solid var(--pureknowledge-content-border);
`

// A wiki page is read: the platform reading surface (serif 16/1.7, 72ch).
const StyledWikiBody = styled(ReadingSurface)`
  a[data-wiki-title] {
    color: var(--pureknowledge-accent);
    text-decoration: none;
    cursor: pointer;
  }

  a[data-wiki-title]:hover {
    text-decoration: underline;
  }

  a[data-wiki-title].is-missing {
    color: var(--pureknowledge-content-muted);
    text-decoration: underline;
    text-decoration-color: var(--pureknowledge-content-border);
    text-decoration-style: dashed;
  }

  p,
  ul,
  ol,
  blockquote,
  pre {
    margin-top: 0;
    margin-bottom: var(--pureknowledge-space-lg);
  }

  :where(h1, h2, h3) {
    margin: 20px 0 10px;
    color: var(--pureknowledge-content-text);
    line-height: 1.2;
  }

  sup,
  sub {
    font-size: 0.72em;
    line-height: 0;
  }
`

const StyledKnowledgeEditorFrame = styled.div`
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--pureknowledge-content-border);
  border-radius: var(--pureknowledge-radius-panel);
  background: var(--pureknowledge-content-bg);

  .knowledge-page-editor {
    --editor-content-bg: var(--pureknowledge-content-bg);
    --editor-paper: var(--pureknowledge-content-bg);
    --editor-paper-text: var(--pureknowledge-content-text);
    --editor-paper-muted: var(--pureknowledge-content-muted);
    --editor-paper-border: var(--pureknowledge-content-border);
    --editor-paper-subtle: var(--pureknowledge-content-subtle);
    width: 100%;
    background: var(--pureknowledge-content-bg);
  }

  .knowledge-page-editor > div:first-child {
    justify-content: flex-start;
    width: 100%;
    border-bottom: 1px solid var(--pureknowledge-content-border);
    background: var(--pureknowledge-content-subtle);
    padding: 0;
  }

  .knowledge-page-editor > div:first-child > div:first-child {
    width: 100%;
    max-width: none;
    margin: 0;
    border-bottom: 0;
    background: transparent;
    padding: 2px 8px;
  }

  .knowledge-page-editor > div:first-child button {
    transform: scale(0.9);
  }

  .knowledge-page-editor > div:nth-child(2) {
    --editor-content-bg: var(--pureknowledge-content-bg);
    --editor-paper: var(--pureknowledge-content-bg);
    --editor-paper-text: var(--pureknowledge-content-text);
    --editor-paper-muted: var(--pureknowledge-content-muted);
    --editor-paper-border: var(--pureknowledge-content-border);
    --editor-paper-subtle: var(--pureknowledge-content-subtle);
    --outer-lane-padding: 0px;
    --page-pad-inline: 0px;
    --paper-width: 100%;
    height: auto;
    min-height: 240px;
    background: var(--pureknowledge-content-bg);
    padding: 0;
  }

  /* The shared editor dresses content as a paged document (80px top
     lane padding). A wiki body is a form field, not a page. */
  .knowledge-page-editor [class*='EditorWrapper'] {
    min-height: 0;
    padding: 0;
  }

  .knowledge-page-editor .tiptap,
  .knowledge-page-editor .ProseMirror {
    width: 100%;
    min-width: 0;
    min-height: 220px;
    margin: 0;
    padding: 18px;
    font-family: var(--platform-typography-font-family-content);
    font-size: var(--pureknowledge-font-size-body);
    line-height: var(--pureknowledge-line-height-content);
    color: var(--pureknowledge-content-text);
  }
`

const StyledWikiEmptyBody = styled.div`
  padding: 20px 0;
  color: var(--pureknowledge-content-muted);
  font-size: var(--pureknowledge-font-size-body);
  line-height: var(--pureknowledge-line-height-content);
`

const StyledEditPanel = styled.div`
  width: 100%;
  min-width: 0;
`

const StyledPageMetadataPanel = styled.div`
  max-width: 760px;
  margin-top: var(--pureknowledge-space-lg);

  ${StyledFieldLabel} {
    margin: var(--pureknowledge-space-lg) 0 6px;
    font-size: var(--pureknowledge-font-size-label);
  }

  ${StyledSubtle} {
    margin-top: 0;
    color: var(--pureknowledge-content-muted);
    font-size: var(--pureknowledge-font-size-meta);
  }
`

const StyledWikiIndexTitle = styled(SidebarSectionLabel).attrs({ as: 'h2' })`
  margin: 0 0 var(--pureknowledge-space-xs);
  padding: 0;
`

const StyledWikiIndexList = styled.div`
  display: grid;
  gap: var(--pureknowledge-space-xs);
`

const StyledWikiIndexRow = styled.button`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--pureknowledge-space-sm);
  width: 100%;
  min-height: 34px;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: var(--pureknowledge-text);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover ${StyledPageTitle} {
    text-decoration: underline;
  }
`

const StyledWikiIndexSnippet = styled.span`
  overflow: hidden;
  color: var(--pureknowledge-muted);
  font-size: var(--pure-chrome-ui-size);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const StyledDirectoryIndex = styled.div`
  display: grid;
  gap: var(--pureknowledge-space-sm);
`

const StyledDirectoryGroup = styled.section`
  display: grid;
  gap: 2px;
`

const StyledDirectoryHeading = styled.button`
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--pureknowledge-space-sm);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pureknowledge-text);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  font-weight: 600;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`

const StyledDirectoryEntry = styled.button`
  display: grid;
  grid-template-columns: 18px minmax(140px, 240px) minmax(0, 1fr);
  align-items: baseline;
  gap: var(--pureknowledge-space-sm);
  width: 100%;
  padding: 3px 0 3px 26px;
  border: 0;
  background: transparent;
  color: var(--pureknowledge-muted);
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  line-height: var(--pureknowledge-line-height-ui);
  text-align: left;
  cursor: pointer;

  strong {
    overflow: hidden;
    color: var(--pureknowledge-text);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover strong {
    text-decoration: underline;
  }

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    gap: 2px;
  }
`

//#endregion

function AppShell({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return <StyledAppRoot data-app="knowledge">{children}</StyledAppRoot>
}

function formatDate(date: string): string {
  try {
    const parsed = new Date(date)
    const day = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(parsed)
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsed)
    return `${day} · ${time}`
  } catch {
    return date
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Plain-prose preview of a page body: wikilinks read as their titles,
 * markdown syntax is stripped rather than shown. */
function pageSnippet(page: KnowledgePage): string {
  const text = normalizeWikiLinkEscapes(page.body)
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || 'No body yet'
}

function pageDisplayTitle(
  page: KnowledgePage,
  rootPageId?: string | null,
): string {
  return page.id === rootPageId ? '_index' : page.title
}

function formatActivityText(item: KnowledgeActivity): string {
  if (!item.actorType) return item.text

  const normalizedText = item.text.replace(
    /^(Updated|Promoted|Created|Deleted|Linked)\b/,
    match => match.toLowerCase(),
  )

  if (item.actorType === 'agent') {
    return `${item.actorName || 'Agent'} ${normalizedText}`
  }

  if (item.actorType === 'human') {
    return `${item.actorName || 'You'} ${normalizedText}`
  }

  return item.actorName ? `${item.actorName} ${normalizedText}` : item.text
}

function ChevronIcon({ expanded }: { expanded: boolean }): React.ReactElement {
  return <PlatformIcon icon={expanded ? ChevronDown : ChevronRight} />
}

function FolderIcon({ open }: { open?: boolean }): React.ReactElement {
  return <PlatformIcon icon={open ? FolderOpen : Folder} />
}

function PageIcon(): React.ReactElement {
  return <PlatformIcon icon={FileText} />
}

function AddPageIcon(): React.ReactElement {
  return <PlatformIcon icon={FilePlus2} />
}

function AddFolderIcon(): React.ReactElement {
  return <PlatformIcon icon={FolderPlus} />
}

function EditIcon(): React.ReactElement {
  return <PlatformIcon icon={Pencil} />
}

function TrashIcon(): React.ReactElement {
  return <PlatformIcon icon={Trash2} />
}

function buildWikiRows(
  pages: KnowledgePage[],
  rootPageId: string | null,
  collapsedPageIds: Set<string>,
): Array<{
  page: KnowledgePage
  depth: number
  childCount: number
  hasChildren: boolean
  expanded: boolean
}> {
  const pageById = new Map(pages.map(page => [page.id, page]))
  const root = rootPageId ? pageById.get(rootPageId) ?? null : null
  const fallbackRoot =
    root ?? pages.find(page => page.parentId === null) ?? pages[0]
  if (!fallbackRoot) return []

  const childrenByParent = new Map<string | null, KnowledgePage[]>()
  for (const page of pages) {
    const parentExists = page.parentId ? pageById.has(page.parentId) : false
    const parentId =
      page.id === fallbackRoot.id
        ? null
        : parentExists
        ? page.parentId
        : fallbackRoot.id
    childrenByParent.set(parentId, [
      ...(childrenByParent.get(parentId) ?? []),
      page,
    ])
  }

  const sortPages = (input: KnowledgePage[]): KnowledgePage[] =>
    [...input].sort((a, b) => a.title.localeCompare(b.title))

  const rows: Array<{
    page: KnowledgePage
    depth: number
    childCount: number
    hasChildren: boolean
    expanded: boolean
  }> = []
  const walk = (
    page: KnowledgePage,
    depth: number,
    seen: Set<string>,
  ): void => {
    if (seen.has(page.id)) return
    const children = sortPages(childrenByParent.get(page.id) ?? [])
    const expanded = !collapsedPageIds.has(page.id)
    rows.push({
      page,
      depth,
      childCount: children.length,
      hasChildren: children.length > 0,
      expanded,
    })
    if (!expanded) return
    const nextSeen = new Set(seen)
    nextSeen.add(page.id)
    for (const child of children) {
      walk(child, depth + 1, nextSeen)
    }
  }

  if (root && fallbackRoot.id === root.id) {
    const rootChildren = sortPages(childrenByParent.get(fallbackRoot.id) ?? [])
    const rootSeen = new Set<string>([fallbackRoot.id])
    for (const child of rootChildren) {
      walk(child, 0, rootSeen)
    }
  } else {
    walk(fallbackRoot, 0, new Set())
  }
  return rows
}

function KnowledgeWorkspace({
  boot,
  resourcePath,
  onResourceHandled,
}: {
  boot: KnowledgeBootState
  resourcePath: string | null
  onResourceHandled: () => void
}): React.ReactElement {
  const { store, storePath, loading, saving, error, saveStore, externalNotice } =
    useKnowledgeWorkspace(boot, resourcePath, onResourceHandled)
  useKnowledgeAgentTools(true, { store, saveStore, storePath })
  const [query, setQuery] = useState('')
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<KnowledgePage | null>(
    null,
  )
  const spaceMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!spaceMenuOpen) return
    const onPointerDown = (event: globalThis.MouseEvent): void => {
      const node = spaceMenuRef.current
      if (
        node &&
        event.target instanceof Node &&
        !node.contains(event.target)
      ) {
        setSpaceMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [spaceMenuOpen])
  const [newRootComposer, setNewRootComposer] = useState<
    'page' | 'directory' | null
  >(null)
  const [newRootTitle, setNewRootTitle] = useState('')
  const [newChildParentId, setNewChildParentId] = useState<string | null>(null)
  const [newChildKind, setNewChildKind] = useState<'page' | 'directory'>('page')
  const [newChildTitle, setNewChildTitle] = useState('')
  const [editRequest, setEditRequest] = useState<{
    pageId: string
    nonce: number
  } | null>(null)
  const [activeView, setActiveView] = useState<KnowledgeView>('wiki')
  const [agentReviewSort, setAgentReviewSort] =
    useState<AgentReviewSort>('newest')
  const [collapsedPageIds, setCollapsedPageIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [notesExpanded, setNotesExpanded] = useState(false)

  const activeSpace = useMemo(() => {
    if (!store) return null
    return (
      store.spaces.find(space => space.id === store.activeSpaceId) ??
      store.spaces[0] ??
      null
    )
  }, [store])

  const activePage = useMemo(() => {
    if (!store || !store.activePageId) return null
    return store.pages.find(page => page.id === store.activePageId) ?? null
  }, [store])

  const visiblePages = useMemo(() => {
    if (!store || !activeSpace) return []
    const pages = query.trim()
      ? rankKnowledgePages(store, query, store.pages.length).map(
          hit => hit.page,
        )
      : store.pages
    return pages.filter(page => page.spaceId === activeSpace.id)
  }, [activeSpace, query, store])

  const wikiPages = useMemo(() => {
    if (!store || !activeSpace) return []
    const base = query
      ? visiblePages.filter(page => page.kind === 'wiki')
      : getWikiPagesForSpace(store, activeSpace.id)
    return buildWikiRows(
      base,
      activeSpace.rootPageId,
      query ? new Set<string>() : collapsedPageIds,
    )
  }, [activeSpace, collapsedPageIds, query, store, visiblePages])

  // F4: notes are first-class in navigation — a collapsed group below the
  // wiki tree, so a note stays reachable (and promotable) after it loses
  // focus. Search surfaces matching notes too.
  const notePages = useMemo(() => {
    if (!store || !activeSpace) return []
    const base = query.trim() ? visiblePages : store.pages
    return base
      .filter(
        page => page.spaceId === activeSpace.id && page.kind === 'note',
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [activeSpace, query, store, visiblePages])
  const spaceAgentChanges = useMemo(
    () =>
      (store?.agentChanges ?? []).filter(
        change => change.spaceId === activeSpace?.id,
      ),
    [activeSpace?.id, store?.agentChanges],
  )
  const pendingAgentChanges = useMemo(
    () => spaceAgentChanges.filter(change => change.status === 'pending'),
    [spaceAgentChanges],
  )

  const mutate = useCallback(
    (nextStore: KnowledgeStore): void => {
      void saveStore(nextStore)
    },
    [saveStore],
  )

  const selectPage = useCallback(
    (pageId: string): void => {
      if (!store) return
      setActiveView('wiki')
      mutate({ ...store, activePageId: pageId })
    },
    [mutate, store],
  )

  usePlatformDeepLink('knowledge', pageId => {
    if (store?.pages.some(page => page.id === pageId)) selectPage(pageId)
  })

  if (loading || !store || !activeSpace) {
    return (
      <EmptyState
        title="pure knowledge"
        message={error ? error.message : 'Opening local knowledge store…'}
        tone={error ? 'error' : 'neutral'}
      />
    )
  }

  const selectSpace = (spaceId: string): void => {
    const space = store.spaces.find(candidate => candidate.id === spaceId)
    const firstPage =
      (space?.rootPageId
        ? store.pages.find(page => page.id === space.rootPageId)
        : null) ??
      store.pages.find(
        page => page.spaceId === spaceId && page.kind === 'wiki',
      ) ??
      store.pages.find(page => page.spaceId === spaceId) ??
      null
    mutate({
      ...store,
      activeSpaceId: spaceId,
      activePageId: firstPage?.id ?? null,
    })
  }

  const togglePage = (pageId: string): void => {
    setCollapsedPageIds(current => {
      const next = new Set(current)
      if (next.has(pageId)) {
        next.delete(pageId)
      } else {
        next.add(pageId)
      }
      return next
    })
  }

  const createSpace = (name: string): void => {
    if (!name.trim()) return
    mutate(
      createKnowledgeSpace(store, { name }, { actor: HUMAN_ACTIVITY_ACTOR }),
    )
    recordUserOperation('space.create', `Created space "${name.trim()}"`)
  }

  const addRootPage = (event: FormEvent): void => {
    event.preventDefault()
    if (!newRootTitle.trim() || !newRootComposer) return
    const isDirectory = newRootComposer === 'directory'
    mutate(
      createKnowledgePage(
        store,
        {
          spaceId: activeSpace.id,
          kind: 'wiki',
          parentId: activeSpace.rootPageId,
          title: newRootTitle,
          body: isDirectory
            ? createDirectoryIndexBody(newRootTitle)
            : undefined,
          tags: isDirectory ? ['directory'] : [],
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    )
    recordUserOperation(
      'page.create',
      `Created ${isDirectory ? 'directory' : 'page'} "${newRootTitle.trim()}" in ${activeSpace.name}`,
    )
    setNewRootComposer(null)
    setNewRootTitle('')
  }

  const startChildPage = (
    parentId: string,
    kind: 'page' | 'directory' = 'page',
  ): void => {
    setNewChildParentId(parentId)
    setNewChildKind(kind)
    setNewChildTitle('')
    setCollapsedPageIds(current => {
      const next = new Set(current)
      next.delete(parentId)
      return next
    })
  }

  const addChildPage = (event: FormEvent, parentId: string): void => {
    event.preventDefault()
    if (!newChildTitle.trim()) return
    const isDirectory = newChildKind === 'directory'
    mutate(
      createKnowledgePage(
        store,
        {
          spaceId: activeSpace.id,
          kind: 'wiki',
          parentId,
          title: newChildTitle,
          body: isDirectory
            ? createDirectoryIndexBody(newChildTitle)
            : undefined,
          tags: isDirectory ? ['directory'] : [],
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    )
    recordUserOperation(
      'page.create',
      `Created ${isDirectory ? 'directory' : 'page'} "${newChildTitle.trim()}"`,
    )
    setNewChildTitle('')
    setNewChildParentId(parentId)
    setCollapsedPageIds(current => {
      const next = new Set(current)
      next.delete(parentId)
      return next
    })
  }

  const editTreePage = (pageId: string): void => {
    mutate({ ...store, activePageId: pageId })
    setEditRequest({ pageId, nonce: Date.now() })
  }

  // window.confirm is disabled by Chromium in cross-origin iframes — every
  // app frame is one — so destructive confirmation must be in-app.
  const deleteTreePage = (page: KnowledgePage): void => {
    if (page.id === activeSpace.rootPageId) return
    setDeleteCandidate(page)
  }

  const confirmDeletePage = (): void => {
    if (!deleteCandidate) return
    mutate(
      deleteKnowledgePage(store, deleteCandidate.id, {
        actor: HUMAN_ACTIVITY_ACTOR,
      }),
    )
    recordUserOperation(
      'page.delete',
      `Deleted page "${deleteCandidate.title}"`,
    )
    setDeleteCandidate(null)
  }

  const approveAgentChange = (changeId: string): void => {
    const change = spaceAgentChanges.find(
      candidate => candidate.id === changeId,
    )
    mutate(acceptKnowledgeAgentChange(store, changeId))
    recordUserOperation(
      'agentChange.accept',
      `Accepted agent proposal${change ? `: ${change.title}` : ''}`,
    )
  }

  const rejectAgentChange = (changeId: string): void => {
    const change = spaceAgentChanges.find(
      candidate => candidate.id === changeId,
    )
    mutate(rejectKnowledgeAgentChange(store, changeId))
    recordUserOperation(
      'agentChange.reject',
      `Rejected agent proposal${change ? `: ${change.title}` : ''}`,
    )
  }

  const editAgentChange = (change: KnowledgeAgentChange): void => {
    if (change.pageId) {
      setActiveView('wiki')
      mutate({ ...store, activePageId: change.pageId })
      setEditRequest({ pageId: change.pageId, nonce: Date.now() })
    }
  }

  const approveAllAgentChanges = (): void => {
    if (!pendingAgentChanges.length) return
    mutate(
      pendingAgentChanges.reduce(
        (nextStore, change) => acceptKnowledgeAgentChange(nextStore, change.id),
        store,
      ),
    )
    recordUserOperation(
      'agentChange.acceptAll',
      `Accepted ${pendingAgentChanges.length} pending agent proposal${
        pendingAgentChanges.length === 1 ? '' : 's'
      }`,
    )
  }

  const pageCountsBySpace = new Map<string, number>()
  for (const page of store.pages) {
    pageCountsBySpace.set(
      page.spaceId,
      (pageCountsBySpace.get(page.spaceId) ?? 0) + 1,
    )
  }

  return (
    <StyledWorkspace>
      <StyledAppHeader>
        <StyledSpaceMenuWrap ref={spaceMenuRef}>
          <StyledSpaceButton
            type="button"
            aria-haspopup="menu"
            aria-expanded={spaceMenuOpen}
            onClick={() => setSpaceMenuOpen(current => !current)}
          >
            {activeSpace.name}
            <PlatformIcon icon={ChevronDown} size={14} strokeWidth={2} />
          </StyledSpaceButton>
          {spaceMenuOpen && (
            <StyledSpaceMenuPanel>
              <WorkspacePicker
                label="Spaces"
                options={store.spaces.map(space => ({
                  id: space.id,
                  name: space.name,
                  meta: pageCountsBySpace.get(space.id) ?? 0,
                }))}
                activeId={activeSpace.id}
                placeholder="Find or create space"
                createLabel="Create space"
                onSelect={spaceId => {
                  setSpaceMenuOpen(false)
                  selectSpace(spaceId)
                }}
                onCreate={name => {
                  setSpaceMenuOpen(false)
                  createSpace(name)
                }}
              />
              <StyledSpaceMenuPath title={storePath}>
                {storePath}
              </StyledSpaceMenuPath>
            </StyledSpaceMenuPanel>
          )}
        </StyledSpaceMenuWrap>
        <StyledHeaderSpacer />
        {externalNotice ? (
          <StyledExternalNotice
            role="status"
            title={externalNotice}
          >
            {externalNotice}
          </StyledExternalNotice>
        ) : null}
        <StyledSavedDot $saving={saving} aria-live="polite">
          {saving ? 'Saving…' : 'Saved'}
        </StyledSavedDot>
        {(spaceAgentChanges.length > 0 ||
          activeView === 'agent-review') && (
          <StyledReviewBadge
            type="button"
            $active={activeView === 'agent-review'}
            onClick={() =>
              setActiveView(current =>
                current === 'agent-review' ? 'wiki' : 'agent-review',
              )
            }
          >
            Agent log
            {pendingAgentChanges.length > 0 && (
              <StyledReviewBadgeCount>
                {pendingAgentChanges.length}
              </StyledReviewBadgeCount>
            )}
          </StyledReviewBadge>
        )}
      </StyledAppHeader>
      <StyledSidebar>
        <StyledSearch>
          <SearchField
            value={query}
            placeholder="Search knowledge"
            onValueChange={setQuery}
            onClear={() => setQuery('')}
          />
        </StyledSearch>
        <StyledPageList>
          <StyledTreeLabel>Pages</StyledTreeLabel>
          <StyledExplorerActions>
            <StyledExplorerButton
              type="button"
              onClick={() => {
                setNewRootComposer('page')
                setNewRootTitle('')
              }}
            >
              + add page
            </StyledExplorerButton>
            <StyledExplorerButton
              type="button"
              onClick={() => {
                setNewRootComposer('directory')
                setNewRootTitle('')
              }}
            >
              + add directory
            </StyledExplorerButton>
          </StyledExplorerActions>
          {newRootComposer ? (
            <StyledSmallComposer onSubmit={addRootPage}>
              <TextField
                autoFocus
                value={newRootTitle}
                placeholder={
                  newRootComposer === 'directory' ? 'New directory' : 'New page'
                }
                onChange={event => setNewRootTitle(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setNewRootComposer(null)
                    setNewRootTitle('')
                  }
                }}
              />
              <Button
                variant="subtle"
                size="sm"
                type="submit"
                disabled={!newRootTitle.trim()}
              >
                Add
              </Button>
            </StyledSmallComposer>
          ) : null}
          {(() => {
            const rootPage = activeSpace.rootPageId
              ? store.pages.find(
                  page => page.id === activeSpace.rootPageId,
                ) ?? null
              : null
            if (!rootPage) return null
            return (
              <StyledTreeItem key={rootPage.id}>
                <StyledPageRow $depth={0} $active={rootPage.id === activePage?.id}>
                  <span aria-hidden="true" />
                  <StyledPageIcon>
                    <PlatformIcon icon={FileText} />
                  </StyledPageIcon>
                  <StyledPageSelect
                    type="button"
                    onClick={() => selectPage(rootPage.id)}
                  >
                    <StyledPageTitle>{activeSpace.name}</StyledPageTitle>
                  </StyledPageSelect>
                  <StyledPageMeta className="tree-count" />
                </StyledPageRow>
              </StyledTreeItem>
            )
          })()}
          {wikiPages.map(
            ({ page, depth, hasChildren, childCount, expanded }) => {
              const isDirectory = isKnowledgeDirectoryPage(page)
              const toggleDirectory = (): void => {
                if (hasChildren || isDirectory) togglePage(page.id)
              }
              return (
                <StyledTreeItem key={page.id}>
                  <StyledPageRow
                    $depth={depth}
                    $active={page.id === activePage?.id}
                  >
                    {hasChildren ? (
                      <StyledTreeAction
                        type="button"
                        aria-label={
                          expanded
                            ? `Collapse ${page.title}`
                            : `Expand ${page.title}`
                        }
                        onClick={() => togglePage(page.id)}
                      >
                        <ChevronIcon expanded={expanded} />
                      </StyledTreeAction>
                    ) : (
                      <span />
                    )}
                    <StyledTreeObjectIcon
                      type="button"
                      aria-label={`Open index for ${page.title}`}
                      onClick={() => selectPage(page.id)}
                      onDoubleClick={toggleDirectory}
                    >
                      {hasChildren || isDirectory ? (
                        <FolderIcon open={expanded} />
                      ) : (
                        <PageIcon />
                      )}
                    </StyledTreeObjectIcon>
                    <StyledPageSelect
                      type="button"
                      onClick={() => selectPage(page.id)}
                      onDoubleClick={toggleDirectory}
                    >
                      <StyledPageTitle>
                        {pageDisplayTitle(page, activeSpace.rootPageId)}
                      </StyledPageTitle>
                    </StyledPageSelect>
                    <StyledPageMeta className="tree-count">
                      {childCount
                        ? `${childCount}`
                        : extractWikiLinks(page.body).length || ''}
                    </StyledPageMeta>
                    <StyledTreeTools className="tree-tools">
                      <StyledInlineTreeAction
                        type="button"
                        title={`Add page under ${page.title}`}
                        aria-label={`Add page under ${page.title}`}
                        onClick={() => startChildPage(page.id, 'page')}
                      >
                        <AddPageIcon />
                      </StyledInlineTreeAction>
                      <StyledInlineTreeAction
                        type="button"
                        title={`Add directory under ${page.title}`}
                        aria-label={`Add directory under ${page.title}`}
                        onClick={() => startChildPage(page.id, 'directory')}
                      >
                        <AddFolderIcon />
                      </StyledInlineTreeAction>
                      <StyledInlineTreeAction
                        type="button"
                        title={`Edit ${page.title}`}
                        aria-label={`Edit ${page.title}`}
                        onClick={() => editTreePage(page.id)}
                      >
                        <EditIcon />
                      </StyledInlineTreeAction>
                      {page.id === activeSpace.rootPageId ? null : (
                        <StyledInlineTreeAction
                          type="button"
                          title={`Delete ${page.title}`}
                          aria-label={`Delete ${page.title}`}
                          onClick={() => deleteTreePage(page)}
                        >
                          <TrashIcon />
                        </StyledInlineTreeAction>
                      )}
                    </StyledTreeTools>
                  </StyledPageRow>
                  {newChildParentId === page.id ? (
                    <StyledSmallComposer
                      $depth={depth}
                      onSubmit={event => addChildPage(event, page.id)}
                    >
                      <TextField
                        autoFocus
                        value={newChildTitle}
                        placeholder={
                          newChildKind === 'directory'
                            ? `New directory under ${page.title}`
                            : `New page under ${page.title}`
                        }
                        onChange={event => setNewChildTitle(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Escape') {
                            setNewChildParentId(null)
                            setNewChildTitle('')
                          }
                        }}
                      />
                      <Button
                        variant="subtle"
                        size="sm"
                        type="submit"
                        disabled={!newChildTitle.trim()}
                      >
                        Add
                      </Button>
                    </StyledSmallComposer>
                  ) : null}
                </StyledTreeItem>
              )
            },
          )}
          {!wikiPages.length && !activeSpace.rootPageId ? (
            <EmptyState
              title="No wiki pages yet"
              message="Use + add page to start this space — new pages file under its _index root."
            />
          ) : null}
          {notePages.length ? (
            <StyledNotesSection>
              <StyledNotesHeading
                type="button"
                aria-expanded={notesExpanded || Boolean(query.trim())}
                onClick={() => setNotesExpanded(current => !current)}
              >
                <ChevronIcon
                  expanded={notesExpanded || Boolean(query.trim())}
                />
                Notes
                <StyledPageMeta>{notePages.length}</StyledPageMeta>
              </StyledNotesHeading>
              {notesExpanded || query.trim()
                ? notePages.map(note => (
                    <StyledTreeItem key={note.id}>
                      <StyledPageRow
                        $depth={0}
                        $active={note.id === activePage?.id}
                      >
                        <span aria-hidden="true" />
                        <StyledPageIcon>
                          <PlatformIcon icon={StickyNote} />
                        </StyledPageIcon>
                        <StyledPageSelect
                          type="button"
                          onClick={() => selectPage(note.id)}
                        >
                          <StyledPageTitle>{note.title}</StyledPageTitle>
                        </StyledPageSelect>
                        <StyledPageMeta className="tree-count" />
                      </StyledPageRow>
                    </StyledTreeItem>
                  ))
                : null}
            </StyledNotesSection>
          ) : null}
        </StyledPageList>
      </StyledSidebar>

      <KnowledgePageEditor
        packagePath={storePath}
        store={store}
        activeSpace={activeSpace}
        page={activePage}
        saving={saving}
        onSelectPage={selectPage}
        onSave={mutate}
        editRequest={editRequest}
      />
      {deleteCandidate ? (
        <Modal
          open
          onClose={() => setDeleteCandidate(null)}
          title="Delete page"
          size="sm"
        >
          <p>
            Delete “{deleteCandidate.title}” and its child pages? This cannot
            be undone.
          </p>
          <StyledChipRow style={{ justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="ghost" onClick={() => setDeleteCandidate(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmDeletePage}>
              Delete
            </Button>
          </StyledChipRow>
        </Modal>
      ) : null}
      {activeView === 'agent-review' ? (
        <>
          <StyledReviewOverlayBackdrop
            onClick={() => setActiveView('wiki')}
          />
          <StyledReviewOverlay
            role="dialog"
            aria-label="Agent review"
          >
            <KnowledgeAgentReview
              store={store}
              activeSpace={activeSpace}
              changes={spaceAgentChanges}
              pendingChanges={pendingAgentChanges}
              sort={agentReviewSort}
              saving={saving}
              onSortChange={setAgentReviewSort}
              onApprove={approveAgentChange}
              onApproveAll={approveAllAgentChanges}
              onEdit={editAgentChange}
              onReject={rejectAgentChange}
            />
          </StyledReviewOverlay>
        </>
      ) : null}
    </StyledWorkspace>
  )
}

function KnowledgeAgentReview({
  store,
  activeSpace,
  changes,
  pendingChanges,
  sort,
  saving,
  onSortChange,
  onApprove,
  onApproveAll,
  onEdit,
  onReject,
}: {
  store: KnowledgeStore
  activeSpace: KnowledgeSpace
  changes: KnowledgeAgentChange[]
  pendingChanges: KnowledgeAgentChange[]
  sort: AgentReviewSort
  saving: boolean
  onSortChange: (sort: AgentReviewSort) => void
  onApprove: (changeId: string) => void
  onApproveAll: () => void
  onEdit: (change: KnowledgeAgentChange) => void
  onReject: (changeId: string) => void
}): React.ReactElement {
  const sortedChanges = [...changes].sort((a, b) => {
    if (sort === 'agent') {
      return (
        a.agentName.localeCompare(b.agentName) ||
        b.proposedAt.localeCompare(a.proposedAt)
      )
    }
    return b.proposedAt.localeCompare(a.proposedAt)
  })

  return (
    <StyledReviewPane>
      <StyledReviewHeader>
        <Heading level={1}>Agent log</Heading>
        <StyledSubtle>
          {pendingChanges.length
            ? `${pendingChanges.length} legacy proposals still waiting for ${activeSpace.name}`
            : changes.length
              ? `${changes.length} agent changes recorded for ${activeSpace.name}`
              : `No agent changes recorded for ${activeSpace.name}`}
        </StyledSubtle>
        <StyledReviewToolbar>
          <SegmentedControl
            aria-label="Sort agent proposals"
            value={sort}
            onValueChange={onSortChange}
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'agent', label: 'Agent' },
            ]}
          />
          {pendingChanges.length ? (
            <StyledReviewActions>
              <Button
                variant="primary"
                disabled={saving}
                onClick={onApproveAll}
              >
                Approve all
              </Button>
            </StyledReviewActions>
          ) : null}
        </StyledReviewToolbar>
      </StyledReviewHeader>
      <StyledReviewBody>
        {sortedChanges.length ? (
          <StyledReviewTable>
            <StyledReviewRow $header>
              <span>Agent</span>
              <span>Risk</span>
              <span>When</span>
              <span>Change</span>
              <span />
            </StyledReviewRow>
            {sortedChanges.map(change => {
              const page = change.pageId
                ? store.pages.find(candidate => candidate.id === change.pageId)
                : null
              return (
                <StyledReviewRow key={change.id}>
                  <StyledProposalTitle>
                    <strong>{change.agentName}</strong>
                    <StyledSubtle>
                      {change.sourceAppSlug
                        ? `${change.sourceAppSlug} agent`
                        : 'Knowledge agent'}
                    </StyledSubtle>
                  </StyledProposalTitle>
                  <span>
                    <Badge tone="neutral">{change.severity}</Badge>
                  </span>
                  <span>{formatDate(change.proposedAt)}</span>
                  <StyledProposalTitle>
                    <strong>{change.title}</strong>
                    <StyledSubtle>
                      {change.changeType.replace('page.', '')}
                      {page ? ` · ${page.title}` : ''}
                      {` · ${change.summary}`}
                    </StyledSubtle>
                  </StyledProposalTitle>
                  {change.status === 'pending' ? (
                    <StyledReviewActions>
                      <Button
                        variant="subtle"
                        size="sm"
                        disabled={!change.pageId}
                        onClick={() => onEdit(change)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="subtle"
                        size="sm"
                        disabled={saving}
                        onClick={() => onApprove(change.id)}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={saving}
                        onClick={() => onReject(change.id)}
                      >
                        Reject
                      </Button>
                    </StyledReviewActions>
                  ) : (
                    <StyledReviewActions>
                      <Badge tone="neutral">{change.status}</Badge>
                    </StyledReviewActions>
                  )}
                </StyledReviewRow>
              )
            })}
          </StyledReviewTable>
        ) : (
          <EmptyState
            title="No agent changes"
            message="Agent writes land in the wiki directly and are recorded here."
          />
        )}
      </StyledReviewBody>
    </StyledReviewPane>
  )
}

function KnowledgePageEditor({
  packagePath,
  store,
  activeSpace,
  page,
  saving,
  onSelectPage,
  onSave,
  editRequest,
}: {
  packagePath: string
  store: KnowledgeStore
  activeSpace: KnowledgeSpace
  page: KnowledgePage | null
  saving: boolean
  onSelectPage: (pageId: string) => void
  onSave: (store: KnowledgeStore) => void
  editRequest: { pageId: string; nonce: number } | null
}): React.ReactElement {
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkPath, setLinkPath] = useState('')
  const [childTitle, setChildTitle] = useState('')
  const [editing, setEditing] = useState(false)
  const editorRef = useRef<DocumentEditorHandle>(null)
  const dropSurface = useRef<HTMLDivElement>(null)
  const [preparedBody, setPreparedBody] = useState({ pageId: '', html: '' })
  const editorHtml = preparedBody.pageId === page?.id ? preparedBody.html : ''
  useEffect(() => {
    let live = true
    void prepareCollectionDocumentHtml(toHtml(bodyDraft), packagePath, readPlatformFileBinary).then(html => { if (live) setPreparedBody({ pageId: page?.id ?? '', html }) })
    return () => { live = false }
  }, [bodyDraft, packagePath, page?.id])
  const dropError = useKnowledgeDrop({ pageId: page?.id, packagePath, editing, surface: dropSurface, editor: editorRef,
    insert: (drop, position) => {
      if (!page) return
      const duplicate = page.links.some(link => drop.link.path ? link.path === drop.link.path : drop.link.url ? link.url === drop.link.url : link.title === drop.link.title)
      const reference = drop.reference && !duplicate ? `${/^(?:## References)$/m.test(bodyDraft) ? '' : '<h2>References</h2>'}${drop.reference}` : ''
      let body: string
      const editor = editorRef.current?.getEditor()
      if (editing && editor && position !== undefined) {
        editor.chain().focus().insertContentAt(position, drop.html).run()
        if (reference) editor.commands.insertContentAt(editor.state.doc.content.size, reference)
        body = toMd(normalizeCollectionDocumentHtml(editor.getHTML(), packagePath))
      } else body = [bodyDraft, toMd(normalizeCollectionDocumentHtml(drop.html, packagePath)), toMd(reference)].filter(Boolean).join('\n\n')
      setBodyDraft(body)
      let next = updateKnowledgePage(store, page.id, { body }, { actor: HUMAN_ACTIVITY_ACTOR })
      if (!duplicate) next = addKnowledgeLink(next, page.id, drop.link, { actor: HUMAN_ACTIVITY_ACTOR })
      onSave(next)
      recordUserOperation('page.update', 'Added shared content to knowledge page')
    },
  })
  const [activityOpen, setActivityOpen] = useState(false)
  const activityRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!activityOpen) return
    const onPointerDown = (event: globalThis.MouseEvent): void => {
      const node = activityRef.current
      if (
        node &&
        event.target instanceof Node &&
        !node.contains(event.target)
      ) {
        setActivityOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [activityOpen])

  useEffect(() => {
    setTitleDraft(page?.title ?? '')
    setBodyDraft(page?.body ?? '')
    setTagsDraft(page?.tags.join(', ') ?? '')
    setLinkTitle('')
    setLinkPath('')
    setChildTitle('')
    setEditing(false)
  }, [page?.id])

  useEffect(() => {
    if (editing) return
    setTitleDraft(page?.title ?? '')
    setBodyDraft(page?.body ?? '')
    setTagsDraft(page?.tags.join(', ') ?? '')
  }, [editing, page?.body, page?.tags, page?.title])

  useEffect(() => {
    if (editRequest?.pageId === page?.id) {
      setEditing(true)
    }
  }, [editRequest?.nonce, editRequest?.pageId, page?.id])

  const pageIsDirectory = page ? isKnowledgeDirectoryPage(page) : false
  const baseExtensions = useEditorExtensions({
    placeholder: pageIsDirectory
      ? 'Summarize what exists in this directory. Agents will keep this index current.'
      : 'Write the page. Type /link to link another wiki page.',
  })

  const editorExtensions = useMemo(() => [...baseExtensions.filter(extension => extension.name !== 'image'), CollectionImage], [baseExtensions])

  useEffect(() => {
    if (!editing || !page || bodyDraft === page.body) return
    const timer = window.setTimeout(() => {
      onSave(
        updateKnowledgePage(
          store,
          page.id,
          { body: bodyDraft },
          { actor: HUMAN_ACTIVITY_ACTOR },
        ),
      )
    }, 700)
    return () => window.clearTimeout(timer)
  }, [bodyDraft, editing, onSave, page, store])

  // Ledger baseline for one editing session: captured when editing
  // starts, compared in finishEditing so a session records one concise
  // operation instead of one per autosave tick.
  const editBaselineRef = useRef<{
    title: string
    body: string
    tags: string
  } | null>(null)
  useEffect(() => {
    if (editing && page) {
      editBaselineRef.current = {
        title: page.title,
        body: page.body,
        tags: page.tags.join(', '),
      }
    }
    if (!editing) editBaselineRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, page?.id])

  // MUST live above the no-page early return: hooks after a conditional
  // return crash on the no-page → page transition (rules of hooks).
  const wikiSlashCommands = useMemo<SlashCommandItem[]>(() => {
    if (!page) return []
    // The slash popover filters items as the user types, so listing every
    // wiki page IS the filterable picker — no native dialogs (window.prompt
    // silently returns null in the sandboxed app iframe).
    return getWikiPagesForSpace(store, page.spaceId)
      .filter(candidate => candidate.id !== page.id)
      .sort((a, b) =>
        pageDisplayTitle(a, activeSpace.rootPageId).localeCompare(
          pageDisplayTitle(b, activeSpace.rootPageId),
        ),
      )
      .map<SlashCommandItem>(candidate => ({
        id: `knowledge-link-${candidate.id}`,
        title: `Link to ${pageDisplayTitle(candidate, activeSpace.rootPageId)}`,
        description: 'Insert wiki page link',
        keywords: [
          'wiki',
          'page',
          'link',
          'knowledge',
          pageDisplayTitle(candidate, activeSpace.rootPageId),
          candidate.title,
        ],
        run: ({ editor, range }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(
              `[[${pageDisplayTitle(candidate, activeSpace.rootPageId)}]]`,
            )
            .run()
        },
      }))
  }, [activeSpace.rootPageId, page, store])

  if (!page) {
    return (
      <StyledEditorPane>
        <EmptyState
          title="Select a page"
          message="Choose a wiki page or note, or create one where it belongs."
        />
      </StyledEditorPane>
    )
  }

  const commitPage = (): void => {
    onSave(
      updateKnowledgePage(
        store,
        page.id,
        {
          title: titleDraft,
          body: normalizeWikiLinkEscapes(bodyDraft),
          tags: tagsDraft
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean),
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    )
  }

  const finishEditing = (): void => {
    commitPage()
    const baseline = editBaselineRef.current
    if (baseline) {
      const nextTitle = titleDraft.trim() || baseline.title
      const titleChanged = nextTitle !== baseline.title
      const contentChanged =
        bodyDraft !== baseline.body || tagsDraft !== baseline.tags
      if (titleChanged) {
        recordUserOperation(
          'page.rename',
          `Renamed page "${baseline.title}" to "${nextTitle}"`,
        )
      }
      if (contentChanged) {
        recordUserOperation('page.update', `Edited page "${nextTitle}"`)
      }
    }
    setEditing(false)
  }

  const promoteNote = (): void => {
    onSave(
      updateKnowledgePage(
        store,
        page.id,
        {
          kind: 'wiki',
          parentId: activeSpace.rootPageId,
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    )
    recordUserOperation(
      'page.promote',
      `Promoted note "${page.title}" to wiki`,
    )
  }

  const addLink = (event: FormEvent): void => {
    event.preventDefault()
    if (!linkPath.trim() && !linkTitle.trim()) return
    onSave(
      addKnowledgeLink(
        store,
        page.id,
        {
          type: linkPath.startsWith('http') ? 'url' : 'file',
          title: linkTitle,
          path: linkPath.startsWith('http') ? undefined : linkPath,
          url: linkPath.startsWith('http') ? linkPath : undefined,
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    )
    recordUserOperation(
      'link.add',
      `Linked "${linkTitle.trim() || linkPath.trim()}" to page "${page.title}"`,
    )
    setLinkTitle('')
    setLinkPath('')
  }

  const addChildPage = (event: FormEvent): void => {
    event.preventDefault()
    if (!childTitle.trim()) return
    onSave(
      createKnowledgePage(
        store,
        {
          spaceId: page.spaceId,
          parentId: page.kind === 'wiki' ? page.id : activeSpace.rootPageId,
          kind: 'wiki',
          title: childTitle,
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    )
    recordUserOperation(
      'page.create',
      `Created page "${childTitle.trim()}" under "${page.title}"`,
    )
    setChildTitle('')
  }

  const recentActivity = store.activity
    .filter(item => !item.pageId || item.pageId === page.id)
    .slice(0, 8)
  const pagePath = findPagePath(store, page.id)
  const eyebrowPath =
    page.id === activeSpace.rootPageId
      ? pagePath
      : pagePath.filter(pathPage => pathPage.id !== page.id)
  const wikiLinks = extractWikiLinks(bodyDraft)
  const backlinks = findWikiBacklinks(store, page)
  const childPages = getChildWikiPages(store, page.id)
  const openOrCreateWikiLink = (title: string): void => {
    const existing = findPageByWikiTitle(store, page.spaceId, title)
    if (existing) {
      onSelectPage(existing.id)
      return
    }
    onSave(
      createKnowledgePage(
        store,
        {
          spaceId: page.spaceId,
          parentId: page.kind === 'wiki' ? page.id : activeSpace.rootPageId,
          kind: 'wiki',
          title,
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    )
    recordUserOperation(
      'page.create',
      `Created page "${title}" from a wikilink on "${page.title}"`,
    )
  }

  const renderWikiLinkMarkdown = (text: string): string =>
    normalizeWikiLinkEscapes(text).replace(
      /\[\[([^\]]+)\]\]/g,
      (_match, rawTitle: string) => {
      const title = rawTitle.trim()
      if (!title) return ''
      const linkedPage = findPageByWikiTitle(store, page.spaceId, title)
      const escapedTitle = escapeHtml(title)
      return `<a href="#" data-wiki-title="${escapedTitle}" class="${
        linkedPage ? '' : 'is-missing'
      }">${escapedTitle}</a>`
      },
    )

  const handleRenderedWikiClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const wikiLink = target.closest<HTMLAnchorElement>('a[data-wiki-title]')
    if (wikiLink) {
      event.preventDefault()
      const title = wikiLink.dataset.wikiTitle?.trim()
      if (title) openOrCreateWikiLink(title)
      return
    }
    // A plain URL in a page body must never navigate the app frame away
    // (that blanks the whole knowledge base). External links open outside.
    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    event.preventDefault()
    const href = anchor.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }

  const renderWikiText = (text: string): ReactNode => {
    if (!text.trim()) {
      return (
        <StyledWikiEmptyBody>
          This page is empty. Choose Edit page to write the first section.
        </StyledWikiEmptyBody>
      )
    }

    return (
      <StyledWikiBody
        onClick={handleRenderedWikiClick}
        dangerouslySetInnerHTML={{
          __html: embedKnowledgeVideos(renderWikiLinkMarkdown(editorHtml)),
        }}
      />
    )
  }

  return (
    <StyledEditorPane>
      <StyledEditorBody>
        <StyledMainEditor ref={dropSurface}>
          <StyledWikiSurface>
            <StyledWikiPageHeader>
              <StyledBreadcrumbLane>
                <PathBreadcrumbs
                  aria-label="Page path"
                  items={[
                    { label: activeSpace.name, path: SPACE_ROOT_CRUMB },
                    ...eyebrowPath.map(pathPage => ({
                      label: pageDisplayTitle(pathPage, activeSpace.rootPageId),
                      path: pathPage.id,
                    })),
                  ]}
                  onSelect={path =>
                    path === SPACE_ROOT_CRUMB
                      ? selectPageRoot()
                      : onSelectPage(path)
                  }
                />
              </StyledBreadcrumbLane>
              {editing ? (
                <StyledTitleInput
                  value={titleDraft}
                  aria-label="Page title"
                  onChange={event => setTitleDraft(event.target.value)}
                  onBlur={commitPage}
                />
              ) : (
                <StyledReadTitle>
                  {pageDisplayTitle(page, activeSpace.rootPageId)}
                </StyledReadTitle>
              )}
            </StyledWikiPageHeader>
            {dropError && <p role="alert">{dropError}</p>}
            {editing ? (
              <StyledEditPanel>
                <StyledWikiMeta>
                  <span>
                    {pageIsDirectory
                      ? 'Editing directory index'
                      : 'Editing page body'}
                  </span>
                  <Button variant="subtle" onClick={finishEditing}>
                    Done
                  </Button>
                </StyledWikiMeta>
                <StyledWikiRule />
                <StyledKnowledgeEditorFrame>
                  <DocumentEditor
                    key={page.id}
                    ref={editorRef}
                    className="knowledge-page-editor"
                    value={editorHtml}
                    extensions={editorExtensions}
                    slashCommands={wikiSlashCommands}
                    inputFormat="html"
                    outputFormat="html"
                    onChange={html => setBodyDraft(toMd(normalizeCollectionDocumentHtml(html, packagePath)))}
                  />
                </StyledKnowledgeEditorFrame>
              </StyledEditPanel>
            ) : (
              <>
                <StyledWikiMeta>
                  <StyledChipRow>
                    <Badge tone="neutral">{page.kind}</Badge>
                    <span>Last edited {formatDate(page.updatedAt)}</span>
                    {page.kind === 'note' ? (
                      <Button variant="subtle" size="sm" onClick={promoteNote}>
                        Promote to wiki
                      </Button>
                    ) : null}
                  </StyledChipRow>
                  <StyledChipRow>
                    <StyledActivityWrap ref={activityRef}>
                      <StyledIconButton
                        type="button"
                        aria-label="Page activity"
                        title="Page activity"
                        aria-expanded={activityOpen}
                        onClick={() => setActivityOpen(current => !current)}
                      >
                        <PlatformIcon icon={Clock} size={15} strokeWidth={1.8} />
                      </StyledIconButton>
                      {activityOpen && (
                        <StyledActivityPanel>
                          <StyledFooterLabel>Activity</StyledFooterLabel>
                          {recentActivity.length ? (
                            recentActivity.map(item => (
                              <StyledActivityRow key={item.id}>
                                <strong>{formatActivityText(item)}</strong>
                                <br />
                                {formatDate(item.at)}
                              </StyledActivityRow>
                            ))
                          ) : (
                            <StyledSubtle>No activity yet.</StyledSubtle>
                          )}
                        </StyledActivityPanel>
                      )}
                    </StyledActivityWrap>
                    <StyledEditPageButton
                      variant="subtle"
                      onClick={() => setEditing(true)}
                    >
                      Edit page
                    </StyledEditPageButton>
                  </StyledChipRow>
                </StyledWikiMeta>
                <StyledWikiRule />
                {renderWikiText(bodyDraft)}
              </>
            )}

            {page.kind === 'wiki' ? (
              <StyledWikiIndex>
                <StyledWikiIndexTitle>
                  {page.id === activeSpace.rootPageId
                    ? 'Wiki index'
                    : pageIsDirectory
                    ? 'Directory contents'
                    : 'Child pages'}
                </StyledWikiIndexTitle>
                {childPages.length ? (
                  page.id === activeSpace.rootPageId ? (
                    <StyledDirectoryIndex>
                      {childPages.map(childPage => {
                        const grandchildPages = getChildWikiPages(
                          store,
                          childPage.id,
                        )
                        return (
                          <StyledDirectoryGroup key={childPage.id}>
                            <StyledDirectoryHeading
                              type="button"
                              onClick={() => onSelectPage(childPage.id)}
                            >
                              <StyledPageIcon>
                                {grandchildPages.length ? (
                                  <FolderIcon open />
                                ) : (
                                  <PageIcon />
                                )}
                              </StyledPageIcon>
                              <span>
                                {childPage.title}
                                {grandchildPages.length ? '/' : ''}
                              </span>
                            </StyledDirectoryHeading>
                            {grandchildPages.length ? (
                              grandchildPages.map(grandchildPage => (
                                <StyledDirectoryEntry
                                  key={grandchildPage.id}
                                  type="button"
                                  onClick={() =>
                                    onSelectPage(grandchildPage.id)
                                  }
                                >
                                  <StyledPageIcon>
                                    <PageIcon />
                                  </StyledPageIcon>
                                  <strong>{grandchildPage.title}</strong>
                                  <StyledWikiIndexSnippet>
                                    — {pageSnippet(grandchildPage)}
                                  </StyledWikiIndexSnippet>
                                </StyledDirectoryEntry>
                              ))
                            ) : (
                              <StyledDirectoryEntry
                                type="button"
                                onClick={() => onSelectPage(childPage.id)}
                              >
                                <StyledPageIcon>
                                  <PageIcon />
                                </StyledPageIcon>
                                <strong>{pageSnippet(childPage)}</strong>
                                <StyledWikiIndexSnippet>
                                  — edited {formatDate(childPage.updatedAt)}
                                </StyledWikiIndexSnippet>
                              </StyledDirectoryEntry>
                            )}
                          </StyledDirectoryGroup>
                        )
                      })}
                    </StyledDirectoryIndex>
                  ) : (
                    <StyledWikiIndexList>
                      {childPages.map(childPage => {
                        const grandchildCount = getChildWikiPages(
                          store,
                          childPage.id,
                        ).length
                        return (
                          <StyledWikiIndexRow
                            key={childPage.id}
                            type="button"
                            onClick={() => onSelectPage(childPage.id)}
                          >
                            <StyledPageIcon>
                              {grandchildCount ? <FolderIcon /> : <PageIcon />}
                            </StyledPageIcon>
                            <div>
                              <StyledPageTitle>
                                {childPage.title}
                                {grandchildCount ? '/' : ''}
                              </StyledPageTitle>
                              <StyledWikiIndexSnippet>
                                {pageSnippet(childPage)}
                              </StyledWikiIndexSnippet>
                            </div>
                            <StyledPageMeta>
                              {grandchildCount
                                ? `${grandchildCount} pages`
                                : formatDate(childPage.updatedAt)}
                            </StyledPageMeta>
                          </StyledWikiIndexRow>
                        )
                      })}
                    </StyledWikiIndexList>
                  )
                ) : (
                  <StyledSubtle>No child pages yet.</StyledSubtle>
                )}
                {editing ? (
                  <StyledQuietForm onSubmit={addChildPage}>
                    <TextField
                      value={childTitle}
                      placeholder={`New child page under ${page.title}`}
                      onChange={event => setChildTitle(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') setChildTitle('')
                      }}
                    />
                    <Button
                      variant="subtle"
                      size="sm"
                      type="submit"
                      disabled={!childTitle.trim()}
                    >
                      Add page
                    </Button>
                  </StyledQuietForm>
                ) : null}
              </StyledWikiIndex>
            ) : null}

            {editing ? (
              <StyledPageMetadataPanel>
                <StyledFieldLabel htmlFor="page-tags">Tags</StyledFieldLabel>
                <StyledTagFieldLane>
                  <TextField
                    id="page-tags"
                    value={tagsDraft}
                    placeholder="project, source, decision"
                    onChange={event => setTagsDraft(event.target.value)}
                    onBlur={commitPage}
                  />
                </StyledTagFieldLane>

                <StyledFieldLabel>Linked resources</StyledFieldLabel>
                {page.links.length ? (
                  page.links.map(link => (
                    <KnowledgeLinkRow key={link.id} link={link} />
                  ))
                ) : (
                  <StyledSubtle>No linked resources yet.</StyledSubtle>
                )}
                <StyledQuietForm onSubmit={addLink}>
                  <TextField
                    value={linkTitle}
                    placeholder="Link title"
                    onChange={event => setLinkTitle(event.target.value)}
                  />
                  <TextField
                    value={linkPath}
                    placeholder="Path or URL"
                    onChange={event => setLinkPath(event.target.value)}
                  />
                  <Button variant="subtle" size="sm" type="submit">
                    Link
                  </Button>
                </StyledQuietForm>
              </StyledPageMetadataPanel>
            ) : page.links.length ? (
              <>
                <StyledFieldLabel>Linked resources</StyledFieldLabel>
                {page.links.map(link => (
                  <KnowledgeLinkRow key={link.id} link={link} />
                ))}
              </>
            ) : null}
            <StyledPageFooter>
              {wikiLinks.length ? (
                <StyledFooterSection>
                  <StyledFooterLabel>Linked pages</StyledFooterLabel>
                  <StyledWikiLinkGrid>
                    {wikiLinks.map(linkTitle => {
                      const linkedPage = findPageByWikiTitle(
                        store,
                        page.spaceId,
                        linkTitle,
                      )
                      return (
                        <StyledWikiLinkButton
                          key={linkTitle}
                          type="button"
                          onClick={() => openOrCreateWikiLink(linkTitle)}
                        >
                          <span>{linkTitle}</span>
                          <StyledPageMeta>
                            {linkedPage ? 'Open page' : 'Create page'}
                          </StyledPageMeta>
                        </StyledWikiLinkButton>
                      )
                    })}
                  </StyledWikiLinkGrid>
                </StyledFooterSection>
              ) : null}
              {backlinks.length ? (
                <StyledFooterSection>
                  <StyledFooterLabel>Backlinks</StyledFooterLabel>
                  <StyledWikiLinkGrid>
                    {backlinks.map(backlink => (
                      <StyledWikiLinkButton
                        key={backlink.id}
                        type="button"
                        onClick={() => onSelectPage(backlink.id)}
                      >
                        <span>{backlink.title}</span>
                        <StyledPageMeta>Links here</StyledPageMeta>
                      </StyledWikiLinkButton>
                    ))}
                  </StyledWikiLinkGrid>
                </StyledFooterSection>
              ) : null}
              {!wikiLinks.length && !backlinks.length ? (
                <StyledSubtle>
                  No links yet — type [[Page name]] in the body to connect
                  pages.
                </StyledSubtle>
              ) : null}
            </StyledPageFooter>
          </StyledWikiSurface>
        </StyledMainEditor>

      </StyledEditorBody>
    </StyledEditorPane>
  )

  function selectPageRoot(): void {
    if (activeSpace.rootPageId) {
      onSelectPage(activeSpace.rootPageId)
    }
  }
}

function KnowledgeLinkRow({
  link,
}: {
  link: KnowledgeLink
}): React.ReactElement {
  const openLink = (): void => {
    if (link.path) {
      void catalogOpen({
        path: link.path,
        name: link.title,
        appSlug: link.appSlug,
      })
      return
    }
    if (link.url) {
      window.open(link.url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <StyledLinkRow>
      <div>
        <strong>{link.title}</strong>
        <StyledSubtle>{link.path || link.url || link.resourceId}</StyledSubtle>
      </div>
      <Button variant="subtle" size="sm" onClick={openLink}>
        Open
      </Button>
    </StyledLinkRow>
  )
}

export function App(): React.ReactElement {
  const { error: bridgeError, ready, meta } = usePlatformBridge()
  const { boot, bootError, booting } = usePureKnowledgeBoot(ready)
  const { resource: viewportResource, clearResource } =
    usePlatformViewportResource(ready, meta)

  if (bridgeError) {
    return (
      <AppFrame>
        <AppShell>
          <EmptyState
            tone="error"
            title="Bridge unavailable"
            message={bridgeError.message}
          />
        </AppShell>
      </AppFrame>
    )
  }

  if (!ready || !boot || booting) {
    const message = bootError
      ? bootError.message
      : ready
      ? 'Loading knowledge settings…'
      : 'Waiting for PureScience shell bridge…'

    return (
      <AppFrame>
        <AppShell>
          <EmptyState
            tone={bootError ? 'error' : 'neutral'}
            title={bootError ? 'Boot failed' : 'pure knowledge'}
            message={message}
          />
        </AppShell>
      </AppFrame>
    )
  }

  return (
    <AppFrame>
      <AppShell>
        <KnowledgeWorkspace
          boot={boot}
          resourcePath={viewportResource?.path?.trim() || null}
          onResourceHandled={clearResource}
        />
      </AppShell>
    </AppFrame>
  )
}
