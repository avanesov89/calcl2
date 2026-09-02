"use client";

import {
  Archive,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { User, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { Fragment, FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  buildIntervals,
  calculateInterval,
  calculatePeriodSummary,
  getLastSnapshot,
  hasOperationsAfterLastSnapshot,
  sortOperations,
  sortSnapshots,
  sumCurrencySummaries
} from "@/lib/calculations";
import { auth, hasFirebaseConfig, requireFirebase } from "@/lib/firebase";
import { translateFirebaseError } from "@/lib/firebase-errors";
import {
  closePeriod,
  createCharacter,
  deleteCharacterTree,
  deleteOperation,
  ensureUserProfile,
  getOpenPeriod,
  reopenLastClosedPeriod,
  saveOperation,
  saveSnapshot,
  setCharacterStatus,
  updateCharacter,
  updateProfileTheme
} from "@/lib/firestore";
import {
  CharacterRecord,
  Currency,
  OperationCurrency,
  OperationRecord,
  OperationType,
  PeriodRecord,
  PeriodSummary,
  SnapshotRecord,
  ThemePreference,
  currencies
} from "@/lib/types";
import {
  currencyLabels,
  formatCompact,
  formatDateTime,
  formatInputDateTime,
  formatInteger,
  formatIntervalLabel,
  formatShortDate,
  formatSignedInteger,
  formatYmdRange,
  operationCurrencyLabels,
  parseInputDateTime,
  resultClassName,
  summarizeCurrency
} from "@/lib/format";

type MainTab = "overview" | "characters" | "history";
type SortKey = "nickname" | "balance" | "interval" | "week" | "expenses" | "specialIncome" | "lastSnapshotAt";
type SortDirection = "asc" | "desc";

type ModalState =
  | { type: "character"; character?: CharacterRecord }
  | { type: "snapshot"; character: CharacterRecord; snapshot?: SnapshotRecord }
  | { type: "expense"; character: CharacterRecord; operation?: OperationRecord }
  | { type: "special_income"; character: CharacterRecord; operation?: OperationRecord }
  | { type: "close"; characters: CharacterRecord[] }
  | { type: "period"; character: CharacterRecord; period: PeriodRecord }
  | null;

type OperationFormInput = {
  type: OperationType;
  currency: OperationCurrency;
  amount: number;
  category: string;
  comment?: string;
  occurredAt: Date;
};

type CharacterFormInput = {
  nickname: string;
  server?: string;
  initialBalances: { adena: number; lCoin: number };
  capturedAt: Date;
};

type ClosePeriodSubmitItem = {
  character: CharacterRecord;
  period: PeriodRecord;
  input: { balances: { adena: number; lCoin: number }; capturedAt: Date; comment?: string };
};

const expenseCategories = ["Расходки", "Синтезы"];
const specialIncomeCategories = ["Дроп", "Продажа", "Другое"];

export default function AppShell() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!hasFirebaseConfig || !auth);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [profileTheme, setProfileTheme] = useState<ThemePreference>("system");
  const [timezone, setTimezone] = useState("UTC");
  const [loadingData, setLoadingData] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<MainTab>("characters");
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("adena");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [modal, setModal] = useState<ModalState>(null);

  const refresh = useCallback(async (uid: string) => {
    setLoadingData(true);
    setGlobalError("");

    try {
      const workspace = await import("@/lib/firestore").then((module) => module.loadWorkspace(uid));
      setCharacters(workspace.characters);
      setTimezone(workspace.profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
      setProfileTheme(workspace.profile?.theme ?? "system");
      applyTheme(workspace.profile?.theme ?? "system");
    } catch (error) {
      setGlobalError(translateFirebaseError(error));
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) {
      return undefined;
    }

    return onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setAuthReady(true);

      if (!user) {
        setCharacters([]);
        return;
      }

      try {
        await ensureUserProfile(user);
        await refresh(user.uid);
      } catch (error) {
        setGlobalError(translateFirebaseError(error));
      }
    });
  }, [refresh]);

  const activeCharacters = useMemo(
    () => characters.filter((character) => character.status === "active"),
    [characters]
  );
  const selectedCharacter = useMemo(
    () => characters.find((character) => character.id === selectedCharacterId) ?? null,
    [characters, selectedCharacterId]
  );

  async function reloadWithNotice(message?: string) {
    if (!currentUser) {
      return;
    }

    await refresh(currentUser.uid);
    if (message) {
      setNotice(message);
      window.setTimeout(() => setNotice(""), 2600);
    }
  }

  async function handleThemeChange(theme: ThemePreference) {
    setProfileTheme(theme);
    applyTheme(theme);

    if (currentUser) {
      await updateProfileTheme(currentUser.uid, theme);
    }
  }

  async function handleSignOut() {
    const { auth: firebaseAuth } = requireFirebase();
    await signOut(firebaseAuth);
  }

  async function handleCreateCharacter(input: CharacterFormInput) {
    if (!currentUser) {
      return;
    }

    const id = await createCharacter(currentUser.uid, input);
    setSelectedCharacterId(id);
    await reloadWithNotice("Персонаж добавлен.");
  }

  if (!hasFirebaseConfig) {
    return (
      <GateCard title="Firebase не настроен">
        <p className="subtitle">
          Заполните переменные из <code>.env.example</code> в локальном <code>.env.local</code>, затем перезапустите
          dev-сервер.
        </p>
      </GateCard>
    );
  }

  if (!authReady) {
    return (
      <GateCard title="Проверяем сессию">
        <p className="subtitle">Личный кабинет откроется после проверки Firebase Authentication.</p>
      </GateCard>
    );
  }

  if (!currentUser) {
    return <AuthGate />;
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>Учёт фарма</h1>
          <p className="subtitle">Lineage 2 Essence · личный кабинет</p>
        </div>
        <div className="topbar-actions">
          <span className="user-email">{currentUser.email}</span>
          <label className="theme-field">
            <span>Тема</span>
            <select value={profileTheme} onChange={(event) => handleThemeChange(event.target.value as ThemePreference)}>
              <option value="system">Системная</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </label>
          <button className="ghost" type="button" onClick={handleSignOut}>
            <DoorOpen size={15} />
            Выйти
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Основная навигация">
        <button className={tab === "characters" ? "tab-btn active" : "tab-btn"} type="button" onClick={() => setTab("characters")}>
          Персонажи
        </button>
        <button className={tab === "overview" ? "tab-btn active" : "tab-btn"} type="button" onClick={() => setTab("overview")}>
          Обзор
        </button>
        <button className={tab === "history" ? "tab-btn active" : "tab-btn"} type="button" onClick={() => setTab("history")}>
          История
        </button>
      </nav>

      {globalError ? <div className="err card">{globalError}</div> : null}
      {notice ? <div className="ok notice">{notice}</div> : null}
      {loadingData ? <div className="small">Загружаем данные...</div> : null}

      {tab === "characters" ? (
        <CharactersListScreen
          characters={activeCharacters}
          selectedCurrency={selectedCurrency}
          setSelectedCurrency={setSelectedCurrency}
          timezone={timezone}
          onOpenCharacter={(character) => {
            setSelectedCharacterId(character.id);
            setTab("overview");
          }}
          onClosePeriods={(selectedCharacters) => setModal({ type: "close", characters: selectedCharacters })}
          onCreateCharacter={handleCreateCharacter}
        />
      ) : null}

      {tab === "overview" ? (
        <CharacterOverviewScreen
          selectedCharacter={selectedCharacter}
          selectedCurrency={selectedCurrency}
          setSelectedCurrency={setSelectedCurrency}
          setModal={setModal}
          timezone={timezone}
          onArchive={async (character) => {
            await setCharacterStatus(currentUser.uid, character.id, character.status === "archived" ? "active" : "archived");
            await reloadWithNotice(character.status === "archived" ? "Персонаж возвращён в активные." : "Персонаж архивирован.");
          }}
          onDelete={async (character) => {
            if (!window.confirm(`Удалить ${character.nickname} вместе со всеми неделями, остатками и операциями?`)) {
              return;
            }

            await deleteCharacterTree(currentUser.uid, character);
            setSelectedCharacterId("");
            await reloadWithNotice("Персонаж удалён.");
          }}
          onDeleteOperation={async (character, period, operation) => {
            if (!window.confirm("Удалить операцию?")) {
              return;
            }

            await deleteOperation(currentUser.uid, character, period, operation.id);
            await reloadWithNotice("Операция удалена.");
          }}
          onSaveOperation={async (character, period, input, operationId) => {
            await saveOperation(currentUser.uid, character, period, input, operationId);
            await reloadWithNotice(operationId ? "Операция обновлена." : "Операция добавлена.");
          }}
          onGoToCharacters={() => setTab("characters")}
        />
      ) : null}

      {tab === "history" ? (
        <HistoryScreen
          characters={characters}
          selectedCurrency={selectedCurrency}
          setSelectedCurrency={setSelectedCurrency}
          setModal={setModal}
        />
      ) : null}

      {modal ? (
        <Modal onClose={() => setModal(null)}>
          {modal.type === "character" ? (
            <CharacterForm
              character={modal.character}
              onCancel={() => setModal(null)}
              onSubmit={async (input) => {
                if (!currentUser) {
                  return;
                }

                if (modal.character) {
                  await updateCharacter(currentUser.uid, modal.character, input);
                  await reloadWithNotice("Персонаж обновлён.");
                } else {
                  await handleCreateCharacter(input);
                }

                setModal(null);
              }}
            />
          ) : null}

          {modal.type === "snapshot" ? (
            <SnapshotForm
              character={modal.character}
              period={getOpenPeriod(modal.character)}
              snapshot={modal.snapshot}
              onCancel={() => setModal(null)}
              onSubmit={async (period, input, snapshotId) => {
                await saveSnapshot(currentUser.uid, modal.character, period, input, snapshotId);
                await reloadWithNotice(snapshotId ? "Остаток обновлён." : "Остаток сохранён.");
                setModal(null);
              }}
            />
          ) : null}

          {modal.type === "expense" || modal.type === "special_income" ? (
            <OperationForm
              character={modal.character}
              period={getOpenPeriod(modal.character)}
              type={modal.type}
              operation={modal.operation}
              onCancel={() => setModal(null)}
              onSubmit={async (period, input, operationId) => {
                await saveOperation(currentUser.uid, modal.character, period, input, operationId);
                await reloadWithNotice(operationId ? "Операция обновлена." : "Операция добавлена.");
                setModal(null);
              }}
            />
          ) : null}

          {modal.type === "close" ? (
            <ClosePeriodForm
              characters={modal.characters}
              selectedCurrency={selectedCurrency}
              onCancel={() => setModal(null)}
              onSubmit={async (items) => {
                await Promise.all(items.map((item) => closePeriod(currentUser.uid, item.character, item.period, item.input)));
                await reloadWithNotice(
                  items.length === 1
                    ? "Период завершён, следующий начат автоматически."
                    : `Период завершён для ${items.length} персонажей.`
                );
                setModal(null);
              }}
            />
          ) : null}

          {modal.type === "period" ? (
            <PeriodDetail
              character={modal.character}
              period={modal.period}
              selectedCurrency={selectedCurrency}
              onClose={() => setModal(null)}
              onReopen={async () => {
                await reopenLastClosedPeriod(currentUser.uid, modal.character, modal.period);
                await reloadWithNotice("Неделя открыта для исправления.");
                setModal(null);
              }}
            />
          ) : null}
        </Modal>
      ) : null}
    </main>
  );
}

