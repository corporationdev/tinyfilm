import { usePlayerStore, type TimelineElement } from '@hyperframes/studio'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  applyPatchByTarget,
  buildPatchTarget,
  buildTrackZIndexMap,
  formatTimelineAttributeNumber,
  readAttributeByTarget,
  sourcePathForElement
} from './timelineSourcePatcher'
import { usePersistentEditHistory } from './usePersistentEditHistory'

interface UseTinyfilmTimelineEditingOptions {
  projectId: string | null
  activeCompPath?: string | null
  onEdited?: () => void
}

export function useTinyfilmTimelineEditing({
  projectId,
  activeCompPath = null,
  onEdited
}: UseTinyfilmTimelineEditingOptions): {
  selectedElement: TimelineElement | null
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  handleTimelineElementMove: (
    element: TimelineElement,
    updates: Pick<TimelineElement, 'start' | 'track'>
  ) => Promise<void>
  handleTimelineElementResize: (
    element: TimelineElement,
    updates: Pick<TimelineElement, 'start' | 'duration' | 'playbackStart'>
  ) => Promise<void>
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void>
  handleUndo: () => Promise<void>
  handleRedo: () => Promise<void>
} {
  const elements = usePlayerStore((state) => state.elements)
  const selectedElementId = usePlayerStore((state) => state.selectedElementId)
  const setElements = usePlayerStore((state) => state.setElements)
  const setSelectedElementId = usePlayerStore((state) => state.setSelectedElementId)
  const elementsRef = useRef(elements)
  const editHistory = usePersistentEditHistory({ projectId })

  useEffect(() => {
    elementsRef.current = elements
  }, [elements])

  const selectedElement = useMemo(
    () => elements.find((element) => (element.key ?? element.id) === selectedElementId) ?? null,
    [elements, selectedElementId]
  )

  const readProjectFile = useCallback(
    async (path: string): Promise<string> => {
      if (!projectId) throw new Error('No active project')
      const response = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`)
      if (!response.ok) throw new Error(`Failed to read ${path}`)
      const data = (await response.json()) as { content?: string }
      if (typeof data.content !== 'string') throw new Error(`Missing file contents for ${path}`)
      return data.content
    },
    [projectId]
  )

  const writeProjectFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      if (!projectId) throw new Error('No active project')
      const response = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: content
      })
      if (!response.ok) throw new Error(`Failed to write ${path}`)
      onEdited?.()
    },
    [onEdited, projectId]
  )

  const saveProjectFileWithHistory = useCallback(
    async (label: string, path: string, before: string, after: string): Promise<void> => {
      if (before === after) return
      await writeProjectFile(path, after)
      await editHistory.recordEdit({
        label,
        kind: 'timeline',
        files: { [path]: { before, after } }
      })
    },
    [editHistory, writeProjectFile]
  )

  const handleUndo = useCallback(async (): Promise<void> => {
    const result = await editHistory.undo({
      readFile: readProjectFile,
      writeFile: writeProjectFile
    })
    if (!result.ok && result.reason === 'content-mismatch') {
      console.warn('[Timeline] Undo skipped because project files changed outside edit history')
      return
    }
    if (result.ok) setSelectedElementId(null)
  }, [editHistory, readProjectFile, setSelectedElementId, writeProjectFile])

  const handleRedo = useCallback(async (): Promise<void> => {
    const result = await editHistory.redo({
      readFile: readProjectFile,
      writeFile: writeProjectFile
    })
    if (!result.ok && result.reason === 'content-mismatch') {
      console.warn('[Timeline] Redo skipped because project files changed outside edit history')
      return
    }
    if (result.ok) setSelectedElementId(null)
  }, [editHistory, readProjectFile, setSelectedElementId, writeProjectFile])

  const handleTimelineElementMove = useCallback(
    async (element: TimelineElement, updates: Pick<TimelineElement, 'start' | 'track'>) => {
      const targetPath = sourcePathForElement(element, activeCompPath)
      const originalContent = await readProjectFile(targetPath)
      const patchTarget = buildPatchTarget(element)
      if (!patchTarget) throw new Error(`Timeline element ${element.id} is missing an edit target`)

      const relevantElements = elementsRef.current
        .map((timelineElement) =>
          (timelineElement.key ?? timelineElement.id) === (element.key ?? element.id)
            ? { ...timelineElement, start: updates.start, track: updates.track }
            : timelineElement
        )
        .filter(
          (timelineElement) => sourcePathForElement(timelineElement, activeCompPath) === targetPath
        )
      const trackZIndices = buildTrackZIndexMap(
        relevantElements.map((timelineElement) => timelineElement.track)
      )

      let patchedContent = applyPatchByTarget(originalContent, patchTarget, {
        type: 'attribute',
        property: 'start',
        value: formatTimelineAttributeNumber(updates.start)
      })
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: 'attribute',
        property: 'track-index',
        value: String(updates.track)
      })

      for (const timelineElement of relevantElements) {
        const elementTarget = buildPatchTarget(timelineElement)
        if (!elementTarget) continue
        const nextZIndex = trackZIndices.get(timelineElement.track)
        if (nextZIndex == null) continue
        patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
          type: 'inline-style',
          property: 'z-index',
          value: String(nextZIndex)
        })
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`)
      }
      await saveProjectFileWithHistory(
        'Move timeline clip',
        targetPath,
        originalContent,
        patchedContent
      )
    },
    [activeCompPath, readProjectFile, saveProjectFileWithHistory]
  )

  const handleTimelineElementResize = useCallback(
    async (
      element: TimelineElement,
      updates: Pick<TimelineElement, 'start' | 'duration' | 'playbackStart'>
    ) => {
      const targetPath = sourcePathForElement(element, activeCompPath)
      const originalContent = await readProjectFile(targetPath)
      const patchTarget = buildPatchTarget(element)
      if (!patchTarget) throw new Error(`Timeline element ${element.id} is missing an edit target`)

      const playbackStartAttrName =
        element.playbackStartAttr === 'playback-start' ? 'playback-start' : 'media-start'
      const currentPlaybackStartValue =
        readAttributeByTarget(originalContent, patchTarget, 'playback-start') ??
        readAttributeByTarget(originalContent, patchTarget, 'media-start')
      const currentPlaybackStart =
        currentPlaybackStartValue != null ? parseFloat(currentPlaybackStartValue) : undefined
      const trimDelta = updates.start - element.start
      const fallbackPlaybackStart =
        updates.playbackStart == null &&
        trimDelta !== 0 &&
        Number.isFinite(currentPlaybackStart) &&
        currentPlaybackStart != null
          ? Math.max(0, currentPlaybackStart + trimDelta * Math.max(element.playbackRate ?? 1, 0.1))
          : undefined
      const nextPlaybackStart = updates.playbackStart ?? fallbackPlaybackStart

      let patchedContent = applyPatchByTarget(originalContent, patchTarget, {
        type: 'attribute',
        property: 'start',
        value: formatTimelineAttributeNumber(updates.start)
      })
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: 'attribute',
        property: 'duration',
        value: formatTimelineAttributeNumber(updates.duration)
      })
      if (nextPlaybackStart != null) {
        patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
          type: 'attribute',
          property: playbackStartAttrName,
          value: formatTimelineAttributeNumber(nextPlaybackStart)
        })
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`)
      }
      await saveProjectFileWithHistory(
        'Resize timeline clip',
        targetPath,
        originalContent,
        patchedContent
      )
    },
    [activeCompPath, readProjectFile, saveProjectFileWithHistory]
  )

  const handleTimelineElementDelete = useCallback(
    async (element: TimelineElement) => {
      if (!projectId) throw new Error('No active project')
      const targetPath = sourcePathForElement(element, activeCompPath)
      const patchTarget = buildPatchTarget(element)
      if (!patchTarget) throw new Error(`Timeline element ${element.id} is missing an edit target`)
      const originalContent = await readProjectFile(targetPath)

      const response = await fetch(
        `/api/projects/${projectId}/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: patchTarget })
        }
      )
      if (!response.ok) throw new Error(`Failed to delete ${element.id} from ${targetPath}`)
      const data = (await response.json()) as { content?: string }
      const afterContent =
        typeof data.content === 'string' ? data.content : await readProjectFile(targetPath)

      setElements(
        elementsRef.current.filter(
          (timelineElement) =>
            (timelineElement.key ?? timelineElement.id) !== (element.key ?? element.id)
        )
      )
      setSelectedElementId(null)
      await editHistory.recordEdit({
        label: 'Delete timeline clip',
        kind: 'timeline',
        files: { [targetPath]: { before: originalContent, after: afterContent } }
      })
      onEdited?.()
    },
    [
      activeCompPath,
      editHistory,
      onEdited,
      projectId,
      readProjectFile,
      setElements,
      setSelectedElementId
    ]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && !shouldIgnoreEditHistoryKey(event.target)) {
        const key = event.key.toLowerCase()
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault()
          void handleUndo().catch((error) => {
            console.error('[Timeline] Failed to undo edit', error)
          })
          return
        }
        if ((key === 'z' && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === 'y')) {
          event.preventDefault()
          void handleRedo().catch((error) => {
            console.error('[Timeline] Failed to redo edit', error)
          })
          return
        }
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (!selectedElement) return
      if (shouldIgnoreDeleteKey(event.target)) return

      event.preventDefault()
      void handleTimelineElementDelete(selectedElement).catch((error) => {
        console.error('[Timeline] Failed to delete clip', error)
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleRedo, handleTimelineElementDelete, handleUndo, selectedElement])

  return {
    selectedElement,
    canUndo: editHistory.canUndo,
    canRedo: editHistory.canRedo,
    undoLabel: editHistory.undoLabel,
    redoLabel: editHistory.redoLabel,
    handleTimelineElementMove,
    handleTimelineElementResize,
    handleTimelineElementDelete,
    handleUndo,
    handleRedo
  }
}

function shouldIgnoreDeleteKey(target: EventTarget | null): boolean {
  return shouldIgnoreEditHistoryKey(target)
}

function shouldIgnoreEditHistoryKey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")
  )
}
