import { implement } from '@orpc/server'
import { appContract } from '../../shared/contracts/app'
import {
  importProjectFiles,
  listProjectAssets,
  removeProjectAsset
} from '../assets/assetRepository'
import {
  getProject,
  listProjects,
  markProjectOpened,
  removeProject
} from '../projects/projectRepository'
import { createRemotionProject } from '../remotion/createRemotionProject'

const os = implement(appContract)

export const appRouter = os.router({
  projects: {
    list: os.projects.list.handler(() => listProjects()),
    create: os.projects.create.handler(({ input }) => createRemotionProject(input)),
    get: os.projects.get.handler(({ input }) => getProject(input)),
    open: os.projects.open.handler(({ input }) => markProjectOpened(input)),
    remove: os.projects.remove.handler(({ input }) => removeProject(input))
  },
  assets: {
    listByProject: os.assets.listByProject.handler(({ input }) =>
      listProjectAssets({ projectId: input.id })
    ),
    importFiles: os.assets.importFiles.handler(({ input }) => importProjectFiles(input)),
    remove: os.assets.remove.handler(({ input }) => removeProjectAsset(input))
  }
})

export type AppRouter = typeof appRouter
