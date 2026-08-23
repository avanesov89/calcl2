export const currencies = ["adena", "lCoin"] as const;

export type Currency = (typeof currencies)[number];
export type OperationCurrency = "adena" | "l_coin";
export type ThemePreference = "light" | "dark" | "system";
export type CharacterStatus = "active" | "archived";
export type PeriodStatus = "open" | "closed";
export type SnapshotKind = "initial" | "daily" | "closing";
export type OperationType = "expense" | "special_income";

export type BalanceMap = Record<Currency, number>;

export type CurrencySummary = {
  openingBalance: number;
  closingBalance: number;
  expenses: number;
  specialIncome: number;
  grossEarned: number;
  regularFarm: number;
  netResult: number;
};

export type PeriodSummary = {
  adena: CurrencySummary;
  lCoin: CurrencySummary;
  accountedDays: number;
  actualDurationHours: number;
};

export type UserProfile = {
  email: string;
  displayName?: string;
  timezone: string;
  weekStartsOn: 1;
  theme: ThemePreference;
  createdAt: Date;
  updatedAt: Date;
};

export type CharacterRecord = {
  id: string;
  nickname: string;
  nicknameNormalized: string;
  server?: string;
  status: CharacterStatus;
  currentBalances: BalanceMap;
  lastSnapshotAt: Date;
  activePeriodId: string;
  createdAt: Date;
  updatedAt: Date;
  periods: PeriodRecord[];
};

export type PeriodRecord = {
  id: string;
  status: PeriodStatus;
  plannedStartDate: string;
  plannedEndDate: string;
  openingSnapshotId: string;
  closingSnapshotId?: string;
  openedAt: Date;
  closedAt?: Date;
  summary?: PeriodSummary;
  createdAt: Date;
  updatedAt: Date;
  snapshots: SnapshotRecord[];
  operations: OperationRecord[];
};

export type SnapshotRecord = {
  id: string;
  kind: SnapshotKind;
  balances: BalanceMap;
  capturedAt: Date;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type OperationRecord = {
  id: string;
  type: OperationType;
  currency: OperationCurrency;
  amount: number;
  category: string;
  comment?: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspaceData = {
  profile: UserProfile | null;
  characters: CharacterRecord[];
};

export type IntervalSummary = {
  id: string;
  startSnapshot: SnapshotRecord;
  endSnapshot: SnapshotRecord;
  summary: Record<Currency, CurrencySummary>;
  accountedDays: number;
  actualDurationHours: number;
  missingDays: number;
  status: "preliminary" | "closed";
};