function AuthGate() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!email.trim()) {
      setError("Email обязателен.");
      return;
    }

    if (mode !== "reset" && !password) {
      setError("Пароль обязателен.");
      return;
    }

    if (mode === "register" && password !== passwordRepeat) {
      setError("Пароли не совпадают.");
      return;
    }

    setSaving(true);

    try {
      const { auth: firebaseAuth } = requireFirebase();

      if (mode === "login") {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      }

      if (mode === "register") {
        const credentials = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        await ensureUserProfile(credentials.user);
      }

      if (mode === "reset") {
        await sendPasswordResetEmail(firebaseAuth, email.trim());
        setSuccess("Если аккаунт существует, письмо для восстановления отправлено.");
      }
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <GateCard title={mode === "login" ? "Вход" : mode === "register" ? "Регистрация" : "Восстановление пароля"}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" type="text" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        {mode !== "reset" ? (
          <div className="field">
            <label htmlFor="auth-password">Пароль</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        ) : null}
        {mode === "register" ? (
          <div className="field">
            <label htmlFor="auth-password-repeat">Повтор пароля</label>
            <input
              id="auth-password-repeat"
              type="password"
              autoComplete="new-password"
              value={passwordRepeat}
              onChange={(event) => setPasswordRepeat(event.target.value)}
            />
          </div>
        ) : null}
        <div className="err">{error}</div>
        {success ? <div className="ok">{success}</div> : null}
        <div className="form-actions">
          <button type="submit" disabled={saving}>
            <Save size={15} />
            {mode === "login" ? "Войти" : mode === "register" ? "Зарегистрироваться" : "Отправить письмо"}
          </button>
        </div>
      </form>
      <div className="gate-links">
        {mode !== "login" ? (
          <button className="ghost" type="button" onClick={() => setMode("login")}>
            Уже есть аккаунт - войти
          </button>
        ) : null}
        {mode !== "register" ? (
          <button className="ghost" type="button" onClick={() => setMode("register")}>
            Создать аккаунт
          </button>
        ) : null}
        {mode !== "reset" ? (
          <button className="ghost" type="button" onClick={() => setMode("reset")}>
            Забыли пароль?
          </button>
        ) : null}
      </div>
    </GateCard>
  );
}

