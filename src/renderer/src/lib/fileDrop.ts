import type { DragEvent } from 'react'

export function filePathsFromFileList(files: FileList | File[]): string[] {
  return Array.from(files)
    .map((file) => window.api.getPathForFile(file))
    .filter((filePath) => filePath.trim().length > 0)
}

export function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}
