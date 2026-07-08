// ADB Protocol Implementation for WebUSB & WebSocket

// --- Constants ---
export const A_SYNC = 0x434e5953
export const A_CNXN = 0x4e584e43
export const A_AUTH = 0x48545541
export const A_OPEN = 0x4e45504f
export const A_OKAY = 0x59414b4f
export const A_CLSE = 0x45534c43
export const A_WRTE = 0x45545257
export const A_STLS = 0x534c5453

export const ADB_AUTH_TOKEN = 1
export const ADB_AUTH_SIGNATURE = 2
export const ADB_AUTH_RSAPUBLICKEY = 3

export const ADB_CLASS = 0xff
export const ADB_SUBCLASS = 0x42
export const ADB_PROTOCOL = 0x01

export const ADB_VENDORS = [0x18d1, 0x04e8, 0x12d1, 0x2717, 0x22d9, 0x0bb4, 0x2b4c]

export const CONNECT_STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  AUTHENTICATING: 'authenticating',
  CONNECTED: 'connected',
  ERROR: 'error',
}

// --- CRC32 ---
const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[i] = c
}

function crc32(data) {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// --- ADB Packet ---
const PACKET_HEADER_SIZE = 24

export class AdbPacket {
  constructor(command, arg0, arg1, data) {
    this.command = command
    this.arg0 = arg0
    this.arg1 = arg1
    this.data = data ? new Uint8Array(data) : new Uint8Array(0)
    this.data_crc32 = crc32(this.data)
    this.magic = command ^ 0xffffffff
  }

  get dataLength() {
    return this.data.length
  }

  toBuffer() {
    const buf = new ArrayBuffer(PACKET_HEADER_SIZE + this.dataLength)
    const dv = new DataView(buf)
    dv.setUint32(0, this.command, true)
    dv.setUint32(4, this.arg0, true)
    dv.setUint32(8, this.arg1, true)
    dv.setUint32(12, this.dataLength, true)
    dv.setUint32(16, this.data_crc32, true)
    dv.setUint32(20, this.magic, true)
    if (this.dataLength > 0) {
      new Uint8Array(buf, PACKET_HEADER_SIZE).set(this.data)
    }
    return buf
  }

  static fromBuffer(buffer) {
    if (buffer.byteLength < PACKET_HEADER_SIZE) return null
    const dv = new DataView(buffer)
    const command = dv.getUint32(0, true)
    const arg0 = dv.getUint32(4, true)
    const arg1 = dv.getUint32(8, true)
    const dataLength = dv.getUint32(12, true)
    const dataCrc32 = dv.getUint32(16, true)
    const magic = dv.getUint32(20, true)

    if (magic !== (command ^ 0xffffffff)) return null

    let data = new Uint8Array(0)
    if (dataLength > 0 && buffer.byteLength >= PACKET_HEADER_SIZE + dataLength) {
      data = new Uint8Array(buffer, PACKET_HEADER_SIZE, dataLength)
    }

    return new AdbPacket(command, arg0, arg1, data)
  }

  cmdString() {
    const b = new Uint8Array([
      this.command & 0xff,
      (this.command >> 8) & 0xff,
      (this.command >> 16) & 0xff,
      (this.command >> 24) & 0xff,
    ])
    return new TextDecoder().decode(b)
  }
}

// --- USB ADB Transport ---
export class UsbAdbTransport {
  constructor(usbDevice) {
    this.device = usbDevice
    this.iface = null
    this.inEp = null
    this.outEp = null
    this.maxPacketSize = 0
  }

  async init() {
    await this.device.open()
    const iface = this.device.configuration.interfaces.find((iface) => {
      const alt = iface.alternates[0]
      return (
        alt.interfaceClass === ADB_CLASS &&
        alt.interfaceSubclass === ADB_SUBCLASS &&
        alt.interfaceProtocol === ADB_PROTOCOL
      )
    })

    if (!iface) throw new Error('Không tìm thấy ADB interface trên thiết bị')

    this.iface = iface
    await this.device.claimInterface(iface.interfaceNumber)

    const alt = iface.alternates[0]
    for (const ep of alt.endpoints) {
      if (ep.direction === 'out') this.outEp = ep
      if (ep.direction === 'in') {
        this.inEp = ep
        this.maxPacketSize = ep.packetSize || 1024
      }
    }

    if (!this.inEp || !this.outEp) throw new Error('Không tìm thấy bulk endpoints')
  }

  async send(packet) {
    const buf = packet.toBuffer()
    await this.device.transferOut(this.outEp.endpointNumber, buf)
  }

  async receive() {
    const result = await this.device.transferIn(this.inEp.endpointNumber, this.maxPacketSize)
    return AdbPacket.fromBuffer(result.data.buffer)
  }

  async close() {
    try {
      await this.device.releaseInterface(this.iface.interfaceNumber)
    } catch (e) { /* ignore */ }
    try {
      await this.device.close()
    } catch (e) { /* ignore */ }
  }
}

// --- WebSocket ADB Transport ---
export class WsAdbTransport {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this._buffer = new Uint8Array(0)
    this._resolve = null
    this._reject = null
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.binaryType = 'arraybuffer'

      this.ws.onopen = () => resolve()

      this.ws.onmessage = (event) => {
        const buf = new Uint8Array(event.data)
        this._buffer = concatArrays(this._buffer, buf)
        if (this._buffer.length >= PACKET_HEADER_SIZE && this._resolve) {
          this._tryResolve()
        }
      }

      this.ws.onerror = (e) => {
        if (this._reject) this._reject(new Error('WebSocket error'))
        else reject(new Error('WebSocket connection failed'))
      }

      this.ws.onclose = () => {
        if (this._reject) this._reject(new Error('WebSocket closed'))
      }
    })
  }

  _tryResolve() {
    const packet = AdbPacket.fromBuffer(this._buffer.buffer.slice(0, this._buffer.length))
    if (packet) {
      const totalSize = PACKET_HEADER_SIZE + packet.dataLength
      this._buffer = this._buffer.slice(totalSize)
      const resolve = this._resolve
      this._resolve = null
      this._reject = null
      if (resolve) resolve(packet)
    }
  }

  async send(packet) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(packet.toBuffer())
    }
  }

  async receive() {
    if (this._buffer.length >= PACKET_HEADER_SIZE) {
      const packet = AdbPacket.fromBuffer(this._buffer.buffer.slice(0, this._buffer.length))
      if (packet) {
        const totalSize = PACKET_HEADER_SIZE + packet.dataLength
        this._buffer = this._buffer.slice(totalSize)
        return packet
      }
    }
    return new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })
  }

  async close() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

