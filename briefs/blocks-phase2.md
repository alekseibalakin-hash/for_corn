# Бриф — «Блоки-фигуры» Фаза 2: UI + плагин в хаб + награды + durability

> Фаза 1 (логика+генератор+тесты) ПРИНЯТА на ревью (3 раунда + адверс-пассы): уровни доказуемо проходимы
> и честно проходимы живым игроком (casual-коридор). Её код **ЗАКОММИЧЕН в ветке `blocks-phase1`** (поверх
> прод v18 в main) — Фазу 2 строй на этой ветке.
> Фаза 2 — сделать игру играбельной из хаба. ⛔ НЕ коммить/не пушь — отчёт + ревью CTO (это путь к ЕЁ
> живым данным). STORAGE_VERSION не трогать. Одна сессия на дереве за раз. Язык — русский.

## ⮕ Холодный промпт (вставить целиком)
```
КОНТЕКСТ: Фаза 2 новой игры «блоки-фигуры» в «2048 с любовью» (Telegram Mini App, ЖИВОЙ продукт-подарок).
Ты на git-ветке `blocks-phase1` — Фаза 1 (src/games/blocks/{logic,levels}.ts + тесты + content/blocks.json
+ depthMirror-фабрика) ПРИНЯТА и ЗАКОММИЧЕНА на ней (поверх прод v18 в main). Строй Фазу 2 ЗДЕСЬ, на этой
ветке. Сделай игру играбельной из хаба. ⛔ НЕ переключайся на main, НЕ мёрджи, НЕ коммить/не пушь — ревью
и мёрдж в main делает CTO (это путь к ЕЁ живым данным). STORAGE_VERSION не трогать. Язык — русский.

ПРОЧИТАЙ: briefs/blocks-phase2.md (ТВОЁ ТЗ — особенно §2 «УРОКИ»), DESIGN-BLOCKS.md, briefs/blocks-phase1.md;
ШАБЛОН (зеркаль структуру): src/games/match3/{useMatch3.ts,Match3.tsx} (спайси-режим), src/ui/App.tsx,
src/ui/Hub.tsx, src/rewards/RewardsProvider.tsx, src/engine/achievements.ts (EDGE_MONOTONIC_STATS),
content/achievements.json. Твоя Фаза 1: src/games/blocks/{logic,levels}.ts.

ЗАДАЧА: useBlocks.ts + Blocks.tsx (drag-drop) + плитка хаба + view 'bb' + lazy-load + награды bb_* +
durability. ВСТРОЙ уроки §2 С САМОГО НАЧАЛА. Прогони typecheck/test/build, ОТЧИТАЙСЯ, ЖДИ ревью. НЕ коммить.
```

## §1 Что строим (механика — в DESIGN-BLOCKS.md §1)
Поле 8×8, набор из 3 фигур снизу, **drag-drop** на сетку (Framer Motion `drag`), сжигание полных рядов/
столбцов, цель «расчистить блоки» за лимит наборов, добрый бесконечный ретрай, durable глубина. Только
поуровневый режим. Поток фигур, цель, бюджет — из готового `levels.ts` (`generateLevel`).

## §2 🔑 УРОКИ саги v15-v18 — ВСТРОИТЬ С НАЧАЛА (не повтори прод-баги на ней)
Это самое важное в брифе. Каждый пункт — реальный прод-баг, который мы ловили на ней. Не наступи снова:
1. **Вехи глубины `bb_maxLevel` — EDGE-ГЕЙТ.** Добавь `'bb_maxLevel'` в `EDGE_MONOTONIC_STATS`
   (src/engine/achievements.ts). Иначе веха-награда будет ВЫПАДАТЬ НА КАЖДОМ ЗАХОДЕ (прод-баг v18 «ужин
   каждый заход»: level-веха без edge-гейта держится только на pending, а просроченный купон pending не
   ловит). И **ВСЕ grant-сайты bb передают prevSnapshot** (иначе edge-гейт пропустится — прод-баг line-823).
2. **Durability глубины — `blocksDepthMirror` (уже в фабрике depthMirror.ts).** На загрузке
   `bb_maxLevel = max(CloudStorage, blocksDepthMirror.read())`; СИНХРОННАЯ `blocksDepthMirror.write()` на
   победе уровня; `blocksDepthMirror.clear()` в reset-пути RewardsProvider (рядом с depthMirror.clear()).
   Фикс класса «48→22» (async CloudStorage теряет ещё-не-сброшенное).
