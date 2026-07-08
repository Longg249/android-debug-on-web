import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="vi">
      <Head>
        <meta name="description" content="ADB trên web - quản lý thiết bị Android qua USB/WiFi trực tiếp từ trình duyệt" />
        <meta name="theme-color" content="#0d1117" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22 font-family=%22monospace%22 font-weight=%22bold%22 fill=%22%2338bdf8%22>adb</text></svg>" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
