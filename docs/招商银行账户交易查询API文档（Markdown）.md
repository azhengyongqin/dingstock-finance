# 账务查询 API 文档

> 更新时间：2026-06-09 &nbsp;|&nbsp; 接口版本：v1.0

---

## 接口：账户交易信息查询

- **接口名称**：`trsQryByBreakPoint`
- **请求方式**：`POST`
- **功能说明**：支持查询近 13 个月内对公客户金融交易数据，也可查询 13 个月外至 5 年内交易数据（需申请权限）。

> ⚠️ **注意**
> - 查询 13 个月外交易数据为新增功能，**不支持频繁查询**。
> - 若需查询 13 个月外至 5 年内交易数据，请联系客户经理申请开通功能权限，有效期默认 **1 年**。

---

## 使用说明

1. **多级汇总**：日间会隐藏实时划拨交易，日终对实时划拨汇总，新增汇总后的交易。
2. **组合存款**：协议内交易（增值户与签约户之间）会屏蔽；支取类只体现利息金额；关联/取消关联当作一笔交易。
3. **断点续传**：单次最多查询 **200 条**记录，超出时通过续传机制继续查询。
4. **账号说明**：一个户口号（`cardNbr`）下可能存在多个币种，每个币种对应一个账号（`acctNbr`）。查询时只需关注户口号，账号字段仅供行内系统续传使用。
5. **空格处理**：响应报文字段若存在尾部空格，可自行去除。

---

## 请求报文

### 结构概览

```json
{
  "request": {
    "head": { ... },
    "body": {
      "TRANSQUERYBYBREAKPOINT_X1": [ ... ],  // 必传
      "TRANSQUERYBYBREAKPOINT_Y1": [ ... ]   // 首次查询非必传
    }
  }
}
```

### Head 参数

| 字段名称 | 字段 ID   | 类型   | 必输 | 描述                              |
| -------- | --------- | ------ | :--: | --------------------------------- |
| 功能码   | `funcode` | String |  Y   | 固定值：`trsQryByBreakPoint`      |
| 请求流水号 | `reqid` | String |  N   | 请求唯一标识                      |
| 用户编号 | `userid`  | String |  Y   | 操作用户编号                      |

---

### Body - `TRANSQUERYBYBREAKPOINT_X1`（查询条件，单记录）

| 字段名称       | 字段 ID                | 类型        | 必输 | 描述                                                                                                   |
| -------------- | ---------------------- | ----------- | :--: | ------------------------------------------------------------------------------------------------------ |
| 户口号         | `cardNbr`              | String(35)  |  Y   | 对公客户户口号                                                                                         |
| 开始日期       | `beginDate`            | Date        |  Y   | 查询交易时间段的开始日期，格式：`yyyyMMdd`                                                             |
| 结束日期       | `endDate`              | Date        |  Y   | 查询交易时间段的结束日期，格式：`yyyyMMdd`                                                             |
| 起始记账序号   | `transactionSequence`  | String(9)   |  N   | 仅在**不传入续传键值**时有效，表示从第几笔开始查询，默认从第 `1` 笔开始                               |
| 币种           | `currencyCode`         | String(2)   |  N   | 可为空，但建议传入                                                                                     |
| 继续查询账号   | `queryAcctNbr`         | String(200) |  N   | 首次查询留空；续传时填入响应 `Z1` 中的 `queryAcctNbr` 值                                              |
| 借贷码         | `loanCode`             | String(1)   |  N   | `C`=贷方，`D`=借方                                                                                     |
| 保留字段       | `reserve`              | String      |  N   | 保留字段，长度未限制                                                                                   |

---

### Body - `TRANSQUERYBYBREAKPOINT_Y1`（续传键值，多记录）

> 首次查询无需传入；续传/断点查询时，将上次响应中的 `Y1` 实体原样传入。

| 字段名称         | 字段 ID                | 类型        | 必输 | 描述                         |
| ---------------- | ---------------------- | ----------- | :--: | ---------------------------- |
| 账号             | `acctNbr`              | String(200) |  N   | 行内系统账号                 |
| 交易日期         | `transDate`            | Date        |  N   | 当前查询最后一笔交易日期     |
| 期望下一记账序号 | `expectNextSequence`   | String(9)   |  N   | 期望下一笔记账的序号         |

---

## 响应报文

### 结构概览

