declare module '@hyperframes/studio' {
  import type { ComponentType, ReactNode, Ref } from 'react'

  export interface TimelineElement {
    id: string
    key?: string
    tag: string
    type?: string
    label?: string
    domId?: string
    selector?: string
    selectorIndex?: number
    sourceFile?: string
    src?: string
    start: number
    duration: number
    track: number
    playbackStart?: number
    playbackStartAttr?: string
    playbackRate?: number
    compositionSrc?: string
  }

  export interface VideoThumbnailProps {
    videoSrc: string
    label: string
    labelColor: string
    duration?: number
  }

  export interface CompositionThumbnailProps {
    previewUrl: string
    label: string
    labelColor: string
    accentColor?: string
    selector?: string
    selectorIndex?: number
    seekTime?: number
    duration?: number
  }

  export interface NLELayoutProps {
    projectId: string
    refreshKey?: number | string
    portrait?: boolean
    activeCompositionPath?: string | null
    timelineToolbar?: ReactNode
    timelineFooter?: ReactNode
    timelineVisible?: boolean
    previewOverlay?: ReactNode
    renderClipContent?: (
      element: TimelineElement,
      style: { clip: string; label: string }
    ) => ReactNode
    onDeleteElement?: (element: TimelineElement) => Promise<void> | void
    onAssetDrop?: (
      assetPath: string,
      placement: Pick<TimelineElement, 'start' | 'track'>
    ) => Promise<void> | void
    onFileDrop?: (
      files: File[],
      placement?: Pick<TimelineElement, 'start' | 'track'>
    ) => Promise<void> | void
    onMoveElement?: (
      element: TimelineElement,
      updates: Pick<TimelineElement, 'start' | 'track'>
    ) => Promise<void> | void
    onResizeElement?: (
      element: TimelineElement,
      updates: Pick<TimelineElement, 'start' | 'duration' | 'playbackStart'>
    ) => Promise<void> | void
    onBlockedEditAttempt?: (element: TimelineElement, intent: string) => void
    onSelectTimelineElement?: (element: TimelineElement | null) => void
    onCompIdToSrcChange?: (map: Map<string, string>) => void
    onCompositionLoadingChange?: (loading: boolean) => void
    onCompositionChange?: (compositionPath: string | null) => void
    onIframeRef?: (node: HTMLIFrameElement | null) => void | Ref<HTMLIFrameElement>
    onToggleTimeline?: () => void
  }

  export const NLELayout: ComponentType<NLELayoutProps>
  export const VideoThumbnail: ComponentType<VideoThumbnailProps>
  export const CompositionThumbnail: ComponentType<CompositionThumbnailProps>
  export const usePlayerStore: {
    <T>(selector: (state: PlayerState) => T): T
    getState: () => PlayerState
  }

  export interface PlayerState {
    elements: TimelineElement[]
    selectedElementId: string | null
    setElements: (elements: TimelineElement[]) => void
    setSelectedElementId: (id: string | null) => void
  }
}
