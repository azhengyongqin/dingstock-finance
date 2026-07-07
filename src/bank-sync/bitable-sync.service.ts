import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { AxiosError } from 'axios';
import * as lark from '@larksuiteoapi/node-sdk';
import { AppConfig } from '../config/app-config.type';
import {
  BankTransaction,
  BankTransactionDocument,
} from './schemas/bank-transaction.schema';
import {
  BankAccount,
  BankAccountDocument,
} from './schemas/bank-account.schema';

interface BitableRecordPayload {
  records: Array<{
    fields: Record<string, string | number | boolean>;
  }>;
}

interface BitableUpdateRecordPayload {
  records: Array<{
    record_id: string;
    fields: Record<string, string | number | boolean>;
  }>;
}

interface BitableSyncRecord {
  txId: string;
  fields: Record<string, string | number | boolean>;
  fieldsHash: string;
  transactionId: string;
}

interface BitableSyncUpdateRecord {
  txId: string;
  record_id: string;
  fields: Record<string, string | number | boolean>;
}

interface BitableSyncMatchedRecord {
  txId: string;
  record_id: string;
  fieldsHash: string;
}

interface BankAccountCardInfo {
  name: string;
  cardNbr: string;
}

interface BitableExistingRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

interface BitableCheckedCandidates {
  transactions: BankTransactionDocument[];
  existingRecordMap?: Map<string, BitableExistingRecord>;
}

@Injectable()
export class BitableSyncService implements OnModuleInit {
  private readonly logger = new Logger(BitableSyncService.name);
  private readonly larkClient: lark.Client;
  private running = false;

  private static readonly MONTH_NAMES = [
    '一月',
    '二月',
    '三月',
    '四月',
    '五月',
    '六月',
    '七月',
    '八月',
    '九月',
    '十月',
    '十一月',
    '十二月',
  ];

  // 与当前「银行日记账」表字段名称一一对应（只写入可写字段）。
  // 使用字段名而非字段ID，便于和飞书端快速对齐；公式字段「净值/余额」不在同步写入范围。
  private static readonly FIELD_DATE = '日期'; // 日期
  private static readonly FIELD_SUMMARY = '摘要'; // 摘要
  private static readonly FIELD_AMOUNT_IN = '收入金额'; // 收入金额
  private static readonly FIELD_AMOUNT_OUT = '支出金额'; // 支出金额
  private static readonly FIELD_CURRENCY = '币种'; // 币种
  private static readonly FIELD_COUNTERPARTY = '对方单位'; // 对方单位
  // 飞书表内实际字段名：账户（文本字段名）。
  private static readonly FIELD_ACCOUNT = '账户'; // 账户
  private static readonly FIELD_CARD_NBR = '银行卡号'; // 银行卡号
  private static readonly FIELD_BALANCE = '余额（系统）'; // 余额（系统）
  private static readonly FIELD_MONTH = '月份'; // 月份
  private static readonly FIELD_PERIOD = '周期'; // 周期
  private static readonly FIELD_TRANSACTION_ID = '流水号'; // 交易流水号

  private readonly appToken?: string;
  private readonly tableId?: string;
  private readonly isEnabled: boolean;
  private readonly hasCredentials: boolean;
  private readonly batchSize: number;
  private readonly accountNameLimit: number;
  private readonly bitableSearchChunkSize = 20;
  private readonly bitableCheckBatchSize = 50;
  private readonly permissionCheckTtlMs = 5 * 60 * 1000;
  private lastPermissionCheckAt = 0;
  private permissionCheckPassed = false;

