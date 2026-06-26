# Бриф — Flow «Соедини фигурки» Фаза 2: UI + плагин в хаб + награды + durability

> Фаза 1 (логика+генератор+солвер+тесты) ПРИНЯТА: независимый CTO-адверс-гейт (workflow wv0chjf3r) —
> PASS_WITH_DEBT, три якоря держатся (проходимость 0/37580, солвер sound, детерминизм, кривая монотонна).
> Код ЗАКОММИЧЕН на ветке `flow-phase1` (поверх прод-main; commit a22cb2d) — Фазу 2 строй ЗДЕСЬ.
> ⛔ НЕ коммить/не пушь — отчёт + ревью CTO (это путь к ЕЁ живым данным). STORAGE_VERSION не трогать.
> Дизайн: DESIGN-FLOW.md. Спека Фазы 1: briefs/flow-phase1.md. Язык — русский.

## ⮕ Холодный промпт (вставить целиком)
```
КОНТЕКСТ: Фаза 2 новой игры Flow «Соедини фигурки» в «2048 с любовью» (Telegram Mini App, ЖИВОЙ
продукт-подарок). Ты на git-ветке `flow-phase1` — Фаза 1 (src/games/flow/{logic,levels}.ts + тесты +
content/flow.json) ПРИНЯТА и ЗАКОММИЧЕНА на ней (поверх прод-main). Строй Фазу 2 ЗДЕСЬ. Сделай игру
играбельной из хаба. ⛔ НЕ переключайся на main, НЕ мёрджи, НЕ коммить/не пушь — ревью и мёрдж делает
CTO (это путь к ЕЁ живым данным). STORAGE_VERSION не трогать. Язык — русский.

ПРОЧИТАЙ: briefs/flow-phase2.md (ТВОЁ ТЗ — особенно §2 «УРОКИ»), DESIGN-FLOW.md, briefs/flow-phase1.md;
ШАБЛОН (зеркаль структуру): src/games/blocks/{useBlocks.ts,Blocks.tsx,stats.ts} (свежайшая 4-я игра,
ТОЧНЫЙ образец), src/ui/App.tsx, src/ui/Hub.tsx, src/rewards/RewardsProvider.tsx,
src/engine/achievements.ts (EDGE_MONOTONIC_STATS / PER_GAME_STATS), content/achievements.json,
src/games/match3/depthMirror.ts (фабрика makeDepthMirror). Твоя Фаза 1: src/games/flow/{logic,levels}.ts.

ЗАДАЧА: useFlow.ts + Flow.tsx (drag-РИСОВАНИЕ путей) + stats.ts (fl_) + плитка хаба + view 'fl' +
lazy-load + награды fl_* + durability (flowDepthMirror). ВСТРОЙ уроки §2 С НАЧАЛА. Прогони
typecheck/test/build, ОТЧИТАЙСЯ, ЖДИ ревью. НЕ коммить.
```

## §1 Что строим (механика — DESIGN-FLOW.md §1)
Поле N×N (5..8 по бэндам), K пар фигурок-концов. Игрок **тянет путь** (drag по клеткам) от одной фигурки
к парной; пути не пересекаются; ЦЕЛЬ — соединить ВСЕ пары И заполнить ВСЁ поле. Уровень (size, pairs) —
из готового `generateLevel(level, seed)`. **НЕТ таймера и лимита ходов ⇒ НЕТ проигрыша** (статус только
`playing`/`won`; игрок решает в своём темпе — самая добрая и ПРОСТАЯ из 4 игр). Победа = `isSolvedByPlayer`.
Без потока фигур, без сжигания/анимации-прожига (проще Блоков/match3).

## §2 🔑 УРОКИ саги v15-v18 + долг ревью Фазы 1 — ВСТРОИТЬ С НАЧАЛА
Каждый пункт — реальный прод-баг на ней ИЛИ находка ревью. Не наступи снова:
1. **Вехи глубины `fl_maxLevel` — EDGE-ГЕЙТ.** Добавь `'fl_maxLevel'` в `EDGE_MONOTONIC_STATS`
   (achievements.ts). Иначе веха-награда ВЫПАДАЕТ НА КАЖДОМ ЗАХОДЕ (прод-баг v18 «ужин каждый заход»).
   **Единственный grant-сайт** (на победе уровня) и он ОБЯЗАН передавать `prevSnapshot` (иначе edge-гейт
   пропустится — прод-баг line-823). Per-game `fl_score`/`fl_moves` → в `PER_GAME_STATS` (edge-гейт на резюме).
