import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BankAccountCardDto,
  CreateBankAccountDto,
} from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { BankAccount } from './entities/bank-account.entity';
import { BankAccountCard } from './entities/bank-account-card.entity';

@Injectable()
export class BankAccountService {
  constructor(
    @InjectRepository(BankAccount)
    private readonly accountRepository: Repository<BankAccount>,
    @InjectRepository(BankAccountCard)
    private readonly cardRepository: Repository<BankAccountCard>,
  ) {}

  async create(dto: CreateBankAccountDto) {
    const account = this.accountRepository.create({
      ...dto,
      enabled: dto.enabled ?? true,
      cards: this.normalizeCards(dto.cards).map((card) =>
        this.cardRepository.create(card),
      ),
    });
    return this.accountRepository.save(account);
  }

  async findAll() {
    return this.accountRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findEnabled() {
    return this.accountRepository.find({ where: { enabled: true } });
  }

  async update(id: string, dto: UpdateBankAccountDto) {
    const account = await this.accountRepository.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException('网银账户不存在');
    }

    const { cards, ...accountFields } = dto;
    const update: Partial<BankAccount> = {
      ...accountFields,
    };

    if (cards) {
      // 替换银行卡列表前先清理旧子表记录，避免级联保存时遗留已删除卡号。
      await this.cardRepository.delete({ bankAccountId: id });
      update.cards = this.normalizeCards(cards).map((card) =>
        this.cardRepository.create({ ...card, bankAccountId: id }),
      );
    }

    Object.assign(account, update);
    return this.accountRepository.save(account);
  }

  async remove(id: string) {
    const account = await this.accountRepository.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException('网银账户不存在');
    }
    await this.accountRepository.remove(account);
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