```json
{
  "response": {
    "head": { ... },
    "body": {
      "TRANSQUERYBYBREAKPOINT_Y1": [ ... ],  // 续传键值
      "TRANSQUERYBYBREAKPOINT_Z1": [ ... ],  // 查询汇总
      "TRANSQUERYBYBREAKPOINT_Z2": [ ... ]   // 交易明细
    }
  }
}
```

### Head 参数

| 字段名称   | 字段 ID      | 类型   | 描述                          |
| ---------- | ------------ | ------ | ----------------------------- |
| 业务码     | `bizcode`    | String | 业务码                        |
| 功能码     | `funcode`    | String | 固定值：`trsQryByBreakPoint`  |
| 请求流水号 | `reqid`      | String | 请求唯一标识                  |
| 结果码     | `resultcode` | String | `SUC0000` 表示成功            |
| 结果信息   | `resultmsg`  | String | 结果描述                      |
| 响应流水号 | `rspid`      | String | 响应唯一标识                  |
| 用户编号   | `userid`     | String | 操作用户编号                  |

---

### Body - `TRANSQUERYBYBREAKPOINT_Y1`（续传键值，多记录）

| 字段名称         | 字段 ID              | 类型        | 必输 | 描述                         |
| ---------------- | -------------------- | ----------- | :--: | ---------------------------- |
| 账号             | `acctNbr`            | String(200) |  Y   | 行内系统账号                 |
| 交易日期         | `transDate`          | Date        |  Y   | 当前查询最后一笔交易日期     |
| 期望下一记账序号 | `expectNextSequence` | String(9)   |  Y   | 期望下一笔记账的序号         |

---

### Body - `TRANSQUERYBYBREAKPOINT_Z1`（查询汇总，单记录）

| 字段名称     | 字段 ID        | 类型        | 必输 | 描述                                                             |
| ------------ | -------------- | ----------- | :--: | ---------------------------------------------------------------- |
| 未传完标记   | `ctnFlag`      | String(1)   |  Y   | `Y`=还有记录需查询；`N`=已查询完毕                               |
| 继续查询账号 | `queryAcctNbr` | String(200) |  Y   | 当 `ctnFlag=Y` 时，下次请求需将此值填入 `X1.queryAcctNbr`       |
| 借方笔数     | `debitNums`    | Number      |  Y   | 本次查询借方交易笔数                                             |
| 借方金额     | `debitAmount`  | Money       |  Y   | 本次查询借方交易总金额                                           |
| 贷方笔数     | `creditNums`   | Number      |  Y   | 本次查询贷方交易笔数                                             |
| 贷方金额     | `creditAmount` | Money       |  Y   | 本次查询贷方交易总金额                                           |
| 保留字       | `reserve`      | String(200) |  N   | 保留字段                                                         |

---

### Body - `TRANSQUERYBYBREAKPOINT_Z2`（交易明细，多记录）

#### 基本交易信息

| 字段名称     | 字段 ID            | 类型        | 必输 | 描述                                  |
| ------------ | ------------------ | ----------- | :--: | ------------------------------------- |
| 交易日       | `transDate`        | Date        |  Y   | 格式：`yyyyMMdd`                      |
| 流水号       | `transSequenceIdn` | String(15)  |  Y   | 交易唯一流水号                        |
| 交易时间     | `transTime`        | String(6)   |  N   | 格式：`HHmmss`                        |
| 起息日       | `valueDate`        | Date        |  N   | 格式：`yyyyMMdd`                      |
| 借贷码       | `loanCode`         | String(1)   |  N   | `C`=贷方，`D`=借方                    |
| 交易金额     | `transAmount`      | Money       |  Y   | 交易金额                              |
| 币种         | `currencyNbr`      | String(2)   |  Y   | 交易币种代码                          |
| 交易类型     | `textCode`         | String(12)  |  N   | 见附录 A.9                            |
| 票据号       | `billNumber`       | String(20)  |  N   | 票据号                                |
| 冲帐标志     | `reversalFlag`     | String(1)   |  N   | `*`=冲帐，`X`=补帐（冲账借贷与原交易相反） |
| 余额         | `acctOnlineBal`    | Money       |  Y   | 交易后账户余额                        |

#### 摘要信息

