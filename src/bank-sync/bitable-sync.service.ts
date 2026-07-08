import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AxiosError } from 'axios';
import * as lark from '@larksuiteoapi/node-sdk';
import { AppConfig } from '../config/app-config.type';
import { PrismaService } from '../prisma/prisma.service';
import { BankTransactionDocument } from './types/bank-records.type';
import {
  BITABLE_FIELD_TYPES,
  BITABLE_FIELDS,
  BITABLE_MONTH_NAMES,
  BITABLE_TARGET_VIEW_NAME,
  BITABLE_WRITABLE_FIELD_NAMES,
  buildBitableBaseTableFieldDefinitions,
  buildBitableNetValueFormula,
  buildBitableRunningBalanceFormula,
} from './bitable-schema';

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
  tableId: string;
  tableName: string;
  viewId: string;
  fields: Record<string, string | number | boolean>;
  fieldsHash: string;
  transactionId: string;
}

interface BitableSyncUpdateRecord {
  txId: string;
  tableId: string;
  record_id: string;
  fields: Record<string, string | number | boolean>;
}

interface BitableSyncMatchedRecord {
  txId: string;
  tableId: string;
  record_id: string;
  fieldsHash: string;
}

interface BankAccountCardInfo {
  name: string;
  cardNbr: string;
}

interface BitableExistingRecord {
  recordId: string;
  tableId: string;
  fields: Record<string, unknown>;
}

interface BitableTargetTable {
  tableId: string;
  tableName: string;
  viewId: string;
}

interface BitableSyncPlan {
  toCreate: BitableSyncRecord[];
  toUpdate: BitableSyncUpdateRecord[];
  matchedWithoutChanges: BitableSyncMatchedRecord[];
}

@Injectable()
export class BitableSyncService implements OnModuleInit {
  private readonly logger = new Logger(BitableSyncService.name);
  private readonly larkClient: lark.Client;
  private running = false;
  private targetTableRefreshRunning = false;

  private readonly appToken?: string;
  private readonly isEnabled: boolean;
  private readonly hasCredentials: boolean;
  private readonly batchSize: number;
  private readonly accountNameLimit: number;
  private readonly bitableSearchChunkSize = 20;
  private readonly bitableCheckBatchSize = 50;
  private readonly permissionCheckTtlMs = 5 * 60 * 1000;
  private bitableTargetTableMap = new Map<string, BitableTargetTable>();
  private lastPermissionCheckAt = 0;
  private permissionCheckPassed = false;

