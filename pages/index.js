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

function QuickActions({ onShell, onScreenshot, onFiles, onApps, onLogcat, onBattery, onProcess, onApk, onRecord }) {
  const items = [
    { icon: '~$', label: 'Shell', action: onShell },
    { icon: '⊞', label: 'Capture', action: onScreenshot },
    { icon: '▸', label: 'Files', action: onFiles },
    { icon: '◎', label: 'Apps', action: onApps },
    { icon: '≡', label: 'Logcat', action: onLogcat },
    { icon: '🔋', label: 'Health', action: onBattery },
    { icon: '◉', label: 'Process', action: onProcess },
    { icon: '⊟', label: 'APK', action: onApk },
    { icon: '▶', label: 'Record', action: onRecord },
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
  const [history, setHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)
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
    setHistory(prev => [...prev.slice(-99), c])
    setHistIdx(-1)
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
    setHistory(prev => [...prev.slice(-99), c])
    setHistIdx(-1)
    inpRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(idx)
      setCmd(history[idx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx === -1) return
      const idx = histIdx + 1
      if (idx >= history.length) { setHistIdx(-1); setCmd('') }
      else { setHistIdx(idx); setCmd(history[idx]) }
    }
  }

  return (
    <div className="terminal-container">
      <div className="terminal-toolbar">
        <span className="hint">{stream ? 'Shell mode' : 'Single command mode'}</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select className="preset-select" onChange={e => { const v = e.target.value; if (v) { setCmd(v); inpRef.current?.focus() } }} defaultValue="">
            <option value="" disabled>Presets</option>
            {PRESET_COMMANDS.map((p, i) => <option key={i} value={p.cmd}>{p.label}</option>)}
          </select>
          {!stream && <button className="btn btn-sm" onClick={openShell} disabled={busy}>Open shell</button>}
          {stream && <button className="btn btn-sm btn-danger" onClick={() => { stream.close(); setStream(null); addLine('shell closed\n', 'info') }}>Close shell</button>}
          <button className="btn btn-sm btn-ghost" onClick={() => setLines([])}>Clear</button>
        </div>
      </div>

      <div className="terminal-box">
        <div className="terminal-bar">
          <span className="title">adb shell</span>
          <span className="meta">
            {busy ? 'running... ' : ''}
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
            onKeyDown={handleKeyDown}
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
            <div className="ph-icon">⊞</div>
            <h3>Screen capture</h3>
            <p>Capture your device screen and save it as PNG</p>
          </div>
        )}
      </div>
      <div className="screenshot-actions">
        <button className="btn btn-primary" onClick={capture} disabled={loading}>
          {loading ? <><span className="spinner" /> Capturing...</> : 'Capture'}
        </button>
        {data && (
          <>
            <button className="btn" onClick={capture} disabled={loading}>↻ Recapture</button>
            <button className="btn" onClick={() => {
              const a = document.createElement('a')
              a.href = data; a.download = `screenshot_${Date.now()}.png`; a.click()
            }}>↓ Download</button>
            <button className="btn btn-ghost" onClick={() => setData(null)}>× Dismiss</button>
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
  const [uploading, setUploading] = useState(null)

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

  async function uploadFile() {
    const input = document.createElement('input')
    input.type = 'file'
    input.onchange = async () => {
      const file = input.files[0]
      if (!file) return
      setUploading(file.name)
      try {
        const buf = await file.arrayBuffer()
        const fullPath = path.replace(/\/$/, '') + '/' + file.name
        await manager.pushFile(fullPath, new Uint8Array(buf))
        load()
      } catch (e) { alert('Upload error: ' + e.message) }
      setUploading(null)
    }
    input.click()
  }

  return (
    <div className="file-explorer">
      <div className="path-bar">
        <input value={path} onChange={e => setPath(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()} placeholder="/sdcard" />
        <button className="btn btn-sm" onClick={uploadFile} disabled={uploading !== null}>
          {uploading ? <><span className="spinner" /> {uploading}</> : '↑ Upload'}
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => load()} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Go'}
        </button>
      </div>
      {err && <div className="error-banner"><span className="err-icon">!</span> {err}</div>}
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
                <span className="fi-icon">{f.isDir ? '▸' : '·'}</span>
                <span className="fi-name">{f.name}</span>
                {f.size && <span className="fi-meta">{f.size}</span>}
                {!f.isDir && (
                  <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); download(f.name) }}
                    disabled={downloading === f.name}>
                    {downloading === f.name ? <span className="spinner" /> : '↓'}
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
                <span className="app-prefix">◎</span>
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
  const [filterText, setFilterText] = useState('')
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

  const filtered = filterText ? lines.filter(l => l.toLowerCase().includes(filterText.toLowerCase())) : lines

  return (
    <div className="logcat-panel">
      <div className="panel-toolbar">
        <input value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filter..." style={{ maxWidth: 160 }} />
        <div className="input-group" style={{ width: 100 }}>
          <input type="number" value={lineCount} onChange={e => setLineCount(Number(e.target.value))} min={10} max={10000} />
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : '↻ Refresh'}
        </button>
        <label className="toggle-label">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto
        </label>
      </div>
      <div className="logcat-output" ref={outRef}>
        {filtered.length === 0 ? (
          <div className="empty-state">No log output</div>
        ) : (
          filtered.map((l, i) => {
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

function BatteryPanel({ manager }) {
  const [battery, setBattery] = useState(null)
  const [storage, setStorage] = useState([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [bat, sto] = await Promise.all([manager.getBattery(), manager.getStorage()])
      setBattery(bat); setStorage(sto)
    } catch (err) { alert('Error: ' + err.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const statusMap = { '1': 'Unknown', '2': 'Charging', '3': 'Discharging', '4': 'Not charging', '5': 'Full' }
  const healthMap = { '1': 'Unknown', '2': 'Good', '3': 'Overheat', '4': 'Dead', '5': 'OV', '6': 'Failure', '7': 'Cold' }

  return (
    <div className="list-panel">
      <div className="panel-toolbar">
        <span className="hint">Device health</span>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : '↻ Refresh'}
        </button>
      </div>
      {battery && (
        <div className="status-grid">
          {[
            { label: 'Level', value: `${battery.level}%` },
            { label: 'Status', value: statusMap[battery.status] || battery.status },
            { label: 'Health', value: healthMap[battery.health] || battery.health },
            { label: 'Temp', value: `${battery.temperature}°C` },
            { label: 'Voltage', value: battery.voltage ? `${(parseInt(battery.voltage) / 1000).toFixed(3)}V` : '--' },
            { label: 'Technology', value: battery.technology || '--' },
          ].map((item, i) => (
            <div key={i} className="status-item">
              <span className="label">{item.label}</span>
              <span className="value">{item.value}</span>
            </div>
          ))}
        </div>
      )}
      {storage.length > 0 && (
        <>
          <div className="section-label">Storage</div>
          {storage.map((s, i) => (
            <div key={i} className="device-row" style={{ fontSize: 11 }}>
              <span className="label">{s.mount}</span>
              <span className="value">{s.size} / {s.used} used / {s.avail} free</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function ProcessPanel({ manager }) {
  const [processes, setProcesses] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [killing, setKilling] = useState(null)

  async function load() {
    setLoading(true)
    try {
      setProcesses(await manager.getProcesses())
    } catch (err) { alert('Error: ' + err.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function kill(pid) {
    setKilling(pid)
    try {
      await manager.execShell(`kill ${pid}`)
      setProcesses(prev => prev.filter(p => p.pid !== pid))
    } catch (err) { alert('Error: ' + err.message) }
    setKilling(null)
  }

  const filtered = filter ? processes.filter(p => p.name.toLowerCase().includes(filter.toLowerCase())) : processes

  return (
    <div className="list-panel">
      <div className="panel-toolbar">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..." style={{ maxWidth: 180 }} />
        <span className="hint">{filtered.length} processes</span>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : '↻ Refresh'}
        </button>
      </div>
      <div className="list-container" style={{ maxHeight: 440 }}>
        {filtered.length === 0 && <div className="empty-state">No processes</div>}
        {filtered.map((p, i) => (
          <div key={i} className="file-item">
            <span className="fi-icon" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{p.pid}</span>
            <span className="fi-name">{p.name}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => kill(p.pid)}
              disabled={killing === p.pid} style={{ color: 'var(--danger)', fontSize: 10 }}>
              {killing === p.pid ? <span className="spinner" /> : 'kill'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ApkInstallPanel({ manager }) {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  async function install() {
    if (!file) return
    setBusy(true); setResult(null)
    try {
      const buf = await file.arrayBuffer()
      const out = await manager.installApk(new Uint8Array(buf))
      setResult({ ok: true, text: out || 'Install complete' })
    } catch (err) {
      setResult({ ok: false, text: err.message })
    }
    setBusy(false)
  }

  return (
    <div className="list-panel">
      <div className="panel-toolbar">
        <span className="hint">Install APK</span>
      </div>
      <div className="upload-zone" onClick={() => document.getElementById('apk-input')?.click()}>
        <input id="apk-input" type="file" accept=".apk" hidden onChange={e => setFile(e.target.files[0])} />
        <div className="upload-icon">⊞</div>
        <p>{file ? file.name : 'Select APK to install'}</p>
        {file && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(file.size / 1024 / 1024).toFixed(1)} MB</span>}
      </div>
      {file && (
        <button className="btn btn-primary" onClick={install} disabled={busy} style={{ marginTop: 8, width: '100%' }}>
          {busy ? <><span className="spinner" /> Installing...</> : 'Install APK'}
        </button>
      )}
      {result && (
        <div className={`install-result ${result.ok ? 'success' : 'error'}`}>
          {result.text}
        </div>
      )}
    </div>
  )
}

function ScreenRecordPanel({ manager }) {
  const [duration, setDuration] = useState(10)
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState(null)

  async function record() {
    setBusy(true)
    try {
      const d = await manager.screenRecord(duration)
      if (d && d.length > 0) setData(URL.createObjectURL(new Blob([d], { type: 'video/mp4' })))
    } catch (err) { alert('Error: ' + err.message) }
    setBusy(false)
  }

  return (
    <div className="screenshot-area">
      <div className="preview-area" style={{ minHeight: 200 }}>
        {data ? (
          <video src={data} controls style={{ maxWidth: '100%', maxHeight: '60vh' }} />
        ) : (
          <div className="placeholder">
            <div className="ph-icon">▶</div>
            <h3>Screen recording</h3>
            <p>Record for {duration} seconds</p>
          </div>
        )}
      </div>
      <div className="screenshot-actions">
        <div className="input-group" style={{ maxWidth: 120 }}>
          <input type="number" value={duration} onChange={e => setDuration(Math.max(3, Number(e.target.value)))} min={3} max={180} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>sec</span>
        </div>
        <button className="btn btn-primary" onClick={record} disabled={busy}>
          {busy ? <><span className="spinner" /> Recording...</> : 'Record'}
        </button>
        {data && <button className="btn" onClick={() => { const a = document.createElement('a'); a.href = data; a.download = `rec_${Date.now()}.mp4`; a.click() }}>↓ Download</button>}
        {data && <button className="btn btn-ghost" onClick={() => setData(null)}>×</button>}
      </div>
    </div>
  )
}

const PRESET_COMMANDS = [
  { label: 'Device info', cmd: 'getprop ro.product.model && getprop ro.build.version.release' },
  { label: 'IP address', cmd: "ip addr show wlan0 2>/dev/null | grep inet || ifconfig wlan0 2>/dev/null | grep inet" },
  { label: 'Uptime', cmd: 'uptime' },
  { label: 'Memory', cmd: 'free -h' },
  { label: 'CPU info', cmd: 'cat /proc/cpuinfo' },
  { label: 'WiFi networks', cmd: 'dumpsys wifi | grep SSID' },
  { label: 'Running services', cmd: 'dumpsys activity services | grep "ServiceRecord"' },
]

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
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    const host = isLocal ? window.location.host : 'localhost:8787'
    const url = `ws://${host}/adb-proxy?target=${deviceIp}:${devicePort}`
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
          <h1><span className="logo-accent">adb</span> web <span className="badge">v1.0</span></h1>
        </div>
        <div className="header-right">
          <span className={`status-badge ${state}`}>
            <span className={`status-dot ${state}`} />
            {{ [CONNECT_STATE.DISCONNECTED]: 'Disconnected', [CONNECT_STATE.CONNECTING]: 'Connecting...',
               [CONNECT_STATE.AUTHENTICATING]: 'Authenticating...', [CONNECT_STATE.CONNECTED]: 'Connected',
               [CONNECT_STATE.ERROR]: 'Error' }[state]}
            {connecting && <span className="spinner" style={{ marginLeft: 4 }} />}
          </span>
          {connected && <button className="btn btn-sm btn-danger" onClick={disconnect}>Disconnect</button>}
        </div>
      </header>

      <main className="main-content">
        <div className="connection-panel">
          <div className="connection-card">
            <div className="card-header">
              <div className="card-icon usb">USB</div>
              <div className="card-body">
                <h3>USB Connection</h3>
                <p>Connect via cable using WebUSB. Chrome / Edge required.</p>
              </div>
            </div>
            <div className="card-action">
              <button className="btn btn-primary" onClick={connectUsb} disabled={connecting || connected}>
                  {connecting && state === CONNECT_STATE.CONNECTING ? <><span className="spinner" /> Connecting...</> : 'Connect USB'}
              </button>
            </div>
            <div className="hint-box">
              <details>
                <summary className="hint-header">How to connect via USB</summary>
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
              <div className="card-icon wifi">WiFi</div>
              <div className="card-body">
                <h3>WiFi Connection</h3>
                <p>Connect to device over LAN.</p>
              </div>
            </div>
            <div className="card-action" style={{ flexDirection: 'column', gap: 8 }}>
              <div className="input-group">
                <input value={deviceIp} onChange={e => setDeviceIp(e.target.value)} placeholder="Device IP (e.g. 192.168.1.100)" />
                <input value={devicePort} onChange={e => setDevicePort(e.target.value)} placeholder="5555" style={{ maxWidth: 80 }} />
              </div>
              <button className="btn btn-primary" onClick={connectWifi}
                disabled={connecting || connected || !deviceIp.trim()}
                style={{ width: '100%' }}>
                {connecting && state === CONNECT_STATE.CONNECTING ? <><span className="spinner" /> Connecting...</> : 'Connect WiFi'}
              </button>
            </div>
            <div className="hint-box">
              <details>
                <summary className="hint-header">How to connect via WiFi</summary>
                <div className="hint-content">
                  <code>1. adb tcpip 5555</code>
                  <code>2. adb connect {deviceIp || 'DEVICE_IP'}:{devicePort || '5555'}</code>
                  <code>3. Enter device IP:Port above → click Connect</code>
                  <code style={{ color: 'var(--text-muted)' }}>Proxy auto-connects to localhost:8787 — run node proxy-server.js if needed</code>
                </div>
              </details>
            </div>
          </div>
        </div>

        {errMsg && state === CONNECT_STATE.ERROR && (
          <div className="error-banner"><span className="err-icon">!</span> {errMsg}</div>
        )}

        {connected ? (
          <div className="dashboard">
            <div className="dashboard-sidebar">
              <DeviceInfo deviceInfo={deviceInfo} onRefresh={refreshInfo} />
              <QuickActions
                onShell={() => setTab('shell')}
                onScreenshot={() => setTab('screenshot')}
                onFiles={() => setTab('files')}
                onApps={() => setTab('apps')}
                onLogcat={() => setTab('logcat')}
                onBattery={() => setTab('battery')}
                onProcess={() => setTab('process')}
                onApk={() => setTab('apk')}
                onRecord={() => setTab('record')}
              />
            </div>
            <div className="dashboard-main">
              <nav className="tab-nav">
                {[
                  { id: 'shell', label: 'Shell' },
                  { id: 'screenshot', label: 'Capture' },
                  { id: 'files', label: 'Files' },
                  { id: 'apps', label: 'Apps' },
                  { id: 'logcat', label: 'Logcat' },
                  { id: 'battery', label: 'Health' },
                  { id: 'process', label: 'Process' },
                  { id: 'apk', label: 'APK' },
                  { id: 'record', label: 'Record' },
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
                {tab === 'battery' && <BatteryPanel manager={manager} />}
                {tab === 'process' && <ProcessPanel manager={manager} />}
                {tab === 'apk' && <ApkInstallPanel manager={manager} />}
                {tab === 'record' && <ScreenRecordPanel manager={manager} />}
              </div>
            </div>
          </div>
        ) : (
          <div className="connect-prompt">
            <div className="cp-icon">adb</div>
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
