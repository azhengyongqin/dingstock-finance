import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import {
  BankAccount,
  BankAccountDocument,
} from './schemas/bank-account.schema';

@Injectable()
export class BankAccountService {
  constructor(
    @InjectModel(BankAccount.name)
    private readonly accountModel: Model<BankAccountDocument>,
  ) {}

  async create(dto: CreateBankAccountDto) {
    const account = new this.accountModel({
      ...dto,
      enabled: dto.enabled ?? true,
      cardNbr: this.normalizeCardNumbers(dto.cardNbr),
    });
    return account.save();
  }

  async findAll() {
    return this.accountModel.find().sort({ createdAt: -1 }).exec();
  }

  async findEnabled() {
    return this.accountModel.find({ enabled: true }).exec();
  }

  async update(id: string, dto: UpdateBankAccountDto) {
    const update = {
      ...dto,
      ...(dto.cardNbr
        ? { cardNbr: this.normalizeCardNumbers(dto.cardNbr) }
        : {}),
    };
    const account = await this.accountModel
      .findByIdAndUpdate(id, update, { returnDocument: 'after' })
      .exec();
    if (!account) {
      throw new NotFoundException('网银账户不存在');
    }
    return account;
  }

  async remove(id: string) {
    const account = await this.accountModel.findByIdAndDelete(id).exec();
    if (!account) {
      throw new NotFoundException('网银账户不存在');
    }
    return { deleted: true };
  }

  private normalizeCardNumbers(cardNbr: string[]) {
    // 去空格并去重，避免同一张卡在 cron 中被重复同步。
    return [...new Set(cardNbr.map((item) => item.trim()).filter(Boolean))];
  }
}
