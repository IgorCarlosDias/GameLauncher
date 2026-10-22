import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'))
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
    return clean.startsWith(subnetPrefix) || clean.startsWith('192.168.0.') || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(clean)
  }

  const subnetGuardPlugin = {
    name: 'gamelauncher-subnet-guard',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const remote = req.socket?.remoteAddress || ''
        if (!isAllowedIp(remote)) {
          res.statusCode = 403
          res.end('Acesso negado: permitido apenas na sub-rede local (192.168.0.0/24) ou Tailscale.')
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
          res.end('Acesso negado: permitido apenas na sub-rede local (192.168.0.0/24) ou Tailscale.')
          return
        }
        next()
      })
    },
  }

  return {
    plugins: [
      react(),
      subnetGuardPlugin,
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'gamepad.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
        manifest: {
          name: 'GameLauncher',
          short_name: 'GameLauncher',
          description: 'Central de jogos e controle remoto de TV',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          orientation: 'any',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
            {
              src: '/gamepad.svg',
              sizes: '192x192 512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
            {
              src: '/favicon.svg',
              sizes: '48x48 96x96',
              type: 'image/svg+xml',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        },
      }),
    ],
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