function concatArrays(a, b) {
  const result = new Uint8Array(a.length + b.length)
  result.set(a)
  result.set(b, a.length)
  return result
}

// --- RSA Key Management ---
export class AdbKeyManager {
  constructor() {
    this.keyPair = null
    this.publicKeyPem = null
  }

  async loadOrGenerate() {
    const stored = localStorage.getItem('adb_keypair')
    if (stored) {
      try {
        const { privateKeyJwk, publicKeyPem } = JSON.parse(stored)
        this.keyPair = await crypto.subtle.importKey(
          'jwk',
          privateKeyJwk,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
          true,
          ['sign']
        )
        this.publicKeyPem = publicKeyPem
        return
      } catch (e) {
        localStorage.removeItem('adb_keypair')
      }
    }

    this.keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-1',
      },
      true,
      ['sign', 'verify']
    )

    const publicKeyJwk = await crypto.subtle.exportKey('jwk', this.keyPair.publicKey)
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', this.keyPair.privateKey)
    this.publicKeyPem = this._jwkToPem(publicKeyJwk)

    localStorage.setItem(
      'adb_keypair',
      JSON.stringify({ privateKeyJwk, publicKeyPem: this.publicKeyPem })
    )
  }

  async sign(token) {
    const sig = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      this.keyPair.privateKey,
      token
    )
    return new Uint8Array(sig)
  }

  _jwkToPem(jwk) {
    const n = this._base64UrlDecode(jwk.n)
    const e = this._base64UrlDecode(jwk.e)
    const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x05, 0x05, 0x00]

    let pkcs1 = new Uint8Array([0x00])
    pkcs1 = concatArrays(pkcs1, n)

    const headerLen = e.length + 2 + pkcs1.length
    let seq = concatArrays(new Uint8Array([0x02, ...this._lenBytes(e.length)]), e)
    seq = concatArrays(seq, new Uint8Array([0x02, ...this._lenBytes(pkcs1.length)]))
    seq = concatArrays(seq, pkcs1)

    const algoSeq = new Uint8Array([0x30, algo.length, ...algo])
    const seq2 = new Uint8Array([0x30, ...this._lenBytes(seq.length)])
    seq = concatArrays(seq2, seq)
    seq = concatArrays(algoSeq, seq)
    const nullBytes = new Uint8Array([0x03, ...this._lenBytes(seq.length + 1), 0x00])
    seq = concatArrays(nullBytes, seq)
    const outerSeq = new Uint8Array([0x30, ...this._lenBytes(seq.length)])
    seq = concatArrays(outerSeq, seq)

    const b64 = btoa(String.fromCharCode(...seq))
    const lines = b64.match(/.{1,64}/g) || [b64]
    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`
  }

  _lenBytes(len) {
    if (len < 128) return [len]
    const bytes = []
    let tmp = len
    while (tmp > 0) { bytes.unshift(tmp & 0xff); tmp >>= 8 }
    return [0x80 | bytes.length, ...bytes]
  }

  _base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/')
    while (str.length % 4) str += '='
    const bin = atob(str)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    return buf
  }
}

// --- ADB Session ---
export class AdbSession {
  constructor(transport) {
    this.transport = transport
    this.keyManager = null
    this.maxPayload = 4096
    this.localId = 1
    this.remoteId = null
    this.version = 0x01000001
    this.product = 'adb-web'
    this.model = 'adb-web'
    this.device = 'adb-web'
    this.features = 'shell_v2,cmd,stat_v2,list_v2,fixed_push_mkdir,apex,abb,abb_exec'
    this.streams = new Map()
    this.onDisconnect = null
  }

  async connect(keyManager) {
    this.keyManager = keyManager

    let packet = await this.transport.receive()
    if (!packet) throw new Error('No response from device')

    if (packet.command === A_CNXN) {
      this.remoteId = packet.arg0
      this.maxPayload = Math.min(this.maxPayload, packet.arg1 || 4096)
      this.version = Math.min(this.version, packet.arg0)

      const cnxnPayload = this._buildConnectPayload()
      await this.transport.send(new AdbPacket(A_CNXN, this.version, this.maxPayload, cnxnPayload))
    }

    while (true) {
      packet = await this.transport.receive()
      if (!packet) throw new Error('Connection lost')

      if (packet.command === A_AUTH) {
        const authType = packet.arg0
        if (authType === ADB_AUTH_TOKEN) {
          try {
            const sig = await this.keyManager.sign(packet.data)
            await this.transport.send(new AdbPacket(A_AUTH, ADB_AUTH_SIGNATURE, 0, sig))
            const sigResponse = await this.transport.receive()
            if (sigResponse.command === A_CNXN) {
              this.remoteId = sigResponse.arg0
              this.maxPayload = Math.min(this.maxPayload, sigResponse.arg1 || 4096)
              return
            }
            if (sigResponse.command === A_AUTH && sigResponse.arg0 === ADB_AUTH_TOKEN) {
              const pubKeyData = new TextEncoder().encode(this.keyManager.publicKeyPem + '\0')
              await this.transport.send(new AdbPacket(A_AUTH, ADB_AUTH_RSAPUBLICKEY, 0, pubKeyData))
              const cnxnResponse = await this.transport.receive()
              if (cnxnResponse.command === A_CNXN) {
                this.remoteId = cnxnResponse.arg0
                this.maxPayload = Math.min(this.maxPayload, cnxnResponse.arg1 || 4096)
                return
              }
            }
          } catch (e) {
            const pubKeyData = new TextEncoder().encode(this.keyManager.publicKeyPem + '\0')
            await this.transport.send(new AdbPacket(A_AUTH, ADB_AUTH_RSAPUBLICKEY, 0, pubKeyData))
            const cnxnResponse = await this.transport.receive()
            if (cnxnResponse.command === A_CNXN) {
              this.remoteId = cnxnResponse.arg0
              this.maxPayload = Math.min(this.maxPayload, cnxnResponse.arg1 || 4096)
              return
            }
          }
        }
      } else if (packet.command === A_CNXN) {
        this.remoteId = packet.arg0
        this.maxPayload = Math.min(this.maxPayload, packet.arg1 || 4096)
        return
      }
    }
  }

  _buildConnectPayload() {
    const props = [
      `product=${this.product}`,
      `model=${this.model}`,
      `device=${this.device}`,
      `features=${this.features}`,
    ]
    return new TextEncoder().encode(`host::${props.join(';')}\0`)
  }

  async openStream(destination) {
    const localId = this.localId++
    await this.transport.send(new AdbPacket(A_OPEN, localId, 0, new TextEncoder().encode(destination + '\0')))

    const response = await this.transport.receive()
    if (response.command === A_OKAY) {
      this.remoteId = response.arg0
      this.streams.set(localId, { localId, remoteId: response.arg0, destination })
      return localId
    }
    if (response.command === A_CLSE) {
      throw new Error(`Stream closed: ${destination}`)
    }
    throw new Error(`Unexpected response: ${response.cmdString()}`)
  }

  async shellStream(command) {
    const streamId = await this.openStream('shell:v2,' + command)
    return { streamId, read: () => this.readStream(streamId), write: (data) => this.writeStream(streamId, data), close: () => this.closeStream(streamId) }
  }

  async shellSimple(command) {
    const streamId = await this.openStream('shell:' + command)
    let output = ''
    while (true) {
      const packet = await this.transport.receive()
      if (packet.command === A_WRTE && packet.arg0 === streamId) {
        await this.transport.send(new AdbPacket(A_OKAY, this.remoteId, streamId))
        output += new TextDecoder().decode(packet.data)
      } else if (packet.command === A_CLSE && (packet.arg0 === streamId || packet.arg1 === streamId)) {
        break
      }
    }
    return output
  }

  async shellBinary(command) {
    const streamId = await this.openStream('shell:' + command)
    const chunks = []
    while (true) {
      const packet = await this.transport.receive()
      if (packet.command === A_WRTE && packet.arg0 === streamId) {
        await this.transport.send(new AdbPacket(A_OKAY, this.remoteId, streamId))
        chunks.push(packet.data)
      } else if (packet.command === A_CLSE && (packet.arg0 === streamId || packet.arg1 === streamId)) {
        break
      }
    }
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0)
    const result = new Uint8Array(totalLen)
    let offset = 0
    for (const c of chunks) {
      result.set(c, offset)
      offset += c.length
    }
    return result
  }

  async readStream(streamId) {
    while (true) {
      const packet = await this.transport.receive()
      if (packet.command === A_WRTE && (packet.arg0 === streamId || packet.arg0 === this.remoteId)) {
        const sid = packet.arg0 === this.remoteId ? streamId : packet.arg0
        await this.transport.send(new AdbPacket(A_OKAY, this.remoteId, sid))
        return packet.data
      }
      if (packet.command === A_CLSE && (packet.arg0 === streamId || packet.arg1 === streamId)) {
        return null
      }
    }
  }

  async writeStream(streamId, data) {
    await this.transport.send(new AdbPacket(A_WRTE, streamId, this.remoteId, data))
    while (true) {
      const packet = await this.transport.receive()
      if (packet.command === A_OKAY && packet.arg0 === this.remoteId) {
        return
      }
    }
  }

  async closeStream(streamId) {
    await this.transport.send(new AdbPacket(A_CLSE, streamId, this.remoteId))
  }

  async getDeviceInfo() {
    const props = ['ro.product.model', 'ro.product.manufacturer', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.serialno']
    const info = {}
    for (const prop of props) {
      try {
        const val = await this.shellSimple(`getprop ${prop}`)
        info[prop] = val.trim()
      } catch (e) {
        info[prop] = ''
      }
    }
    return info
  }

  async takeScreenshot() {
    const data = await this.shellBinary('screencap -p')
    if (data.length > 0) {
      let binary = ''
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
      return 'data:image/png;base64,' + btoa(binary)
    }
    return null
  }

  async listFiles(path) {
    const output = await this.shellSimple(`ls -la ${path || '/sdcard'}`)
    return output.split('\n').filter(l => l.trim()).map(l => {
      const isDir = l.startsWith('d')
      const match = l.match(/\d{2}:\d{2}(?::\d{2})?\s+(.+)$/)
      const name = match ? match[1].trim() : l.trim()
      const parts = l.split(/\s+/)
      const size = parts.length > 4 && /^\d+$/.test(parts[4]) ? parts[4] : ''
      return { raw: l, name, isDir, size }
    })
  }

  async listApps() {
    const output = await this.shellSimple('pm list packages -3')
    return output.split('\n').filter(l => l.startsWith('package:')).map(l => l.replace('package:', '').trim()).sort()
  }

  async getLogcat(lines = 100) {
    return await this.shellSimple(`logcat -t ${lines} 2>/dev/null || logcat -d -t ${lines}`)
  }

  async downloadFile(path) {
    return await this.shellBinary(`cat "${path}"`)
  }

  async pushFile(path, data) {
    let binary = ''
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
    const b64 = btoa(binary)
    const tmp = '/data/local/tmp/_adb_push'
    const CHUNK = 32000
    for (let i = 0; i < b64.length; i += CHUNK) {
      const part = b64.slice(i, i + CHUNK)
      await this.shellSimple(`echo -n "${part}" ${i === 0 ? '>' : '>>'} ${tmp}`)
    }
    await this.shellSimple(`base64 -d ${tmp} > '${path}' && rm ${tmp}`)
    return true
  }

  async installApk(apkData) {
    const tmp = '/data/local/tmp/_adb_install.apk'
    await this.pushFile(tmp, apkData)
    const result = await this.shellSimple(`pm install -r ${tmp} 2>/dev/null; rm ${tmp}`)
    return result
  }

  async screenRecord(duration = 15) {
    const path = '/data/local/tmp/_adb_rec.mp4'
    await this.shellSimple(`screenrecord --time-limit ${Math.max(3, duration)} ${path} 2>/dev/null`)
    const data = await this.downloadFile(path)
    await this.shellSimple(`rm ${path}`)
    return data
  }

  async getBattery() {
    const out = await this.shellSimple('dumpsys battery 2>/dev/null')
    const info = {}
    out.split('\n').forEach(l => {
      const m = l.match(/\s+(\w+):\s+(.+)/)
      if (m) info[m[1]] = m[2]
    })
    if (info.temperature) info.temperature = (parseInt(info.temperature) / 10).toFixed(1)
    return info
  }

  async getStorage() {
    const out = await this.shellSimple("df -h /data /sdcard 2>/dev/null | grep -v Filesystem")
    return out.split('\n').filter(l => l.trim()).map(l => {
      const p = l.split(/\s+/)
      return p.length >= 6 ? { fs: p[0], size: p[1], used: p[2], avail: p[3], use: p[4], mount: p[5] } : { raw: l }
    })
  }

  async getProcesses() {
    const out = await this.shellSimple('ps -A 2>/dev/null || ps')
    const lines = out.split('\n').filter(l => l.trim())
    return lines.slice(1).map(l => {
      const p = l.split(/\s+/)
      const pid = p.length > 1 && /^\d+$/.test(p[1]) ? p[1] : p[0]
      return { raw: l, pid, name: p[p.length - 1] }
    }).filter(x => x.pid && x.name)
  }

  async disconnect() {
    try {
      await this.transport.close()
    } catch (e) { /* ignore */ }
    if (this.onDisconnect) this.onDisconnect()
  }
}

// --- Connection Manager ---
export class AdbConnectionManager {
  constructor() {
    this.session = null
    this.keyManager = new AdbKeyManager()
    this.state = CONNECT_STATE.DISCONNECTED
    this.error = null
    this.onStateChange = null
    this.deviceInfo = null
  }

  async connectUsb() {
    if (this.session) await this.disconnect()
    this._setState(CONNECT_STATE.CONNECTING)

    try {
      if (!navigator.usb) throw new Error('WebUSB không được hỗ trợ. Dùng Chrome/Edge trên HTTPS hoặc localhost.')

      const usbDevice = await navigator.usb.requestDevice({
        filters: ADB_VENDORS.map(vid => ({ vendorId: vid })),
      })

      const transport = new UsbAdbTransport(usbDevice)
      await transport.init()

      this._setState(CONNECT_STATE.AUTHENTICATING)
      await this.keyManager.loadOrGenerate()

      this.session = new AdbSession(transport)
      this.session.onDisconnect = () => this._setState(CONNECT_STATE.DISCONNECTED)
      await this.session.connect(this.keyManager)

      this.deviceInfo = await this.session.getDeviceInfo()
      this._setState(CONNECT_STATE.CONNECTED)
      return true
    } catch (err) {
      this.error = err.message
      this._setState(CONNECT_STATE.ERROR)
      return false
    }
  }

  async connectWifi(wsUrl) {
    if (this.session) await this.disconnect()
    this._setState(CONNECT_STATE.CONNECTING)

    try {
      const transport = new WsAdbTransport(wsUrl)
      await transport.init()

      this._setState(CONNECT_STATE.AUTHENTICATING)
      await this.keyManager.loadOrGenerate()

      this.session = new AdbSession(transport)
      this.session.onDisconnect = () => this._setState(CONNECT_STATE.DISCONNECTED)
      await this.session.connect(this.keyManager)

      this.deviceInfo = await this.session.getDeviceInfo()
      this._setState(CONNECT_STATE.CONNECTED)
      return true
    } catch (err) {
      this.error = err.message
      this._setState(CONNECT_STATE.ERROR)
      return false
    }
  }

  async disconnect() {
    if (this.session) {
      await this.session.disconnect()
      this.session = null
    }
    this.deviceInfo = null
    this._setState(CONNECT_STATE.DISCONNECTED)
  }

  async execShell(command) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.shellSimple(command)
  }

  async execShellStream(command) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.shellStream(command)
  }

  async execShellBinary(command) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.shellBinary(command)
  }

  async getDeviceInfo() {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    this.deviceInfo = await this.session.getDeviceInfo()
    return this.deviceInfo
  }

  async takeScreenshot() {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.takeScreenshot()
  }

  async listFiles(path) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.listFiles(path)
  }

  async listApps() {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.listApps()
  }

  async getLogcat(lines) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.getLogcat(lines)
  }

  async downloadFile(path) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.downloadFile(path)
  }

  async pushFile(path, data) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.pushFile(path, data)
  }

  async installApk(data) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.installApk(data)
  }

  async screenRecord(duration) {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.screenRecord(duration)
  }

  async getBattery() {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.getBattery()
  }

  async getStorage() {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.getStorage()
  }

  async getProcesses() {
    if (!this.session) throw new Error('Chưa kết nối thiết bị')
    return await this.session.getProcesses()
  }

  _setState(state) {
    this.state = state
    if (this.onStateChange) this.onStateChange(state)
  }
}
