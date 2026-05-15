import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { ErrorBanner } from '../components/common/ErrorBanner'
import { Button } from '../components/ui/button'
import { orpc } from '../lib/orpc'

export function SettingsPage(props: { onBack: () => void }): React.JSX.Element {
  const [geminiKey, setGeminiKey] = useState('')
  const authStatusQuery = useQuery(orpc.agents.getGeminiAuthStatus.queryOptions())
  const setGeminiApiKey = useMutation(
    orpc.agents.setGeminiApiKey.mutationOptions({
      onSuccess: () => {
        setGeminiKey('')
        void authStatusQuery.refetch()
      }
    })
  )
  const activeError = authStatusQuery.error ?? setGeminiApiKey.error

  return (
    <main className="flex min-h-svh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button size="icon" title="Back to projects" variant="ghost" onClick={props.onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-500">Tinyfilm</p>
            <h1 className="truncate text-lg font-semibold tracking-normal">Settings</h1>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-8">
        {activeError ? <ErrorBanner error={activeError} /> : null}

        <form
          className="rounded-md border border-zinc-800 bg-zinc-900 p-5"
          onSubmit={(event) => {
            event.preventDefault()
            setGeminiApiKey.mutate({ apiKey: geminiKey })
          }}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-zinc-100">Gemini API key</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {authStatusQuery.data?.configured
                  ? 'A google provider key is configured for Pi.'
                  : 'Required before Pi can respond in project chats.'}
              </p>
            </div>
            <KeyRound className="size-5 shrink-0 text-zinc-500" />
          </div>

          <label className="mb-2 block text-xs font-medium text-zinc-400" htmlFor="gemini-key">
            API key
          </label>
          <input
            id="gemini-key"
            className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500"
            placeholder={
              authStatusQuery.data?.configured
                ? 'Paste a new key to replace it'
                : 'Paste GEMINI_API_KEY'
            }
            type="password"
            value={geminiKey}
            onChange={(event) => setGeminiKey(event.target.value)}
          />

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button disabled={!geminiKey.trim() || setGeminiApiKey.isPending} type="submit">
              {setGeminiApiKey.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Save key
            </Button>
          </div>
        </form>
      </section>
    </main>
  )
}
