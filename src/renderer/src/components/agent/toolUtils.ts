import type { PiAgentTranscriptItem } from '../../../../shared/contracts/app'

export function toolDetailsText(item: Extract<PiAgentTranscriptItem, { kind: 'tool' }>): string {
  if (
    item.toolName === 'bash' &&
    item.input &&
    typeof item.input === 'object' &&
    typeof (item.input as Record<string, unknown>).command === 'string' &&
    typeof item.output === 'string'
  ) {
    return `$ ${(item.input as Record<string, unknown>).command}\n${item.output}`.trim()
  }

  const parts: string[] = []

  if (item.text?.trim()) {
    parts.push(item.text.trim())
  }

  if (item.input !== undefined) {
    parts.push(`Input\n${formatToolValue(item.input)}`)
  }

  if (item.output !== undefined && formatToolValue(item.output) !== item.text?.trim()) {
    parts.push(`Output\n${formatToolValue(item.output)}`)
  }

  return parts.join('\n\n')
}

function formatToolValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

export function displayToolLabel(item: Extract<PiAgentTranscriptItem, { kind: 'tool' }>): string {
  if (item.status === 'running') {
    return item.label
  }

  if (item.label === 'Running bash') {
    return 'Ran bash'
  }

  return item.label
}
