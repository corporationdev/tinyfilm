import { Loader2 } from 'lucide-react'
import type { RefObject } from 'react'
import type { PiAgentChat, PiAgentTranscriptItem } from '../../../../shared/contracts/app'
import { TranscriptItem } from './TranscriptItem'

export function AgentTranscript(props: {
  selectedSessionId?: string
  selectedChat: PiAgentChat | null
  transcript: PiAgentTranscriptItem[]
  expandedToolIds: Set<string>
  loading: boolean
  scrollAnchorRef: RefObject<HTMLDivElement | null>
  onToggleTool: (id: string) => void
}): React.JSX.Element {
  const {
    selectedSessionId,
    selectedChat,
    transcript,
    expandedToolIds,
    loading,
    scrollAnchorRef,
    onToggleTool
  } = props

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {loading && selectedSessionId ? (
        <div className="flex h-full items-center justify-center text-zinc-500">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : transcript.length === 0 ? (
        <div className="flex h-full items-center justify-center text-center">
          <h3 className="text-sm font-medium text-zinc-500">
            {selectedChat ? 'Send a message to continue.' : 'Send a message to start.'}
          </h3>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {transcript.map((item) => (
            <TranscriptItem
              expandedToolIds={expandedToolIds}
              item={item}
              key={item.id}
              onToggleTool={onToggleTool}
            />
          ))}
          <div ref={scrollAnchorRef} />
        </div>
      )}
    </div>
  )
}
