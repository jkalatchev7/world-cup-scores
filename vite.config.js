import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function normalizeSiteUrl(rawUrl) {
  if (!rawUrl) {
    return ''
  }

  const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

  return withProtocol.replace(/\/+$/, '')
}

function createSeoFilesPlugin(siteUrl) {
  const routes = ['/', '/practice', '/leaderboard', '/how-it-works', '/privacy', '/terms']

  return {
    name: 'scoredle-seo-files',
    apply: 'build',
    generateBundle() {
      const hostname = siteUrl || 'https://scoredle.xyz'
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((route) => `  <url><loc>${new URL(route, `${hostname}/`).toString()}</loc></url>`).join('\n')}
</urlset>
`
      const robots = `User-agent: *
Allow: /

Sitemap: ${new URL('/sitemap.xml', `${hostname}/`).toString()}
`

      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: sitemap,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: robots,
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const siteUrl = normalizeSiteUrl(
    env.VITE_SITE_URL ||
    env.SITE_URL ||
    env.VERCEL_PROJECT_PRODUCTION_URL ||
    'https://scoredle.xyz',
  )

  return {
    plugins: [react(), createSeoFilesPlugin(siteUrl)],
  }
})
