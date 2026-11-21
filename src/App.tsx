import { recordUserOperation } from './bridge/knowledgeOperations'
import { GuidanceDetails, GuidanceSearchDetails, GuidanceStatusFilter } from './components/KnowledgeGuidance'
import { guidanceFilterLabel, guidanceMetadata, type GuidanceFilter } from './lib/knowledgeGuidance'
import { isPolicy, knowledgeStatus } from './lib/organisationKnowledge.mjs'
import { MenuButtonDropdown } from '@purescience/platform-ui/components/common/dropdown/MenuButtonDropdown'
import { CollectionImage } from '@purescience/platform-editor/extensions/collectionImage.ts'
import { useKnowledgeDrop } from './hooks/useKnowledgeDrop'
import { embedKnowledgeVideos } from './lib/knowledgeDrop'
import { PolicyPanel } from './components/PolicyPanel'
import { PagePlacement } from './components/PagePlacement'
import {
  prepareKnowledgeDocumentHtml,
  prepareKnowledgeDocumentHtmlWithUrls,
  readKnowledgeImagePreview,
} from './lib/knowledgeDocumentHtml'
import {
  KnowledgeGallery,
  KnowledgeFigure,
  addKnowledgeGalleryControls,
  appendKnowledgeGalleryImages,
  knowledgeHtmlToMarkdown,
  knowledgeMarkdownToHtml,
  removeKnowledgeGalleryImage,
  setKnowledgeGalleryImageBackground,
  upgradeLegacyKnowledgeGalleries,
  type GalleryImageBackground,
} from './lib/knowledgeGallery'
import { saveKnowledgeImage } from './bridge/knowledgeAssets'
import { readPlatformFileBinary, readPlatformFilePreviewUrl } from '@purescience/platform-ui/bridge/fs'
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
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  ListCollapse,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import { usePlatformBridge } from '@purescience/platform-ui/bridge/react/usePlatformBridge'
import { usePlatformViewportResource } from '@purescience/platform-ui/bridge/react/usePlatformViewportResource'
import {
  DocumentEditor,
  useEditorExtensions,
  type SlashCommandItem,
} from '@purescience/platform-ui/editor'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { usePlatformDeepLink } from '@purescience/platform-ui/bridge/react/usePlatformDeepLink'
import { createGlobalStyle, styled } from 'styled-components'
import {
  catalogOpen,
  recordOperation,
  savePlatformBinaryFileAs,
  type PlatformOperationInput,
} from './bridge/platformBridge'
import { KNOWLEDGE_APP_SLUG } from './constants'
import { linkKnowledgeRefs } from './lib/knowledgeRefs'
import { useCompactInRoom } from './hooks/useCompactInRoom'
import { keepKnowledgeVersion, keptPageTitle } from './lib/knowledgeSaveMerge'
import { useKnowledgeAgentTools } from './hooks/useKnowledgeAgentTools'
import { useKnowledgeMeaning } from './hooks/useKnowledgeMeaning'
import { MeaningSearchLine } from './components/MeaningSearchLine'
import { MEANING_MIN_QUERY, rankKnowledgeWithMeaning, type KnowledgeMeaningHit } from './lib/knowledgeMeaning'
import {
  useKnowledgeWorkspace,
  type KnowledgeStoreUpdate,
} from './hooks/useKnowledgeWorkspace'
import { usePureKnowledgeBoot } from './hooks/usePureKnowledgeBoot'
import {
  acceptKnowledgeAgentChange,
  addKnowledgeLink,
  canOpenKnowledgeLink,
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
  manualKnowledgeLinkInput,
  rankKnowledgePages,
  rejectKnowledgeAgentChange,
  removeKnowledgeLink,
  renameKnowledgePageWithBacklinks,
  renameKnowledgeSpace,
  reviewKnowledgeStore,
  rewriteWikiLinksForRename,
  updateKnowledgePage,
} from './lib/knowledgeStore'
import {
  addHeadingAnchorsToHtml,
  isAbsolutePathInsidePackage,
  renderWikiLinksInHtml,
  resolveSafePackageRelativeAssetPath,
  sanitizeHtml,
} from './lib/sanitizeHtml'
import { WikiHealthPanel } from './components/WikiHealthPanel'
import { QuickPageSwitcher } from './components/QuickPageSwitcher'
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

/** Sentinel breadcrumb path for the space root (pages use their ids). */
const SPACE_ROOT_CRUMB = '__space-root__'

type KnowledgeView = 'wiki' | 'agent-review' | 'health'
type AgentReviewSort = 'newest' | 'agent'

// Scope the compact treatment to this confirmation, including its portal.
const DeleteDialogStyle = createGlobalStyle`
  [data-selector='modal']:has(> .knowledge-delete-body) {
    height: auto;
    min-height: 0;
    max-width: min(420px, calc(100vw - 32px));
    background: var(--glass-panel, var(--platform-colors-elevated));
    backdrop-filter: var(--glass-blur, blur(24px) saturate(140%));
    -webkit-backdrop-filter: var(--glass-blur, blur(24px) saturate(140%));
  }

  .knowledge-delete-body {
    padding: 20px;
    overflow-y: auto;
  }

  .knowledge-delete-body p {
    margin: 0;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .knowledge-delete-body p + p {
    margin-top: 8px;
    color: var(--platform-colors-text-secondary);
  }

  @media (prefers-reduced-transparency: reduce) {
    [data-selector='modal']:has(> .knowledge-delete-body) {
      background: var(--platform-colors-elevated);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }
`

//#region styled-components

// One chrome for every app: the --pureknowledge-* names are aliases of the
// platform's --pure-chrome-* tokens (measures, faces, theme colours) so the
// panels read one system while the wiki's own layout stays put.
const StyledAppRoot = styled.div`
  /* The pane is wide enough for page titles to read whole. */
  --pure-chrome-sidebar-width: 340px;
  /* The page ground is white (ui/look.ts); parts are told apart by hairlines and a shade of grey. */
  --pureknowledge-bg: var(--n-sheet, var(--platform-colors-bg));
  --pureknowledge-well: var(--pure-chrome-well);
  --pureknowledge-panel: var(--pure-chrome-surface);
  --pureknowledge-panel-subtle: var(--pure-chrome-well);
  --pureknowledge-panel-hover: var(--pure-chrome-hover);
  --pureknowledge-content-bg: var(--glass-panel);
  /* The article is read on a page: white in light, the elevated surface in dark,
     over the well in glass and PureBook's grey in White. */
  --pureknowledge-page: var(--platform-colors-elevated, #ffffff);
  --pureknowledge-surround: var(--n-panel, var(--pure-chrome-well));
  :root:not([data-platform-theme='dark']) & { --pureknowledge-page: #ffffff; }
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
  /* Actions and links are ink, never the app's colour; the colour is kept for the main action and the selected look. */
  --pureknowledge-accent: var(--n-ink, var(--pure-chrome-accent));
  --pureknowledge-focus: var(--pure-chrome-accent);
  --pureknowledge-font-display: var(--platform-typography-font-family-content);
  /* Meta, counts and headers in the platform sans (the old family look used mono). */
  --pureknowledge-font-mono: var(--platform-typography-font-family);
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

const StyledSavedDot = styled(MetaText)<{ $saving: boolean; $error: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;

  &::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${({ $saving, $error }) =>
      $error
        ? 'var(--platform-colors-error)'
        : $saving ? 'var(--platform-colors-warning)' : 'var(--platform-colors-success)'};
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
/** A hairline between the pane and the page. */
const StyledSidebar = styled(AppSidebar)`
  && { border-right: 1px solid var(--pureknowledge-border); }
`


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
  flex-direction: column;
  align-items: flex-start;
  > :first-child { width: 100%; min-width: 0; }
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
  /* Let the final page and its actions scroll above the floating desktop dock. */
  padding: 0 0 max(96px, env(safe-area-inset-bottom, 0px));
  scroll-padding-bottom: 96px;
`

const StyledTreeHeading = styled.div`
  display: flex;
  align-items: center;
  padding-right: var(--pureknowledge-space-md);
`

const StyledTreeLabel = styled(SidebarSectionLabel)`
  flex: 1 1 auto;
`

const StyledCollapseTreeButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--pureknowledge-radius-control);
  background: transparent;
  color: var(--pureknowledge-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--pureknowledge-panel-hover);
    color: var(--pureknowledge-text);
  }

  &:focus-visible {
    outline: 2px solid var(--pureknowledge-focus);
    outline-offset: 1px;
  }

  &:disabled {
    cursor: default;
    opacity: 0.35;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`

const StyledTreeItem = styled.div`
  margin-bottom: 0;
`

const StyledPageRow = styled.div<{ $active: boolean; $depth?: number }>`
  position: relative;
  display: grid;
  grid-template-columns: 18px 22px minmax(0, 1fr) 24px 28px;
  align-items: center;
  gap: var(--pureknowledge-space-xs);
  width: 100%;
  min-height: var(--pure-chrome-row-height);
  overflow: hidden;
  padding: 2px var(--pureknowledge-space-lg) 2px var(--pureknowledge-space-md);
  padding-left: ${({ $depth = 0 }) => 14 + $depth * 16}px;
  border: 0;
  border-radius: 0;
  background: ${({ $active }) => ($active ? 'var(--p-chosen)' : 'transparent')};
  box-shadow: ${({ $active }) => ($active ? 'var(--p-chosen-edge)' : 'none')};
  color: var(--pureknowledge-text);
  font-size: var(--pure-chrome-ui-size);
  text-align: left;

  &:hover {
    background: ${({ $active }) => ($active ? 'var(--p-chosen)' : 'var(--pure-chrome-hover)')};
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

  &:focus:not(:focus-visible) {
    outline: none;
  }

  &:focus-visible {
    outline: 2px solid var(--pureknowledge-focus);
    outline-offset: 2px;
    border-radius: 2px;
  }
`

const StyledMeaningMatch = styled.small`
  display: block;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.4;
  white-space: normal;
  color: var(--platform-colors-text-secondary);
  b {
    font-weight: 500;
    color: var(--platform-colors-text-primary);
  }
`
const StyledSearchResult = styled(StyledPageSelect)`
  display: block;
  width: 100%;
  padding: 8px 10px;
  border-radius: 3px;
  overflow-wrap: anywhere;
  &:hover { background: var(--pure-chrome-hover); }
  &:focus-visible { outline: 2px solid currentColor; }
  > span { display: block; font-weight: 500; margin-bottom: 4px; }
  > small { display: block; color: var(--pure-chrome-tertiary); line-height: 1.5; }
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 0;

  button {
    width: 28px;
    height: 28px;
    min-width: 0;
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

/** The add actions, set off from the tree below by a hairline. */
const StyledExplorerActions = styled.div`
  display: flex;
  gap: var(--pureknowledge-space-md);
  margin: 0 0 var(--pureknowledge-space-sm);
  padding: 0 var(--pureknowledge-space-lg) var(--pureknowledge-space-md);
  border-bottom: 1px solid var(--pureknowledge-border);
`

const StyledExplorerButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pureknowledge-muted);
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
  padding: 32px 40px 64px;
  background: var(--pureknowledge-surround);
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
    color: var(--pureknowledge-accent);
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

/** The article as a centred page, not a column hugging the pane. */
const StyledWikiSurface = styled.article`
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 56px 64px;
  background: var(--pureknowledge-page);
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgb(20 24 30 / 0.05), 0 1px 2px rgb(20 24 30 / 0.06), 0 14px 36px rgb(20 24 30 / 0.08);
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
  border-radius: 3px;
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

// Edit page: a raised plain button on a firm edge, with its word.
const StyledEditPageButton = styled(Button)`
  && {
    min-height: var(--pure-chrome-control-height);
    padding: 0 12px;
    border: 1px solid var(--n-btn-line, var(--pure-chrome-line));
    border-bottom-color: var(--n-btn-foot, var(--pure-chrome-line));
    border-radius: 3px;
    background: var(--n-sheet, var(--pure-chrome-surface));
    color: var(--pureknowledge-text);
    font-family: var(--platform-typography-font-family);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    box-shadow: 0 1px 1px rgb(0 0 0 / 0.08);
  }

  &&:hover:not(:disabled) {
    border-color: var(--n-btn-foot, var(--pure-chrome-soft));
    background: var(--n-hover, var(--pure-chrome-hover));
    color: var(--pureknowledge-text);
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

const StyledAssetLoadWarning = styled.div`
  margin: 0 0 var(--pureknowledge-space-lg);
  padding: 10px 12px;
  border: 1px solid var(--platform-colors-warning, #a66d16);
  border-radius: 3px;
  background: var(--pure-chrome-well);
  color: var(--pureknowledge-content-text);
  font-family: var(--platform-typography-font-family);
  font-size: 12px;
  line-height: 1.45;

  strong {
    display: block;
    margin-bottom: 4px;
  }

  ul {
    margin: 4px 0 0;
    padding-left: 20px;
  }

  code {
    overflow-wrap: anywhere;
    font-family: var(--platform-typography-font-family-mono);
  }
`

const StyledImagePreview = styled.figure`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 18px;
  box-sizing: border-box;

  img {
    display: block;
    max-width: 100%;
    max-height: calc(100vh - 190px);
    object-fit: contain;
    border-radius: 3px;
    box-shadow: 0 18px 60px rgb(0 0 0 / 0.24);
  }

  figcaption {
    max-width: min(78ch, 100%);
    color: var(--platform-colors-text-secondary);
    font-family: var(--platform-typography-font-family);
    font-size: 12px;
    line-height: 1.45;
    text-align: center;
    overflow-wrap: anywhere;
  }
`

// A wiki page is read: the platform reading surface (serif 16/1.7, 72ch).
const StyledWikiBody = styled(ReadingSurface)`
  [data-knowledge-gallery] {
    display: grid;
    grid-template-columns: repeat(
      auto-fill,
      minmax(min(100%, var(--knowledge-gallery-size, 96px)), 1fr)
    );
    gap: var(--pureknowledge-space-lg);
    align-items: start;
  }

  [data-knowledge-gallery][data-gallery-columns] {
    grid-template-columns: repeat(
      var(--knowledge-gallery-columns),
      minmax(0, 1fr)
    );
  }

  [data-knowledge-gallery] figure {
    position: relative;
    display: grid;
    justify-items: center;
    gap: var(--pureknowledge-space-xs);
    min-width: 0;
    margin: 0;
  }

  [data-knowledge-gallery] img {
    width: var(--knowledge-gallery-size, 96px);
    max-width: 100%;
    max-height: var(--knowledge-gallery-size, 96px);
    margin: 0;
    object-fit: contain;
  }

  [data-knowledge-gallery] figcaption {
    max-width: 100%;
    color: var(--pureknowledge-content-muted);
    font-family: var(--platform-typography-font-family);
    font-size: var(--pureknowledge-font-size-meta);
    line-height: 1.35;
    text-align: center;
    overflow-wrap: anywhere;
  }

  [data-gallery-background='light'] img {
    padding: var(--pureknowledge-space-sm);
    border-radius: var(--pureknowledge-radius-control);
    background: #fff;
  }

  [data-gallery-background='dark'] img {
    padding: var(--pureknowledge-space-sm);
    border-radius: var(--pureknowledge-radius-control);
    background: #111;
  }

  [data-gallery-background='checkerboard'] img {
    padding: var(--pureknowledge-space-sm);
    border-radius: var(--pureknowledge-radius-control);
    background-color: #fff;
    background-image:
      linear-gradient(45deg, #d7d7d7 25%, transparent 25%),
      linear-gradient(-45deg, #d7d7d7 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #d7d7d7 75%),
      linear-gradient(-45deg, transparent 75%, #d7d7d7 75%);
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    background-size: 12px 12px;
  }

  .knowledge-gallery-toolbar {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
  }

  .knowledge-gallery-toolbar button,
  .knowledge-gallery-image-controls button {
    border: 1px solid var(--pureknowledge-content-border);
    border-radius: var(--pureknowledge-radius-control);
    background: color-mix(in srgb, var(--pureknowledge-content-bg) 90%, transparent);
    color: var(--pureknowledge-content-muted);
    font: 500 var(--pureknowledge-font-size-meta) / 1.2 var(--platform-typography-font-family);
    cursor: pointer;
  }

  .knowledge-gallery-toolbar button {
    padding: 6px 9px;
  }

  .knowledge-gallery-image-controls {
    position: absolute;
    z-index: 1;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 4px;
    max-width: 100%;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-2px);
    transition: opacity 120ms ease, transform 120ms ease;
  }

  [data-knowledge-gallery] figure:hover .knowledge-gallery-image-controls,
  [data-knowledge-gallery] figure:focus-within .knowledge-gallery-image-controls {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  .knowledge-gallery-image-controls button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
  }

  .knowledge-gallery-image-controls svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .knowledge-gallery-image-controls [data-gallery-background] svg path {
    fill: currentColor;
    stroke: none;
    opacity: 0.45;
  }

  .knowledge-gallery-image-controls .knowledge-gallery-remove:hover {
    border-color: var(--platform-colors-danger, #b42318);
    color: var(--platform-colors-danger, #b42318);
  }

  .knowledge-gallery-toolbar button:hover,
  .knowledge-gallery-image-controls button:hover {
    background: var(--pureknowledge-content-subtle);
    color: var(--pureknowledge-content-text);
  }

  @media (hover: none), (pointer: coarse) {
    .knowledge-gallery-image-controls {
      opacity: 1;
      pointer-events: auto;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .knowledge-gallery-image-controls {
      transition: none;
    }
  }

  img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 0 var(--pureknowledge-space-lg);
  }

  img[data-knowledge-image-preview] {
    cursor: zoom-in;
  }

  img[data-knowledge-image-preview]:focus-visible {
    outline: 2px solid var(--platform-colors-focus);
    outline-offset: 3px;
  }

  /* A link to another page: ink with a hairline underline. */
  a[data-wiki-title] {
    color: var(--pureknowledge-accent);
    text-decoration: underline;
    text-decoration-color: var(--n-strong, currentColor);
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
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

  /* A table reads like a table: each cell's text starts at its top, every
     column keeps a readable width (a long id breaks a dozen or so characters
     a line, never every three), a long cell stops at a measure, and headers
     stay on one line. A table wider than the page scrolls inside it, with
     its scrollbar always showing, so nothing past the edge is hidden. The
     table itself is the scroll box (no wrapper element, so the Markdown
     round-trip is untouched). */
  a.knowledge-ref {
    color: inherit;
    text-decoration: none;
  }

  a.knowledge-ref code {
    color: var(--pureknowledge-accent, var(--app-acc, currentColor));
    cursor: pointer;
  }

  a.knowledge-ref:hover code {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  button.knowledge-table-open {
    display: block;
    margin: 0 0 6px auto;
    padding: 3px 10px;
    border: 1px solid var(--pure-chrome-line, rgba(127, 127, 127, 0.35));
    border-radius: 3px;
    background: transparent;
    color: var(--pureknowledge-content-muted, inherit);
    font: 500 12px/1.4 var(--platform-typography-font-family, system-ui);
    cursor: pointer;
  }

  button.knowledge-table-open:hover {
    color: var(--platform-colors-text, inherit);
  }

  /* Prose keeps its reading measure; a table takes the sheet's full width. */
  &[data-chrome] {
    max-width: none;
  }

  > :not(table) {
    max-width: var(--pure-chrome-reading-measure);
  }

  table {
    display: block;
    max-width: 100%;
    width: max-content;
    overflow-x: auto;
    margin-top: 0;
    margin-bottom: var(--pureknowledge-space-lg);
    font-size: 0.9em;
    line-height: 1.45;
    scrollbar-width: thin;
    scrollbar-color: var(--pureknowledge-content-muted, rgba(127, 127, 127, 0.55)) transparent;
  }

  table::-webkit-scrollbar {
    height: 8px;
  }

  table::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--pureknowledge-content-muted, rgba(127, 127, 127, 0.55));
  }

  th,
  td {
    min-width: 6rem;
    max-width: 28rem;
    padding: 0.45em 0.75em;
    vertical-align: top;
    text-align: left;
    overflow-wrap: break-word;
  }

  th {
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    min-width: 2.5rem;
  }

  :is(th, td) :is(code, a) {
    overflow-wrap: anywhere;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
`

/* A wide table, whole: the dialog's width, cells at a reading measure, scrolling only if it must. */
const StyledTablePreview = styled.div`
  &[data-chrome] {
    max-width: none;
    min-width: 0;
    width: 100%;
    max-height: 75vh;
    /* The dialog's body makes its only child scroll up and down only (overflow: hidden auto); a table needs both. */
    overflow: auto !important;
  }

  table {
    border-collapse: collapse;
    font-size: 0.9em;
    line-height: 1.45;
  }

  th,
  td {
    min-width: 6rem;
    max-width: 32rem;
    padding: 0.45em 0.75em;
    vertical-align: top;
    text-align: left;
    overflow-wrap: break-word;
    border-bottom: 1px solid var(--pure-chrome-line, rgba(127, 127, 127, 0.25));
  }

  th {
    position: sticky;
    top: 0;
    white-space: nowrap;
    background: var(--glass-popover, var(--platform-colors-elevated, #1b1f22));
  }

  :is(th, td) :is(code, a) {
    overflow-wrap: anywhere;
  }

  a.knowledge-ref {
    color: inherit;
    text-decoration: none;
  }

  a.knowledge-ref code {
    color: var(--pureknowledge-accent, var(--app-acc, currentColor));
    cursor: pointer;
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

  /* The editor's table fills the field at a fixed layout; a resized one
     can grow wider, so its wrapper scrolls instead of being clipped by the
     frame. Text in a cell wraps inside the cell rather than running under
     its neighbour. */
  .knowledge-page-editor .tableWrapper {
    max-width: 100%;
    overflow-x: auto;
  }

  .knowledge-page-editor :is(th, td) {
    overflow-wrap: anywhere;
  }

  .knowledge-page-editor :is(th, td) code {
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }

  .knowledge-page-editor [data-knowledge-gallery] {
    display: grid;
    grid-template-columns: repeat(
      auto-fill,
      minmax(min(100%, var(--knowledge-gallery-size, 96px)), 1fr)
    );
    gap: var(--pureknowledge-space-lg);
    align-items: start;
    margin: 0 0 var(--pureknowledge-space-lg);
  }

  .knowledge-page-editor [data-knowledge-gallery][data-gallery-columns] {
    grid-template-columns: repeat(
      var(--knowledge-gallery-columns),
      minmax(0, 1fr)
    );
  }

  .knowledge-page-editor [data-knowledge-gallery] figure {
    display: grid;
    justify-items: center;
    gap: var(--pureknowledge-space-xs);
    min-width: 0;
    margin: 0;
  }

  .knowledge-page-editor [data-knowledge-gallery] img {
    width: var(--knowledge-gallery-size, 96px);
    max-width: 100%;
    max-height: var(--knowledge-gallery-size, 96px);
    object-fit: contain;
  }

  .knowledge-page-editor [data-knowledge-gallery] figcaption {
    max-width: 100%;
    color: var(--pureknowledge-content-muted);
    font-size: var(--pureknowledge-font-size-meta);
    line-height: 1.35;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .knowledge-page-editor [data-gallery-background='light'] img {
    padding: var(--pureknowledge-space-sm);
    border-radius: var(--pureknowledge-radius-control);
    background: #fff;
  }

  .knowledge-page-editor [data-gallery-background='dark'] img {
    padding: var(--pureknowledge-space-sm);
    border-radius: var(--pureknowledge-radius-control);
    background: #111;
  }

  .knowledge-page-editor [data-gallery-background='checkerboard'] img {
    padding: var(--pureknowledge-space-sm);
    border-radius: var(--pureknowledge-radius-control);
    background-color: #fff;
    background-image:
      linear-gradient(45deg, #d7d7d7 25%, transparent 25%),
      linear-gradient(-45deg, #d7d7d7 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #d7d7d7 75%),
      linear-gradient(-45deg, transparent 75%, #d7d7d7 75%);
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    background-size: 12px 12px;
  }
`

const StyledWikiEmptyBody = styled.div`
  padding: 20px 0;
  color: var(--pureknowledge-content-muted);
  font-size: var(--pureknowledge-font-size-body);
  line-height: var(--pureknowledge-line-height-content);
`

const StyledGalleryFileInput = styled.input`
  position: fixed;
  left: -10000px;
  width: 1px;
  height: 1px;
  opacity: 0;
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

const StyledNavButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--pure-chrome-line);
  border-radius: 3px;
  background: transparent;
  color: var(--pureknowledge-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--pure-chrome-hover);
    color: var(--pureknowledge-text);
  }

  &:focus-visible {
    outline: 2px solid var(--pureknowledge-focus);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
`

const StyledTagChipButton = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid
    ${({ $active }) =>
      $active ? 'var(--pureknowledge-focus)' : 'var(--pureknowledge-border)'};
  border-radius: 999px;
  background: ${({ $active }) =>
    $active ? 'var(--pure-chrome-selection, var(--pure-chrome-hover))' : 'var(--pure-chrome-well)'};
  color: var(--pureknowledge-text);
  font-family: var(--platform-typography-font-family);
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;

  &:hover {
    background: var(--pure-chrome-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--pureknowledge-focus);
    outline-offset: 1px;
  }
`

const StyledTagFilterRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
`

const StyledOutlineNav = styled.nav`
  margin: 0 0 var(--pureknowledge-space-lg);
  padding: 10px 14px;
  border: 1px solid var(--pureknowledge-content-border-soft);
  border-radius: var(--pureknowledge-radius-control);
  background: var(--pureknowledge-content-subtle);
  font-family: var(--platform-typography-font-family);
  font-size: 12px;

  summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--pureknowledge-content-muted);
    letter-spacing: var(--pure-chrome-label-tracking);
    text-transform: uppercase;
    font-size: var(--pure-chrome-label-size);
  }

  ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }

  button {
    border: 0;
    background: transparent;
    color: var(--pureknowledge-content-text);
    font: inherit;
    text-align: left;
    padding: 2px 0;
    cursor: pointer;
  }

  button:hover {
    text-decoration: underline;
  }
`

const StyledNoticeBanner = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--pureknowledge-content-border);
  border-radius: var(--pureknowledge-radius-control);
  background: var(--pureknowledge-content-subtle);
  color: var(--pureknowledge-content-text);
  font-family: var(--platform-typography-font-family);
  font-size: 12px;
  line-height: 1.45;
`

const StyledReviewDiffWrap = styled.div`
  padding: 0 var(--pureknowledge-space-lg) var(--pureknowledge-space-md);
  border-bottom: 1px solid var(--pureknowledge-border-soft);
  background: var(--pureknowledge-well);
`

const StyledDiffGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  margin-top: 8px;
`

const StyledDiffBlock = styled.div<{ $tone: 'before' | 'after' }>`
  border: 1px solid var(--pureknowledge-border);
  border-radius: var(--pureknowledge-radius-control);
  background: var(--pureknowledge-panel);
  overflow: hidden;

  header {
    padding: 4px 10px;
    border-bottom: 1px solid var(--pureknowledge-border-soft);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: ${({ $tone }) =>
      $tone === 'before'
        ? 'var(--platform-colors-danger, #b42318)'
        : 'var(--platform-colors-success, #16794f)'};
  }

  pre {
    margin: 0;
    padding: 8px 10px;
    max-height: 220px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--platform-typography-font-family-mono, monospace);
    font-size: 12px;
    line-height: 1.45;
  }
`

const StyledSpaceRenameSection = styled.div`
  margin-top: var(--pureknowledge-space-md);
  padding-top: var(--pureknowledge-space-md);
  border-top: 1px solid var(--pureknowledge-border-soft);
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

/** Plain-prose preview of a page body: wikilinks read as their titles,
 * markdown syntax is stripped rather than shown. */
function pageSnippet(page: KnowledgePage): string {
  const text = normalizeWikiLinkEscapes(page.body)
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_m, target: string, display?: string) => (display?.trim() || target.trim()),
    )
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
  expandedPageIds: Set<string>,
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
    const expanded = expandedPageIds.has(page.id)
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  ) {
    return true
  }
  return Boolean(target.closest('.ProseMirror, [contenteditable="true"]'))
}

function hasOpenModal(): boolean {
  return Boolean(document.querySelector('[data-selector="modal"]'))
}

export function KnowledgeWorkspace({
  boot,
  resourcePath,
  onResourceHandled,
  compact = false,
}: {
  boot: KnowledgeBootState
  resourcePath: string | null
  onResourceHandled: () => void
  /** Held inside a page (useCompactInRoom): one job, the list of pages or one page. */
  compact?: boolean
}): React.ReactElement {
  const { store, storePath, loading, saving, error, saveFailed, saveStore, externalNotice } =
    useKnowledgeWorkspace(boot, resourcePath, onResourceHandled)
  const meaning = useKnowledgeMeaning(store, storePath, { heldCopy: boot.heldCopy })
  useKnowledgeAgentTools(true, { store, saveStore, storePath, meaning })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<GuidanceFilter>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [actionError, setActionError] = useState<Error | null>(null)
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false)
  const [renamingSpace, setRenamingSpace] = useState(false)
  const [renameSpaceDraft, setRenameSpaceDraft] = useState('')
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [editToggleNonce, setEditToggleNonce] = useState(0)
  const [navHistory, setNavHistory] = useState<{ stack: string[]; index: number }>({
    stack: [],
    index: -1,
  })
  const [deleteCandidate, setDeleteCandidate] = useState<KnowledgePage | null>(
    null,
  )
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const spaceMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!spaceMenuOpen) {
      setRenamingSpace(false)
      return
    }
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
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        quickSwitcherOpen ||
        deleteCandidate ||
        hasOpenModal()
      ) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSpaceMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [deleteCandidate, quickSwitcherOpen, spaceMenuOpen])
  const [newRootComposer, setNewRootComposer] = useState<
    'page' | 'directory' | 'note' | null
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
  const [expandedPageIds, setExpandedPageIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [notesExpanded, setNotesExpanded] = useState(false)
  // Compact only: whether the page is showing rather than the list. Never saved, and the whole app ignores it.
  const [compactPageOpen, setCompactPageOpen] = useState(false)
  // A new page from compact opens once the store has it. Holds the page that was active when it was asked for.
  const compactNewPageFrom = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (compactNewPageFrom.current === undefined || store?.activePageId === compactNewPageFrom.current) return
    compactNewPageFrom.current = undefined
    setCompactPageOpen(true)
  }, [store?.activePageId])

  useEffect(() => {
    setNavHistory({ stack: [], index: -1 })
  }, [storePath])

  useEffect(() => {
    const activeId = store?.activePageId
    if (!activeId) return
    setNavHistory(current => {
      if (current.stack[current.index] === activeId) return current
      const nextStack = [...current.stack.slice(0, current.index + 1), activeId].slice(-50)
      return { stack: nextStack, index: nextStack.length - 1 }
    })
  }, [store?.activePageId])

  useEffect(() => {
    if (activeView === 'wiki') return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        quickSwitcherOpen ||
        deleteCandidate ||
        hasOpenModal()
      ) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setActiveView('wiki')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeView, deleteCandidate, quickSwitcherOpen])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'k') {
        if (deleteCandidate) return
        if (!quickSwitcherOpen && (hasOpenModal() || isEditableTarget(event.target))) {
          return
        }
        event.preventDefault()
        setQuickSwitcherOpen(open => !open)
      } else if (
        key === 'e' &&
        !quickSwitcherOpen &&
        !deleteCandidate &&
        !hasOpenModal() &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault()
        setActiveView('wiki')
        setEditToggleNonce(nonce => nonce + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteCandidate, quickSwitcherOpen])

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

  const allSpaceTags = useMemo(() => {
    if (!store || !activeSpace) return []
    const counts = new Map<string, number>()
    for (const page of store.pages) {
      if (page.spaceId !== activeSpace.id) continue
      for (const tag of page.tags) {
        if (!tag || tag === 'directory') continue
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag)
  }, [activeSpace, store])

  useEffect(() => {
    if (tagFilter && !allSpaceTags.includes(tagFilter)) setTagFilter(null)
  }, [allSpaceTags, tagFilter])

  const healthFindings = useMemo(
    () =>
      store && activeSpace
        ? reviewKnowledgeStore(store, activeSpace.id, Date.now())
        : [],
    [activeSpace, store],
  )

  // The search box and the searchKnowledge tool share one ranking. Words answer at once; meaning joins when the model
  // has read the question, a moment later, so typing never waits for it.
  const asked = query.trim()
  const [questionVector, setQuestionVector] = useState<{ query: string; vector: number[] } | null>(null)
  const { vector: vectorForQuestion } = meaning
  useEffect(() => {
    if (asked.length < MEANING_MIN_QUERY) return
    let stale = false
    const timer = setTimeout(() => {
      void vectorForQuestion(asked).then(vector => {
        if (!stale && vector) setQuestionVector({ query: asked, vector })
      })
    }, 180)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [asked, vectorForQuestion])
  const meaningIndex = meaning.index()
  const indexedPassages = meaning.state.indexed
  const meaningHits = useMemo(() => {
    if (!store || !meaningIndex || questionVector?.query !== asked || !asked) return null
    const hits = rankKnowledgeWithMeaning(store, asked, store.pages.length, statusFilter, meaningIndex, questionVector.vector, { drafts: true })
    return new Map<string, KnowledgeMeaningHit>(hits.map(hit => [hit.page.id, hit]))
    // A growing index changes the answer; indexedPassages says it grew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, indexedPassages, meaningIndex, questionVector, statusFilter, store])

  const visiblePages = useMemo(() => {
    if (!store || !activeSpace) return []
    const pages = meaningHits
      ? [...meaningHits.values()].map(hit => hit.page)
      : query.trim() || statusFilter !== 'all'
      ? rankKnowledgePages(store, query, store.pages.length, statusFilter).map(
          hit => hit.page,
        )
      : store.pages
    return pages.filter(
      page =>
        page.spaceId === activeSpace.id &&
        (!tagFilter || page.tags.includes(tagFilter)),
    )
  }, [activeSpace, meaningHits, query, statusFilter, store, tagFilter])

  const wikiPages = useMemo(() => {
    if (!store || !activeSpace) return []
    const base = query
      ? visiblePages.filter(page => page.kind === 'wiki')
      : getWikiPagesForSpace(store, activeSpace.id)
    return buildWikiRows(
      base,
      activeSpace.rootPageId,
      query ? new Set(base.map(page => page.id)) : expandedPageIds,
    )
  }, [activeSpace, expandedPageIds, query, store, visiblePages])

  // F4: notes are first-class in navigation — a collapsed group below the
  // wiki tree, so a note stays reachable (and promotable) after it loses
  // focus. Search surfaces matching notes too.
  const notePages = useMemo(() => {
    if (!store || !activeSpace) return []
    const base = query.trim() || tagFilter ? visiblePages : store.pages
    return base
      .filter(
        page => page.spaceId === activeSpace.id && page.kind === 'note',
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [activeSpace, query, store, tagFilter, visiblePages])
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
    async (update: KnowledgeStoreUpdate): Promise<boolean> => {
      try {
        await saveStore(update)
        setActionError(null)
        return true
      } catch (cause) {
        setActionError(cause instanceof Error ? cause : new Error(String(cause)))
        return false
      }
    },
    [saveStore],
  )

  const selectPage = useCallback(
    (pageId: string): void => {
      if (!store) return
      const pageById = new Map(store.pages.map(page => [page.id, page]))
      const selectedPage = pageById.get(pageId)
      if (!selectedPage) return
      setExpandedPageIds(current => {
        const next = new Set(current)
        // Guarded like findPagePath: a parent chain that loops (a root
        // filed under itself, say) must not spin here.
        let parentId = selectedPage.parentId
        while (parentId && !next.has(parentId)) {
          next.add(parentId)
          parentId = pageById.get(parentId)?.parentId ?? null
        }
        return next
      })
      setActiveView('wiki')
      setCompactPageOpen(true)
      void mutate(current => {
        const selected = current.pages.find(page => page.id === pageId)
        if (!selected) return current
        return {
          ...current,
          activeSpaceId: selected.spaceId,
          activePageId: pageId,
        }
      })
    },
    [mutate, store],
  )

  const canGoBack = useMemo(() => {
    if (!store || navHistory.index <= 0) return false
    const pageIds = new Set(store.pages.map(page => page.id))
    for (let i = navHistory.index - 1; i >= 0; i -= 1) {
      if (pageIds.has(navHistory.stack[i]!)) return true
    }
    return false
  }, [navHistory, store])

  const canGoForward = useMemo(() => {
    if (!store || navHistory.index >= navHistory.stack.length - 1) return false
    const pageIds = new Set(store.pages.map(page => page.id))
    for (let i = navHistory.index + 1; i < navHistory.stack.length; i += 1) {
      if (pageIds.has(navHistory.stack[i]!)) return true
    }
    return false
  }, [navHistory, store])

  const navigateHistory = useCallback(
    (direction: -1 | 1): void => {
      if (!store) return
      const pageIds = new Set(store.pages.map(page => page.id))
      let nextIndex = navHistory.index + direction
      while (nextIndex >= 0 && nextIndex < navHistory.stack.length) {
        const targetId = navHistory.stack[nextIndex]!
        if (pageIds.has(targetId)) {
          setNavHistory(current => ({ ...current, index: nextIndex }))
          selectPage(targetId)
          return
        }
        nextIndex += direction
      }
    },
    [navHistory, selectPage, store],
  )

  usePlatformDeepLink('knowledge', pageId => {
    if (store?.pages.some(page => page.id === pageId)) selectPage(pageId)
  })

  const displayError = actionError ?? error

  if (loading || !store || !activeSpace) {
    return (
      <EmptyState
        title="pure knowledge"
        message={displayError ? displayError.message : 'Opening local knowledge store…'}
        tone={displayError ? 'error' : 'neutral'}
      />
    )
  }

  const selectSpace = (spaceId: string): void => {
    void mutate(current => {
      const space = current.spaces.find(candidate => candidate.id === spaceId)
      const firstPage =
        (space?.rootPageId
          ? current.pages.find(page => page.id === space.rootPageId)
          : null) ??
        current.pages.find(
          page => page.spaceId === spaceId && page.kind === 'wiki',
        ) ??
        current.pages.find(page => page.spaceId === spaceId) ??
        null
      return {
        ...current,
        activeSpaceId: spaceId,
        activePageId: firstPage?.id ?? null,
      }
    })
  }

  const togglePage = (pageId: string): void => {
    setExpandedPageIds(current => {
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
    const trimmed = name.trim()
    if (!trimmed) return
    void mutate(current =>
      createKnowledgeSpace(current, { name: trimmed }, { actor: HUMAN_ACTIVITY_ACTOR }),
    ).then(ok => {
      if (ok) recordUserOperation('space.create', `Created space "${trimmed}"`)
    })
  }

  const submitRenameSpace = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = renameSpaceDraft.trim()
    if (!trimmed || trimmed === activeSpace.name) {
      setRenamingSpace(false)
      return
    }
    const spaceId = activeSpace.id
    const previousName = activeSpace.name
    void mutate(current =>
      renameKnowledgeSpace(current, spaceId, trimmed, { actor: HUMAN_ACTIVITY_ACTOR }),
    ).then(ok => {
      if (ok) {
        recordUserOperation('space.rename', `Renamed space "${previousName}" to "${trimmed}"`)
        setRenamingSpace(false)
      }
    })
  }

  const addRootPage = (event: FormEvent): void => {
    event.preventDefault()
    if (!newRootTitle.trim() || !newRootComposer) return
    const trimmedTitle = newRootTitle.trim()
    const isDirectory = newRootComposer === 'directory'
    const isNote = newRootComposer === 'note'
    const spaceId = activeSpace.id
    const spaceName = activeSpace.name
    const rootPageId = activeSpace.rootPageId
    void mutate(current =>
      createKnowledgePage(
        current,
        {
          spaceId,
          kind: isNote ? 'note' : 'wiki',
          parentId: isNote ? null : rootPageId,
          title: trimmedTitle,
          body: isDirectory
            ? createDirectoryIndexBody(trimmedTitle)
            : undefined,
          tags: isDirectory ? ['directory'] : [],
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    ).then(ok => {
      if (ok) {
        recordUserOperation(
          'page.create',
          `Created ${isDirectory ? 'directory' : isNote ? 'note' : 'page'} "${trimmedTitle}" in ${spaceName}`,
        )
      }
    })
    if (isNote) setNotesExpanded(true)
    setNewRootComposer(null)
    setNewRootTitle('')
  }

  const createCompactPage = (title: string): void => {
    const trimmed = title.trim()
    compactNewPageFrom.current = store.activePageId
    const spaceId = activeSpace.id
    const spaceName = activeSpace.name
    const rootPageId = activeSpace.rootPageId
    void mutate(current =>
      createKnowledgePage(
        current,
        { spaceId, kind: 'wiki', parentId: rootPageId, title: trimmed, tags: [] },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    ).then(ok => {
      if (ok) recordUserOperation('page.create', `Created page "${trimmed}" in ${spaceName}`)
    })
  }

  const startChildPage = (
    parentId: string,
    kind: 'page' | 'directory' = 'page',
  ): void => {
    setNewChildParentId(parentId)
    setNewChildKind(kind)
    setNewChildTitle('')
    setExpandedPageIds(current => {
      const next = new Set(current)
      next.add(parentId)
      return next
    })
  }

  const addChildPage = (event: FormEvent, parentId: string): void => {
    event.preventDefault()
    if (!newChildTitle.trim()) return
    const trimmedTitle = newChildTitle.trim()
    const isDirectory = newChildKind === 'directory'
    const spaceId = activeSpace.id
    void mutate(current =>
      createKnowledgePage(
        current,
        {
          spaceId,
          kind: 'wiki',
          parentId,
          title: trimmedTitle,
          body: isDirectory
            ? createDirectoryIndexBody(trimmedTitle)
            : undefined,
          tags: isDirectory ? ['directory'] : [],
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ),
    ).then(ok => {
      if (ok) {
        recordUserOperation(
          'page.create',
          `Created ${isDirectory ? 'directory' : 'page'} "${trimmedTitle}"`,
        )
      }
    })
    setNewChildTitle('')
    setNewChildParentId(parentId)
    setExpandedPageIds(current => {
      const next = new Set(current)
      next.add(parentId)
      return next
    })
  }

  const editTreePage = (pageId: string): void => {
    void mutate(current => {
      const selected = current.pages.find(page => page.id === pageId)
      if (!selected) return current
      return {
        ...current,
        activeSpaceId: selected.spaceId,
        activePageId: pageId,
      }
    })
    setEditRequest({ pageId, nonce: Date.now() })
  }

  const promoteTreeNote = (note: KnowledgePage): void => {
    void mutate(current => {
      const currentPage = current.pages.find(candidate => candidate.id === note.id)
      if (!currentPage) return current
      const rootPageId =
        current.spaces.find(space => space.id === currentPage.spaceId)?.rootPageId ?? null
      return updateKnowledgePage(
        current,
        currentPage.id,
        { kind: 'wiki', parentId: rootPageId },
        { actor: HUMAN_ACTIVITY_ACTOR },
      )
    }).then(ok => {
      if (ok) recordUserOperation('page.promote', `Promoted note "${note.title}" to wiki`)
    })
  }

  // window.confirm is disabled by Chromium in cross-origin iframes — every
  // app frame is one — so destructive confirmation must be in-app.
  const deleteTreePage = (page: KnowledgePage): void => {
    if (page.id === activeSpace.rootPageId) return
    setDeleteCandidate(page)
  }

  const confirmDeletePage = (): void => {
    if (!deleteCandidate) return
    const target = deleteCandidate
    setDeleteCandidate(null)
    void mutate(current =>
      deleteKnowledgePage(current, target.id, {
        actor: HUMAN_ACTIVITY_ACTOR,
      }),
    ).then(ok => {
      if (ok) {
        recordUserOperation(
          'page.delete',
          `Deleted ${target.kind === 'note' ? 'note' : 'page'} "${target.title}"`,
        )
      }
    })
  }

  const approveAgentChange = (changeId: string): void => {
    const change = spaceAgentChanges.find(
      candidate => candidate.id === changeId,
    )
    void mutate(current => acceptKnowledgeAgentChange(current, changeId)).then(ok => {
      if (ok) {
        recordUserOperation(
          'agentChange.accept',
          `Accepted agent proposal${change ? `: ${change.title}` : ''}`,
        )
      }
    })
  }

  const rejectAgentChange = (changeId: string): void => {
    const change = spaceAgentChanges.find(
      candidate => candidate.id === changeId,
    )
    void mutate(current => rejectKnowledgeAgentChange(current, changeId)).then(ok => {
      if (ok) {
        recordUserOperation(
          'agentChange.reject',
          `Rejected agent proposal${change ? `: ${change.title}` : ''}`,
        )
      }
    })
  }

  const revertAgentChange = (change: KnowledgeAgentChange): void => {
    if (change.status !== 'applied' || !change.pageId) return
    const pageId = change.pageId
    void mutate(current => {
      const target = current.pages.find(candidate => candidate.id === pageId)
      if (!target) {
        throw new Error(`Cannot revert "${change.title}" because the page no longer exists.`)
      }
      if (change.changeType === 'page.create') {
        if (current.spaces.some(space => space.rootPageId === pageId)) {
          throw new Error(`Cannot revert space root "${target.title}".`)
        }
        return deleteKnowledgePage(current, pageId, { actor: HUMAN_ACTIVITY_ACTOR })
      }
      if (change.changeType === 'page.promote') {
        return updateKnowledgePage(current, pageId, { kind: 'note' }, { actor: HUMAN_ACTIVITY_ACTOR })
      }
      if (change.changeType === 'page.update' && change.before !== undefined) {
        const isGuidanceOnly =
          change.patch.body === undefined &&
          (change.patch.guidanceStatus !== undefined ||
            change.patch.lastChecked !== undefined ||
            change.patch.replacementPageId !== undefined)
        if (isGuidanceOnly) {
          type SavedGuidanceSnapshot = {
            guidanceStatus?: KnowledgePage['guidanceStatus'] | null
            lastChecked?: KnowledgePage['lastChecked'] | null
            replacementPageId?: string | null
          }
          let prev: SavedGuidanceSnapshot | null = null
          try {
            const parsed: unknown = JSON.parse(change.before)
            if (parsed && typeof parsed === 'object') {
              prev = parsed as SavedGuidanceSnapshot
            }
          } catch {
            prev = null
          }
          if (!prev) {
            throw new Error(`Cannot revert "${change.title}" because its saved guidance snapshot is unreadable.`)
          }
          return updateKnowledgePage(
            current,
            pageId,
            {
              guidanceStatus: prev.guidanceStatus ?? null,
              lastChecked: prev.lastChecked ?? null,
              replacementPageId: prev.replacementPageId ?? null,
            },
            { actor: HUMAN_ACTIVITY_ACTOR },
          )
        }
        return updateKnowledgePage(
          current,
          pageId,
          { body: change.before },
          { actor: HUMAN_ACTIVITY_ACTOR },
        )
      }
      return current
    }).then(ok => {
      if (ok) {
        recordUserOperation('agentChange.revert', `Reverted agent change: ${change.title}`)
      }
    })
  }

  const createPageFromHealth = (sourcePageId: string, missingTitle: string): void => {
    const trimmed = missingTitle.trim()
    if (!trimmed) return
    const spaceId = activeSpace.id
    const rootPageId = activeSpace.rootPageId
    let created = false
    void mutate(current => {
      created = false
      const existing = findPageByWikiTitle(current, spaceId, trimmed)
      if (existing) {
        return { ...current, activeSpaceId: existing.spaceId, activePageId: existing.id }
      }
      created = true
      const source = current.pages.find(candidate => candidate.id === sourcePageId)
      return createKnowledgePage(
        current,
        {
          spaceId,
          parentId: source?.kind === 'wiki' ? source.id : rootPageId,
          kind: 'wiki',
          title: trimmed,
        },
        { actor: HUMAN_ACTIVITY_ACTOR },
      )
    }).then(ok => {
      if (ok) {
        setActiveView('wiki')
        if (created) {
          recordUserOperation('page.create', `Created missing page "${trimmed}" from Wiki Health`)
        }
      }
    })
  }

  const editAgentChange = (change: KnowledgeAgentChange): void => {
    if (change.pageId) {
      const pageId = change.pageId
      setActiveView('wiki')
      void mutate(current => {
        const selected = current.pages.find(page => page.id === pageId)
        if (!selected) return current
        return { ...current, activeSpaceId: selected.spaceId, activePageId: pageId }
      })
      setEditRequest({ pageId, nonce: Date.now() })
    }
  }

  const approveAllAgentChanges = (): void => {
    if (!pendingAgentChanges.length) return
    const candidates = [...pendingAgentChanges]
    let acceptedCount = 0
    const failures: string[] = []
    void mutate(current => {
      let nextStore = current
      acceptedCount = 0
      failures.length = 0
      for (const change of candidates) {
        try {
          const updated = acceptKnowledgeAgentChange(nextStore, change.id)
          if (updated !== nextStore) {
            nextStore = updated
            acceptedCount += 1
          }
        } catch (cause) {
          failures.push(
            `${change.title}: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        }
      }
      if (acceptedCount === 0 && failures.length > 0) {
        throw new Error(failures.join('; '))
      }
      return nextStore
    }).then(ok => {
      if (ok && acceptedCount > 0) {
        recordUserOperation(
          'agentChange.acceptAll',
          `Accepted ${acceptedCount} pending agent proposal${
            acceptedCount === 1 ? '' : 's'
          }`,
        )
      }
      if (failures.length > 0) {
        setActionError(
          new Error(
            `Some proposals could not be accepted: ${failures.join('; ')}`,
          ),
        )
      }
    })
  }

  const pageCountsBySpace = new Map<string, number>()
  for (const page of store.pages) {
    pageCountsBySpace.set(
      page.spaceId,
      (pageCountsBySpace.get(page.spaceId) ?? 0) + 1,
    )
  }

  const compactHide = compact ? { 'data-compact-hide': '' } : undefined
  const compactView = compact
    ? { 'data-compact-view': compactPageOpen && activePage ? 'page' : 'list' }
    : undefined

  return (
    <StyledWorkspace {...compactView}>
      {compact && (displayError || externalNotice) ? (
        <div className="knowledge-compact-notice" role={displayError ? 'alert' : 'status'}>
          <span>
            {displayError
              ? saveFailed
                ? `This change was not saved. ${displayError.message}`
                : displayError.message
              : externalNotice}
          </span>
          {saveFailed && !saving ? (
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void saveStore(current => current).catch(() => undefined)}
            >
              Retry save
            </Button>
          ) : null}
        </div>
      ) : null}
      <StyledAppHeader {...compactHide}>
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
              <StyledSpaceRenameSection>
                {renamingSpace ? (
                  <StyledInlineForm onSubmit={submitRenameSpace}>
                    <TextField
                      autoFocus
                      aria-label="Rename space"
                      value={renameSpaceDraft}
                      onChange={event => setRenameSpaceDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') {
                          event.stopPropagation()
                          setRenamingSpace(false)
                        }
                      }}
                    />
                    <Button
                      variant="subtle"
                      size="sm"
                      type="submit"
                      disabled={!renameSpaceDraft.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      variant="subtle"
                      size="sm"
                      type="button"
                      onClick={() => setRenamingSpace(false)}
                    >
                      Cancel
                    </Button>
                  </StyledInlineForm>
                ) : (
                  <Button
                    variant="subtle"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setRenameSpaceDraft(activeSpace.name)
                      setRenamingSpace(true)
                    }}
                  >
                    Rename space
                  </Button>
                )}
              </StyledSpaceRenameSection>
              <StyledSpaceMenuPath title={storePath}>
                {storePath}
              </StyledSpaceMenuPath>
            </StyledSpaceMenuPanel>
          )}
        </StyledSpaceMenuWrap>
        <StyledNavButton
          type="button"
          aria-label="Previous page"
          title="Previous page"
          disabled={!canGoBack}
          onClick={() => navigateHistory(-1)}
        >
          <PlatformIcon icon={ArrowLeft} size={14} strokeWidth={1.8} />
        </StyledNavButton>
        <StyledNavButton
          type="button"
          aria-label="Next page"
          title="Next page"
          disabled={!canGoForward}
          onClick={() => navigateHistory(1)}
        >
          <PlatformIcon icon={ArrowRight} size={14} strokeWidth={1.8} />
        </StyledNavButton>
        <StyledNavButton
          type="button"
          aria-label="Quick page switcher (⌘K)"
          title="Jump to page (⌘K)"
          onClick={() => setQuickSwitcherOpen(true)}
        >
          <PlatformIcon icon={Search} size={14} strokeWidth={1.8} />
        </StyledNavButton>
        <StyledHeaderSpacer />
        {externalNotice ? (
          <StyledExternalNotice
            role="status"
            title={externalNotice}
          >
            {externalNotice}
          </StyledExternalNotice>
        ) : null}
        <StyledSavedDot
          $saving={saving}
          $error={Boolean(displayError)}
          aria-live="polite"
          title={displayError?.message}
        >
          {saving ? 'Saving…' : displayError ? (saveFailed ? 'Save failed' : 'Needs attention') : 'Saved'}
        </StyledSavedDot>
        {store.organisationId&&<StyledSubtle>Private organisation library</StyledSubtle>}
        {saveFailed && !saving ? (
          <Button
            variant="subtle"
            size="sm"
            title={displayError?.message}
            onClick={() => void saveStore(current => current).catch(() => undefined)}
          >
            Retry save
          </Button>
        ) : null}
        <StyledReviewBadge
          type="button"
          $active={activeView === 'health'}
          aria-label="Wiki health"
          onClick={() =>
            setActiveView(current => (current === 'health' ? 'wiki' : 'health'))
          }
        >
          <PlatformIcon icon={Activity} size={14} strokeWidth={1.8} />
          Health
          {healthFindings.length > 0 && (
            <StyledReviewBadgeCount>{healthFindings.length}</StyledReviewBadgeCount>
          )}
        </StyledReviewBadge>
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
      <StyledSidebar {...compactHide}>
        <StyledSearch>
          <SearchField
            value={query}
            placeholder="Search knowledge"
            onValueChange={setQuery}
            onClear={() => setQuery('')}
          />
          <GuidanceStatusFilter value={statusFilter} onChange={setStatusFilter} />
          {allSpaceTags.length > 0 ? (
            <StyledTagFilterRow aria-label="Filter by tag">
              {(() => {
                const topTags = allSpaceTags.slice(0, 12)
                const shownTags =
                  tagFilter && !topTags.includes(tagFilter)
                    ? [...topTags, tagFilter]
                    : topTags
                return shownTags.map(tag => (
                  <StyledTagChipButton
                    key={tag}
                    type="button"
                    $active={tagFilter === tag}
                    aria-pressed={tagFilter === tag}
                    onClick={() =>
                      setTagFilter(current => (current === tag ? null : tag))
                    }
                  >
                    #{tag}
                    {tagFilter === tag ? (
                      <PlatformIcon icon={X} size={10} strokeWidth={2} />
                    ) : null}
                  </StyledTagChipButton>
                ))
              })()}
            </StyledTagFilterRow>
          ) : null}
          {asked ? <MeaningSearchLine state={meaning.state} onSetUp={meaning.setUp} onRetry={meaning.retry} /> : null}
        </StyledSearch>
        <StyledPageList>
          <StyledTreeHeading>
            <StyledTreeLabel>Pages</StyledTreeLabel>
            <StyledCollapseTreeButton
              type="button"
              aria-label="Collapse all directories"
              title="Collapse all directories"
              disabled={expandedPageIds.size === 0 && !notesExpanded}
              onClick={() => {
                setExpandedPageIds(new Set())
                setNotesExpanded(false)
              }}
            >
              <PlatformIcon icon={ListCollapse} size={15} strokeWidth={1.8} />
            </StyledCollapseTreeButton>
          </StyledTreeHeading>
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
            <StyledExplorerButton
              type="button"
              onClick={() => {
                setNewRootComposer('note')
                setNewRootTitle('')
              }}
            >
              + add note
            </StyledExplorerButton>
          </StyledExplorerActions>
          {newRootComposer ? (
            <StyledSmallComposer onSubmit={addRootPage}>
              <TextField
                autoFocus
                value={newRootTitle}
                placeholder={
                  newRootComposer === 'directory'
                    ? 'New directory'
                    : newRootComposer === 'note'
                      ? 'New note'
                      : 'New page'
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
          {query.trim() || statusFilter !== 'all' || tagFilter !== null ? visiblePages.length ? visiblePages.map(result => (
            <StyledTreeItem key={result.id}>
              <StyledSearchResult type="button" {...agentRefs(result)} aria-current={activePage?.id === result.id ? 'page' : undefined} onClick={() => selectPage(result.id)}>
                <span>{result.title}</span>
                <GuidanceSearchDetails page={result} store={store} />
                {meaningHits?.get(result.id)?.matched === 'meaning' ? (
                  <StyledMeaningMatch>
                    <b>Close in meaning</b> {meaningHits.get(result.id)?.snippet}
                  </StyledMeaningMatch>
                ) : null}
              </StyledSearchResult>
            </StyledTreeItem>
          )) : <StyledSubtle role="status">No pages match{query.trim() ? ` “${query.trim()}”` : ''}{tagFilter ? ` #${tagFilter}` : ''} ({guidanceFilterLabel(statusFilter)}).</StyledSubtle> : <>
          {(() => {
            const rootPage = activeSpace.rootPageId
              ? store.pages.find(
                  page => page.id === activeSpace.rootPageId,
                ) ?? null
              : null
            if (!rootPage) return null
            return (
              <StyledTreeItem key={rootPage.id}>
                <StyledPageRow $depth={0} $active={rootPage.id === activePage?.id} {...agentRefs(rootPage)}>
                  <span aria-hidden="true" />
                  <StyledPageIcon>
                    <PlatformIcon icon={FileText} />
                  </StyledPageIcon>
                  <StyledPageSelect
                    type="button"
                    aria-current={rootPage.id === activePage?.id ? 'page' : undefined}
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
                    {...agentRefs(page)}
                  >
                    {hasChildren ? (
                      <StyledTreeAction
                        type="button"
                        aria-expanded={expanded}
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
                      aria-current={page.id === activePage?.id ? 'page' : undefined}
                      onClick={() => selectPage(page.id)}
                      onDoubleClick={toggleDirectory}
                    >
                      <StyledPageTitle title={page.title}>
                        {pageDisplayTitle(page, activeSpace.rootPageId)}
                      </StyledPageTitle>
                    </StyledPageSelect>
                    <StyledPageMeta className="tree-count">
                      {childCount
                        ? `${childCount}`
                        : extractWikiLinks(page.body).length || ''}
                    </StyledPageMeta>
                    <StyledTreeTools>
                      <MenuButtonDropdown
                        label={`Page actions for ${page.title}`}
                        icon={MoreHorizontal}
                        items={[
                          { id: 'add-page', label: 'Add page', icon: <AddPageIcon /> },
                          { id: 'add-directory', label: 'Add directory', icon: <AddFolderIcon /> },
                          { id: 'edit', label: 'Edit page', icon: <EditIcon /> },
                          ...(page.id === activeSpace.rootPageId ? [] : [
                            { id: 'delete', label: 'Delete page', icon: <TrashIcon />, tone: 'danger' as const },
                          ]),
                        ]}
                        onSelectItem={({ id }) => {
                          if (id === 'add-page') startChildPage(page.id, 'page')
                          else if (id === 'add-directory') startChildPage(page.id, 'directory')
                          else if (id === 'edit') editTreePage(page.id)
                          else if (id === 'delete') deleteTreePage(page)
                        }}
                      />
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
          <StyledNotesSection>
            <StyledTreeHeading>
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
              <StyledExplorerButton
                type="button"
                aria-label="New note"
                onClick={() => {
                  setNewRootComposer('note')
                  setNewRootTitle('')
                }}
              >
                + New note
              </StyledExplorerButton>
            </StyledTreeHeading>
            {notesExpanded || query.trim()
              ? notePages.length
                ? notePages.map(note => (
                    <StyledTreeItem key={note.id}>
                      <StyledPageRow
                        $depth={0}
                        $active={note.id === activePage?.id}
                        {...agentRefs(note)}
                      >
                        <span aria-hidden="true" />
                        <StyledPageIcon>
                          <PlatformIcon icon={StickyNote} />
                        </StyledPageIcon>
                        <StyledPageSelect
                          type="button"
                          aria-current={note.id === activePage?.id ? 'page' : undefined}
                          onClick={() => selectPage(note.id)}
                        >
                          <StyledPageTitle>{note.title}</StyledPageTitle>
                        </StyledPageSelect>
                        <StyledPageMeta className="tree-count" />
                        <StyledTreeTools>
                          <MenuButtonDropdown
                            label={`Note actions for ${note.title}`}
                            icon={MoreHorizontal}
                            items={[
                              { id: 'promote', label: 'Promote to wiki', icon: <AddPageIcon /> },
                              { id: 'edit', label: 'Edit note', icon: <EditIcon /> },
                              { id: 'delete', label: 'Delete note', icon: <TrashIcon />, tone: 'danger' as const },
                            ]}
                            onSelectItem={({ id }) => {
                              if (id === 'promote') promoteTreeNote(note)
                              else if (id === 'edit') editTreePage(note.id)
                              else if (id === 'delete') deleteTreePage(note)
                            }}
                          />
                        </StyledTreeTools>
                      </StyledPageRow>
                    </StyledTreeItem>
                  ))
                : (
                  <StyledSubtle style={{ padding: '4px 16px' }}>
                    No notes yet.
                  </StyledSubtle>
                )
              : null}
          </StyledNotesSection>
          </>}
        </StyledPageList>
      </StyledSidebar>
      {compact ? (
        <CompactPageList
          store={store}
          query={query}
          meaningHits={meaningHits}
          onQueryChange={setQuery}
          onOpenPage={selectPage}
          onCreatePage={createCompactPage}
        />
      ) : null}

      <KnowledgePageEditor
        packagePath={storePath}
        store={store}
        activeSpace={activeSpace}
        page={activePage}
        saving={saving}
        onSelectPage={selectPage}
        onSave={mutate}
        onSaveGuidance={saveStore}
        onDeletePage={deleteTreePage}
        onSelectTag={tag => {
          setActiveView('wiki')
          setTagFilter(current => (current === tag ? null : tag))
        }}
        editRequest={editRequest}
        editToggleNonce={editToggleNonce}
        compact={compact
          ? { onBack: () => setCompactPageOpen(false), status: saving ? 'Saving…' : displayError ? '' : 'Saved' }
          : undefined}
      />
      <QuickPageSwitcher
        open={quickSwitcherOpen}
        store={store}
        onSelectPage={selectPage}
        onClose={() => setQuickSwitcherOpen(false)}
      />
      {deleteCandidate ? (
        <>
          <DeleteDialogStyle />
          <Modal
            open
            onClose={() => setDeleteCandidate(null)}
            title={deleteCandidate.kind === 'note' ? 'Delete note?' : 'Delete page?'}
            size="xs"
            bodyClassName="knowledge-delete-body"
            initialFocusRef={cancelDeleteRef}
          >
            <p>
              {deleteCandidate.kind === 'note' ? (
                <>Delete note <strong>“{deleteCandidate.title}”</strong>?</>
              ) : (
                <>Delete <strong>“{deleteCandidate.title}”</strong> and its child pages?</>
              )}
            </p>
            <p>This cannot be undone.</p>
            <StyledChipRow style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <Button ref={cancelDeleteRef} variant="subtle" onClick={() => setDeleteCandidate(null)}>
                Cancel
              </Button>
              <Button variant="danger" data-pureknowledge-danger onClick={confirmDeletePage}>
                Delete
              </Button>
            </StyledChipRow>
          </Modal>
        </>
      ) : null}
      {activeView === 'health' ? (
        <>
          <StyledReviewOverlayBackdrop
            onClick={() => setActiveView('wiki')}
          />
          <StyledReviewOverlay
            role="dialog"
            aria-label="Wiki health"
          >
            <WikiHealthPanel
              activeSpace={activeSpace}
              findings={healthFindings}
              onJumpToPage={pageId => {
                setActiveView('wiki')
                selectPage(pageId)
              }}
              onCreateMissingPage={createPageFromHealth}
              onClose={() => setActiveView('wiki')}
            />
          </StyledReviewOverlay>
        </>
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
              onRevert={revertAgentChange}
              onClose={() => setActiveView('wiki')}
            />
          </StyledReviewOverlay>
        </>
      ) : null}
    </StyledWorkspace>
  )
}

function canRevertAgentChange(
  change: KnowledgeAgentChange,
  store: KnowledgeStore,
): boolean {
  if (change.status !== 'applied' || !change.pageId) return false
  const page = store.pages.find(candidate => candidate.id === change.pageId)
  if (!page) return false
  if (change.changeType === 'page.create') {
    return !store.spaces.some(space => space.rootPageId === page.id)
  }
  if (change.changeType === 'page.promote') return page.kind === 'wiki'
  if (change.changeType === 'page.update') {
    if (change.before === undefined) return false
    const isGuidanceOnly =
      change.patch.body === undefined &&
      (change.patch.guidanceStatus !== undefined ||
        change.patch.lastChecked !== undefined ||
        change.patch.replacementPageId !== undefined)
    if (isGuidanceOnly) {
      try {
        const parsed: unknown = JSON.parse(change.before)
        return Boolean(parsed && typeof parsed === 'object')
      } catch {
        return false
      }
    }
    return true
  }
  return false
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
  onRevert,
  onClose,
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
  onRevert: (change: KnowledgeAgentChange) => void
  onClose: () => void
}): React.ReactElement {
  const [expandedDiffIds, setExpandedDiffIds] = useState<Set<string>>(
    () => new Set(),
  )
  const toggleDiff = (changeId: string): void => {
    setExpandedDiffIds(current => {
      const next = new Set(current)
      if (next.has(changeId)) next.delete(changeId)
      else next.add(changeId)
      return next
    })
  }
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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <Heading level={1}>Agent log</Heading>
            <StyledSubtle>
              {pendingChanges.length
                ? `${pendingChanges.length} proposed edits waiting for ${activeSpace.name}`
                : changes.length
                  ? `${changes.length} agent changes recorded for ${activeSpace.name}`
                  : `No agent changes recorded for ${activeSpace.name}`}
            </StyledSubtle>
          </div>
          <Button variant="subtle" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
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
                variant="primary" data-pureknowledge-primary
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
              const hasDiff =
                change.before !== undefined ||
                change.after !== undefined ||
                change.patch.body !== undefined
              const diffOpen = expandedDiffIds.has(change.id)
              const revertable = canRevertAgentChange(change, store)
              return (
                <div key={change.id}>
                  <StyledReviewRow>
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
                      {hasDiff ? (
                        <Button
                          variant="subtle"
                          size="sm"
                          style={{ marginTop: 4 }}
                          aria-expanded={diffOpen}
                          onClick={() => toggleDiff(change.id)}
                        >
                          {diffOpen ? 'Hide diff' : 'Show diff'}
                        </Button>
                      ) : null}
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
                          variant="danger" data-pureknowledge-danger
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
                        {revertable ? (
                          <Button
                            variant="subtle"
                            size="sm"
                            disabled={saving}
                            title="Revert this applied change"
                            onClick={() => onRevert(change)}
                          >
                            <PlatformIcon icon={RotateCcw} size={13} strokeWidth={1.8} />
                            Revert
                          </Button>
                        ) : null}
                      </StyledReviewActions>
                    )}
                  </StyledReviewRow>
                  {hasDiff && diffOpen ? (
                    <StyledReviewDiffWrap aria-label={`Diff for ${change.title}`}>
                      <StyledDiffGrid>
                        {change.before !== undefined ? (
                          <StyledDiffBlock $tone="before">
                            <header>Before</header>
                            <pre>{change.before || '(empty)'}</pre>
                          </StyledDiffBlock>
                        ) : null}
                        {(change.after !== undefined || change.patch.body !== undefined) ? (
                          <StyledDiffBlock $tone="after">
                            <header>After</header>
                            <pre>{change.after ?? change.patch.body ?? '(empty)'}</pre>
                          </StyledDiffBlock>
                        ) : null}
                      </StyledDiffGrid>
                    </StyledReviewDiffWrap>
                  ) : null}
                </div>
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

function afterSave(
  result: void | Promise<boolean | void>,
  onSuccess: () => void,
): void {
  if (result && typeof (result as Promise<boolean | void>).then === 'function') {
    void (result as Promise<boolean | void>).then(
      ok => {
        if (ok !== false) onSuccess()
      },
      () => undefined,
    )
  } else {
    onSuccess()
  }
}

/** Only what the person changed in this editor: a field left alone must not write back the version it opened with. */
function ownDraftChanges(
  base: { title: string; body: string; tags: string; aliases: string },
  draft: { titleDraft: string; bodyDraft: string; tagsDraft: string; aliasesDraft: string },
): { title?: string; body?: string; tags?: string[]; aliases?: string[] } {
  return {
    ...(draft.titleDraft !== base.title ? { title: draft.titleDraft } : {}),
    ...(draft.bodyDraft !== base.body ? { body: normalizeWikiLinkEscapes(draft.bodyDraft) } : {}),
    ...(draft.tagsDraft !== base.tags
      ? { tags: draft.tagsDraft.split(',').map(tag => tag.trim()).filter(Boolean) }
      : {}),
    ...(draft.aliasesDraft !== base.aliases
      ? { aliases: draft.aliasesDraft.split(',').map(alias => alias.trim()).filter(Boolean) }
      : {}),
  }
}

function recordKnowledgeEditSession(
  baseline: { title: string; body: string; tags: string; aliases: string } | null,
  titleDraft: string,
  bodyDraft: string,
  tagsDraft: string,
  aliasesDraft = '',
): void {
  if (!baseline) return
  const nextTitle = titleDraft.trim() || baseline.title
  if (nextTitle !== baseline.title) {
    recordUserOperation(
      'page.rename',
      `Renamed page "${baseline.title}" to "${nextTitle}"`,
    )
  }
  if (
    bodyDraft !== baseline.body ||
    tagsDraft !== baseline.tags ||
    aliasesDraft !== baseline.aliases
  ) {
    recordUserOperation('page.update', `Edited page "${nextTitle}"`)
  }
}

interface KnowledgePageEditorProps {
  packagePath: string
  store: KnowledgeStore
  activeSpace: KnowledgeSpace
  page: KnowledgePage | null
  saving: boolean
  onSelectPage: (pageId: string) => void
  onSave: (update: KnowledgeStoreUpdate) => void | Promise<boolean | void>
  onSaveGuidance?: (update: KnowledgeStoreUpdate) => void | Promise<void>
  onDeletePage?: (page: KnowledgePage) => void
  onSelectTag?: (tag: string) => void
  editRequest: { pageId: string; nonce: number } | null
  editToggleNonce?: number
  /** Held inside a page: the way back to the list, and how saving stands. */
  compact?: { onBack: () => void; status: string }
}

/** No page is its own view: the open page can go at any moment, when another window deletes it. */
export function KnowledgePageEditor(props: KnowledgePageEditorProps): React.ReactElement {
  const [keptNote, setKeptNote] = useState('')
  const nextKeptNoteRef = useRef('')

  useEffect(() => {
    if (!props.page && nextKeptNoteRef.current) {
      setKeptNote(nextKeptNoteRef.current)
      nextKeptNoteRef.current = ''
    }
  }, [props.page])

  if (!props.page) {
    const notice = keptNote || nextKeptNoteRef.current
    return (
      <StyledEditorPane {...(props.compact ? { 'data-compact-part': 'page' } : undefined)}>
        {notice ? (
          <p role="status" style={{ padding: '12px 24px 0', margin: 0 }}>
            {notice}
          </p>
        ) : null}
        <EmptyState
          title="Select a page"
          message="Choose a wiki page or note, or create one where it belongs."
        />
      </StyledEditorPane>
    )
  }
  return (
    <OpenPageEditor
      {...props}
      page={props.page}
      keptNote={keptNote}
      setKeptNote={setKeptNote}
      nextKeptNoteRef={nextKeptNoteRef}
    />
  )
}

function OpenPageEditor({
  packagePath,
  store,
  activeSpace,
  page,
  saving,
  onSelectPage,
  onSave,
  onSaveGuidance = (update: KnowledgeStoreUpdate) =>
    Promise.resolve(onSave(update)).then(() => undefined),
  onDeletePage,
  onSelectTag,
  editRequest,
  editToggleNonce = 0,
  compact,
  keptNote,
  setKeptNote,
  nextKeptNoteRef,
}: KnowledgePageEditorProps & {
  page: KnowledgePage
  keptNote: string
  setKeptNote: (note: string) => void
  nextKeptNoteRef: React.MutableRefObject<string>
}): React.ReactElement {
  const compactHide = compact ? { 'data-compact-hide': '' } : undefined
  const compactPart = (part: string) => (compact ? { 'data-compact-part': part } : undefined)
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [aliasesDraft, setAliasesDraft] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkPath, setLinkPath] = useState('')
  const [childTitle, setChildTitle] = useState('')
  const [editing, setEditing] = useState(false)
  const [copiedWikiLink, setCopiedWikiLink] = useState(false)
  const [renameBacklinkOffer, setRenameBacklinkOffer] = useState<{
    oldTitle: string
    newTitle: string
    count: number
  } | null>(null)
  const [galleryError, setGalleryError] = useState('')
  const [galleryRemoveCandidate, setGalleryRemoveCandidate] = useState<{
    galleryIndex: number
    imageIndex: number
    alt: string
  } | null>(null)
  const [expandedImage, setExpandedImage] = useState<{
    src: string
    alt: string
    path: string
  } | null>(null)
  const editorRef = useRef<DocumentEditorHandle>(null)
  const galleryFileInputRef = useRef<HTMLInputElement>(null)
  const galleryImportIndexRef = useRef<number | null>(null)
  const galleryRemoveCancelRef = useRef<HTMLButtonElement>(null)
  const dropSurface = useRef<HTMLDivElement>(null)
  // If this frame cannot show the shell's file URLs, go back to inlining.
  const urlImagesUnavailable = useRef(false)
  // What the drafts started from. Only what differs from it is the person's own: a stale draft is not an edit.
  const draftBase = useRef({ title: '', body: '', tags: '', aliases: '' })
  // Bodies this editor sent to the store: their return is not news from elsewhere.
  const sentBodies = useRef(new Set<string>())
  const noteSent = (body: string): void => {
    sentBodies.current.add(body)
    if (sentBodies.current.size > 40) sentBodies.current.delete(sentBodies.current.values().next().value as string)
  }
  // Bumped when words from elsewhere replace an untouched draft: the open editor starts again from them.
  const [editorVersion, setEditorVersion] = useState(0)
  const [preparedBody, setPreparedBody] = useState<{
    pageId: string
    version: number
    html: string
    imageFailures: Array<{ path: string; message: string }>
  }>({ pageId: '', version: 0, html: '', imageFailures: [] })
  const editorHtml = preparedBody.pageId === page?.id ? preparedBody.html : ''
  const imageFailures =
    preparedBody.pageId === page?.id ? preparedBody.imageFailures : []
  // One shell URL per package file for this session: the token outlives any
  // page view, and asking again for every render would be the old cost back.
  const fileUrls = useRef<{ packagePath: string; urls: Map<string, Promise<string>> }>({ packagePath: '', urls: new Map() })
  const fileUrlFor = useCallback((absolutePath: string): Promise<string> => {
    if (fileUrls.current.packagePath !== packagePath) fileUrls.current = { packagePath, urls: new Map() }
    const { urls } = fileUrls.current
    let url = urls.get(absolutePath)
    if (!url) {
      url = readPlatformFilePreviewUrl(absolutePath).then(result => result.url)
      url.catch(() => urls.delete(absolutePath))
      urls.set(absolutePath, url)
    }
    return url
  }, [packagePath])
  useEffect(() => {
    urlImagesUnavailable.current = false
  }, [packagePath, page?.id])
  useEffect(() => {
    // While editing, the editor holds the page: re-preparing on every
    // keystroke only handed the same document back to it and had it rebuilt.
    if (editing && preparedBody.version === editorVersion) return
    let live = true
    const prepare = urlImagesUnavailable.current
      ? prepareKnowledgeDocumentHtml(bodyDraft, packagePath, readPlatformFileBinary)
      : prepareKnowledgeDocumentHtmlWithUrls(bodyDraft, packagePath, fileUrlFor)
    void prepare.then(result => {
      if (live) setPreparedBody({ pageId: page?.id ?? '', version: editorVersion, ...result })
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyDraft, editing, editorVersion, fileUrlFor, packagePath, page?.id])
  useEffect(() => {
    if (editing || urlImagesUnavailable.current || !editorHtml.includes('src="purescience-fs://')) return
    const first = /src="(purescience-fs:\/\/[^"]+)"/.exec(editorHtml)?.[1]
    if (!first) return
    let live = true
    const probe = new Image()
    probe.onerror = () => {
      urlImagesUnavailable.current = true
      void prepareKnowledgeDocumentHtml(bodyDraft, packagePath, readPlatformFileBinary).then(result => {
        if (live) setPreparedBody({ pageId: page?.id ?? '', version: editorVersion, ...result })
      })
    }
    probe.src = first
    return () => {
      live = false
      probe.onerror = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorHtml, editing])
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
        body = knowledgeHtmlToMarkdown(editor.getHTML(), packagePath)
      } else body = [bodyDraft, knowledgeHtmlToMarkdown(drop.html, packagePath), toMd(reference)].filter(Boolean).join('\n\n')
      body = normalizeWikiLinkEscapes(body)
      const pageId = page.id
      if (latestDraftRef.current.page?.id === pageId) setBodyDraft(body)
      noteSent(body)
      afterSave(
        onSave(current => {
          let next = updateKnowledgePage(current, pageId, { body }, { actor: HUMAN_ACTIVITY_ACTOR })
          const currentPage = current.pages.find(candidate => candidate.id === pageId)
          const currentDuplicate = currentPage?.links.some(link => drop.link.path ? link.path === drop.link.path : drop.link.url ? link.url === drop.link.url : link.title === drop.link.title)
          if (!currentDuplicate) next = addKnowledgeLink(next, pageId, drop.link, { actor: HUMAN_ACTIVITY_ACTOR })
          return next
        }),
        () => recordUserOperation('page.update', 'Added shared content to knowledge page'),
      )
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
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.defaultPrevented || hasOpenModal()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setActivityOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [activityOpen])

  const pageTagsText = page?.tags.join(', ') ?? ''
  const pageAliasesText = (page?.aliases ?? []).join(', ')

  useEffect(() => {
    setTitleDraft(page?.title ?? '')
    setBodyDraft(page?.body ?? '')
    setTagsDraft(page?.tags.join(', ') ?? '')
    setAliasesDraft((page?.aliases ?? []).join(', '))
    draftBase.current = {
      title: page?.title ?? '',
      body: page?.body ?? '',
      tags: page?.tags.join(', ') ?? '',
      aliases: (page?.aliases ?? []).join(', '),
    }
    sentBodies.current.clear()
    setKeptNote(nextKeptNoteRef.current)
    nextKeptNoteRef.current = ''
    setLinkTitle('')
    setLinkPath('')
    setChildTitle('')
    setEditing(false)
    setCopiedWikiLink(false)
    setRenameBacklinkOffer(null)
    setExpandedImage(null)
    setGalleryError('')
    setGalleryRemoveCandidate(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id])

  useEffect(() => {
    if (editing) return
    setTitleDraft(page?.title ?? '')
    setBodyDraft(page?.body ?? '')
    setTagsDraft(page?.tags.join(', ') ?? '')
    setAliasesDraft((page?.aliases ?? []).join(', '))
    draftBase.current = {
      title: page?.title ?? '',
      body: page?.body ?? '',
      tags: page?.tags.join(', ') ?? '',
      aliases: (page?.aliases ?? []).join(', '),
    }
  }, [editing, page?.aliases, page?.body, page?.tags, page?.title])

  // While editing, the page can change under the drafts: another window, an agent, this app's other copy. What was not
  // touched here takes the new version. Words typed here stay and go on being saved, and the other version is kept as a
  // page of its own, so neither is lost and the person is told.
  useEffect(() => {
    if (!editing || !page) return
    const base = draftBase.current
    if (page.title !== base.title) {
      if (titleDraft === base.title) setTitleDraft(page.title)
      base.title = page.title
    }
    if (pageTagsText !== base.tags) {
      if (tagsDraft === base.tags) setTagsDraft(pageTagsText)
      base.tags = pageTagsText
    }
    if (pageAliasesText !== base.aliases) {
      if (aliasesDraft === base.aliases) setAliasesDraft(pageAliasesText)
      base.aliases = pageAliasesText
    }
    if (page.body === base.body) return
    const elsewhere = !sentBodies.current.has(page.body) && page.body !== bodyDraft
    const typedHere = bodyDraft !== base.body
    base.body = page.body
    if (!elsewhere) return
    if (!typedHere) {
      setBodyDraft(page.body)
      setEditorVersion(version => version + 1)
      return
    }
    const theirs = page
    const at = new Date().toISOString()
    void onSave(current => keepKnowledgeVersion(current, theirs, at))
    setKeptNote(`This page changed in another window while you were writing. Your words stay here, and the other version is kept as “${keptPageTitle(theirs.title, at)}”.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, page?.id, page?.body, page?.title, pageTagsText, pageAliasesText])

  const handledEditRequestNonce = useRef<number | null>(null)
  useEffect(() => {
    if (
      !editRequest ||
      handledEditRequestNonce.current === editRequest.nonce ||
      editRequest.pageId !== page?.id ||
      preparedBody.pageId !== page.id
    ) return
    handledEditRequestNonce.current = editRequest.nonce
    setEditing(true)
  }, [editRequest, page?.id, preparedBody.pageId])

  const pageIsDirectory = page ? isKnowledgeDirectoryPage(page) : false
  const baseExtensions = useEditorExtensions({
    placeholder: pageIsDirectory
      ? 'Summarize what exists in this directory. Agents will keep this index current.'
      : 'Write the page. Type /link to link another wiki page.',
  })

  const editorExtensions = useMemo(() => [
    ...baseExtensions.filter(extension => extension.name !== 'image' && extension.name !== 'figure'),
    CollectionImage,
    KnowledgeFigure,
    KnowledgeGallery,
  ], [baseExtensions])

  const latestDraftRef = useRef<{
    page: KnowledgePage | null
    titleDraft: string
    bodyDraft: string
    tagsDraft: string
    aliasesDraft: string
    editing: boolean
  }>({ page: null, titleDraft: '', bodyDraft: '', tagsDraft: '', aliasesDraft: '', editing: false })
  useLayoutEffect(() => {
    latestDraftRef.current = { page, titleDraft, bodyDraft, tagsDraft, aliasesDraft, editing }
  })

  const flushPendingDrafts = useCallback((): void => {
    const latest = latestDraftRef.current
    if (!latest.editing || !latest.page) return
    const patch = ownDraftChanges(draftBase.current, latest)
    if (!Object.keys(patch).length) return
    const editedPage = latest.page
    const at = new Date().toISOString()
    if (patch.body !== undefined) noteSent(patch.body)
    let pageDeletedConcurrently = false
    const saveResult = onSave(current => {
      if (current.pages.some(candidate => candidate.id === editedPage.id)) {
        pageDeletedConcurrently = false
        return updateKnowledgePage(current, editedPage.id, patch, { actor: HUMAN_ACTIVITY_ACTOR })
      }
      pageDeletedConcurrently = true
      return patch.body?.trim()
        ? keepKnowledgeVersion(current, { ...editedPage, body: patch.body }, at)
        : current
    })
    afterSave(saveResult, () => {
      if (pageDeletedConcurrently && patch.body?.trim()) {
        const note = `“${editedPage.title}” was deleted in another window. The words you were typing are kept as “${keptPageTitle(editedPage.title, at)}”.`
        nextKeptNoteRef.current = note
        setKeptNote(note)
        return
      }
      draftBase.current = {
        title: patch.title ?? draftBase.current.title,
        body: patch.body ?? draftBase.current.body,
        tags: patch.tags ? patch.tags.join(', ') : draftBase.current.tags,
        aliases: patch.aliases ? patch.aliases.join(', ') : draftBase.current.aliases,
      }
    })
  }, [nextKeptNoteRef, onSave, setKeptNote])

  useEffect(() => {
    const onBeforeUnload = (): void => {
      flushPendingDrafts()
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flushPendingDrafts()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [flushPendingDrafts])

  useLayoutEffect(() => {
    const pageId = page?.id
    return () => {
      const latest = latestDraftRef.current
      if (!latest.editing || !latest.page || latest.page.id !== pageId) return
      const patch = ownDraftChanges(draftBase.current, latest)
      if (!Object.keys(patch).length) return
      const editedPage = latest.page
      const at = new Date().toISOString()
      // The page can be gone: deleted in another window while these words were being typed. It stays deleted; they stay too.
      if (patch.body !== undefined) {
        nextKeptNoteRef.current = `“${editedPage.title}” was deleted in another window. The words you were typing are kept as “${keptPageTitle(editedPage.title, at)}”.`
      }
      const baselineSnapshot = editBaselineRef.current
      afterSave(
        onSave(current => {
          if (current.pages.some(candidate => candidate.id === editedPage.id)) {
            nextKeptNoteRef.current = ''
            return updateKnowledgePage(current, editedPage.id, patch, { actor: HUMAN_ACTIVITY_ACTOR })
          }
          return patch.body?.trim()
            ? keepKnowledgeVersion(current, { ...editedPage, body: patch.body }, at)
            : current
        }),
        () =>
          recordKnowledgeEditSession(
            baselineSnapshot,
            latest.titleDraft,
            latest.bodyDraft,
            latest.tagsDraft,
            latest.aliasesDraft,
          ),
      )
    }
  }, [nextKeptNoteRef, onSave, page?.id])

  useEffect(() => {
    if (!editing || !page || bodyDraft === page.body || bodyDraft === draftBase.current.body) return
    const pageId = page.id
    const normalizedBody = normalizeWikiLinkEscapes(bodyDraft)
    const timer = window.setTimeout(() => {
      noteSent(normalizedBody)
      void onSave(current => updateKnowledgePage(
        current,
        pageId,
        { body: normalizedBody },
        { actor: HUMAN_ACTIVITY_ACTOR },
      ))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [bodyDraft, editing, onSave, page])

  // One concise ledger entry per editing session, whether it ends with
  // Done or a navigation flush, instead of one per autosave tick.
  const editBaselineRef = useRef<{
    title: string
    body: string
    tags: string
    aliases: string
  } | null>(null)
  useEffect(() => {
    if (editing && page) {
      editBaselineRef.current = {
        title: page.title,
        body: page.body,
        tags: page.tags.join(', '),
        aliases: (page.aliases ?? []).join(', '),
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
  const backlinks = useMemo(
    () => page ? findWikiBacklinks(store, page) : [],
    [store, page],
  )

  const commitPage = useCallback((): void | Promise<boolean | void> => {
    const pageId = page.id
    const patch = ownDraftChanges(draftBase.current, {
      titleDraft,
      bodyDraft,
      tagsDraft,
      aliasesDraft,
    })
    if (patch.body !== undefined) noteSent(patch.body)
    return onSave(current =>
      updateKnowledgePage(current, pageId, patch, { actor: HUMAN_ACTIVITY_ACTOR }),
    )
  }, [aliasesDraft, bodyDraft, onSave, page.id, tagsDraft, titleDraft])

  const finishEditing = useCallback((): void => {
    const baseline = editBaselineRef.current
    const oldTitle = baseline?.title ?? page.title
    const nextTitle = titleDraft.trim() || oldTitle
    if (nextTitle.toLowerCase() !== oldTitle.toLowerCase()) {
      // Count pages whose body links to the old title directly (resilient even if
      // title input onBlur already updated page.title in the store).
      const affectedCount = store.pages.filter(
        candidate =>
          candidate.spaceId === page.spaceId &&
          candidate.id !== page.id &&
          rewriteWikiLinksForRename(candidate.body, oldTitle, nextTitle) !== candidate.body,
      ).length
      if (affectedCount > 0) {
        setRenameBacklinkOffer({
          oldTitle,
          newTitle: nextTitle,
          count: affectedCount,
        })
      }
    }
    const result = commitPage()
    afterSave(result, () =>
      recordKnowledgeEditSession(
        baseline,
        titleDraft,
        bodyDraft,
        tagsDraft,
        aliasesDraft,
      ),
    )
    setEditing(false)
  }, [aliasesDraft, bodyDraft, commitPage, page, store.pages, tagsDraft, titleDraft])

  const handledEditToggleRef = useRef(editToggleNonce)
  useEffect(() => {
    if (editToggleNonce === handledEditToggleRef.current) return
    handledEditToggleRef.current = editToggleNonce
    if (editing) {
      finishEditing()
    } else if (preparedBody.pageId === page.id) {
      setEditing(true)
    }
  }, [editToggleNonce, editing, finishEditing, page.id, preparedBody.pageId])

  const promoteNote = (): void => {
    afterSave(
      onSave(current => {
        const currentPage = current.pages.find(candidate => candidate.id === page.id)
        if (!currentPage) return current
        const rootPageId = current.spaces.find(space => space.id === currentPage.spaceId)?.rootPageId ?? null
        return updateKnowledgePage(
          current,
          currentPage.id,
          { kind: 'wiki', parentId: rootPageId },
          { actor: HUMAN_ACTIVITY_ACTOR },
        )
      }),
      () =>
        recordUserOperation(
          'page.promote',
          `Promoted note "${page.title}" to wiki`,
        ),
    )
  }

  const pendingLink = manualKnowledgeLinkInput(linkTitle, linkPath)
  const addLink = (event: FormEvent): void => {
    event.preventDefault()
    if (!pendingLink) return
    const label = linkTitle.trim() || linkPath.trim()
    const title = page.title
    afterSave(
      onSave(current =>
        addKnowledgeLink(current, page.id, pendingLink, {
          actor: HUMAN_ACTIVITY_ACTOR,
        }),
      ),
      () =>
        recordUserOperation(
          'link.add',
          `Linked "${label}" to page "${title}"`,
        ),
    )
    setLinkTitle('')
    setLinkPath('')
  }

  const removeLink = (link: KnowledgeLink): void => {
    afterSave(
      onSave(current =>
        removeKnowledgeLink(current, page.id, link.id, {
          actor: HUMAN_ACTIVITY_ACTOR,
        }),
      ),
      () =>
        recordUserOperation(
          'link.remove',
          `Removed link "${link.title}" from page "${page.title}"`,
        ),
    )
  }

  const addChildPage = (event: FormEvent): void => {
    event.preventDefault()
    if (!childTitle.trim()) return
    const trimmed = childTitle.trim()
    const parentTitle = page.title
    afterSave(
      onSave(current => {
        const currentPage = current.pages.find(candidate => candidate.id === page.id)
        if (!currentPage) return current
        const rootPageId = current.spaces.find(space => space.id === currentPage.spaceId)?.rootPageId ?? null
        return createKnowledgePage(
          current,
          {
            spaceId: currentPage.spaceId,
            parentId: currentPage.kind === 'wiki' ? currentPage.id : rootPageId,
            kind: 'wiki',
            title: trimmed,
          },
          { actor: HUMAN_ACTIVITY_ACTOR },
        )
      }),
      () =>
        recordUserOperation(
          'page.create',
          `Created page "${trimmed}" under "${parentTitle}"`,
        ),
    )
    setChildTitle('')
  }

  const copyTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = null
      }
    }
  }, [])

  const copyWikiLink = (): void => {
    const linkText = `[[${pageDisplayTitle(page, activeSpace.rootPageId)}]]`
    const done = () => {
      setCopiedWikiLink(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null
        setCopiedWikiLink(false)
      }, 1800)
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(linkText).then(done, () => {
        setGalleryError('Could not copy wikilink to clipboard.')
      })
    } else {
      setGalleryError('Clipboard access is unavailable in this window.')
    }
  }

  const exportPageMarkdown = (): void => {
    const content = `# ${page.title}\n\n${page.body}\n`
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${page.slug || 'page'}.md`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    recordUserOperation('page.export', `Exported "${page.title}" as Markdown`)
  }

  const applyRenameBacklinkStrategy = (strategy: 'update-links' | 'add-alias'): void => {
    if (!renameBacklinkOffer) return
    const { oldTitle, newTitle } = renameBacklinkOffer
    setRenameBacklinkOffer(null)
    afterSave(
      onSave(current =>
        renameKnowledgePageWithBacklinks(
          current,
          page.id,
          oldTitle,
          newTitle,
          strategy,
          { actor: HUMAN_ACTIVITY_ACTOR },
        ),
      ),
      () =>
        recordUserOperation(
          'page.update',
          strategy === 'update-links'
            ? `Updated backlinks from "${oldTitle}" to "${newTitle}"`
            : `Added "${oldTitle}" as alias on "${newTitle}"`,
        ),
    )
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
  const childPages = useMemo(() => {
    if (page.id !== activeSpace.rootPageId) {
      return getChildWikiPages(store, page.id)
    }
    const spaceWikiPages = getWikiPagesForSpace(store, activeSpace.id)
    const spaceWikiIds = new Set(spaceWikiPages.map(candidate => candidate.id))
    return spaceWikiPages
      .filter(
        candidate =>
          candidate.id !== page.id &&
          (candidate.parentId === page.id ||
            candidate.parentId === null ||
            !spaceWikiIds.has(candidate.parentId)),
      )
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [activeSpace.id, activeSpace.rootPageId, page.id, store])
  const openOrCreateWikiLink = (title: string): void => {
    const existing = findPageByWikiTitle(store, page.spaceId, title)
    if (existing) {
      onSelectPage(existing.id)
      return
    }
    const sourceTitle = page.title
    let created = false
    afterSave(
      onSave(current => {
        created = false
        const currentExisting = findPageByWikiTitle(current, page.spaceId, title)
        if (currentExisting) {
          return { ...current, activeSpaceId: currentExisting.spaceId, activePageId: currentExisting.id }
        }
        const currentPage = current.pages.find(candidate => candidate.id === page.id)
        if (!currentPage) return current
        created = true
        const rootPageId = current.spaces.find(space => space.id === currentPage.spaceId)?.rootPageId ?? null
        return createKnowledgePage(
          current,
          {
            spaceId: currentPage.spaceId,
            parentId: currentPage.kind === 'wiki' ? currentPage.id : rootPageId,
            kind: 'wiki',
            title,
          },
          { actor: HUMAN_ACTIVITY_ACTOR },
        )
      }),
      () => {
        if (created) {
          recordUserOperation(
            'page.create',
            `Created page "${title}" from a wikilink on "${sourceTitle}"`,
          )
        }
      },
    )
  }

  const renderWikiLinkMarkdown = (html: string): string =>
    renderWikiLinksInHtml(html, target =>
      Boolean(findPageByWikiTitle(store, page.spaceId, target)),
    )

  // The rendered article is rebuilt only when its content or its links change.
  // Built inline it ran on every render: with images embedded as data URLs that
  // is tens of megabytes of regex and HTML work, and React then reset the whole
  // article — opening or closing the image preview took over a second.
  // Wikilink resolution only depends on page identity metadata, so the article
  // is not rebuilt for every save tick of the store.
  const wikiTitleKey = useMemo(
    () => store.pages.map(candidate => `${candidate.spaceId}\u0000${candidate.title}\u0000${candidate.slug}\u0000${candidate.kind}\u0000${candidate.createdAt}\u0000${(candidate.aliases ?? []).join('\u0001')}`).join('\n'),
    [store.pages],
  )
  const { renderedWikiHtml, outlineHeadings } = useMemo(() => {
    if (editing) return { renderedWikiHtml: '', outlineHeadings: [] }
    const prepared = linkKnowledgeRefs(
      addKnowledgeGalleryControls(
        embedKnowledgeVideos(renderWikiLinkMarkdown(editorHtml)),
      ),
      store.pages,
    )
    const sanitized = sanitizeHtml(prepared, {
      allowTrustedVideoIframes: true,
      allowLocalAssetSvgImg: true,
      allowPreparedFsUrls: true,
    })
    const anchored = addHeadingAnchorsToHtml(sanitized)
    return {
      renderedWikiHtml: anchored.html,
      outlineHeadings: anchored.headings,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorHtml, editing, wikiTitleKey, page?.spaceId])
  // The same object each render too: React rewrites innerHTML whenever this
  // prop object changes, even when the string inside is identical.
  const renderedWikiInnerHtml = useMemo(() => ({ __html: renderedWikiHtml }), [renderedWikiHtml])

  // A table wider than the page gets an Open table button before it, which shows it whole in a dialog. Checked
  // when the page is drawn and whenever the page's width changes.
  const wikiBodyRef = useRef<HTMLDivElement>(null)
  const [expandedTable, setExpandedTable] = useState<string | null>(null)
  const sanitizedExpandedTable = useMemo(
    () =>
      expandedTable !== null
        ? sanitizeHtml(expandedTable, {
            allowLocalAssetSvgImg: true,
            allowPreparedFsUrls: true,
          })
        : null,
    [expandedTable],
  )
  useLayoutEffect(() => {
    const body = wikiBodyRef.current
    if (!body) return
    const mark = (): void => {
      for (const table of Array.from(body.querySelectorAll<HTMLTableElement>(':scope > table'))) {
        const button = table.previousElementSibling instanceof HTMLButtonElement && table.previousElementSibling.dataset.tableOpen !== undefined
          ? table.previousElementSibling
          : null
        const wide = table.scrollWidth > table.clientWidth + 2
        if (wide && !button) {
          const open = document.createElement('button')
          open.type = 'button'
          open.dataset.tableOpen = ''
          open.className = 'knowledge-table-open'
          open.textContent = 'Open table'
          open.title = 'This table is wider than the page: show it whole'
          table.before(open)
        } else if (!wide && button) {
          button.remove()
        }
      }
    }
    mark()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(mark)
    observer.observe(body)
    return () => observer.disconnect()
  }, [renderedWikiHtml])

  const openRenderedImage = (target: EventTarget | null): boolean => {
    const preview = readKnowledgeImagePreview(target)
    if (!preview) return false
    setExpandedImage(preview)
    return true
  }

  const saveGalleryBody = (
    rawBody: string,
    summary: string,
    importedLinks: Array<{ title: string; path: string }> = [],
    expected?: { pageId: string; baseBody: string },
  ): void => {
    const body = normalizeWikiLinkEscapes(rawBody)
    const destinationPageId = expected?.pageId ?? page.id
    if (!expected && body === bodyDraft) return
    const visibleDraft = latestDraftRef.current
    if (
      visibleDraft.page?.id === destinationPageId &&
      (!expected || visibleDraft.bodyDraft === expected.baseBody)
    ) setBodyDraft(body)
    noteSent(body)
    let applied = false
    const saveResult = onSave(current => {
      const destination = current.pages.find(candidate => candidate.id === destinationPageId)
      if (!destination || (expected && destination.body !== expected.baseBody)) {
        return current
      }
      applied = true
      let next = updateKnowledgePage(current, destinationPageId, { body }, { actor: HUMAN_ACTIVITY_ACTOR })
      for (const link of importedLinks) {
        if (!destination.links.some(existing => existing.path === link.path)) {
          next = addKnowledgeLink(next, destinationPageId, { type: 'file', ...link }, { actor: HUMAN_ACTIVITY_ACTOR })
        }
      }
      return next
    })
    if (applied) {
      afterSave(saveResult, () => recordUserOperation('page.update', summary))
    } else {
      setGalleryError('The page changed while images were being added. No gallery changes were saved; try again.')
    }
  }

  const editableGalleryBody = (): string =>
    /^\s*:::gallery\b/m.test(bodyDraft)
      ? bodyDraft
      : knowledgeHtmlToMarkdown(
          upgradeLegacyKnowledgeGalleries(knowledgeMarkdownToHtml(bodyDraft)),
          packagePath,
        )

  const parseGalleryTarget = (value: string | undefined): [number, number] | null => {
    const match = /^(\d+):(\d+)$/.exec(value ?? '')
    return match ? [Number(match[1]), Number(match[2])] : null
  }

  const handleGalleryFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
    input.value = ''
    const targetGallery = galleryImportIndexRef.current
    galleryImportIndexRef.current = null
    if (targetGallery === null || files.length === 0) return
    const destinationPageId = page.id
    const baseBody = bodyDraft
    const galleryBody = editableGalleryBody()
    setGalleryError('')
    try {
      for (const file of files) {
        const supported = /^(image\/(?:png|jpeg|gif|webp|svg\+xml))$/i.test(file.type) || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)
        if (!supported) throw new Error(`“${file.name}” is not a supported image.`)
        if (file.size > 24 * 1024 * 1024) throw new Error(`“${file.name}” exceeds the 24 MB image limit.`)
      }
      const imported = []
      const importedLinks = []
      for (const file of files) {
        const alt = file.name.replace(/\.[^.]+$/, '')
        const saved = await saveKnowledgeImage(packagePath, {
          name: file.name,
          alt,
          bytes: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type || (file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png'),
        })
        imported.push({ alt, src: saved.relativePath })
        importedLinks.push({ title: alt, path: saved.absolutePath })
      }
      saveGalleryBody(
        appendKnowledgeGalleryImages(galleryBody, targetGallery, imported),
        `Added ${imported.length} image${imported.length === 1 ? '' : 's'} to gallery on “${page.title}”`,
        importedLinks,
        { pageId: destinationPageId, baseBody },
      )
    } catch (error) {
      setGalleryError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleRenderedWikiClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (target instanceof Element) {
      const add = target.closest<HTMLButtonElement>('button[data-gallery-add]')
      if (add) {
        event.preventDefault()
        galleryImportIndexRef.current = Number(add.dataset.galleryAdd)
        galleryFileInputRef.current?.click()
        return
      }
      const remove = target.closest<HTMLButtonElement>('button[data-gallery-remove]')
      const removeTarget = parseGalleryTarget(remove?.dataset.galleryRemove)
      if (remove && removeTarget) {
        event.preventDefault()
        setGalleryRemoveCandidate({
          galleryIndex: removeTarget[0],
          imageIndex: removeTarget[1],
          alt: remove.closest('figure')?.querySelector('img')?.getAttribute('alt') || 'this image',
        })
        return
      }
      const download = target.closest<HTMLButtonElement>('button[data-gallery-download]')
      if (download) {
        event.preventDefault()
        const image = download.closest('figure')?.querySelector<HTMLImageElement>('img[src]')
        if (!image) return
        const rawRelativePath = image.getAttribute('data-writer-asset-src')?.trim() || ''
        const safeRelative = rawRelativePath
          ? resolveSafePackageRelativeAssetPath(rawRelativePath, packagePath)
          : null
        if (rawRelativePath && !safeRelative) {
          setGalleryError('Cannot download an image outside this knowledge package.')
          return
        }
        const fileName = safeRelative?.split('/').pop() || `${image.alt || 'image'}.png`
        setGalleryError('')
        if (window.parent === window || !safeRelative) {
          const anchor = document.createElement('a')
          anchor.href = image.currentSrc || image.src
          anchor.download = fileName
          anchor.click()
          recordUserOperation('image.download', `Downloaded “${fileName}” from “${page.title}”`)
        } else {
          const sourcePath = `${packagePath.replace(/\/+$/, '')}/${safeRelative}`
          if (!isAbsolutePathInsidePackage(sourcePath, packagePath)) {
            setGalleryError('Cannot download an image outside this knowledge package.')
            return
          }
          void savePlatformBinaryFileAs(sourcePath, fileName)
            .then(savedPath => {
              if (savedPath) recordUserOperation('image.download', `Downloaded “${fileName}” from “${page.title}”`, { refs: { path: savedPath } })
            })
            .catch(error => setGalleryError(error instanceof Error ? error.message : String(error)))
        }
        return
      }
      const background = target.closest<HTMLButtonElement>('button[data-gallery-background]')
      const backgroundTarget = parseGalleryTarget(background?.dataset.galleryBackground)
      if (background && backgroundTarget) {
        event.preventDefault()
        const figure = background.closest<HTMLElement>('figure')
        const current = (figure?.dataset.galleryBackground ?? 'transparent') as GalleryImageBackground
        const backgrounds: GalleryImageBackground[] = ['transparent', 'light', 'dark', 'checkerboard']
        const next = backgrounds[(backgrounds.indexOf(current) + 1) % backgrounds.length]
        saveGalleryBody(
          setKnowledgeGalleryImageBackground(editableGalleryBody(), backgroundTarget[0], backgroundTarget[1], next),
          `Changed an image background on “${page.title}”`,
        )
        return
      }
    }
    if (openRenderedImage(event.target)) {
      event.preventDefault()
      return
    }
    if (!(target instanceof Element)) return
    const tableOpen = target.closest<HTMLButtonElement>('button[data-table-open]')
    if (tableOpen) {
      event.preventDefault()
      const table = tableOpen.nextElementSibling
      if (table instanceof HTMLTableElement) setExpandedTable(table.outerHTML)
      return
    }
    // Ids and paths in the page are links (lib/knowledgeRefs): a page opens here, a file in its app.
    const pageRef = target.closest<HTMLAnchorElement>('a[data-knowledge-page]')
    if (pageRef) {
      event.preventDefault()
      const id = pageRef.dataset.knowledgePage
      if (id) onSelectPage(id)
      return
    }
    const pathRef = target.closest<HTMLAnchorElement>('a[data-knowledge-path]')
    if (pathRef) {
      event.preventDefault()
      const path = pathRef.dataset.knowledgePath
      if (path) void catalogOpen({ path, name: path.split('/').filter(Boolean).pop() ?? path })
      return
    }
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

  const handleRenderedWikiKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (openRenderedImage(event.target)) event.preventDefault()
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
        ref={wikiBodyRef}
        {...(page ? agentRefs(page) : {})}
        onClick={handleRenderedWikiClick}
        onKeyDown={handleRenderedWikiKeyDown}
        dangerouslySetInnerHTML={renderedWikiInnerHtml}
      />
    )
  }

  return (
    <>
      <StyledGalleryFileInput
        ref={galleryFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg"
        multiple
        aria-label="Add images to gallery"
        onChange={event => void handleGalleryFiles(event)}
      />
      <StyledEditorPane {...compactPart('page')}>
        {compact ? (
          <div className="knowledge-compact-bar">
            <button
              type="button"
              className="knowledge-compact-back"
              onClick={() => {
                if (editing) finishEditing()
                compact.onBack()
              }}
            >
              ← All pages
            </button>
            <span aria-live="polite">{compact.status}</span>
          </div>
        ) : null}
        <StyledEditorBody>
        <StyledMainEditor ref={dropSurface} {...compactPart('scroller')}>
          <StyledWikiSurface data-agent-ref="@open" data-agent-label={pageDisplayTitle(page, activeSpace.rootPageId)} {...compactPart('sheet')}>
            <StyledWikiPageHeader>
              <StyledBreadcrumbLane {...compactHide}>
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
                  {compact && page.id === activeSpace.rootPageId
                    ? activeSpace.name
                    : pageDisplayTitle(page, activeSpace.rootPageId)}
                </StyledReadTitle>
              )}
            </StyledWikiPageHeader>
            <GuidanceDetails key={`guidance-${page.id}`} page={page} store={store} onSave={onSaveGuidance} onSelectPage={onSelectPage} />
            {compact && isPolicy(page) ? (
              <p className="knowledge-compact-note" role="note">
                Policy · {knowledgeStatus(page).replaceAll('-', ' ')}. Edits stay a draft until published in the full app.
              </p>
            ) : null}
            {renameBacklinkOffer ? (
              <StyledNoticeBanner role="status">
                <span>
                  Renamed from <strong>“{renameBacklinkOffer.oldTitle}”</strong> —{' '}
                  {renameBacklinkOffer.count} page{renameBacklinkOffer.count === 1 ? '' : 's'} link to the old title.
                </span>
                <StyledChipRow style={{ marginTop: 0 }}>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => applyRenameBacklinkStrategy('update-links')}
                  >
                    Update wikilinks
                  </Button>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => applyRenameBacklinkStrategy('add-alias')}
                  >
                    Add as alias
                  </Button>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => setRenameBacklinkOffer(null)}
                  >
                    Dismiss
                  </Button>
                </StyledChipRow>
              </StyledNoticeBanner>
            ) : null}
            {keptNote && <p role="status">{keptNote}</p>}
            {dropError && <p role="alert">{dropError}</p>}
            {galleryError && <p role="alert">{galleryError}</p>}
            {imageFailures.length ? (
              <StyledAssetLoadWarning role="alert">
                <strong>
                  {imageFailures.length === 1
                    ? 'One inline image could not be loaded.'
                    : `${imageFailures.length} inline images could not be loaded.`}
                </strong>
                Check that these files still exist inside this knowledge package:
                <ul>
                  {imageFailures.map(failure => (
                    <li key={failure.path} title={failure.message}>
                      <code>{failure.path}</code>
                    </li>
                  ))}
                </ul>
              </StyledAssetLoadWarning>
            ) : null}
            {editing ? (
              <StyledEditPanel>
                <StyledWikiMeta>
                  <span>
                    {pageIsDirectory
                      ? 'Editing directory index'
                      : 'Editing page body'}
                  </span>
                  {compact ? (
                    <StyledEditPageButton variant="subtle" onClick={finishEditing}>
                      Done
                    </StyledEditPageButton>
                  ) : (
                    <Button variant="subtle" onClick={finishEditing}>
                      Done
                    </Button>
                  )}
                </StyledWikiMeta>
                <StyledWikiRule />
                <StyledKnowledgeEditorFrame {...agentRefs(page)} {...compactPart('editor')}>
                  <DocumentEditor
                    key={`${page.id}:${preparedBody.version}`}
                    ref={editorRef}
                    className="knowledge-page-editor"
                    value={editorHtml}
                    extensions={editorExtensions}
                    slashCommands={wikiSlashCommands}
                    inputFormat="html"
                    outputFormat="html"
                    onChange={html => setBodyDraft(knowledgeHtmlToMarkdown(html, packagePath))}
                  />
                </StyledKnowledgeEditorFrame>
              </StyledEditPanel>
            ) : (
              <>
                <StyledWikiMeta>
                  <StyledChipRow>
                    {compact ? null : <Badge tone="neutral">{page.kind}</Badge>}
                    <span>Last edited {formatDate(page.updatedAt)}</span>
                    {compact && page.guidanceStatus ? <span>{guidanceMetadata(page).statusLabel}</span> : null}
                    {page.kind === 'note' && !compact ? (
                      <Button variant="subtle" size="sm" onClick={promoteNote}>
                        Promote to wiki
                      </Button>
                    ) : null}
                  </StyledChipRow>
                  <StyledChipRow>
                    <StyledIconButton
                      {...compactHide}
                      type="button"
                      aria-label="Copy wikilink"
                      title={copiedWikiLink ? 'Copied wikilink' : 'Copy [[wikilink]]'}
                      onClick={copyWikiLink}
                    >
                      <PlatformIcon icon={copiedWikiLink ? Check : Copy} size={14} strokeWidth={1.8} />
                    </StyledIconButton>
                    <StyledIconButton
                      {...compactHide}
                      type="button"
                      aria-label="Export Markdown"
                      title="Export page as .md"
                      onClick={exportPageMarkdown}
                    >
                      <PlatformIcon icon={Download} size={14} strokeWidth={1.8} />
                    </StyledIconButton>
                    {onDeletePage && page.id !== activeSpace.rootPageId ? (
                      <StyledIconButton
                        {...compactHide}
                        type="button"
                        aria-label={page.kind === 'note' ? 'Delete note' : 'Delete page'}
                        title={page.kind === 'note' ? 'Delete note' : 'Delete page'}
                        onClick={() => onDeletePage(page)}
                      >
                        <PlatformIcon icon={Trash2} size={14} strokeWidth={1.8} />
                      </StyledIconButton>
                    ) : null}
                    <StyledActivityWrap ref={activityRef} {...compactHide}>
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
                      disabled={preparedBody.pageId !== page.id}
                      onClick={() => setEditing(true)}
                    >
                      Edit page
                    </StyledEditPageButton>
                  </StyledChipRow>
                </StyledWikiMeta>
                {!compact && (page.tags.length > 0 || (page.aliases?.length ?? 0) > 0) ? (
                  <StyledChipRow {...compactHide} style={{ marginTop: 6 }}>
                    {page.tags.map(tag => (
                      <StyledTagChipButton
                        key={tag}
                        type="button"
                        onClick={() => onSelectTag?.(tag)}
                      >
                        #{tag}
                      </StyledTagChipButton>
                    ))}
                    {page.aliases?.length ? (
                      <StyledContextMeta>
                        Also known as: {page.aliases.join(', ')}
                      </StyledContextMeta>
                    ) : null}
                  </StyledChipRow>
                ) : null}
                <StyledWikiRule />
                {!compact && outlineHeadings.length >= 2 ? (
                  <StyledOutlineNav aria-label="Page outline" {...compactHide}>
                    <details open>
                      <summary>Outline</summary>
                      <ul>
                        {outlineHeadings.map(heading => (
                          <li
                            key={heading.id}
                            style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 12}px` }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                const target = wikiBodyRef.current?.querySelector(
                                  `#${CSS.escape ? CSS.escape(heading.id) : heading.id}`,
                                )
                                target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              }}
                            >
                              {heading.text}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </StyledOutlineNav>
                ) : null}
                {renderWikiText(bodyDraft)}
              </>
            )}

            {page.kind === 'wiki' ? (
              <StyledWikiIndex {...compactHide}>
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

            <PolicyPanel key={`policy-${page.id}`} page={page} editing={editing} onChange={changed=>onSave(current=>{const live=current.pages.find(p=>p.id===page.id);if(JSON.stringify(live)!==JSON.stringify(page))throw Error('This policy changed. Read its current wording before publishing.');return updateKnowledgePage(current,page.id,{governance:changed.governance},{actor:HUMAN_ACTIVITY_ACTOR})})}/>
            {editing ? (
              <StyledPageMetadataPanel {...compactHide}>
                <PagePlacement page={page} store={store} onChange={parentId=>onSave(current=>updateKnowledgePage(current,page.id,{parentId},{actor:HUMAN_ACTIVITY_ACTOR}))}/>
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
                <StyledFieldLabel htmlFor="page-aliases">Aliases</StyledFieldLabel>
                <StyledTagFieldLane>
                  <TextField
                    id="page-aliases"
                    value={aliasesDraft}
                    placeholder="Alternate titles, comma-separated"
                    onChange={event => setAliasesDraft(event.target.value)}
                    onBlur={commitPage}
                  />
                </StyledTagFieldLane>

                <StyledFieldLabel>Linked resources</StyledFieldLabel>
                {page.links.length ? (
                  page.links.map(link => (
                    <KnowledgeLinkRow
                      key={link.id}
                      link={link}
                      onRemove={() => removeLink(link)}
                    />
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
                  <Button
                    variant="subtle"
                    size="sm"
                    type="submit"
                    disabled={!pendingLink}
                    title={
                      linkPath.trim() && !pendingLink
                        ? 'This web address is not valid'
                        : undefined
                    }
                  >
                    Link
                  </Button>
                </StyledQuietForm>
              </StyledPageMetadataPanel>
            ) : page.links.length && !compact ? (
              <>
                <StyledFieldLabel>Linked resources</StyledFieldLabel>
                {page.links.map(link => (
                  <KnowledgeLinkRow
                    key={link.id}
                    link={link}
                    onRemove={() => removeLink(link)}
                  />
                ))}
              </>
            ) : null}
            <StyledPageFooter {...compactHide}>
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
      <Modal
        open={sanitizedExpandedTable !== null}
        onClose={() => setExpandedTable(null)}
        title={page?.title ?? 'Table'}
        size="xl"
        closeOnEscape
        closeOnBackdropClick
      >
        {sanitizedExpandedTable !== null ? (
          <StyledTablePreview
            data-chrome="reading"
            onClick={event => {
              handleRenderedWikiClick(event)
              if (event.target instanceof Element && event.target.closest('a[data-knowledge-page], a[data-wiki-title]')) setExpandedTable(null)
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedExpandedTable }}
          />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(expandedImage)}
        onClose={() => setExpandedImage(null)}
        title={expandedImage?.alt || 'Image preview'}
        size="xl"
        closeOnEscape
        closeOnBackdropClick
      >
        {expandedImage ? (
          <StyledImagePreview>
            <img src={expandedImage.src} alt={expandedImage.alt} />
            {expandedImage.path ? (
              <figcaption>{expandedImage.path}</figcaption>
            ) : null}
          </StyledImagePreview>
        ) : null}
      </Modal>
      {galleryRemoveCandidate ? (
        <>
          <DeleteDialogStyle />
          <Modal
            open
            onClose={() => setGalleryRemoveCandidate(null)}
            title="Remove image from gallery?"
            size="xs"
            bodyClassName="knowledge-delete-body"
            initialFocusRef={galleryRemoveCancelRef}
          >
            <p>
              Remove <strong>“{galleryRemoveCandidate.alt}”</strong> from this gallery?
            </p>
            <p>The asset file will remain available in the knowledge package.</p>
            <StyledChipRow style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <Button
                ref={galleryRemoveCancelRef}
                variant="subtle"
                onClick={() => setGalleryRemoveCandidate(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger" data-pureknowledge-danger
                onClick={() => {
                  saveGalleryBody(
                    removeKnowledgeGalleryImage(
                      editableGalleryBody(),
                      galleryRemoveCandidate.galleryIndex,
                      galleryRemoveCandidate.imageIndex,
                    ),
                    `Removed an image from a gallery on “${page.title}”`,
                  )
                  setGalleryRemoveCandidate(null)
                }}
              >
                Remove
              </Button>
            </StyledChipRow>
          </Modal>
        </>
      ) : null}
    </>
  )

  function selectPageRoot(): void {
    if (activeSpace.rootPageId) {
      onSelectPage(activeSpace.rootPageId)
    }
  }
}

/**
 * How a page is named to the suite's activity layer: an agent's call that reads or changes this page (by id or by
 * slug) is drawn on its row and on its body as it happens (AgentActivityLayer, in AppFrame).
 */
function agentRefs(page: Pick<KnowledgePage, 'id' | 'slug' | 'title'>): { 'data-agent-ref': string; 'data-agent-label': string } {
  return {
    'data-agent-ref': [page.id, page.slug, `page:${page.id}`, `page:${page.slug}`].filter(Boolean).join(' '),
    'data-agent-label': page.title,
  }
}

/** The compact list: every page, most useful first, narrowed by a search. Reads the store and changes nothing itself. */
function CompactPageList({
  store,
  query,
  meaningHits,
  onQueryChange,
  onOpenPage,
  onCreatePage,
}: {
  store: KnowledgeStore
  query: string
  meaningHits?: Map<string, KnowledgeMeaningHit> | null
  onQueryChange: (query: string) => void
  onOpenPage: (pageId: string) => void
  onCreatePage: (title: string) => void
}): React.ReactElement {
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const searching = Boolean(query.trim())
  const rows = useMemo(() => {
    // A space's root page is its index, not something to look up: it shows only when a search finds it.
    const roots = new Set(store.spaces.map(space => space.rootPageId))
    if (searching && meaningHits) {
      return [...meaningHits.values()].map(hit => ({
        page: hit.page,
        text: pageSnippet({ ...hit.page, body: hit.snippet }),
        meaning: hit.matched === 'meaning',
      }))
    }
    return rankKnowledgePages(store, query, store.pages.length, 'all')
      .filter(hit => searching || !roots.has(hit.page.id))
      .map(hit => ({
        page: hit.page,
        text: pageSnippet({ ...hit.page, body: hit.snippet }),
        meaning: false,
      }))
  }, [meaningHits, query, searching, store])

  if (!searching && !rows.length) {
    return (
      <div className="knowledge-compact-list">
        <div className="knowledge-compact-start">
          <p className="knowledge-compact-quiet">No pages here yet.</p>
          {creating ? (
            <form
              className="knowledge-compact-start-action"
              onSubmit={event => {
                event.preventDefault()
                if (!newTitle.trim()) return
                onCreatePage(newTitle)
                setCreating(false)
                setNewTitle('')
              }}
            >
              <TextField
                autoFocus
                aria-label="Page title"
                value={newTitle}
                placeholder="Page title"
                onChange={event => setNewTitle(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') setCreating(false)
                }}
              />
              <StyledEditPageButton variant="subtle" type="submit" disabled={!newTitle.trim()}>Add</StyledEditPageButton>
            </form>
          ) : (
            <div className="knowledge-compact-start-action">
              <StyledEditPageButton variant="subtle" onClick={() => setCreating(true)}>New page</StyledEditPageButton>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="knowledge-compact-list">
      <div className="knowledge-compact-search">
        <SearchField
          aria-label="Search knowledge"
          value={query}
          placeholder="Search knowledge"
          onValueChange={onQueryChange}
          onClear={() => onQueryChange('')}
        />
      </div>
      {rows.length ? (
        <ul className="knowledge-compact-rows">
          {rows.map(({ page, text, meaning: matchedByMeaning }) => {
            const space = store.spaces.find(candidate => candidate.id === page.spaceId)
            const meta = [
              matchedByMeaning ? 'Close in meaning' : '',
              page.kind === 'note' ? 'Note' : '',
              page.guidanceStatus ? guidanceMetadata(page).statusLabel : '',
              store.spaces.length > 1 ? space?.name ?? '' : '',
            ].filter(Boolean).join(' · ')
            return (
              <li key={page.id}>
                <button
                  type="button"
                  className="knowledge-compact-row"
                  {...agentRefs(page)}
                  onClick={() => onOpenPage(page.id)}
                >
                  <span className="knowledge-compact-row-title">
                    {page.id === space?.rootPageId ? space.name : page.title}
                  </span>
                  <span className="knowledge-compact-row-meta">{meta}</span>
                  <span className="knowledge-compact-row-text">{text}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="knowledge-compact-quiet" role="status">No pages match “{query.trim()}”.</p>
      )}
    </div>
  )
}

function KnowledgeLinkRow({
  link,
  onRemove,
}: {
  link: KnowledgeLink
  onRemove?: () => void
}): React.ReactElement {
  const openable = canOpenKnowledgeLink(link)
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
      <StyledChipRow style={{ marginTop: 0 }}>
        <Button
          variant="subtle"
          size="sm"
          onClick={openLink}
          disabled={!openable}
          title={
            openable
              ? undefined
              : 'This link has no file path or valid web address, so it cannot be opened from here'
          }
        >
          Open
        </Button>
        {onRemove ? (
          <Button
            variant="subtle"
            size="sm"
            aria-label={`Remove link ${link.title}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        ) : null}
      </StyledChipRow>
    </StyledLinkRow>
  )
}

export function App(): React.ReactElement {
  const { error: bridgeError, ready, meta } = usePlatformBridge()
  const compact = useCompactInRoom()
  const compactFrame = compact ? { 'data-compact-room': '' } : undefined
  const { boot, bootError, booting, retry } = usePureKnowledgeBoot(ready)
  const { resource: viewportResource, clearResource } =
    usePlatformViewportResource(ready, meta)

  if (bridgeError) {
    return (
      <AppFrame {...compactFrame}>
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
      <AppFrame {...compactFrame}>
        <AppShell>
          <EmptyState
            tone={bootError ? 'error' : 'neutral'}
            title={bootError ? 'Boot failed' : 'pure knowledge'}
            message={message}
            action={bootError ? { label: 'Retry', onClick: retry } : undefined}
          />
        </AppShell>
      </AppFrame>
    )
  }

  return (
    <AppFrame {...compactFrame}>
      <AppShell>
        <KnowledgeWorkspace
          boot={boot}
          resourcePath={viewportResource?.path?.trim() || null}
          onResourceHandled={clearResource}
          compact={compact}
        />
      </AppShell>
    </AppFrame>
  )
}
