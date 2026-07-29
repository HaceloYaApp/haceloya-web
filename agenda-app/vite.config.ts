import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/agenda/',
  plugins: [react()],
  build: {
    outDir: '../agenda',
    emptyOutDir: true,
  },
})
