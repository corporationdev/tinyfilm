import { useQuery } from '@tanstack/react-query'
import { NLELayout } from '@hyperframes/studio'
import { ArrowLeft, CheckCircle2, Download, Loader2, Redo2, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AgentPanel } from '../components/agent/AgentPanel'
import { ErrorBanner } from '../components/common/ErrorBanner'
import { Button } from '../components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable'
import { useTinyfilmRenderClipContent } from '../hyperframes/useTinyfilmRenderClipContent'
import { useTinyfilmTimelineEditing } from '../hyperframes/useTinyfilmTimelineEditing'
import { orpc } from '../lib/orpc'

export function ProjectDetailPage(props: {
  projectId: string
  selectedSessionId?: string
  onBack: () => void
  onSelectChat: (sessionId: string | undefined) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [exportState, setExportState] = useState<{
    status: 'idle' | 'rendering' | 'complete' | 'failed'
    progress: number
    stage: string | null
    outputPath: string | null
    error: string | null
  }>({
    status: 'idle',
    progress: 0,
    stage: null,
    outputPath: null,
    error: null
  })
  const exportEventSourceRef = useRef<EventSource | null>(null)
  const [previewState, setPreviewState] = useState(() => ({
    projectId: props.projectId,
    version: 0
  }))
  const [compIdToSrc, setCompIdToSrc] = useState(() => new Map<string, string>())
  const projectQuery = useQuery(
    orpc.projects.get.queryOptions({
      input: { id: props.projectId }
    })
  )
  const previewQuery = useQuery(
    orpc.projects.startPreview.queryOptions({
      input: { id: props.projectId },
      enabled: Boolean(projectQuery.data)
    })
  )

  const project = projectQuery.data
  const previewVersion = previewState.projectId === props.projectId ? previewState.version : 0
  const activeError = projectQuery.error ?? previewQuery.error
  const bumpPreviewVersion = useCallback(() => {
    setPreviewState((state) => ({
      projectId: props.projectId,
      version: (state.projectId === props.projectId ? state.version : 0) + 1
    }))
  }, [props.projectId])
  const renderClipContent = useTinyfilmRenderClipContent({
    projectId: project?.id ?? null,
    compIdToSrc,
    effectiveTimelineDuration: project?.durationMs ? project.durationMs / 1000 : 0
  })
  const timelineEditing = useTinyfilmTimelineEditing({
    projectId: project?.id ?? null,
    onEdited: bumpPreviewVersion
  })
  const handleExport = useCallback(async () => {
    if (!project || exportState.status === 'rendering') {
      return
    }

    exportEventSourceRef.current?.close()
    setExportState({
      status: 'rendering',
      progress: 0,
      stage: 'Starting export',
      outputPath: null,
      error: null
    })

    try {
      const response = await fetch(`/api/projects/${project.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fps: project.fps,
          quality: 'standard',
          format: 'mp4'
        })
      })

      if (!response.ok) {
        throw new Error(`Export failed to start (${response.status})`)
      }

      const payload = (await response.json()) as { jobId?: string }
      if (!payload.jobId) {
        throw new Error('Export failed to start: missing render job id')
      }

      const outputPath = renderOutputPath(project.rootPath, `${payload.jobId}.mp4`)
      const events = new EventSource(`/api/render/${payload.jobId}/progress`)
      exportEventSourceRef.current = events

      events.addEventListener('progress', (event) => {
        const data = JSON.parse(event.data) as {
          status?: 'rendering' | 'complete' | 'failed'
          progress?: number
          stage?: string
          error?: string
        }
        const nextStatus =
          data.status === 'complete' || data.status === 'failed' ? data.status : 'rendering'

        setExportState({
          status: nextStatus,
          progress: data.progress ?? 0,
          stage: data.stage ?? null,
          outputPath: nextStatus === 'complete' ? outputPath : null,
          error: data.error ?? null
        })

        if (nextStatus === 'complete' || nextStatus === 'failed') {
          events.close()
          exportEventSourceRef.current = null
        }
      })

      events.onerror = () => {
        events.close()
        exportEventSourceRef.current = null
        setExportState((state) => ({
          ...state,
          status: 'failed',
          error: 'Lost connection to the HyperFrames render job.'
        }))
      }
    } catch (error) {
      setExportState({
        status: 'failed',
        progress: 0,
        stage: null,
        outputPath: null,
        error: error instanceof Error ? error.message : 'Export failed'
      })
    }
  }, [exportState.status, project])

  useEffect(() => {
    return window.api.onPreviewChanged((event) => {
      if (event.projectId !== props.projectId) {
        return
      }

      setPreviewState({
        projectId: event.projectId,
        version: event.version
      })
    })
  }, [props.projectId])

  useEffect(() => {
    return () => {
      exportEventSourceRef.current?.close()
      exportEventSourceRef.current = null
    }
  }, [])

  return (
    <main className="flex h-svh flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button size="icon" title="Back to projects" variant="ghost" onClick={props.onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-500">Project</p>
            <h1 className="truncate text-lg font-semibold tracking-normal">
              {project?.title ?? 'Loading...'}
            </h1>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {exportState.status !== 'idle' ? (
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-xs font-medium text-zinc-400">
                {exportState.status === 'rendering'
                  ? `Exporting ${Math.round(exportState.progress)}%`
                  : exportState.status === 'complete'
                    ? 'Export complete'
                    : 'Export failed'}
              </p>
              <p className="max-w-72 truncate text-xs text-zinc-600">
                {exportState.error ?? exportState.stage ?? exportState.outputPath}
              </p>
            </div>
          ) : null}
          {exportState.outputPath ? (
            <Button
              title="Reveal exported video in Finder"
              variant="secondary"
              onClick={() => {
                if (!exportState.outputPath) return
                void window.api.revealInFolder(exportState.outputPath)
              }}
            >
              <CheckCircle2 className="size-4" />
              Reveal
            </Button>
          ) : (
            <Button
              title="Export with HyperFrames"
              disabled={!project || exportState.status === 'rendering'}
              onClick={() => {
                void handleExport()
              }}
            >
              {exportState.status === 'rendering' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              Export
            </Button>
          )}
        </div>
      </header>

      {activeError ? <ErrorBanner error={activeError} /> : null}

      <section className="min-h-0 flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel className="min-h-0" defaultSize="520px" minSize="440px" maxSize="65%">
            <aside className="flex h-full min-h-0 flex-col overflow-hidden">
              <AgentPanel
                projectId={props.projectId}
                selectedSessionId={props.selectedSessionId}
                onSelectChat={props.onSelectChat}
                onRunCompleted={bumpPreviewVersion}
                onOpenSettings={props.onOpenSettings}
              />
            </aside>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel className="min-w-0 min-h-0" minSize="420px">
            <section className="flex h-full min-w-0 min-h-0 flex-col overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden [&>*]:h-full [&>*]:w-full">
                {previewQuery.data && project ? (
                  <NLELayout
                    key={`${project.id}:${previewVersion}`}
                    projectId={project.id}
                    portrait={project.height >= project.width}
                    refreshKey={previewVersion}
                    renderClipContent={renderClipContent}
                    onCompIdToSrcChange={setCompIdToSrc}
                    onMoveElement={timelineEditing.handleTimelineElementMove}
                    onResizeElement={timelineEditing.handleTimelineElementResize}
                    onDeleteElement={timelineEditing.handleTimelineElementDelete}
                    timelineToolbar={
                      <div className="flex h-10 items-center justify-between px-3">
                        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
                          Timeline
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon-xs"
                            title={
                              timelineEditing.undoLabel
                                ? `Undo ${timelineEditing.undoLabel}`
                                : 'Undo'
                            }
                            variant="ghost"
                            disabled={!timelineEditing.canUndo}
                            onClick={() => {
                              void timelineEditing.handleUndo()
                            }}
                          >
                            <Undo2 className="size-3.5" />
                          </Button>
                          <Button
                            size="icon-xs"
                            title={
                              timelineEditing.redoLabel
                                ? `Redo ${timelineEditing.redoLabel}`
                                : 'Redo'
                            }
                            variant="ghost"
                            disabled={!timelineEditing.canRedo}
                            onClick={() => {
                              void timelineEditing.handleRedo()
                            }}
                          >
                            <Redo2 className="size-3.5" />
                          </Button>
                          <Button
                            size="icon-xs"
                            title="Delete selected clip"
                            variant="ghost"
                            disabled={!timelineEditing.selectedElement}
                            onClick={() => {
                              if (!timelineEditing.selectedElement) return
                              void timelineEditing.handleTimelineElementDelete(
                                timelineEditing.selectedElement
                              )
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    }
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center bg-zinc-950 text-center">
                    <div className="px-8">
                      <Loader2 className="mx-auto mb-4 size-10 animate-spin text-zinc-700" />
                      <h2 className="text-sm font-medium text-zinc-300">Loading preview</h2>
                      <p className="mt-2 text-sm text-zinc-500">
                        Tinyfilm is starting the HyperFrames Studio preview for this project.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </section>
    </main>
  )
}

function renderOutputPath(projectRootPath: string, filename: string): string {
  return `${projectRootPath.replace(/\/$/, '')}/renders/${filename}`
}
