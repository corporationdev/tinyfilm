import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileVideo, FolderPlus, Loader2, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { ErrorBanner } from '../components/common/ErrorBanner'
import { Button } from '../components/ui/button'
import { orpc } from '../lib/orpc'

export function ProjectHomePage(props: {
  onOpenProject: (projectId: string) => void
}): React.JSX.Element {
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

function EmptyProjects(): React.JSX.Element {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 p-8 text-center">
      <FolderPlus className="mb-4 size-10 text-zinc-600" />
      <h2 className="text-lg font-medium">Create your first project</h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        Tinyfilm will create a HyperFrames project folder with local assets and render output.
      </p>
    </div>
  )
}
