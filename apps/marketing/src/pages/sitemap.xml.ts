import type { APIRoute } from 'astro'
import { superpowers } from '../lib/superpowers'

const pages = ['/', '/integrations', ...superpowers.map((power) => `/integrations/${power.id}`), '/privacy', '/imprint']

export const GET: APIRoute = ({ site }) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>${new URL(page, site)}</loc></url>`).join('')}</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml' },
  })
