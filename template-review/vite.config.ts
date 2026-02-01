import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'

export default defineConfig({
  plugins: [
    mdx(),
    react()
  ],
  server: {
    port: 3457,
    host: '0.0.0.0',
    allowedHosts: ['clanker-001', 'clanker-001.tail7af24.ts.net', 'localhost', '.ts.net'],
    proxy: {
      '/api': 'http://localhost:3458'
    }
  }
})