2. **Durability глубины — `flowDepthMirror`.** Заведи `export const flowDepthMirror =
   makeDepthMirror('fl_depth_', MAX_DEPTH)` в match3/depthMirror.ts (фабрика уже есть). На загрузке
   `fl_maxLevel = max(CloudStorage, flowDepthMirror.read())` (recoverFlowDepth, зеркало recoverBBDepth);
   СИНХРОННАЯ `flowDepthMirror.write(maxLevel)` на победе ПЕРЕД grant; `flowDepthMirror.clear()` в reset-пути
   RewardsProvider (рядом с depthMirror/blocksDepthMirror.clear()). Фикс класса «48→22».
3. **Резюм-слот — honor ТОЛЬКО если `slot.level === fl_maxLevel + 1`** (`isResumableFlowSlot` ГОТОВ в
   levels.ts). Устаревший слот игнорируй + `persistBoard()` (self-heal). Прод-баг «всегда предлагает L25».
   На резюме **восстанавливай `game` И `paths`** (урок Блоков #1: applyState зовёт setGame — иначе счёт/
   прогресс обнуляются). `normalizeFlow` (ГОТОВ) — мягкое чтение, на битом слоте → null ⇒ свежий старт.
4. **Хранилище:** ключи `flow_board`/`flow_stats` — **БЕЗ ТОЧЕК** (`/^[A-Za-z0-9_-]+$/`; точка молча ломает
   Telegram CloudStorage). Персист **аддитивный**, STORAGE_VERSION НЕ трогать. `persistOkRef`-гард: при сбое
   mount-load НЕ перезаписывать её данные дефолтом. Слот хранит `{level,seed,size,pairs,paths,game}` —
   **НЕ храни `solution`** (лишний вес). Долг ревью: worst-case 8×8 слот ~1.6КБ из 4КБ — норм, но добавишь
   поля наград → перепроверь байты (byteLength) против 4КБ.
5. **Контракт `isSolvedByPlayer(size, pairs, paths)` (долг ревью):** `paths` — массив РОВНО по паре, в
   ТОМ ЖЕ порядке, что `pairs[]` (paths[i] = маршрут pairs[i]). Хук обязан так и держать (пустой путь =
   ещё не начат). Детектор победы — это `isSolvedByPlayer` из logic.ts, не своя копия.
6. **Меню/назад на время выдачи (урок Блоков #2):** победа→grant у Flow СИНХРОННА на pointerup (нет
   прожига) ⇒ окна гонки нет. НО если добавишь празднование/задержку перед grant — задизейбл «Меню» на это
   время (нельзя размонтировать до grant). Держи детект-победы→grant в одном обработчике.
7. **Экономика:** fl-ачивки `game:'fl'` под общим дневным лимитом (`isCappedCoupon` капает любую тир-награду
   без `rewardId`). Именная веха-вершина — максимум 1, large-тир, БЕЗ rewardId (без коллизии). rewards.json НЕ трогать.

## §3 useFlow.ts (зеркаль useBlocks.ts — но проще: нет lost/потока/прожига)
Статус playing/won. На старте: `recoverFlowDepth` → если валидный слот (§2.3) → резюм-диалог, иначе
`startLevel(fl_maxLevel + 1)` + self-heal persist. `startLevel(n)` = `generateLevel(n, freshSeed)` →
`flowStateFromLevel` (ГОТОВ: pairs из уровня, paths=[], game нули). Ход = drag-обновление `paths` (§4). На
pointerup проверь `isSolvedByPlayer` → победа: `fl_maxLevel = max(prev, level)` ПЕРЕД grant +
`flowDepthMirror.write` + `grant('fl', buildFLSnapshot(stats,game), prevSnapshot)` + commitFLGame + celebrate +
оверлей «след. уровень». Персист `flow_board`(незаконч. слот на pointerup, throttle в store)/`flow_stats`(durable).
Зеркала-рефы для синхронного чтения в обработчиках (как useBlocks). `aliveRef`/`persistOkRef`.

