import { CompositionThumbnail, VideoThumbnail, type TimelineElement } from '@hyperframes/studio'
import { useCallback, type ReactNode } from 'react'
import { AudioWaveform } from './AudioWaveform'

interface UseTinyfilmRenderClipContentOptions {
  projectId: string | null
  compIdToSrc: Map<string, string>
  activePreviewUrl?: string | null
  effectiveTimelineDuration?: number
}

export function useTinyfilmRenderClipContent({
  projectId,
  compIdToSrc,
  activePreviewUrl = null,
  effectiveTimelineDuration = 0
}: UseTinyfilmRenderClipContentOptions): (
  element: TimelineElement,
  style: { clip: string; label: string }
) => ReactNode {
  return useCallback(
    (element: TimelineElement, style: { clip: string; label: string }): ReactNode => {
      if (!projectId) return null

      let compSrc = element.compositionSrc
      if (compSrc && compIdToSrc.size > 0) {
        const resolved =
          compIdToSrc.get(element.id) ||
          compIdToSrc.get(compSrc.replace(/^compositions\//, '').replace(/\.html$/, ''))
        if (resolved) compSrc = resolved
      }

      if (compSrc) {
        return (
          <CompositionThumbnail
            previewUrl={`/api/projects/${projectId}/preview/comp/${compSrc}`}
            label={getTimelineElementLabel(element)}
            labelColor={style.label}
            accentColor={style.clip}
            seekTime={0}
            duration={element.duration}
          />
        )
      }

      if (activePreviewUrl && element.duration > 0) {
        return (
          <CompositionThumbnail
            previewUrl={activePreviewUrl}
            label={getTimelineElementLabel(element)}
            labelColor={style.label}
            accentColor={style.clip}
            selector={element.selector}
            selectorIndex={element.selectorIndex}
            seekTime={element.start}
            duration={element.duration}
          />
        )
      }

      if (element.tag === 'audio') {
        const previewBase = `/api/projects/${projectId}/preview/`
        const previewIdx = element.src?.startsWith('http') ? element.src.indexOf(previewBase) : -1
        const srcRelative = element.src
          ? previewIdx !== -1
            ? decodeURIComponent(element.src.slice(previewIdx + previewBase.length))
            : element.src.startsWith('http')
              ? null
              : element.src
          : null
        const audioUrl = srcRelative
          ? `/api/projects/${projectId}/preview/${srcRelative}`
          : (element.src ?? '')
        const waveformUrl = srcRelative
          ? `/api/projects/${projectId}/waveform/${srcRelative}`
          : undefined

        return (
          <AudioWaveform
            audioUrl={audioUrl}
            waveformUrl={waveformUrl}
            label={getTimelineElementLabel(element)}
            labelColor={style.label}
          />
        )
      }

      if ((element.tag === 'video' || element.tag === 'img') && element.src) {
        const mediaSrc = element.src.startsWith('http')
          ? element.src
          : `/api/projects/${projectId}/preview/${element.src}`

        return (
          <VideoThumbnail
            videoSrc={mediaSrc}
            label={getTimelineElementLabel(element)}
            labelColor={style.label}
            duration={element.duration}
          />
        )
      }

      const htmlPreviewEligible =
        element.duration > 0 &&
        effectiveTimelineDuration > 0 &&
        element.duration < effectiveTimelineDuration * 0.92 &&
        !/(backdrop|background|overlay|scrim|mask)/i.test(element.id)

      if (htmlPreviewEligible) {
        return (
          <CompositionThumbnail
            previewUrl={`/api/projects/${projectId}/preview`}
            label={getTimelineElementLabel(element)}
            labelColor={style.label}
            accentColor={style.clip}
            selector={element.selector}
            selectorIndex={element.selectorIndex}
            seekTime={element.start}
            duration={element.duration}
          />
        )
      }

      return null
    },
    [activePreviewUrl, compIdToSrc, effectiveTimelineDuration, projectId]
  )
}

function getTimelineElementLabel(element: TimelineElement): string {
  return element.label || element.id || element.tag
}
