import { describe, expect, it } from "vitest";
import {
  buildIntervals,
  calculateInterval,
  calculatePeriodSummary,
  createNextPeriodOpeningBalances,
  hasOperationsAfterLastSnapshot,
  isOperationInsideInterval
} from "./calculations";
import { OperationRecord, SnapshotRecord } from "./types";

const baseDate = new Date("2026-08-17T18:00:00.000Z");

describe("farm calculations", () => {
  it("counts regular earned value without expenses", () => {
    const summary = calculateInterval(
      snapshot("start", baseDate, 100, 10),
      snapshot("end", addHours(baseDate, 24), 125, 15),
      []
    );

    expect(summary.adena.grossEarned).toBe(25);
    expect(summary.adena.regularFarm).toBe(25);
    expect(summary.adena.netResult).toBe(25);
    expect(summary.lCoin.grossEarned).toBe(5);
  });

  it("adds several expenses back into gross earned value", () => {
    const summary = calculateInterval(
      snapshot("start", baseDate, 100, 0),
      snapshot("end", addHours(baseDate, 24), 125, 0),
      [
        operation("e1", "expense", "adena", 10, addHours(baseDate, 2)),
        operation("e2", "expense", "adena", 5, addHours(baseDate, 4))
      ]
    );

    expect(summary.adena.expenses).toBe(15);
    expect(summary.adena.grossEarned).toBe(40);
    expect(summary.adena.netResult).toBe(25);
  });

  it("separates special income from regular farm", () => {
    const summary = calculateInterval(
      snapshot("start", baseDate, 100, 0),
      snapshot("end", addHours(baseDate, 24), 550, 0),
      [
        operation("expense", "expense", "adena", 50, addHours(baseDate, 4)),
        operation("drop", "special_income", "adena", 200, addHours(baseDate, 6))
      ]
    );

    expect(summary.adena.grossEarned).toBe(500);
    expect(summary.adena.specialIncome).toBe(200);
    expect(summary.adena.regularFarm).toBe(300);
    expect(summary.adena.netResult).toBe(450);
  });

  it("allows a net loss when closing balance is lower than opening balance", () => {
    const summary = calculateInterval(
      snapshot("start", baseDate, 100, 0),
      snapshot("end", addHours(baseDate, 24), 90, 0),
      [operation("expense", "expense", "adena", 30, addHours(baseDate, 3))]
    );

    expect(summary.adena.grossEarned).toBe(20);
    expect(summary.adena.netResult).toBe(-10);
  });

  it("calculates adena and L-coins independently", () => {
    const summary = calculateInterval(
      snapshot("start", baseDate, 100, 10),
      snapshot("end", addHours(baseDate, 24), 150, 8),
      [
        operation("adena-expense", "expense", "adena", 10, addHours(baseDate, 2)),
        operation("coin-expense", "expense", "l_coin", 3, addHours(baseDate, 2))
      ]
    );

    expect(summary.adena.grossEarned).toBe(60);
    expect(summary.lCoin.grossEarned).toBe(1);
    expect(summary.lCoin.netResult).toBe(-2);
  });

  it("includes operations strictly after start and up to end snapshot", () => {
    const start = snapshot("start", baseDate, 100, 0);
    const end = snapshot("end", addHours(baseDate, 24), 120, 0);

    expect(isOperationInsideInterval(operation("before", "expense", "adena", 1, baseDate), start, end)).toBe(false);
    expect(isOperationInsideInterval(operation("inside", "expense", "adena", 1, addHours(baseDate, 1)), start, end)).toBe(true);
    expect(isOperationInsideInterval(operation("at-end", "expense", "adena", 1, addHours(baseDate, 24)), start, end)).toBe(true);
  });

  it("excludes operations created after the ending snapshot", () => {
    const summary = calculateInterval(
      snapshot("start", baseDate, 100, 0),
      snapshot("end", addHours(baseDate, 24), 120, 0),
      [operation("late", "expense", "adena", 999, addHours(baseDate, 25))]
    );

    expect(summary.adena.expenses).toBe(0);
    expect(summary.adena.grossEarned).toBe(20);
  });

  it("marks a combined interval when a day was skipped", () => {
    const intervals = buildIntervals(
      [
        snapshot("monday", new Date("2026-08-17T18:00:00.000Z"), 100, 0),
        snapshot("wednesday", new Date("2026-08-19T18:00:00.000Z"), 160, 0)
      ],
      [],
      "preliminary",
      "UTC"
    );

    expect(intervals[0].missingDays).toBe(1);
    expect(intervals[0].accountedDays).toBe(2);
  });

  it("recalculates after an expense amount was edited", () => {
    const start = snapshot("start", baseDate, 100, 0);
    const end = snapshot("end", addHours(baseDate, 24), 130, 0);
    const beforeEdit = calculateInterval(start, end, [
      operation("expense", "expense", "adena", 10, addHours(baseDate, 2))
    ]);
    const afterEdit = calculateInterval(start, end, [
      operation("expense", "expense", "adena", 25, addHours(baseDate, 2))
    ]);

    expect(beforeEdit.adena.grossEarned).toBe(40);
    expect(afterEdit.adena.grossEarned).toBe(55);
  });

  it("moves closing balances into the next opening period", () => {
    const summary = calculatePeriodSummary(
      [
        snapshot("start", baseDate, 100, 10),
        snapshot("close", addHours(baseDate, 168), 250, 35)
      ],
      [operation("expense", "expense", "adena", 20, addHours(baseDate, 10))]
    );

    expect(summary.adena.grossEarned).toBe(170);
    expect(createNextPeriodOpeningBalances(summary)).toEqual({ adena: 250, lCoin: 35 });
  });

  it("detects operations that need a fresh balance snapshot", () => {
    expect(
      hasOperationsAfterLastSnapshot(
        [snapshot("last", baseDate, 100, 0)],
        [operation("late", "expense", "adena", 1, addHours(baseDate, 1))]
      )
    ).toBe(true);
  });
});

function snapshot(id: string, capturedAt: Date, adena: number, lCoin: number): SnapshotRecord {
  return {
    id,
    kind: "daily",
    balances: { adena, lCoin },
    capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt
  };
}

function operation(
  id: string,
  type: OperationRecord["type"],
  currency: OperationRecord["currency"],
  amount: number,
  occurredAt: Date
): OperationRecord {
  return {
    id,
    type,
    currency,
    amount,
    category: "test",
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 36e5);
}