  constructor(
    private readonly prisma: PrismaService,
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
  @Cron('0 * * * * *')
  async syncPendingTransactions() {
    const unavailableReason = this.getBitableUnavailableReason();
    if (unavailableReason) {
      this.logBitableUnavailable(unavailableReason, '未同步到多维表格');
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

  // 定时刷新飞书表结构缓存：即使暂时没有待同步交易，也能感知表新增、删除和同名重建。
  @Cron('0 */5 * * * *')
  async refreshTargetTableMap() {
    const unavailableReason = this.getBitableUnavailableReason();
    if (unavailableReason) {
      this.logBitableUnavailable(unavailableReason, '未刷新目标表结构');
      return;
    }

    if (this.running) {
      return;
    }

    if (this.targetTableRefreshRunning) {
      return;
    }

    this.targetTableRefreshRunning = true;
    try {
      await this.refreshBitableTargetTableMap();
    } catch (error) {
      this.logger.error(
        `飞书目标表结构刷新失败：${this.formatErrorForLog(error)}`,
      );
    } finally {
      this.targetTableRefreshRunning = false;
    }
  }

  // 应用启动时先做一次飞书权限自检，避免服务上线后再在同步时才暴露 403。
  async onModuleInit() {
    const unavailableReason = this.getBitableUnavailableReason();
    if (unavailableReason) {
      this.logBitableUnavailable(unavailableReason, '无法执行启动自检');
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
    const unavailableReason = this.getBitableUnavailableReason();
    if (unavailableReason) {
      throw new Error(unavailableReason);
    }

    await this.syncBatch();
  }

  private async syncBatch() {
    const transactions = await this.fetchSyncCandidates();
    if (transactions.length === 0) {
      return;
    }
    // 写入前先校验 Base 与表权限，避免 403 在批量写入时才暴露。
    await this.verifyBitablePermission();

    const syncRecords = await this.prepareSyncRecords(transactions);
    if (syncRecords.length === 0) {
      this.logger.warn(
        '存在待同步交易但未生成可同步记录，可能原因：目标飞书表对当前应用不可见、缺少 cards[index] 映射或可写字段不足',
      );
      return;
    }

    const existingRecordMap =
      await this.fetchBitableRecordsByTransactionIds(syncRecords);
    const syncPlan = this.buildSyncPlan(syncRecords, existingRecordMap);

    if (
      syncPlan.toCreate.length === 0 &&
      syncPlan.toUpdate.length === 0 &&
      syncPlan.matchedWithoutChanges.length === 0
    ) {
      this.logger.warn(
        '可同步列表为空（全部流水号映射失败或被过滤），跳过当前批次',
      );
      return;
    }

    const createdRecordIdMap = await this.createBitableRecordsByTable(
      syncPlan.toCreate,
    );
    const updatedCount = await this.updateBitableRecordsByTable(
      syncPlan.toUpdate,
    );

    const createExpected = syncPlan.toCreate.length;
    const createActual = createdRecordIdMap.size;
    const updateExpected = syncPlan.toUpdate.length;
    const updateActual = updatedCount;

    if (createActual !== createExpected || updateActual !== updateExpected) {
      this.logger.warn(
        `飞书返回记录数不一致：batchCreate预期=${createExpected}，实际=${createActual}；batchUpdate预期=${updateExpected}，实际=${updateActual}`,
      );
      return;
    }

    const successIds = [
      ...syncPlan.toCreate.map((item) => item.txId),
      ...syncPlan.toUpdate.map((item) => item.txId),
      ...syncPlan.matchedWithoutChanges.map((item) => item.txId),
    ];
    const syncedAt = new Date();
    if (successIds.length > 0) {
      await this.markTransactionsSynced({
        ...syncPlan,
        createdRecordIdMap,
        existingRecordMap,
        syncedAt,
      });
    }

    this.logger.log(
      `已同步 ${createActual + updateActual} 条交易到飞书多维表格（新增${createActual}，更新${updateActual}，已存在${syncPlan.matchedWithoutChanges.length}）`,
    );
  }

  private async fetchSyncCandidates(): Promise<BankTransactionDocument[]> {
    const pending = await this.prisma.bankTransaction.findMany({
      where: {
        OR: [
          { syncedToBitableAt: null },
          { bitableRecordId: null },
          { bitableFieldsHash: null },
        ],
      },
      // 高频同步优先处理本地待同步/缺少同步状态的数据，避免历史数据被反复全量更新。
      orderBy: { transDatetime: 'asc' },
      take: this.batchSize,
    });

    if (pending.length > 0) {
      return pending;
    }

    return this.fetchBitableCheckedCandidates();
  }

  private async fetchBitableCheckedCandidates(): Promise<
    BankTransactionDocument[]
  > {
    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        bitableRecordId: { not: null },
        bitableFieldsHash: { not: null },
      },
      // 没有本地新增数据时，只小批量校验最久未检查的飞书记录，避免全量扫表。
      orderBy: [
        { bitableCheckedAt: { sort: 'asc', nulls: 'first' } },
        { transDatetime: 'asc' },
      ],
      take: Math.min(this.batchSize, this.bitableCheckBatchSize),
    });

    if (transactions.length === 0) {
      return [];
    }

    return transactions;
  }

  private getBitableUnavailableReason() {
    if (!this.isEnabled) {
      return '飞书多维表格同步未开启';
    }
    if (!this.appToken) {
      return '缺少飞书 baseToken';
    }
    if (!this.hasCredentials) {
      return '缺少飞书 appId/appSecret';
    }
    return undefined;
  }

  private logBitableUnavailable(reason: string, action: string) {
    const message = `${reason}，${action}`;
    if (reason === '飞书多维表格同步未开启') {
      return;
    }
    this.logger.warn(message);
  }

  private async prepareSyncRecords(
    transactions: BankTransactionDocument[],
  ): Promise<BitableSyncRecord[]> {
    const accountCardMap = await this.loadAccountCardInfoMap(transactions);
    const targetTableMap = await this.refreshBitableTargetTableMap();
    await this.ensureTargetTablesForTransactions(
      transactions,
      accountCardMap,
      targetTableMap,
    );

    return transactions
      .map((tx) => this.toSyncRecord(tx, accountCardMap, targetTableMap))
      .filter((item): item is BitableSyncRecord => item !== undefined);
  }

  private toSyncRecord(
    tx: BankTransactionDocument,
    accountCardMap: Map<string, BankAccountCardInfo>,
    targetTableMap: Map<string, BitableTargetTable>,
  ): BitableSyncRecord | undefined {
    const transactionId = tx.transSequenceIdn?.trim();
    if (!transactionId) {
      return undefined;
    }

    const targetTable = this.resolveTargetTable(
      tx,
      accountCardMap,
      targetTableMap,
    );
    if (!targetTable) {
      return undefined;
    }

    const record = this.toBitableRecord(tx, accountCardMap);
    if (!record) {
      return undefined;
    }

    return {
      txId: tx.id,
      tableId: targetTable.tableId,
      tableName: targetTable.tableName,
      viewId: targetTable.viewId,
      transactionId,
      fields: record.fields,
      fieldsHash: this.hashBitableFields(record.fields),
    };
  }

  private buildSyncPlan(
    syncRecords: BitableSyncRecord[],
    existingRecordMap: Map<string, BitableExistingRecord>,
  ): BitableSyncPlan {
    const plan: BitableSyncPlan = {
      toCreate: [],
      toUpdate: [],
      matchedWithoutChanges: [],
    };

    for (const syncRecord of syncRecords) {
      const existing = existingRecordMap.get(
        this.toBitableRecordMapKey(syncRecord),
      );
      if (!existing) {
        plan.toCreate.push(syncRecord);
        continue;
      }

      if (this.hashBitableFields(existing.fields) !== syncRecord.fieldsHash) {
        plan.toUpdate.push({
          tableId: syncRecord.tableId,
          record_id: existing.recordId,
          fields: syncRecord.fields,
          txId: syncRecord.txId,
        });
        continue;
      }

      plan.matchedWithoutChanges.push({
        txId: syncRecord.txId,
        tableId: syncRecord.tableId,
        record_id: existing.recordId,
        fieldsHash: syncRecord.fieldsHash,
      });
    }

    return plan;
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

    const accounts = await this.prisma.bankAccount.findMany({
      where: { UID: { in: uids } },
      include: { cards: true },
    });

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

    return accountCardMap;
  }

  private toAccountCardKey(uid: string, cardNbr: string) {
    return `${uid.trim()}::${cardNbr.trim()}`;
  }

  private getBitableWritableFieldNames() {
    return BITABLE_WRITABLE_FIELD_NAMES;
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

  private groupBy<T>(
    items: T[],
    getKey: (item: T) => string,
  ): Map<string, T[]> {
    return items.reduce<Map<string, T[]>>((result, item) => {
      const key = getKey(item);
      const group = result.get(key) ?? [];
      group.push(item);
      result.set(key, group);
      return result;
    }, new Map());
  }

  private normalizeBitableName(name: string) {
    // 表名和 cards[index].name 按首尾空白归一化，避免配置复制时多空格导致匹配失败。
    return name.trim();
  }

  private toBitableRecordMapKey(value: {
    tableName: string;
    transactionId: string;
  }) {
    return `${this.normalizeBitableName(value.tableName)}::${value.transactionId.trim()}`;
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

  private asObjectRecord(value: unknown): Record<string, unknown> {
    // Prisma Json 字段可能是数组、字符串或 null；飞书字段映射只接受对象明细。
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private isBitableRolePermissionError(error: unknown) {
    const responseData = this.getErrorResponseData(error);
    return (
      responseData?.code === 1254302 || responseData?.msg === 'RolePermNotAllow'
    );
  }

  private getErrorResponseData(error: unknown): {
    code?: number;
    msg?: string;
  } {
    if (error instanceof AxiosError) {
      return (error.response?.data ?? {}) as { code?: number; msg?: string };
    }
    if (error instanceof Error) {
      const maybeResponse = (error as Error & { response?: { data?: unknown } })
        .response;
      return maybeResponse?.data ?? {};
    }
    return {};
  }

  private createBitableRecords(tableId: string, payload: BitableRecordPayload) {
    return this.larkClient.bitable.appTableRecord.batchCreate({
      path: {
        app_token: this.appToken!,
        table_id: tableId,
      },
      data: {
        records: payload.records,
      },
    });
  }

  private updateBitableRecords(
    tableId: string,
    payload: BitableUpdateRecordPayload,
  ) {
    return this.larkClient.bitable.appTableRecord.batchUpdate({
      path: {
        app_token: this.appToken!,
        table_id: tableId,
      },
      data: {
        records: payload.records,
      },
    });
  }

  private async createBitableRecordsByTable(records: BitableSyncRecord[]) {
    const createdRecordIdMap = new Map<string, string>();
    for (const [tableId, tableRecords] of this.groupBy(
      records,
      (item) => item.tableId,
    )) {
      const createResponse = await this.createBitableRecords(tableId, {
        records: tableRecords.map((item) => ({ fields: item.fields })),
      });
      if (createResponse.code !== 0) {
        throw new Error(
          `bitable batchCreate 失败: tableId=${tableId} code=${createResponse.code} msg=${createResponse.msg ?? ''}`,
        );
      }

      const responseRecords = createResponse.data?.records ?? [];
      responseRecords.forEach((record, index) => {
        if (record.record_id) {
          createdRecordIdMap.set(tableRecords[index].txId, record.record_id);
        }
      });
    }

    return createdRecordIdMap;
  }

  private async updateBitableRecordsByTable(
    records: BitableSyncUpdateRecord[],
  ) {
    let updatedCount = 0;
    for (const [tableId, tableRecords] of this.groupBy(
      records,
      (item) => item.tableId,
    )) {
      const updateResponse = await this.updateBitableRecords(tableId, {
        records: tableRecords.map((item) => ({
          record_id: item.record_id,
          fields: item.fields,
        })),
      });
      if (updateResponse.code !== 0) {
        throw new Error(
          `bitable batchUpdate 失败: tableId=${tableId} code=${updateResponse.code} msg=${updateResponse.msg ?? ''}`,
        );
      }
      updatedCount += updateResponse.data?.records?.length ?? 0;
    }

    return updatedCount;
  }

  private async markTransactionsSynced(params: {
    toCreate: BitableSyncRecord[];
    toUpdate: BitableSyncUpdateRecord[];
    matchedWithoutChanges: BitableSyncMatchedRecord[];
    createdRecordIdMap: Map<string, string>;
    existingRecordMap: Map<string, BitableExistingRecord>;
    syncedAt: Date;
  }) {
    const updates = [
      ...params.toCreate
        .map((item) => ({
          id: item.txId,
          bitableRecordId: params.createdRecordIdMap.get(item.txId),
          bitableFieldsHash: item.fieldsHash,
        }))
        .filter((item) => item.bitableRecordId !== undefined),
      ...params.toUpdate.map((item) => ({
        id: item.txId,
        bitableRecordId: item.record_id,
        bitableFieldsHash: this.hashBitableFields(item.fields),
      })),
      ...params.matchedWithoutChanges.map((item) => ({
        id: item.txId,
        bitableRecordId: item.record_id,
        bitableFieldsHash: item.fieldsHash,
      })),
    ];

    await this.prisma.$transaction(
      updates.map((item) =>
        this.prisma.bankTransaction.update({
          where: { id: item.id },
          data: {
            syncedToBitableAt: params.syncedAt,
            bitableCheckedAt: params.syncedAt,
            bitableFieldsHash: item.bitableFieldsHash,
            bitableRecordId: item.bitableRecordId,
          },
        }),
      ),
    );
  }

  private async fetchBitableRecordsByTransactionIds(
    syncRecords: BitableSyncRecord[],
  ): Promise<Map<string, BitableExistingRecord>> {
    if (syncRecords.length === 0) {
      return new Map();
    }
    const recordMap = new Map<string, BitableExistingRecord>();

    for (const [tableName, tableRecords] of this.groupBy(syncRecords, (item) =>
      this.normalizeBitableName(item.tableName),
    )) {
      const tableId = tableRecords[0].tableId;
      const uniqueTransactionIds = [
        ...new Set(
          tableRecords.map((item) => item.transactionId.trim()).filter(Boolean),
        ),
      ];
      const viewId = tableRecords[0].viewId;
      for (const chunk of this.chunkArray(
        uniqueTransactionIds,
        this.bitableSearchChunkSize,
      )) {
        let pageToken: string | undefined;
        do {
          const searchResp =
            await this.larkClient.bitable.appTableRecord.search({
              path: {
                app_token: this.appToken!,
                table_id: tableId,
              },
              data: {
                view_id: viewId,
                field_names: this.getBitableWritableFieldNames(),
                filter: {
                  conjunction: 'or',
                  conditions: chunk.map((transactionId) => ({
                    field_name: BITABLE_FIELDS.TRANSACTION_ID,
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
              `bitable search 失败: tableId=${tableId} code=${searchResp.code} msg=${searchResp.msg ?? ''}`,
            );
          }

          const items = searchResp.data?.items ?? [];
          for (const item of items) {
            const rawValue = item.fields?.[BITABLE_FIELDS.TRANSACTION_ID];
            const txId = this.extractTextFieldValue(rawValue);
            if (!txId) {
              continue;
            }
            const normalizedTxId = txId.trim();
            const mapKey = this.toBitableRecordMapKey({
              tableName,
              transactionId: normalizedTxId,
            });
            if (item.record_id) {
              if (recordMap.has(mapKey)) {
                this.logger.warn(
                  `飞书表存在重复流水号：tableName=${tableName} tableId=${tableId} 流水号=${normalizedTxId}，后续将使用最新查到的 record_id=${item.record_id}`,
                );
              }
              recordMap.set(mapKey, {
                tableId,
                recordId: item.record_id,
                fields: item.fields ?? {},
              });
            }
          }

          pageToken = searchResp.data?.page_token;
        } while (pageToken);
      }
    }

    return recordMap;
  }

  private async refreshBitableTargetTableMap() {
    const tableResp = await this.larkClient.bitable.appTable.list({
      path: { app_token: this.appToken! },
      params: { page_size: 100 },
    });
    if (tableResp.code !== 0) {
      throw new Error(
        `飞书数据表列表读取失败：code=${tableResp.code} msg=${tableResp.msg ?? ''}`,
      );
    }

    const targetMap = new Map<string, BitableTargetTable>();
    for (const table of tableResp.data?.items ?? []) {
      if (!table.table_id || !table.name) {
        continue;
      }

      const tableStructure = await this.loadTargetTableStructure(
        table.table_id,
        table.name,
      );
      if (!tableStructure) {
        continue;
      }

      const { viewId, missingFields } = tableStructure;
      if (!viewId) {
        continue;
      }

      if (missingFields.length > 0) {
        this.logger.warn(
          `飞书表 ${table.name}(${table.table_id}) 字段不完整，缺少=${missingFields.join(',')}，已跳过同步`,
        );
        continue;
      }

      targetMap.set(this.normalizeBitableName(table.name), {
        tableId: table.table_id,
        tableName: table.name,
        viewId,
      });
    }

    this.bitableTargetTableMap = targetMap;

    return this.bitableTargetTableMap;
  }

  private async loadTargetTableStructure(tableId: string, tableName: string) {
    try {
      const [viewId, missingFields] = await Promise.all([
        this.findTargetViewId(tableId),
        this.findMissingWritableFields(tableId),
      ]);
      return { viewId, missingFields };
    } catch (error) {
      this.logger.warn(
        `飞书表 ${tableName}(${tableId}) 结构读取失败，已跳过同步：${this.formatErrorForLog(error)}`,
      );
      return undefined;
    }
  }

  private async ensureTargetTablesForTransactions(
    transactions: BankTransactionDocument[],
    accountCardMap: Map<string, BankAccountCardInfo>,
    targetTableMap: Map<string, BitableTargetTable>,
  ) {
    const targetNames = [
      ...new Set(
        transactions
          .map((tx) =>
            accountCardMap
              .get(this.toAccountCardKey(tx.UID, tx.cardNbr))
              ?.name?.trim(),
          )
          .filter((name): name is string => Boolean(name)),
      ),
    ];

    for (const targetName of targetNames) {
      const normalizedName = this.normalizeBitableName(targetName);
      if (targetTableMap.has(normalizedName)) {
        continue;
      }

      const createdTable = await this.tryCreateBitableTargetTable(targetName);
      if (!createdTable) {
        continue;
      }
      targetTableMap.set(normalizedName, createdTable);
      this.bitableTargetTableMap.set(normalizedName, createdTable);
      this.logger.log(
        `已自动创建飞书同步目标表：${createdTable.tableName}(${createdTable.tableId})，默认视图=${BITABLE_TARGET_VIEW_NAME}`,
      );
    }
  }

  private async tryCreateBitableTargetTable(tableName: string) {
    try {
      return await this.createBitableTargetTable(tableName);
    } catch (error) {
      if (this.isBitableRolePermissionError(error)) {
        this.logger.warn(
          `当前应用未在可访问表中找到飞书目标表 ${tableName}，且无权自动建表；如果表已存在，请在飞书高级权限中授予该应用访问/写入权限：${this.formatErrorForLog(error)}`,
        );
        return undefined;
      }
      throw error;
    }
  }

  private async createBitableTargetTable(tableName: string) {
    const createResp = await this.larkClient.bitable.appTable.create({
      path: { app_token: this.appToken! },
      data: {
        table: {
          name: tableName,
          default_view_name: BITABLE_TARGET_VIEW_NAME,
          fields: buildBitableBaseTableFieldDefinitions(tableName),
        },
      },
    });

    if (createResp.code !== 0 || !createResp.data?.table_id) {
      throw new Error(
        `飞书同步目标表创建失败：tableName=${tableName} code=${createResp.code} msg=${createResp.msg ?? ''}`,
      );
    }

    const tableId = createResp.data.table_id;
    const viewId =
      createResp.data.default_view_id ?? (await this.findTargetViewId(tableId));
    if (!viewId) {
      throw new Error(
        `飞书同步目标表已创建但缺少默认视图：tableName=${tableName} tableId=${tableId}`,
      );
    }

    await this.createFormulaFieldsIfPossible(tableId, tableName);

    return {
      tableId,
      tableName,
      viewId,
    };
  }

  private async createFormulaFieldsIfPossible(
    tableId: string,
    tableName: string,
  ) {
    try {
      const fieldIdMap = await this.loadFieldIdMap(tableId);
      const netValueResp = await this.larkClient.bitable.appTableField.create({
        path: {
          app_token: this.appToken!,
          table_id: tableId,
        },
        data: {
          field_name: BITABLE_FIELDS.NET_VALUE,
          type: BITABLE_FIELD_TYPES.FORMULA,
          ui_type: 'Formula',
          property: {
            formula_expression: buildBitableNetValueFormula(
              tableId,
              fieldIdMap,
            ),
          },
        },
      });
      if (netValueResp.code !== 0) {
        throw new Error(
          `净值公式字段创建失败：code=${netValueResp.code} msg=${netValueResp.msg ?? ''}`,
        );
      }

      const balanceResp = await this.larkClient.bitable.appTableField.create({
        path: {
          app_token: this.appToken!,
          table_id: tableId,
        },
        data: {
          field_name: BITABLE_FIELDS.RUNNING_BALANCE,
          type: BITABLE_FIELD_TYPES.FORMULA,
          ui_type: 'Formula',
          property: {
            formula_expression: buildBitableRunningBalanceFormula(
              tableId,
              fieldIdMap,
            ),
          },
        },
      });
      if (balanceResp.code !== 0) {
        throw new Error(
          `余额公式字段创建失败：code=${balanceResp.code} msg=${balanceResp.msg ?? ''}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `飞书表 ${tableName}(${tableId}) 公式字段创建失败；可写字段已创建，同步不受影响：${this.formatErrorForLog(error)}`,
      );
    }
  }

  private async loadFieldIdMap(tableId: string) {
    const fieldResp = await this.larkClient.bitable.appTableField.list({
      path: {
        app_token: this.appToken!,
        table_id: tableId,
      },
      params: { page_size: 100 },
    });
    if (fieldResp.code !== 0) {
      throw new Error(
        `飞书字段列表读取失败：tableId=${tableId} code=${fieldResp.code} msg=${fieldResp.msg ?? ''}`,
      );
    }

    return new Map(
      (fieldResp.data?.items ?? [])
        .filter((field) => field.field_id)
        .map((field) => [field.field_name, field.field_id!]),
    );
  }

  private async findTargetViewId(tableId: string) {
    const viewResp = await this.larkClient.bitable.appTableView.list({
      path: {
        app_token: this.appToken!,
        table_id: tableId,
      },
      params: { page_size: 100 },
    });
    if (viewResp.code !== 0) {
      throw new Error(
        `飞书视图列表读取失败：tableId=${tableId} code=${viewResp.code} msg=${viewResp.msg ?? ''}`,
      );
    }

    return (viewResp.data?.items ?? []).find(
      (view) => view.view_name === BITABLE_TARGET_VIEW_NAME,
    )?.view_id;
  }

  private async findMissingWritableFields(tableId: string) {
    const fieldResp = await this.larkClient.bitable.appTableField.list({
      path: {
        app_token: this.appToken!,
        table_id: tableId,
      },
      params: { page_size: 100 },
    });
    if (fieldResp.code !== 0) {
      throw new Error(
        `飞书字段列表读取失败：tableId=${tableId} code=${fieldResp.code} msg=${fieldResp.msg ?? ''}`,
      );
    }

    const fieldNames = new Set(
      (fieldResp.data?.items ?? []).map((field) => field.field_name),
    );

    return this.getBitableWritableFieldNames().filter(
      (fieldName) => !fieldNames.has(fieldName),
    );
  }

  private resolveTargetTable(
    tx: BankTransactionDocument,
    accountCardMap: Map<string, BankAccountCardInfo>,
    targetTableMap: Map<string, BitableTargetTable>,
  ) {
    const accountCard = accountCardMap.get(
      this.toAccountCardKey(tx.UID, tx.cardNbr),
    );
    const targetName = accountCard?.name?.trim();
    if (!targetName) {
      this.logger.warn(
        `交易 ${tx.id} 未匹配到 cards[index].name，无法定位飞书目标表`,
      );
      return undefined;
    }

    const targetTable = targetTableMap.get(
      this.normalizeBitableName(targetName),
    );
    if (!targetTable) {
      this.logger.warn(
        `交易 ${tx.id} 的 cards[index].name=${targetName} 未在当前应用可访问的飞书目标表中找到；如果表已存在，请检查该表是否已授权给自建应用/bot，已跳过`,
      );
      return undefined;
    }

    return targetTable;
  }

  // 在写入前做一次轻量 Base 权限探测；目标表结构由刷新流程负责。
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

    this.permissionCheckPassed = true;
    this.lastPermissionCheckAt = now;
  }

  private toBitableRecord(
    tx: BankTransactionDocument,
    accountCardMap: Map<string, BankAccountCardInfo>,
  ): BitableRecordPayload['records'][number] | undefined {
    const raw = this.asObjectRecord(tx.raw);
    const fields: Record<string, string | number | boolean> = {};

    const transactionId = tx.transSequenceIdn?.trim();
    if (!transactionId) {
      this.logger.warn(`交易 ${tx.id} 缺失交易流水号，跳过同步`);
      return undefined;
    }

    // 日期是明细核算日；在列表里也用它派生月份和周次。
    const dateText = this.formatDate(tx.transDatetime);
    if (dateText) {
      // 飞书当前表结构使用时间戳写入更稳定。
      fields[BITABLE_FIELDS.DATE] = dateText;
      const monthIndex = tx.transDatetime.getUTCMonth();
      fields[BITABLE_FIELDS.MONTH] = BITABLE_MONTH_NAMES[monthIndex];
      fields[BITABLE_FIELDS.PERIOD] = this.toPeriodByDate(tx.transDatetime);
    } else {
      this.logger.warn(
        `交易 ${tx.id} 的 transDatetime 非法，已跳过日期/月份/周期映射：${String(
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
      fields[BITABLE_FIELDS.SUMMARY] = summary;
    }
    fields[BITABLE_FIELDS.TRANSACTION_ID] = transactionId;

    // 按 UID + 银行卡号精确匹配 cards[index]，确保飞书账户字段使用卡片名称。
    const accountCard = accountCardMap.get(
      this.toAccountCardKey(tx.UID, tx.cardNbr),
    );
    if (accountCard?.name.trim()) {
      fields[BITABLE_FIELDS.ACCOUNT] = this.normalizeSelectValue(
        accountCard.name,
      );
    }
    if (accountCard?.cardNbr.trim()) {
      fields[BITABLE_FIELDS.CARD_NBR] = accountCard.cardNbr.trim();
    }

    const counterparty = this.toText(raw.ctpAcctName);
    if (counterparty) {
      fields[BITABLE_FIELDS.COUNTERPARTY] = counterparty;
    }

    const currency = this.normalizeCurrency(this.toText(raw.currencyNbr));
    if (currency) {
      fields[BITABLE_FIELDS.CURRENCY] = currency;
    }
    const rawAmount = this.toNumber(raw.transAmount);
    if (rawAmount !== undefined) {
      const sign = this.toText(raw.loanCode)?.toUpperCase();
      if (sign === 'C') {
        fields[BITABLE_FIELDS.AMOUNT_IN] = Math.abs(rawAmount);
        fields[BITABLE_FIELDS.AMOUNT_OUT] = 0;
      } else if (sign === 'D') {
        fields[BITABLE_FIELDS.AMOUNT_OUT] = Math.abs(rawAmount);
        fields[BITABLE_FIELDS.AMOUNT_IN] = 0;
      } else if (rawAmount >= 0) {
        fields[BITABLE_FIELDS.AMOUNT_IN] = rawAmount;
        fields[BITABLE_FIELDS.AMOUNT_OUT] = 0;
      } else {
        fields[BITABLE_FIELDS.AMOUNT_OUT] = Math.abs(rawAmount);
        fields[BITABLE_FIELDS.AMOUNT_IN] = 0;
      }
    }

    const balance = this.toNumber(raw.acctOnlineBal);
    if (balance !== undefined) {
      fields[BITABLE_FIELDS.BALANCE] = balance;
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
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    return undefined;
  }

  private toNumber(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
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
      return (value as unknown[])
        .map((item) => {
          if (typeof item === 'string') {
            return item.trim();
          }
          if (this.hasStringField(item, 'text')) {
            return item.text.trim();
          }
          if (this.hasStringField(item, 'name')) {
            return item.name.trim();
          }
          return '';
        })
        .find((item) => item.length > 0);
    }

    if (this.hasStringField(value, 'name')) {
      return value.name.trim();
    }
    if (this.hasStringField(value, 'text')) {
      return value.text.trim();
    }
    return undefined;
  }

  private hasStringField<T extends string>(
    value: unknown,
    field: T,
  ): value is Record<T, string> {
    return (
      value !== null &&
      typeof value === 'object' &&
      field in value &&
      typeof (value as Record<T, unknown>)[field] === 'string'
    );
  }
}
