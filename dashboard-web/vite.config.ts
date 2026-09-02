import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this as a project site (a subpath, not the domain root),
  // so asset URLs need a prefix there. Heroku serves it at its own domain root,
  // so it needs no prefix. VITE_BASE_PATH lets each deploy target set the right
  // one instead of hardcoding one and breaking the other — the GitHub Actions
  // workflow sets it to "/Personal-Assistant/"; everywhere else defaults to "/".
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
})
