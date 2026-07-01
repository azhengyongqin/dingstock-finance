import { Body, Controller, Logger, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CmbRequestDto } from './dto/cmb-request.dto';
import { CmbApiService } from './cmb.service';

// 对外暴露的请求入口，对标原先 apidemo.js 的调用入口。
@ApiTags('cmb')
@Controller('cmb')
export class CmbController {
  private readonly logger = new Logger(CmbController.name);
  constructor(private readonly cmbApiService: CmbApiService) {}

  // POST /cmb/request
  @ApiOperation({
    summary: '发送 CMB 国密接口请求',
    description: '对请求体做签名加密、请求 CMB 网关并解密验签后返回明文 JSON',
  })
  @ApiBody({ type: CmbRequestDto })
  @ApiCreatedResponse({
    description: '返回 CMB 解密并验签后的响应报文',
  })
  @Post('request')
  request(@Body() dto: CmbRequestDto) {
    return this.cmbApiService.sendRequest(dto);
  }
}