## §3b stats.ts (fl_, зеркаль blocks/stats.ts)
`FLCumulativeStats {totalScore,bestScore,gamesPlayed,maxLevel}`, `FLCurrentGame {score,moves}` (тип уже в
logic.ts как FlowCurrentGame — переиспользуй). `FL_KEYS` из `FL_STAT_PREFIX='fl_'` (constants.ts). score на
победе — простой (напр. `size*size*10`, глубже=больше ⇒ растёт totalScore); moves = число «штрихов».
`normalizeFLStats` (аддит. миграция + кламп maxLevel к MAX_DEPTH), `recoverFlowDepth`, `buildFLSnapshot`
(cumulative «вживую» + per-game как есть; maxLevel монотонный), `commitFLGame`, `defaultFL*`.

## §4 Flow.tsx + хаб (НОВОЕ — drag-РИСОВАНИЕ пути)
Поле N×N: клетки + концы (lucide-иконка на цветном КРУЖКЕ; `colorOff`-бэнд → нейтральный цвет) + трассы
(цветные толстые линии/залитые клетки под пальцем). Фигуры→lucide: heart→Heart, star→Star, flower→Flower2,
moon→Moon, sun→Sun, leaf→Leaf, droplet→Droplet, cat→Cat, cherry→Cherry, cloud→Cloud, snowflake→Snowflake,
key→Key. **WYSIWYG, БЕЗ лифта** — клетка под пальцем = голова пути (урок жены: фигура ровно под пальцем).
Взаимодействие (pointer events, тач+мышь; `cellFromPoint` по rect грида, как Blocks):
 • down на конце цвета i ИЛИ на клетке пути i → active=i (с конца — сброс paths[i]=[конец]; с середины —
   обрезать до этой клетки);
 • move в соседнюю клетку: backtrack (назад на пред.) | пусто → занять | парный конец → занять+замкнуть |
   ЧУЖОЙ путь → **перерисовать (обрезать чужой хвост от этой клетки)** [стандартный Flow; если на тесте у
   жены раздражает — fallback «блок без перезаписи»] | чужой КОНЕЦ → блок | своя клетка (петля) → игнор;
 • up → active=null, проверить победу. swipe-guard: `preventDefault` на touchmove во время active drag
   (иначе Telegram сворачивает аппу). touch-action:none.
HUD: уровень / соединено K/всего / «Заново». Оверлеи: победа (след. уровень / в меню), резюм-диалог
(продолжить/заново). Плитка в Hub.tsx (`{id:'fl', emoji, status:'play'}`), `view:'fl'` в App.tsx,
`React.lazy`. Хаптика на замыкании пары/победе. Footer BUILD_TAG.

## §5 Награды (achievements.json, game:'fl')
Вехи по `fl_maxLevel` (нелинейные пороги L1/3/5/8/12/18/25, small→large, edge-гейт §2.1) + 1-2 per-game
челленджа (напр. fl_maxLevel-вершина large без rewardId; или «пройди 8×8»). Тёплые тексты. ВСЁ под дневным
лимитом. Старые ачивки/rewards.json не трогать.

## §6 Тесты
useFlow/stats: резюм (валидный/устаревший слот; game И paths восстановлены), победа→fl_maxLevel бамп+durable,
`recoverFlowDepth` read-repair `max(cloud,mirror)` («зеркало переживает», зеркало depthMirror.test).
**fl_maxLevel edge-гейт НЕ перевыдаётся на новом заходе** (зеркало achievements.test «её прод-баг»). Ключи
без точек (общий тест STORAGE_KEYS). `isSolvedByPlayer` контракт пара-порядка. 2048/match3/wordle/блоки не задеты.

## DoD
Играется из хаба (drag-рисование путей работает на тач); durable глубина (тест read-repair); вехи НЕ
перевыдаются (edge-гейт, тест); резюм восстанавливает game+paths и не залипает; ключи без точек;
STORAGE_VERSION цел; её wallet/progress/прочие игры целы; typecheck/test/build зелёные. Отчёт: файлы, как
встроены уроки §2, список тестов, замер байт слота. ⛔ НЕ коммить/не пушь — ревью CTO + адверс-пасс по её
данным ПЕРЕД деплоем. Деплой/`?v`/BUILD_TAG — владелец.
