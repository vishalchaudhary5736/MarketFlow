import { Controller, Get } from '@nestjs/common';
import { CatalogServiceService } from './catalog-service.service';

@Controller()
export class CatalogServiceController {
  constructor(private readonly catalogServiceService: CatalogServiceService) {}

  @Get()
  getHello(): Promise<string> {
    return this.catalogServiceService.getHello();
  }
}
