import { realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AgentSession, AgentSessionEvent, SessionEntry } from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  PiAgentAuthStatus,
  PiAgentChat,
  PiAgentTranscriptItem
} from '../../shared/contracts/app'
import { getProject } from '../projects/projectRepository'
import { emitPiAgentEvent } from './piAgentEvents'

interface RuntimeRecord {
  projectId: string
  rootPath: string
  sessionId: string
  sessionFilePath: string
  session: AgentSession
  unsubscribe: () => void
  status: PiAgentChat['status']
  lastError?: string
}

interface ChatInfo {
  path: string
  id: string
  cwd: string
  name?: string
  created: Date
  modified: Date
  messageCount: number
  firstMessage: string
  allMessagesText: string
}

interface PendingChatRecord {
  projectId: string
  rootPath: string
  sessionManager: PiSessionManager
  chat: PiAgentChat
}

type PiModule = typeof import('@earendil-works/pi-coding-agent')
type PiSessionManager = ReturnType<PiModule['SessionManager']['create']>
type PiAuthStorage = ReturnType<PiModule['AuthStorage']['create']>
type PiModelRegistry = ReturnType<PiModule['ModelRegistry']['create']>

interface PiDeps {
  pi: PiModule
  authStorage: PiAuthStorage
  modelRegistry: PiModelRegistry
}

let piDepsPromise: Promise<PiDeps> | undefined
const runtimes = new Map<string, RuntimeRecord>()
const pendingChats = new Map<string, PendingChatRecord>()

function getPiDeps(): Promise<PiDeps> {
  piDepsPromise ??= import('@earendil-works/pi-coding-agent').then((pi) => {
    const agentDir = pi.getAgentDir()
    const authStorage = pi.AuthStorage.create(join(agentDir, 'auth.json'))
    const modelRegistry = pi.ModelRegistry.create(authStorage, join(agentDir, 'models.json'))

    return { pi, authStorage, modelRegistry }
  })

  return piDepsPromise
}

export async function listPiAgentChats(input: { projectId: string }): Promise<PiAgentChat[]> {
  const { pi } = await getPiDeps()
  const project = getProject({ id: input.projectId })
  const rootPath = await canonicalPath(project.rootPath)
  const infos = await pi.SessionManager.list(rootPath)
  const persistedIds = new Set(infos.map((info) => info.id))
  const pending = [...pendingChats.values()]
    .filter((record) => record.projectId === input.projectId && !persistedIds.has(record.chat.id))
    .map((record) => record.chat)

  return [
    ...pending,
    ...infos.map((info) => chatFromSessionInfo(info, runtimeFor(input.projectId, info.id)))
  ]
}

export async function createPiAgentChat(input: {
  projectId: string
  title?: string
}): Promise<PiAgentChat> {
  const { pi } = await getPiDeps()
  console.info('[pi-agent:createChat:start]', { projectId: input.projectId })
  const project = getProject({ id: input.projectId })
  const rootPath = await canonicalPath(project.rootPath)
  const sessionManager = pi.SessionManager.create(rootPath)
  const title = input.title?.trim() || 'New chat'

  sessionManager.appendSessionInfo(title)

  const sessionFilePath = sessionManager.getSessionFile()
  if (!sessionFilePath) {
    throw new Error('Pi did not create a session file')
  }

  const chat: PiAgentChat = {
    id: sessionManager.getSessionId(),
    sessionFilePath,
    title,
    preview: '',
    messageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'idle'
  }

  pendingChats.set(runtimeKey(input.projectId, chat.id), {
    projectId: input.projectId,
    rootPath,
    sessionManager,
    chat
  })
  emitPiAgentEvent({ type: 'chatUpdated', projectId: input.projectId, chat })
  console.info('[pi-agent:createChat:done]', {
    projectId: input.projectId,
    sessionId: chat.id,
    sessionFilePath
  })
  return chat
}

export async function openPiAgentChat(input: {
  projectId: string
  sessionId: string
}): Promise<{ chat: PiAgentChat; transcript: PiAgentTranscriptItem[] }> {
  console.info('[pi-agent:openChat:start]', input)
  const { rootPath, info, sessionManager } = await findProjectSession(input)
  const record = await ensureRuntime({
    projectId: input.projectId,
    rootPath,
    sessionId: input.sessionId,
    sessionFilePath: info.path,
    sessionManager
  })

  const result = {
    chat: chatFromSessionInfo(info, record),
    transcript: transcriptFromSession(record.session.sessionManager.getEntries())
  }
  console.info('[pi-agent:openChat:done]', {
    projectId: input.projectId,
    sessionId: input.sessionId,
    transcriptItems: result.transcript.length
  })
  return result
}

