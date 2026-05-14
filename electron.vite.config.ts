import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

function copyMainMigrations(): Plugin {
  return {
    name: 'copy-main-migrations',
    closeBundle() {
      const source = resolve('src/main/db/migrations')
      const destination = resolve('out/main/migrations')

      if (!existsSync(source)) {
        return
      }

      cpSync(source, destination, { recursive: true })
    }
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: []
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
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
