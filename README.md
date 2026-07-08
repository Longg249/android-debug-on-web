# 🤖 ADB Web

Quản lý thiết bị Android trực tiếp trên trình duyệt. Kết nối qua **USB** (WebUSB) hoặc **WiFi** (WebSocket proxy).

## Tính năng

- 🔌 **Kết nối USB** - Dùng WebUSB API, cắm cáp và kết nối ngay trên Chrome/Edge
- 📶 **Kết nối WiFi** - Qua WebSocket proxy, không cần cáp
- 💻 **Shell** - Gửi lệnh ADB shell real-time
- 📷 **Screenshot** - Chụp màn hình thiết bị và tải về
- 📁 **File Explorer** - Duyệt file trên thiết bị
- 📱 **Responsive** - Giao diện tối ưu cho cả PC và mobile
- 🔒 **Bảo mật** - Mã hóa RSA ngay trên trình duyệt, không qua server trung gian

## Kiến trúc

```
Trình duyệt (WebUSB/WebSocket)
    │
    ├── USB ──── Cáp USB ──── Thiết bị Android (USB Debugging)
    │
    └── WiFi ─── WebSocket ─── proxy-server.js ─── TCP:5555 ─── Thiết bị (ADB over WiFi)
```

Toàn bộ ADB protocol chạy **client-side**, không cần backend. Deploy tĩnh trên Vercel.

## Yêu cầu

- **Trình duyệt**: Chrome 61+, Edge 79+, Opera 48+ (WebUSB)
- **Thiết bị Android**: Bật **Developer Options** và **USB Debugging**
- **WiFi**: Máy tính và Android cùng mạng LAN

## Cài đặt & chạy local

```bash
# Clone
git clone https://github.com/Longg249/android-debug-on-web.git
cd android-debug-on-web

# Cài dependencies
npm install

# Chạy dev
npm run dev
# Mở http://localhost:3000
```

### Kết nối USB

1. Bật USB Debugging trên Android (Settings → Developer Options)
2. Cắm cáp USB
3. Mở web → nhấn **Kết nối USB** → chọn thiết bị
4. Xác nhận "Cho phép USB Debugging?" trên Android

### Kết nối WiFi

```bash
# Trên Android: bật ADB qua WiFi
adb tcpip 5555
adb connect <IP_ANDROID>:5555

# Chạy proxy server (trên máy cùng mạng)
node proxy-server.js <IP_ANDROID>
# WebSocket proxy chạy tại ws://0.0.0.0:8787

# Trên web: nhập ws://<IP_MÁY_TÍNH>:8787 → Kết nối WiFi
```

## Deploy lên Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Longg249/android-debug-on-web)

Hoặc:

```bash
npx vercel --prod
```

## Công nghệ

- **Next.js** - React framework
- **WebUSB API** - Kết nối USB trình duyệt
- **WebSocket** - Kết nối WiFi
- **Web Crypto API** - RSA key pair cho ADB auth
- **ADB Protocol** - Implementation thuần JavaScript

## License

MIT
