import { Clock, Plus } from 'lucide-react'
import type { PiAgentChat } from '../../../../shared/contracts/app'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { ChatButton } from './ChatButton'

export function AgentHeader(props: {
  title: string
  chats: PiAgentChat[]
  chatsPending: boolean
  historyOpen: boolean
  selectedSessionId?: string
  newChatDisabled: boolean
  onHistoryOpenChange: (open: boolean) => void
  onSelectChat: (sessionId: string) => void
  onNewChat: () => void
}): React.JSX.Element {
  return (
    <div className="shrink-0 border-b border-zinc-800 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-sm font-medium text-zinc-200">{props.title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <Popover open={props.historyOpen} onOpenChange={props.onHistoryOpenChange}>
            <PopoverTrigger asChild>
              <Button size="icon" title="Chat history" variant="ghost">
                <Clock className="size-4" />
              </Button>
            </PopoverTrigger>

            <PopoverContent align="end" className="p-2">
              <div className="max-h-80 overflow-y-auto">
                {props.chatsPending ? (
                  <div className="px-3 py-2 text-xs text-zinc-500">Loading chats...</div>
                ) : props.chats.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-zinc-500">No previous chats.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {props.chats.map((chat) => (
                      <ChatButton
                        chat={chat}
                        key={chat.id}
                        selected={chat.id === props.selectedSessionId}
                        onClick={() => props.onSelectChat(chat.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            disabled={props.newChatDisabled}
            size="icon"
            title="New chat"
            variant="ghost"
            onClick={props.onNewChat}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
