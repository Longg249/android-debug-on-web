/**
 * WebSocket Relay Server for ADB Web
 * Deploy this on Railway / Render / Fly.io
 *
 * Bridge between the browser (Vercel) and the connector (your PC)
 * Browser --WSS--> Relay <--WSS-- Connector --TCP--> Android
 *
 * Deploy:
 *   1. Install: npm install ws
 *   2. Run: node relay-server.js
 *   3. Or deploy to Railway: https://railway.app
 */

const WebSocket = require('ws')
const url = require('url')

const PORT = process.env.PORT || 8080

// Single connector at a time for simplicity
let connector = null

const wss = new WebSocket.Server({ port: PORT })

wss.on('connection', (ws, req) => {
  const pathname = url.parse(req.url).pathname

  // ─── Connector (runs on user's PC, long-lived) ───
  if (pathname === '/connector') {
    console.log('[connector] connected')
    connector = ws
    ws.send(JSON.stringify({ type: 'registered' }))

    ws.on('message', (data) => {
      if (ws.paired && ws.paired.readyState === WebSocket.OPEN)
        ws.paired.send(data)
    })

    ws.on('close', () => {
      console.log('[connector] disconnected')
      if (ws.paired) { ws.paired.close(); ws.paired = null }
      connector = null
    })

    ws.on('error', () => {})
    return
  }

  // ─── Bridge (browser on Vercel, per-session) ───
  if (pathname === '/bridge') {
    const query = url.parse(req.url, true).query

    if (!connector) {
      ws.send(JSON.stringify({ type: 'error', message: 'Connector not running on PC' }))
      ws.close()
      return
    }

    ws.paired = connector
    connector.paired = ws

    // Tell connector the target device
    if (query.target) {
      connector.send(JSON.stringify({ type: 'target', target: query.target }))
    }

    ws.on('message', (data) => {
      if (connector && connector.readyState === WebSocket.OPEN)
        connector.send(data)
    })

    ws.on('close', () => {
      if (connector && connector.paired === ws) connector.paired = null
    })

    ws.on('error', () => {})
    return
  }

  ws.close()
})

console.log(`Relay server listening on port ${PORT}`)
console.log(`Connector endpoint: ws://0.0.0.0:${PORT}/connector`)
console.log(`Bridge endpoint:   ws://0.0.0.0:${PORT}/bridge?target=IP:PORT`)