export async function getPiAgentTranscript(input: {
  projectId: string
  sessionId: string
}): Promise<PiAgentTranscriptItem[]> {
  const record = runtimeFor(input.projectId, input.sessionId)
  if (record) {
    return transcriptFromSession(record.session.sessionManager.getEntries())
  }

  const { pi } = await getPiDeps()
  const { info, sessionManager } = await findProjectSession(input)
  return transcriptFromSession((sessionManager ?? pi.SessionManager.open(info.path)).getEntries())
}

export async function sendPiAgentMessage(input: {
  projectId: string
  sessionId: string
  text: string
}): Promise<PiAgentChat> {
  console.info('[pi-agent:sendMessage:start]', {
    projectId: input.projectId,
    sessionId: input.sessionId,
    textLength: input.text.length
  })
  const opened = await openPiAgentChat(input)
  const record = requireRuntime(input.projectId, input.sessionId)
  record.status = 'running'
  record.lastError = undefined
  emitPiAgentEvent({
    type: 'runState',
    projectId: input.projectId,
    sessionId: input.sessionId,
    status: 'running'
  })

  let run: Promise<void>
  try {
    run = record.session.isStreaming
      ? record.session.followUp(input.text)
      : record.session.prompt(input.text)
  } catch (error) {
    handleRunFailure(record, error)
    throw error
  }

  void run
    .then(() => {
      console.info('[pi-agent:sendMessage:runComplete]', {
        projectId: input.projectId,
        sessionId: input.sessionId
      })
    })
    .catch((error) => {
      handleRunFailure(record, error)
    })

  console.info('[pi-agent:sendMessage:accepted]', {
    projectId: input.projectId,
    sessionId: input.sessionId
  })

  return { ...opened.chat, status: 'running' }
}

function handleRunFailure(record: RuntimeRecord, error: unknown): void {
  record.status = 'failed'
  record.lastError = error instanceof Error ? error.message : 'Pi agent run failed'
  console.error('[pi-agent:runFailed]', {
    projectId: record.projectId,
    sessionId: record.sessionId,
    error
  })
  emitPiAgentEvent({
    type: 'runState',
    projectId: record.projectId,
    sessionId: record.sessionId,
    status: 'failed',
    error: record.lastError
  })
  emitTranscript(record)
}

export async function cancelPiAgentRun(input: {
  projectId: string
  sessionId: string
}): Promise<PiAgentChat> {
  const { info } = await findProjectSession(input)
  const record = runtimeFor(input.projectId, input.sessionId)

  if (record) {
    await record.session.abort()
    record.status = 'idle'
    emitPiAgentEvent({
      type: 'runState',
      projectId: input.projectId,
      sessionId: input.sessionId,
      status: 'idle'
    })
    emitTranscript(record)
  }

  return chatFromSessionInfo(info, record)
}

export async function getGeminiAuthStatus(): Promise<PiAgentAuthStatus> {
  const { authStorage } = await getPiDeps()
  authStorage.reload()
  const status = authStorage.getAuthStatus('google')

  return {
    provider: 'google',
    configured: status.configured,
    ...(status.source ? { source: status.source } : {}),
    ...(status.label ? { label: status.label } : {})
  }
}

export async function setGeminiApiKey(input: { apiKey: string }): Promise<PiAgentAuthStatus> {
  const { authStorage, modelRegistry } = await getPiDeps()
  const apiKey = input.apiKey.trim()
  if (!apiKey) {
    throw new Error('Gemini API key is required')
  }

  authStorage.set('google', {
    type: 'api_key',
    key: apiKey
  })
  authStorage.reload()
  modelRegistry.refresh()

  console.info('[pi-agent:setGeminiApiKey:done]', {
    provider: 'google',
    keyLength: apiKey.length
  })

  return getGeminiAuthStatus()
}

async function ensureRuntime(input: {
  projectId: string
  rootPath: string
  sessionId: string
  sessionFilePath: string
  sessionManager?: PiSessionManager
}): Promise<RuntimeRecord> {
  const existing = runtimeFor(input.projectId, input.sessionId)
  if (existing) {
    return existing
  }

  const { pi, authStorage, modelRegistry } = await getPiDeps()
  const sessionManager =
    input.sessionManager ?? pi.SessionManager.open(input.sessionFilePath, undefined, input.rootPath)
  const { session } = await pi.createAgentSession({
    cwd: input.rootPath,
    authStorage,
    modelRegistry,
    sessionManager
  })

  const record: RuntimeRecord = {
    ...input,
    session,
    status: session.isStreaming ? 'running' : 'idle',
    unsubscribe: () => undefined
  }

  record.unsubscribe = session.subscribe((event) => {
    handleSessionEvent(record, event)
  })
  runtimes.set(runtimeKey(input.projectId, input.sessionId), record)

  return record
}

