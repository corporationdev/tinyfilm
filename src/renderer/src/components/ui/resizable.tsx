import * as React from 'react'
import { GripVertical } from 'lucide-react'
import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '@/lib/utils'

const ResizablePanelGroup = ({
  className,
  direction,
  orientation,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group> & {
  direction?: React.ComponentProps<typeof ResizablePrimitive.Group>['orientation']
}): React.JSX.Element => {
  const resolvedOrientation = orientation ?? direction

  return (
    <ResizablePrimitive.Group
      className={cn('flex h-full w-full', className)}
      orientation={resolvedOrientation}
      {...props}
    />
  )
}

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
}): React.JSX.Element => (
  <ResizablePrimitive.Separator
    className={cn(
      'relative flex w-px cursor-col-resize items-center justify-center bg-zinc-800 after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-zinc-700 focus-visible:ring-1 focus-visible:ring-zinc-500 focus-visible:ring-offset-1 focus-visible:outline-none aria-orientation-vertical:h-px aria-orientation-vertical:w-full aria-orientation-vertical:cursor-row-resize aria-orientation-vertical:after:inset-x-0 aria-orientation-vertical:after:top-1/2 aria-orientation-vertical:after:h-2 aria-orientation-vertical:after:w-full aria-orientation-vertical:after:-translate-y-1/2 aria-orientation-vertical:after:translate-x-0 [&[aria-orientation=vertical]>div]:rotate-90',
      className
    )}
    {...props}
  >
    {withHandle ? (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-zinc-700 bg-zinc-900">
        <GripVertical className="size-2.5" />
      </div>
    ) : null}
  </ResizablePrimitive.Separator>
)

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
