export function ErrorBanner(props: { error: unknown }): React.JSX.Element {
  return (
    <div className="mx-5 mt-4 rounded-md border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">
      {props.error instanceof Error ? props.error.message : 'Something went wrong'}
    </div>
  )
}
