import { Loader2 } from 'lucide-react'
import type { PiAgentChat } from '../../../../shared/contracts/app'

export function ChatButton(props: {
  chat: PiAgentChat
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className={`rounded-md border px-3 py-2 text-left transition ${
        props.selected
          ? 'border-zinc-600 bg-zinc-800'
          : 'border-transparent bg-transparent hover:border-zinc-800 hover:bg-zinc-900'
      }`}
      type="button"
      onClick={props.onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm text-zinc-200">{props.chat.title}</p>
        {props.chat.status === 'running' ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-zinc-500" />
        ) : null}
      </div>
      <p className="mt-1 truncate text-xs text-zinc-500">{props.chat.preview || 'New chat'}</p>
    </button>
  )
}
