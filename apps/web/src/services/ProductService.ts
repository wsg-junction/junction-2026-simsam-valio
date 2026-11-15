import type { PageResult, Product } from '@valio/shared';
import { getProductById, products, searchProducts } from '@valio/shared/products';

export type { PageResult, Product, ProductCategory, TranslatedName, Vendor } from '@valio/shared';

export class ProductService {
  async getProducts(page = -1): Promise<PageResult<Product>> {
    let data: Product[] = [];
    if (page === -1) {
      data = products;
    } else {
      const start = page * 20;
      const end = start + 20;
      data = products.slice(start, end);
    }

    return new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            data,
            page: page,
            total: products.length,
            pageSize: 20,
          }),
        500,
      ); // simulate network delay
    });
  }

  async searchProducts(query: string): Promise<Product[]> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(searchProducts(query)), 300); // simulate network delay
    });
  }

  getProductById(id: string): Product | undefined {
    return getProductById(id);
  }
}
export const productService = new ProductService();
