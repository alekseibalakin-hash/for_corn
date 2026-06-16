# Бриф — Фаза B: игра Match-3 в хабе

> Вставь блок ниже в кодинг-сессию. Источник правды — DESIGN-HUB.md (§6) + текущий код
> (Phase A уже в проде, build v5). Match-3 плагинится в готовый игро-независимый наградный
> слой. Управление — СВАЙП фишки. Не трогать данные жены: STORAGE_VERSION НЕ поднимать.

---

```
Фаза B проекта «2048 с любовью»: добавить вторую игру Match-3 в ХАБ (та же кодовая база,
Phase A уже в проде). Match-3 плагинится в существующий наградный слой (src/rewards/),
зеркаля структуру src/games/g2048/. Сверяйся с DESIGN-HUB.md §6.

Работай ТОЛЬКО в этой папке. Прочитай: DESIGN-HUB.md, src/games/g2048/* (как образец),
src/rewards/RewardsProvider.tsx (useRewards: grant(gameId, snapshot, prevSnapshot?)),
src/engine/* , src/storage/* , src/ui/Hub.tsx, src/ui/App.tsx, src/ui/constants.ts,
src/ui/components/Board.tsx (паттерн свайпов), content/achievements.json.

=== 1. Чистая логика (src/games/match3/logic.ts + тесты) ===
Поле 8×8, 6 типов фишек (эмодзи: 🍓🫐🍋🍇🌸💗). Фишка = { type, special? }. Чистые функции
(без React, покрыть юнит-тестами):
- createBoard(rng): стартовое поле БЕЗ готовых совпадений и хотя бы с одним валидным ходом.
- findMatches(board): совпадения ≥3 с РАСПОЗНАВАНИЕМ формы: 3 / линия 4 / линия 5 / угол L|T (5).
- СПЕЦФИШКИ (главное в этой фазе — «вкус» Индикота). Создаются на месте свопнутой фишки:
  • линия 4 → 'line' (активация сносит весь ряд И столбец);
  • линия 5 → 'colorBomb' (при свопе с обычной убирает ВСЕ фишки её типа);
  • форма L/T (5) → 'bomb' (активация сносит область 3×3).
  Спецфишка АКТИВИРУЕТСЯ, когда попала в совпадение или ей свопнули; эффект добавляет ячейки к
  очистке и может цеплять другие спецы (цепная активация).
- КОМБО спецов (своп двух спецфишек), базово: line+line → крест; bomb+bomb → 5×5;
  colorBomb+любая → снести весь её тип. (Можно начать с простого набора — главное одиночные спецы.)
- applyGravity / refill(rng): падение и добивка сверху.
- resolveCascades(board, rng): цикл «совпадения → создать спецфишки → активировать спецы и собрать
  ВСЕ очищаемые ячейки → гравитация → добивка → снова», пока есть что убирать; вернуть
  { board, gemsCleared, scoreGained, maxCascade, biggestClear } (maxCascade = длина цепочки за ход;
  biggestClear = макс. ячеек, убранных за один шаг).
- isValidSwap(board, a, b): даст ли своп совпадение ИЛИ это активация спеца (своп со спецом валиден).
- hasAnyMove(board): есть ли валидный ход; reshuffle(board, rng) если нет.
- Счёт: 10 × число фишек × уровень_каскада; взрывы спецфишек засчитывают все убранные ячейки
  (крупные комбо → большой счёт).

=== 2. Статы match3 (префикс m3_, соглашение в constants.ts: M3_STAT_PREFIX) ===
Per-game (сбрасываются с партией, восстанавливаются при резюме): m3_score, m3_combo (макс.
каскад за партию), m3_moves, m3_biggestClear (макс. фишек убрано одним ходом — растёт от спецфишек).
Cumulative: m3_bestScore, m3_totalScore, m3_gemsCleared, m3_gamesPlayed.
Сделай buildM3Snapshot(m3Stats, m3Game) → плоский снапшот этих ключей (live-итоги как в
buildSnapshot 2048: totalScore += session).

=== 3. ВАЖНО — edge-triggering для m3 (иначе тот же баг резюма) ===
В src/engine/achievements.ts добавь m3 per-game статы в PER_GAME_STATS:
  const PER_GAME_STATS = new Set([... , 'm3_score', 'm3_combo', 'm3_moves', 'm3_biggestClear']);
Так m3-вехи (по m3_score/m3_combo) выдаются только при пересечении порога ходом, а резюм
партии с уже высоким счётом не уронит купон на первом свопе. Cumulative m3-статы — level.
Игра должна звать rewards.grant('m3', newSnapshot, prevSnapshot) (prev — ДО свопа).

=== 4. Хук (src/games/match3/useMatch3.ts), зеркало useGame2048 ===
Держит board/score/combo/m3-статы/won? (у match3 «победы» нет — endless). doSwap(cell, dir):
своп с соседом; если isValidSwap → применить resolveCascades, обновить счёт/статы, rewards.grant
('m3', снапшот, prevСнапшот); иначе откат (вернуть своп). startNewGame: commit в cumulative,
m3_gamesPlayed+1, новое поле, rewards.sweep()+grant. РАССЛАБЛЕННЫЙ endless: проигрыша нет; если
hasAnyMove==false → reshuffle. Персист СВОИХ ключей через repo (см. п.5).

=== 5. Хранилище (src/storage/repository.ts) ===
Ключи match3.board/match3.stats уже зарезервированы и чистятся в resetState. Добавь методы:
loadMatch3Board/saveMatch3Board/loadMatch3Stats/saveMatch3Stats (зеркало board/stats). Заведи
тип PersistedMatch3 (поле фишек + m3Game-статы). НЕ трогай ключи 2048/общие, НЕ меняй STORAGE_VERSION.

=== 6. Экран (src/games/match3/Match3.tsx) + ленивый index.ts ===
Сетка 8×8 эмодзи-фишек, тёплая палитра/Nunito. Спецфишки рисуй отлично от обычных (свечение/
рамка/значок поверх эмодзи) и анимируй их взрывы (линия/бомба/цветобомба) — это вау-эффект.
Управление — СВАЙП фишки к соседу: переиспользуй
тач-паттерн из Board.tsx (нативные слушатели {passive:false}, preventDefault на touchmove, порог,
доминирующая ось → направление свопа). Анимации свопа/падения/очистки (framer-motion). Кнопка
«Меню» (назад в хаб), «Новая игра», счёт/лучший. Лениво грузится (React.lazy), как Game2048.

=== 7. Хаб/роутинг (src/ui/constants.ts, src/ui/App.tsx) ===
- constants.ts: плитка m3 GAMES — status 'soon' → 'play'; подзаголовок без «скоро». BUILD_TAG 'v5' → 'v6'.
- App.tsx (Shell): добавь 'm3' в union view, лениво монтируй Match3, маршрут hub→m3 и «назад»→hub.
  Общие оверлеи (RevealModal/Wallet/Victory/Onboarding) уже в корне — не дублируй.

=== 8. Ачивки match3 — добавь в content/achievements.json (game:'m3') ===
Вставь ЭТИ объекты в массив achievements (пороги — ручка, потом подкрутим по факту):
  {"id":"m3-warmup","type":"milestone","game":"m3","title":"Распробовала 🍓","description":"Набери 500 очков за игру","trigger":{"stat":"m3_score","op":">=","value":500},"rewardTier":"small","note":"И тут тебя ждут приятности, любимая ❤️"},
  {"id":"m3-score-3000","type":"challenge","game":"m3","title":"Вкусно","description":"3000 очков за игру","trigger":{"stat":"m3_score","op":">=","value":3000},"rewardTier":"small","cooldownDays":1},
  {"id":"m3-score-8000","type":"challenge","game":"m3","title":"Сахарный взрыв","description":"8000 очков за игру","trigger":{"stat":"m3_score","op":">=","value":8000},"rewardTier":"medium","cooldownDays":2},
  {"id":"m3-score-20000","type":"challenge","game":"m3","title":"Сладкий шторм","description":"20000 очков за игру","trigger":{"stat":"m3_score","op":">=","value":20000},"rewardTier":"large","cooldownDays":2},
  {"id":"m3-combo-4","type":"challenge","game":"m3","title":"Каскад","description":"Цепочка из 4 каскадов за ход","trigger":{"stat":"m3_combo","op":">=","value":4},"rewardTier":"small","cooldownDays":1},
  {"id":"m3-combo-6","type":"challenge","game":"m3","title":"Цепная реакция","description":"Цепочка из 6 каскадов за ход","trigger":{"stat":"m3_combo","op":">=","value":6},"rewardTier":"medium","cooldownDays":2},
  {"id":"m3-cleared-2000","type":"milestone","game":"m3","title":"Урожай","description":"Собери 2000 фишек суммарно","trigger":{"stat":"m3_gemsCleared","op":">=","value":2000},"rewardTier":"small"},
  {"id":"m3-cleared-12000","type":"milestone","game":"m3","title":"Большой урожай","description":"Собери 12000 фишек суммарно","trigger":{"stat":"m3_gemsCleared","op":">=","value":12000},"rewardTier":"medium"},
  {"id":"m3-games-20","type":"milestone","game":"m3","title":"Втянулась в тройки","description":"Сыграй 20 партий в Match-3","trigger":{"stat":"m3_gamesPlayed","op":">=","value":20},"rewardTier":"small"},
  {"id":"m3-games-75","type":"milestone","game":"m3","title":"Мастер троек","description":"Сыграй 75 партий в Match-3","trigger":{"stat":"m3_gamesPlayed","op":">=","value":75},"rewardTier":"large"},
  {"id":"m3-bigblast","type":"challenge","game":"m3","title":"Большой бабах","description":"Убери 20+ фишек одним ходом","trigger":{"stat":"m3_biggestClear","op":">=","value":20},"rewardTier":"medium","cooldownDays":1}
Награды — из общего каталога (rewardTier, случайный купон). content/rewards.json НЕ трогать.

НЕ трогать: rewards.json, деплой/бота, палитру/тон/анти-грайнд 2048, STORAGE_VERSION ('3'),
?reset/schemaVersion. 2048 и общий наградный слой по смыслу не менять.

=== Definition of done ===
- npm run typecheck, npm test, npm run build — всё зелёное; Match3 — отдельный ленивый чанк.
- Тесты: чистая логика match3 (findMatches с формами 3/4/5/L-T; создание и активация спецфишек
  line/colorBomb/bomb; resolveCascades со спецами и biggestClear; isValidSwap/hasAnyMove/счёт);
  edge-triggering m3 (резюм партии с высоким m3_score → первый своп НЕ роняет купон;
  пересечение порога ходом → роняет); существующие 118 тестов целы.
- Прогон вживую (браузер+mock, ?reset для чистоты): хаб → Match-3 (ленивый чанк) → собрать
  тройку → счёт растёт → m3-награда «Забрать» → «назад» в хаб → тот же кошелёк, «выполнено»
  по всему хабу; 2048 по-прежнему работает; данные не теряются (аддитивно, STORAGE_VERSION='3').
- Отчёт: что в src/games/match3/, изменения в repo/engine/hub, новые m3-ачивки, что осталось.
```

---

## Что проверит CTO-сессия после фазы B
- Чистая логика match3 покрыта тестами (каскады/гравитация/валидность свопа/счёт), детерминизм по rng.
- Edge-triggering распространён на m3 per-game статы (нет повторной выдачи на первом свопе резюма).
- m3 плагинится в общий слой: grant('m3', …) → общий кошелёк/«выполнено X из N» (N вырос на m3-ачивки).
- Хранилище: match3.board/stats читаются/пишутся; STORAGE_VERSION='3' не тронут; данные жены целы.
- Хаб: плитка 🍓 активна, ленивый чанк, «назад»; 2048 не сломан; BUILD_TAG v6.
- Свайп-управление на телефоне: своп надёжен, окно не сворачивается (наследует фикс 2048).
- Прогон вживую: хаб → match3 → матч → награда → общий кошелёк.

## После приёмки — деплой (как Phase A)
git push → Pages; в @BotFather поднять `?v=6`. STORAGE_VERSION не трогаем (её прогресс цел).