function handleSessionEvent(record: RuntimeRecord, event: AgentSessionEvent): void {
  switch (event.type) {
    case 'agent_start':
      record.status = 'running'
      record.lastError = undefined
      emitPiAgentEvent({
        type: 'runState',
        projectId: record.projectId,
        sessionId: record.sessionId,
        status: 'running'
      })
      break
    case 'agent_end':
      record.status = 'idle'
      record.lastError = undefined
      pendingChats.delete(runtimeKey(record.projectId, record.sessionId))
      emitPiAgentEvent({
        type: 'runState',
        projectId: record.projectId,
        sessionId: record.sessionId,
        status: 'idle'
      })
      emitTranscript(record)
      break
    case 'message_start':
    case 'message_end':
      emitTranscript(record)
      break
    case 'message_update':
      emitTranscript(record, streamingTranscriptItemFromMessage(event.message))
      break
    case 'tool_execution_start':
      emitTranscript(record, {
        id: `tool-${event.toolCallId}`,
        kind: 'tool',
        callId: event.toolCallId,
        createdAt: nowIso(),
        toolName: event.toolName,
        status: 'running',
        label: toolLabel(event.toolName),
        input: event.args
      })
      break
    case 'tool_execution_update':
      emitTranscript(record, {
        id: `tool-${event.toolCallId}`,
        kind: 'tool',
        callId: event.toolCallId,
        text: toolEventText(event.partialResult),
        createdAt: nowIso(),
        toolName: event.toolName,
        status: 'running',
        label: toolLabel(event.toolName)
      })
      break
    case 'tool_execution_end':
      emitTranscript(record, {
        id: `tool-${event.toolCallId}`,
        kind: 'tool',
        callId: event.toolCallId,
        text: toolEventText(event.result),
        createdAt: nowIso(),
        toolName: event.toolName,
        status: event.isError ? 'error' : 'success',
        label: toolLabel(event.toolName),
        output: event.result
      })
      break
    case 'queue_update':
      emitTranscript(record)
      break
  }
}

function emitTranscript(record: RuntimeRecord, transientItem?: PiAgentTranscriptItem | null): void {
  const transcript = transcriptFromSession(record.session.sessionManager.getEntries())
  if (transientItem && shouldShowTranscriptItem(transientItem)) {
    upsertTransientItem(transcript, transientItem)
  }

  emitPiAgentEvent({
    type: 'transcriptUpdated',
    projectId: record.projectId,
    sessionId: record.sessionId,
    transcript
  })
}

function streamingTranscriptItemFromMessage(message: AgentMessage): PiAgentTranscriptItem | null {
  if (message.role !== 'assistant') {
    return null
  }

  const text = visibleText(message.content)
  if (!text.trim()) {
    return null
  }

  return {
    kind: 'message',
    id: 'streaming-assistant',
    role: 'assistant',
    text,
    createdAt: nowIso()
  }
}

async function findProjectSession(input: {
  projectId: string
  sessionId: string
}): Promise<{ rootPath: string; info: ChatInfo; sessionManager?: PiSessionManager }> {
  const project = getProject({ id: input.projectId })
  const rootPath = await canonicalPath(project.rootPath)
  const { pi } = await getPiDeps()
  const pending = pendingChats.get(runtimeKey(input.projectId, input.sessionId))

  if (pending) {
    return {
      rootPath,
      sessionManager: pending.sessionManager,
      info: {
        path: pending.chat.sessionFilePath,
        id: pending.chat.id,
        cwd: rootPath,
        name: pending.chat.title,
        created: new Date(pending.chat.createdAt),
        modified: new Date(pending.chat.updatedAt),
        messageCount: pending.chat.messageCount,
        firstMessage: pending.chat.preview,
        allMessagesText: pending.chat.preview
      }
    }
  }

  const sessions = await pi.SessionManager.list(rootPath)
  const info = sessions.find((session) => session.id === input.sessionId)

  if (!info) {
    throw new Error('Pi chat not found for this project')
  }

  return { rootPath, info }
}

