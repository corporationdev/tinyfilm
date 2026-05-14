import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PiAgentChat, PiAgentTranscriptItem } from '../../../../shared/contracts/app'
import { orpc } from '../../lib/orpc'
import { AgentComposer } from './AgentComposer'
import { AgentHeader } from './AgentHeader'
import { AgentTranscript } from './AgentTranscript'
import { GeminiKeyRequired } from './GeminiKeyRequired'
import {
  isThinkingActivity,
  mergeOptimisticTranscript,
  shouldKeepOptimisticItem,
  shouldShowTranscriptItem,
  titleFromMessage
} from './transcriptUtils'

export function AgentPanel(props: {
  projectId: string
  selectedSessionId?: string
  onSelectChat: (sessionId: string | undefined) => void
  onRunCompleted: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { onOpenSettings, onRunCompleted, onSelectChat, projectId, selectedSessionId } = props
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState<PiAgentTranscriptItem[] | null>(null)
  const [optimisticTranscript, setOptimisticTranscript] = useState<PiAgentTranscriptItem[]>([])
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set())
  const [liveStatus, setLiveStatus] = useState<PiAgentChat['status'] | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement | null>(null)
  const optimisticSessionRef = useRef<string | undefined>(undefined)
  const suppressAutoSelectRef = useRef(false)
  const authStatusQuery = useQuery(orpc.agents.getGeminiAuthStatus.queryOptions())
  const chatsQuery = useQuery(
    orpc.agents.listChats.queryOptions({
      input: { projectId }
    })
  )
  const chats = useMemo(() => chatsQuery.data ?? [], [chatsQuery.data])
  const mostRecentChat = useMemo(
    () =>
      chats.reduce<PiAgentChat | null>((latest, chat) => {
        if (!latest) {
          return chat
        }

        return Date.parse(chat.updatedAt) > Date.parse(latest.updatedAt) ? chat : latest
      }, null),
    [chats]
  )
  const openChatQuery = useQuery(
    orpc.agents.openChat.queryOptions({
      input: { projectId, sessionId: selectedSessionId ?? '' },
      enabled: Boolean(selectedSessionId)
    })
  )
  const createChat = useMutation(
    orpc.agents.createChat.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries()
      }
    })
  )
  const sendMessage = useMutation(
    orpc.agents.sendMessage.mutationOptions({
      onSuccess: () => {
        setMessage('')
        void queryClient.invalidateQueries()
      }
    })
  )
  const cancelRun = useMutation(orpc.agents.cancelRun.mutationOptions())
  const selectedChat = useMemo(() => {
    const chat =
      chats.find((chat) => chat.id === selectedSessionId) ?? openChatQuery.data?.chat ?? null

    return chat && liveStatus ? { ...chat, status: liveStatus } : chat
  }, [chats, liveStatus, openChatQuery.data?.chat, selectedSessionId])
  const transcript = mergeOptimisticTranscript(
    liveTranscript ?? openChatQuery.data?.transcript ?? [],
    optimisticTranscript
  ).filter(shouldShowTranscriptItem)
  const canSend = Boolean(message.trim()) && !createChat.isPending && !sendMessage.isPending
  const canCancel = selectedChat?.status === 'running' && Boolean(selectedSessionId)
  const isAcceptingMessage = createChat.isPending || sendMessage.isPending
  const composerPlaceholder = canCancel
    ? 'Queue a follow-up...'
    : selectedChat
      ? 'Message Pi about this project...'
      : 'Start a new agent chat...'
  const activeError =
    authStatusQuery.error ??
    chatsQuery.error ??
    openChatQuery.error ??
    createChat.error ??
    sendMessage.error ??
    cancelRun.error
  const needsGeminiKey = !authStatusQuery.isPending && !authStatusQuery.data?.configured
  const currentChatTitle = selectedChat?.title ?? 'New chat'

  useEffect(() => {
    suppressAutoSelectRef.current = false
  }, [projectId])

  useEffect(() => {
    if (
      selectedSessionId ||
      chatsQuery.isPending ||
      suppressAutoSelectRef.current ||
      !mostRecentChat
    ) {
      return
    }

    onSelectChat(mostRecentChat.id)
  }, [chatsQuery.isPending, mostRecentChat, onSelectChat, selectedSessionId])

  useEffect(() => {
    queueMicrotask(() => {
      setMessage('')
      setIsHistoryOpen(false)
      setLiveTranscript(null)
      if (optimisticSessionRef.current !== selectedSessionId) {
        setOptimisticTranscript([])
        optimisticSessionRef.current = undefined
      }
      setExpandedToolIds(new Set())
      setLiveStatus(null)
      setAgentError(null)
    })
  }, [selectedSessionId])

  useEffect(() => {
    const unsubscribe = window.api.onPiAgentEvent((event) => {
      if (event.projectId !== projectId) {
        return
      }

      if (event.type === 'transcriptUpdated' && event.sessionId === selectedSessionId) {
        setLiveTranscript(event.transcript)
        setOptimisticTranscript((items) =>
          items.filter((item) => shouldKeepOptimisticItem(event.transcript, item, items))
        )
      }

      if (event.type === 'runState' && event.sessionId === selectedSessionId) {
        setLiveStatus(event.status)

        if (event.error) {
          setAgentError(event.error)
        }

        if (event.status === 'running') {
          setAgentError(null)
        }

        if (event.status === 'idle') {
          setOptimisticTranscript((items) => items.filter((item) => !isThinkingActivity(item)))
          onRunCompleted()
        }
      }

      if (event.type === 'chatUpdated' || event.type === 'runState') {
        void queryClient.invalidateQueries()
      }
    })

    return unsubscribe
  }, [onRunCompleted, projectId, queryClient, selectedSessionId])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'end' })
  }, [transcript])

  const handleSend = (): void => {
    const text = message.trim()
    if (!text) {
      return
    }

    const optimisticId = `optimistic-${Date.now()}`
    const thinkingId = `${optimisticId}-thinking`
    const optimisticMessage: PiAgentTranscriptItem = {
      kind: 'message',
      id: optimisticId,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
      optimistic: true
    }
    const optimisticThinking: PiAgentTranscriptItem = {
      kind: 'activity',
      id: thinkingId,
      label: 'Thinking...',
      createdAt: new Date().toISOString()
    }

    optimisticSessionRef.current = selectedSessionId
    setOptimisticTranscript((items) => [...items, optimisticMessage, optimisticThinking])
    setMessage('')
    setAgentError(null)
    setLiveStatus('running')

    void (async () => {
      try {
        const sessionId =
          selectedSessionId ??
          (
            await createChat.mutateAsync({
              projectId,
              title: titleFromMessage(text)
            })
          ).id

        if (!selectedSessionId) {
          optimisticSessionRef.current = sessionId
          onSelectChat(sessionId)
        }

        await sendMessage.mutateAsync({
          projectId,
          sessionId,
          text
        })
      } catch (error) {
        setOptimisticTranscript((items) =>
          items.filter((item) => item.id !== optimisticId && item.id !== thinkingId)
        )
        setLiveStatus('idle')
        setAgentError(error instanceof Error ? error.message : 'Pi agent failed')
      }
    })()
  }

  const handleNewChat = (): void => {
    setMessage('')
    setIsHistoryOpen(false)
    setLiveTranscript(null)
    setOptimisticTranscript([])
    optimisticSessionRef.current = undefined
    setExpandedToolIds(new Set())
    setLiveStatus(null)
    setAgentError(null)
    suppressAutoSelectRef.current = true
    onSelectChat(undefined)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AgentHeader
        chats={chats}
        chatsPending={chatsQuery.isPending}
        historyOpen={isHistoryOpen}
        newChatDisabled={createChat.isPending || sendMessage.isPending}
        selectedSessionId={selectedSessionId}
        title={currentChatTitle}
        onHistoryOpenChange={setIsHistoryOpen}
        onNewChat={handleNewChat}
        onSelectChat={(sessionId) => {
          onSelectChat(sessionId)
          setIsHistoryOpen(false)
        }}
      />

      {activeError || agentError ? (
        <div className="m-4 shrink-0 rounded-md border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {agentError ?? (activeError instanceof Error ? activeError.message : 'Pi agent failed')}
        </div>
      ) : null}

      <AgentTranscript
        expandedToolIds={expandedToolIds}
        loading={openChatQuery.isPending}
        scrollAnchorRef={transcriptEndRef}
        selectedChat={selectedChat}
        selectedSessionId={selectedSessionId}
        transcript={transcript}
        onToggleTool={(id) => {
          setExpandedToolIds((current) => {
            const next = new Set(current)
            if (next.has(id)) {
              next.delete(id)
            } else {
              next.add(id)
            }
            return next
          })
        }}
      />

      {needsGeminiKey ? (
        <GeminiKeyRequired onOpenSettings={onOpenSettings} />
      ) : (
        <AgentComposer
          cancelPending={cancelRun.isPending}
          canCancel={canCancel}
          canSend={canSend}
          disabled={isAcceptingMessage}
          message={message}
          placeholder={composerPlaceholder}
          sending={isAcceptingMessage}
          onCancel={() => {
            if (!selectedSessionId) {
              return
            }
            cancelRun.mutate({ projectId, sessionId: selectedSessionId })
          }}
          onMessageChange={setMessage}
          onSubmit={handleSend}
        />
      )}
    </div>
  )
}
