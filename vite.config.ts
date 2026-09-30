import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), react()],
  server: {
    watch: { ignored: ['**/mockups/**'] },
    port: Number(process.env.FORKBASKET_PORT ?? 3100),
    strictPort: true,
    proxy: {
      '/api': process.env.FORKBASKET_API_URL ?? 'http://127.0.0.1:3001',
    },
  },
})
