import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from the root of the Worker's own hostname, so no path prefix.
  base: "/",
  plugins: [react()],
})
