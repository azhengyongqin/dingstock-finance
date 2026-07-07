import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/app-config.type';
import { FINANCE_DATABASE_SCHEMA } from '../config/database.constants';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      // Prisma 7 需要 driver adapter；schema 固定到 finance，和模型 @@schema 保持一致。
      adapter: new PrismaPg(
        configService.get('postgres.uri', { infer: true }),
        {
          schema: FINANCE_DATABASE_SCHEMA,
        },
      ),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
