import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BankAccountCardDto,
  CreateBankAccountDto,
} from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@Injectable()
export class BankAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBankAccountDto) {
    const { cards, ...accountFields } = dto;

    return this.prisma.bankAccount.create({
      data: {
        ...accountFields,
        enabled: dto.enabled ?? true,
        // cards 和账户同事务创建，保持原 TypeORM cascade: true 的行为。
        cards: {
          create: this.normalizeCards(cards),
        },
      },
      include: { cards: true },
    });
  }

  async findAll() {
    return this.prisma.bankAccount.findMany({
      include: { cards: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findEnabled() {
    return this.prisma.bankAccount.findMany({
      where: { enabled: true },
      include: { cards: true },
    });
  }

  async update(id: string, dto: UpdateBankAccountDto) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException('网银账户不存在');
    }

    const { cards, ...accountFields } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (cards) {
        // 替换银行卡列表前先清理旧子表记录，避免遗留已删除卡号。
        await tx.bankAccountCard.deleteMany({ where: { bankAccountId: id } });
      }

      return tx.bankAccount.update({
        where: { id },
        data: {
          ...accountFields,
          ...(cards
            ? {
                cards: {
                  create: this.normalizeCards(cards),
                },
              }
            : {}),
        },
        include: { cards: true },
      });
    });
  }

  async remove(id: string) {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id },
    });
    if (!account) {
      throw new NotFoundException('网银账户不存在');
    }
    await this.prisma.bankAccount.delete({ where: { id } });
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
