import { createReadStream, existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { BrowserWindow } from 'electron'
import type { PreviewChangedEvent } from '../../shared/contracts/app'
import { getProject } from '../projects/projectRepository'

type PreviewSession = {
  projectId: string
  url: string
  port: number
}

type ServerSession = PreviewSession & {
  server: Server
  watcher: FSWatcher | null
  watchTimer: NodeJS.Timeout | null
  version: number
}

const previewServers = new Map<string, ServerSession>()
const ignoredWatchSegments = new Set(['.git', 'node_modules', 'renders'])
const previewChangeDebounceMs = 120

export async function startProjectPreview(input: { id: string }): Promise<PreviewSession> {
  const existing = previewServers.get(input.id)

  if (existing) {
    return toPublicSession(existing)
  }

  const project = getProject(input)
  const rootPath = resolve(project.rootPath)

  if (!existsSync(join(rootPath, project.entryPoint))) {
    throw new Error('Project entry point is missing')
  }

  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Accept-Ranges, Content-Length, Content-Range'
    )
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('Expires', '0')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405)
      response.end('Method not allowed')
      return
    }

    const filePath = resolvePreviewRequestPath(rootPath, project.entryPoint, request.url ?? '/')

    if (filePath === null || !existsSync(filePath)) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    const stats = statSync(filePath)
    const resolvedFilePath = stats.isDirectory() ? join(filePath, 'index.html') : filePath

    if (!existsSync(resolvedFilePath) || !statSync(resolvedFilePath).isFile()) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    servePreviewFile(request, response, resolvedFilePath)
  })

  const port = await listen(server)
  const session: ServerSession = {
    projectId: project.id,
    url: `http://127.0.0.1:${port}/${project.entryPoint}`,
    port,
    server,
    watcher: null,
    watchTimer: null,
    version: 0
  }
  session.watcher = watchProjectRoot(rootPath, session)

  previewServers.set(project.id, session)
  return toPublicSession(session)
}

export async function stopProjectPreview(input: { id: string }): Promise<{ id: string }> {
  const session = previewServers.get(input.id)

  if (!session) {
    return input
  }

  previewServers.delete(input.id)
  session.watcher?.close()
  if (session.watchTimer) {
    clearTimeout(session.watchTimer)
  }
  await close(session.server)

  return input
}

export async function stopAllProjectPreviews(): Promise<void> {
  await Promise.all(Array.from(previewServers.keys()).map((id) => stopProjectPreview({ id })))
}

export function resolvePreviewRequestPath(
  rootPath: string,
  entryPoint: string,
  requestUrl: string
): string | null {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  const pathname = decodeURIComponent(url.pathname)
  const relativePath = pathname === '/' ? entryPoint : pathname.replace(/^\/+/, '')
  const filePath = normalize(resolve(rootPath, relativePath))
  const pathToRoot = relative(rootPath, filePath)

  if (pathToRoot.startsWith(`..${sep}`) || pathToRoot === '..' || pathToRoot === '') {
    return pathToRoot === '' ? rootPath : null
  }

  return filePath
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()

      if (typeof address === 'object' && address !== null) {
        resolvePort(address.port)
        return
      }

      reject(new Error('Unable to start preview server'))
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolveClose()
    })
  })
}

function toPublicSession(session: ServerSession): PreviewSession {
  return {
    projectId: session.projectId,
    url: session.url,
    port: session.port
  }
}

function watchProjectRoot(rootPath: string, session: ServerSession): FSWatcher | null {
  try {
    return watch(rootPath, { recursive: true }, (_eventType, filename) => {
      const changedPath = filename ? String(filename) : null

      if (changedPath && shouldIgnorePreviewChange(changedPath)) {
        return
      }

      if (session.watchTimer) {
        clearTimeout(session.watchTimer)
      }

      session.watchTimer = setTimeout(() => {
        session.watchTimer = null
        session.version += 1
        publishPreviewChanged({
          projectId: session.projectId,
          version: session.version,
          changedPath
        })
      }, previewChangeDebounceMs)
    })
  } catch (error) {
    console.warn('[tinyfilm-preview] Unable to watch project root for preview reloads', {
      projectId: session.projectId,
      rootPath,
      error
    })
    return null
  }
}

function shouldIgnorePreviewChange(changedPath: string): boolean {
  return changedPath.split(/[\\/]+/).some((segment) => ignoredWatchSegments.has(segment))
}

function publishPreviewChanged(event: PreviewChangedEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('preview:changed', event)
  }
}

export function servePreviewFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string
): void {
  const stats = statSync(filePath)
  const range = parseRangeHeader(request.headers.range, stats.size)
  const contentType = contentTypeForPath(filePath)

  if (range === 'invalid') {
    response.writeHead(416, {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${stats.size}`,
      'Content-Type': contentType
    })
    response.end()
    return
  }

  if (range) {
    response.writeHead(206, {
      'Accept-Ranges': 'bytes',
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
      'Content-Type': contentType
    })

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    createReadStream(filePath, { start: range.start, end: range.end }).pipe(response)
    return
  }

  response.writeHead(200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': stats.size,
    'Content-Type': contentType
  })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  createReadStream(filePath).pipe(response)
}

function parseRangeHeader(
  rangeHeader: string | undefined,
  size: number
): { start: number; end: number } | 'invalid' | null {
  if (!rangeHeader) {
    return null
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)

  if (!match) {
    return 'invalid'
  }

  const [, rawStart, rawEnd] = match

  if (!rawStart && !rawEnd) {
    return 'invalid'
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd)

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return 'invalid'
    }

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1
    }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return 'invalid'
  }

  return {
    start,
    end: Math.min(end, size - 1)
  }
}

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}
