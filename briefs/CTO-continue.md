# CTO-хендофф — «2048 с любовью» (снимок для новой сессии · 2026-06-22)

> Ты продолжаешь как **CTO проекта** (не кодер — ты сам правишь мелочи, гейтишь деплой, защищаешь её
> живые данные). Тон: русский, по делу, рекомендация — не опросник.
> Прочитай ТАКЖЕ: MEMORY.md + memory-файлы (`love2048-ops`, `love2048-match3-spicy`, `love2048-wordle5`,
> `love2048-player-taste`), DESIGN-BLOCKS.md, briefs/blocks-phase1*.md, briefs/blocks-phase2.md (§2 УРОКИ).

## ⏳ ТВОЁ ПЕРВОЕ ДЕЙСТВИЕ — починить 3 правки на ветке `blocks-phase1`, потом перепроверить
Игра «блоки-фигуры» (Фаза 2) **прошла гейт безопасности данных** (адверс-пасс: 0 HIGH — ни порчи
кошелька, ни двойных/ретро-купонов, ни регресса 2048/m3/w5, durability/STORAGE_VERSION целы). Остались
**2 MEDIUM + 1 UX-LOW** качества (это ПОДАРОК — первое впечатление важно). Муж сказал: **не катим, пока
не починим.** Ты на ветке `blocks-phase1`, Фаза 1+2 закоммичены — правь прямо тут.

### Правка #1 (MEDIUM) — резюм не восстанавливает per-game состояние (счёт/линии/ходы)
**Симптом:** возврат в недопройденный уровень → HUD-счёт показывает 0, прогресс челленджей
bb-score/bb-lines сброшен, очки до закрытия не идут в totalScore. (НЕ порча, НЕ двойной купон — глубина
в отдельном blob цела; edge-гейт читает обнулённый prevSnapshot ⇒ ложного купона нет.)
**Причина:** `BlockLevelState` (src/games/blocks/levels.ts) не содержит поля `game`; `applyState`
(src/games/blocks/useBlocks.ts ~207-224) на резюме не зовёт `setGame`. Комментарий в stats.ts
(`BBCurrentGame` «восстанавливаются при резюме») обещает это, но проводки нет.
**Фикс — зеркалить match3 (там это есть: useMatch3.ts ~304 персист `game` в слот, ~469 `setGame(normalizeM3Game(boardP.game))`):**
1. `BlockLevelState` (levels.ts) → добавить `game: BBCurrentGame` (type-only import из `./stats`;
   циркуляра нет — stats.ts из levels.ts не импортит).
2. `normalizeBlocks` (levels.ts) → `game: normalizeBBGame(r.game)` (хелпер УЖЕ есть в stats.ts; дефолт
   нули = аддитивная миграция старых слотов, БЕЗ бампа STORAGE_VERSION).
3. `blocksStateFromLevel` (levels.ts) → `game: defaultBBGame()` (свежий уровень с нуля).
4. `currentBlocksState` (useBlocks.ts ~179-188) → добавить `game: gameRef.current` в персист-снапшот.
5. `applyState` (useBlocks.ts ~207-224) → добавить `setGame(st.game)`.
6. Тест: резюм восстанавливает game (зеркало match3-теста resume-restores-game).

### Правка #2 (MEDIUM) — победный клир + тап «Меню» в окне прожига теряет купон-веху
**Симптом:** на победном ходе (lines>0 ⇒ busy + анимация CLEAR_MS ~200мс) если тапнуть «Меню» внутри
окна — `finalizeMove` (где `grant`) не успевает, а зеркало глубины уже подняло maxLevel в `placePiece`.
Итог: глубина сохранится (read-repair), но купон за этот уровень не выдастся, и edge-гейт его потом НЕ
перевыдаст. Редкая гонка, но теряется её награда (для именной вехи — обидно).
**Фикс (низкий риск):** в src/games/blocks/Blocks.tsx задизейблить кнопку «Меню»/назад на время
`bb.busy` — ровно как уже сделано у кнопки «Заново» (`disabled={bb.busy}`). Тогда нельзя размонтировать
посреди прожига до гранта.

### Правка #3 (LOW/UX) — DRAG_LIFT=0: палец перекрывает проекцию на реальном тач
Кодер сам флагнул. В Blocks.tsx `onPieceDrag` (~141) вычесть небольшой подъём, чтобы проекция фигуры
сидела ВЫШЕ пальца: `const LIFT = 1; anchorR = pointer.r - grabRef.current.r - LIFT;` (anchorC не
трогать). Константа `DRAG_LIFT` (~122) сейчас 0.