function CharactersListScreen({
  characters,
  selectedCurrency,
  setSelectedCurrency,
  timezone,
  onOpenCharacter,
  onClosePeriods,
  onCreateCharacter
}: {
  characters: CharacterRecord[];
  selectedCurrency: Currency;
  setSelectedCurrency: (currency: Currency) => void;
  timezone: string;
  onOpenCharacter: (character: CharacterRecord) => void;
  onClosePeriods: (characters: CharacterRecord[]) => void;
  onCreateCharacter: (input: CharacterFormInput) => Promise<void>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("nickname");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isCharacterFormOpen, setIsCharacterFormOpen] = useState(false);
  const [selectedCloseIds, setSelectedCloseIds] = useState<string[]>([]);
  const totals = useMemo(() => {
    const balances = { adena: 0, lCoin: 0 };
    const summaries: PeriodSummary[] = [];

    for (const character of characters) {
      balances.adena += character.currentBalances.adena;
      balances.lCoin += character.currentBalances.lCoin;

      const period = getOpenPeriod(character);

      if (period) {
        summaries.push(calculatePeriodSummary(period.snapshots, period.operations));
      }
    }

    return { balances, summary: sumCurrencySummaries(summaries) };
  }, [characters]);
  const rows = useMemo(() => {
    const prepared = characters.map((character) => {
      const period = getOpenPeriod(character);
      const summary = period ? calculatePeriodSummary(period.snapshots, period.operations) : null;
      const intervals = period ? buildIntervals(period.snapshots, period.operations, "preliminary", timezone) : [];
      const lastInterval = intervals[intervals.length - 1];

      return { character, period, summary, lastInterval };
    });

    return prepared.sort((left, right) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      const getValue = (item: (typeof prepared)[number]) => {
        switch (sortKey) {
          case "balance":
            return item.character.currentBalances[selectedCurrency];
          case "interval":
            return item.lastInterval?.summary[selectedCurrency].netResult ?? 0;
          case "week":
            return item.summary?.[selectedCurrency].netResult ?? 0;
          case "expenses":
            return item.summary?.[selectedCurrency].expenses ?? 0;
          case "specialIncome":
            return item.summary?.[selectedCurrency].specialIncome ?? 0;
          case "lastSnapshotAt":
            return item.character.lastSnapshotAt.getTime();
          case "nickname":
          default:
            return item.character.nickname.toLocaleLowerCase("ru-RU");
        }
      };
      const leftValue = getValue(left);
      const rightValue = getValue(right);

      if (typeof leftValue === "string" && typeof rightValue === "string") {
        return leftValue.localeCompare(rightValue, "ru-RU") * direction;
      }

      return (Number(leftValue) - Number(rightValue)) * direction;
    });
  }, [characters, selectedCurrency, sortDirection, sortKey, timezone]);
  const closableRows = rows.filter(({ period }) => Boolean(period));
  const selectedCloseCharacters = rows
    .filter(({ character, period }) => Boolean(period) && selectedCloseIds.includes(character.id))
    .map(({ character }) => character);
  const allClosableSelected = closableRows.length > 0 && closableRows.every(({ character }) => selectedCloseIds.includes(character.id));

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  }

  function toggleCloseSelection(characterId: string) {
    setSelectedCloseIds((ids) => (ids.includes(characterId) ? ids.filter((id) => id !== characterId) : [...ids, characterId]));
  }

  function toggleAllCloseSelection() {
    setSelectedCloseIds(allClosableSelected ? [] : closableRows.map(({ character }) => character.id));
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Общий обзор</h2>
            <p className="subtitle">Сумма всех активных персонажей и их текущих недель.</p>
          </div>
        </div>
        <CurrencyTabs value={selectedCurrency} onChange={setSelectedCurrency} />
        <SummaryStats balances={totals.balances} summary={totals.summary} selectedCurrency={selectedCurrency} />
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Персонажи</h2>
          </div>
          <div className="button-row section-actions">
            <button
              className={isCharacterFormOpen ? "secondary active-secondary" : "secondary"}
              type="button"
              onClick={() => setIsCharacterFormOpen((isOpen) => !isOpen)}
            >
              <Plus size={15} />
              Добавить персонажа
            </button>
          </div>
        </div>
        {isCharacterFormOpen ? (
          <InlineCharacterForm
            onCancel={() => setIsCharacterFormOpen(false)}
            onSubmit={async (input) => {
              await onCreateCharacter(input);
              setIsCharacterFormOpen(false);
            }}
          />
        ) : null}
        {characters.length === 0 ? (
          <EmptyState text="Добавьте первого персонажа и укажите его текущие остатки, чтобы начать учёт." />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="select-cell">
                      <input
                        type="checkbox"
                        aria-label="Выбрать всех для закрытия периода"
                        checked={allClosableSelected}
                        disabled={closableRows.length === 0}
                        onChange={toggleAllCloseSelection}
                      />
                    </th>
                    <SortableTh active={sortKey === "nickname"} direction={sortDirection} onClick={() => toggleSort("nickname")}>
                      Персонаж
                    </SortableTh>
                    <SortableTh active={sortKey === "balance"} direction={sortDirection} onClick={() => toggleSort("balance")} alignRight>
                      Текущий остаток
                    </SortableTh>
                    <SortableTh active={sortKey === "interval"} direction={sortDirection} onClick={() => toggleSort("interval")} alignRight>
                      Сегодня/интервал
                    </SortableTh>
                    <SortableTh active={sortKey === "week"} direction={sortDirection} onClick={() => toggleSort("week")} alignRight>
                      Текущая неделя
                    </SortableTh>
                    <SortableTh active={sortKey === "expenses"} direction={sortDirection} onClick={() => toggleSort("expenses")} alignRight>
                      Расходы недели
                    </SortableTh>
                    <SortableTh active={sortKey === "specialIncome"} direction={sortDirection} onClick={() => toggleSort("specialIncome")} alignRight>
                      Крупные поступления
                    </SortableTh>
                    <SortableTh active={sortKey === "lastSnapshotAt"} direction={sortDirection} onClick={() => toggleSort("lastSnapshotAt")}>
                      Последний остаток
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ character, period, summary, lastInterval }) => {
                    const hasUncounted = period ? hasOperationsAfterLastSnapshot(period.snapshots, period.operations) : false;
                    const net = summary?.[selectedCurrency].netResult ?? 0;
                    const intervalNet = lastInterval?.summary[selectedCurrency].netResult ?? 0;

                    return (
                      <tr key={character.id}>
                        <td className="select-cell">
                          <input
                            type="checkbox"
                            aria-label={`Выбрать ${character.nickname} для закрытия периода`}
                            checked={selectedCloseIds.includes(character.id)}
                            disabled={!period}
                            onChange={() => toggleCloseSelection(character.id)}
                          />
                        </td>
                        <td>
                          <button className="link-btn" type="button" onClick={() => onOpenCharacter(character)}>
                            {character.nickname}
                          </button>
                          {character.server ? <div className="small">{character.server}</div> : null}
                        </td>
                        <td className="num-cell" title={formatInteger(character.currentBalances[selectedCurrency])}>
                          {formatInteger(character.currentBalances[selectedCurrency])}
                        </td>
                        <td className={`num-cell ${resultClassName(intervalNet)}`}>{lastInterval ? formatSignedInteger(intervalNet) : "—"}</td>
                        <td className={`num-cell ${resultClassName(net)}`}>{summary ? formatSignedInteger(net) : "—"}</td>
                        <td className="num-cell money-expense">{summary ? formatInteger(summary[selectedCurrency].expenses) : "—"}</td>
                        <td className="num-cell money-income">{summary ? formatInteger(summary[selectedCurrency].specialIncome) : "—"}</td>
                        <td>
                          <span className={hasUncounted ? "pill amber" : "date-cell"}>{formatShortDate(character.lastSnapshotAt)}</span>
                          {hasUncounted ? <div className="small">Есть операции после остатка</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bulk-close-bar">
              <span className="small">
                Для закрытия выбрано: {selectedCloseCharacters.length} из {closableRows.length}
              </span>
              <button
                className="secondary"
                type="button"
                onClick={() => onClosePeriods(selectedCloseCharacters)}
                disabled={selectedCloseCharacters.length === 0}
              >
                <Save size={15} />
                Закрыть период
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function CharacterOverviewScreen({
  selectedCharacter,
  selectedCurrency,
  setSelectedCurrency,
  setModal,
  timezone,
  onArchive,
  onDelete,
  onDeleteOperation,
  onSaveOperation,
  onGoToCharacters
}: {
  selectedCharacter: CharacterRecord | null;
  selectedCurrency: Currency;
  setSelectedCurrency: (currency: Currency) => void;
  setModal: (modal: ModalState) => void;
  timezone: string;
  onArchive: (character: CharacterRecord) => Promise<void>;
  onDelete: (character: CharacterRecord) => Promise<void>;
  onDeleteOperation: (character: CharacterRecord, period: PeriodRecord, operation: OperationRecord) => Promise<void>;
  onSaveOperation: (character: CharacterRecord, period: PeriodRecord, input: OperationFormInput, operationId?: string) => Promise<void>;
  onGoToCharacters: () => void;
}) {
  if (!selectedCharacter) {
    return (
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Выберите персонажа</h2>
            <p className="subtitle">Операции, остатки и расчёт появятся после выбора персонажа во вкладке «Персонажи».</p>
          </div>
          <button className="secondary" type="button" onClick={onGoToCharacters}>
            Перейти к персонажам
          </button>
        </div>
      </section>
    );
  }

  return (
    <CharacterDetail
      key={selectedCharacter.id}
      character={selectedCharacter}
      selectedCurrency={selectedCurrency}
      setSelectedCurrency={setSelectedCurrency}
      setModal={setModal}
      timezone={timezone}
      onArchive={onArchive}
      onDelete={onDelete}
      onDeleteOperation={onDeleteOperation}
      onSaveOperation={onSaveOperation}
    />
  );
}

function CharacterDetail({
  character,
  selectedCurrency,
  setSelectedCurrency,
  setModal,
  timezone,
  onArchive,
  onDelete,
  onDeleteOperation,
  onSaveOperation
}: {
  character: CharacterRecord;
  selectedCurrency: Currency;
  setSelectedCurrency: (currency: Currency) => void;
  setModal: (modal: ModalState) => void;
  timezone: string;
  onArchive: (character: CharacterRecord) => Promise<void>;
  onDelete: (character: CharacterRecord) => Promise<void>;
  onDeleteOperation: (character: CharacterRecord, period: PeriodRecord, operation: OperationRecord) => Promise<void>;
  onSaveOperation: (character: CharacterRecord, period: PeriodRecord, input: OperationFormInput, operationId?: string) => Promise<void>;
}) {
  const [operationTypeFilter, setOperationTypeFilter] = useState<"all" | OperationType>("all");
  const [operationCurrencyFilter, setOperationCurrencyFilter] = useState<"all" | OperationCurrency>("all");
  const [isCharacterMenuOpen, setIsCharacterMenuOpen] = useState(false);
  const [quickOperationType, setQuickOperationType] = useState<OperationType | null>(null);
  const period = getOpenPeriod(character);
  const summary = period ? calculatePeriodSummary(period.snapshots, period.operations) : null;
  const intervals = period ? [...buildIntervals(period.snapshots, period.operations, "preliminary", timezone)].reverse() : [];
  const hasUncounted = period ? hasOperationsAfterLastSnapshot(period.snapshots, period.operations) : false;
  const lastSnapshot = period ? getLastSnapshot(period.snapshots) : null;
  const pendingOperationsNote = period ? formatPendingOperationsNote(period, selectedCurrency) : "";
  const operations = period
    ? sortOperations(period.operations).filter((operation) => {
        const typeOk = operationTypeFilter === "all" || operation.type === operationTypeFilter;
        const currencyOk = operationCurrencyFilter === "all" || operation.currency === operationCurrencyFilter;
        return typeOk && currencyOk;
      })
    : [];

  return (
    <>
      <section className="card">
        <div className="card-head character-head">
          <div>
            <h2>{character.nickname}</h2>
            <p className="subtitle">
              {character.server ? `${character.server} · ` : ""}последний остаток {formatDateTime(character.lastSnapshotAt)}
            </p>
          </div>
          <div className="menu-wrap">
            <IconButton title="Действия персонажа" onClick={() => setIsCharacterMenuOpen((isOpen) => !isOpen)}>
              <MoreHorizontal size={17} />
            </IconButton>
            {isCharacterMenuOpen ? (
              <div className="menu-popover" role="menu">
                <button
                  className="menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsCharacterMenuOpen(false);
                    setModal({ type: "character", character });
                  }}
                >
                  <Pencil size={15} />
                  Редактировать
                </button>
                <button
                  className="menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsCharacterMenuOpen(false);
                    void onArchive(character);
                  }}
                >
                  <Archive size={15} />
                  {character.status === "archived" ? "Вернуть из архива" : "Архивировать"}
                </button>
                <button
                  className="menu-item"
                  type="button"
                  role="menuitem"
                  disabled={!period}
                  onClick={() => {
                    setIsCharacterMenuOpen(false);
                    setModal({ type: "close", characters: [character] });
                  }}
                >
                  <Save size={15} />
                  Закрыть период
                </button>
                <button
                  className="menu-item danger"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsCharacterMenuOpen(false);
                    void onDelete(character);
                  }}
                >
                  <Trash2 size={15} />
                  Удалить
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <CurrencyTabs value={selectedCurrency} onChange={setSelectedCurrency} />
        {summary ? (
          <SummaryStats balances={character.currentBalances} summary={summary} selectedCurrency={selectedCurrency} includeAverage />
        ) : (
          <p className="subtitle">Нет текущей недели.</p>
        )}

        {hasUncounted ? (
          <div className="steps warn">
            {pendingOperationsNote || "После последнего остатка есть операции. Введите текущий остаток, чтобы обновить расчёт."}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Расчёт по остаткам</h2>
            {lastSnapshot ? <span className="small">Последний введённый остаток: {formatDateTime(lastSnapshot.capturedAt)}</span> : null}
          </div>
          <div className="button-row section-actions">
            <button type="button" onClick={() => setModal({ type: "snapshot", character })} disabled={!period}>
              <RefreshCw size={15} />
              Ввести текущий остаток
            </button>
          </div>
        </div>
        {!period || intervals.length === 0 ? (
          <EmptyState text="Результат появится после ввода следующего текущего остатка." />
        ) : (
          <IntervalsTable
            intervals={intervals}
            selectedCurrency={selectedCurrency}
            onEditSnapshot={(snapshot) => setModal({ type: "snapshot", character, snapshot })}
          />
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Операции текущей недели</h2>
          <span className="small">{period ? formatYmdRange(period.plannedStartDate, period.plannedEndDate) : "Нет текущей недели"}</span>
        </div>
        <div className="table-toolbar">
          <div className="row filter-row">
            <div className="field">
              <label htmlFor="operation-type-filter">Тип</label>
              <select id="operation-type-filter" value={operationTypeFilter} onChange={(event) => setOperationTypeFilter(event.target.value as "all" | OperationType)}>
                <option value="all">Все</option>
                <option value="expense">Расходы</option>
                <option value="special_income">Поступления</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="operation-currency-filter">Валюта</label>
              <select
                id="operation-currency-filter"
                value={operationCurrencyFilter}
                onChange={(event) => setOperationCurrencyFilter(event.target.value as "all" | OperationCurrency)}
              >
                <option value="all">Все</option>
                <option value="adena">Адена</option>
                <option value="l_coin">L-монеты</option>
              </select>
            </div>
          </div>
          <div className="button-row section-actions">
            <button
              className={quickOperationType === "expense" ? "secondary active-secondary" : "secondary"}
              type="button"
              onClick={() => setQuickOperationType((current) => (current === "expense" ? null : "expense"))}
              disabled={!period}
            >
              <Minus size={15} />
              Расход
            </button>
            <button
              className={quickOperationType === "special_income" ? "secondary active-secondary" : "secondary"}
              type="button"
              onClick={() => setQuickOperationType((current) => (current === "special_income" ? null : "special_income"))}
              disabled={!period}
            >
              <Plus size={15} />
              Поступление
            </button>
          </div>
        </div>
        {quickOperationType ? (
          <InlineOperationForm
            key={`${character.id}-${quickOperationType}`}
            period={period}
            type={quickOperationType}
            onCancel={() => setQuickOperationType(null)}
            onSubmit={async (openPeriod, input) => {
              await onSaveOperation(character, openPeriod, input);
              setQuickOperationType(null);
            }}
          />
        ) : null}
        {!period || operations.length === 0 ? (
          <p className="subtitle">В текущей неделе пока нет расходов и крупных поступлений.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Валюта</th>
                  <th>Категория</th>
                  <th className="right">Сумма</th>
                  <th>Комментарий</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((operation) => (
                  <tr key={operation.id}>
                    <td className="date-cell">{formatDateTime(operation.occurredAt)}</td>
                    <td>
                      <span className={operation.type === "expense" ? "pill red" : "pill green"}>
                        {operation.type === "expense" ? "Расход" : "Поступление"}
                      </span>
                    </td>
                    <td>{operationCurrencyLabels[operation.currency]}</td>
                    <td>{operation.category}</td>
                    <td className={`num-cell ${operation.type === "expense" ? "money-expense" : "money-income"}`}>
                      {formatInteger(operation.amount)}
                    </td>
                    <td>{operation.comment || "—"}</td>
                    <td className="actions-cell">
                      <IconButton title="Редактировать" onClick={() => setModal({ type: operation.type, character, operation })}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton title="Удалить" tone="danger" onClick={() => onDeleteOperation(character, period, operation)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function HistoryScreen({
  characters,
  selectedCurrency,
  setSelectedCurrency,
  setModal
}: {
  characters: CharacterRecord[];
  selectedCurrency: Currency;
  setSelectedCurrency: (currency: Currency) => void;
  setModal: (modal: ModalState) => void;
}) {
  const [characterFilter, setCharacterFilter] = useState("all");
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const filteredCharacters = useMemo(
    () => (characterFilter === "all" ? characters : characters.filter((character) => character.id === characterFilter)),
    [characterFilter, characters]
  );
  const periodGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        actualStart: Date;
        actualEnd: Date;
        accountedDays: number;
        sortTime: number;
        items: Array<{ character: CharacterRecord; period: PeriodRecord; summary: PeriodSummary }>;
      }
    >();

    for (const character of filteredCharacters) {
      for (const period of character.periods) {
        if (period.status !== "closed") {
          continue;
        }

        const actualRange = getPeriodActualRange(period);
        const summary = period.summary ?? calculatePeriodSummary(period.snapshots, period.operations);
        const id = getHistoryPeriodGroupId(actualRange.start, actualRange.end, summary.accountedDays);
        const group = groups.get(id) ?? {
          id,
          actualStart: actualRange.start,
          actualEnd: actualRange.end,
          accountedDays: summary.accountedDays,
          sortTime: 0,
          items: []
        };

        group.items.push({
          character,
          period,
          summary
        });
        group.accountedDays = Math.max(group.accountedDays, summary.accountedDays);
        group.sortTime = Math.max(group.sortTime, getPeriodSortTime(period));
        groups.set(id, group);
      }
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        summary: sumCurrencySummaries(group.items.map((item) => item.summary))
      }))
      .sort((left, right) => right.sortTime - left.sortTime);
  }, [filteredCharacters]);

  function toggleExpanded(rowId: string) {
    setExpandedRows((current) => (current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId]));
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>История недель</h2>
          <p className="subtitle">Завершённые недели с детализацией по персонажам.</p>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="history-character">Персонаж</label>
          <select id="history-character" value={characterFilter} onChange={(event) => setCharacterFilter(event.target.value)}>
            <option value="all">Все персонажи</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.nickname}
              </option>
            ))}
          </select>
        </div>
        <CurrencyTabs value={selectedCurrency} onChange={setSelectedCurrency} compact />
      </div>
      {periodGroups.length === 0 ? (
        <p className="subtitle">История появится после закрытия первой недели.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th className="right">Общий расход</th>
                <th className="right">Общий доход</th>
              </tr>
            </thead>
            <tbody>
              {periodGroups.map((group) => {
                const currencySummary = group.summary[selectedCurrency];
                const expanded = expandedRows.includes(group.id);

                return (
                  <Fragment key={group.id}>
                    <tr className="history-main-row">
                      <td>
                        <button
                          className="accordion-trigger"
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={`history-details-${group.id}`}
                          onClick={() => toggleExpanded(group.id)}
                        >
                          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <span>{formatHistoryPeriodLabel(group.actualStart, group.actualEnd, group.accountedDays)}</span>
                        </button>
                        <div className="small history-server">
                          Персонажей: {group.items.length}; учтено: {formatDaysLabel(group.accountedDays)}
                        </div>
                      </td>
                      <td className="num-cell money-expense">{formatInteger(currencySummary.expenses)}</td>
                      <td className="num-cell money-income">{formatInteger(currencySummary.grossEarned)}</td>
                    </tr>
                    {expanded ? (
                      <tr className="history-detail-row">
                        <td colSpan={3}>
                          <div className="history-details" id={`history-details-${group.id}`}>
                            <div className="table-wrap history-compact-table">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Ник</th>
                                    <th className="right">Было</th>
                                    <th className="right">Стало</th>
                                    <th className="right">Доход</th>
                                    <th className="right">Расход</th>
                                    <th className="right">Поступления</th>
                                    <th className="right">Результат</th>
                                    <th>Детали</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...group.items]
                                    .sort((left, right) => left.character.nickname.localeCompare(right.character.nickname, "ru-RU"))
                                    .map(({ character, period, summary }) => {
                                      const itemSummary = summary[selectedCurrency];
                                      const average = summary.accountedDays ? Math.round(itemSummary.netResult / summary.accountedDays) : 0;

                                      return (
                                        <tr key={`${character.id}-${period.id}`}>
                                          <td>
                                            <b>{character.nickname}</b>
                                            {character.server ? <div className="small">{character.server}</div> : null}
                                          </td>
                                          <td className="num-cell">{formatInteger(itemSummary.openingBalance)}</td>
                                          <td className="num-cell">{formatInteger(itemSummary.closingBalance)}</td>
                                          <td className="num-cell money-income">{formatInteger(itemSummary.grossEarned)}</td>
                                          <td className="num-cell money-expense">{formatInteger(itemSummary.expenses)}</td>
                                          <td className="num-cell money-income">{formatInteger(itemSummary.specialIncome)}</td>
                                          <td className={`num-cell ${resultClassName(itemSummary.netResult)}`}>
                                            {formatSignedInteger(itemSummary.netResult)}
                                            <div className="small">{formatSignedInteger(average)}/день</div>
                                          </td>
                                          <td>
                                            <button className="copy-btn" type="button" onClick={() => setModal({ type: "period", character, period })}>
                                              Открыть
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InlineCharacterForm({
  onCancel,
  onSubmit
}: {
  onCancel?: () => void;
  onSubmit: (input: CharacterFormInput) => Promise<void>;
}) {
  const [nickname, setNickname] = useState("");
  const [server, setServer] = useState("");
  const [adena, setAdena] = useState("");
  const [lCoin, setLCoin] = useState("");
  const [capturedAt, setCapturedAt] = useState(formatInputDateTime());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (!nickname.trim()) {
        throw new Error("Ник обязателен.");
      }

      setSaving(true);
      await onSubmit({
        nickname,
        server,
        initialBalances: {
          adena: parseNonNegativeAmount(adena, "Начальная адена"),
          lCoin: parseNonNegativeAmount(lCoin, "Начальные L-монеты")
        },
        capturedAt: parseNotFuture(capturedAt)
      });
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inline-operation-form" onSubmit={submit}>
      <div className="inline-operation-row">
        <div className="field compact-character-name">
          <label htmlFor="quick-character-nickname">Ник</label>
          <input id="quick-character-nickname" type="text" value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </div>
        <div className="field compact-character-server">
          <label htmlFor="quick-character-server">Сервер</label>
          <input id="quick-character-server" type="text" value={server} onChange={(event) => setServer(event.target.value)} />
        </div>
        <div className="field compact-balance">
          <label htmlFor="quick-character-adena">Адена</label>
          <AmountInput id="quick-character-adena" value={adena} onChange={setAdena} />
        </div>
        <div className="field compact-balance">
          <label htmlFor="quick-character-lcoin">L-монеты</label>
          <AmountInput id="quick-character-lcoin" value={lCoin} onChange={setLCoin} />
        </div>
        <div className="field compact-date">
          <label htmlFor="quick-character-captured-at">Дата остатка</label>
          <input id="quick-character-captured-at" type="datetime-local" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} />
        </div>
        <div className="inline-form-actions">
          <button type="submit" disabled={saving}>
            <Save size={15} />
            {saving ? "Сохраняем..." : "Добавить"}
          </button>
          {onCancel ? (
            <IconButton title="Скрыть форму" onClick={onCancel}>
              <X size={16} />
            </IconButton>
          ) : null}
        </div>
      </div>
      <div className="err">{error}</div>
    </form>
  );
}

function CharacterForm({
  character,
  onCancel,
  onSubmit
}: {
  character?: CharacterRecord;
  onCancel: () => void;
  onSubmit: (input: CharacterFormInput) => Promise<void>;
}) {
  const [nickname, setNickname] = useState(character?.nickname ?? "");
  const [server, setServer] = useState(character?.server ?? "");
  const [adena, setAdena] = useState("");
  const [lCoin, setLCoin] = useState("");
  const [capturedAt, setCapturedAt] = useState(formatInputDateTime());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (!nickname.trim()) {
        throw new Error("Ник обязателен.");
      }

      setSaving(true);
      await onSubmit({
        nickname,
        server,
        initialBalances: {
          adena: parseNonNegativeAmount(adena, "Начальная адена"),
          lCoin: parseNonNegativeAmount(lCoin, "Начальные L-монеты")
        },
        capturedAt: parseNotFuture(capturedAt)
      });
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ModalHead title={character ? "Редактировать персонажа" : "Добавить персонажа"} onCancel={onCancel} />
      <div className="row">
        <div className="field grow">
          <label htmlFor="character-nickname">Ник</label>
          <input id="character-nickname" type="text" value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </div>
        <div className="field grow">
          <label htmlFor="character-server">Сервер</label>
          <input id="character-server" type="text" value={server} onChange={(event) => setServer(event.target.value)} />
        </div>
      </div>
      {!character ? (
        <>
          <div className="row">
            <div className="field">
              <label htmlFor="character-adena">Начальная адена</label>
              <AmountInput id="character-adena" value={adena} onChange={setAdena} />
            </div>
            <div className="field">
              <label htmlFor="character-lcoin">Начальные L-монеты</label>
              <AmountInput id="character-lcoin" value={lCoin} onChange={setLCoin} />
            </div>
            <div className="field">
              <label htmlFor="character-captured-at">Дата и время остатка</label>
              <input id="character-captured-at" type="datetime-local" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} />
            </div>
          </div>
        </>
      ) : null}
      <div className="err">{error}</div>
      <FormActions onCancel={onCancel} saving={saving} submitLabel={character ? "Сохранить" : "Добавить"} />
    </form>
  );
}

function SnapshotForm({
  character,
  period,
  snapshot,
  onCancel,
  onSubmit
}: {
  character: CharacterRecord;
  period: PeriodRecord | null;
  snapshot?: SnapshotRecord;
  onCancel: () => void;
  onSubmit: (
    period: PeriodRecord,
    input: { balances: { adena: number; lCoin: number }; capturedAt: Date; comment?: string },
    snapshotId?: string
  ) => Promise<void>;
}) {
  const orderedSnapshots = useMemo(() => (period ? sortSnapshots(period.snapshots) : []), [period]);
  const snapshotIndex = snapshot ? orderedSnapshots.findIndex((item) => item.id === snapshot.id) : -1;
  const previousSnapshot = snapshotIndex > 0 ? orderedSnapshots[snapshotIndex - 1] : null;
  const nextSnapshot = snapshotIndex >= 0 ? orderedSnapshots[snapshotIndex + 1] ?? null : null;
  const lastSnapshot = period ? getLastSnapshot(period.snapshots) : null;
  const comparisonSnapshot = snapshot ? previousSnapshot : lastSnapshot;
  const [adena, setAdena] = useState(amountToInputValue(snapshot?.balances.adena ?? character.currentBalances.adena));
  const [lCoin, setLCoin] = useState(amountToInputValue(snapshot?.balances.lCoin ?? character.currentBalances.lCoin));
  const [capturedAt, setCapturedAt] = useState(formatInputDateTime(snapshot?.capturedAt));
  const [comment, setComment] = useState(snapshot?.comment ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const draftSnapshot = useMemo<SnapshotRecord | null>(() => {
    if (!comparisonSnapshot) {
      return null;
    }

    try {
      return {
        id: snapshot?.id ?? "draft",
        kind: snapshot?.kind ?? "daily",
        balances: {
          adena: parseNonNegativeAmount(adena, "Текущая адена"),
          lCoin: parseNonNegativeAmount(lCoin, "Текущие L-монеты")
        },
        capturedAt: parseInputDateTime(capturedAt),
        comment,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } catch {
      return null;
    }
  }, [adena, capturedAt, comment, comparisonSnapshot, lCoin, snapshot]);
  const preview = comparisonSnapshot && draftSnapshot && period ? calculateInterval(comparisonSnapshot, draftSnapshot, period.operations) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (!period) {
        throw new Error("Нет текущей недели.");
      }

      const input = {
        balances: {
          adena: parseNonNegativeAmount(adena, "Текущая адена"),
          lCoin: parseNonNegativeAmount(lCoin, "Текущие L-монеты")
        },
        capturedAt: parseNotFuture(capturedAt),
        comment
      };

      if (snapshot && previousSnapshot && input.capturedAt.getTime() < previousSnapshot.capturedAt.getTime()) {
        throw new Error("Дата остатка не может быть раньше предыдущего.");
      }

      if (snapshot && nextSnapshot && input.capturedAt.getTime() > nextSnapshot.capturedAt.getTime()) {
        throw new Error("Дата остатка не может быть позже следующего.");
      }

      if (!snapshot && lastSnapshot && input.capturedAt.getTime() < lastSnapshot.capturedAt.getTime()) {
        throw new Error("Новый остаток не может быть раньше предыдущего.");
      }

      setSaving(true);
      await onSubmit(period, input, snapshot?.id);
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ModalHead title={`${snapshot ? "Редактировать остаток" : "Ввести текущий остаток"} · ${character.nickname}`} onCancel={onCancel} />
      {comparisonSnapshot ? (
        <div className="steps">
          Предыдущий остаток: <b>{formatDateTime(comparisonSnapshot.capturedAt)}</b>, адена <b>{formatInteger(comparisonSnapshot.balances.adena)}</b>, L-монеты{" "}
          <b>{formatInteger(comparisonSnapshot.balances.lCoin)}</b>.
        </div>
      ) : null}
      {snapshot && nextSnapshot ? (
        <div className="steps">
          Следующий остаток: <b>{formatDateTime(nextSnapshot.capturedAt)}</b>. Дату исправляемого остатка нужно оставить раньше него.
        </div>
      ) : null}
      <div className="row">
        <div className="field">
          <label htmlFor="snapshot-adena">Текущая адена</label>
          <AmountInput id="snapshot-adena" value={adena} onChange={setAdena} />
        </div>
        <div className="field">
          <label htmlFor="snapshot-lcoin">Текущие L-монеты</label>
          <AmountInput id="snapshot-lcoin" value={lCoin} onChange={setLCoin} />
        </div>
        <div className="field">
          <label htmlFor="snapshot-date">Дата и время</label>
          <input id="snapshot-date" type="datetime-local" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="snapshot-comment">Комментарий</label>
        <textarea id="snapshot-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
      </div>
      {preview ? (
        <div className="preview-block">
          <div className="title">Предварительный расчёт интервала</div>
          <p>{summarizeCurrency(preview.adena)}</p>
          <p>{summarizeCurrency(preview.lCoin)}</p>
        </div>
      ) : null}
      <div className="err">{error}</div>
      <FormActions onCancel={onCancel} saving={saving} submitLabel="Сохранить остаток" />
    </form>
  );
}

function InlineOperationForm({
  period,
  type,
  onCancel,
  onSubmit
}: {
  period: PeriodRecord | null;
  type: OperationType;
  onCancel: () => void;
  onSubmit: (period: PeriodRecord, input: OperationFormInput) => Promise<void>;
}) {
  const categories = type === "expense" ? expenseCategories : specialIncomeCategories;
  const lastSnapshot = period ? getLastSnapshot(period.snapshots) : null;
  const [currency, setCurrency] = useState<OperationCurrency>("adena");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [occurredAt, setOccurredAt] = useState(formatInputDateTime());
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const occurredDate = parseInputDateTime(occurredAt);
  const isAfterLastSnapshot = lastSnapshot ? occurredDate.getTime() > lastSnapshot.capturedAt.getTime() : false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (!period) {
        throw new Error("Нет текущей недели.");
      }

      const input = {
        type,
        currency,
        amount: parsePositiveAmount(amount, "Сумма"),
        category,
        comment,
        occurredAt: parseNotFuture(occurredAt)
      };

      setSaving(true);
      await onSubmit(period, input);
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inline-operation-form" onSubmit={submit}>
      <div className="inline-operation-row">
        <div className="field compact-currency">
          <label htmlFor={`quick-operation-currency-${type}`}>Валюта</label>
          <select id={`quick-operation-currency-${type}`} value={currency} onChange={(event) => setCurrency(event.target.value as OperationCurrency)}>
            <option value="adena">Адена</option>
            <option value="l_coin">L-монеты</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`quick-operation-amount-${type}`}>Сумма</label>
          <AmountInput id={`quick-operation-amount-${type}`} value={amount} onChange={setAmount} />
        </div>
        <div className="field compact-category">
          <label htmlFor={`quick-operation-category-${type}`}>Категория</label>
          <select id={`quick-operation-category-${type}`} value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`quick-operation-date-${type}`}>Дата и время</label>
          <input id={`quick-operation-date-${type}`} type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
        </div>
        <div className="field compact-comment">
          <label htmlFor={`quick-operation-comment-${type}`}>Комментарий</label>
          <input id={`quick-operation-comment-${type}`} type="text" value={comment} onChange={(event) => setComment(event.target.value)} />
        </div>
        <div className="inline-form-actions">
          <button type="submit" disabled={saving}>
            <Save size={15} />
            {saving ? "Сохраняем..." : "Добавить"}
          </button>
          <IconButton title="Скрыть форму" onClick={onCancel}>
            <X size={16} />
          </IconButton>
        </div>
      </div>
      {type === "special_income" ? (
        <div className="steps">Поступление не меняет остаток само. Оно только отделяет крупный дроп/продажу от обычного фарма.</div>
      ) : null}
      {isAfterLastSnapshot ? (
        <div className="steps warn">Операция позже последнего остатка. Введите текущий остаток, чтобы она попала в расчёт.</div>
      ) : null}
      <div className="err">{error}</div>
    </form>
  );
}

function OperationForm({
  character,
  period,
  type,
  operation,
  onCancel,
  onSubmit
}: {
  character: CharacterRecord;
  period: PeriodRecord | null;
  type: OperationType;
  operation?: OperationRecord;
  onCancel: () => void;
  onSubmit: (period: PeriodRecord, input: OperationFormInput, operationId?: string) => Promise<void>;
}) {
  const categories = type === "expense" ? expenseCategories : specialIncomeCategories;
  const lastSnapshot = period ? getLastSnapshot(period.snapshots) : null;
  const [currency, setCurrency] = useState<OperationCurrency>(operation?.currency ?? "adena");
  const [amount, setAmount] = useState(operation ? String(operation.amount) : "");
  const [category, setCategory] = useState(operation?.category ?? categories[0]);
  const [occurredAt, setOccurredAt] = useState(formatInputDateTime(operation?.occurredAt));
  const [comment, setComment] = useState(operation?.comment ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const occurredDate = parseInputDateTime(occurredAt);
  const isAfterLastSnapshot = lastSnapshot ? occurredDate.getTime() > lastSnapshot.capturedAt.getTime() : false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (!period) {
        throw new Error("Нет текущей недели.");
      }

      const input = {
        type,
        currency,
        amount: parsePositiveAmount(amount, "Сумма"),
        category,
        comment,
        occurredAt: parseNotFuture(occurredAt)
      };

      setSaving(true);
      await onSubmit(period, input, operation?.id);
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ModalHead
        title={`${operation ? "Редактировать" : "Добавить"} ${type === "expense" ? "расход" : "крупное поступление"} · ${character.nickname}`}
        onCancel={onCancel}
      />
      <div className="row">
        <div className="field">
          <label htmlFor="operation-currency">Валюта</label>
          <select id="operation-currency" value={currency} onChange={(event) => setCurrency(event.target.value as OperationCurrency)}>
            <option value="adena">Адена</option>
            <option value="l_coin">L-монеты</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="operation-amount">Сумма</label>
          <AmountInput id="operation-amount" value={amount} onChange={setAmount} />
        </div>
        <div className="field">
          <label htmlFor="operation-category">Категория</label>
          <select id="operation-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="operation-date">Дата и время</label>
          <input id="operation-date" type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="operation-comment">Комментарий</label>
        <textarea id="operation-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
      </div>
      {type === "special_income" ? (
        <div className="steps">
          Поступление не меняет остаток само. Оно только отделяет крупный дроп/продажу от обычного фарма.
        </div>
      ) : null}
      {isAfterLastSnapshot ? (
        <div className="steps warn">Операция позже последнего остатка. Введите текущий остаток, чтобы она попала в расчёт.</div>
      ) : null}
      <div className="err">{error}</div>
      <FormActions onCancel={onCancel} saving={saving} submitLabel={operation ? "Сохранить" : "Добавить"} />
    </form>
  );
}

function ClosePeriodForm({
  characters,
  selectedCurrency,
  onCancel,
  onSubmit
}: {
  characters: CharacterRecord[];
  selectedCurrency: Currency;
  onCancel: () => void;
  onSubmit: (items: ClosePeriodSubmitItem[]) => Promise<void>;
}) {
  const rows = useMemo(
    () =>
      characters
        .map((character) => ({ character, period: getOpenPeriod(character) }))
        .filter((item): item is { character: CharacterRecord; period: PeriodRecord } => Boolean(item.period)),
    [characters]
  );
  const [balances, setBalances] = useState<Record<string, { adena: string; lCoin: string }>>(() =>
    Object.fromEntries(
      rows.map(({ character }) => [
        character.id,
        {
          adena: amountToInputValue(character.currentBalances.adena),
          lCoin: amountToInputValue(character.currentBalances.lCoin)
        }
      ])
    )
  );
  const [capturedAt, setCapturedAt] = useState(formatInputDateTime());
  const [comment, setComment] = useState("Завершение недели");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const previewRows = useMemo(() => {
    const capturedDate = parseInputDateTime(capturedAt);

    return rows
      .map(({ character, period }) => {
        const balance = balances[character.id];

        if (!balance) {
          return null;
        }

        try {
          const closingSnapshot: SnapshotRecord = {
            id: "closing-preview",
            kind: "closing",
            balances: {
              adena: parseNonNegativeAmount(balance.adena, `${character.nickname}: адена`),
              lCoin: parseNonNegativeAmount(balance.lCoin, `${character.nickname}: L-монеты`)
            },
            capturedAt: capturedDate,
            comment,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          const summary = calculatePeriodSummary([...period.snapshots, closingSnapshot], period.operations);

          return { character, period, closingSnapshot, summary };
        } catch {
          return null;
        }
      })
      .filter((item): item is { character: CharacterRecord; period: PeriodRecord; closingSnapshot: SnapshotRecord; summary: PeriodSummary } =>
        Boolean(item)
      );
  }, [balances, capturedAt, comment, rows]);
  const aggregateSummary = previewRows.length > 0 ? sumCurrencySummaries(previewRows.map((row) => row.summary)) : null;
  const aggregateBalances = previewRows.reduce(
    (total, row) => ({
      adena: total.adena + row.closingSnapshot.balances.adena,
      lCoin: total.lCoin + row.closingSnapshot.balances.lCoin
    }),
    { adena: 0, lCoin: 0 }
  );

  function updateBalance(characterId: string, currency: Currency, value: string) {
    setBalances((current) => ({
      ...current,
      [characterId]: {
        adena: current[characterId]?.adena ?? "",
        lCoin: current[characterId]?.lCoin ?? "",
        [currency]: value
      }
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (rows.length === 0) {
        throw new Error("Нет выбранных персонажей с открытым периодом.");
      }

      const capturedDate = parseNotFuture(capturedAt);
      const items = rows.map(({ character, period }) => {
        const balance = balances[character.id];

        if (!balance) {
          throw new Error(`Не заполнены остатки для ${character.nickname}.`);
        }

        const input = {
          balances: {
            adena: parseNonNegativeAmount(balance.adena, `${character.nickname}: адена`),
            lCoin: parseNonNegativeAmount(balance.lCoin, `${character.nickname}: L-монеты`)
          },
          capturedAt: capturedDate,
          comment
        };
        const lastSnapshot = getLastSnapshot(period.snapshots);

        if (lastSnapshot && input.capturedAt.getTime() < lastSnapshot.capturedAt.getTime()) {
          throw new Error(`${character.nickname}: итоговый остаток не может быть раньше последнего остатка.`);
        }

        return { character, period, input };
      });

      setSaving(true);
      await onSubmit(items);
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ModalHead title="Закрыть период" onCancel={onCancel} />
      <div className="row">
        <div className="field">
          <label htmlFor="close-date">Дата и время</label>
          <input id="close-date" type="datetime-local" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="close-comment">Комментарий</label>
        <textarea id="close-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
      </div>

      {rows.length === 0 ? (
        <EmptyState text="У выбранных персонажей нет открытого периода для закрытия." />
      ) : (
        <div className="table-wrap close-period-table">
          <table>
            <thead>
              <tr>
                <th>Ник</th>
                <th className="right">Адена</th>
                <th className="right">L-монеты</th>
                <th className="right">Заработано</th>
                <th className="right">Поступления</th>
                <th className="right">Расходы</th>
                <th className="right">Результат</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ character }) => {
                const preview = previewRows.find((row) => row.character.id === character.id);
                const summary = preview?.summary[selectedCurrency];

                return (
                  <tr key={character.id}>
                    <td>
                      <b>{character.nickname}</b>
                      {character.server ? <div className="small">{character.server}</div> : null}
                    </td>
                    <td className="num-cell">
                      <AmountInput
                        id={`close-adena-${character.id}`}
                        value={balances[character.id]?.adena ?? ""}
                        onChange={(value) => updateBalance(character.id, "adena", value)}
                      />
                    </td>
                    <td className="num-cell">
                      <AmountInput
                        id={`close-lcoin-${character.id}`}
                        value={balances[character.id]?.lCoin ?? ""}
                        onChange={(value) => updateBalance(character.id, "lCoin", value)}
                      />
                    </td>
                    <td className="num-cell money-income">{summary ? formatInteger(summary.grossEarned) : "—"}</td>
                    <td className="num-cell money-income">{summary ? formatInteger(summary.specialIncome) : "—"}</td>
                    <td className="num-cell money-expense">{summary ? formatInteger(summary.expenses) : "—"}</td>
                    <td className={`num-cell ${summary ? resultClassName(summary.netResult) : "neutral"}`}>
                      {summary ? formatSignedInteger(summary.netResult) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {aggregateSummary ? (
        <div className="preview-block">
          <div className="title">Общий итог перед закрытием</div>
          <SummaryStats balances={aggregateBalances} summary={aggregateSummary} selectedCurrency={selectedCurrency} includeAverage />
          <p>{summarizeCurrency(aggregateSummary[selectedCurrency])}</p>
          <p className="small">
            Выбрано персонажей: {previewRows.length}; учтено дней суммарно: {aggregateSummary.accountedDays}.
          </p>
        </div>
      ) : null}
      <div className="err">{error}</div>
      <FormActions onCancel={onCancel} saving={saving} submitLabel="Закрыть выбранные" />
    </form>
  );
}

function PeriodDetail({
  character,
  period,
  selectedCurrency,
  onClose,
  onReopen
}: {
  character: CharacterRecord;
  period: PeriodRecord;
  selectedCurrency: Currency;
  onClose: () => void;
  onReopen: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const summary = period.summary ?? calculatePeriodSummary(period.snapshots, period.operations);
  const intervals = [...buildIntervals(period.snapshots, period.operations, "closed")].reverse();

  async function reopen() {
    if (!window.confirm("Открыть последнюю завершённую неделю для исправления? Следующая пустая неделя будет удалена.")) {
      return;
    }

    setError("");
    setSaving(true);

    try {
      await onReopen();
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <ModalHead title={`${character.nickname} · неделя ${formatYmdRange(period.plannedStartDate, period.plannedEndDate)}`} onCancel={onClose} />
      <SummaryStats balances={{ adena: summary.adena.closingBalance, lCoin: summary.lCoin.closingBalance }} summary={summary} selectedCurrency={selectedCurrency} includeAverage />
      <p className="subtitle">{summarizeCurrency(summary[selectedCurrency])}</p>
      <IntervalsTable intervals={intervals} selectedCurrency={selectedCurrency} />
      <div className="form-actions">
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
        <button className="secondary" type="button" onClick={reopen} disabled={saving}>
          <Undo2 size={15} />
          Открыть неделю для исправления
        </button>
      </div>
      <div className="err">{error}</div>
    </div>
  );
}

function SummaryStats({
  balances,
  summary,
  selectedCurrency,
  includeAverage = false
}: {
  balances: Record<Currency, number>;
  summary: PeriodSummary;
  selectedCurrency: Currency;
  includeAverage?: boolean;
}) {
  const currencySummary = summary[selectedCurrency];
  const average = summary.accountedDays ? Math.round(currencySummary.netResult / summary.accountedDays) : 0;

  return (
    <div className="stat-row">
      <Stat label="Текущий остаток" value={formatCompact(balances[selectedCurrency])} title={formatInteger(balances[selectedCurrency])} />
      <Stat label="Общий заработок" value={formatCompact(currencySummary.grossEarned)} title={formatInteger(currencySummary.grossEarned)} />
      <Stat label="Обычный фарм" value={formatCompact(currencySummary.regularFarm)} title={formatInteger(currencySummary.regularFarm)} />
      <Stat label="Крупные поступления" value={formatCompact(currencySummary.specialIncome)} title={formatInteger(currencySummary.specialIncome)} />
      <Stat label="Расходы" value={formatCompact(currencySummary.expenses)} title={formatInteger(currencySummary.expenses)} />
      <Stat
        label="Чистый результат"
        value={formatSignedInteger(currencySummary.netResult)}
        title={formatInteger(currencySummary.netResult)}
        tone={resultClassName(currencySummary.netResult)}
      />
      {includeAverage ? (
        <>
          <Stat label="Учтено дней" value={String(summary.accountedDays)} />
          <Stat label="Среднее в день" value={formatSignedInteger(average)} tone={resultClassName(average)} />
        </>
      ) : null}
    </div>
  );
}

function IntervalsTable({
  intervals,
  selectedCurrency,
  onEditSnapshot
}: {
  intervals: ReturnType<typeof buildIntervals>;
  selectedCurrency: Currency;
  onEditSnapshot?: (snapshot: SnapshotRecord) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Промежуток</th>
            <th className="right">Было</th>
            <th className="right">Расходы</th>
            <th className="right">Крупные поступления</th>
            <th className="right">Стало</th>
            <th className="right">Заработано</th>
            <th className="right">Обычный фарм</th>
            <th className="right">Результат</th>
            <th>Статус</th>
            {onEditSnapshot ? <th>Действия</th> : null}
          </tr>
        </thead>
        <tbody>
          {intervals.map((interval) => {
            const summary = interval.summary[selectedCurrency];

            return (
              <tr key={interval.id}>
                <td>
                  <span className="date-cell">{formatIntervalLabel(interval.startSnapshot.capturedAt, interval.endSnapshot.capturedAt)}</span>
                  {interval.missingDays > 0 ? (
                    <div className="small">Нет отдельного остатка за {interval.missingDays} дн.; промежуток объединён.</div>
                  ) : null}
                </td>
                <td className="num-cell">{formatInteger(summary.openingBalance)}</td>
                <td className="num-cell money-expense">{formatInteger(summary.expenses)}</td>
                <td className="num-cell money-income">{formatInteger(summary.specialIncome)}</td>
                <td className="num-cell">{formatInteger(summary.closingBalance)}</td>
                <td className="num-cell money-income">{formatInteger(summary.grossEarned)}</td>
                <td className="num-cell money-income">{formatInteger(summary.regularFarm)}</td>
                <td className={`num-cell ${resultClassName(summary.netResult)}`}>{formatSignedInteger(summary.netResult)}</td>
                <td>
                  <span className={interval.status === "closed" ? "pill green" : "pill amber"}>
                    {interval.status === "closed" ? "Завершено" : "Текущая"}
                  </span>
                </td>
                {onEditSnapshot ? (
                  <td className="actions-cell">
                    <IconButton title="Редактировать остаток" onClick={() => onEditSnapshot(interval.endSnapshot)}>
                      <Pencil size={15} />
                    </IconButton>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CurrencyTabs({
  value,
  onChange,
  compact = false
}: {
  value: Currency;
  onChange: (currency: Currency) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "chips compact-chips" : "chips"} role="group" aria-label="Валюта">
      {currencies.map((currency) => (
        <button
          key={currency}
          className={value === currency ? "chip on" : "chip"}
          type="button"
          onClick={() => onChange(currency)}
        >
          {currencyLabels[currency]}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, title, tone = "neutral" }: { label: string; value: string; title?: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className="stat" title={title}>
      <div className={`num ${tone}`}>{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function SortableTh({
  children,
  active,
  direction,
  alignRight = false,
  onClick
}: {
  children: ReactNode;
  active: boolean;
  direction: SortDirection;
  alignRight?: boolean;
  onClick: () => void;
}) {
  return (
    <th className={`${alignRight ? "right " : ""}sortable${active ? " active" : ""}`} onClick={onClick}>
      {children}
      {active ? (direction === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}

function EmptyState({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty-state">
      <p>{text}</p>
      {action && onAction ? (
        <button type="button" onClick={onAction}>
          <Plus size={15} />
          {action}
        </button>
      ) : null}
    </div>
  );
}

function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="gate">
      <h2>{title}</h2>
      {children}
    </main>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </section>
    </div>
  );
}

function ModalHead({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="modal-head">
      <h2>{title}</h2>
      <IconButton title="Закрыть" onClick={onCancel}>
        <X size={16} />
      </IconButton>
    </div>
  );
}

function FormActions({ onCancel, saving, submitLabel }: { onCancel: () => void; saving: boolean; submitLabel: string }) {
  return (
    <div className="form-actions">
      <button className="ghost" type="button" onClick={onCancel} disabled={saving}>
        Отмена
      </button>
      <button type="submit" disabled={saving}>
        <Save size={15} />
        {saving ? "Сохраняем..." : submitLabel}
      </button>
    </div>
  );
}

function AmountInput({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      id={id}
      className="amount-input"
      inputMode="numeric"
      type="text"
      autoComplete="off"
      placeholder="0"
      value={formatAmountInput(value)}
      onChange={(event) => onChange(normalizeAmountInput(event.target.value))}
    />
  );
}

function IconButton({
  title,
  children,
  tone = "neutral",
  onClick
}: {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "danger";
  onClick: () => void;
}) {
  return (
    <button className={tone === "danger" ? "icon-btn danger-icon" : "icon-btn"} type="button" title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}

function formatPendingOperationsNote(period: PeriodRecord, selectedCurrency: Currency): string {
  const lastSnapshot = getLastSnapshot(period.snapshots);
  const lastSnapshotTime = lastSnapshot?.capturedAt.getTime() ?? Number.NEGATIVE_INFINITY;
  const operationCurrency = selectedCurrency === "lCoin" ? "l_coin" : "adena";
  const operationsAfterLastBalance = period.operations.filter((operation) => operation.occurredAt.getTime() > lastSnapshotTime);
  const selectedCurrencyOperations = operationsAfterLastBalance.filter((operation) => operation.currency === operationCurrency);
  const expenses = selectedCurrencyOperations
    .filter((operation) => operation.type === "expense")
    .reduce((sum, operation) => sum + operation.amount, 0);
  const income = selectedCurrencyOperations
    .filter((operation) => operation.type === "special_income")
    .reduce((sum, operation) => sum + operation.amount, 0);
  const parts = [];

  if (expenses > 0) {
    parts.push(`расходы ${formatInteger(expenses)}`);
  }

  if (income > 0) {
    parts.push(`поступления ${formatInteger(income)}`);
  }

  if (parts.length === 0 && operationsAfterLastBalance.length > 0) {
    return "После последнего остатка есть операции в другой валюте. Переключите валюту или введите текущий остаток, чтобы обновить расчёт.";
  }

  if (parts.length === 0) {
    return "";
  }

  return `После последнего остатка: ${parts.join(", ")}. Введите текущий остаток, чтобы обновить расчёт.`;
}

function parseNonNegativeAmount(value: string, label: string): number {
  const normalized = normalizeAmountInput(value);
  const parsed = normalized === "" ? 0 : Number(normalized);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label}: нужно неотрицательное целое число.`);
  }

  return parsed;
}

function parsePositiveAmount(value: string, label: string): number {
  const normalized = normalizeAmountInput(value);
  const parsed = normalized === "" ? Number.NaN : Number(normalized);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label}: нужно целое число больше нуля.`);
  }

  return parsed;
}

function amountToInputValue(value: number): string {
  return value > 0 ? String(value) : "";
}

function normalizeAmountInput(value: string): string {
  const digitsOnly = value.replace(/\D/g, "");
  return digitsOnly.replace(/^0+(?=\d)/, "");
}

function formatAmountInput(value: string): string {
  const normalized = normalizeAmountInput(value);
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function getPeriodActualRange(period: PeriodRecord): { start: Date; end: Date } {
  const snapshots = sortSnapshots(period.snapshots);
  return {
    start: snapshots[0]?.capturedAt ?? period.openedAt,
    end: snapshots[snapshots.length - 1]?.capturedAt ?? period.closedAt ?? period.openedAt
  };
}

function getHistoryPeriodGroupId(start: Date, end: Date, accountedDays: number): string {
  if (accountedDays <= 1) {
    return `${getLocalDateKey(start)}_1`;
  }

  return `${getLocalDateKey(start)}_${getLocalDateKey(end)}_${accountedDays}`;
}

function formatHistoryPeriodLabel(start: Date, end: Date, accountedDays: number): string {
  if (accountedDays <= 1) {
    return formatDateTime(start);
  }

  return formatIntervalLabel(start, end);
}

function formatDaysLabel(days: number): string {
  const absDays = Math.abs(days);
  const lastDigit = absDays % 10;
  const lastTwoDigits = absDays % 100;

  if (lastDigit === 1 && lastTwoDigits !== 11) {
    return `${days} день`;
  }

  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return `${days} дня`;
  }

  return `${days} дней`;
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getPeriodSortTime(period: PeriodRecord): number {
  return (period.closedAt ?? period.openedAt).getTime();
}

function parseNotFuture(value: string): Date {
  const date = parseInputDateTime(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Некорректная дата.");
  }

  if (date.getTime() > Date.now() + 5 * 60_000) {
    throw new Error("Дата не может быть в будущем.");
  }

  return date;
}

function applyTheme(theme: ThemePreference) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem("theme", theme);
  const resolved = theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : theme;
  document.documentElement.dataset.theme = resolved;
}
