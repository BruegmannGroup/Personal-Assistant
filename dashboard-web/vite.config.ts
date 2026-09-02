import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages project site: served from https://<org>.github.io/Personal-Assistant/,
  // not the domain root, so all asset URLs need this prefix.
  base: "/Personal-Assistant/",
  plugins: [react()],
})
