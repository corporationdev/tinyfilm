import { File, FileAudio, FileImage, FileVideo, Loader2, Send, Square, X } from 'lucide-react'
import { useState, type DragEvent, type FormEvent } from 'react'
import type { ProjectAsset } from '../../../../shared/contracts/app'
import { filePathsFromFileList, hasFiles } from '../../lib/fileDrop'
import { Button } from '../ui/button'

export function AgentComposer(props: {
  message: string
  attachedAssets: ProjectAsset[]
  disabled: boolean
  placeholder: string
  canCancel: boolean
  cancelPending: boolean
  canSend: boolean
  sending: boolean
  uploadPending: boolean
  onMessageChange: (message: string) => void
  onFilesDropped: (filePaths: string[]) => void
  onRemoveAttachedAsset: (assetId: string) => void
  onSubmit: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [dragActive, setDragActive] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (props.canSend) {
      props.onSubmit()
    }
  }

  const handleDragOver = (event: DragEvent): void => {
    if (!hasFiles(event) || props.disabled) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  const handleDrop = (event: DragEvent): void => {
    if (!hasFiles(event) || props.disabled) {
      return
    }

    event.preventDefault()
    setDragActive(false)
    props.onFilesDropped(filePathsFromFileList(event.dataTransfer.files))
  }

  return (
    <form className="shrink-0 border-t border-zinc-800 p-4" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="agent-message">
        Message
      </label>
      <div
        className={`relative rounded-md border bg-zinc-900 transition focus-within:border-zinc-500 ${
          dragActive ? 'border-zinc-500 ring-1 ring-zinc-500/50' : 'border-zinc-800'
        }`}
        onDragEnter={handleDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragActive(false)
          }
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {props.attachedAssets.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-zinc-800 px-3 py-2">
            {props.attachedAssets.map((asset) => (
              <AssetChip
                asset={asset}
                key={asset.id}
                onRemove={() => props.onRemoveAttachedAsset(asset.id)}
              />
            ))}
          </div>
        ) : null}
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
              {props.sending || props.uploadPending ? (
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

function AssetChip(props: { asset: ProjectAsset; onRemove: () => void }): React.JSX.Element {
  return (
    <div className="flex max-w-full items-center gap-2 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
      {assetIcon(props.asset, 'size-3.5 shrink-0 text-zinc-500')}
      <span className="min-w-0 max-w-48 truncate">{props.asset.name}</span>
      <button
        className="shrink-0 rounded text-zinc-500 transition hover:text-zinc-200"
        title="Remove asset"
        type="button"
        onClick={props.onRemove}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function assetIcon(asset: ProjectAsset, className: string): React.JSX.Element {
  if (asset.type === 'video') {
    return <FileVideo className={className} />
  }

  if (asset.type === 'audio') {
    return <FileAudio className={className} />
  }

  if (asset.type === 'image') {
    return <FileImage className={className} />
  }

  return <File className={className} />
}
