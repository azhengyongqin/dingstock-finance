import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfig } from './config/app-config.type';
import configuration from './config/configuration';
import { CmbModule } from './cmb/cmb.module';
import { BankSyncModule } from './bank-sync/bank-sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        type: 'postgres',
        // PostgreSQL URI 统一从 YAML 配置读取，并可由 POSTGRES_URI 环境变量覆盖。
        url: configService.get('postgres.uri', { infer: true }),
        autoLoadEntities: true,
        // 当前项目还没有迁移框架；先让本地/部署环境自动补齐表结构。
        synchronize: configService.get('postgres.synchronize', {
          infer: true,
        }),
      }),
    }),
    ScheduleModule.forRoot(),
    CmbModule,
    BankSyncModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