| 字段名称   | 字段 ID          | 类型       | 必输 | 描述                                                                               |
| ---------- | ---------------- | ---------- | :--: | ---------------------------------------------------------------------------------- |
| 你方摘要   | `remarkTextClt`  | String(200)|  N   | 企业银行客户端经办：为用途信息（4.0 版代发代扣除外）；其它渠道：为交易简单说明    |
| 扩展摘要   | `extendedRemark` | String(34) |  N   | 有效位数为 16                                                                      |
| 业务名称   | `businessName`   | String(60) |  N   | 网银业务名称                                                                       |
| 网银业务摘要 | `businessText` | String(400)|  N   | 企业银行客户端录入的摘要信息                                                       |

#### 收付方信息

| 字段名称         | 字段 ID            | 类型        | 必输 | 描述             |
| ---------------- | ------------------ | ----------- | :--: | ---------------- |
| 收付方帐号       | `ctpAcctNbr`       | String(35)  |  N   | 收付方账号       |
| 收付方名称       | `ctpAcctName`      | String(200) |  N   | 收付方名称       |
| 收付方开户行行名 | `ctpBankName`      | String(400) |  N   | 收付方开户行行名 |
| 收付方开户行地址 | `ctpBankAddress`   | String(200) |  N   | 收付方开户行地址 |

#### 母子公司信息

| 字段名称             | 字段 ID                | 类型        | 必输 | 描述                 |
| -------------------- | ---------------------- | ----------- | :--: | -------------------- |
| 母子公司帐号         | `fatOrSonAccount`      | String(35)  |  N   | 母子公司账号         |
| 母子公司名称         | `fatOrSonCompanyName`  | String(200) |  N   | 母子公司名称         |
| 母子公司开户行行名   | `fatOrSonBankName`     | String(200) |  N   | 母子公司开户行行名   |
| 母子公司开户行地址   | `fatOrSonBankAddress`  | String(200) |  N   | 母子公司开户行地址   |

#### 信息标志说明

| 字段名称 | 字段 ID    | 类型      | 必输 | 描述                                                                                                       |
| -------- | ---------- | --------- | :--: | ---------------------------------------------------------------------------------------------------------- |
| 信息标志 | `infoFlag` | String(1) |  N   | 标识收/付方帐号和母/子公司信息：空=付方+子公司；`1`=收方+子公司；`2`=收方+母公司；`3`=原收方+子公司 |

#### 网银及扩展信息

| 字段名称         | 字段 ID        | 类型        | 必输 | 描述                                     |
| ---------------- | -------------- | ----------- | :--: | ---------------------------------------- |
| 网银流程实例号   | `requestNbr`   | String(10)  |  N   | 网银流程实例号                           |
| 网银业务参考号   | `yurRef`       | String(30)  |  N   | 支付和代发的业务参考号记录于此           |
| 虚拟户编号       | `virtualNbr`   | String(16)  |  N   | 子单元编号，需开通交易管家-收款识别功能  |
| 商务支付订单号   | `mchOrderNbr`  | String(50)  |  N   | 由商务支付订单产生                       |
| 记账卡号         | `transCardNbr` | String(35)  |  N   | 仅当 X1 中 `cardNbr` 与实际记账不一致时有值（如公司卡号、131 农民工监管子户户口号） |
| 保留字           | `reserve`      | String      |  N   | 保留字段                                 |

---

## 查询流程

### 续传查询流程

```
┌─────────────────────────────────────────────────────────┐
│  发起首次查询                                            │
│  X1: { cardNbr, beginDate, endDate, queryAcctNbr: "" }  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
                ┌─────────────────┐
                │  收到响应        │
                │  检查 Z1.ctnFlag │
                └────────┬────────┘
                         │
            ┌────────────┴────────────┐
            │ ctnFlag = "N"           │ ctnFlag = "Y"
            ▼                         ▼
      ✅ 查询完毕              继续发起续传请求
                              X1.queryAcctNbr = Z1.queryAcctNbr
                              Body 携带响应中的 Y1 实体
                                      │
                                      └──► 回到「收到响应」
```

### 断点查询流程

> 场景：10:00 查询完毕，16:00 需要继续查询 10:00 - 16:00 新增的交易。

```
┌──────────────────────────────────────────────────────────────┐
│  发起断点查询                                                 │
│  X1: { cardNbr, beginDate, endDate, queryAcctNbr: "" }       │
│  Y1: 携带上次查询完毕时响应中的 Y1 实体（原样传入）           │
└──────────────────────────────────────────────────────────────┘
```

---

## 请求/响应示例

### 首次查询

**Request**

