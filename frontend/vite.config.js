import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(process.cwd(), '..'), '')
  const localEnv = loadEnv(mode, process.cwd(), '')
  const env = { ...rootEnv, ...localEnv }

  const serverIp = env.VITE_SERVER_IP || env.SERVER_IP
  const frontendPort = Number(env.VITE_PORT || env.FRONTEND_PORT)
  const apiPort = env.VITE_API_PORT || env.PORT
  const apiUrl = env.VITE_API_URL || (serverIp && apiPort ? `http://${serverIp}:${apiPort}` : '')

  return {
    plugins: [react()],
    envDir: path.resolve(process.cwd(), '..'),
    define: {
      'import.meta.env.VITE_SERVER_IP': JSON.stringify(serverIp),
      'import.meta.env.VITE_API_PORT': JSON.stringify(apiPort),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
    },
    server: {
      host: '0.0.0.0',
      port: frontendPort,
    },
  }
})
