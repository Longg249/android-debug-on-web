import { useState, useEffect, useRef, useCallback } from 'react'
import { AdbConnectionManager, CONNECT_STATE } from '../lib/adb'

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return <div className={`toast ${type}`}>{message}</div>
}

function DeviceInfo({ deviceInfo, onRefresh }) {
  if (!deviceInfo) return null
  const fields = [
    { label: 'Model', key: 'ro.product.model' },
    { label: 'Hãng', key: 'ro.product.manufacturer' },
    { label: 'Android', key: 'ro.build.version.release' },
    { label: 'SDK', key: 'ro.build.version.sdk' },
    { label: 'Serial', key: 'ro.serialno' },
  ]
  return (
    <div className="device-card fade-in">
      <div className="device-card-header">
        <h3>Thiết bị</h3>
        <button className="btn btn-sm btn-ghost" onClick={onRefresh} title="Làm mới">⟳</button>
      </div>
      <div className="device-body">
        {fields.map(f => (
          <div key={f.key} className="device-row">
            <span className="label">{f.label}</span>
            <span className="value">{deviceInfo[f.key] || '--'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuickActions({ onScreenshot, onShell, onFiles, onApps, onLogcat }) {
  const items = [
    { icon: '💻', label: 'Shell', action: onShell },
    { icon: '📷', label: 'Screenshot', action: onScreenshot },
    { icon: '📁', label: 'Files', action: onFiles },
    { icon: '📦', label: 'Apps', action: onApps },
    { icon: '📋', label: 'Logcat', action: onLogcat },
  ]
  return (
    <div className="quick-actions">
      <div className="qa-header"><h3>Thao tác</h3></div>
      <div className="qa-body">
        {items.map(it => (
          <button key={it.label} className="qa-item" onClick={it.action}>
            <span className="qa-icon">{it.icon}</span>
            <span className="qa-label">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ShellPanel({ manager }) {
  const [cmd, setCmd] = useState('')
  const [lines, setLines] = useState([])
  const [busy, setBusy] = useState(false)
  const [stream, setStream] = useState(null)
  const outRef = useRef(null)
  const inpRef = useRef(null)

  const addLine = (text, type = 'output') => setLines(prev => [...prev, { text, type }])

  useEffect(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight }, [lines])

  useEffect(() => {
    return () => { if (stream) stream.close().catch(() => {}) }
  }, [stream])

  async function runOnce(c) {
    setBusy(true)
    addLine(`$ ${c}\n`, 'prompt')
    try {
      const out = await manager.execShell(c)
      addLine(out || '(no output)\n')
    } catch (err) {
      addLine(`Error: ${err.message}\n`, 'error')
    }
    setBusy(false)
    setCmd('')
    inpRef.current?.focus()
  }

  async function openShell() {
    addLine('Opening shell...\n', 'info')
    try {
      const s = await manager.execShellStream()
      setStream(s)
      addLine('shell connected\n', 'prompt')
      ;(async () => {
        try {
          while (true) {
            const d = await s.read()
            if (d === null) { addLine('\n(closed)\n', 'info'); break }
            addLine(new TextDecoder().decode(d))
          }
        } catch (err) {
          if (err.message !== 'WebSocket closed') addLine(`\n${err.message}\n`, 'error')
        }
      })()
    } catch (err) {
      addLine(`Error: ${err.message}\n`, 'error')
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!cmd.trim() || busy) return
    stream ? runInStream(cmd) : runOnce(cmd)
  }

  async function runInStream(c) {
    setBusy(true)
    addLine(`${cmd}\n`)
    try {
      await stream.write(new TextEncoder().encode(cmd + '\n'))
      const d = await stream.read()
      if (d) addLine(new TextDecoder().decode(d))
    } catch (err) {
      addLine(`Error: ${err.message}\n`, 'error')
    }
    setBusy(false)
    setCmd('')
    inpRef.current?.focus()
  }

  return (
    <div className="terminal-container">
      <div className="terminal-toolbar">
        <span className="hint">{stream ? 'Shell mode' : 'Single command mode'}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {!stream && <button className="btn btn-sm" onClick={openShell} disabled={busy}>Open shell</button>}
          {stream && <button className="btn btn-sm btn-danger" onClick={() => { stream.close(); setStream(null); addLine('shell closed\n', 'info') }}>Close shell</button>}
          <button className="btn btn-sm btn-ghost" onClick={() => setLines([])}>Clear</button>
        </div>
      </div>

      <div className="terminal-box">
        <div className="terminal-bar">
          <span className="dot r" /><span className="dot y" /><span className="dot g" />
          <span className="title">adb-shell</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
            {busy ? 'running...' : ''}
            {stream ? 'interactive' : 'single'}
          </span>
        </div>
        <div className="terminal-output" ref={outRef}>
          {lines.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>Type a command and press Enter</span>
          ) : (
            lines.map((l, i) => (
              <span key={i} className={
                l.type === 'error' ? 'error' : l.type === 'info' ? 'info' : l.type === 'prompt' ? 'prompt' : ''
              }>{l.text}</span>
            ))
          )}
          {busy && <span className="spinner" style={{ marginLeft: 4 }} />}
        </div>
        <form className="terminal-input-row" onSubmit={handleSubmit}>
          <span className="prompt-char">{stream ? '>' : '$'}</span>
          <input ref={inpRef} type="text" value={cmd} onChange={e => setCmd(e.target.value)}
            placeholder={stream ? 'type command...' : 'adb shell command...'} disabled={busy} autoFocus />
        </form>
      </div>
    </div>
  )
}

function ScreenshotPanel({ manager }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  async function capture() {
    setLoading(true)
    try {
      const d = await manager.takeScreenshot()
      if (d) setData(d)
    } catch (err) { alert('Error: ' + err.message) }
    setLoading(false)
  }

  return (
    <div className="screenshot-area">
      <div className="preview-area">
        {data ? (
          <img src={data} alt="screenshot" />
        ) : (
          <div className="placeholder">
            <div className="ph-icon">📱</div>
            <h3>Screen capture</h3>
            <p>Capture your device screen and save it as PNG</p>
          </div>
        )}
      </div>
      <div className="screenshot-actions">
        <button className="btn btn-primary" onClick={capture} disabled={loading}>
          {loading ? <><span className="spinner" /> Capturing...</> : '📷 Capture'}
        </button>
        {data && (
          <>
            <button className="btn" onClick={capture} disabled={loading}>⟳ Recapture</button>
            <button className="btn" onClick={() => {
              const a = document.createElement('a')
              a.href = data; a.download = `screenshot_${Date.now()}.png`; a.click()
            }}>💾 Download</button>
            <button className="btn btn-ghost" onClick={() => setData(null)}>✕ Dismiss</button>
          </>
        )}
      </div>
    </div>
  )
}

function FileExplorerPanel({ manager }) {
  const [path, setPath] = useState('/sdcard')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [downloading, setDownloading] = useState(null)

  async function load(dir) {
    setLoading(true); setErr(null)
    try {
      const list = await manager.listFiles(dir || path)
      setItems(list); if (dir) setPath(dir)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }

  useEffect(() => { load(path) }, [])

  function go(dir) {
    load(dir === '..' ? path.split('/').slice(0, -1).join('/') || '/' : path.replace(/\/$/, '') + '/' + dir)
  }

  async function download(name) {
    const fullPath = path.replace(/\/$/, '') + '/' + name
    setDownloading(name)
    try {
      const data = await manager.downloadFile(fullPath)
      const blob = new Blob([data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { alert('Download error: ' + e.message) }
    setDownloading(null)
  }

  return (
    <div className="file-explorer">
      <div className="path-bar">
        <input value={path} onChange={e => setPath(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()} placeholder="/sdcard" />
        <button className="btn btn-sm btn-primary" onClick={() => load()} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Go'}
        </button>
      </div>
      {err && <div className="error-banner"><span className="err-icon">⚠️</span> {err}</div>}
      <div className="file-list-container">
        {items.length === 0 && !loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Empty directory
          </div>
        ) : (
          <ul className="file-list">
            {path !== '/' && (
              <li className="file-item dir" onClick={() => go('..')}>
                <span className="fi-icon">📁</span>
                <span className="fi-name">.. (up)</span>
              </li>
            )}
            {items.map((f, i) => (
              <li key={i} className={`file-item${f.isDir ? ' dir' : ''}`}
                onClick={() => f.isDir && go(f.name)}>
                <span className="fi-icon">{f.isDir ? '📁' : '📄'}</span>
                <span className="fi-name">{f.name}</span>
                {f.size && <span className="fi-meta">{f.size}</span>}
                {!f.isDir && (
                  <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); download(f.name) }}
                    disabled={downloading === f.name}>
                    {downloading === f.name ? <span className="spinner" /> : '⬇'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AppListPanel({ manager }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const list = await manager.listApps()
      setApps(list)
    } catch (err) { alert('Error: ' + err.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div className="list-panel">
      <div className="panel-toolbar">
        <span className="hint">{apps.length} third-party apps</span>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : '⟳ Refresh'}
        </button>
      </div>
      <div className="list-container">
        {apps.length === 0 && !loading ? (
          <div className="empty-state">No third-party apps found</div>
        ) : (
          <ul className="app-list">
            {apps.map((pkg, i) => (
              <li key={i} className="app-item">
                <span className="app-icon">📦</span>
                <span className="app-name">{pkg}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function LogcatPanel({ manager }) {
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(false)
  const [lineCount, setLineCount] = useState(100)
  const [autoScroll, setAutoScroll] = useState(true)
  const outRef = useRef(null)

  useEffect(() => {
    if (autoScroll && outRef.current) {
      outRef.current.scrollTop = outRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  async function load() {
    setLoading(true)
    try {
      const output = await manager.getLogcat(lineCount)
      setLines(output.split('\n').filter(l => l.trim()))
    } catch (err) { alert('Error: ' + err.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [lineCount])

  return (
    <div className="logcat-panel">
      <div className="panel-toolbar">
        <div className="input-group" style={{ width: 120 }}>
          <input type="number" value={lineCount} onChange={e => setLineCount(Number(e.target.value))} min={10} max={10000} />
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : '⟳ Refresh'}
        </button>
        <label className="toggle-label">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>
      <div className="logcat-output" ref={outRef}>
        {lines.length === 0 ? (
          <div className="empty-state">No log output</div>
        ) : (
          lines.map((l, i) => {
            let cls = ''
            if (l.includes(' E ')) cls = 'error'
            else if (l.includes(' W ')) cls = 'warning'
            else if (l.includes(' I ')) cls = 'info'
            return <div key={i} className={`log-line ${cls}`}>{l}</div>
          })
        )}
      </div>
    </div>
  )
}

export default function Home() {
  const [manager] = useState(() => new AdbConnectionManager())
  const [state, setState] = useState(CONNECT_STATE.DISCONNECTED)
  const [deviceInfo, setDeviceInfo] = useState(null)
  const [errMsg, setErrMsg] = useState(null)
  const [tab, setTab] = useState('shell')
  const [deviceIp, setDeviceIp] = useState('')
  const [devicePort, setDevicePort] = useState('5555')
  const [toasts, setToasts] = useState([])
  const [connecting, setConnecting] = useState(false)

  const toast = useCallback((msg, type) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  useEffect(() => {
    manager.onStateChange = s => {
      setState(s)
      if (s === CONNECT_STATE.CONNECTED) {
        setConnecting(false); setDeviceInfo(manager.deviceInfo)
        toast('Device connected', 'success')
      } else if (s === CONNECT_STATE.ERROR) {
        setConnecting(false); setErrMsg(manager.error)
        toast(manager.error, 'error')
      } else if (s === CONNECT_STATE.CONNECTING) { setConnecting(true) }
      else if (s === CONNECT_STATE.DISCONNECTED) { setConnecting(false); setDeviceInfo(null); setErrMsg(null) }
    }
    return () => { manager.onStateChange = null }
  }, [manager, toast])

  const connectUsb = async () => { setErrMsg(null); toast('Connecting USB...', 'info'); await manager.connectUsb() }
  const connectWifi = async () => {
    const origin = typeof window !== 'undefined' ? window.location : { host: 'localhost:3000' }
    const url = `ws://${origin.host}/adb-proxy?target=${deviceIp}:${devicePort}`
    setErrMsg(null); toast('Connecting WiFi...', 'info'); await manager.connectWifi(url)
  }
  const disconnect = async () => { await manager.disconnect(); toast('Disconnected', 'info') }
  const refreshInfo = async () => {
    try { setDeviceInfo(await manager.getDeviceInfo()); toast('Refreshed', 'info') }
    catch (e) { toast(e.message, 'error') }
  }

  const connected = state === CONNECT_STATE.CONNECTED

  return (
    <div className="app-container">
      <div className="toast-container">
        {toasts.map(t => <Toast key={t.id} message={t.msg} type={t.type} onClose={() => setToasts(p => p.filter(x => x.id !== t.id))} />)}
      </div>

      <header className="app-header">
        <div className="header-left">
          <h1>🤖 ADB Web <span className="badge">v1.0</span></h1>
        </div>
        <div className="header-right">
          <span className={`status-badge ${state}`}>
            <span className={`status-dot ${state}`} />
            {{ [CONNECT_STATE.DISCONNECTED]: 'Disconnected', [CONNECT_STATE.CONNECTING]: 'Connecting...',
               [CONNECT_STATE.AUTHENTICATING]: 'Authenticating...', [CONNECT_STATE.CONNECTED]: 'Connected',
               [CONNECT_STATE.ERROR]: 'Error' }[state]}
            {connecting && <span className="spinner" style={{ marginLeft: 4 }} />}
          </span>
          {connected && <button className="btn btn-sm btn-danger" onClick={disconnect}>🔌 Disconnect</button>}
        </div>
      </header>

      <main className="main-content">
        <div className="connection-panel">
          <div className="connection-card">
            <div className="card-header">
              <div className="card-icon usb">🔌</div>
              <div className="card-body">
                <h3>USB Connection</h3>
                <p>Connect via cable using WebUSB. Chrome / Edge required.</p>
              </div>
            </div>
            <div className="card-action">
              <button className="btn btn-primary" onClick={connectUsb} disabled={connecting || connected}>
                {connecting && state === CONNECT_STATE.CONNECTING ? <><span className="spinner" /> Connecting...</> : '🔗 Connect USB'}
              </button>
            </div>
            <div className="hint-box">
              <details>
                <summary className="hint-header">📖 How to connect via USB</summary>
                <div className="hint-content">
                  <code>1. Enable Developer Options & USB Debugging on Android</code>
                  <code>2. Plug in the USB cable</code>
                  <code>3. Click "Connect USB" and select your device</code>
                  <code>4. Accept "Allow USB Debugging" on your device</code>
                </div>
              </details>
            </div>
          </div>

          <div className="connection-card">
            <div className="card-header">
              <div className="card-icon wifi">📶</div>
              <div className="card-body">
                <h3>WiFi Connection</h3>
                <p>Connect directly to device via LAN.</p>
              </div>
            </div>
            <div className="card-action" style={{ flexDirection: 'column', gap: 8 }}>
              <div className="input-group">
                <input value={deviceIp} onChange={e => setDeviceIp(e.target.value)} placeholder="Device IP (e.g. 192.168.1.100)" />
                <input value={devicePort} onChange={e => setDevicePort(e.target.value)} placeholder="5555" style={{ maxWidth: 80 }} />
              </div>
              <button className="btn btn-primary" onClick={connectWifi} disabled={connecting || connected || !deviceIp.trim()}
                style={{ width: '100%' }}>
                {connecting && state === CONNECT_STATE.CONNECTING ? <><span className="spinner" /> Connecting...</> : '🔗 Connect WiFi'}
              </button>
            </div>
            <div className="hint-box">
              <details>
                <summary className="hint-header">📖 How to connect via WiFi</summary>
                <div className="hint-content">
                  <code>1. adb tcpip 5555</code>
                  <code>2. adb connect {deviceIp || 'DEVICE_IP'}:{devicePort || '5555'}</code>
                  <code>3. Enter device IP:Port above → click Connect</code>
                </div>
              </details>
            </div>
          </div>
        </div>

        {errMsg && state === CONNECT_STATE.ERROR && (
          <div className="error-banner"><span className="err-icon">⚠️</span> {errMsg}</div>
        )}

        {connected ? (
          <div className="dashboard">
            <div className="dashboard-sidebar">
              <DeviceInfo deviceInfo={deviceInfo} onRefresh={refreshInfo} />
              <QuickActions
                onScreenshot={() => setTab('screenshot')}
                onShell={() => setTab('shell')}
                onFiles={() => setTab('files')}
                onApps={() => setTab('apps')}
                onLogcat={() => setTab('logcat')}
              />
            </div>
            <div className="dashboard-main">
              <nav className="tab-nav">
                {[
                  { id: 'shell', label: '💻 Shell' },
                  { id: 'screenshot', label: '📷 Screenshot' },
                  { id: 'files', label: '📁 Files' },
                  { id: 'apps', label: '📦 Apps' },
                  { id: 'logcat', label: '📋 Logcat' },
                ].map(t => (
                  <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </nav>
              <div className="tab-content fade-in">
                {tab === 'shell' && <ShellPanel manager={manager} />}
                {tab === 'screenshot' && <ScreenshotPanel manager={manager} />}
                {tab === 'files' && <FileExplorerPanel manager={manager} />}
                {tab === 'apps' && <AppListPanel manager={manager} />}
                {tab === 'logcat' && <LogcatPanel manager={manager} />}
              </div>
            </div>
          </div>
        ) : (
          <div className="connect-prompt">
            <div className="cp-icon">🤖</div>
            <h2>Connect your Android device</h2>
            <p>
              Use USB cable or WiFi to control your Android device directly from the browser.
              Supports Chrome, Edge and Chromium-based browsers.
            </p>
            <div className="steps-grid">
              <div className="step-card">
                <div className="step-num">1</div>
                <h4>Enable Debugging</h4>
                <p>Turn on <strong>Developer Options</strong> and <strong>USB Debugging</strong> on your Android device.</p>
              </div>
              <div className="step-card">
                <div className="step-num">2</div>
                <h4>Choose connection method</h4>
                <p><strong>USB:</strong> Plug in cable → click <code>Connect USB</code><br />
                  <strong>WiFi:</strong> Run <code>npm run dev</code> → enter device IP → click <code>Connect WiFi</code></p>
              </div>
              <div className="step-card">
                <div className="step-num">3</div>
                <h4>Authorize</h4>
                <p>Accept the "Allow USB Debugging" prompt on your device if shown.</p>
              </div>
              <div className="step-card">
                <div className="step-num">4</div>
                <h4>Control</h4>
                <p>Use Shell, Screenshot, and File Explorer to manage your device.</p>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        ADB Web — Android device management in the browser &bull;
        Powered by <a href="https://vercel.com" target="_blank" rel="noopener noreferrer">Vercel</a>
        {' '}&bull; <a href="https://github.com/Longg249/android-debug-on-web" target="_blank" rel="noopener noreferrer">GitHub</a>
      </footer>
    </div>
  )
}
