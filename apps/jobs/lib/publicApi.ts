import type { ListingCompany, ListingDetail, ListingPage, ListingQuery } from '@parakeet/shared';

// Listings come from the Edge API's public routes (apps/api/src/routes/listings.ts), fetched by server
// components. In production the site reaches the API over the internal network (API_URL).
const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function get<T>(path: string, revalidate: number): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { next: { revalidate } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function searchListings(query: ListingQuery): Promise<ListingPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  return (await get<ListingPage>(`/v1/listings?${params}`, 60))!;
}

export const getListing = (id: string) => get<ListingDetail>(`/v1/listings/${encodeURIComponent(id)}`, 300);

export async function getCompanies(): Promise<ListingCompany[]> {
  return (await get<ListingCompany[]>('/v1/listings/companies', 300)) ?? [];
}
