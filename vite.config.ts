import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), react()],
  server: {
    watch: { ignored: ['**/mockups/**'] },
    port: 3100,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
})
