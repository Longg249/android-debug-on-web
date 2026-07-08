const WebSocket = require('ws')
const net = require('net')
const os = require('os')

const PROXY_PORT = parseInt(process.env.PROXY_PORT, 10) || 8787
const DEFAULT_ADB_PORT = parseInt(process.env.ADB_PORT, 10) || 5555

const DEFAULT_TARGET = process.argv[2] || process.env.ADB_HOST || ''
const [defaultHost, defaultPortStr] = DEFAULT_TARGET.split(':')
const defaultPort = defaultPortStr ? parseInt(defaultPortStr, 10) : DEFAULT_ADB_PORT

const interfaces = os.networkInterfaces()
const ips = []
for (const name of Object.keys(interfaces)) {
  for (const iface of interfaces[name]) {
    if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address)
  }
}

console.log('ADB WiFi Proxy')
console.log('='.repeat(40))
console.log(`Listening on ws://0.0.0.0:${PROXY_PORT}`)
ips.forEach(ip => console.log(`LAN access: ws://${ip}:${PROXY_PORT}`))
console.log('')
console.log('Usage:')
console.log(`  1. adb tcpip ${DEFAULT_ADB_PORT}`)
console.log(`  2. adb connect <DEVICE_IP>:${DEFAULT_ADB_PORT}`)
console.log(`  3. In web app, enter device IP and connect`)
if (DEFAULT_TARGET) console.log(`\nDefault target: ${defaultHost}:${defaultPort}`)
console.log('')

const wss = new WebSocket.Server({ port: PROXY_PORT })

function parseTarget(req) {
  try {
    const url = new URL(req.url, 'http://localhost')
    const pm = url.pathname.match(/\/connect\/([^:]+)(?::(\d+))?/)
    if (pm) return { host: pm[1], port: pm[2] ? parseInt(pm[2], 10) : DEFAULT_ADB_PORT }
    const qt = url.searchParams.get('target')
    if (qt) {
      const p = qt.split(':')
      return { host: p[0], port: p[1] ? parseInt(p[1], 10) : DEFAULT_ADB_PORT }
    }
  } catch {}
  if (defaultHost) return { host: defaultHost, port: defaultPort }
  return null
}

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress
  const target = parseTarget(req)

  if (!target) {
    ws.send(JSON.stringify({ type: 'error', message: 'No device target. Use /connect/IP:PORT or set ADB_HOST' }))
    ws.close()
    return
  }

  console.log(`+ ${clientIp} → ${target.host}:${target.port}`)

  const pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping() }, 30000)
  let destroyed = false
  let tcpRetry = null

  function connectTcp() {
    const sock = new net.Socket()
    let connected = false

    sock.connect(target.port, target.host, () => {
      connected = true
      console.log(`  tcp connected ${target.host}:${target.port}`)
    })

    sock.on('data', (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })

    sock.on('close', () => {
      if (!connected) {
        if (!destroyed) tcpRetry = setTimeout(connectTcp, 2000)
        return
      }
      clearInterval(pingTimer)
      if (ws.readyState === WebSocket.OPEN) ws.close()
    })

    sock.on('error', () => { if (!connected) sock.destroy() })

    return sock
  }

  const tcp = connectTcp()

  ws.on('message', (data) => { if (!tcp.destroyed) tcp.write(typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)) })

  ws.on('close', () => {
    destroyed = true
    clearInterval(pingTimer)
    if (tcpRetry) clearTimeout(tcpRetry)
    if (!tcp.destroyed) tcp.destroy()
  })

  ws.on('error', () => {
    destroyed = true
    clearInterval(pingTimer)
    if (tcpRetry) clearTimeout(tcpRetry)
    if (!tcp.destroyed) tcp.destroy()
  })
})

process.on('SIGINT', () => { console.log('\nShutdown.'); wss.close(() => process.exit(0)) })
process.on('SIGTERM', () => { console.log('\nShutdown.'); wss.close(() => process.exit(0)) })
