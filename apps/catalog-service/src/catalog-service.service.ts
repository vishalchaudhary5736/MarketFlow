import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

@Injectable()
export class CatalogServiceService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async getHello(): Promise<string> {
    const cached = await this.cache.get<string>('hello');
    if (cached) {
      return `${cached} (from cache)`;
    }

    const value = 'Hello World!';
    await this.cache.set('hello', value);
    return value;
  }
}
