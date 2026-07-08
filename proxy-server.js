/**
 * WebSocket → TCP Proxy cho ADB qua WiFi
 *
 * Cách dùng:
 *   1. Kết nối ADB qua WiFi: adb tcpip 5555
 *   2. Chạy proxy: node proxy-server.js
 *   3. Trên web, nhập địa chỉ: ws://IP_MÁY_TÍNH:8787
 *
 * Biến môi trường:
 *   PROXY_PORT  - cổng WebSocket (mặc định 8787)
 *   ADB_HOST    - địa chỉ thiết bị ADB (mặc định đọc từ args)
 *   ADB_PORT    - cổng ADB (mặc định 5555)
 */

const WebSocket = require('ws');
const net = require('net');

const PROXY_PORT = parseInt(process.env.PROXY_PORT, 10) || 8787;
const DEFAULT_ADB_PORT = parseInt(process.env.ADB_PORT, 10) || 5555;

const deviceTarget = process.argv[2] || process.env.ADB_HOST;
if (!deviceTarget) {
  console.error('❌ Thiếu địa chỉ thiết bị.');
  console.error('   Usage: node proxy-server.js <device_ip>');
  console.error('   Hoặc set biến môi trường ADB_HOST');
  process.exit(1);
}

const [targetHost, targetPortStr] = deviceTarget.split(':');
const targetPort = targetPortStr ? parseInt(targetPortStr, 10) : DEFAULT_ADB_PORT;

const wss = new WebSocket.Server({ port: PROXY_PORT });

console.log(`╔══════════════════════════════════════════════╗`);
console.log(`║     ADB WiFi Proxy Server                   ║`);
console.log(`╠══════════════════════════════════════════════╣`);
console.log(`║  WebSocket  → ws://0.0.0.0:${PROXY_PORT}           `);
console.log(`║  Target     → ${targetHost}:${targetPort}                `);
console.log(`╚══════════════════════════════════════════════╝`);
console.log(`\n📱 Đảm bảo thiết bị đã bật ADB qua WiFi:`);
console.log(`   adb tcpip ${targetPort}`);
console.log(`   adb connect ${targetHost}:${targetPort}\n`);

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`🔗 Kết nối mới từ ${clientIp}`);

  const tcpSocket = new net.Socket();

  tcpSocket.connect(targetPort, targetHost, () => {
    console.log(`✅ Đã kết nối TCP đến ${targetHost}:${targetPort}`);
  });

  tcpSocket.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  ws.on('message', (data) => {
    if (typeof data === 'string') {
      tcpSocket.write(Buffer.from(data));
    } else {
      tcpSocket.write(Buffer.from(data));
    }
  });

  ws.on('close', () => {
    console.log(`❌ WebSocket đóng (${clientIp})`);
    tcpSocket.destroy();
  });

  tcpSocket.on('close', () => {
    console.log(`❌ TCP đóng (${targetHost}:${targetPort})`);
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  tcpSocket.on('error', (err) => {
    console.error(`⚠️ Lỗi TCP: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    ws.close();
  });

  ws.on('error', (err) => {
    console.error(`⚠️ Lỗi WebSocket: ${err.message}`);
    tcpSocket.destroy();
  });
});

process.on('SIGINT', () => {
  console.log('\n👋 Đang tắt proxy...');
  wss.close(() => process.exit(0));
});
