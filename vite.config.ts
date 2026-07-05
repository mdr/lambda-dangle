import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// WebXR requires a secure context. `VR=1 npm run dev -- --host` serves over
// self-signed HTTPS so a headset on the same LAN can connect; plain
// `npm run dev` stays http://localhost for desktop work.
export default defineConfig({
  // relative base so the same build works at / (local preview) and at
  // /lambda-dangle/ (GitHub Pages project site)
  base: './',
  plugins: process.env.VR ? [basicSsl()] : [],
})
