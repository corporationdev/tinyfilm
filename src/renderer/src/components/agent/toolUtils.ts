import type { PiAgentTranscriptItem } from '../../../../shared/contracts/app'

type ToolTranscriptItem = Extract<PiAgentTranscriptItem, { kind: 'tool' }>

export type ToolDetailSection = {
  label: 'Input' | 'Output' | 'Details'
  value: string
}

export function toolDetailSections(item: ToolTranscriptItem): ToolDetailSection[] {
  const sections: ToolDetailSection[] = []
  const input = item.input === undefined ? undefined : formatToolValue(item.input)
  const output = item.output === undefined ? undefined : formatToolValue(item.output)
  const text = item.text?.trim()

  if (input) {
    sections.push({ label: 'Input', value: input })
  }

  if (output) {
    sections.push({ label: 'Output', value: output })
  } else if (text) {
    sections.push({ label: 'Output', value: text })
  }

  if (text && text !== output && item.output !== undefined) {
    sections.push({ label: 'Details', value: text })
  }

  return sections
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