function chatFromSessionInfo(info: ChatInfo, record?: RuntimeRecord): PiAgentChat {
  const storedName = info.name?.trim()
  const title =
    storedName && storedName !== 'New chat'
      ? storedName
      : truncate(info.firstMessage, 64) || basename(info.cwd || info.path)

  return {
    id: info.id,
    sessionFilePath: info.path,
    title,
    preview: truncate(info.firstMessage || info.allMessagesText, 140),
    messageCount: info.messageCount,
    createdAt: info.created.toISOString(),
    updatedAt: info.modified.toISOString(),
    status: record?.status ?? 'idle'
  }
}

function transcriptFromSession(entries: SessionEntry[]): PiAgentTranscriptItem[] {
  return entries.flatMap((entry) => {
    if (entry.type !== 'message') {
      return []
    }

    const item = transcriptItemFromMessage(entry.id, entry.timestamp, entry.message)
    return item ? [item] : []
  })
}

function transcriptItemFromMessage(
  id: string,
  timestamp: string,
  message: AgentMessage
): PiAgentTranscriptItem | null {
  if (message.role === 'user') {
    return {
      kind: 'message',
      id,
      role: 'user',
      text: visibleText(message.content),
      createdAt: timestamp
    }
  }

  if (message.role === 'assistant') {
    const text = visibleText(message.content) || message.errorMessage || ''
    if (!text.trim()) {
      return null
    }

    return {
      kind: 'message',
      id,
      role: 'assistant',
      text,
      createdAt: timestamp,
      isError: message.stopReason === 'error' || message.stopReason === 'aborted'
    }
  }

  if (message.role === 'toolResult') {
    const text = visibleText(message.content)
    return {
      kind: 'tool',
      id,
      callId: id,
      status: message.isError ? 'error' : 'success',
      label: toolLabel(message.toolName),
      text,
      createdAt: timestamp,
      toolName: message.toolName,
      output: text
    }
  }

  if (message.role === 'bashExecution') {
    const text = `$ ${message.command}\n${message.output}`.trim()
    return {
      kind: 'tool',
      id,
      callId: id,
      status: message.exitCode !== 0 ? 'error' : 'success',
      label: 'Ran bash',
      text,
      createdAt: timestamp,
      toolName: 'bash',
      input: { command: message.command },
      output: message.output
    }
  }

  return null
}

function visibleText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') {
        return ''
      }

      const record = block as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') {
        return record.text
      }

      if (record.type === 'image') {
        return '[image]'
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function shouldShowTranscriptItem(item: PiAgentTranscriptItem): boolean {
  if (item.kind === 'message') {
    return item.text.trim().length > 0
  }

  if (item.kind === 'tool') {
    return Boolean(item.toolName || item.text || item.input || item.output)
  }

  return item.label.trim().length > 0
}

function upsertTransientItem(
  transcript: PiAgentTranscriptItem[],
  transientItem: PiAgentTranscriptItem
): void {
  const index =
    transientItem.kind === 'tool'
      ? transcript.findIndex((item) => item.kind === 'tool' && item.callId === transientItem.callId)
      : transcript.findIndex((item) => item.id === transientItem.id)

  if (index >= 0) {
    transcript[index] = { ...transcript[index], ...transientItem } as PiAgentTranscriptItem
    return
  }

  transcript.push(transientItem)
}

function toolEventText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const content = visibleText(record.content)
    if (content.trim()) {
      return content
    }
  }

  return undefined
}

function toolLabel(toolName: string): string {
  if (toolName === 'bash') {
    return 'Running bash'
  }

  if (/read/i.test(toolName)) {
    return 'Reading file'
  }

  if (/write|edit|patch|apply/i.test(toolName)) {
    return 'Editing files'
  }

  if (/grep|search|find/i.test(toolName)) {
    return 'Searching'
  }

  return `Using ${toolName}`
}

async function canonicalPath(path: string): Promise<string> {
  return realpath(path)
}

function runtimeFor(projectId: string, sessionId: string): RuntimeRecord | undefined {
  return runtimes.get(runtimeKey(projectId, sessionId))
}

function requireRuntime(projectId: string, sessionId: string): RuntimeRecord {
  const record = runtimeFor(projectId, sessionId)
  if (!record) {
    throw new Error('Pi chat runtime is not open')
  }
  return record
}

function runtimeKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`
}

function truncate(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) {
    return normalized
  }

  return `${normalized.slice(0, limit - 1)}…`
}

function nowIso(): string {
  return new Date().toISOString()
}
