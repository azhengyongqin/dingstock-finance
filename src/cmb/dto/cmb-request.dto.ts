// DTO：请求入参保持最小化，接收 body/head 两个结构化字段。
import { ApiProperty } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsNotEmptyObject,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CmbRequestHeadDto {
  @ApiProperty({
    description: '业务接口码；如未传，自动尝试从 body.buscod 映射或返回 400',
    example: 'DCLISMOD',
    required: false,
  })
  @IsOptional()
  @IsString()
  funcode?: string;

  @ApiProperty({
    description: '企业网银用户号，未传时默认使用配置文件 uid',
    example: 'N002466756',
    required: false,
  })
  @IsOptional()
  @IsString()
  userid?: string;

  @ApiProperty({
    description: '业务请求唯一 ID，未传时由服务端自动生成',
    example: '20260701010101001010101',
    required: false,
  })
  @IsOptional()
  @IsString()
  reqid?: string;
}

export class CmbRequestDto {
  /**
   * body 业务请求参数（例如：{ buscod: 'N02030', ... }）。
   */
  @ApiProperty({
    description: '业务报文体参数',
    type: Object,
    example: {
      buscod: 'N02030',
    },
  })
  @IsObject()
  @IsNotEmptyObject()
  body: Record<string, unknown>;

  /**
   * head 可选参数；缺省项由服务端填充：funcode/userid/reqid。
   */
  @ApiProperty({
    description: '头信息可选：funcode/userid/reqid',
    type: CmbRequestHeadDto,
    required: false,
    example: {
      funcode: 'DCLISMOD',
      userid: 'N002466756',
      reqid: '20260701010101001010101',
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CmbRequestHeadDto)
  head?: CmbRequestHeadDto;
}
