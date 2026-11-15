export interface Product {
  categories: ProductCategory[];
  ean: string;
  price: number;
  vendor: Vendor;
  id: string;
  names: TranslatedName[];
  image?: string;
}

export interface Vendor {
  code: string;
  name: string;
}

export interface TranslatedName {
  value: string;
  language: string;
}

export interface ProductCategory {
  code: string;
  name: string;
}

export interface PageResult<T> {
  data: T[];
  page: number;
  total: number;
  pageSize: number;
}

export function getEnglishName(product: { names?: TranslatedName[] }): string {
  return product.names?.find((t) => t.language === 'en')?.value || product.names?.[0]?.value || '';
}