  constructor(
    @InjectModel(BankTransaction.name)
    private readonly transactionModel: Model<BankTransactionDocument>,
    @InjectModel(BankAccount.name)
    private readonly accountModel: Model<BankAccountDocument>,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.larkClient = new lark.Client({
      appId: configService.get('lark.appId', { infer: true }),
      appSecret: configService.get('lark.appSecret', { infer: true }),
      appType: lark.AppType.SelfBuild,
    });

    // 配置驱动：未填飞书凭据时跳过执行，避免服务启动即报错。
    const appId = configService.get('lark.appId', { infer: true });
    const appSecret = configService.get('lark.appSecret', { infer: true });
    this.appToken = configService.get('lark.baseToken', { infer: true });
    this.tableId = configService.get('lark.tableId', { infer: true });
    this.hasCredentials = !!appId && !!appSecret;
    this.isEnabled = configService.get<boolean>('lark.bitableSyncEnabled', {
      infer: true,
    });
    this.batchSize = Math.max(
      1,
      Math.min(
        500,
        Number(configService.get('lark.batchSize', { infer: true }) ?? 200),
      ),
    );
    this.accountNameLimit = Number(
      configService.get('lark.accountNameMaxLength', { infer: true }) ?? 50,
    );
  }

  // 定时任务：每30秒把数据库里的「未同步」交易推送到飞书多维表格。
  @Cron('*/30 * * * * *')
  async syncPendingTransactions() {
    if (!this.isEnabled) {
      this.logger.debug('飞书多维表格同步未开启，跳过本轮执行');
      return;
    }

    if (!this.appToken || !this.tableId) {
      this.logger.warn('缺少飞书 baseToken/tableId，未同步到多维表格');
      return;
    }

    if (!this.hasCredentials) {
      this.logger.warn('缺少飞书 appId/appSecret，未同步到多维表格');
      return;
    }

    if (this.running) {
      this.logger.warn('上一轮多维表格同步仍在执行，本轮跳过');
      return;
    }

    this.running = true;
    try {
      await this.syncBatch();
    } catch (error) {
      this.logger.error(`多维表格同步失败：${this.formatErrorForLog(error)}`);
    } finally {
      this.running = false;
    }
  }

