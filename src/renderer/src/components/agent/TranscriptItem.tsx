import { AlertCircle, CheckCircle2, ChevronRight, Loader2, Terminal } from 'lucide-react'
import type { PiAgentTranscriptItem } from '../../../../shared/contracts/app'
import { FormattedText } from './FormattedText'
import { isThinkingActivity } from './transcriptUtils'
import { displayToolLabel, toolDetailsText } from './toolUtils'

export function TranscriptItem(props: {
  item: PiAgentTranscriptItem
  expandedToolIds: Set<string>
  onToggleTool: (id: string) => void
}): React.JSX.Element | null {
  if (props.item.kind === 'message') {
    return <MessageRow item={props.item} />
  }

  if (props.item.kind === 'tool') {
    return (
      <ToolRow
        expanded={props.expandedToolIds.has(props.item.id)}
        item={props.item}
        onToggle={() => props.onToggleTool(props.item.id)}
      />
    )
  }

  return <ActivityRow item={props.item} />
}

function MessageRow(props: {
  item: Extract<PiAgentTranscriptItem, { kind: 'message' }>
}): React.JSX.Element {
  const isUser = props.item.role === 'user'

  if (!isUser) {
    return (
      <article
        className={`max-w-full rounded-md px-1 py-1 text-sm leading-6 text-zinc-200 ${
          props.item.isError ? 'text-red-200' : ''
        }`}
      >
        <FormattedText text={props.item.text} />
      </article>
    )
  }

  return (
    <article className="flex justify-end">
      <div
        className={`max-w-[86%] rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm leading-6 text-zinc-100 shadow-sm ${
          props.item.optimistic ? 'opacity-80' : ''
        }`}
      >
        <FormattedText text={props.item.text} />
      </div>
    </article>
  )
}

function ToolRow(props: {
  item: Extract<PiAgentTranscriptItem, { kind: 'tool' }>
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const statusIcon =
    props.item.status === 'running' ? (
      <Loader2 className="size-3.5 animate-spin" />
    ) : props.item.status === 'error' ? (
      <AlertCircle className="size-3.5" />
    ) : (
      <CheckCircle2 className="size-3.5" />
    )
  const hasDetails =
    Boolean(props.item.text?.trim()) ||
    props.item.input !== undefined ||
    props.item.output !== undefined

  return (
    <article
      className={`rounded-md border bg-zinc-950/60 text-xs ${
        props.item.status === 'error' ? 'border-red-900/70' : 'border-zinc-800'
      }`}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-400 transition hover:text-zinc-200 disabled:hover:text-zinc-400"
        disabled={!hasDetails}
        type="button"
        onClick={props.onToggle}
      >
        {hasDetails ? (
          <ChevronRight
            className={`size-3.5 shrink-0 transition-transform ${props.expanded ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <Terminal className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium text-zinc-300">
          {displayToolLabel(props.item)}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 ${
            props.item.status === 'error'
              ? 'text-red-300'
              : props.item.status === 'running'
                ? 'text-zinc-400'
                : 'text-emerald-300'
          }`}
        >
          {statusIcon}
          {props.item.toolName}
        </span>
      </button>

      {props.expanded && hasDetails ? (
        <div className="border-t border-zinc-800 p-3">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-black/45 p-3 font-mono text-[11px] leading-5 text-zinc-400">
            {toolDetailsText(props.item)}
          </pre>
        </div>
      ) : null}
    </article>
  )
}

function ActivityRow(props: {
  item: Extract<PiAgentTranscriptItem, { kind: 'activity' }>
}): React.JSX.Element {
  const isThinking = isThinkingActivity(props.item)

  return (
    <div
      className={`mx-auto flex max-w-[90%] items-center justify-center gap-2 rounded-full border px-3 py-1 text-center text-xs ${
        props.item.tone === 'error'
          ? 'border-red-900/70 bg-red-950/30 text-red-200'
          : 'border-zinc-800 bg-zinc-950/60 text-zinc-500'
      }`}
    >
      {isThinking ? <Loader2 className="size-3 animate-spin" /> : null}
      {props.item.label}
      {props.item.detail ? <span className="text-zinc-600"> · {props.item.detail}</span> : null}
    </div>
  )
}
