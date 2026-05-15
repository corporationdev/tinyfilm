import type { PiAgentTranscriptItem } from '../../../../shared/contracts/app'

export function mergeOptimisticTranscript(
  transcript: PiAgentTranscriptItem[],
  optimistic: PiAgentTranscriptItem[]
): PiAgentTranscriptItem[] {
  if (optimistic.length === 0) {
    return transcript
  }

  const next = [...transcript]
  for (const item of optimistic) {
    if (
      item.kind === 'message' &&
      item.role === 'user' &&
      hasMatchingUserMessage(next, item.text)
    ) {
      continue
    }
    next.push(item)
  }

  return next
}

export function hasMatchingUserMessage(transcript: PiAgentTranscriptItem[], text: string): boolean {
  const normalized = normalizeMessageText(text)
  return transcript.some(
    (item) =>
      item.kind === 'message' &&
      item.role === 'user' &&
      normalizeMessageText(item.text) === normalized
  )
}

export function shouldKeepOptimisticItem(
  transcript: PiAgentTranscriptItem[],
  item: PiAgentTranscriptItem,
  optimisticItems: PiAgentTranscriptItem[]
): boolean {
  if (item.kind === 'message' && item.role === 'user') {
    return !hasMatchingUserMessage(transcript, item.text)
  }

  if (isThinkingActivity(item)) {
    const optimisticUser = optimisticItems.find(
      (candidate): candidate is Extract<PiAgentTranscriptItem, { kind: 'message' }> =>
        candidate.kind === 'message' &&
        candidate.role === 'user' &&
        item.id === `${candidate.id}-thinking`
    )
    return !optimisticUser || !hasAgentWorkAfterMatchingUser(transcript, optimisticUser.text)
  }

  return true
}

function hasAgentWorkAfterMatchingUser(transcript: PiAgentTranscriptItem[], text: string): boolean {
  const normalized = normalizeMessageText(text)
  let lastUserIndex = -1

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index]
    if (
      item.kind === 'message' &&
      item.role === 'user' &&
      normalizeMessageText(item.text) === normalized
    ) {
      lastUserIndex = index
      break
    }
  }

  if (lastUserIndex < 0) {
    return false
  }

  return transcript
    .slice(lastUserIndex + 1)
    .some((item) => item.kind === 'tool' || (item.kind === 'message' && item.role === 'assistant'))
}

export function isThinkingActivity(item: PiAgentTranscriptItem): boolean {
  return item.kind === 'activity' && item.label === 'Thinking...'
}

export function shouldShowTranscriptItem(item: PiAgentTranscriptItem): boolean {
  if (item.kind === 'message') {
    return item.text.trim().length > 0
  }

  if (item.kind === 'tool') {
    return Boolean(item.toolName || item.text || item.input || item.output)
  }

  return item.label.trim().length > 0
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function titleFromMessage(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 64) || 'New chat'
}
