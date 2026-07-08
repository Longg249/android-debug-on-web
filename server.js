const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const WebSocket = require('ws')
const net = require('net')

const dev = process.env.NODE_ENV !== 'production' && !process.argv.includes('--prod')
const port = parseInt(process.env.PORT, 10) || 3000

const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true))
  })

  const wss = new WebSocket.Server({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = parse(req.url, true)
    if (url.pathname !== '/adb-proxy') { socket.destroy(); return }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const target = url.query.target
      if (!target) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing target param' }))
        ws.close()
        return
      }
      const [host, p] = target.split(':')
      const portNum = parseInt(p, 10) || 5555

      const tcp = new net.Socket()
      let destroyed = false

      tcp.connect(portNum, host, () => {})
      tcp.on('data', (d) => { if (ws.readyState === WebSocket.OPEN) ws.send(d) })
      tcp.on('error', () => { if (!destroyed) tcp.destroy() })
      tcp.on('close', () => { if (ws.readyState === WebSocket.OPEN) ws.close() })

      ws.on('message', (d) => { if (!tcp.destroyed) tcp.write(Buffer.from(d)) })
      ws.on('close', () => { destroyed = true; if (!tcp.destroyed) tcp.destroy() })
      ws.on('error', () => { destroyed = true; if (!tcp.destroyed) tcp.destroy() })
    })
  })

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`> Ready on http://localhost:${port}`)
    console.log(`> ADB proxy on ws://localhost:${port}/adb-proxy?target=DEVICE_IP:PORT`)
  })
})
