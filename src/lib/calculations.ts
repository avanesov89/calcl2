import {
  BalanceMap,
  Currency,
  CurrencySummary,
  IntervalSummary,
  OperationCurrency,
  OperationRecord,
  PeriodSummary,
  SnapshotRecord,
  currencies
} from "./types";

const emptyBalances: BalanceMap = {
  adena: 0,
  lCoin: 0
};

export function isSafeIntegerAmount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number.isFinite(value as number);
}

export function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!isSafeIntegerAmount(value) || (value as number) < 0) {
    throw new Error(`${label}: нужно неотрицательное целое число`);
  }

  return value as number;
}

export function assertPositiveInteger(value: unknown, label: string): number {
  if (!isSafeIntegerAmount(value) || (value as number) <= 0) {
    throw new Error(`${label}: нужно целое число больше нуля`);
  }

  return value as number;
}

export function operationCurrencyToKey(currency: OperationCurrency): Currency {
  return currency === "l_coin" ? "lCoin" : "adena";
}

export function keyToOperationCurrency(currency: Currency): OperationCurrency {
  return currency === "lCoin" ? "l_coin" : "adena";
}

export function normalizeBalances(balances: Partial<BalanceMap>): BalanceMap {
  return {
    adena: assertNonNegativeInteger(balances.adena ?? 0, "Адена"),
    lCoin: assertNonNegativeInteger(balances.lCoin ?? 0, "L-монеты")
  };
}

export function isOperationInsideInterval(
  operation: Pick<OperationRecord, "occurredAt">,
  startSnapshot: Pick<SnapshotRecord, "capturedAt">,
  endSnapshot: Pick<SnapshotRecord, "capturedAt">
): boolean {
  const occurredAt = operation.occurredAt.getTime();
  return occurredAt > startSnapshot.capturedAt.getTime() && occurredAt <= endSnapshot.capturedAt.getTime();
}

export function sumOperationsBetween(
  operations: OperationRecord[],
  startSnapshot: SnapshotRecord,
  endSnapshot: SnapshotRecord,
  currency: Currency,
  type: OperationRecord["type"]
): number {
  return operations.reduce((sum, operation) => {
    if (operation.type !== type) {
      return sum;
    }

    if (operationCurrencyToKey(operation.currency) !== currency) {
      return sum;
    }

    if (!isOperationInsideInterval(operation, startSnapshot, endSnapshot)) {
      return sum;
    }

    return sum + assertPositiveInteger(operation.amount, "Сумма операции");
  }, 0);
}

export function calculateCurrencySummary(
  startBalance: number,
  endBalance: number,
  expenses: number,
  specialIncome: number
): CurrencySummary {
  const openingBalance = assertNonNegativeInteger(startBalance, "Начальный остаток");
  const closingBalance = assertNonNegativeInteger(endBalance, "Конечный остаток");
  const safeExpenses = assertNonNegativeInteger(expenses, "Расходы");
  const safeSpecialIncome = assertNonNegativeInteger(specialIncome, "Поступления");
  const grossEarned = closingBalance - openingBalance + safeExpenses;
  const regularFarm = grossEarned - safeSpecialIncome;
  const netResult = closingBalance - openingBalance;

  return {
    openingBalance,
    closingBalance,
    expenses: safeExpenses,
    specialIncome: safeSpecialIncome,
    grossEarned,
    regularFarm,
    netResult
  };
}

export function calculateInterval(
  startSnapshot: SnapshotRecord,
  endSnapshot: SnapshotRecord,
  operations: OperationRecord[]
): Record<Currency, CurrencySummary> {
  return currencies.reduce((summary, currency) => {
    const expenses = sumOperationsBetween(operations, startSnapshot, endSnapshot, currency, "expense");
    const specialIncome = sumOperationsBetween(operations, startSnapshot, endSnapshot, currency, "special_income");

    summary[currency] = calculateCurrencySummary(
      startSnapshot.balances[currency],
      endSnapshot.balances[currency],
      expenses,
      specialIncome
    );

    return summary;
  }, {} as Record<Currency, CurrencySummary>);
}

export function calculatePeriodSummary(snapshots: SnapshotRecord[], operations: OperationRecord[]): PeriodSummary {
  const orderedSnapshots = sortSnapshots(snapshots);
  const openingSnapshot = orderedSnapshots[0];
  const closingSnapshot = orderedSnapshots[orderedSnapshots.length - 1];

  if (!openingSnapshot || !closingSnapshot) {
    return {
      adena: calculateCurrencySummary(0, 0, 0, 0),
      lCoin: calculateCurrencySummary(0, 0, 0, 0),
      accountedDays: 0,
      actualDurationHours: 0
    };
  }

  const summary = calculateInterval(openingSnapshot, closingSnapshot, operations);
  const actualDurationHours = Math.max(
    0,
    (closingSnapshot.capturedAt.getTime() - openingSnapshot.capturedAt.getTime()) / 36e5
  );

  return {
    adena: summary.adena,
    lCoin: summary.lCoin,
    accountedDays: calculateAccountedDays(openingSnapshot.capturedAt, closingSnapshot.capturedAt),
    actualDurationHours
  };
}

