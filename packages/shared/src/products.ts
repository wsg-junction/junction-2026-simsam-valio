import productsData from '../data/products.json' with { type: 'json' };
import { getEnglishName, type Product } from './product';

export const products = productsData as Product[];

export function getProductById(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function searchProducts(query: string, limit = 50): Product[] {
  const parts = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((p) => p.length);

  return products
    .filter((product) =>
      parts.every((part) => product.names?.some((name) => name.value.toLocaleLowerCase().includes(part))),
    )
    .slice(0, limit);
}

/**
 * Ranks products by number of shared (specific, >3 chars) category codes, then by how many tokens of the
 * English name they share with the given product.
 */
export function findSimilarProducts(productId: string, amount = 3): Product[] {
  const product = getProductById(productId);
  if (!product) return [];

  const categoryCodes = product.categories.map((category) => category.code);
  const tokens = getEnglishName(product).toLowerCase().split(/\s+/).filter(Boolean);

  return products
    .map((p) => {
      const matchingCategories = p.categories
        .map((category) => category.code)
        .filter((code) => code.length > 3)
        .filter((code) => categoryCodes.includes(code));

      const nameLower = getEnglishName(p).toLowerCase();
      const nameMatchCount = tokens.reduce((acc, t) => acc + (nameLower.includes(t) ? 1 : 0), 0);

      return { product: p, matchingCategories: matchingCategories.length, nameMatchCount };
    })
    .filter((p) => p.product.id !== product.id && (p.matchingCategories > 0 || p.nameMatchCount > 0))
    .sort((a, b) =>
      b.matchingCategories !== a.matchingCategories
        ? b.matchingCategories - a.matchingCategories
        : b.nameMatchCount - a.nameMatchCount,
    )
    .slice(0, amount)
    .map((p) => p.product);
}
