import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join, relative, resolve, sep } from 'node:path'
import { BrowserWindow, session } from 'electron'
import { createStudioApi, type RenderJobState } from '@hyperframes/core/studio-api'
import { lintHyperframeHtml } from '@hyperframes/core/lint'
import type { PreviewChangedEvent } from '../../shared/contracts/app'
import { getProject, listProjects } from '../projects/projectRepository'

type StudioApiSession = {
  url: string
  port: number
}

type ProjectWatch = {
  watcher: FSWatcher | null
  watchTimer: NodeJS.Timeout | null
  version: number
}

const require = createRequire(import.meta.url)
const studioApiPrefix = '/api'
const studioApiChangeDebounceMs = 120
const ignoredWatchSegments = new Set(['.git', 'node_modules', 'renders', '.thumbnails'])
const projectWatches = new Map<string, ProjectWatch>()
const projectSignatureCache = new Map<
  string,
  { mtimeMs: number; size: number; signature: string }
>()

let studioApiServer: Server | null = null
let studioApiSession: StudioApiSession | null = null
let studioApiStartPromise: Promise<StudioApiSession> | null = null
let studioApiRequestRedirectRegistered = false

export async function startStudioApiServer(): Promise<StudioApiSession> {
  if (studioApiSession) {
    return studioApiSession
  }

  if (studioApiStartPromise) {
    return studioApiStartPromise
  }

  studioApiStartPromise = startStudioApiServerInternal()
  try {
    return await studioApiStartPromise
  } finally {
    studioApiStartPromise = null
  }
}

export async function startProjectPreview(input: { id: string }): Promise<{
  projectId: string
  url: string
  port: number
}> {
  const project = getProject(input)
  const session = await startStudioApiServer()

  watchProjectRoot(project.id, project.rootPath)

  return {
    projectId: project.id,
    url: `${session.url}${studioApiPrefix}/projects/${project.id}/preview`,
    port: session.port
  }
}

export async function stopProjectPreview(input: { id: string }): Promise<{ id: string }> {
  const watch = projectWatches.get(input.id)
  if (!watch) {
    return input
  }

  projectWatches.delete(input.id)
  watch.watcher?.close()
  if (watch.watchTimer) {
    clearTimeout(watch.watchTimer)
  }

  return input
}

export async function stopAllProjectPreviews(): Promise<void> {
  await Promise.all(Array.from(projectWatches.keys()).map((id) => stopProjectPreview({ id })))

  if (!studioApiServer) {
    return
  }

  const server = studioApiServer
  studioApiServer = null
  studioApiSession = null

  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error)
        return
      }

      resolveClose()
    })
  })
}

async function startStudioApiServerInternal(): Promise<StudioApiSession> {
  const studioApi = createStudioApi({
    listProjects: () =>
      listProjects().map((project) => ({
        id: project.id,
        dir: project.rootPath,
        title: project.title
      })),
    resolveProject: (id: string) => {
      try {
        const project = getProject({ id })
        return {
          id: project.id,
          dir: project.rootPath,
          title: project.title
        }
      } catch {
        return null
      }
    },
    bundle: async () => null,
    getProjectSignature: (projectDir: string) => getCachedProjectSignature(resolve(projectDir)),
    lint: (html: string, opts?: { filePath?: string }) => lintHyperframeHtml(html, opts),
    runtimeUrl: '/api/runtime.js',
    rendersDir: (project) => join(project.dir, 'renders'),
    startRender: (opts): RenderJobState => {
      const state: RenderJobState = {
        id: opts.jobId,
        status: 'rendering',
        progress: 5,
        stage: 'Starting HyperFrames render',
        outputPath: opts.outputPath
      }
      const args = [
        '--yes',
        'hyperframes@0.6.6',
        'render',
        opts.project.dir,
        '--output',
        opts.outputPath,
        '--fps',
        formatFps(opts.fps),
        '--quality',
        opts.quality,
        '--format',
        opts.format
      ]

      if (opts.outputResolution) {
        args.push('--resolution', opts.outputResolution)
      }

      const child = spawn('npx', args, {
        cwd: opts.project.dir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk: string) => {
        updateRenderProgress(state, chunk)
      })
      child.stderr.on('data', (chunk: string) => {
        updateRenderProgress(state, chunk)
      })
      child.on('error', (error) => {
        state.status = 'failed'
        state.progress = 100
        state.stage = 'Render failed'
        state.error = error.message
      })
      child.on('close', (code) => {
        if (code === 0) {
          state.status = 'complete'
          state.progress = 100
          state.stage = 'Render complete'
          return
        }

        const failureDetails = state.stage
        state.status = 'failed'
        state.progress = 100
        state.stage = 'Render failed'
        state.error = failureDetails ?? `HyperFrames render exited with code ${code ?? 'unknown'}`
      })

      return state
    }
  })

  const server = createServer((request, response) => {
    void handleStudioApiRequest(studioApi, request, response)
  })

  const port = await listen(server)
  studioApiServer = server
  studioApiSession = {
    url: `http://127.0.0.1:${port}`,
    port
  }

  registerStudioApiRequestRedirect(studioApiSession.url)

  return studioApiSession
}

