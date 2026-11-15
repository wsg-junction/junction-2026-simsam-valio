/** Common ingredient names across the source catalogue's three languages. */
export function normalizeProductQuery(query: string): string {
 return query.toLowerCase().replace(/\b(chicken|kana|kanan|kananpoika|kananpojan|broileri|broilerin|kyckling)\b/gu, 'chicken').replace(/\b(carrots?|porkkana|porkkanat|morot|mor�tter)\b/gu, 'carrot');
}
