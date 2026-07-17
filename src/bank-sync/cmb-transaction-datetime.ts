const CMB_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface CmbLocalDateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * 招商银行流水固定使用 UTC+8；拼接时显式保留 +08:00，禁止跟随服务器时区变化。
 * JavaScript Date 内部只保存绝对时刻，因此序列化成 ISO 时会显示对应的 UTC 时刻。
 */
export function parseCmbTransactionDatetime(
  transDate: string,
  transTime?: string,
): Date | undefined {
  const dateMatched = /^(\d{4})(\d{2})(\d{2})$/.exec(transDate);
  const timeMatched = /^(\d{2})(\d{2})(\d{2})$/.exec(transTime ?? '000000');
  if (!dateMatched || !timeMatched) {
    return undefined;
  }

  const [, yearText, monthText, dayText] = dateMatched;
  const [, hourText, minuteText, secondText] = timeMatched;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const result = new Date(
    `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}+08:00`,
  );

  // Date 解析可能滚动非法日期（例如 2 月 31 日），按 UTC+8 反查以拒绝这类输入。
  const localDate = new Date(result.getTime() + CMB_TIMEZONE_OFFSET_MS);
  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hour ||
    localDate.getUTCMinutes() !== minute ||
    localDate.getUTCSeconds() !== second
  ) {
    return undefined;
  }

  return result;
}

/** 从绝对时间点还原招商银行使用的北京时间年月日。 */
export function getCmbLocalDateParts(
  date: Date,
): CmbLocalDateParts | undefined {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return undefined;
  }

  const localDate = new Date(date.getTime() + CMB_TIMEZONE_OFFSET_MS);
  return {
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
  };
}
