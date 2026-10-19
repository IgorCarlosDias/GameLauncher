import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(process.cwd(), '..'), '')
  const localEnv = loadEnv(mode, process.cwd(), '')
  const env = { ...rootEnv, ...localEnv }

  const isDev = mode === 'development'
  const serverIp = env.VITE_SERVER_IP || env.SERVER_IP
  const defaultPort = isDev ? 8070 : 8060
  const frontendPort = Number(env.VITE_PORT || env.FRONTEND_PORT || defaultPort)
  const apiPort = env.VITE_API_PORT || env.PORT
  const apiUrl = env.VITE_API_URL || (serverIp && apiPort ? `http://${serverIp}:${apiPort}` : '')
  const apiToken = env.VITE_API_TOKEN || env.API_TOKEN || ''

  const subnetPrefix =
    serverIp && /^\d+\.\d+\.\d+\.\d+$/.test(serverIp)
      ? serverIp.split('.').slice(0, 3).join('.') + '.'
      : '192.168.0.'

  const isAllowedIp = (rawIp = '') => {
    const clean = String(rawIp).replace(/^::ffff:/i, '').trim()
    if (!clean || clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true
    return clean.startsWith(subnetPrefix) || clean.startsWith('192.168.0.')
  }

  const subnetGuardPlugin = {
    name: 'gamelauncher-subnet-guard',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const remote = req.socket?.remoteAddress || ''
        if (!isAllowedIp(remote)) {
          res.statusCode = 403
          res.end('Acesso negado: permitido apenas na sub-rede local (192.168.0.0/24).')
          return
        }
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const remote = req.socket?.remoteAddress || ''
        if (!isAllowedIp(remote)) {
          res.statusCode = 403
          res.end('Acesso negado: permitido apenas na sub-rede local (192.168.0.0/24).')
          return
        }
        next()
      })
    },
  }

  return {
    plugins: [react(), subnetGuardPlugin],
    envDir: path.resolve(process.cwd(), '..'),
    define: {
      'import.meta.env.VITE_SERVER_IP': JSON.stringify(serverIp),
      'import.meta.env.VITE_API_PORT': JSON.stringify(apiPort),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
      'import.meta.env.VITE_API_TOKEN': JSON.stringify(apiToken),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version || '0.0.1'),
    },
    server: {
      host: '0.0.0.0',
      port: frontendPort,
    },
    preview: {
      host: '0.0.0.0',
      port: 8060,
    },
  }
})

