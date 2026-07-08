import { useState, useEffect, useRef, useCallback } from 'react'
import { AdbConnectionManager, CONNECT_STATE } from '../lib/adb'

// --- Toast notifications ---
function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return <div className={`toast ${type}`}>{message}</div>
}

// --- Device Dashboard Components ---
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
    <div className="device-info-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3>Thiết bị</h3>
        <button className="btn btn-sm" onClick={onRefresh}>⟳ Làm mới</button>
      </div>
      {fields.map(f => (
        <div key={f.key} className="device-info-item">
          <span className="label">{f.label}</span>
          <span className="value">{deviceInfo[f.key] || '--'}</span>
        </div>
      ))}
    </div>
  )
}

function QuickActions({ onScreenshot, onShell, onFiles, disabled }) {
  const actions = [
    { label: '📷 Chụp màn hình', action: onScreenshot },
    { label: '💻 Shell', action: onShell },
    { label: '📁 File Explorer', action: onFiles },
  ]
  return (
    <div className="device-info-card">
      <h3>Thao tác nhanh</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {actions.map(a => (
          <button key={a.label} className="btn btn-sm" onClick={a.action} disabled={disabled}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// --- Shell Terminal ---
function ShellPanel({ manager }) {
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState([])
  const [running, setRunning] = useState(false)
  const [session, setSession] = useState(null)
  const outputRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight }, [output])

  useEffect(() => {
    return () => {
      if (session) {
        session.close().catch(() => {})
      }
    }
  }, [session])

  async function startShell() {
    try {
      setOutput(prev => [...prev, { text: 'Đang mở shell...\r\n', type: 'info' }])
      const s = await manager.execShellStream()
      setSession(s)
      setOutput(prev => [...prev, { text: 'shell@android:/ $ ', type: 'prompt' }])
      readLoop(s)
    } catch (err) {
      setOutput(prev => [...prev, { text: `Lỗi: ${err.message}\r\n`, type: 'error' }])
    }
  }

  async function readLoop(s) {
    try {
      while (true) {
        const data = await s.read()
        if (data === null) {
          setOutput(prev => [...prev, { text: '\r\n(Kết thúc shell)\r\n', type: 'info' }])
          break
        }
        const text = new TextDecoder().decode(data)
        setOutput(prev => [...prev, { text, type: 'output' }])
      }
    } catch (err) {
      if (err.message !== 'WebSocket closed') {
        setOutput(prev => [...prev, { text: `\r\nLỗi: ${err.message}\r\n`, type: 'error' }])
      }
    }
  }

  async function runCommand(e) {
    e.preventDefault()
    if (!command.trim() || running) return

    if (!session) {
      await startShell()
      if (!session) return
    }

    setRunning(true)
    setOutput(prev => [...prev, { text: command + '\r\n', type: 'input' }])
    try {
      await session.write(new TextEncoder().encode(command + '\n'))
      const timer = setTimeout(async () => {
        try {
          const result = await manager.execShell(command)
          setOutput(prev => [...prev, { text: result + '\r\n', type: 'output' }])
        } catch (_) {}
      }, 3000)
      const readData = await session.read()
      clearTimeout(timer)
      if (readData) {
        setOutput(prev => [...prev, { text: new TextDecoder().decode(readData), type: 'output' }])
      }
    } catch (err) {
      setOutput(prev => [...prev, { text: `\r\nLỗi: ${err.message}\r\n`, type: 'error' }])
      setSession(null)
    }
    setRunning(false)
    setCommand('')
    if (inputRef.current) inputRef.current.focus()
  }

  async function runSimpleCommand() {
    if (!command.trim() || running) return
    setRunning(true)
    setOutput(prev => [...prev, { text: `$ ${command}\r\n`, type: 'prompt' }])
    try {
      const result = await manager.execShell(command)
      setOutput(prev => [...prev, { text: result + '\r\n', type: 'output' }])
    } catch (err) {
      setOutput(prev => [...prev, { text: `Lỗi: ${err.message}\r\n`, type: 'error' }])
    }
    setRunning(false)
    setCommand('')
  }

  const handleSubmit = session ? runCommand : runSimpleCommand

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Nhập lệnh ADB shell và nhấn Enter
        </span>
        {session && (
          <button className="btn btn-sm btn-danger" onClick={() => { session.close(); setSession(null) }}>
            Đóng shell
          </button>
        )}
      </div>
      <div className="terminal-output" ref={outputRef}>
        {output.length === 0 ? (
          <span style={{ color: 'var(--text-muted)' }}>Nhập lệnh để bắt đầu...</span>
        ) : (
          output.map((line, i) => (
            <span key={i} className={line.type === 'error' ? 'error' : line.type === 'info' ? 'info' : line.type === 'prompt' ? 'prompt' : ''}>
              {line.text}
            </span>
          ))
        )}
        {running && <span className="spinner" style={{ marginLeft: 4 }} />}
      </div>
      <form className="terminal-input-area" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={e => setCommand(e.target.value)}
          placeholder="$ nhập lệnh..."
          disabled={running}
          autoFocus
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={running || !command.trim()}>
          {running ? '...' : 'Gửi'}
        </button>
      </form>
    </div>
  )
}

// --- Screenshot ---
function ScreenshotPanel({ manager }) {
  const [screenshot, setScreenshot] = useState(null)
  const [loading, setLoading] = useState(false)

  async function capture() {
    setLoading(true)
    try {
      const data = await manager.takeScreenshot()
      if (data) setScreenshot(data)
    } catch (err) {
      alert('Lỗi chụp màn hình: ' + err.message)
    }
    setLoading(false)
  }

  return (
    <div className="screenshot-area">
      {screenshot ? (
        <>
          <img src={screenshot} alt="Screenshot" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={capture} disabled={loading}>
              {loading ? <><span className="spinner" /> Đang chụp...</> : '📷 Chụp lại'}
            </button>
            <button className="btn" onClick={() => {
              const a = document.createElement('a')
              a.href = screenshot
              a.download = `screenshot_${Date.now()}.png`
              a.click()
            }}>💾 Tải xuống</button>
          </div>
        </>
      ) : (
        <div className="screenshot-placeholder">
          <div className="icon">📱</div>
          <h3>Chụp màn hình thiết bị</h3>
          <p>Nhấn nút bên dưới để chụp màn hình thiết bị Android</p>
          <button className="btn btn-primary" onClick={capture} disabled={loading}>
            {loading ? <><span className="spinner" /> Đang chụp...</> : '📷 Chụp màn hình'}
          </button>
        </div>
      )}
    </div>
  )
}

// --- File Explorer ---
function FileExplorerPanel({ manager }) {
  const [path, setPath] = useState('/sdcard')
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function loadFiles(dir) {
    setLoading(true)
    setError(null)
    try {
      const list = await manager.listFiles(dir || path)
      setFiles(list)
      if (dir) setPath(dir)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => { loadFiles(path) }, [])

  function navigate(dir) {
    const newPath = dir === '..'
      ? path.split('/').slice(0, -1).join('/') || '/'
      : path.endsWith('/') ? path + dir : path + '/' + dir
    loadFiles(newPath)
  }

  return (
    <div>
      <div className="input-group" style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={path}
          onChange={e => setPath(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadFiles()}
          placeholder="Đường dẫn..."
        />
        <button className="btn btn-sm btn-primary" onClick={() => loadFiles()} disabled={loading}>
          {loading ? <span className="spinner" /> : '🔍 Đi'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>⚠️ {error}</div>}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {files.length === 0 && !loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Không có file hoặc thư mục rỗng
          </div>
        ) : (
          <ul className="file-list">
            {path !== '/' && (
              <li className="file-item" onClick={() => navigate('..')}>
                <span className="icon">📁</span>
                <span className="name">.. (Lên trên)</span>
              </li>
            )}
            {files.map((f, i) => (
              <li key={i} className="file-item" onClick={() => f.raw.startsWith('d') && navigate(f.name)}>
                <span className="icon">{f.raw.startsWith('d') ? '📁' : '📄'}</span>
                <span className="name">{f.raw}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// --- Main Page ---
export default function Home() {
  const [manager] = useState(() => new AdbConnectionManager())
  const [state, setState] = useState(CONNECT_STATE.DISCONNECTED)
  const [deviceInfo, setDeviceInfo] = useState(null)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('shell')
  const [wsUrl, setWsUrl] = useState('ws://localhost:8787')
  const [toast, setToast] = useState(null)
  const [connecting, setConnecting] = useState(false)

  const showToast = useCallback((msg, type) => setToast({ message: msg, type }), [])

  useEffect(() => {
    manager.onStateChange = (newState) => {
      setState(newState)
      if (newState === CONNECT_STATE.CONNECTED) {
        setConnecting(false)
        setDeviceInfo(manager.deviceInfo)
        showToast('Đã kết nối thiết bị thành công!', 'success')
      } else if (newState === CONNECT_STATE.ERROR) {
        setConnecting(false)
        setError(manager.error)
        showToast('Lỗi: ' + manager.error, 'error')
      } else if (newState === CONNECT_STATE.CONNECTING) {
        setConnecting(true)
      } else if (newState === CONNECT_STATE.DISCONNECTED) {
        setConnecting(false)
        setDeviceInfo(null)
        setError(null)
      }
    }
    return () => { manager.onStateChange = null }
  }, [manager, showToast])

  async function connectUsb() {
    setError(null)
    showToast('Đang kết nối USB...', 'info')
    await manager.connectUsb()
  }

  async function connectWifi() {
    setError(null)
    showToast('Đang kết nối WiFi...', 'info')
    await manager.connectWifi(wsUrl)
  }

  async function disconnect() {
    await manager.disconnect()
    showToast('Đã ngắt kết nối', 'info')
  }

  async function handleScreenshot() {
    setActiveTab('screenshot')
  }

  async function handleShell() {
    setActiveTab('shell')
  }

  async function handleFiles() {
    setActiveTab('files')
  }

  async function refreshDeviceInfo() {
    try {
      const info = await manager.getDeviceInfo()
      setDeviceInfo(info)
      showToast('Đã làm mới thông tin', 'info')
    } catch (err) {
      showToast('Lỗi: ' + err.message, 'error')
    }
  }

  const statusLabel = {
    [CONNECT_STATE.DISCONNECTED]: 'Chưa kết nối',
    [CONNECT_STATE.CONNECTING]: 'Đang kết nối...',
    [CONNECT_STATE.AUTHENTICATING]: 'Đang xác thực...',
    [CONNECT_STATE.CONNECTED]: 'Đã kết nối',
    [CONNECT_STATE.ERROR]: 'Lỗi',
  }

  const isConnected = state === CONNECT_STATE.CONNECTED
  const tabs = [
    { id: 'shell', label: '💻 Shell' },
    { id: 'screenshot', label: '📷 Screenshot' },
    { id: 'files', label: '📁 Files' },
  ]

  return (
    <div className="app-container">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="app-header">
        <h1>
          🤖 ADB Web
          <small>Quản lý Android trên trình duyệt</small>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className={`status-badge ${state}`}>
            <span className={`status-dot ${state}`} />
            {statusLabel[state]}
            {connecting && <span className="spinner" style={{ marginLeft: 4 }} />}
          </span>
          {isConnected && (
            <button className="btn btn-danger btn-sm" onClick={disconnect}>🔌 Ngắt</button>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            v1.0
          </span>
        </div>
      </header>

      <main className="main-content">
        {/* Connection Panel */}
        <div className="connection-panel">
          <div className="connection-card">
            <h3><span className="icon">🔌</span> Kết nối qua USB</h3>
            <p>Kết nối thiết bị Android qua cáp USB. Yêu cầu Chrome/Edge với WebUSB.</p>
            <button
              className="btn btn-primary"
              onClick={connectUsb}
              disabled={connecting || isConnected}
            >
              {connecting && state === CONNECT_STATE.CONNECTING ? (
                <><span className="spinner" /> Đang kết nối...</>
              ) : '🔗 Kết nối USB'}
            </button>
            <div className="hint-box">
              <div className="label">Hướng dẫn:</div>
              <code>1. Bật USB Debugging trên thiết bị (Developer Options)</code>
              <code>2. Cắm cáp USB vào máy tính</code>
              <code>3. Nhấn "Kết nối USB" và chọn thiết bị</code>
              <code>4. Xác nhận "Cho phép USB Debugging?" trên thiết bị</code>
            </div>
          </div>

          <div className="connection-card">
            <h3><span className="icon">📶</span> Kết nối qua WiFi</h3>
            <p>Kết nối qua mạng WiFi. Cần chạy proxy server trên máy cùng mạng.</p>
            <div className="input-group" style={{ marginBottom: 8 }}>
              <input
                type="text"
                value={wsUrl}
                onChange={e => setWsUrl(e.target.value)}
                placeholder="ws://192.168.1.x:8787"
              />
              <button
                className="btn btn-primary"
                onClick={connectWifi}
                disabled={connecting || isConnected || !wsUrl.trim()}
              >
                {connecting && state === CONNECT_STATE.CONNECTING ? (
                  <><span className="spinner" /> Đang kết nối...</>
                ) : '🔗 Kết nối WiFi'}
              </button>
            </div>
            <div className="hint-box">
              <div className="label">Hướng dẫn:</div>
              <code>adb tcpip 5555</code>
              <code>adb connect &lt;IP_DEVICE&gt;:5555</code>
              <code>node proxy-server.js &lt;IP_DEVICE&gt;</code>
            </div>
          </div>
        </div>

        {/* Error display */}
        {error && state === CONNECT_STATE.ERROR && (
          <div style={{
            background: 'rgba(248,81,73,0.1)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius)',
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
            color: 'var(--danger)',
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Dashboard */}
        {isConnected ? (
          <div className="dashboard">
            <div className="dashboard-sidebar">
              <DeviceInfo deviceInfo={deviceInfo} onRefresh={refreshDeviceInfo} />
              <QuickActions
                onScreenshot={handleScreenshot}
                onShell={handleShell}
                onFiles={handleFiles}
                disabled={!isConnected}
              />
            </div>
            <div className="dashboard-main">
              <nav className="tab-nav">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              <div className="tab-content">
                {activeTab === 'shell' && <ShellPanel manager={manager} />}
                {activeTab === 'screenshot' && <ScreenshotPanel manager={manager} />}
                {activeTab === 'files' && <FileExplorerPanel manager={manager} />}
              </div>
            </div>
          </div>
        ) : (
          <div className="connect-prompt">
            <div className="icon">🤖</div>
            <h2>Kết nối thiết bị Android của bạn</h2>
            <p>
              Sử dụng WebUSB (cáp) hoặc WiFi để kết nối với thiết bị Android
              ngay trên trình duyệt. Hỗ trợ Chrome, Edge, và các trình duyệt dựa trên Chromium.
            </p>
            <ol className="steps">
              <li>📱 <strong>Bước 1:</strong> Bật <strong>Developer Options</strong> và <strong>USB Debugging</strong> trên thiết bị Android</li>
              <li>🔌 <strong>Bước 2 (USB):</strong> Cắm cáp và nhấn <code>Kết nối USB</code></li>
              <li>📶 <strong>Bước 2 (WiFi):</strong> Chạy proxy server và nhấn <code>Kết nối WiFi</code></li>
              <li>✅ <strong>Bước 3:</strong> Xác nhận trên thiết bị Android (nếu được yêu cầu)</li>
            </ol>
          </div>
        )}
      </main>

      <footer className="app-footer">
        ADB Web - Quản lý thiết bị Android trên trình duyệt &bull;
        Triển khai trên{' '}
        <a href="https://vercel.com" target="_blank" rel="noopener noreferrer">Vercel</a>
        {' '}&bull; Nguồn:{' '}
        <a href="https://github.com/android/adb" target="_blank" rel="noopener noreferrer">ADB Protocol</a>
      </footer>
    </div>
  )
}