function formatFps(fps: { num: number; den: number }): string {
  return fps.den === 1 ? String(fps.num) : `${fps.num}/${fps.den}`
}

function updateRenderProgress(state: RenderJobState, chunk: string): void {
  const message = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)

  if (!message) {
    return
  }

  const percentMatch = message.match(/(\d{1,3})(?:\.\d+)?\s*%/)
  if (percentMatch) {
    const progress = Number(percentMatch[1])
    if (Number.isFinite(progress)) {
      state.progress = Math.min(99, Math.max(state.progress, progress))
    }
  } else if (state.progress < 90) {
    state.progress += 1
  }

  state.stage = message
}

async function handleStudioApiRequest(
  studioApi: { fetch: (request: Request) => Response | Promise<Response> },
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (!request.url) {
    response.writeHead(400)
    response.end('Missing URL')
    return
  }

  if (request.url === '/api/runtime.js') {
    serveRuntime(response)
    return
  }

  if (!request.url.startsWith(`${studioApiPrefix}/`)) {
    await serveTinyfilmRenderer(request, response)
    return
  }

  try {
    if (request.method === 'OPTIONS') {
      const apiResponse = new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match',
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Origin': '*'
        }
      })
      await writeFetchResponse(apiResponse, response)
      return
    }

    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readRequestBody(request)
    const url = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`)
    url.pathname = url.pathname.slice(studioApiPrefix.length)
    const apiResponse = await studioApi.fetch(
      new Request(url.toString(), {
        method: request.method,
        headers: requestHeaders(request),
        body: body ? new Uint8Array(body) : undefined
      })
    )

    await writeFetchResponse(apiResponse, response)
  } catch (error) {
    console.error('[studio-api] request failed', error)
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
    }
    response.end(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Studio API failed' })
    )
  }
}

async function serveTinyfilmRenderer(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (process.env['ELECTRON_RENDERER_URL']) {
    await proxyRendererDevServer(request, response, process.env['ELECTRON_RENDERER_URL'])
    return
  }

  serveRendererStaticFile(request, response)
}

async function proxyRendererDevServer(
  request: IncomingMessage,
  response: ServerResponse,
  rendererUrl: string
): Promise<void> {
  if (!request.url) {
    response.writeHead(400)
    response.end('Missing URL')
    return
  }

  try {
    const upstreamUrl = new URL(request.url, rendererUrl)
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readRequestBody(request)
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: requestHeaders(request),
      body: body ? new Uint8Array(body) : undefined
    })
    await writeFetchResponse(upstreamResponse, response)
  } catch (error) {
    console.error('[studio-api] renderer proxy failed', error)
    response.writeHead(502)
    response.end('Renderer dev server unavailable')
  }
}

function serveRendererStaticFile(request: IncomingMessage, response: ServerResponse): void {
  if (!request.url) {
    response.writeHead(400)
    response.end('Missing URL')
    return
  }

  const rendererRoot = resolve(__dirname, '../renderer')
  const url = new URL(request.url, 'http://127.0.0.1')
  const requestedPath = decodeURIComponent(url.pathname)
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '')
  let filePath = resolve(rendererRoot, relativePath)
  const pathToRoot = relative(rendererRoot, filePath)

  if (pathToRoot.startsWith(`..${sep}`) || pathToRoot === '..') {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(rendererRoot, 'index.html')
  }

  response.writeHead(200, {
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000',
    'Content-Type': contentTypeForPath(filePath)
  })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  createReadStream(filePath).pipe(response)
}

function serveRuntime(response: ServerResponse): void {
  const runtimePath = require.resolve('@hyperframes/core/runtime')

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/javascript'
  })
  createReadStream(runtimePath).pipe(response)
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  const blockedHeaders = new Set([
    'connection',
    'content-length',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
  ])

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || blockedHeaders.has(key.toLowerCase())) {
      continue
    }

    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }

  return headers
}

function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      resolveBody(chunks.length > 0 ? Buffer.concat(chunks) : undefined)
    })
    request.on('error', rejectBody)
  })
}

async function writeFetchResponse(
  fetchResponse: Response,
  serverResponse: ServerResponse
): Promise<void> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, ETag'
  }
  fetchResponse.headers.forEach((value, key) => {
    headers[key] = value
  })
  serverResponse.writeHead(fetchResponse.status, headers)

  if (!fetchResponse.body) {
    serverResponse.end()
    return
  }

  const reader = fetchResponse.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      serverResponse.write(value)
    }
  } finally {
    serverResponse.end()
  }
}

function getCachedProjectSignature(projectDir: string): string {
  const indexPath = join(projectDir, 'index.html')
  const stats = statSync(indexPath)

  const cached = projectSignatureCache.get(projectDir)
  if (cached?.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.signature
  }

  const signature = `${Math.round(stats.mtimeMs)}-${stats.size}`
  projectSignatureCache.set(projectDir, { mtimeMs: stats.mtimeMs, size: stats.size, signature })
  return signature
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectPort)
      const address = server.address()

      if (typeof address === 'object' && address !== null) {
        resolvePort(address.port)
        return
      }

      rejectPort(new Error('Unable to start Studio API server'))
    })
  })
}

function registerStudioApiRequestRedirect(apiOrigin: string): void {
  if (studioApiRequestRedirectRegistered) {
    return
  }

  studioApiRequestRedirectRegistered = true
  const patterns = ['http://*/*', 'https://*/*', 'file://*/*']

  session.defaultSession.webRequest.onBeforeRequest({ urls: patterns }, (details, callback) => {
    if (!studioApiSession || details.url.startsWith(studioApiSession.url)) {
      callback({})
      return
    }

    let url: URL
    try {
      url = new URL(details.url)
    } catch {
      callback({})
      return
    }

    const isStudioApiRequest =
      url.pathname === '/api/runtime.js' || url.pathname.startsWith(`${studioApiPrefix}/`)

    if (!isStudioApiRequest) {
      callback({})
      return
    }

    callback({
      redirectURL: `${apiOrigin}${url.pathname}${url.search}`
    })
  })
}

function watchProjectRoot(projectId: string, rootPath: string): void {
  if (projectWatches.has(projectId)) {
    return
  }

  const resolvedRoot = resolve(rootPath)
  const projectWatch: ProjectWatch = {
    watcher: null,
    watchTimer: null,
    version: 0
  }

  try {
    projectWatch.watcher = watch(resolvedRoot, { recursive: true }, (_eventType, filename) => {
      const changedPath = filename ? String(filename) : null

      if (changedPath && shouldIgnorePreviewChange(changedPath)) {
        return
      }

      if (projectWatch.watchTimer) {
        clearTimeout(projectWatch.watchTimer)
      }

      projectWatch.watchTimer = setTimeout(() => {
        projectWatch.watchTimer = null
        projectSignatureCache.delete(resolvedRoot)
        projectWatch.version += 1
        publishPreviewChanged({
          projectId,
          version: projectWatch.version,
          changedPath
        })
      }, studioApiChangeDebounceMs)
    })
  } catch (error) {
    console.warn('[studio-api] Unable to watch project root for preview reloads', {
      projectId,
      rootPath,
      error
    })
  }

  projectWatches.set(projectId, projectWatch)
}

function shouldIgnorePreviewChange(changedPath: string): boolean {
  return changedPath.split(/[\\/]+/).some((segment) => ignoredWatchSegments.has(segment))
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.css':
      return 'text/css'
    case '.html':
      return 'text/html'
    case '.js':
    case '.mjs':
      return 'text/javascript'
    case '.json':
      return 'application/json'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}

function publishPreviewChanged(event: PreviewChangedEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('preview:changed', event)
  }
}
