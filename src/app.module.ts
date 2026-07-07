import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { CmbModule } from './cmb/cmb.module';
import { BankSyncModule } from './bank-sync/bank-sync.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PrismaModule,
    ScheduleModule.forRoot(),
    CmbModule,
    BankSyncModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
