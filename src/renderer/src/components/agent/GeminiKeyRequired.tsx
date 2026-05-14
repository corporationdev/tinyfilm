import { KeyRound } from 'lucide-react'
import { Button } from '../ui/button'

export function GeminiKeyRequired(props: { onOpenSettings: () => void }): React.JSX.Element {
  return (
    <div className="shrink-0 border-t border-zinc-800 p-4">
      <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3">
        <p className="text-sm font-medium text-zinc-200">Gemini API key required</p>
        <p className="mt-1 text-xs text-zinc-500">Add it in Settings before chatting with Pi.</p>
        <Button className="mt-3 w-full justify-center" onClick={props.onOpenSettings}>
          <KeyRound className="size-4" />
          Settings
        </Button>
      </div>
    </div>
  )
}
