import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
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
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        // MongoDB URI 统一从 YAML 配置读取，并可由 MONGO_URI 环境变量覆盖。
        uri: configService.get('mongo.uri', { infer: true }),
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
