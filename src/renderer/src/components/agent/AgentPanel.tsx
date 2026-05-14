import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  PiAgentChat,
  PiAgentTranscriptItem,
  ProjectAsset
} from '../../../../shared/contracts/app'
import { orpc } from '../../lib/orpc'
import { AgentComposer } from './AgentComposer'
import { AgentHeader } from './AgentHeader'
import { AgentTranscript } from './AgentTranscript'
import { AssetLibrary } from './AssetLibrary'
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
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [attachedAssets, setAttachedAssets] = useState<ProjectAsset[]>([])
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
  const assetsQuery = useQuery(
    orpc.assets.listByProject.queryOptions({
      input: { id: projectId }
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
        setAttachedAssets([])
        void queryClient.invalidateQueries()
      }
    })
  )
  const importAssets = useMutation(
    orpc.assets.importFiles.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries()
      }
    })
  )
  const renameAsset = useMutation(
    orpc.assets.rename.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries()
      }
    })
  )
  const deleteAsset = useMutation(
    orpc.assets.remove.mutationOptions({
      onSuccess: () => {
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
  const canCancel = selectedChat?.status === 'running' && Boolean(selectedSessionId)
  const canSend =
    Boolean(message.trim()) &&
    !canCancel &&
    !createChat.isPending &&
    !sendMessage.isPending &&
    !importAssets.isPending
  const isAcceptingMessage = createChat.isPending || sendMessage.isPending
  const composerPlaceholder = 'Send a message...'
  const activeError =
    authStatusQuery.error ??
    chatsQuery.error ??
    assetsQuery.error ??
    openChatQuery.error ??
    createChat.error ??
    sendMessage.error ??
    importAssets.error ??
    renameAsset.error ??
    deleteAsset.error ??
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
      setAttachedAssets([])
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
    if (!canSend) {
      return
    }

    const userText = message.trim()
    const text = messageForAgent(userText, attachedAssets)
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
              title: titleFromMessage(userText)
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
    setAttachedAssets([])
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

  const importFilePaths = async (filePaths: string[], attachToDraft: boolean): Promise<void> => {
    if (filePaths.length === 0 || importAssets.isPending) {
      return
    }

    const assets = await importAssets.mutateAsync({ projectId, filePaths })

    if (attachToDraft) {
      setAttachedAssets((current) => mergeAssets(current, assets))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AgentHeader
        chats={chats}
        chatsPending={chatsQuery.isPending}
        historyOpen={isHistoryOpen}
        assetsOpen={assetsOpen}
        newChatDisabled={createChat.isPending || sendMessage.isPending}
        selectedSessionId={selectedSessionId}
        title={assetsOpen ? 'Assets' : currentChatTitle}
        onAssetsOpenChange={(open) => {
          setAssetsOpen(open)
          if (open) {
            setIsHistoryOpen(false)
          }
        }}
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

      {assetsOpen ? (
        <AssetLibrary
          assets={assetsQuery.data ?? []}
          error={assetsQuery.error ?? importAssets.error}
          loading={assetsQuery.isPending}
          uploadPending={importAssets.isPending || renameAsset.isPending || deleteAsset.isPending}
          onDeleteAsset={(assetId) => {
            deleteAsset.mutate({ id: assetId })
            setAttachedAssets((assets) => assets.filter((asset) => asset.id !== assetId))
          }}
          onFilesDropped={(filePaths) => {
            void importFilePaths(filePaths, false)
          }}
          onRenameAsset={(assetId, name) => {
            renameAsset.mutate({ id: assetId, name })
            setAttachedAssets((assets) =>
              assets.map((asset) => (asset.id === assetId ? { ...asset, name } : asset))
            )
          }}
        />
      ) : (
        <>
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
              attachedAssets={attachedAssets}
              cancelPending={cancelRun.isPending}
              canCancel={canCancel}
              canSend={canSend}
              disabled={isAcceptingMessage}
              message={message}
              placeholder={composerPlaceholder}
              sending={isAcceptingMessage}
              uploadPending={importAssets.isPending}
              onCancel={() => {
                if (!selectedSessionId) {
                  return
                }
                cancelRun.mutate({ projectId, sessionId: selectedSessionId })
              }}
              onFilesDropped={(filePaths) => {
                void importFilePaths(filePaths, true)
              }}
              onMessageChange={setMessage}
              onRemoveAttachedAsset={(assetId) => {
                setAttachedAssets((assets) => assets.filter((asset) => asset.id !== assetId))
              }}
              onSubmit={handleSend}
            />
          )}
        </>
      )}
    </div>
  )
}

function mergeAssets(current: ProjectAsset[], incoming: ProjectAsset[]): ProjectAsset[] {
  const assets = [...current]
  const seen = new Set(assets.map((asset) => asset.id))

  for (const asset of incoming) {
    if (!seen.has(asset.id)) {
      assets.push(asset)
      seen.add(asset.id)
    }
  }

  return assets
}

function messageForAgent(userText: string, assets: ProjectAsset[]): string {
  if (assets.length === 0) {
    return userText
  }

  const assetLines = assets
    .map((asset) => `- ${asset.name} (asset id: ${asset.id}, path: ${asset.relativePath})`)
    .join('\n')

  return `Attached assets:\n${assetLines}\n\nUser request:\n${userText}`
}
