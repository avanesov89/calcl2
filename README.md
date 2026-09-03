# Учёт фарма Lineage 2 Essence

MVP веб-приложения для ручного учёта адены и L-монет по персонажам. Стек: Next.js App Router, TypeScript, Firebase Authentication, Cloud Firestore, обычный CSS.

## Установка

```bash
npm install
cp .env.example .env.local
npm run dev
```

Откройте `http://localhost:3000`.

## Переменные окружения

Заполните `.env.local` значениями из Firebase Console:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Реальные ключи не коммитятся. В Firebase нужно включить Email/Password provider в Authentication и создать Cloud Firestore.

## Firestore

Данные хранятся только внутри пространства пользователя:

```text
users/{uid}
users/{uid}/characters/{characterId}
users/{uid}/characters/{characterId}/periods/{periodId}
users/{uid}/characters/{characterId}/periods/{periodId}/snapshots/{snapshotId}
users/{uid}/characters/{characterId}/periods/{periodId}/operations/{operationId}
```

Деплой правил и индексов:

```bash
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

Для локальной разработки можно запустить Firebase Emulator Suite и направить проект на тестовый Firebase-проект. MVP не подключает эмуляторы автоматически, чтобы не смешивать production и local state.

## Скрипты

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
```

## Что реализовано

- регистрация, вход, выход и восстановление пароля через Firebase Authentication;
- создание профиля пользователя в Firestore;
- полная изоляция данных через Firestore Rules по `request.auth.uid`;
- добавление, редактирование, архивирование и опасное удаление персонажей;
- начальные балансы, текущая неделя и начальный остаток при создании персонажа;
- ввод текущих остатков, расходы и поступления;
- предварительный расчёт промежутков между последовательными остатками;
- предупреждение об операциях после последнего остатка;
- завершение недели через batch write и автоматическое открытие следующей недели;
- история завершённых недель и детализация промежутков;
- светлая, тёмная и системная тема без мигания при загрузке;
- unit-тесты чистых расчётных функций.

## Ограничения MVP

- исправление закрытой истории ограничено последней завершённой неделей и только пока следующая неделя пустая;
- нет автоматической интеграции с игровым клиентом, скриншотами, рынком или переводами между персонажами;
- операции и остатки завершённых недель доступны для просмотра, а не для произвольного каскадного редактирования;
- Firestore-запросы сделаны простыми и понятными для MVP, без отдельного серверного API.
