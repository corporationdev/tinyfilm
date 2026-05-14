import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileVideo, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgentPanel } from '../components/agent/AgentPanel'
import { ErrorBanner } from '../components/common/ErrorBanner'
import { Button } from '../components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable'
import { orpc } from '../lib/orpc'

export function ProjectDetailPage(props: {
  projectId: string
  selectedSessionId?: string
  onBack: () => void
  onSelectChat: (sessionId: string | undefined) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [previewState, setPreviewState] = useState(() => ({
    projectId: props.projectId,
    version: 0
  }))
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
  const previewSrcdocQuery = useQuery({
    queryKey: ['project-preview-srcdoc', previewQuery.data?.url, previewVersion],
    queryFn: async () => {
      if (!previewQuery.data?.url) {
        throw new Error('Preview URL is missing')
      }

      const response = await fetch(withPreviewVersion(previewQuery.data.url, previewVersion), {
        cache: 'no-store'
      })

      if (!response.ok) {
        throw new Error('Preview HTML failed to load')
      }

      return withBaseElement(await response.text(), previewQuery.data.url)
    },
    enabled: Boolean(previewQuery.data?.url)
  })
  const activeError = projectQuery.error ?? previewQuery.error

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
                onRunCompleted={() => {
                  setPreviewState((state) => ({
                    projectId: props.projectId,
                    version: (state.projectId === props.projectId ? state.version : 0) + 1
                  }))
                }}
                onOpenSettings={props.onOpenSettings}
              />
            </aside>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel className="min-h-0" minSize="420px">
            <section className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="flex flex-1 items-center justify-center overflow-hidden">
                {previewSrcdocQuery.data && project ? (
                  <hyperframes-player
                    className="block aspect-[9/16] max-h-[76vh] w-full max-w-md overflow-hidden rounded bg-black"
                    controls
                    height={project.height}
                    key={`${project.id}:${previewVersion}`}
                    muted
                    srcdoc={previewSrcdocQuery.data}
                    width={project.width}
                  />
                ) : (
                  <div className="flex aspect-[9/16] max-h-[70vh] w-full max-w-sm items-center justify-center rounded bg-zinc-950 text-center">
                    <div className="px-8">
                      {previewQuery.isPending || previewSrcdocQuery.isPending ? (
                        <Loader2 className="mx-auto mb-4 size-10 animate-spin text-zinc-700" />
                      ) : (
                        <FileVideo className="mx-auto mb-4 size-10 text-zinc-700" />
                      )}
                      <h2 className="text-sm font-medium text-zinc-300">Loading preview</h2>
                      <p className="mt-2 text-sm text-zinc-500">
                        Tinyfilm is starting a local HyperFrames preview for this project.
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

function withPreviewVersion(previewUrl: string, version: number): string {
  const url = new URL(previewUrl)
  url.searchParams.set('tinyfilmPreviewVersion', String(version))
  return url.toString()
}

function withBaseElement(html: string, previewUrl: string): string {
  const base = `<base href="${escapeHtmlAttribute(previewUrl)}" />`

  if (/<base\b/i.test(html)) {
    return html
  }

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n    ${base}`)
  }

  return `${base}\n${html}`
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
