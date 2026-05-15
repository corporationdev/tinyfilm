import { useEffect } from 'react'
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
  useParams,
  useSearch
} from '@tanstack/react-router'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectHomePage } from './pages/ProjectHomePage'
import { SettingsPage } from './pages/SettingsPage'

const rootRoute = createRootRoute({
  component: () => <Outlet />
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ProjectHomeRoute
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  validateSearch: (search: Record<string, unknown>) => ({
    chat: typeof search.chat === 'string' ? search.chat : undefined
  }),
  component: ProjectDetailRoute
})

const routeTree = rootRoute.addChildren([indexRoute, settingsRoute, projectRoute])
const router = createRouter({
  routeTree,
  history: createHashHistory()
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function App(): React.JSX.Element {
  useEffect(() => {
    return window.api.onNavigateSettings(() => {
      void router.navigate({ to: '/settings' })
    })
  }, [])

  return <RouterProvider router={router} />
}

function SettingsRoute(): React.JSX.Element {
  const navigate = useNavigate()

  return (
    <SettingsPage
      onBack={() => {
        void navigate({ to: '/' })
      }}
    />
  )
}

function ProjectHomeRoute(): React.JSX.Element {
  const navigate = useNavigate()

  return (
    <ProjectHomePage
      onOpenProject={(projectId) => {
        void navigate({
          to: '/projects/$projectId',
          params: { projectId },
          search: { chat: undefined }
        })
      }}
    />
  )
}

function ProjectDetailRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const { projectId } = useParams({ from: '/projects/$projectId' })
  const { chat } = useSearch({ from: '/projects/$projectId' })

  return (
    <ProjectDetailPage
      selectedSessionId={chat}
      projectId={projectId}
      onBack={() => {
        void navigate({ to: '/' })
      }}
      onSelectChat={(sessionId) => {
        void navigate({
          to: '/projects/$projectId',
          params: { projectId },
          search: { chat: sessionId }
        })
      }}
      onOpenSettings={() => {
        void navigate({ to: '/settings' })
      }}
    />
  )
}

export default App