```json
{
  "request": {
    "head": {
      "funcode": "trsQryByBreakPoint",
      "reqid": "",
      "userid": "U003736239"
    },
    "body": {
      "TRANSQUERYBYBREAKPOINT_X1": [
        {
          "cardNbr": "755947919810515",
          "beginDate": "20230401",
          "endDate": "20230502",
          "transactionSequence": "1",
          "currencyCode": "",
          "queryAcctNbr": "",
          "reserve": ""
        }
      ]
    }
  }
}
```

**Response**

```json
{
  "response": {
    "head": {
      "funcode": "trsQryByBreakPoint",
      "reqid": "20230414152738333QCDC trsQryByBreakPointU003736239",
      "resultcode": "SUC0000",
      "resultmsg": "",
      "rspid": "202302141527390530001QHWS04198QD01",
      "userid": "U003736239"
    },
    "body": {
      "TRANSQUERYBYBREAKPOINT_Y1": [
        { "acctNbr": "755947919880003", "transDate": "20230401", "expectNextSequence": "1" },
        { "acctNbr": "755947919880009", "transDate": "20230401", "expectNextSequence": "1" },
        { "acctNbr": "755947919880029", "transDate": "20230411", "expectNextSequence": "101" }
      ],
      "TRANSQUERYBYBREAKPOINT_Z1": [
        {
          "ctnFlag": "Y",
          "queryAcctNbr": "755947919880029",
          "debitNums": "1",
          "debitAmount": "-40.01",
          "creditNums": "0",
          "creditAmount": "0"
        }
      ],
      "TRANSQUERYBYBREAKPOINT_Z2": [
        {
          "transDate": "20220228",
          "transSequenceIdn": "C09468U00012KWZ",
          "transTime": "140337",
          "valueDate": "20220228",
          "loanCode": "D",
          "transAmount": "-40.01",
          "currencyNbr": "10",
          "textCode": "EBPP",
          "remarkTextClt": "批量代付业务报文",
          "reversalFlag": "N",
          "acctOnlineBal": "2000110921419.82",
          "ctpAcctNbr": "957151020441242810",
          "infoFlag": "1"
        }
      ]
    }
  }
}
```

> `Z1.ctnFlag = "Y"` 表示还有记录未查询完，需发起续传请求。

---

### 续传查询

**Request**

```json
{
  "request": {
    "head": {
      "funcode": "trsQryByBreakPoint",
      "reqid": "",
      "userid": "U003736239"
    },
    "body": {
      "TRANSQUERYBYBREAKPOINT_X1": [
        {
          "cardNbr": "755947919810515",
          "beginDate": "20230401",
          "endDate": "20230502",
          "transactionSequence": "1",
          "currencyCode": "",
          "queryAcctNbr": "755947919880029"
        }
      ],
      "TRANSQUERYBYBREAKPOINT_Y1": [
        { "acctNbr": "755947919880003", "transDate": "20230401", "expectNextSequence": "1" },
        { "acctNbr": "755947919880009", "transDate": "20230401", "expectNextSequence": "1" },
        { "acctNbr": "755947919880029", "transDate": "20230411", "expectNextSequence": "100" }
      ]
    }
  }
}
```

---

### 断点查询

**Request**

```json
{
  "request": {
    "head": {
      "funcode": "trsQryByBreakPoint",
      "reqid": "",
      "userid": "U003736239"
    },
    "body": {
      "TRANSQUERYBYBREAKPOINT_X1": [
        {
          "cardNbr": "755947919810515",
          "beginDate": "20230401",
          "endDate": "20230502",
          "transactionSequence": "1",
          "currencyCode": "",
          "queryAcctNbr": ""
        }
      ],
      "TRANSQUERYBYBREAKPOINT_Y1": [
        { "acctNbr": "755947919880003", "transDate": "20230401", "expectNextSequence": "1" },
        { "acctNbr": "755947919880009", "transDate": "20230401", "expectNextSequence": "1" },
        { "acctNbr": "755947919880029", "transDate": "20230411", "expectNextSequence": "100" }
      ]
    }
  }
}
```

---

## 错误码说明

| 结果码    | 说明     |
| --------- | -------- |
| `SUC0000` | 请求成功 |

---

## 附录

### 币种代码

| 代码 | 说明   |
| ---- | ------ |
| `10` | 人民币 |

### 借贷码

| 代码 | 说明 |
| ---- | ---- |
| `C`  | 贷方 |
| `D`  | 借方 |

### 交易类型（textCode）

> 详见附录 A.9（请参考银行接口完整文档）