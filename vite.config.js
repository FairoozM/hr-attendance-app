import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Dev/proxy: when nothing listens on :5001, return JSON so the UI shows a useful message instead of "Internal Server Error". */
function attendanceApiProxy() {
  return {
    target: 'http://localhost:5001',
    changeOrigin: true,
    configure(proxy) {
      proxy.on('error', (_err, _req, res) => {
        if (!res || res.writableEnded || res.headersSent) return
        try {
          const body = JSON.stringify({
            error: 'API server unreachable',
            hint:
              'Start the Express API (default port 5001): cd backend && npm run dev. PostgreSQL must be running if the server exits on startup.',
          })
          res.writeHead(503, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          })
          res.end(body)
        } catch {
          /* ignore */
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['backend/**', 'node_modules/**', 'dist/**'],
  },
  server: {
    proxy: {
      '/api': attendanceApiProxy(),
    },
  },
  preview: {
    proxy: {
      '/api': attendanceApiProxy(),
    },
  },
})
