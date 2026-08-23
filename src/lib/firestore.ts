import { User } from "firebase/auth";
import {
  Timestamp,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import {
  calculatePeriodSummary,
  getLastSnapshot,
  keyToOperationCurrency,
  normalizeBalances,
  sortOperations,
  sortSnapshots
} from "./calculations";
import { db, requireFirebase } from "./firebase";
import {
  BalanceMap,
  CharacterRecord,
  CharacterStatus,
  OperationCurrency,
  OperationRecord,
  OperationType,
  PeriodRecord,
  SnapshotKind,
  SnapshotRecord,
  ThemePreference,
  UserProfile,
  WorkspaceData
} from "./types";

type CharacterInput = {
  nickname: string;
  server?: string;
  initialBalances: BalanceMap;
  capturedAt: Date;
};

type SnapshotInput = {
  balances: BalanceMap;
  capturedAt: Date;
  comment?: string;
  kind?: SnapshotKind;
};

type OperationInput = {
  type: OperationType;
  currency: OperationCurrency;
  amount: number;
  category: string;
  comment?: string;
  occurredAt: Date;
};

export async function ensureUserProfile(user: User): Promise<void> {
  const { db: firestore } = requireFirebase();
  const profileRef = doc(firestore, "users", user.uid);
  const profile = await getDoc(profileRef);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  if (!profile.exists()) {
    await setDoc(profileRef, {
      email: user.email ?? "",
      timezone,
      weekStartsOn: 1,
      theme: readStoredTheme(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return;
  }

  await setDoc(
    profileRef,
    {
      email: user.email ?? profile.data().email ?? "",
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function loadWorkspace(uid: string): Promise<WorkspaceData> {
  const { db: firestore } = requireFirebase();
  const profileSnapshot = await getDoc(doc(firestore, "users", uid));
  const charactersSnapshot = await getDocs(
    query(collection(firestore, "users", uid, "characters"), orderBy("nicknameNormalized", "asc"))
  );

  const characters = await Promise.all(
    charactersSnapshot.docs.map(async (characterDoc) => {
      const periodsSnapshot = await getDocs(
        query(collection(characterDoc.ref, "periods"), orderBy("openedAt", "asc"))
      );
      const periods = await Promise.all(
        periodsSnapshot.docs.map(async (periodDoc) => {
          const snapshotsSnapshot = await getDocs(
            query(collection(periodDoc.ref, "snapshots"), orderBy("capturedAt", "asc"))
          );
          const operationsSnapshot = await getDocs(
            query(collection(periodDoc.ref, "operations"), orderBy("occurredAt", "desc"))
          );

          return mapPeriod(
            periodDoc.id,
            periodDoc.data(),
            snapshotsSnapshot.docs.map((snapshot) => mapSnapshot(snapshot.id, snapshot.data())),
            operationsSnapshot.docs.map((operation) => mapOperation(operation.id, operation.data()))
          );
        })
      );

      return mapCharacter(characterDoc.id, characterDoc.data(), periods);
    })
  );

  return {
    profile: profileSnapshot.exists() ? mapProfile(profileSnapshot.data()) : null,
    characters
  };
}

export async function updateProfileTheme(uid: string, theme: ThemePreference): Promise<void> {
  const { db: firestore } = requireFirebase();
  await updateDoc(doc(firestore, "users", uid), {
    theme,
    updatedAt: serverTimestamp()
  });
}

export async function createCharacter(uid: string, input: CharacterInput): Promise<string> {
  const { db: firestore } = requireFirebase();
  const normalizedNickname = normalizeNickname(input.nickname);
  await assertNicknameUnique(uid, normalizedNickname);

  const characterRef = doc(collection(firestore, "users", uid, "characters"));
  const periodRef = doc(collection(characterRef, "periods"));
  const snapshotRef = doc(collection(periodRef, "snapshots"));
  const plannedStartDate = toYmd(input.capturedAt);
  const plannedEndDate = toYmd(addDays(input.capturedAt, 6));
  const balances = normalizeBalances(input.initialBalances);
  const now = serverTimestamp();
  const batch = writeBatch(firestore);

  batch.set(characterRef, {
    nickname: input.nickname.trim(),
    nicknameNormalized: normalizedNickname,
    server: input.server?.trim() || "",
    status: "active",
    currentBalances: balances,
    lastSnapshotAt: Timestamp.fromDate(input.capturedAt),
    activePeriodId: periodRef.id,
    createdAt: now,
    updatedAt: now
  });
  batch.set(periodRef, {
    status: "open",
    plannedStartDate,
    plannedEndDate,
    openingSnapshotId: snapshotRef.id,
    openedAt: Timestamp.fromDate(input.capturedAt),
    createdAt: now,
    updatedAt: now
  });
  batch.set(snapshotRef, {
    kind: "initial",
    balances,
    capturedAt: Timestamp.fromDate(input.capturedAt),
    comment: "Начальный замер",
    createdAt: now,
    updatedAt: now
  });

  await batch.commit();
  return characterRef.id;
}

export async function updateCharacter(
  uid: string,
  character: CharacterRecord,
  input: Pick<CharacterInput, "nickname" | "server">
): Promise<void> {
  const { db: firestore } = requireFirebase();
  const normalizedNickname = normalizeNickname(input.nickname);

  if (normalizedNickname !== character.nicknameNormalized) {
    await assertNicknameUnique(uid, normalizedNickname);
  }

  await updateDoc(doc(firestore, "users", uid, "characters", character.id), {
    nickname: input.nickname.trim(),
    nicknameNormalized: normalizedNickname,
    server: input.server?.trim() || "",
    updatedAt: serverTimestamp()
  });
}

export async function setCharacterStatus(
  uid: string,
  characterId: string,
  status: CharacterStatus
): Promise<void> {
  const { db: firestore } = requireFirebase();
  await updateDoc(doc(firestore, "users", uid, "characters", characterId), {
    status,
    updatedAt: serverTimestamp()
  });
}

export async function deleteCharacterTree(uid: string, character: CharacterRecord): Promise<void> {
  const { db: firestore } = requireFirebase();
  const batch = writeBatch(firestore);
  const characterRef = doc(firestore, "users", uid, "characters", character.id);

  for (const period of character.periods) {
    const periodRef = doc(characterRef, "periods", period.id);

    for (const snapshot of period.snapshots) {
      batch.delete(doc(periodRef, "snapshots", snapshot.id));
    }

    for (const operation of period.operations) {
      batch.delete(doc(periodRef, "operations", operation.id));
    }

    batch.delete(periodRef);
  }

  batch.delete(characterRef);
  await batch.commit();
}

export async function addSnapshot(
  uid: string,
  character: CharacterRecord,
  period: PeriodRecord,
  input: SnapshotInput
): Promise<void> {
  const { db: firestore } = requireFirebase();
  const lastSnapshot = getLastSnapshot(period.snapshots);

  if (lastSnapshot && input.capturedAt.getTime() < lastSnapshot.capturedAt.getTime()) {
    throw new Error("Новый замер не может быть раньше предыдущего без режима исправления истории.");
  }

  const balances = normalizeBalances(input.balances);
  const snapshotRef = doc(
    collection(firestore, "users", uid, "characters", character.id, "periods", period.id, "snapshots")
  );
  const batch = writeBatch(firestore);
  const now = serverTimestamp();

  batch.set(snapshotRef, {
    kind: input.kind ?? "daily",
    balances,
    capturedAt: Timestamp.fromDate(input.capturedAt),
    comment: input.comment?.trim() || "",
    createdAt: now,
    updatedAt: now
  });
  batch.update(doc(firestore, "users", uid, "characters", character.id), {
    currentBalances: balances,
    lastSnapshotAt: Timestamp.fromDate(input.capturedAt),
    updatedAt: now
  });

  await batch.commit();
}

export async function saveOperation(
  uid: string,
  character: CharacterRecord,
  period: PeriodRecord,
  input: OperationInput,
  operationId?: string
): Promise<void> {
  const { db: firestore } = requireFirebase();
  const amount = input.amount;

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Сумма операции должна быть целым числом больше нуля.");
  }

  if (input.type === "special_income" && !input.comment?.trim()) {
    throw new Error("Для крупного поступления нужно описание.");
  }

  const operationRef = operationId
    ? doc(firestore, "users", uid, "characters", character.id, "periods", period.id, "operations", operationId)
    : doc(collection(firestore, "users", uid, "characters", character.id, "periods", period.id, "operations"));
  const payload = {
    type: input.type,
    currency: input.currency,
    amount,
    category: input.category,
    comment: input.comment?.trim() || "",
    occurredAt: Timestamp.fromDate(input.occurredAt),
    updatedAt: serverTimestamp()
  };

  if (operationId) {
    await updateDoc(operationRef, payload);
  } else {
    await setDoc(operationRef, {
      ...payload,
      createdAt: serverTimestamp()
    });
  }
}

export async function deleteOperation(
  uid: string,
  character: CharacterRecord,
  period: PeriodRecord,
  operationId: string
): Promise<void> {
  const { db: firestore } = requireFirebase();
  await deleteDoc(doc(firestore, "users", uid, "characters", character.id, "periods", period.id, "operations", operationId));
}

export async function closePeriod(
  uid: string,
  character: CharacterRecord,
  period: PeriodRecord,
  input: SnapshotInput
): Promise<void> {
  const { db: firestore } = requireFirebase();
  const balances = normalizeBalances(input.balances);
  const closingSnapshot: SnapshotRecord = {
    id: "closing-preview",
    kind: "closing",
    balances,
    capturedAt: input.capturedAt,
    comment: input.comment,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const snapshots = [...period.snapshots, closingSnapshot];
  const summary = calculatePeriodSummary(snapshots, period.operations);
  const nextPeriodStart = input.capturedAt;
  const nextPlannedEnd = addDays(input.capturedAt, 6);
  const characterRef = doc(firestore, "users", uid, "characters", character.id);
  const currentPeriodRef = doc(characterRef, "periods", period.id);
  const closingSnapshotRef = doc(collection(currentPeriodRef, "snapshots"));
  const nextPeriodRef = doc(collection(characterRef, "periods"));
  const openingSnapshotRef = doc(collection(nextPeriodRef, "snapshots"));
  const batch = writeBatch(firestore);
  const now = serverTimestamp();

  batch.set(closingSnapshotRef, {
    kind: "closing",
    balances,
    capturedAt: Timestamp.fromDate(input.capturedAt),
    comment: input.comment?.trim() || "Закрытие периода",
    createdAt: now,
    updatedAt: now
  });
  batch.update(currentPeriodRef, {
    status: "closed",
    closingSnapshotId: closingSnapshotRef.id,
    closedAt: Timestamp.fromDate(input.capturedAt),
    summary,
    updatedAt: now
  });
  batch.set(nextPeriodRef, {
    status: "open",
    plannedStartDate: toYmd(nextPeriodStart),
    plannedEndDate: toYmd(nextPlannedEnd),
    openingSnapshotId: openingSnapshotRef.id,
    openedAt: Timestamp.fromDate(nextPeriodStart),
    createdAt: now,
    updatedAt: now
  });
  batch.set(openingSnapshotRef, {
    kind: "initial",
    balances,
    capturedAt: Timestamp.fromDate(nextPeriodStart),
    comment: "Остаток перенесен из закрытого периода",
    createdAt: now,
    updatedAt: now
  });
  batch.update(characterRef, {
    activePeriodId: nextPeriodRef.id,
    currentBalances: balances,
    lastSnapshotAt: Timestamp.fromDate(nextPeriodStart),
    updatedAt: now
  });

  await batch.commit();
}

export async function reopenLastClosedPeriod(
  uid: string,
  character: CharacterRecord,
  period: PeriodRecord
): Promise<void> {
  const { db: firestore } = requireFirebase();
  const closedPeriods = character.periods.filter((item) => item.status === "closed");
  const latestClosed = closedPeriods[closedPeriods.length - 1];

  if (!latestClosed || latestClosed.id !== period.id) {
    throw new Error("В MVP можно открыть для исправления только последний закрытый период.");
  }

  const activePeriod = character.periods.find((item) => item.id === character.activePeriodId);

  if (!activePeriod) {
    throw new Error("Не найден текущий открытый период.");
  }

  if (activePeriod.operations.length > 0 || activePeriod.snapshots.length > 1) {
    throw new Error("Следующий период уже содержит записи. Безопасный каскадный пересчет в MVP ограничен.");
  }

  await runTransaction(firestore, async (transaction) => {
    const characterRef = doc(firestore, "users", uid, "characters", character.id);
    const closedPeriodRef = doc(characterRef, "periods", period.id);
    const activePeriodRef = doc(characterRef, "periods", activePeriod.id);
    const lastSnapshot = getLastSnapshot(period.snapshots);

    transaction.update(closedPeriodRef, {
      status: "open",
      closingSnapshotId: deleteField(),
      closedAt: deleteField(),
      summary: deleteField(),
      updatedAt: serverTimestamp()
    });

    for (const snapshot of activePeriod.snapshots) {
      transaction.delete(doc(activePeriodRef, "snapshots", snapshot.id));
    }

    transaction.delete(activePeriodRef);
    transaction.update(characterRef, {
      activePeriodId: period.id,
      currentBalances: lastSnapshot?.balances ?? character.currentBalances,
      lastSnapshotAt: Timestamp.fromDate(lastSnapshot?.capturedAt ?? character.lastSnapshotAt),
      updatedAt: serverTimestamp()
    });
  });
}

export function getOpenPeriod(character: CharacterRecord): PeriodRecord | null {
  return character.periods.find((period) => period.id === character.activePeriodId && period.status === "open") ?? null;
}

export function normalizeNickname(nickname: string): string {
  return nickname.trim().toLocaleLowerCase("ru-RU");
}

async function assertNicknameUnique(uid: string, normalizedNickname: string): Promise<void> {
  if (!normalizedNickname) {
    throw new Error("Ник обязателен.");
  }

  if (!db) {
    throw new Error("Firebase не настроен.");
  }

  const existing = await getDocs(
    query(
      collection(db, "users", uid, "characters"),
      where("nicknameNormalized", "==", normalizedNickname)
    )
  );

  if (!existing.empty) {
    throw new Error("Персонаж с таким ником уже есть в вашем кабинете.");
  }
}

function mapProfile(data: Record<string, unknown>): UserProfile {
  return {
    email: String(data.email ?? ""),
    displayName: optionalString(data.displayName),
    timezone: String(data.timezone ?? "UTC"),
    weekStartsOn: 1,
    theme: isTheme(data.theme) ? data.theme : "system",
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt)
  };
}

function mapCharacter(id: string, data: Record<string, unknown>, periods: PeriodRecord[]): CharacterRecord {
  const balances = data.currentBalances as Partial<BalanceMap> | undefined;

  return {
    id,
    nickname: String(data.nickname ?? ""),
    nicknameNormalized: String(data.nicknameNormalized ?? ""),
    server: optionalString(data.server),
    status: data.status === "archived" ? "archived" : "active",
    currentBalances: normalizeBalances(balances ?? {}),
    lastSnapshotAt: toDate(data.lastSnapshotAt),
    activePeriodId: String(data.activePeriodId ?? ""),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    periods
  };
}

function mapPeriod(
  id: string,
  data: Record<string, unknown>,
  snapshots: SnapshotRecord[],
  operations: OperationRecord[]
): PeriodRecord {
  const rawSummary = data.summary as PeriodRecord["summary"] | undefined;

  return {
    id,
    status: data.status === "closed" ? "closed" : "open",
    plannedStartDate: String(data.plannedStartDate ?? ""),
    plannedEndDate: String(data.plannedEndDate ?? ""),
    openingSnapshotId: String(data.openingSnapshotId ?? ""),
    closingSnapshotId: optionalString(data.closingSnapshotId),
    openedAt: toDate(data.openedAt),
    closedAt: data.closedAt ? toDate(data.closedAt) : undefined,
    summary: rawSummary,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    snapshots: sortSnapshots(snapshots),
    operations: sortOperations(operations)
  };
}

function mapSnapshot(id: string, data: Record<string, unknown>): SnapshotRecord {
  const balances = data.balances as Partial<BalanceMap> | undefined;

  return {
    id,
    kind: isSnapshotKind(data.kind) ? data.kind : "daily",
    balances: normalizeBalances(balances ?? {}),
    capturedAt: toDate(data.capturedAt),
    comment: optionalString(data.comment),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt)
  };
}

function mapOperation(id: string, data: Record<string, unknown>): OperationRecord {
  return {
    id,
    type: data.type === "special_income" ? "special_income" : "expense",
    currency: data.currency === "l_coin" ? "l_coin" : keyToOperationCurrency("adena"),
    amount: Number(data.amount ?? 0),
    category: String(data.category ?? ""),
    comment: optionalString(data.comment),
    occurredAt: toDate(data.occurredAt),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt)
  };
}

function isSnapshotKind(value: unknown): value is SnapshotKind {
  return value === "initial" || value === "daily" || value === "closing";
}

function isTheme(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function optionalString(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function toDate(value: unknown): Date {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "object" && value && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate();
  }

  return new Date();
}

function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  const theme = window.localStorage.getItem("theme");
  return isTheme(theme) ? theme : "system";
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
