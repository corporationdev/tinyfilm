import type { TimelineElement } from '@hyperframes/studio'

const TIME_PRECISION = 100

export interface PatchTarget {
  id?: string | null
  selector?: string
  selectorIndex?: number
}

export interface PatchOperation {
  type: 'inline-style' | 'attribute'
  property: string
  value: string
}

export function buildPatchTarget(element: {
  domId?: string
  selector?: string
  selectorIndex?: number
}): PatchTarget | null {
  if (element.domId) {
    return { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
  }
  if (element.selector) {
    return { selector: element.selector, selectorIndex: element.selectorIndex }
  }
  return null
}

export function formatTimelineAttributeNumber(value: number): string {
  return Number((Math.round(value * TIME_PRECISION) / TIME_PRECISION).toFixed(2)).toString()
}

export function buildTrackZIndexMap(tracks: number[]): Map<number, number> {
  const uniqueTracks = Array.from(new Set(tracks)).sort((a, b) => a - b)
  const maxZIndex = uniqueTracks.length
  return new Map(uniqueTracks.map((track, index) => [track, maxZIndex - index]))
}

export function readAttributeByTarget(
  html: string,
  target: PatchTarget,
  attr: string
): string | undefined {
  const match = findTagByTarget(html, target)
  if (!match) return undefined

  const fullAttr = attr.startsWith('data-') ? attr : `data-${attr}`
  const valueMatch = new RegExp(`\\b${fullAttr}=(["'])([^"']*)\\1`).exec(match.tag)
  return valueMatch?.[2]
}

export function applyPatchByTarget(
  html: string,
  target: PatchTarget,
  operation: PatchOperation
): string {
  switch (operation.type) {
    case 'attribute':
      return patchAttributeByTarget(html, target, operation.property, operation.value)
    case 'inline-style':
      return patchInlineStyleByTarget(html, target, operation.property, operation.value)
  }
}

export function sourcePathForElement(
  element: TimelineElement,
  activeCompPath: string | null = null
): string {
  return element.sourceFile || activeCompPath || 'index.html'
}

function patchAttributeByTarget(
  html: string,
  target: PatchTarget,
  attr: string,
  value: string
): string {
  const match = findTagByTarget(html, target)
  if (!match) return html

  const fullAttr = attr.startsWith('data-') ? attr : `data-${attr}`
  const attrPattern = new RegExp(`\\b${fullAttr}=(["'])([^"']*)\\1`)
  const tag = match.tag
  const newTag = attrPattern.test(tag)
    ? tag.replace(attrPattern, `${fullAttr}="${value}"`)
    : `${tag} ${fullAttr}="${value}"`
  return replaceTagAtMatch(html, match, newTag)
}

function patchInlineStyleByTarget(
  html: string,
  target: PatchTarget,
  property: string,
  value: string
): string {
  const match = findTagByTarget(html, target)
  if (!match) return html

  const styleMatch = /\bstyle=(["'])([\s\S]*?)\1/.exec(match.tag)
  if (!styleMatch) {
    return replaceTagAtMatch(html, match, `${match.tag} style="${property}: ${escapeAttr(value)}"`)
  }

  const quote = styleMatch[1]
  const props = new Map<string, string>()
  for (const part of splitInlineStyleDeclarations(styleMatch[2])) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const key = part.slice(0, colon).trim()
    const val = part.slice(colon + 1).trim()
    if (key) props.set(key, val)
  }
  props.set(property, value)
  const nextStyle = Array.from(props.entries())
    .map(([key, val]) => `${key}: ${escapeStyleValue(val, quote)}`)
    .join('; ')
  const newTag = match.tag.replace(styleMatch[0], `style=${quote}${nextStyle}${quote}`)
  return replaceTagAtMatch(html, match, newTag)
}

interface TagMatch {
  tag: string
  start: number
  end: number
}

function findTagByTarget(html: string, target: PatchTarget): TagMatch | null {
  if (target.id) {
    const idPattern = new RegExp(`(<[^>]*\\bid=(["'])${escapeRegex(target.id)}\\2[^>]*)>`, 'i')
    const match = idPattern.exec(html)
    if (match?.index != null) {
      return { tag: match[1], start: match.index, end: match.index + match[1].length }
    }
  }

  if (!target.selector) return null

  const compositionIdMatch = target.selector.match(/^\[data-composition-id="([^"]+)"\]$/)
  if (compositionIdMatch) {
    const compId = compositionIdMatch[1]
    const pattern = new RegExp(
      `(<[^>]*\\bdata-composition-id=(["'])${escapeRegex(compId)}\\2[^>]*)>`,
      'i'
    )
    const match = pattern.exec(html)
    if (match?.index != null) {
      return { tag: match[1], start: match.index, end: match.index + match[1].length }
    }
  }

  const classMatch = target.selector.match(/^\.([a-zA-Z0-9_-]+)$/)
  if (classMatch) {
    const cls = classMatch[1]
    const pattern = new RegExp(
      `(<[^>]*\\bclass=(["'])[^"']*\\b${escapeRegex(cls)}\\b[^"']*\\2[^>]*)>`,
      'gi'
    )
    const selectorIndex = target.selectorIndex ?? 0
    let match: RegExpExecArray | null
    let currentIndex = 0
    while ((match = pattern.exec(html)) !== null) {
      if (currentIndex === selectorIndex && match.index != null) {
        return { tag: match[1], start: match.index, end: match.index + match[1].length }
      }
      currentIndex += 1
    }
  }

  return null
}

function replaceTagAtMatch(html: string, match: TagMatch, newTag: string): string {
  return `${html.slice(0, match.start)}${newTag}${html.slice(match.end)}`
}

function splitInlineStyleDeclarations(style: string): string[] {
  const declarations: string[] = []
  let current = ''
  let quote: string | null = null
  let entity = false
  let parenDepth = 0

  for (const char of style) {
    if (entity) {
      current += char
      if (char === ';') entity = false
      continue
    }
    if (char === '&') {
      entity = true
      current += char
      continue
    }
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '(') {
      parenDepth += 1
      current += char
      continue
    }
    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1)
      current += char
      continue
    }
    if (char === ';' && parenDepth === 0) {
      declarations.push(current)
      current = ''
      continue
    }
    current += char
  }

  if (current) declarations.push(current)
  return declarations
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;')
}

function escapeStyleValue(value: string, quote: string): string {
  return quote === '"' ? value.replace(/"/g, '&quot;') : value.replace(/'/g, '&#39;')
}
