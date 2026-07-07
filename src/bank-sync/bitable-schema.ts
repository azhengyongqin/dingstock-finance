export interface BitableTableFieldDefinition {
  field_name: string;
  type: number;
  ui_type?:
    'Text' | 'Number' | 'Currency' | 'SingleSelect' | 'DateTime' | 'Formula';
  property?: Record<string, unknown>;
}

export const BITABLE_MONTH_NAMES = [
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

export const BITABLE_FIELDS = {
  DATE: '日期',
  SUMMARY: '摘要',
  AMOUNT_IN: '收入金额',
  AMOUNT_OUT: '支出金额',
  CURRENCY: '币种',
  COUNTERPARTY: '对方单位',
  ACCOUNT: '账户',
  CARD_NBR: '银行卡号',
  BALANCE: '余额（系统）',
  MONTH: '月份',
  PERIOD: '周期',
  TRANSACTION_ID: '流水号',
  NET_VALUE: '净值',
  RUNNING_BALANCE: '余额',
} as const;

export const BITABLE_WRITABLE_FIELD_NAMES = [
  BITABLE_FIELDS.DATE,
  BITABLE_FIELDS.SUMMARY,
  BITABLE_FIELDS.AMOUNT_IN,
  BITABLE_FIELDS.AMOUNT_OUT,
  BITABLE_FIELDS.CURRENCY,
  BITABLE_FIELDS.COUNTERPARTY,
  BITABLE_FIELDS.ACCOUNT,
  BITABLE_FIELDS.CARD_NBR,
  BITABLE_FIELDS.BALANCE,
  BITABLE_FIELDS.MONTH,
  BITABLE_FIELDS.PERIOD,
  BITABLE_FIELDS.TRANSACTION_ID,
];

export const BITABLE_TARGET_VIEW_NAME = 'ALL（勿动）';

export const BITABLE_FIELD_TYPES = {
  TEXT: 1,
  NUMBER: 2,
  SINGLE_SELECT: 3,
  DATETIME: 5,
  FORMULA: 20,
} as const;

export function buildBitableBaseTableFieldDefinitions(
  tableName: string,
): BitableTableFieldDefinition[] {
  return [
    {
      field_name: BITABLE_FIELDS.DATE,
      type: BITABLE_FIELD_TYPES.DATETIME,
      ui_type: 'DateTime',
      property: { date_formatter: 'yyyy/MM/dd' },
    },
    {
      field_name: BITABLE_FIELDS.SUMMARY,
      type: BITABLE_FIELD_TYPES.TEXT,
      ui_type: 'Text',
    },
    buildCurrencyFieldDefinition(BITABLE_FIELDS.AMOUNT_IN),
    buildCurrencyFieldDefinition(BITABLE_FIELDS.AMOUNT_OUT),
    {
      field_name: BITABLE_FIELDS.CURRENCY,
      type: BITABLE_FIELD_TYPES.SINGLE_SELECT,
      ui_type: 'SingleSelect',
      property: { options: [{ name: '人民币' }] },
    },
    {
      field_name: BITABLE_FIELDS.COUNTERPARTY,
      type: BITABLE_FIELD_TYPES.TEXT,
      ui_type: 'Text',
    },
    {
      field_name: BITABLE_FIELDS.ACCOUNT,
      type: BITABLE_FIELD_TYPES.SINGLE_SELECT,
      ui_type: 'SingleSelect',
      // 新表至少包含当前卡片名，后续未知选项由飞书按写入值自动补充。
      property: { options: [{ name: tableName }] },
    },
    {
      field_name: BITABLE_FIELDS.CARD_NBR,
      type: BITABLE_FIELD_TYPES.TEXT,
      ui_type: 'Text',
    },
    {
      field_name: BITABLE_FIELDS.BALANCE,
      type: BITABLE_FIELD_TYPES.NUMBER,
      ui_type: 'Number',
      property: {
        formatter: '0.00',
        range_customize: false,
      },
    },
    {
      field_name: BITABLE_FIELDS.MONTH,
      type: BITABLE_FIELD_TYPES.SINGLE_SELECT,
      ui_type: 'SingleSelect',
      property: {
        options: BITABLE_MONTH_NAMES.map((name) => ({ name })),
      },
    },
    {
      field_name: BITABLE_FIELDS.PERIOD,
      type: BITABLE_FIELD_TYPES.SINGLE_SELECT,
      ui_type: 'SingleSelect',
      property: {
        options: ['第一周', '第二周', '第三周', '第四周', '第五周'].map(
          (name) => ({ name }),
        ),
      },
    },
    {
      field_name: BITABLE_FIELDS.TRANSACTION_ID,
      type: BITABLE_FIELD_TYPES.TEXT,
      ui_type: 'Text',
    },
  ];
}

export function buildBitableNetValueFormula(
  tableId: string,
  fieldIdMap: Map<string, string>,
) {
  const incomeField = getRequiredFieldId(fieldIdMap, BITABLE_FIELDS.AMOUNT_IN);
  const outcomeField = getRequiredFieldId(
    fieldIdMap,
    BITABLE_FIELDS.AMOUNT_OUT,
  );

  return (
    `IF(ISBLANK(bitable::$table[${tableId}].$field[${incomeField}]),0,bitable::$table[${tableId}].$field[${incomeField}])` +
    ` - IF(ISBLANK(bitable::$table[${tableId}].$field[${outcomeField}]),0,bitable::$table[${tableId}].$field[${outcomeField}])`
  );
}

export function buildBitableRunningBalanceFormula(
  tableId: string,
  fieldIdMap: Map<string, string>,
) {
  const accountField = getRequiredFieldId(fieldIdMap, BITABLE_FIELDS.ACCOUNT);
  const dateField = getRequiredFieldId(fieldIdMap, BITABLE_FIELDS.DATE);
  const incomeField = getRequiredFieldId(fieldIdMap, BITABLE_FIELDS.AMOUNT_IN);
  const outcomeField = getRequiredFieldId(
    fieldIdMap,
    BITABLE_FIELDS.AMOUNT_OUT,
  );

  return (
    `bitable::$table[${tableId}].FILTER(CurrentValue.$column[${accountField}] = bitable::$table[${tableId}].$field[${accountField}] && ` +
    `CurrentValue.$column[${dateField}] <= bitable::$table[${tableId}].$field[${dateField}]).$column[${incomeField}].LISTCOMBINE().SUM()` +
    ` - bitable::$table[${tableId}].FILTER(CurrentValue.$column[${accountField}] = bitable::$table[${tableId}].$field[${accountField}] && ` +
    `CurrentValue.$column[${dateField}] <= bitable::$table[${tableId}].$field[${dateField}]).$column[${outcomeField}].LISTCOMBINE().SUM()`
  );
}

function buildCurrencyFieldDefinition(
  fieldName: string,
): BitableTableFieldDefinition {
  return {
    field_name: fieldName,
    type: BITABLE_FIELD_TYPES.NUMBER,
    ui_type: 'Currency',
    property: {
      formatter: '0.00',
      currency_code: 'CNY',
    },
  };
}

function getRequiredFieldId(
  fieldIdMap: Map<string, string>,
  fieldName: string,
) {
  const fieldId = fieldIdMap.get(fieldName);
  if (!fieldId) {
    throw new Error(`飞书字段缺失：${fieldName}`);
  }
  return fieldId;
}
