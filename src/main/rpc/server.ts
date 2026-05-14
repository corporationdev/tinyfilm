import { RPCHandler } from '@orpc/server/message-port'
import { ipcMain } from 'electron'
import { appRouter } from './router'

export function registerRpcServer(): void {
  const handler = new RPCHandler(appRouter)

  ipcMain.on('rpc:connect', (event) => {
    const [port] = event.ports

    if (!port) {
      return
    }

    handler.upgrade(port, {
      context: {}
    })

    port.start()
  })
}
