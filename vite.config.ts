import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// WebXR requires a secure context. `VR=1 npm run dev -- --host` serves over
// self-signed HTTPS so a headset on the same LAN can connect; plain
// `npm run dev` stays http://localhost for desktop work.
export default defineConfig({
  plugins: process.env.VR ? [basicSsl()] : [],
})
