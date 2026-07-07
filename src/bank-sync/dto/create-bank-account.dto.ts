import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class BankAccountCardDto {
  @ApiProperty({
    description: '银行卡对应的公司或账户展示名称',
    example: '成都盯酷科技有限公司',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: '招商银行银行卡号',
    example: '128920768110001',
  })
  @IsString()
  @IsNotEmpty()
  cardNbr: string;
}

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
    description: '该网银账户下需要同步的银行卡列表，cardNbr 不能重复',
    example: [
      {
        name: '成都盯酷科技有限公司',
        cardNbr: '128920768110001',
      },
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BankAccountCardDto)
  @ArrayUnique((card: BankAccountCardDto) => card.cardNbr)
  cards: BankAccountCardDto[];

  @ApiProperty({ description: '是否参与定时同步', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
