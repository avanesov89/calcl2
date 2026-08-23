import { Currency, CurrencySummary, OperationCurrency } from "./types";

export const currencyLabels: Record<Currency, string> = {
  adena: "Адена",
  lCoin: "L-монеты"
};

export const operationCurrencyLabels: Record<OperationCurrency, string> = {
  adena: "Адена",
  l_coin: "L-монеты"
};

const integerFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0
});

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

export function formatSignedInteger(value: number): string {
  if (value > 0) {
    return `+${formatInteger(value)}`;
  }

  return formatInteger(value);
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) {
    return `${sign}${formatCompactNumber(abs / 1_000_000_000)} млрд`;
  }

  if (abs >= 1_000_000) {
    return `${sign}${formatCompactNumber(abs / 1_000_000)} млн`;
  }

  if (abs >= 1_000) {
    return `${sign}${formatCompactNumber(abs / 1_000)} тыс.`;
  }

  return formatInteger(value);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function formatInputDateTime(date = new Date()): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function parseInputDateTime(value: string): Date {
  return new Date(value);
}

export function formatIntervalLabel(start: Date, end: Date): string {
  const sameDate = start.toDateString() === end.toDateString();

  if (sameDate) {
    return `${formatDate(start)}, ${timeOnly(start)}-${timeOnly(end)}`;
  }

  return `${formatDate(start)} - ${formatDate(end)}`;
}

export function resultClassName(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) {
    return "positive";
  }

  if (value < 0) {
    return "negative";
  }

  return "neutral";
}

export function summarizeCurrency(summary: CurrencySummary): string {
  return `Заработано ${formatInteger(summary.grossEarned)}, из них ${formatInteger(
    summary.specialIncome
  )} - крупные поступления. Обычный фарм - ${formatInteger(summary.regularFarm)}. Расходы - ${formatInteger(
    summary.expenses
  )}. Чистый результат - ${formatSignedInteger(summary.netResult)}.`;
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(value >= 10 ? 1 : 2).replace(".", ",");
}

function timeOnly(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
