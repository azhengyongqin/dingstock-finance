import { Module } from '@nestjs/common';
import { CmbApiService } from './cmb.service';
import { CmbController } from './cmb.controller';

@Module({
  controllers: [CmbController],
  providers: [CmbApiService],
  exports: [CmbApiService],
})
export class CmbModule {}