export function buildIntervals(
  snapshots: SnapshotRecord[],
  operations: OperationRecord[],
  status: IntervalSummary["status"] = "preliminary",
  timeZone = "UTC"
): IntervalSummary[] {
  const orderedSnapshots = sortSnapshots(snapshots);

  return orderedSnapshots.slice(1).map((endSnapshot, index) => {
    const startSnapshot = orderedSnapshots[index];
    const actualDurationHours = Math.max(
      0,
      (endSnapshot.capturedAt.getTime() - startSnapshot.capturedAt.getTime()) / 36e5
    );
    const calendarDays = calendarDayDistance(startSnapshot.capturedAt, endSnapshot.capturedAt, timeZone);

    return {
      id: `${startSnapshot.id}-${endSnapshot.id}`,
      startSnapshot,
      endSnapshot,
      summary: calculateInterval(startSnapshot, endSnapshot, operations),
      accountedDays: calculateAccountedDays(startSnapshot.capturedAt, endSnapshot.capturedAt),
      actualDurationHours,
      missingDays: Math.max(0, calendarDays - 1),
      status
    };
  });
}

export function hasOperationsAfterLastSnapshot(snapshots: SnapshotRecord[], operations: OperationRecord[]): boolean {
  const orderedSnapshots = sortSnapshots(snapshots);
  const lastSnapshot = orderedSnapshots[orderedSnapshots.length - 1];

  if (!lastSnapshot) {
    return operations.length > 0;
  }

  return operations.some((operation) => operation.occurredAt.getTime() > lastSnapshot.capturedAt.getTime());
}

export function sumCurrencySummaries(summaries: PeriodSummary[]): PeriodSummary {
  const initial = {
    adena: calculateCurrencySummary(0, 0, 0, 0),
    lCoin: calculateCurrencySummary(0, 0, 0, 0),
    accountedDays: 0,
    actualDurationHours: 0
  };

  return summaries.reduce((total, item) => ({
    adena: addCurrencySummary(total.adena, item.adena),
    lCoin: addCurrencySummary(total.lCoin, item.lCoin),
    accountedDays: total.accountedDays + item.accountedDays,
    actualDurationHours: total.actualDurationHours + item.actualDurationHours
  }), initial);
}

export function addCurrencySummary(left: CurrencySummary, right: CurrencySummary): CurrencySummary {
  return {
    openingBalance: left.openingBalance + right.openingBalance,
    closingBalance: left.closingBalance + right.closingBalance,
    expenses: left.expenses + right.expenses,
    specialIncome: left.specialIncome + right.specialIncome,
    grossEarned: left.grossEarned + right.grossEarned,
    regularFarm: left.regularFarm + right.regularFarm,
    netResult: left.netResult + right.netResult
  };
}

export function createNextPeriodOpeningBalances(closingSummary: PeriodSummary): BalanceMap {
  return {
    adena: closingSummary.adena.closingBalance,
    lCoin: closingSummary.lCoin.closingBalance
  };
}

export function sortSnapshots(snapshots: SnapshotRecord[]): SnapshotRecord[] {
  return [...snapshots].sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
}

export function sortOperations(operations: OperationRecord[]): OperationRecord[] {
  return [...operations].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
}

export function getLastSnapshot(snapshots: SnapshotRecord[]): SnapshotRecord | null {
  const orderedSnapshots = sortSnapshots(snapshots);
  return orderedSnapshots[orderedSnapshots.length - 1] ?? null;
}

export function emptyCurrencySummary(balance = 0): CurrencySummary {
  return calculateCurrencySummary(balance, balance, 0, 0);
}

export function emptyPeriodSummary(balances: Partial<BalanceMap> = emptyBalances): PeriodSummary {
  const normalized = normalizeBalances(balances);

  return {
    adena: emptyCurrencySummary(normalized.adena),
    lCoin: emptyCurrencySummary(normalized.lCoin),
    accountedDays: 0,
    actualDurationHours: 0
  };
}

function calculateAccountedDays(start: Date, end: Date): number {
  const hours = Math.max(0, (end.getTime() - start.getTime()) / 36e5);
  return hours === 0 ? 0 : Math.max(1, Math.ceil(hours / 24));
}

function calendarDayDistance(start: Date, end: Date, timeZone: string): number {
  const startYmd = getZonedYmd(start, timeZone);
  const endYmd = getZonedYmd(end, timeZone);
  const startUtc = Date.UTC(startYmd.year, startYmd.month - 1, startYmd.day);
  const endUtc = Date.UTC(endYmd.year, endYmd.month - 1, endYmd.day);

  return Math.max(0, Math.round((endUtc - startUtc) / 864e5));
}

function getZonedYmd(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day")
  };
}
