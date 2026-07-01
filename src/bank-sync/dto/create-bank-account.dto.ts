import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({ description: '招商银行企业网银 UID', example: 'N002466756' })
  @IsString()
  UID: string;

  @ApiProperty({ description: '账户名称，便于后台识别', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'SM2 私钥，保持招商银行配置的 Base64 文本' })
  @IsString()
  smPrivateKey: string;

  @ApiProperty({ description: 'SM2 公钥，保持招商银行配置的 Base64 文本' })
  @IsString()
  smPublicKey: string;

  @ApiProperty({ description: 'SM4 对称密钥，保持招商银行配置的原始文本' })
  @IsString()
  smSymKey: string;

  @ApiProperty({
    description: '该网银账户下需要同步的银行卡号列表',
    example: ['755947919810515'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  cardNbr: string[];

  @ApiProperty({ description: '是否参与定时同步', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
