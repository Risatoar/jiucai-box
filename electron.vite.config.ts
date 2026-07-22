import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const rendererPort = Number(process.env.PORT) || 5173

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@': new URL('./src/renderer/src', import.meta.url).pathname } },
    server: { port: rendererPort, strictPort: false }
  }
})
