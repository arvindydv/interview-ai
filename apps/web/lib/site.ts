// Canonical site identity for metadata, structured data, the sitemap and social cards.

import type { Metadata } from 'next';
import { FREE_MINUTES, PLANS, PRICE_PER_MINUTE } from '@parakeet/shared';
import { company } from '@/lib/company';

/** Public origin, no trailing slash. Every canonical URL and sitemap entry is built from it. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://friday-ai.in').replace(/\/$/, '');

export const SITE_NAME = company.brand;

/** Default <title>: what people search for first, brand last. Kept under ~60 characters. */
export const DEFAULT_TITLE = 'Friday AI: Real-Time AI Interview Assistant & Copilot';

/** Default meta description. Kept under ~160 characters so Google shows it whole. */
export const DEFAULT_DESCRIPTION =
  'Friday AI is a real-time AI interview assistant. It hears each question on Zoom, Meet or Teams and shows a tailored answer from your resume in under a second.';

/** The social card from app/opengraph-image.tsx. Pages that set their own openGraph must list it again. */
const OG_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: 'Friday AI: the real-time AI interview assistant' };

export const absoluteUrl = (path = '/') => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Title, description, canonical URL and social-card text for one public page. Every indexable page
 * sets its own canonical; it is never inherited, or every page would point at the home page.
 */
export function pageMetadata({ title, description, path, absoluteTitle = false }: {
  title: string;
  description: string;
  path: string;
  /** Use the title as is, without the "| Friday AI" suffix. */
  absoluteTitle?: boolean;
}): Metadata {
  const full = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_IN', url: path, title: full, description, images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title: full, description, images: [OG_IMAGE.url] },
  };
}

/** For signed-in app pages: a tab title, and kept out of search results. */
export const privateMetadata = (title: string): Metadata => ({ title, robots: { index: false, follow: false } });

/** Organization + WebSite + SoftwareApplication, shared by every public page. */
export function siteJsonLd() {
  const org = {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl('/icon.svg'),
    email: company.email,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: company.email,
      telephone: company.phone,
      areaServed: 'IN',
      availableLanguage: ['English'],
    },
  };
  const website = {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}/#organization` },
    inLanguage: 'en-IN',
  };
  const app = {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#app`,
    name: SITE_NAME,
    url: SITE_URL,
    description: DEFAULT_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'AI interview assistant',
    operatingSystem: 'Windows, macOS, Linux',
    publisher: { '@id': `${SITE_URL}/#organization` },
    featureList: [
      'Real-time answers to interview questions',
      'Screenshot solutions for coding problems',
      'AI mock interviews with scoring',
      'Answers personalised from your resume and the job description',
      'Overlay hidden from screen share on supported systems',
    ],
    offers: [
      {
        '@type': 'Offer',
        name: `Free trial (${FREE_MINUTES} minutes)`,
        price: '0',
        priceCurrency: 'INR',
        url: absoluteUrl('/pricing'),
      },
      {
        '@type': 'Offer',
        name: 'Pay per minute',
        price: String(PRICE_PER_MINUTE),
        priceCurrency: 'INR',
        url: absoluteUrl('/pricing'),
      },
      ...Object.values(PLANS).map((p) => ({
        '@type': 'Offer',
        name: p.name,
        price: String(p.amount / 100),
        priceCurrency: 'INR',
        url: absoluteUrl('/pricing'),
      })),
    ],
  };
  return { '@context': 'https://schema.org', '@graph': [org, website, app] };
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
}

export function breadcrumbJsonLd(trail: [name: string, path: string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [['Home', '/'] as const, ...trail].map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: absoluteUrl(path),
    })),
  };
}
