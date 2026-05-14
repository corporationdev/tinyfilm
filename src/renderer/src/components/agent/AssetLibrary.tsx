import { File, FileAudio, Loader2, Upload } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import type { ProjectAsset } from '../../../../shared/contracts/app'
import { filePathsFromFileList, hasFiles } from '../../lib/fileDrop'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../ui/context-menu'

export function AssetLibrary(props: {
  assets: ProjectAsset[]
  loading: boolean
  uploadPending: boolean
  error?: Error | null
  onFilesDropped: (filePaths: string[]) => void
  onDeleteAsset: (assetId: string) => void
  onRenameAsset: (assetId: string, name: string) => void
}): React.JSX.Element {
  const [dragActive, setDragActive] = useState(false)

  const handleDragOver = (event: DragEvent): void => {
    if (!hasFiles(event)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  const handleDrop = (event: DragEvent): void => {
    if (!hasFiles(event)) {
      return
    }

    event.preventDefault()
    setDragActive(false)
    props.onFilesDropped(filePathsFromFileList(event.dataTransfer.files))
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden transition ${
        dragActive ? 'bg-zinc-900/80' : ''
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
      {props.uploadPending ? (
        <Loader2 className="absolute top-4 right-4 size-4 animate-spin text-zinc-500" />
      ) : null}

      {props.error ? (
        <div className="m-4 rounded-md border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {props.error.message}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {props.loading ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading assets
          </div>
        ) : props.assets.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-zinc-800 px-8 text-center">
            <div>
              <Upload className="mx-auto mb-3 size-8 text-zinc-700" />
              <p className="text-sm font-medium text-zinc-300">Drop files to add assets</p>
              <p className="mt-1 text-xs text-zinc-500">Videos, images, audio, and other files.</p>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="mb-4 px-1 text-sm font-semibold text-zinc-200">All</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(126px,1fr))] gap-x-4 gap-y-6">
              {props.assets.map((asset) => (
                <AssetTile
                  asset={asset}
                  key={asset.id}
                  onDelete={() => props.onDeleteAsset(asset.id)}
                  onRename={(name) => props.onRenameAsset(asset.id, name)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AssetTile(props: {
  asset: ProjectAsset
  onDelete: () => void
  onRename: (name: string) => void
}): React.JSX.Element {
  const handleRename = (): void => {
    const name = window.prompt('Rename asset', props.asset.name)

    if (!name || name.trim() === props.asset.name) {
      return
    }

    props.onRename(name.trim())
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button className="min-w-0 text-left" title={props.asset.name} type="button">
          <div className="group relative aspect-[1.45] overflow-hidden rounded-lg bg-zinc-800 shadow-sm ring-1 ring-zinc-800 transition hover:ring-zinc-600">
            <AssetPreview asset={props.asset} />
            <span className="absolute top-2 right-2 rounded bg-zinc-950/75 px-1.5 py-0.5 text-xs font-semibold text-zinc-100">
              {metadataLabel(props.asset)}
            </span>
          </div>
          <p className="mt-2 truncate px-1 text-sm font-semibold text-zinc-500">
            {props.asset.name}
          </p>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleRename}>Rename</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={props.onDelete}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function AssetPreview(props: { asset: ProjectAsset }): React.JSX.Element {
  if (props.asset.type === 'image') {
    return <PreviewImage filePath={props.asset.assetPath} key={props.asset.assetPath} />
  }

  if (props.asset.type === 'video') {
    const thumbnailPath = thumbnailPathForAsset(props.asset)

    return <PreviewImage filePath={thumbnailPath} key={thumbnailPath} />
  }

  if (props.asset.type === 'audio') {
    return <AudioPreview />
  }

  return (
    <div className="flex h-full w-full items-center justify-center text-zinc-500">
      <File className="size-8" />
    </div>
  )
}

function PreviewImage(props: { filePath: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timeout: number | undefined
    let attempts = 0
    const maxAttempts = 24

    const loadImage = (): void => {
      attempts += 1

      window.api
        .fileDataUrl(props.filePath)
        .then((dataUrl) => {
          if (!cancelled) {
            setFailed(false)
            setSrc(dataUrl)
          }
        })
        .catch(() => {
          if (cancelled) {
            return
          }

          if (attempts < maxAttempts) {
            timeout = window.setTimeout(loadImage, 500)
            return
          }

          setFailed(true)
        })
    }

    loadImage()

    return () => {
      cancelled = true
      if (timeout) {
        window.clearTimeout(timeout)
      }
    }
  }, [props.filePath])

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center text-zinc-500">
        <File className="size-8" />
      </div>
    )
  }

  if (!src) {
    return <div className="h-full w-full bg-zinc-800" />
  }

  return (
    <img
      alt=""
      className="h-full w-full object-cover"
      draggable={false}
      src={src}
      onError={() => setFailed(true)}
    />
  )
}

function AudioPreview(): React.JSX.Element {
  return (
    <div className="relative flex h-full w-full items-end overflow-hidden bg-zinc-900 px-1 pb-2">
      <FileAudio className="absolute top-2 left-2 size-4 text-sky-300/80" />
      {Array.from({ length: 46 }).map((_, index) => (
        <div
          className="mx-px flex-1 rounded-t bg-sky-500"
          key={index}
          style={{
            height: `${24 + ((index * 17) % 68)}%`,
            opacity: index % 5 === 0 ? 0.95 : 0.72
          }}
        />
      ))}
    </div>
  )
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return 'unknown size'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function metadataLabel(asset: ProjectAsset): string {
  if (asset.durationMs !== null) {
    return formatDuration(asset.durationMs)
  }

  return formatBytes(asset.sizeBytes)
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function thumbnailPathForAsset(asset: ProjectAsset): string {
  return asset.assetPath.replace(/[/\\][^/\\]+$/, '/thumbnail.jpg')
}
