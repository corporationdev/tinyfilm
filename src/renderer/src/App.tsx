import { Button } from '@/components/ui/button'

function App(): React.JSX.Element {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-normal">shadcn/ui is ready</h1>
      <Button>Click me</Button>
    </main>
  )
}

export default App
