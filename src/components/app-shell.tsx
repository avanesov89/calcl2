"use client";

import {
  Archive,
  Coins,
  DoorOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { User, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  buildIntervals,
  calculateInterval,
  calculatePeriodSummary,
  getLastSnapshot,
  hasOperationsAfterLastSnapshot,
  sortOperations
} from "@/lib/calculations";
import { auth, hasFirebaseConfig, requireFirebase } from "@/lib/firebase";
import { translateFirebaseError } from "@/lib/firebase-errors";
import {
  addSnapshot,
  closePeriod,
  createCharacter,
  deleteCharacterTree,
  deleteOperation,
  ensureUserProfile,
  getOpenPeriod,
  reopenLastClosedPeriod,
  saveOperation,
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
  | { type: "snapshot"; character: CharacterRecord }
  | { type: "expense"; character: CharacterRecord; operation?: OperationRecord }
  | { type: "special_income"; character: CharacterRecord; operation?: OperationRecord }
  | { type: "close"; character: CharacterRecord }
  | { type: "period"; character: CharacterRecord; period: PeriodRecord }
  | null;

const expenseCategories = ["руда", "заряды души", "банки/расходники", "телепорты", "экипировка", "комиссия", "другое"];
const specialIncomeCategories = ["продажа крупного дропа", "продажа предмета", "награда", "другое"];

export default function AppShell() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!hasFirebaseConfig || !auth);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [profileTheme, setProfileTheme] = useState<ThemePreference>("system");
  const [timezone, setTimezone] = useState("UTC");
  const [loadingData, setLoadingData] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<MainTab>("overview");
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
    () => characters.find((character) => character.id === selectedCharacterId) ?? activeCharacters[0] ?? characters[0] ?? null,
    [activeCharacters, characters, selectedCharacterId]
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
        <button className={tab === "overview" ? "tab-btn active" : "tab-btn"} type="button" onClick={() => setTab("overview")}>
          Обзор
        </button>
        <button className={tab === "characters" ? "tab-btn active" : "tab-btn"} type="button" onClick={() => setTab("characters")}>
          Персонажи
        </button>
        <button className={tab === "history" ? "tab-btn active" : "tab-btn"} type="button" onClick={() => setTab("history")}>
          История
        </button>
      </nav>

      {globalError ? <div className="err card">{globalError}</div> : null}
      {notice ? <div className="ok notice">{notice}</div> : null}
      {loadingData ? <div className="small">Загружаем данные...</div> : null}

      {tab === "overview" ? (
        <Overview
          characters={activeCharacters}
          selectedCurrency={selectedCurrency}
          setSelectedCurrency={setSelectedCurrency}
          setModal={setModal}
          timezone={timezone}
          onOpenCharacter={(character) => {
            setSelectedCharacterId(character.id);
            setTab("characters");
          }}
        />
      ) : null}

      {tab === "characters" ? (
        <CharactersScreen
          characters={characters}
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
            if (!window.confirm(`Удалить ${character.nickname} вместе со всеми периодами, замерами и операциями?`)) {
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
                  const id = await createCharacter(currentUser.uid, input);
                  setSelectedCharacterId(id);
                  await reloadWithNotice("Персонаж добавлен.");
                }

                setModal(null);
              }}
            />
          ) : null}

          {modal.type === "snapshot" ? (
            <SnapshotForm
              character={modal.character}
              period={getOpenPeriod(modal.character)}
              onCancel={() => setModal(null)}
              onSubmit={async (period, input) => {
                await addSnapshot(currentUser.uid, modal.character, period, input);
                await reloadWithNotice("Остаток сохранён.");
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
              character={modal.character}
              period={getOpenPeriod(modal.character)}
              selectedCurrency={selectedCurrency}
              onCancel={() => setModal(null)}
              onSubmit={async (period, input) => {
                await closePeriod(currentUser.uid, modal.character, period, input);
                await reloadWithNotice("Период закрыт, следующий открыт автоматически.");
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
                await reloadWithNotice("Период открыт для исправления.");
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

function Overview({
  characters,
  selectedCurrency,
  setSelectedCurrency,
  setModal,
  timezone,
  onOpenCharacter
}: {
  characters: CharacterRecord[];
  selectedCurrency: Currency;
  setSelectedCurrency: (currency: Currency) => void;
  setModal: (modal: ModalState) => void;
  timezone: string;
  onOpenCharacter: (character: CharacterRecord) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("nickname");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const totals = useMemo(() => calculateDashboardTotals(characters), [characters]);
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

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Общий обзор</h2>
            <p className="subtitle">Активные персонажи, текущие открытые периоды.</p>
          </div>
          <button type="button" onClick={() => setModal({ type: "character" })}>
            <Plus size={15} />
            Добавить персонажа
          </button>
        </div>
        <CurrencyTabs value={selectedCurrency} onChange={setSelectedCurrency} />
        <SummaryStats balances={totals.balances} summary={totals.summary} selectedCurrency={selectedCurrency} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Персонажи</h2>
          <span className="small">Валюта таблицы: {currencyLabels[selectedCurrency]}</span>
        </div>
        {characters.length === 0 ? (
          <EmptyState
            text="Добавьте первого персонажа и укажите его текущие остатки, чтобы начать учёт."
            action="Добавить персонажа"
            onAction={() => setModal({ type: "character" })}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
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
                    Последний замер
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
                      <td className="num-cell">{summary ? formatInteger(summary[selectedCurrency].expenses) : "—"}</td>
                      <td className="num-cell">{summary ? formatInteger(summary[selectedCurrency].specialIncome) : "—"}</td>
                      <td>
                        <span className={hasUncounted ? "pill amber" : "date-cell"}>{formatDateTime(character.lastSnapshotAt)}</span>
                        {hasUncounted ? <div className="small">Есть неучтённые операции</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function CharactersScreen({
  characters,
  selectedCharacter,
  selectedCurrency,
  setSelectedCurrency,
  setModal,
  timezone,
  onArchive,
  onDelete,
  onDeleteOperation
}: {
  characters: CharacterRecord[];
  selectedCharacter: CharacterRecord | null;
  selectedCurrency: Currency;
  setSelectedCurrency: (currency: Currency) => void;
  setModal: (modal: ModalState) => void;
  timezone: string;
  onArchive: (character: CharacterRecord) => Promise<void>;
  onDelete: (character: CharacterRecord) => Promise<void>;
  onDeleteOperation: (character: CharacterRecord, period: PeriodRecord, operation: OperationRecord) => Promise<void>;
}) {
  if (characters.length === 0) {
    return (
      <section className="card">
        <EmptyState
          text="Добавьте первого персонажа и укажите его текущие остатки, чтобы начать учёт."
          action="Добавить персонажа"
          onAction={() => setModal({ type: "character" })}
        />
      </section>
    );
  }

  return (
    <>
      {selectedCharacter ? (
        <CharacterDetail
          character={selectedCharacter}
          selectedCurrency={selectedCurrency}
          setSelectedCurrency={setSelectedCurrency}
          setModal={setModal}
          timezone={timezone}
          onArchive={onArchive}
          onDelete={onDelete}
          onDeleteOperation={onDeleteOperation}
        />
      ) : null}
    </>
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
  onDeleteOperation
}: {
  character: CharacterRecord;
  selectedCurrency: Currency;
  setSelectedCurrency: (currency: Currency) => void;
  setModal: (modal: ModalState) => void;
  timezone: string;
  onArchive: (character: CharacterRecord) => Promise<void>;
  onDelete: (character: CharacterRecord) => Promise<void>;
  onDeleteOperation: (character: CharacterRecord, period: PeriodRecord, operation: OperationRecord) => Promise<void>;
}) {
  const [operationTypeFilter, setOperationTypeFilter] = useState<"all" | OperationType>("all");
  const [operationCurrencyFilter, setOperationCurrencyFilter] = useState<"all" | OperationCurrency>("all");
  const [isCharacterMenuOpen, setIsCharacterMenuOpen] = useState(false);
  const period = getOpenPeriod(character);
  const summary = period ? calculatePeriodSummary(period.snapshots, period.operations) : null;
  const intervals = period ? [...buildIntervals(period.snapshots, period.operations, "preliminary", timezone)].reverse() : [];
  const hasUncounted = period ? hasOperationsAfterLastSnapshot(period.snapshots, period.operations) : false;
  const lastSnapshot = period ? getLastSnapshot(period.snapshots) : null;
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
              {character.server ? `${character.server} · ` : ""}последний замер {formatDateTime(character.lastSnapshotAt)}
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
          <p className="subtitle">Нет открытого периода.</p>
        )}

        {hasUncounted ? (
          <div className="steps warn">
            После последнего замера есть новые операции. Обновите остаток, чтобы получить актуальный результат.
          </div>
        ) : null}

        <div className="button-row primary-actions">
          <button type="button" onClick={() => setModal({ type: "snapshot", character })} disabled={!period}>
            <RefreshCw size={15} />
            Обновить остаток
          </button>
          <button className="secondary" type="button" onClick={() => setModal({ type: "expense", character })} disabled={!period}>
            <Receipt size={15} />
            Добавить расход
          </button>
          <button className="secondary" type="button" onClick={() => setModal({ type: "special_income", character })} disabled={!period}>
            <Coins size={15} />
            Добавить поступление
          </button>
          <button className="secondary" type="button" onClick={() => setModal({ type: "close", character })} disabled={!period}>
            <Save size={15} />
            Закрыть период
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Суточные результаты</h2>
          {lastSnapshot ? <span className="small">Последний замер: {formatDateTime(lastSnapshot.capturedAt)}</span> : null}
        </div>
        {!period || intervals.length === 0 ? (
          <EmptyState
            text="Сегодняшний результат появится после фиксации текущего остатка."
            action="Обновить остаток"
            onAction={() => setModal({ type: "snapshot", character })}
          />
        ) : (
          <IntervalsTable intervals={intervals} selectedCurrency={selectedCurrency} />
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Операции периода</h2>
          <span className="small">{period ? formatYmdRange(period.plannedStartDate, period.plannedEndDate) : "Нет периода"}</span>
        </div>
        <div className="row">
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
        {!period || operations.length === 0 ? (
          <p className="subtitle">В этом периоде пока нет расходов и крупных поступлений.</p>
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
                    <td className="num-cell">{formatInteger(operation.amount)}</td>
                    <td>{operation.comment || "—"}</td>
                    <td className="actions-cell">
                      <IconButton title="Редактировать" onClick={() => setModal({ type: operation.type, character, operation })}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton title="Удалить" onClick={() => onDeleteOperation(character, period, operation)}>
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
  const filteredCharacters = characterFilter === "all" ? characters : characters.filter((character) => character.id === characterFilter);
  const periods = filteredCharacters
    .flatMap((character) =>
      character.periods
        .filter((period) => period.status === "closed")
        .map((period) => ({ character, period, summary: period.summary ?? calculatePeriodSummary(period.snapshots, period.operations) }))
    )
    .sort((left, right) => getPeriodSortTime(right.period) - getPeriodSortTime(left.period));

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>История периодов</h2>
          <p className="subtitle">Закрытые недели с детализацией по персонажам.</p>
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
      {periods.length === 0 ? (
        <p className="subtitle">История появится после закрытия первой недели.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Персонаж</th>
                <th>Даты</th>
                <th className="right">Дней</th>
                <th className="right">Было</th>
                <th className="right">Стало</th>
                <th className="right">Заработано</th>
                <th className="right">Крупные</th>
                <th className="right">Обычный фарм</th>
                <th className="right">Расходы</th>
                <th className="right">Результат</th>
                <th>Детали</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(({ character, period, summary }) => {
                const currencySummary = summary[selectedCurrency];
                const average = summary.accountedDays ? Math.round(currencySummary.netResult / summary.accountedDays) : 0;

                return (
                  <tr key={`${character.id}-${period.id}`}>
                    <td>{character.nickname}</td>
                    <td>
                      {formatYmdRange(period.plannedStartDate, period.plannedEndDate)}
                      {period.closedAt ? <div className="small">Закрыт {formatDateTime(period.closedAt)}</div> : null}
                    </td>
                    <td className="num-cell">{summary.accountedDays}</td>
                    <td className="num-cell">{formatInteger(currencySummary.openingBalance)}</td>
                    <td className="num-cell">{formatInteger(currencySummary.closingBalance)}</td>
                    <td className="num-cell">{formatInteger(currencySummary.grossEarned)}</td>
                    <td className="num-cell">{formatInteger(currencySummary.specialIncome)}</td>
                    <td className="num-cell">{formatInteger(currencySummary.regularFarm)}</td>
                    <td className="num-cell">{formatInteger(currencySummary.expenses)}</td>
                    <td className={`num-cell ${resultClassName(currencySummary.netResult)}`}>
                      {formatSignedInteger(currencySummary.netResult)}
                      <div className="small">ср. {formatSignedInteger(average)}/день</div>
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
      )}
    </section>
  );
}

function CharacterForm({
  character,
  onCancel,
  onSubmit
}: {
  character?: CharacterRecord;
  onCancel: () => void;
  onSubmit: (input: {
    nickname: string;
    server?: string;
    initialBalances: { adena: number; lCoin: number };
    capturedAt: Date;
  }) => Promise<void>;
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
              <label htmlFor="character-captured-at">Дата и время замера</label>
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
  onCancel,
  onSubmit
}: {
  character: CharacterRecord;
  period: PeriodRecord | null;
  onCancel: () => void;
  onSubmit: (period: PeriodRecord, input: { balances: { adena: number; lCoin: number }; capturedAt: Date; comment?: string }) => Promise<void>;
}) {
  const lastSnapshot = period ? getLastSnapshot(period.snapshots) : null;
  const [adena, setAdena] = useState(amountToInputValue(character.currentBalances.adena));
  const [lCoin, setLCoin] = useState(amountToInputValue(character.currentBalances.lCoin));
  const [capturedAt, setCapturedAt] = useState(formatInputDateTime());
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const draftSnapshot = useMemo<SnapshotRecord | null>(() => {
    if (!lastSnapshot) {
      return null;
    }

    try {
      return {
        id: "draft",
        kind: "daily",
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
  }, [adena, capturedAt, comment, lCoin, lastSnapshot]);
  const preview = lastSnapshot && draftSnapshot && period ? calculateInterval(lastSnapshot, draftSnapshot, period.operations) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (!period) {
        throw new Error("Нет открытого периода.");
      }

      const input = {
        balances: {
          adena: parseNonNegativeAmount(adena, "Текущая адена"),
          lCoin: parseNonNegativeAmount(lCoin, "Текущие L-монеты")
        },
        capturedAt: parseNotFuture(capturedAt),
        comment
      };

      if (lastSnapshot && input.capturedAt.getTime() < lastSnapshot.capturedAt.getTime()) {
        throw new Error("Новый замер не может быть раньше предыдущего.");
      }

      setSaving(true);
      await onSubmit(period, input);
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ModalHead title={`Обновить остаток · ${character.nickname}`} onCancel={onCancel} />
      {lastSnapshot ? (
        <div className="steps">
          Предыдущий замер: <b>{formatDateTime(lastSnapshot.capturedAt)}</b>, адена <b>{formatInteger(lastSnapshot.balances.adena)}</b>, L-монеты{" "}
          <b>{formatInteger(lastSnapshot.balances.lCoin)}</b>.
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
      <FormActions onCancel={onCancel} saving={saving} submitLabel="Сохранить замер" />
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
  onSubmit: (period: PeriodRecord, input: {
    type: OperationType;
    currency: OperationCurrency;
    amount: number;
    category: string;
    comment?: string;
    occurredAt: Date;
  }, operationId?: string) => Promise<void>;
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
        throw new Error("Нет открытого периода.");
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
          Поступление уже должно входить в фактический остаток. Эта запись только выделит его из обычного фарма.
        </div>
      ) : null}
      {isAfterLastSnapshot ? (
        <div className="steps warn">Операция позже последнего замера. Она попадёт в расчёт после обновления остатка.</div>
      ) : null}
      <div className="err">{error}</div>
      <FormActions onCancel={onCancel} saving={saving} submitLabel={operation ? "Сохранить" : "Добавить"} />
    </form>
  );
}

function ClosePeriodForm({
  character,
  period,
  selectedCurrency,
  onCancel,
  onSubmit
}: {
  character: CharacterRecord;
  period: PeriodRecord | null;
  selectedCurrency: Currency;
  onCancel: () => void;
  onSubmit: (period: PeriodRecord, input: { balances: { adena: number; lCoin: number }; capturedAt: Date; comment?: string }) => Promise<void>;
}) {
  const [adena, setAdena] = useState(amountToInputValue(character.currentBalances.adena));
  const [lCoin, setLCoin] = useState(amountToInputValue(character.currentBalances.lCoin));
  const [capturedAt, setCapturedAt] = useState(formatInputDateTime());
  const [comment, setComment] = useState("Закрытие периода");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lastSnapshot = period ? getLastSnapshot(period.snapshots) : null;
  const closingSnapshot = useMemo<SnapshotRecord | null>(() => {
    if (!period) {
      return null;
    }

    try {
      return {
        id: "closing-preview",
        kind: "closing",
        balances: {
          adena: parseNonNegativeAmount(adena, "Адена"),
          lCoin: parseNonNegativeAmount(lCoin, "L-монеты")
        },
        capturedAt: parseInputDateTime(capturedAt),
        comment,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } catch {
      return null;
    }
  }, [adena, capturedAt, comment, lCoin, period]);
  const preview = period && closingSnapshot ? calculatePeriodSummary([...period.snapshots, closingSnapshot], period.operations) : null;
  const durationWarning = preview && Math.abs(preview.actualDurationHours - 168) > 24;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (!period) {
        throw new Error("Нет открытого периода.");
      }

      const input = {
        balances: {
          adena: parseNonNegativeAmount(adena, "Адена"),
          lCoin: parseNonNegativeAmount(lCoin, "L-монеты")
        },
        capturedAt: parseNotFuture(capturedAt),
        comment
      };

      if (lastSnapshot && input.capturedAt.getTime() < lastSnapshot.capturedAt.getTime()) {
        throw new Error("Закрывающий замер не может быть раньше последнего замера.");
      }

      setSaving(true);
      await onSubmit(period, input);
    } catch (caught) {
      setError(translateFirebaseError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <ModalHead title={`Закрыть период · ${character.nickname}`} onCancel={onCancel} />
      <div className="row">
        <div className="field">
          <label htmlFor="close-adena">Остаток адены</label>
          <AmountInput id="close-adena" value={adena} onChange={setAdena} />
        </div>
        <div className="field">
          <label htmlFor="close-lcoin">Остаток L-монет</label>
          <AmountInput id="close-lcoin" value={lCoin} onChange={setLCoin} />
        </div>
        <div className="field">
          <label htmlFor="close-date">Дата и время</label>
          <input id="close-date" type="datetime-local" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="close-comment">Комментарий</label>
        <textarea id="close-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
      </div>
      {preview ? (
        <div className="preview-block">
          <div className="title">Итог перед закрытием</div>
          <p>{summarizeCurrency(preview[selectedCurrency])}</p>
          <p className="small">
            Учтено дней: {preview.accountedDays}; средний результат:{" "}
            {formatSignedInteger(preview.accountedDays ? Math.round(preview[selectedCurrency].netResult / preview.accountedDays) : 0)}
          </p>
          {durationWarning ? (
            <div className="steps warn">
              Период длился {preview.accountedDays} дн. Сравнивать его с обычной неделей следует с осторожностью.
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="err">{error}</div>
      <FormActions onCancel={onCancel} saving={saving} submitLabel="Закрыть период" />
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
    if (!window.confirm("Открыть последний закрытый период для исправления? Следующий пустой период будет удалён.")) {
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
      <ModalHead title={`${character.nickname} · период ${formatYmdRange(period.plannedStartDate, period.plannedEndDate)}`} onCancel={onClose} />
      <SummaryStats balances={{ adena: summary.adena.closingBalance, lCoin: summary.lCoin.closingBalance }} summary={summary} selectedCurrency={selectedCurrency} includeAverage />
      <p className="subtitle">{summarizeCurrency(summary[selectedCurrency])}</p>
      <IntervalsTable intervals={intervals} selectedCurrency={selectedCurrency} />
      <div className="form-actions">
        <button className="ghost" type="button" onClick={onClose}>
          Закрыть
        </button>
        <button className="secondary" type="button" onClick={reopen} disabled={saving}>
          <Undo2 size={15} />
          Открыть для исправления
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

function IntervalsTable({ intervals, selectedCurrency }: { intervals: ReturnType<typeof buildIntervals>; selectedCurrency: Currency }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>День/интервал</th>
            <th className="right">Было</th>
            <th className="right">Расходы</th>
            <th className="right">Крупные поступления</th>
            <th className="right">Стало</th>
            <th className="right">Заработано</th>
            <th className="right">Обычный фарм</th>
            <th className="right">Результат</th>
            <th>Статус</th>
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
                    <div className="small">Нет отдельного замера за {interval.missingDays} дн.; интервал объединён.</div>
                  ) : null}
                </td>
                <td className="num-cell">{formatInteger(summary.openingBalance)}</td>
                <td className="num-cell">{formatInteger(summary.expenses)}</td>
                <td className="num-cell">{formatInteger(summary.specialIncome)}</td>
                <td className="num-cell">{formatInteger(summary.closingBalance)}</td>
                <td className="num-cell">{formatInteger(summary.grossEarned)}</td>
                <td className="num-cell">{formatInteger(summary.regularFarm)}</td>
                <td className={`num-cell ${resultClassName(summary.netResult)}`}>{formatSignedInteger(summary.netResult)}</td>
                <td>
                  <span className={interval.status === "closed" ? "pill green" : "pill amber"}>
                    {interval.status === "closed" ? "Закрыто" : "Предварительно"}
                  </span>
                </td>
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

function EmptyState({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="empty-state">
      <p>{text}</p>
      <button type="button" onClick={onAction}>
        <Plus size={15} />
        {action}
      </button>
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

function IconButton({ title, children, onClick }: { title: string; children: ReactNode; onClick: () => void }) {
  return (
    <button className="icon-btn" type="button" title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}

function calculateDashboardTotals(characters: CharacterRecord[]): { balances: Record<Currency, number>; summary: PeriodSummary } {
  const totals = {
    balances: { adena: 0, lCoin: 0 },
    summary: {
      adena: {
        openingBalance: 0,
        closingBalance: 0,
        expenses: 0,
        specialIncome: 0,
        grossEarned: 0,
        regularFarm: 0,
        netResult: 0
      },
      lCoin: {
        openingBalance: 0,
        closingBalance: 0,
        expenses: 0,
        specialIncome: 0,
        grossEarned: 0,
        regularFarm: 0,
        netResult: 0
      },
      accountedDays: 0,
      actualDurationHours: 0
    }
  };

  for (const character of characters) {
    totals.balances.adena += character.currentBalances.adena;
    totals.balances.lCoin += character.currentBalances.lCoin;

    const period = getOpenPeriod(character);

    if (!period) {
      continue;
    }

    const summary = calculatePeriodSummary(period.snapshots, period.operations);

    for (const currency of currencies) {
      totals.summary[currency].openingBalance += summary[currency].openingBalance;
      totals.summary[currency].closingBalance += summary[currency].closingBalance;
      totals.summary[currency].expenses += summary[currency].expenses;
      totals.summary[currency].specialIncome += summary[currency].specialIncome;
      totals.summary[currency].grossEarned += summary[currency].grossEarned;
      totals.summary[currency].regularFarm += summary[currency].regularFarm;
      totals.summary[currency].netResult += summary[currency].netResult;
    }

    totals.summary.accountedDays += summary.accountedDays;
    totals.summary.actualDurationHours += summary.actualDurationHours;
  }

  return totals;
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