### LOW — отложено (можно НЕ делать, отметить как долг):
- **sweep не зовётся из блоков** (баннер истечения купонов может устареть в долгой сессии) — косметика;
  при желании `rewards.sweep({refreshReminder:true})` на переходах уровня (зеркало useMatch3 ~825),
  ПЕРЕД `grant`. Без эффекта на кошелёк (boot сметает + evaluateAchievements фильтрует expired).
- **backdrop резюм-диалога = «начать заново»** — так же в выкаченном match3; оставить для консистентности.

### После правок:
1. `npm run typecheck && npm test && npm run build` — всё зелёное (база: 470 тестов + новый).
2. (По желанию) лёгкий адверс-перепрогон правки #1 — она трогает persist/resume (её данные), хоть и
   зеркалит проверенный match3-паттерн. Полноценный Workflow можно не гонять (фикс маленький, аддитивный).
3. **На go мужа** → мёрдж `blocks-phase1` → `main` (fast-forward; main с точки ветки не двигался) →
   push → Pages пересоберёт. **Муж тестит drag на РЕАЛЬНОМ телефоне** (харнесс жест Framer-drag не
   воспроизводит — это единственное, что не проверяется кодом) → если ок, бампает `?v=19` → к жене.
   Её бот на `?v=18` до бампа не задет (кэш).
**НЕ катим в прод, пока 3 правки не сделаны и не перепроверены (прямое указание мужа).**

## РОЛИ И КОНТЕКСТ
- Проект: Telegram Mini App «2048 с любовью» — подарок жене пользователя («Кукурузка»). Хаб казуальных
  игр; за достижения падают купоны на реальные «приятности» от мужа (ужин, кафе, именные подарки).
- Стек: React + Vite + TS + Tailwind + Framer Motion. Чистый клиент, без бэка. Деплой: push в `main`
  → GitHub Actions → Pages. Кэш-бастинг и сброс — см. memory `love2048-ops`.
- Хранилище: Telegram CloudStorage (async, throttle + flush-on-close, ключи **[A-Za-z0-9_-] только —
  без точек!**, ≤4КБ) + localStorage-fallback. `STORAGE_VERSION='3'` — **НЕ менять** (миграции аддитивные).
- Муж = продакт-овнер: relay-ит фидбек жены, катит сам (смотрит URL глазами, бампает ?v в @BotFather).
  Ты независимо ревьюишь, гейтишь деплой, защищаешь её данные/кошелёк. Кодинг отдаётся в отдельные сессии
  по брифу — но мелкие правки (как эти 3) делаешь сам.

## ЖЕЛЕЗНЫЕ ПРАВИЛА (её живые данные)
- **Адверс-пасс ПЕРЕД пушем к ней.** Ultracode ВКЛ — на содержательные задачи гоняй Workflow (атака→
  верификация, разные линзы). Этот процесс трижды ловил HIGH на её кошелёк до выката.
- Купоны: declarative-ачивки. Капируемый купон = `!rewardId` (тир small/medium/large); именной = rewardId.
  Дневной лимит. **EDGE_MONOTONIC_STATS** (achievements.ts) — кумулятивные монотонные вехи edge-гейтятся
  (срабатывают раз на пересечении, НЕ перевыдаются на каждом заходе — прод-баг «ужин» v18). Члены:
  m3_maxSpicyLevel, w5_dailyWins, w5_maxDailyStreak, w5_bestGuess, **bb_maxLevel**.
- Durability-зеркало: localStorage число-only зеркало (`depthMirror.ts` фабрика: spicyDepthMirror,
  **blocksDepthMirror** `bb_depth_`, MAX_DEPTH=500), read-repair max(cloud,зеркало) на загрузке, синхр.
  запись на победе, clear в reset (RewardsProvider).
- Резюм-слот: `isResumableBlocksSlot` чтит слот только если `level === maxLevel+1` (иначе устаревший →
  отбросить + self-heal persistBoard).
- Каждый уровень ДОЛЖЕН быть проходим (солвер-гейт+k-fork+парашют). Витнес casual-винрейта — ДРУГАЯ,
  более слабая стратегия, чем greedy, ставящий бюджет (де-циркуляризация).

