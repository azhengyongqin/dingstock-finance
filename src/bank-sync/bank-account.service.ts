import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BankAccountCardDto,
  CreateBankAccountDto,
} from './dto/create-bank-account.dto';
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
      cards: this.normalizeCards(dto.cards),
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
      ...(dto.cards ? { cards: this.normalizeCards(dto.cards) } : {}),
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

  private normalizeCards(cards: BankAccountCardDto[]) {
    const normalized = cards.map((card) => ({
      name: card.name.trim(),
      cardNbr: card.cardNbr.trim(),
    }));
    if (normalized.some((card) => !card.name || !card.cardNbr)) {
      throw new BadRequestException('银行卡名称和 cardNbr 不能为空');
    }

    const cardNumbers = normalized.map((card) => card.cardNbr);
    const uniqueCardNumbers = new Set(cardNumbers);

    if (uniqueCardNumbers.size !== cardNumbers.length) {
      throw new BadRequestException('银行卡号 cardNbr 不能重复');
    }

    return normalized;
  }
}
