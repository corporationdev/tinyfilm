import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

function copyMainMigrations(): Plugin {
  return {
    name: 'copy-main-assets',
    closeBundle() {
      const copies = [
        ['src/main/db/migrations', 'out/main/migrations'],
        ['src/main/assets/indexer', 'out/main/assets/indexer']
      ] as const

      for (const [sourcePath, destinationPath] of copies) {
        const source = resolve(sourcePath)
        const destination = resolve(destinationPath)

        if (!existsSync(source)) {
          continue
        }

        cpSync(source, destination, { recursive: true })
      }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['@hyperframes/core', 'hono']
      },
      rollupOptions: {
        output: {
          format: 'cjs'
        }
      }
    },
    plugins: [copyMainMigrations()],
    ssr: {
      noExternal: [
        '@earendil-works/pi-coding-agent',
        '@earendil-works/pi-agent-core',
        '@earendil-works/pi-ai',
        '@earendil-works/pi-tui'
      ]
    }
  },
  preload: {},
  renderer: {
    publicDir: resolve('src/renderer/public'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          previewRecorder: resolve('src/renderer/preview-recorder.html')
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@hyperframes/core/runtime/lottie-readiness': resolve(
          'src/renderer/src/hyperframes/lottieReadiness.ts'
        )
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