## ТЕКУЩИЙ ПРОД (main = v18, коммит 542ffdd — НЕ трогать до мёрджа)
Стабилен, подтверждён женой: уровни сохраняются, нет фриза, нет «всегда L25», нет спама «ужин», кошелёк
цел. Живое: **2048 + Match-3 (лайт + «с перчинкой») + «5 букв» (Wordle рус)**. Блоков в проде ещё НЕТ.
Сага v15→v18 (всё подтверждено женой как починенное): durability-зеркало (баг «48→22»), freeze-fix
(watchdog+animTimersRef), L25 (устаревший резюм-слот → isResumableSlot), «ужин при каждом входе»
(level-триггер без edge-гейта → EDGE_MONOTONIC_STATS). Эти уроки ВШИТЫ в блоки заранее — и сработали
(Фаза 2 пришла без багов того класса).

## СОСТОЯНИЕ БЛОКОВ
- Дизайн: поуровневая (сложнее-и-сложнее, у жены лидер-дух — бесконечный релакс ей скучен), цель
  «расчистить поле», один режим. Бриф: DESIGN-BLOCKS.md.
- **Фаза 1** (генератор/солвер/уровни-коридор) — ПРИНЯТА после 3 раундов (честный casual-витнес, без
  снижения тест-таргетов, монотонная сложность). content/blocks.json: bands blocksMax 3/5/7/10/10/10,
  budgetMultiplier 4.0→2.0 монотонно.
- **Фаза 2** (UI/wiring/данные) — пришла, отревьюена (адверс-пасс w2hvzn800: 6 находок, 0 HIGH / 2 MEDIUM
  / 4 LOW). Ядро очень крепкое: все уроки §2 вшиты верно (единственный grant-сайт finalizeMove с
  prevSnapshot — нет line-823-дыры; recoverBBDepth; синхр. blocksDepthMirror.write на победе; resume-слот
  + self-heal; ключи bb_board/bb_stats без точек; watchdog+animTimers; bb-ачивки под дневным лимитом).
  Латент `bb-games-20` (веха на gamesPlayed — не-edge, т.к. gamesPlayed растёт на старте уровня, не на
  ходе) = известный проектный паттерн «re-fire на просрочке» (как 2048), small/medium капается — НЕ
  bb-специфика, не блокер.

## КАРТА КОДА (блоки + общие точки)
- src/games/blocks/logic.ts — Grid/Cell/Piece, PIECE_SET, canPlace/place/clearLines/countBlocks/hasAnyMove.
- src/games/blocks/levels.ts — BlockLevelState, makePieceStream(seed,startPos), солвер/витнесы, buildLevel
  (k-fork), generateLevel, isResumableBlocksSlot, blocksStateFromLevel, normalizeBlocks. **← правка #1**
- src/games/blocks/useBlocks.ts — хук (зеркало useMatch3 spicy): load/recoverBBDepth, placePiece(строит
  prevSnapshot), finalizeMove(единств. grant + commit + persist), watchdog, currentBlocksState, applyState.
  **← правка #1, #2-логика busy**
- src/games/blocks/stats.ts — BB_KEYS, normalize/recoverBBDepth/buildBBSnapshot/commitBBGame. Хелперы
  normalizeBBGame/defaultBBGame/BBCurrentGame УЖЕ есть.
- src/games/blocks/Blocks.tsx — Framer drag-drop, HUD, оверлеи, swipe-guard, DRAG_LIFT. **← правка #2, #3**
- src/engine/achievements.ts — PER_GAME_STATS (+bb_score/lines/moves), EDGE_MONOTONIC_STATS (+bb_maxLevel),
  isCappedCoupon, edge-гейт.
- src/rewards/RewardsProvider.tsx — reset чистит оба зеркала (depthMirror+blocksDepthMirror), grant в
  try/catch.
- src/storage/types.ts — bbBoard:'bb_board', bbStats:'bb_stats' (без точек), STORAGE_VERSION='3'.
- src/ui/App.tsx — view 'bb' (lazy import). content/achievements.json — 11 bb-ачивок (game:'bb';
  bb_maxLevel-вехи edge-гейчены; bb-summit-25 = large-тир, НЕ именной — без rewardId-коллизии).

## GIT
- Ветка: `blocks-phase1`. На ней Фаза 1 (acf0dfd) + Фаза 2 (закоммичена этим хендоффом). main = v18
  (542ffdd) НЕ задет. Правки #1-#3 делай тут (коммить на ветку). Мёрдж в main — только на go мужа.
- Процесс при срочных прод-хотфиксах: `git stash -u` незакоммиченное → фикс на main → pop. (Сейчас всё
  закоммичено — не актуально.)
