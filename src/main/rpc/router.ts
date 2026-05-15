import { ORPCError, implement } from '@orpc/server'
import { appContract } from '../../shared/contracts/app'
import {
  importProjectFiles,
  listProjectAssets,
  removeProjectAsset,
  renameProjectAsset
} from '../assets/assetRepository'
import {
  cancelPiAgentRun,
  createPiAgentChat,
  getGeminiAuthStatus,
  getPiAgentTranscript,
  listPiAgentChats,
  openPiAgentChat,
  setGeminiApiKey,
  sendPiAgentMessage
} from '../agents/piAgentService'
import {
  getProject,
  listProjects,
  markProjectOpened,
  removeProject
} from '../projects/projectRepository'
import { createHyperframesProject } from '../hyperframes/createHyperframesProject'
import { startProjectPreview, stopProjectPreview } from '../hyperframes/studioApiServer'

const os = implement(appContract)

export const appRouter = os.router({
  projects: {
    list: os.projects.list.handler(() => listProjects()),
    create: os.projects.create.handler(({ input }) => createHyperframesProject(input)),
    get: os.projects.get.handler(({ input }) => getProject(input)),
    open: os.projects.open.handler(({ input }) => markProjectOpened(input)),
    startPreview: os.projects.startPreview.handler(({ input }) => startProjectPreview(input)),
    stopPreview: os.projects.stopPreview.handler(({ input }) => stopProjectPreview(input)),
    remove: os.projects.remove.handler(({ input }) => removeProject(input))
  },
  assets: {
    listByProject: os.assets.listByProject.handler(({ input }) =>
      listProjectAssets({ projectId: input.id })
    ),
    importFiles: os.assets.importFiles.handler(({ input }) => importProjectFiles(input)),
    rename: os.assets.rename.handler(({ input }) => renameProjectAsset(input)),
    remove: os.assets.remove.handler(({ input }) => removeProjectAsset(input))
  },
  agents: {
    listChats: os.agents.listChats.handler(({ input }) =>
      withAgentErrorLogging('agents.listChats', () => listPiAgentChats(input))
    ),
    createChat: os.agents.createChat.handler(({ input }) =>
      withAgentErrorLogging('agents.createChat', () => createPiAgentChat(input))
    ),
    openChat: os.agents.openChat.handler(({ input }) =>
      withAgentErrorLogging('agents.openChat', () => openPiAgentChat(input))
    ),
    getTranscript: os.agents.getTranscript.handler(({ input }) =>
      withAgentErrorLogging('agents.getTranscript', () => getPiAgentTranscript(input))
    ),
    sendMessage: os.agents.sendMessage.handler(({ input }) =>
      withAgentErrorLogging('agents.sendMessage', () => sendPiAgentMessage(input))
    ),
    cancelRun: os.agents.cancelRun.handler(({ input }) =>
      withAgentErrorLogging('agents.cancelRun', () => cancelPiAgentRun(input))
    ),
    getGeminiAuthStatus: os.agents.getGeminiAuthStatus.handler(() =>
      withAgentErrorLogging('agents.getGeminiAuthStatus', async () => getGeminiAuthStatus())
    ),
    setGeminiApiKey: os.agents.setGeminiApiKey.handler(({ input }) =>
      withAgentErrorLogging('agents.setGeminiApiKey', async () => setGeminiApiKey(input))
    )
  }
})

export type AppRouter = typeof appRouter

async function withAgentErrorLogging<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    console.error(`[${operation}]`, error)
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: error instanceof Error ? error.message : 'Pi agent request failed',
      cause: error
    })
  }
}
