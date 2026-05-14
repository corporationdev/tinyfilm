import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  FileAudio,
  FileImage,
  FileVideo,
  FolderPlus,
  Loader2,
  Plus,
  Trash2,
  Upload
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { ProjectAsset } from '../../shared/contracts/app'
import { Button } from './components/ui/button'
import { orpc } from './lib/orpc'

type View = { name: 'home' } | { name: 'project'; projectId: string }

function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'home' })

  if (view.name === 'project') {
    return <ProjectDetail projectId={view.projectId} onBack={() => setView({ name: 'home' })} />
  }

  return <ProjectHome onOpenProject={(projectId) => setView({ name: 'project', projectId })} />
}

function ProjectHome(props: { onOpenProject: (projectId: string) => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const projectsQuery = useQuery(orpc.projects.list.queryOptions())
  const createProject = useMutation(
    orpc.projects.create.mutationOptions({
      onSuccess: (project) => {
        setTitle('')
        void queryClient.invalidateQueries()
        props.onOpenProject(project.id)
      }
    })
  )

  const projects = projectsQuery.data ?? []
  const activeError = projectsQuery.error ?? createProject.error

  const handleCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const nextTitle = title.trim()
    if (!nextTitle) {
      return
    }

    createProject.mutate({ title: nextTitle })
  }

  return (
    <main className="min-h-svh bg-zinc-950 text-zinc-100">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
        <header className="flex flex-col gap-5 border-b border-zinc-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500">Tinyfilm</p>
            <h1 className="text-3xl font-semibold tracking-normal">Projects</h1>
          </div>

          <form className="flex w-full gap-2 sm:w-auto" onSubmit={handleCreate}>
            <label className="sr-only" htmlFor="project-title">
              Project title
            </label>
            <input
              id="project-title"
              className="h-10 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-500 sm:w-72"
              maxLength={120}
              placeholder="New video project"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button disabled={createProject.isPending || !title.trim()} type="submit">
              {createProject.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Create
            </Button>
          </form>
        </header>

        {activeError ? <ErrorBanner error={activeError} /> : null}

        {projectsQuery.isPending ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <EmptyProjects />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <button
                className="group overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 text-left transition hover:border-zinc-600 hover:bg-zinc-900/80"
                key={project.id}
                onClick={() => props.onOpenProject(project.id)}
                type="button"
              >
                <div className="aspect-video bg-zinc-950">
                  <div className="flex h-full items-center justify-center text-zinc-700">
                    <FileVideo className="size-9" />
                  </div>
                </div>
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="line-clamp-2 text-base font-medium text-zinc-100">
                      {project.title}
                    </h2>
                    <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400">
                      {project.status}
                    </span>
                  </div>
                  <p className="truncate text-xs text-zinc-500">{project.rootPath}</p>
                  <p className="text-xs text-zinc-500">
                    {project.width}x{project.height} at {project.fps}fps
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function ProjectDetail(props: { projectId: string; onBack: () => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [isDragging, setIsDragging] = useState(false)
  const projectQuery = useQuery(
    orpc.projects.get.queryOptions({
      input: { id: props.projectId }
    })
  )
  const assetsQuery = useQuery(
    orpc.assets.listByProject.queryOptions({
      input: { id: props.projectId }
    })
  )
  const importFiles = useMutation(
    orpc.assets.importFiles.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries()
      }
    })
  )
  const removeAsset = useMutation(
    orpc.assets.remove.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries()
      }
    })
  )

  const project = projectQuery.data
  const assets = assetsQuery.data ?? []
  const activeError =
    projectQuery.error ?? assetsQuery.error ?? importFiles.error ?? removeAsset.error

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setIsDragging(false)

    const filePaths = Array.from(event.dataTransfer.files)
      .map((file) => window.api.getPathForFile(file))
      .filter((filePath) => filePath.length > 0)

    if (filePaths.length > 0) {
      importFiles.mutate({ projectId: props.projectId, filePaths })
    }
  }

  return (
    <main className="flex min-h-svh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-16 items-center justify-between border-b border-zinc-800 px-5">
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

      <section className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-zinc-800 lg:border-r lg:border-b-0">
          <div
            className={`m-4 flex min-h-44 flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center transition ${
              isDragging ? 'border-zinc-300 bg-zinc-800' : 'border-zinc-700 bg-zinc-900'
            }`}
            onDragEnter={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {importFiles.isPending ? (
              <Loader2 className="size-8 animate-spin text-zinc-400" />
            ) : (
              <Upload className="size-8 text-zinc-500" />
            )}
            <div>
              <h2 className="text-sm font-medium">Drop media here</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Files are copied into this project&apos;s public/assets/imports folder.
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-300">Imported assets</h2>
              <span className="text-xs text-zinc-500">{assets.length}</span>
            </div>

            {assetsQuery.isPending ? (
              <div className="rounded-md border border-zinc-800 p-4 text-sm text-zinc-500">
                Loading assets...
              </div>
            ) : assets.length === 0 ? (
              <div className="rounded-md border border-zinc-800 p-4 text-sm text-zinc-500">
                No assets yet.
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-800">
                {assets.map((asset) => (
                  <AssetRow
                    asset={asset}
                    key={asset.id}
                    onRemove={() => removeAsset.mutate({ id: asset.id })}
                    removing={removeAsset.isPending && removeAsset.variables?.id === asset.id}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-[420px] flex-col p-5">
          <div className="flex flex-1 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900">
            <div className="flex aspect-[9/16] max-h-[70vh] w-full max-w-sm items-center justify-center rounded bg-zinc-950 text-center">
              <div className="px-8">
                <FileVideo className="mx-auto mb-4 size-10 text-zinc-700" />
                <h2 className="text-sm font-medium text-zinc-300">Preview placeholder</h2>
                <p className="mt-2 text-sm text-zinc-500">
                  The Remotion preview will mount here after the project model is settled.
                </p>
              </div>
            </div>
          </div>

          {project ? (
            <footer className="mt-4 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
              <span>
                {project.width}x{project.height}
              </span>
              <span>{project.fps}fps</span>
              <span className="truncate">{project.rootPath}</span>
            </footer>
          ) : null}
        </section>
      </section>
    </main>
  )
}

function EmptyProjects(): React.JSX.Element {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 p-8 text-center">
      <FolderPlus className="mb-4 size-10 text-zinc-600" />
      <h2 className="text-lg font-medium">Create your first project</h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        Tinyfilm will create a project folder with Remotion source, local assets, and render output.
      </p>
    </div>
  )
}

function AssetRow(props: {
  asset: ProjectAsset
  removing: boolean
  onRemove: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-3 last:border-b-0">
      <div className="flex size-9 shrink-0 items-center justify-center rounded bg-zinc-800 text-zinc-400">
        <AssetIcon type={props.asset.type} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-200">{props.asset.name}</p>
        <p className="truncate text-xs text-zinc-500">{props.asset.relativePath}</p>
      </div>
      <Button
        disabled={props.removing}
        size="icon"
        title="Remove asset record"
        variant="ghost"
        onClick={props.onRemove}
      >
        {props.removing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </Button>
    </div>
  )
}

function ErrorBanner(props: { error: unknown }): React.JSX.Element {
  return (
    <div className="mx-5 mt-4 rounded-md border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">
      {props.error instanceof Error ? props.error.message : 'Something went wrong'}
    </div>
  )
}

function AssetIcon(props: { type: ProjectAsset['type'] }): React.JSX.Element {
  if (props.type === 'audio') {
    return <FileAudio className="size-4" />
  }

  if (props.type === 'image') {
    return <FileImage className="size-4" />
  }

  return <FileVideo className="size-4" />
}

export default App
