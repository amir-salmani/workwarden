import { DurableObject } from 'cloudflare:workers'
import type { Packable } from './signalr/messagepack.ts'
import {
  encodeHandshakeResponse,
  MessageType,
  notify,
  parseHandshake,
  ping,
  unframe,
} from './signalr/protocol.ts'

/**
 * One hub per user, holding that user's open clients.
 *
 * WebSocket hibernation matters here: a vault sits idle for hours between
 * changes, and without it every connected device would keep a Durable Object
 * resident and billed the whole time. Hibernating means the sockets survive
 * while the object does not.
 */
export class NotificationHub extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/broadcast')) {
      const { type, payload } = (await request.json()) as { type: number; payload: Packable }
      return new Response(String(this.broadcast(type, payload)))
    }

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 })
    }

    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * The first message is the JSON handshake; everything after it is
   * length-prefixed MessagePack. A socket that has not handshaken yet is
   * tracked by its attachment rather than a field, because hibernation throws
   * instance state away.
   */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const done = ws.deserializeAttachment() as { handshaken?: boolean } | null

    if (!done?.handshaken) {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const handshake = parseHandshake(text)
      if (!handshake) return
      if (handshake.protocol !== 'messagepack') {
        ws.send(encodeHandshakeResponse(`unsupported protocol: ${handshake.protocol}`))
        ws.close(1002, 'unsupported protocol')
        return
      }
      ws.serializeAttachment({ handshaken: true })
      ws.send(encodeHandshakeResponse())
      return
    }

    if (typeof message === 'string') return
    const { messages } = unframe(new Uint8Array(message))
    for (const frame of messages) {
      // Keepalive only. Clients do not invoke anything on this hub.
      if (Array.isArray(frame) && frame[0] === MessageType.Ping) ws.send(ping())
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // 1005 means "no status", which close() rejects as an argument.
    ws.close(code === 1005 ? 1000 : code, reason)
  }

  broadcast(type: number, payload: Packable): number {
    const message = notify(type, payload)
    let delivered = 0
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as { handshaken?: boolean } | null
      if (!state?.handshaken) continue
      try {
        ws.send(message)
        delivered++
      } catch {
        // A socket that has gone away is not a reason to skip the others.
      }
    }
    return delivered
  }
}
