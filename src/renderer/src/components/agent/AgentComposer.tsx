import { Loader2, Send, Square } from 'lucide-react'
import { type FormEvent } from 'react'
import { Button } from '../ui/button'

export function AgentComposer(props: {
  message: string
  disabled: boolean
  placeholder: string
  canCancel: boolean
  cancelPending: boolean
  canSend: boolean
  sending: boolean
  onMessageChange: (message: string) => void
  onSubmit: () => void
  onCancel: () => void
}): React.JSX.Element {
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (props.canSend) {
      props.onSubmit()
    }
  }

  return (
    <form className="shrink-0 border-t border-zinc-800 p-4" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="agent-message">
        Message
      </label>
      <div className="relative rounded-md border border-zinc-800 bg-zinc-900 transition focus-within:border-zinc-500">
        <textarea
          id="agent-message"
          className="min-h-28 w-full resize-none bg-transparent px-3 py-3 pr-14 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          disabled={props.disabled}
          placeholder={props.placeholder}
          value={props.message}
          onChange={(event) => props.onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <div className="absolute right-2 bottom-2 flex gap-1">
          {props.canCancel ? (
            <Button
              disabled={props.cancelPending}
              size="icon"
              title="Cancel run"
              variant="ghost"
              onClick={props.onCancel}
              type="button"
            >
              {props.cancelPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Square className="size-4" />
              )}
            </Button>
          ) : (
            <Button disabled={!props.canSend} size="icon" title="Send a message" type="submit">
              {props.sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
