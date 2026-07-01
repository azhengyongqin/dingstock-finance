import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { BankAccountService } from './bank-account.service';

@ApiTags('bank-accounts')
@Controller('bank-accounts')
export class BankAccountController {
  constructor(private readonly accountService: BankAccountService) {}

  @Post()
  @ApiOperation({ summary: '新增网银账户及其银行卡号列表' })
  @ApiCreatedResponse({ description: '网银账户创建成功' })
  create(@Body() dto: CreateBankAccountDto) {
    return this.accountService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '查询全部网银账户' })
  findAll() {
    return this.accountService.findAll();
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新网银账户配置或银行卡号列表' })
  update(@Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    return this.accountService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除网银账户' })
  remove(@Param('id') id: string) {
    return this.accountService.remove(id);
  }
}
