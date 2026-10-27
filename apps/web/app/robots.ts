import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** Signed-in app pages have nothing for search engines; keep crawl budget on the public site. */
const PRIVATE = [
  '/dashboard', '/interviews', '/resume', '/practice', '/history', '/billing', '/settings', '/desktop-auth', '/auth/',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
