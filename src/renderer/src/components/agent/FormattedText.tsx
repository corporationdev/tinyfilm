export function FormattedText(props: { text: string }): React.JSX.Element {
  const blocks = props.text.split(/\n{2,}/).filter((block) => block.trim())

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        const lines = block.split('\n').filter((line) => line.trim())
        const isList = lines.every((line) => /^\s*[-*]\s+/.test(line))

        if (isList) {
          return (
            <ul className="list-disc space-y-1 pl-5" key={`${index}-${block.slice(0, 12)}`}>
              {lines.map((line, lineIndex) => (
                <li key={`${lineIndex}-${line.slice(0, 12)}`}>
                  <InlineCodeText text={line.replace(/^\s*[-*]\s+/, '')} />
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p className="whitespace-pre-wrap break-words" key={`${index}-${block.slice(0, 12)}`}>
            <InlineCodeText text={block} />
          </p>
        )
      })}
    </div>
  )
}

function InlineCodeText(props: { text: string }): React.JSX.Element {
  const segments = props.text.split(/(`[^`]+`)/g)

  return (
    <>
      {segments.map((segment, index) =>
        segment.startsWith('`') && segment.endsWith('`') ? (
          <code
            className="rounded-sm border border-zinc-800 bg-zinc-950 px-1 py-0.5 font-mono text-[0.92em] text-zinc-300"
            key={`${index}-${segment}`}
          >
            {segment.slice(1, -1)}
          </code>
        ) : (
          <span key={`${index}-${segment.slice(0, 12)}`}>{segment}</span>
        )
      )}
    </>
  )
}
