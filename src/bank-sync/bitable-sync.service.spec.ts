import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { BitableSyncService } from './bitable-sync.service';
import { BITABLE_FIELDS } from './bitable-schema';
import { BankTransactionDocument } from './types/bank-records.type';
import { PrismaService } from '../prisma/prisma.service';

type BitableRecordMapper = {
  toBitableRecord(
    tx: BankTransactionDocument,
    accountCardMap: Map<string, { name: string; cardNbr: string }>,
  ): { fields: Record<string, string | number | boolean> } | undefined;
};

describe('BitableSyncService', () => {
  let service: BitableSyncService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BitableSyncService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string | number | boolean> = {
                'lark.appId': 'test-app-id',
                'lark.appSecret': 'test-app-secret',
                'lark.baseToken': 'test-base-token',
                'lark.bitableSyncEnabled': true,
                'lark.batchSize': 200,
                'lark.accountNameMaxLength': 50,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(BitableSyncService);
  });

  it('同步日期应以银行原始交易日为准，不能因时间戳跨时区变成次日', () => {
    const transaction = {
      id: 'transaction-id',
      UID: 'DL_LARKC0165000000206215',
      cardNbr: 'test-card-number',
      transSequenceIdn: 'C0447H8001RPZ7Z',
      // 模拟时间值在飞书所用的 Asia/Shanghai 时区中已经跨到 7 月 16 日。
      transDatetime: new Date('2026-07-15T16:39:00.000Z'),
      raw: {
        transDate: '20260715',
        transTime: '163900',
        transAmount: '-56616.00',
        loanCode: 'D',
      },
    } as BankTransactionDocument;

    const result = (service as unknown as BitableRecordMapper).toBitableRecord(
      transaction,
      new Map(),
    );
    const dateValue = result?.fields[BITABLE_FIELDS.DATE];

    expect(typeof dateValue).toBe('number');
    expect(dateValue).toBe(new Date('2026-07-15T16:39:00+08:00').getTime());
    expect(formatDateInShanghai(dateValue as number)).toBe('2026-07-15');
    expect(result?.fields[BITABLE_FIELDS.MONTH]).toBe('七月');
    expect(result?.fields[BITABLE_FIELDS.PERIOD]).toBe('第三周');
  });
});

function formatDateInShanghai(timestamp: number) {
  // 按飞书表格的业务时区还原年月日，测试只关心日期而不是具体时刻。
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${valueByType.get('year')}-${valueByType.get('month')}-${valueByType.get('day')}`;
}
