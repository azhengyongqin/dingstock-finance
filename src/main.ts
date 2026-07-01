import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.type';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      // 自动去掉 DTO 未声明字段，避免密钥或卡号管理接口写入意外字段。
      whitelist: true,
      transform: true,
    }),
  );
  // Swagger 文档配置，生成可访问的 /api-docs 页面。
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Dingstock Finance API')
    .setDescription('招商银行 CMB 接口与项目现有服务的接口文档')
    .setVersion('1.0.0')
    .addTag('cmb')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument);

  const configService = app.get(ConfigService<AppConfig, true>);
  const port = configService.get('app.port', { infer: true });

  await app.listen(port);
}
void bootstrap();
