import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'
import { getProject } from '../projects/projectRepository'

type PreviewSession = {
  projectId: string
  url: string
  port: number
}

type ServerSession = PreviewSession & {
  server: Server
}

const previewServers = new Map<string, ServerSession>()

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
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')

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

    const filePath = resolveRequestPath(rootPath, project.entryPoint, request.url ?? '/')

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

    response.writeHead(200, {
      'Content-Length': statSync(resolvedFilePath).size,
      'Content-Type': contentTypeForPath(resolvedFilePath)
    })

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    createReadStream(resolvedFilePath).pipe(response)
  })

  const port = await listen(server)
  const session: ServerSession = {
    projectId: project.id,
    url: `http://127.0.0.1:${port}/${project.entryPoint}`,
    port,
    server
  }

  previewServers.set(project.id, session)
  return toPublicSession(session)
}

export async function stopProjectPreview(input: { id: string }): Promise<{ id: string }> {
  const session = previewServers.get(input.id)

  if (!session) {
    return input
  }

  previewServers.delete(input.id)
  await close(session.server)

  return input
}

export async function stopAllProjectPreviews(): Promise<void> {
  await Promise.all(Array.from(previewServers.keys()).map((id) => stopProjectPreview({ id })))
}

function resolveRequestPath(
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
