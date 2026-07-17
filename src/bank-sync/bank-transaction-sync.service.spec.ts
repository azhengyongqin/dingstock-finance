import { BankTransactionSyncService } from './bank-transaction-sync.service';
import { BankAccountService } from './bank-account.service';
import { CmbApiService } from '../cmb/cmb.service';
import { PrismaService } from '../prisma/prisma.service';

type TransactionDateBuilder = {
  buildTransDatetime(transDate: string, transTime?: string): Date;
};

describe('BankTransactionSyncService', () => {
  it('应把招商银行日期和时间固定按 UTC+8 拼接入库', () => {
    const service = new BankTransactionSyncService(
      {} as BankAccountService,
      {} as CmbApiService,
      {} as PrismaService,
    );

    const result = (
      service as unknown as TransactionDateBuilder
    ).buildTransDatetime('20260715', '163900');

    // Date 的 ISO 输出固定为 UTC；数据库在 +08 时区读取仍是 7 月 15 日 16:39。
    expect(result.toISOString()).toBe('2026-07-15T08:39:00.000Z');
    expect(formatDateTimeInShanghai(result)).toBe('2026-07-15 16:39:00');
  });
});

function formatDateTimeInShanghai(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${valueByType.get('year')}-${valueByType.get('month')}-${valueByType.get('day')} ${valueByType.get('hour')}:${valueByType.get('minute')}:${valueByType.get('second')}`;
}
