/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string
          srcdoc?: string
          width?: number
          height?: number
          controls?: boolean | string
          autoplay?: boolean | string
          loop?: boolean | string
          muted?: boolean | string
          poster?: string
          'playback-rate'?: number | string
        },
        HTMLElement
      >
    }
  }
}

export {}
