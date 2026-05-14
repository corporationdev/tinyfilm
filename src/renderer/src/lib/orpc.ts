import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/message-port'
import type { ContractRouterClient } from '@orpc/contract'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { AppContract } from '../../../shared/contracts/app'

const { port1: clientPort, port2: serverPort } = new MessageChannel()

window.postMessage('rpc:connect', '*', [serverPort])

const link = new RPCLink({
  port: clientPort
})

clientPort.start()

const client = createORPCClient<ContractRouterClient<AppContract>>(link)

export const orpc = createTanstackQueryUtils(client)
