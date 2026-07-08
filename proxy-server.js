/**
 * WebSocket-TCP Proxy cho ADB qua WiFi
 *
 * Usage: node proxy-server.js <device_ip>[:port]
 *   env: PROXY_PORT (default 8787), ADB_PORT (default 5555)
 */

const WebSocket = require('ws')
const net = require('net')

const PROXY_PORT = parseInt(process.env.PROXY_PORT, 10) || 8787
const DEFAULT_ADB_PORT = parseInt(process.env.ADB_PORT, 10) || 5555

const deviceTarget = process.argv[2] || process.env.ADB_HOST
if (!deviceTarget) {
  console.error('Missing device address.')
  console.error('Usage: node proxy-server.js <device_ip>')
  process.exit(1)
}

const [targetHost, targetPortStr] = deviceTarget.split(':')
const targetPort = targetPortStr ? parseInt(targetPortStr, 10) : DEFAULT_ADB_PORT

const wss = new WebSocket.Server({ port: PROXY_PORT })

console.log(`WebSocket proxy listening on ws://0.0.0.0:${PROXY_PORT}`)
console.log(`Forwarding to ${targetHost}:${targetPort}`)

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress
  console.log(`+ connection from ${clientIp}`)

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
  }, 30000)

  let tcpReconnectTimer = null
  let destroyed = false

  function createTcpConnection() {
    const sock = new net.Socket()
    let connected = false

    sock.connect(targetPort, targetHost, () => {
      connected = true
      console.log(`  tcp connected ${targetHost}:${targetPort}`)
    })

    sock.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })

    sock.on('close', () => {
      if (!connected) {
        console.log(`  tcp connection failed, retrying...`)
        if (!destroyed) {
          tcpReconnectTimer = setTimeout(createTcpConnection, 2000)
        }
        return
      }
      console.log(`- tcp closed (${targetHost}:${targetPort})`)
      clearInterval(pingTimer)
      if (ws.readyState === WebSocket.OPEN) ws.close()
    })

    sock.on('error', (err) => {
      if (!connected) {
        console.log(`  tcp error: ${err.message}`)
        sock.destroy()
        return
      }
      console.error(`  tcp error: ${err.message}`)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }))
      }
    })

    return sock
  }

  const tcpSocket = createTcpConnection()

  ws.on('message', (data) => {
    const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)
    if (!tcpSocket.destroyed) tcpSocket.write(buf)
  })

  ws.on('close', () => {
    console.log(`- websocket closed (${clientIp})`)
    destroyed = true
    clearInterval(pingTimer)
    if (tcpReconnectTimer) clearTimeout(tcpReconnectTimer)
    if (!tcpSocket.destroyed) tcpSocket.destroy()
  })

  ws.on('error', (err) => {
    console.error(`  ws error: ${err.message}`)
    destroyed = true
    clearInterval(pingTimer)
    if (tcpReconnectTimer) clearTimeout(tcpReconnectTimer)
    if (!tcpSocket.destroyed) tcpSocket.destroy()
  })
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  wss.close(() => process.exit(0))
})

process.on('SIGTERM', () => {
  console.log('\nShutting down...')
  wss.close(() => process.exit(0))
})
