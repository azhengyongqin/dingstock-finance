import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CmbApiService } from '../cmb/cmb.service';
import { BankAccountService } from './bank-account.service';
import {
  BankTransaction,
  BankTransactionDocument,
} from './schemas/bank-transaction.schema';
import {
  BankTransactionSyncState,
  BankTransactionSyncStateDocument,
} from './schemas/bank-transaction-sync-state.schema';
import { BankAccountDocument } from './schemas/bank-account.schema';

interface BreakpointY1 {
  acctNbr?: string;
  transDate?: string;
  expectNextSequence?: string;
}

interface QuerySummaryZ1 {
  ctnFlag?: string;
  queryAcctNbr?: string;
}

type TransactionZ2 = Record<string, unknown>;
type CmbResponseBody = Record<string, unknown>;

@Injectable()
export class BankTransactionSyncService {
  private readonly logger = new Logger(BankTransactionSyncService.name);
  private running = false;

  constructor(
    private readonly accountService: BankAccountService,
    private readonly cmbApiService: CmbApiService,
    @InjectModel(BankTransaction.name)
    private readonly transactionModel: Model<BankTransactionDocument>,
    @InjectModel(BankTransactionSyncState.name)
    private readonly syncStateModel: Model<BankTransactionSyncStateDocument>,
  ) {}

