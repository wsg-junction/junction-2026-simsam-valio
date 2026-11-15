export interface SupplierProduct {
  searchNames?: string[];
  image?: string;
  productId: string;
  name: string;
  categories: string[];
  /** Static descriptive fields only: never import historical prices or stock. */
  description: string;
  origin?: string;
  dietary: string[];
  certificates: string[];
  allergens?: string[];
  salesUnit?: string;
  amountPerSalesUnit?: { quantity: number; unit: 'L' | 'kg' };
}
export interface SupplierOffer {
  product: SupplierProduct;
  unitPrice?: number;
  salesUnit?: string;
  availableSalesUnits: number | null;
  terminal: boolean;
  availableDate?: string;
  closingTime?: string;
  validFrom?: string;
  validTo?: string;
  blocked: boolean;
  issues: string[];
}
export interface SupplierSearch {
  source: 'valio-api' | 'mock'; query: string; requestedDate: string; checkedAt: string; offers: SupplierOffer[];
}
export interface SupplierQuote {
  source: 'valio-api' | 'mock'; quoteId: string; customer: string; requestedDate: string; checkedAt: string;
  currency: 'EUR'; total: number;
  lines: { productId: string; name: string; image?: string; salesUnits: number; salesUnit: string; quantity?: number; baseUnit?: string; unitPrice: number; total: number; availableDate: string; terminal: boolean; closingTime?: string; validFrom: string; validTo: string }[];
  /** The supplied API has no reservation, binding quote or order endpoint. */
  binding: false;
}