  // 应用启动时先做一次飞书权限自检，避免服务上线后再在同步时才暴露 403。
  async onModuleInit() {
    if (!this.isEnabled) {
      this.logger.log('飞书多维表格同步未开启，跳过启动自检');
      return;
    }
    if (!this.appToken || !this.tableId) {
      this.logger.warn(
        '启动自检：缺少飞书 baseToken/tableId，无法执行权限检查',
      );
      return;
    }
    if (!this.hasCredentials) {
      this.logger.warn('启动自检：缺少飞书 appId/appSecret，无法执行权限检查');
      return;
    }

    try {
      await this.verifyBitablePermission();
      this.logger.log('启动自检：飞书多维表格权限校验通过');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `启动自检：飞书多维表格权限校验失败 -> ${errorMessage}`,
      );
    }
  }

  // 对外提供一个可按需手动触发的入口。
  async syncOnce(): Promise<void> {
    if (!this.isEnabled) {
      this.logger.debug('飞书多维表格同步未开启，跳过手工执行');
      return;
    }

    if (!this.appToken || !this.tableId) {
      throw new Error('缺少飞书 baseToken/tableId 配置');
    }

    if (!this.hasCredentials) {
      throw new Error('缺少飞书 appId/appSecret');
    }

    await this.syncBatch();
  }

  private async syncBatch() {
    const { transactions, existingRecordMap: checkedExistingRecordMap } =
      await this.fetchSyncCandidates();
    if (transactions.length === 0) {
      await this.logNoUnsyncedTransactionsWithAccountSummary();
      return;
    }
    // 写入前先校验 Base 与表权限，避免 403 在批量写入时才暴露。
    await this.verifyBitablePermission();

    const accountCardMap = await this.loadAccountCardInfoMap(transactions);
    const syncRecords: BitableSyncRecord[] = transactions
      .map((tx) => {
        const record = this.toBitableRecord(tx, accountCardMap);
        if (!record) {
          return undefined;
        }
        const transactionId = tx.transSequenceIdn?.trim();
        if (!transactionId) {
          return undefined;
        }
        return {
          txId: tx._id.toString(),
          transactionId,
          fields: record.fields,
          fieldsHash: this.hashBitableFields(record.fields),
        };
      })
      .filter((item): item is BitableSyncRecord => item !== undefined);

    if (syncRecords.length === 0) {
      this.logger.warn('存在待同步交易但可写字段不足，跳过当前批次');
      return;
    }

    const transactionIds = syncRecords.map((item) => item.transactionId);
    const existingRecordMap =
      checkedExistingRecordMap ??
      (await this.fetchBitableRecordsByTransactionIds(transactionIds));
    const toCreate = syncRecords.filter(
      (item) => !existingRecordMap.has(item.transactionId),
    );
    const toUpdate: BitableSyncUpdateRecord[] = syncRecords
      .filter((item) => this.shouldUpdateBitableRecord(item, existingRecordMap))
      .map((item) => ({
        record_id: existingRecordMap.get(item.transactionId)!.recordId,
        fields: item.fields,
        txId: item.txId,
      }));
    const matchedWithoutChanges: BitableSyncMatchedRecord[] = syncRecords
      .filter(
        (item) =>
          existingRecordMap.has(item.transactionId) &&
          !this.shouldUpdateBitableRecord(item, existingRecordMap),
      )
      .map((item) => ({
        txId: item.txId,
        record_id: existingRecordMap.get(item.transactionId)!.recordId,
        fieldsHash: item.fieldsHash,
      }));

    this.logger.debug(
      `本批次准备新增=${toCreate.length}条，更新=${toUpdate.length}条`,
    );

    if (
      toCreate.length === 0 &&
      toUpdate.length === 0 &&
      matchedWithoutChanges.length === 0
    ) {
      this.logger.warn(
        '可同步列表为空（全部流水号映射失败或被过滤），跳过当前批次',
      );
      return;
    }

    const createResponse =
      toCreate.length > 0
        ? await this.createBitableRecords({
            records: toCreate.map((item) => ({ fields: item.fields })),
          })
        : { code: 0, data: { records: [] } };
    const updateResponse =
      toUpdate.length > 0
        ? await this.updateBitableRecords({
            records: toUpdate.map((item) => ({
              record_id: item.record_id,
              fields: item.fields,
            })),
          })
        : { code: 0, data: { records: [] } };

    const createExpected = toCreate.length;
    const createActual = createResponse.data?.records?.length ?? 0;
    const updateExpected = toUpdate.length;
    const updateActual = updateResponse.data?.records?.length ?? 0;

    if (createResponse.code !== 0) {
      throw new Error(
        `bitable batchCreate 失败: code=${createResponse.code} msg=${createResponse.msg ?? ''}`,
      );
    }
    if (updateResponse.code !== 0) {
      throw new Error(
        `bitable batchUpdate 失败: code=${updateResponse.code} msg=${updateResponse.msg ?? ''}`,
      );
    }

    if (createActual !== createExpected || updateActual !== updateExpected) {
      this.logger.warn(
        `飞书返回记录数不一致：batchCreate预期=${createExpected}，实际=${createActual}；batchUpdate预期=${updateExpected}，实际=${updateActual}`,
      );
      return;
    }

    const successIds = [
      ...toCreate.map((item) => item.txId),
      ...toUpdate.map((item) => item.txId),
      ...matchedWithoutChanges.map((item) => item.txId),
    ];
    const syncedAt = new Date();
    if (successIds.length > 0) {
      await this.markTransactionsSynced({
        toCreate,
        toUpdate,
        matchedWithoutChanges,
        createResponse,
        existingRecordMap,
        syncedAt,
      });
    }

    this.logger.log(
      `已同步 ${createActual + updateActual} 条交易到飞书多维表格（新增${createActual}，更新${updateActual}，已存在${matchedWithoutChanges.length}）`,
    );
  }

  private async fetchSyncCandidates(): Promise<BitableCheckedCandidates> {
    const pending = await this.transactionModel
      .find({
        $or: [
          { syncedToBitableAt: { $exists: false } },
          { syncedToBitableAt: null },
          { bitableRecordId: { $exists: false } },
          { bitableRecordId: null },
          { bitableFieldsHash: { $exists: false } },
          { bitableFieldsHash: null },
        ],
      })
      // 高频同步优先处理本地待同步/缺少同步状态的数据，避免历史数据被反复全量更新。
      .sort({ transDatetime: 1 })
      .limit(this.batchSize)
      .exec();

    if (pending.length > 0) {
      return { transactions: pending };
    }

    return this.fetchBitableCheckedCandidates();
  }

  private async fetchBitableCheckedCandidates(): Promise<BitableCheckedCandidates> {
    const transactions = await this.transactionModel
      .find({
        bitableRecordId: { $exists: true, $ne: null },
        bitableFieldsHash: { $exists: true, $ne: null },
      })
      // 没有本地新增数据时，只小批量校验最久未检查的飞书记录，避免全量扫表。
      .sort({ bitableCheckedAt: 1, transDatetime: 1 })
      .limit(Math.min(this.batchSize, this.bitableCheckBatchSize))
      .exec();

    if (transactions.length === 0) {
      return { transactions: [] };
    }

    const existingRecordMap =
      await this.fetchBitableRecordsByRecordIds(transactions);
    const existingRecordIds = new Set(
      Array.from(existingRecordMap.values()).map((item) => item.recordId),
    );
    const now = new Date();
    const existingTransactions = transactions.filter(
      (tx) => tx.bitableRecordId && existingRecordIds.has(tx.bitableRecordId),
    );

    if (existingTransactions.length > 0) {
      await this.transactionModel.updateMany(
        { _id: { $in: existingTransactions.map((tx) => tx._id) } },
        { $set: { bitableCheckedAt: now } },
      );
    }

    const missingTransactions = transactions.filter(
      (tx) => !tx.bitableRecordId || !existingRecordIds.has(tx.bitableRecordId),
    );
    if (missingTransactions.length > 0) {
      await this.transactionModel.updateMany(
        { _id: { $in: missingTransactions.map((tx) => tx._id) } },
        {
          $unset: {
            bitableRecordId: '',
            bitableFieldsHash: '',
            syncedToBitableAt: '',
          },
          $set: { bitableCheckedAt: now },
        },
      );
      this.logger.warn(
        `发现飞书记录被删除，准备重新创建 ${missingTransactions.length} 条`,
      );
    }

    const changedTransactions = existingTransactions.filter((tx) => {
      const transactionId = tx.transSequenceIdn?.trim();
      const existing = transactionId
        ? existingRecordMap.get(transactionId)
        : undefined;
      return (
        existing &&
        tx.bitableFieldsHash &&
        this.hashBitableFields(existing.fields) !== tx.bitableFieldsHash
      );
    });

    return {
      transactions: [...missingTransactions, ...changedTransactions],
      existingRecordMap,
    };
  }

  private async logNoUnsyncedTransactionsWithAccountSummary() {
    const accounts = await this.accountModel
      .find()
      // 只读取日志需要的安全字段，避免误把密钥类字段打进日志。
      .select('name cards')
      .sort({ enabled: -1, UID: 1 })
      .exec();

    const accountSummary = accounts.map((account) =>
      this.formatBankAccountForLog(account),
    );

    this.logger.log(
      `未发现可同步交易；bank_accounts=${JSON.stringify(accountSummary)}`,
    );
  }

  private formatBankAccountForLog(account: BankAccountDocument) {
    const cards = Array.isArray(account.cards) ? account.cards : [];

    return {
      name: account.name ?? '',
      // 银行卡号属于敏感信息，日志里只保留首尾便于排查绑定关系。
      cards: cards.map((card) => ({
        name: card.name,
        cardNbr: this.maskCardNumber(card.cardNbr),
      })),
    };
  }

  private maskCardNumber(cardNbr: string) {
    const normalized = cardNbr.trim();
    if (normalized.length <= 10) {
      return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
    }

    return `${normalized.slice(0, 6)}****${normalized.slice(-4)}`;
  }

  private async loadAccountCardInfoMap(
    transactions: BankTransactionDocument[],
  ): Promise<Map<string, BankAccountCardInfo>> {
    const uids = [
      ...new Set(
        transactions
          .map((tx) => tx.UID)
          .filter(
            (uid): uid is string => typeof uid === 'string' && uid.length > 0,
          ),
      ),
    ];

    if (uids.length === 0) {
      return new Map();
    }

    const accounts = await this.accountModel
      .find({ UID: { $in: uids } })
      .select('UID cards')
      .exec();

    const accountCardMap = new Map<string, BankAccountCardInfo>();
    for (const account of accounts) {
      for (const card of account.cards ?? []) {
        if (account.UID && card.cardNbr) {
          accountCardMap.set(this.toAccountCardKey(account.UID, card.cardNbr), {
            name: card.name,
            cardNbr: card.cardNbr,
          });
        }
      }
    }

    const missingCardKeys = transactions
      .map((tx) => this.toAccountCardKey(tx.UID, tx.cardNbr))
      .filter((key) => !accountCardMap.has(key));
    this.logger.debug(
      `accountCardMap 命中=${accountCardMap.size}，` +
        `已命中=${JSON.stringify(Array.from(accountCardMap.keys()))}` +
        `，未命中=${JSON.stringify(missingCardKeys)}`,
    );

    return accountCardMap;
  }

  private toAccountCardKey(uid: string, cardNbr: string) {
    return `${uid.trim()}::${cardNbr.trim()}`;
  }

  private getBitableWritableFieldNames() {
    return [
      BitableSyncService.FIELD_DATE,
      BitableSyncService.FIELD_SUMMARY,
      BitableSyncService.FIELD_AMOUNT_IN,
      BitableSyncService.FIELD_AMOUNT_OUT,
      BitableSyncService.FIELD_CURRENCY,
      BitableSyncService.FIELD_COUNTERPARTY,
      BitableSyncService.FIELD_ACCOUNT,
      BitableSyncService.FIELD_CARD_NBR,
      BitableSyncService.FIELD_BALANCE,
      BitableSyncService.FIELD_MONTH,
      BitableSyncService.FIELD_PERIOD,
      BitableSyncService.FIELD_TRANSACTION_ID,
    ];
  }

  private hashBitableFields(fields: Record<string, unknown>) {
    const normalized = this.normalizeBitableFieldsForHash(fields);

    return createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  private normalizeBitableFieldsForHash(fields: Record<string, unknown>) {
    return this.getBitableWritableFieldNames().reduce<Record<string, unknown>>(
      (result, fieldName) => {
        const value = fields[fieldName];
        if (value !== undefined && value !== null && value !== '') {
          result[fieldName] = value;
        }
        return result;
      },
      {},
    );
  }

  private chunkArray<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private formatErrorForLog(error: unknown) {
    if (error instanceof AxiosError) {
      return JSON.stringify({
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
    }

    if (error instanceof Error) {
      const maybeResponse = (
        error as Error & {
          response?: { status?: number; data?: unknown };
          code?: unknown;
        }
      ).response;
      return JSON.stringify({
        message: error.message,
        code: (error as Error & { code?: unknown }).code,
        status: maybeResponse?.status,
        data: maybeResponse?.data,
      });
    }

    return this.stringifyForLog(error);
  }

  private stringifyForLog(value: unknown) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private createBitableRecords(payload: BitableRecordPayload) {
    return this.larkClient.bitable.appTableRecord.batchCreate({
      path: {
        app_token: this.appToken!,
        table_id: this.tableId!,
      },
      data: {
        records: payload.records,
      },
    });
  }

  private updateBitableRecords(payload: BitableUpdateRecordPayload) {
    return this.larkClient.bitable.appTableRecord.batchUpdate({
      path: {
        app_token: this.appToken!,
        table_id: this.tableId!,
      },
      data: {
        records: payload.records,
      },
    });
  }

  private shouldUpdateBitableRecord(
    syncRecord: BitableSyncRecord,
    existingRecordMap: Map<string, BitableExistingRecord>,
  ) {
    const existing = existingRecordMap.get(syncRecord.transactionId);
    if (!existing) {
      return false;
    }

    // 飞书端字段和本地字段摘要不一致时才更新，避免高频同步反复覆盖无变化数据。
    return this.hashBitableFields(existing.fields) !== syncRecord.fieldsHash;
  }

  private async markTransactionsSynced(params: {
    toCreate: BitableSyncRecord[];
    toUpdate: BitableSyncUpdateRecord[];
    matchedWithoutChanges: BitableSyncMatchedRecord[];
    createResponse: { data?: { records?: Array<{ record_id?: string }> } };
    existingRecordMap: Map<string, BitableExistingRecord>;
    syncedAt: Date;
  }) {
    const createRecords = params.createResponse.data?.records ?? [];
    const operations = [
      ...params.toCreate.map((item, index) => ({
        updateOne: {
          filter: { _id: item.txId },
          update: {
            $set: {
              syncedToBitableAt: params.syncedAt,
              bitableCheckedAt: params.syncedAt,
              bitableFieldsHash: item.fieldsHash,
              bitableRecordId: createRecords[index]?.record_id,
            },
          },
        },
      })),
      ...params.toUpdate.map((item) => ({
        updateOne: {
          filter: { _id: item.txId },
          update: {
            $set: {
              syncedToBitableAt: params.syncedAt,
              bitableCheckedAt: params.syncedAt,
              bitableFieldsHash: this.hashBitableFields(item.fields),
              bitableRecordId: item.record_id,
            },
          },
        },
      })),
      ...params.matchedWithoutChanges.map((item) => ({
        updateOne: {
          filter: { _id: item.txId },
          update: {
            $set: {
              syncedToBitableAt: params.syncedAt,
              bitableCheckedAt: params.syncedAt,
              bitableFieldsHash: item.fieldsHash,
              bitableRecordId: item.record_id,
            },
          },
        },
      })),
    ].filter(
      (operation) =>
        operation.updateOne.update.$set.bitableRecordId !== undefined,
    );

    if (operations.length > 0) {
      await this.transactionModel.bulkWrite(operations, { ordered: false });
    }
  }

  private async fetchBitableRecordsByTransactionIds(
    transactionIds: string[],
  ): Promise<Map<string, BitableExistingRecord>> {
    const uniqueTransactionIds = [
      ...new Set(transactionIds.map((txId) => txId.trim()).filter(Boolean)),
    ];
    if (uniqueTransactionIds.length === 0) {
      return new Map();
    }
    const recordMap = new Map<string, BitableExistingRecord>();

    for (const chunk of this.chunkArray(
      uniqueTransactionIds,
      this.bitableSearchChunkSize,
    )) {
      let pageToken: string | undefined;
      do {
        const searchResp = await this.larkClient.bitable.appTableRecord.search({
          path: {
            app_token: this.appToken!,
            table_id: this.tableId!,
          },
          data: {
            field_names: this.getBitableWritableFieldNames(),
            filter: {
              conjunction: 'or',
              conditions: chunk.map((transactionId) => ({
                field_name: BitableSyncService.FIELD_TRANSACTION_ID,
                operator: 'is',
                value: [transactionId],
              })),
            },
          },
          params: {
            page_size: 500,
            page_token: pageToken,
          },
        });
        if (searchResp.code !== 0) {
          throw new Error(
            `bitable search 失败: code=${searchResp.code} msg=${searchResp.msg ?? ''}`,
          );
        }

        const items = searchResp.data?.items ?? [];
        for (const item of items) {
          const rawValue =
            item.fields?.[BitableSyncService.FIELD_TRANSACTION_ID];
          const txId = this.extractTextFieldValue(rawValue);
          if (!txId) {
            continue;
          }
          const normalizedTxId = txId.trim();
          if (item.record_id) {
            if (recordMap.has(normalizedTxId)) {
              this.logger.warn(
                `飞书表存在重复流水号=${normalizedTxId}，后续将使用最新查到的 record_id=${item.record_id}`,
              );
            }
            recordMap.set(normalizedTxId, {
              recordId: item.record_id,
              fields: item.fields ?? {},
            });
          }
        }

        pageToken = searchResp.data?.page_token;
      } while (pageToken);
    }

    return recordMap;
  }

  private async fetchBitableRecordsByRecordIds(
    transactions: BankTransactionDocument[],
  ): Promise<Map<string, BitableExistingRecord>> {
    const recordIds = [
      ...new Set(
        transactions
          .map((tx) => tx.bitableRecordId?.trim())
          .filter((recordId): recordId is string => Boolean(recordId)),
      ),
    ];
    const recordMap = new Map<string, BitableExistingRecord>();

    for (const chunk of this.chunkArray(recordIds, 100)) {
      const batchGetResp =
        await this.larkClient.bitable.appTableRecord.batchGet({
          path: {
            app_token: this.appToken!,
            table_id: this.tableId!,
          },
          data: {
            record_ids: chunk,
            automatic_fields: false,
          },
        });

      if (batchGetResp.code !== 0) {
        throw new Error(
          `bitable batchGet 失败: code=${batchGetResp.code} msg=${batchGetResp.msg ?? ''}`,
        );
      }

      for (const item of batchGetResp.data?.records ?? []) {
        const rawValue = item.fields?.[BitableSyncService.FIELD_TRANSACTION_ID];
        const txId = this.extractTextFieldValue(rawValue);
        if (txId && item.record_id) {
          recordMap.set(txId.trim(), {
            recordId: item.record_id,
            fields: item.fields ?? {},
          });
        }
      }

      const absentRecordIds = batchGetResp.data?.absent_record_ids ?? [];
      if (absentRecordIds.length > 0) {
        this.logger.warn(
          `飞书 batchGet 发现缺失记录 recordIds=${JSON.stringify(absentRecordIds)}`,
        );
      }
    }

    return recordMap;
  }

  // 在新增记录前先做一次轻量权限探测（Base 读 + 表记录读），定位是否为权限问题。
  private async verifyBitablePermission() {
    const now = Date.now();
    if (
      this.permissionCheckPassed &&
      now - this.lastPermissionCheckAt < this.permissionCheckTtlMs
    ) {
      return;
    }

    const appResp = await this.larkClient.bitable.app.get({
      path: { app_token: this.appToken! },
    });
    if (appResp.code !== 0) {
      this.permissionCheckPassed = false;
      throw new Error(
        `飞书 Base 权限探测失败（bitable.app.get）：code=${appResp.code} msg=${appResp.msg ?? ''}`,
      );
    }

    const listResp = await this.larkClient.bitable.appTableRecord.list({
      path: {
        app_token: this.appToken!,
        table_id: this.tableId!,
      },
      params: {
        page_size: 1,
      },
    });
    if (listResp.code !== 0) {
      this.permissionCheckPassed = false;
      throw new Error(
        `飞书表级权限探测失败（appTableRecord.list）：code=${listResp.code} msg=${listResp.msg ?? ''}`,
      );
    }

    this.permissionCheckPassed = true;
    this.lastPermissionCheckAt = now;
    this.logger.debug(
      `飞书多维表格权限探测通过（appToken=${this.appToken}, tableId=${this.tableId}）`,
    );
  }

  private toBitableRecord(
    tx: BankTransactionDocument,
    accountCardMap: Map<string, BankAccountCardInfo>,
  ): BitableRecordPayload['records'][number] | undefined {
    const raw = tx.raw ?? {};
    const fields: Record<string, string | number | boolean> = {};

    const transactionId = tx.transSequenceIdn?.trim();
    if (!transactionId) {
      this.logger.warn(`交易 ${tx._id} 缺失交易流水号，跳过同步`);
      return undefined;
    }

    // 日期是明细核算日；在列表里也用它派生月份和周次。
    const dateText = this.formatDate(tx.transDatetime);
    if (dateText) {
      // 飞书当前表结构使用时间戳写入更稳定。
      fields[BitableSyncService.FIELD_DATE] = dateText;
      const monthIndex = tx.transDatetime.getUTCMonth();
      fields[BitableSyncService.FIELD_MONTH] =
        BitableSyncService.MONTH_NAMES[monthIndex];
      fields[BitableSyncService.FIELD_PERIOD] = this.toPeriodByDate(
        tx.transDatetime,
      );
    } else {
      this.logger.warn(
        `交易 ${tx._id} 的 transDatetime 非法，已跳过日期/月份/周期映射：${String(
          tx.transDatetime,
        )}`,
      );
    }

    const summary = this.firstNonEmptyText(
      this.toText(raw.remarkTextClt),
      this.toText(raw.businessText),
      this.toText(raw.extendedRemark),
    );
    if (summary) {
      fields[BitableSyncService.FIELD_SUMMARY] = summary;
    }
    fields[BitableSyncService.FIELD_TRANSACTION_ID] = transactionId;

    // 按 UID + 银行卡号精确匹配 cards[index]，确保飞书账户字段使用卡片名称。
    const accountCard = accountCardMap.get(
      this.toAccountCardKey(tx.UID, tx.cardNbr),
    );
    if (accountCard?.name.trim()) {
      fields[BitableSyncService.FIELD_ACCOUNT] = this.normalizeSelectValue(
        accountCard.name,
      );
    }
    if (accountCard?.cardNbr.trim()) {
      fields[BitableSyncService.FIELD_CARD_NBR] = accountCard.cardNbr.trim();
    }

    const counterparty = this.toText(raw.ctpAcctName);
    if (counterparty) {
      fields[BitableSyncService.FIELD_COUNTERPARTY] = counterparty;
    }

    const currency = this.normalizeCurrency(this.toText(raw.currencyNbr));
    if (currency) {
      fields[BitableSyncService.FIELD_CURRENCY] = currency;
    }
    const rawAmount = this.toNumber(raw.transAmount);
    if (rawAmount !== undefined) {
      const sign = this.toText(raw.loanCode)?.toUpperCase();
      if (sign === 'C') {
        fields[BitableSyncService.FIELD_AMOUNT_IN] = Math.abs(rawAmount);
        fields[BitableSyncService.FIELD_AMOUNT_OUT] = 0;
      } else if (sign === 'D') {
        fields[BitableSyncService.FIELD_AMOUNT_OUT] = Math.abs(rawAmount);
        fields[BitableSyncService.FIELD_AMOUNT_IN] = 0;
      } else if (rawAmount >= 0) {
        fields[BitableSyncService.FIELD_AMOUNT_IN] = rawAmount;
        fields[BitableSyncService.FIELD_AMOUNT_OUT] = 0;
      } else {
        fields[BitableSyncService.FIELD_AMOUNT_OUT] = Math.abs(rawAmount);
        fields[BitableSyncService.FIELD_AMOUNT_IN] = 0;
      }
    }

    const balance = this.toNumber(raw.acctOnlineBal);
    if (balance !== undefined) {
      fields[BitableSyncService.FIELD_BALANCE] = balance;
    }

    return { fields };
  }

  private toPeriodByDate(date: Date) {
    const day = date.getUTCDate();
    if (day <= 7) {
      return '第一周';
    }
    if (day <= 14) {
      return '第二周';
    }
    if (day <= 21) {
      return '第三周';
    }
    if (day <= 28) {
      return '第四周';
    }
    return '第五周';
  }

  private formatDate(date: Date): number | undefined {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return undefined;
    }

    // 飞书时间字段按13位毫秒时间戳写入。
    return date.getTime();
  }

  private firstNonEmptyText(...values: Array<string | undefined>) {
    return values.find((value) => value?.trim());
  }

  private normalizeSelectValue(value: string) {
    // 去除首尾空白并按数据库写入限制截断，避免字段长度超限导致写入失败。
    return value.slice(0, this.accountNameLimit).trim();
  }

  private normalizeCurrency(value: string | undefined) {
    if (!value) {
      return undefined;
    }

    // 当前 Base 的币种字段只有“人民币”一个选项，先映射成可写值。
    const normalized = value.toString().trim().toUpperCase();
    const map: Record<string, string> = {
      '10': '人民币',
      人民币: '人民币',
      CNY: '人民币',
      '156': '人民币',
    };
    return map[normalized];
  }

  private toText(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    return String(value);
  }

  private toNumber(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }

    const text = String(value).trim();
    if (text.length === 0) {
      return undefined;
    }

    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  private extractTextFieldValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') {
            return item.trim();
          }
          if (
            item &&
            typeof item === 'object' &&
            'text' in item &&
            typeof item.text === 'string'
          ) {
            return item.text.trim();
          }
          if (
            item &&
            typeof item === 'object' &&
            'name' in item &&
            typeof item.name === 'string'
          ) {
            return item.name.trim();
          }
          return '';
        })
        .find((item) => item.length > 0);
    }

    if (value && typeof value === 'object' && 'name' in value) {
      const maybeName = (value as { name?: unknown }).name;
      if (typeof maybeName === 'string') {
        return maybeName.trim();
      }
    }
    if (value && typeof value === 'object' && 'text' in value) {
      const maybeText = (value as { text?: unknown }).text;
      if (typeof maybeText === 'string') {
        return maybeText.trim();
      }
    }
    return undefined;
  }
}
