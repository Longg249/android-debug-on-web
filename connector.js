/**
 * ADB Web Connector
 *
 * Run this on your PC to bridge Relay ↔ Android device.
 * Connects to the relay server, waits for target, opens TCP to device.
 *
 * Usage:
 *   node connector.js
 *
 * Env:
 *   RELAY_URL - WebSocket URL of the relay server (default: ws://localhost:8080)
 *
 * Architecture:
 *   Relay <--WSS-- Connector --TCP--> Android ADB
 */

const WebSocket = require('ws')
const net = require('net')

const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:8080'
let ws = null
let tcp = null
let reconnectTimer = null
let connecting = false

function connectWs() {
  if (connecting) return
  connecting = true

  ws = new WebSocket(`${RELAY_URL.replace(/\/$/, '')}/connector`)

  ws.on('open', () => {
    console.log(`Connected to relay: ${RELAY_URL}/connector`)
    connecting = false
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())

      if (msg.type === 'registered') {
        console.log('Registered with relay, waiting for target...')
        return
      }

      if (msg.type === 'target') {
        const [host, portStr] = msg.target.split(':')
        const port = parseInt(portStr, 10) || 5555
        console.log(`Target received: ${host}:${port}`)
        connectTcp(host, port)
        return
      }
    } catch (e) {
      // Binary data from relay → forward to TCP device
      if (tcp && !tcp.destroyed) {
        tcp.write(Buffer.from(data))
      }
    }
  })

  ws.on('close', () => {
    console.log('Disconnected from relay, reconnecting in 3s...')
    connecting = false
    if (tcp) { tcp.destroy(); tcp = null }
    reconnectTimer = setTimeout(connectWs, 3000)
  })

  ws.on('error', () => {
    connecting = false
    ws.close()
  })
}

function connectTcp(host, port) {
  if (tcp) tcp.destroy()

  tcp = new net.Socket()

  tcp.connect(port, host, () => {
    console.log(`TCP connected to ${host}:${port}`)
  })

  tcp.on('data', (data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  })

  tcp.on('close', () => {
    console.log('TCP disconnected')
    tcp = null
  })

  tcp.on('error', (err) => {
    console.error(`TCP error: ${err.message}`)
  })
}

connectWs()

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  if (tcp) tcp.destroy()
  if (ws) ws.close()
  if (reconnectTimer) clearTimeout(reconnectTimer)
  process.exit(0)
})
