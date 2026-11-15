import type { Product } from '@valio/shared';
import { findSimilarProducts } from '@valio/shared/products';

export class ProductCategoryService {
  async findSimilarProductsById(productId: string, amount: number = 3): Promise<Product[]> {
    const similarProducts = findSimilarProducts(productId, amount);
    return new Promise((resolve) => {
      setTimeout(() => resolve(similarProducts), 500); // simulate network delay
    });
  }
}
export const productCategoryService = new ProductCategoryService();