  @Cron('0 */3 * * * *')
  async syncAllAccounts() {
    if (this.running) {
      this.logger.warn('上一次银行交易同步仍在执行，本轮跳过');
      return;
    }

    this.running = true;
    try {
      const accounts = await this.accountService.findEnabled();
      for (const account of accounts) {
        for (const card of account.cards ?? []) {
          await this.syncCard(account, card.cardNbr);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async syncCard(account: BankAccountDocument, cardNbr: string) {
    const startedAt = new Date();
    const accountId = account._id;
    const state = await this.syncStateModel.findOneAndUpdate(
      { bankAccountId: accountId, cardNbr },
      {
        $setOnInsert: {
          bankAccountId: accountId,
          UID: account.UID,
          cardNbr,
          breakpointY1: [],
          lastSyncedCount: 0,
        },
        $set: { lastStartedAt: startedAt, lastError: undefined },
      },
      { returnDocument: 'after', upsert: true },
    );

    try {
      const result = await this.queryAndPersist(account, cardNbr, state);
      await this.syncStateModel.updateOne(
        { _id: state._id },
        {
          $set: {
            breakpointY1: result.breakpointY1,
            lastBeginDate: result.beginDate,
            lastEndDate: result.endDate,
            lastFinishedAt: new Date(),
            lastSyncedCount: result.syncedCount,
          },
          $unset: { lastError: '' },
        },
      );
      this.logger.log(
        `银行交易同步完成 UID=${account.UID} cardNbr=${cardNbr} count=${result.syncedCount}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.syncStateModel.updateOne(
        { _id: state._id },
        { $set: { lastFinishedAt: new Date(), lastError: message } },
      );
      this.logger.error(
        `银行交易同步失败 UID=${account.UID} cardNbr=${cardNbr}: ${message}`,
      );
    }
  }

  private async queryAndPersist(
    account: BankAccountDocument,
    cardNbr: string,
    state: BankTransactionSyncStateDocument,
  ) {
    const beginDate = this.resolveBeginDate(state.breakpointY1);
    const endDate = this.formatDate(new Date());
    let queryAcctNbr = '';
    let breakpointY1 = state.breakpointY1 as BreakpointY1[];
    let syncedCount = 0;

    // CMB 单次最多返回 200 条；最多循环 100 页，防止异常响应造成无限续传。
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.cmbApiService.sendRequestWithCredentials(
        {
          head: {
            funcode: 'trsQryByBreakPoint',
            userid: account.UID,
          },
          body: this.buildQueryBody(
            cardNbr,
            beginDate,
            endDate,
            queryAcctNbr,
            breakpointY1,
          ),
        },
        {
          uid: account.UID,
          privateKey: account.smPrivateKey,
          publicKey: account.smPublicKey,
          symKey: account.smSymKey,
        },
      );

      const body = this.assertSuccessResponse(response, {
        uid: account.UID,
        cardNbr,
        page,
        beginDate,
        endDate,
      });
      const nextBreakpointY1 = this.readArray<BreakpointY1>(
        body.TRANSQUERYBYBREAKPOINT_Y1,
      );
      const [summary] = this.readArray<QuerySummaryZ1>(
        body.TRANSQUERYBYBREAKPOINT_Z1,
      );
      const transactions = this.readArray<TransactionZ2>(
        body.TRANSQUERYBYBREAKPOINT_Z2,
      );

      await this.persistTransactions(account, cardNbr, transactions);
      syncedCount += transactions.length;

      breakpointY1 = nextBreakpointY1;
      if (summary?.ctnFlag !== 'Y') {
        return { beginDate, endDate, breakpointY1, syncedCount };
      }

      queryAcctNbr = `${summary.queryAcctNbr ?? ''}`.trim();
      if (!queryAcctNbr || !breakpointY1.length) {
        throw new Error('CMB 续传响应缺少 queryAcctNbr 或 Y1 断点');
      }
    }

    throw new Error('CMB 续传超过 100 页，已停止本轮同步');
  }

  private buildQueryBody(
    cardNbr: string,
    beginDate: string,
    endDate: string,
    queryAcctNbr: string,
    breakpointY1: BreakpointY1[],
  ) {
    const body: Record<string, unknown> = {
      TRANSQUERYBYBREAKPOINT_X1: [
        {
          cardNbr,
          beginDate,
          endDate,
          transactionSequence: '1',
          currencyCode: '',
          queryAcctNbr,
          reserve: '',
        },
      ],
    };

    // 首次查询不传 Y1；断点查询和续传查询都原样带上上次银行返回的 Y1。
    if (breakpointY1.length) {
      body.TRANSQUERYBYBREAKPOINT_Y1 = breakpointY1;
    }
    return body;
  }

  private assertSuccessResponse(
    response: Record<string, unknown>,
    context: {
      uid: string;
      cardNbr: string;
      page: number;
      beginDate: string;
      endDate: string;
    },
  ) {
    const responsePayload = this.asRecord(response.response);
    const head = this.asRecord(responsePayload.head);
    const resultcode = this.optionalString(head.resultcode);
    const resultmsg = this.optionalString(head.resultmsg) ?? '';
    if (resultcode !== 'SUC0000') {
      throw new Error(
        `CMB 查询银行流水失败 UID=${context.uid} cardNbr=${context.cardNbr} page=${context.page} beginDate=${context.beginDate} endDate=${context.endDate} resultcode=${resultcode ?? 'UNKNOWN'} resultmsg=${resultmsg || 'UNKNOWN'}`,
      );
    }
    return this.asRecord(responsePayload.body);
  }

  private async persistTransactions(
    account: BankAccountDocument,
    cardNbr: string,
    transactions: TransactionZ2[],
  ) {
    if (!transactions.length) {
      return;
    }

    const accountId = account._id;
    await this.transactionModel.bulkWrite(
      transactions.map((item) => {
        const normalized = this.trimRecord(item);
        const transSequenceIdn = this.requiredString(
          normalized.transSequenceIdn,
        );
        const transDate = this.requiredString(normalized.transDate);
        return {
          updateOne: {
            // 按银行交易唯一流水号去重，避免断点续传或定时重跑时重复入库。
            filter: { transSequenceIdn },
            update: {
              $set: {
                bankAccountId: accountId,
                UID: account.UID,
                cardNbr,
                transDatetime: this.buildTransDatetime(
                  transDate,
                  this.optionalString(normalized.transTime),
                ),
                transSequenceIdn,
                raw: normalized,
              },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }

  private resolveBeginDate(breakpointY1: Array<Record<string, string>>) {
    const dates = breakpointY1
      .map((item) => item.transDate)
      .filter((item): item is string => /^\d{8}$/.test(item))
      .sort();
    // 首次没有断点时默认回补近一年交易；后续同步改用银行返回的 Y1 断点继续查。
    return dates[0] ?? this.formatDate(this.addYears(new Date(), -1));
  }

  private readArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
  }

  private trimRecord(record: Record<string, unknown>) {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      normalized[key] = typeof value === 'string' ? value.trim() : value;
    }
    return normalized;
  }

  private optionalString(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
    return undefined;
  }

  private requiredString(value: unknown) {
    return this.optionalString(value) ?? '';
  }

  private buildTransDatetime(transDate: string, transTime?: string) {
    const dateMatched = /^(\d{4})(\d{2})(\d{2})$/.exec(transDate);
    if (!dateMatched) {
      throw new Error(`CMB 交易日期格式无效: ${transDate}`);
    }

    const timeMatched = /^(\d{2})(\d{2})(\d{2})$/.exec(transTime ?? '000000');
    if (!timeMatched) {
      throw new Error(`CMB 交易时间格式无效: ${transTime}`);
    }

    const [, year, month, day] = dateMatched;
    const [, hour, minute, second] = timeMatched;
    // 银行返回的是本地交易日期时间；用 Date.UTC 固化存储，避免服务器时区变化影响查询边界。
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    );
  }

  private asRecord(value: unknown): CmbResponseBody {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as CmbResponseBody;
    }
    return {};
  }

  private formatDate(date: Date) {
    return (
      String(date.getFullYear()) +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0')
    );
  }

  private addYears(date: Date, years: number) {
    const next = new Date(date);
    next.setFullYear(next.getFullYear() + years);
    return next;
  }
}