3. **Резюм-слот — honor ТОЛЬКО если `slot.level === bb_maxLevel + 1`** (паттерн `isResumableSlot` из
   match3/levels.ts). Устаревший слот игнорируй + `persistBoard()` (self-heal). Иначе прод-баг «всегда
   предлагает уровень N» (слот завис на пройденном).
4. **Хранилище:** ключи `bb_board`/`bb_stats` — **БЕЗ ТОЧЕК** (`/^[A-Za-z0-9_-]+$/`; точка молча ломает
   Telegram CloudStorage — выученный прод-баг). Персист **аддитивный**, STORAGE_VERSION='3' НЕ трогать.
   `persistOkRef`-гард: при сбое mount-load НЕ перезаписывать её данные.
5. **Поток фигур:** `useBlocks` ОБЯЗАН выдавать игроку `makePieceStream(level.seed)` — иначе доказательство
   проходимости генератора НЕДЕЙСТВИТЕЛЬНО. Персисти `streamPos` для резюма (продолжить ТОТ ЖЕ поток).
6. **Анимации:** если drag-drop/клиры через цепочки `setTimeout` — busy НИКОГДА не должен залипать (паттерн
   watchdog + отдельный `animTimersRef`, как в useMatch3 после freeze-fix; не обрывать ход ре-рендером).
   Если анимации простые/синхронные — проще, но всё равно не оставляй залипший busy.
7. **Экономика:** bb-ачивки `game:'bb'` под общим дневным лимитом (`isCappedCoupon` — любая тир-награда без
   `rewardId` капается). Именная веха-вершина — максимум 1. `content/rewards.json` (тир-пул) НЕ трогать.

## §3 useBlocks.ts (зеркаль useMatch3 спайси)
Статусы playing/won/lost; на старте `startLevel(bb_maxLevel + 1)` (или резюм по §2.3); ход = поставить
фигуру → clearLines → прогресс цели; набор кончился → новый из потока; победа (блоков 0) → `bb_maxLevel`
бамп ПЕРЕД grant + `blocksDepthMirror.write` + `grant('bb', снапшот, prevSnapshot)`; проигрыш (наборы 0) →
добрый ретрай (тот же level, новый seed); персист `bb_board`(незаконч.)/`bb_stats`(durable) аддитивно.
`normalizeBlocks` (готов в levels.ts) для мягкого чтения резюма.

## §4 Blocks.tsx + хаб
Drag-drop 3 фигур (Framer Motion `drag` + drop на валидную клетку, подсветка; невалид — отбой); HUD:
уровень / блоков осталось / наборов осталось; оверлеи победы (след. уровень) и поражения (добрый ретрай);
тёплый арт (emoji/блоки в палитре проекта), хаптика на клире/победе. Плитка в `Hub.tsx`, `view:'bb'` в
App.tsx, `React.lazy` (бандл не растёт).

## §5 Награды (achievements.json, game:'bb')
Вехи по `bb_maxLevel` (нелинейные пороги, edge-гейт — см. §2.1) + per-game (счёт/комбо-линии). Тиры
small/medium/large по кривой; ≤1 именной «вершины». ВСЁ под дневным лимитом. Старые ачивки не трогать.

## §6 Тесты
useBlocks: резюм (валидный/устаревший слот), победа→bb_maxLevel бамп+durable, проигрыш→ретрай. Durability:
read-repair `max(cloud, mirror)` (тест на «зеркало переживает», как depthMirror.test). **bb_maxLevel
edge-гейт: НЕ перевыдаётся на новом заходе** (зеркало achievements.test «её прод-баг»). Ключи без точек
(есть общий тест STORAGE_KEYS). Лайт/2048/match3/wordle не задеты.

## DoD
Играется из хаба (drag-drop работает); durable глубина (тест read-repair); вехи НЕ перевыдаются (edge-гейт,
тест); резюм-слот не залипает; ключи без точек; STORAGE_VERSION цел; её wallet/progress/прочие игры целы;
typecheck/test/build зелёные. Отчёт: файлы, как встроены уроки §2, список тестов. ⛔ НЕ коммить/не пушь —
ревью CTO + адверс-пасс по её данным ПЕРЕД деплоем. Деплой/`?v` — владелец.
```
