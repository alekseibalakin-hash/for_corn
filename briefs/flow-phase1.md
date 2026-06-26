# briefs/flow-phase1.md — Flow «Соедини фигурки», Фаза 1 (чистая логика)

> Спека под кодинг-сессию. Реализует ТОЛЬКО логику (без React/персиста/UI) — зеркало
> `src/games/blocks/{logic,levels}.ts` + `content`. Дизайн: [DESIGN-FLOW.md](../DESIGN-FLOW.md).
> Три якоря продакта: нарастающая сложность · много · ВСЕ проходимы. Уроки: [[love2048-game-flow]].

## §0. Граница Фазы 1
ВХОДИТ: чистые модули `flow/logic.ts`, `flow/levels.ts`, `content/flow.json` + типы/валидатор в `content/`,
+ тесты. НЕ ВХОДИТ (Фаза 2): React, персист, награды, durability, drag, ключи хранилища. Код Фазы 1 НЕ
коммитим в прод до Фазы 2 (как Блоки). `STORAGE_VERSION` не трогаем нигде.

## §1. Файлы
- `src/games/flow/logic.ts` — типы поля/пути + валидаторы (без React).
- `src/games/flow/levels.ts` — генератор-конструктор + солвер-witness + `generateLevel` (тотальная) + резюм-хелперы.
- `content/flow.json` — бэнды сложности.
- `src/content/types.ts` — `FlowBand`, `FlowConfig` (аддитивно).
- `src/content/index.ts` — `flowConfig`, `flowBandForLevel`, `validateFlowBands` (аддитивно, вызвать из `validateContent`).
- Тесты: `src/games/flow/logic.test.ts`, `src/games/flow/levels.test.ts`, +кейсы в `content.test.ts`.
- RNG: переиспользовать `mulberry32` из `src/engine/rng` (seeded, детерминизм — как Блоки/спайси).

## §2. Модель данных (logic.ts)
```ts
type Coord = { r: number; c: number };
type Cell = number | null;            // индекс цвета/пары (0..K-1) или null = пусто
type Grid = Cell[][];                  // N×N, для рендера/проверок
interface FlowPair { figure: string; color: string; a: Coord; b: Coord; } // a,b = концы
interface FlowLevel {
  level: number; seed: number; size: number;          // N
  pairs: FlowPair[];                                   // K пар (загадка)
  solution: Coord[][];                                 // [пара] → путь концы→концы (ДОКАЗАТЕЛЬСТВО, для тестов/хинта)
}
interface FlowCurrentGame { score: number; moves: number; }   // per-game (Фаза 2 наградный слой)
interface FlowLevelState {                              // персист-слот (Фаза 2), мягко читается
  level: number; seed: number; size: number;
  pairs: FlowPair[];                                   // ЯВНО (не регенерим из seed — иначе смена генератора рассинхронит слот; урок Блоков)
  paths: Coord[][];                                    // текущий прогресс игрока по парам (может быть пустым)
  game: FlowCurrentGame;
}
```
Валидаторы (logic.ts, чистые, НЕ кидают):
- `adjacent(a,b)` — ортогональные соседи (|dr|+|dc|==1).
- `isSimplePath(cells)` — непустой, соседние подряд, без повторов.
- `isValidFlowSolution(size, pairs, solution): boolean` — **ПРЯМОЕ доказательство проходимости** (НЕ через
  солвер §4, чтобы не было циркулярности): каждый `solution[i]` — простой путь от `pairs[i].a` до
  `pairs[i].b`; пути не пересекаются; объединение покрывает ВСЕ N×N клеток ровно раз.
- `isSolvedByPlayer(size, pairs, paths): boolean` — детектор победы: каждый путь соединяет свои концы +
  всё поле заполнено + нет наложений. (Фаза 2 зовёт на каждый drop.)

## §3. Генерация-КОНСТРУКЦИЯ (ядро — Якорь «проходимы», levels.ts)
**`randomHamiltonian(size, rng): Coord[] | null`** — случайный путь через ВСЕ клетки (по разу):
- рандомизированный backtracking-DFS от случайной клетки; на каждом шаге — случайный непосещённый сосед;
  **эвристика Варнсдорфа** (предпочесть соседа с наименьшим числом дальнейших ходов) для скорости.
- жёсткий потолок шагов `HAMILTON_STEP_CAP` (напр. size*size*200) → при стуке вернуть null (caller ретраит).
- **Гарантия тотальности:** `boustrophedonPath(size)` (змейка) — ВСЕГДА гамильтонов; финальный фолбэк, если
  рандом не дал. ⇒ покрывающий путь существует ВСЕГДА.

**`cutIntoSegments(path, k, rng, minSeg): Coord[][]`** — режет путь на k смежных сегментов, каждый длиной
≥ `minSeg` (анти-тривиальность). Если k*minSeg > path.length — уменьшить k (caller учитывает фактический k).

**`buildLevel(level, seed, size, k): FlowLevel`** — `randomHamiltonian`(или змейка) → `cutIntoSegments` →
сегмент i = `solution[i]`, его концы = `pairs[i].{a,b}`, фигура/цвет из набора (детерминированно по индексу).
Возвращает FlowLevel. **`isValidFlowSolution` на нём ОБЯЗАН быть true** (инвариант построения).

## §4. Солвер-witness — ТОЛЬКО качество (НЕ проходимость), levels.ts
Проходимость уже из §3. Солвер нужен для уникальности/нетривиальности:
**`countFlowSolutions(size, pairs, limit, nodeCap): number`** — backtracking-солвер потока:
- расширяем пути от концов / заполняем по клеткам; находим до `limit` решений (для уникальности limit=2).
- **прунинг (обязателен, иначе виснет):** (1) тупик — пустая не-конец клетка с <1 свободным соседом
  недостижима → отсечь; (2) reachability — для каждой недособранной пары концы должны оставаться
  связуемы через свободные клетки (BFS), иначе отсечь.
- **`SOLVE_NODE_CAP`** (напр. 200_000): при превышении вернуть сентинел «не определено» → кандидат
  отбраковывается (перегенерим), на парашюте — принимаем.
Качество-гейт кандидата (по бэнду §5): уникальность (`countFlowSolutions(...,2,cap)===1`), нет
тривиальных пар (сегмент-из-2 с соседними концами), `minBendRatio` (доля «поворотов» по всем сегментам).

## §5. `generateLevel(level, seed): FlowLevel` — ТОТАЛЬНАЯ (Якоря «много»+«проходимы»)
```
band = flowBandForLevel(level)
for attempt in 0..MAX_RETRIES:               // напр. 60
  aSeed = mix(seed, attempt)
  k = randInt(rng, band.pairsMin, band.pairsMax)
  lvl = buildLevel(level, aSeed, band.size, k)        // ВСЕГДА валиден по построению
  if passesQualityGate(lvl, band): return lvl         // уникальность/нетривиальность/изгиб
// ПАРАШЮТ: качество не добралось — отдаём построенный (он ПРОХОДИМ; isValidFlowSolution=true)
return buildLevel(level, mix(seed, 0xPARA), band.size, max(band.pairsMin, 2))
```
Гарантии: НИКОГДА не кидает, ВСЕГДА возвращает уровень с `isValidFlowSolution===true` (проходим).
Детерминизм: тот же (level,seed) → идентичный FlowLevel.

Резюм-хелперы (зеркало Блоков):
- `flowStateFromLevel(lvl): FlowLevelState` — свежий старт: pairs из lvl, paths=[] (пустые), game={0,0}.
- `normalizeFlow(raw): FlowLevelState | null` — мягкое чтение слота: битое/частичное → null, НИКОГДА не кидает
  (зеркало `normalizeBlocks`). Валидирует size/pairs/paths/game, дробные округляет.
- `isResumableFlowSlot(saved, flMaxLevel): boolean` — `!!saved && saved.level === flMaxLevel + 1` (урок L25).

## §6. content/flow.json — бэнды (СТАРТОВЫЕ значения, калибруются тестами §7)
`FlowBand = { maxLevel, size, pairsMin, pairsMax, minBendRatio, colorOff?: boolean }`. Монотонно:
```
{ maxLevel: 3,  size: 5, pairsMin: 3, pairsMax: 4, minBendRatio: 0.20 }
{ maxLevel: 7,  size: 6, pairsMin: 4, pairsMax: 5, minBendRatio: 0.28 }
{ maxLevel: 12, size: 6, pairsMin: 5, pairsMax: 6, minBendRatio: 0.34 }
{ maxLevel: 18, size: 7, pairsMin: 5, pairsMax: 7, minBendRatio: 0.40 }
{ maxLevel: 25, size: 8, pairsMin: 6, pairsMax: 8, minBendRatio: 0.45 }
{ maxLevel: 999,size: 8, pairsMin: 6, pairsMax: 9, minBendRatio: 0.50, colorOff: true }
```
`validateFlowBands`: size не убывает; 2 ≤ pairsMin ≤ pairsMax ≤ size+2; size ≤ 8 (потолок честности/скорости);
minBendRatio ∈ [0,1] и не убывает; maxLevel возрастает. Вызвать из `validateContent` (как `validateBlocksBands`).

## §7. Тесты (гейт Фазы 1)
**ПРАВИЛО №1 (главный, зеркало blocks/levels.test):** `for level in 1..30, seed in [1,2,7,42,99,777,31337]`:
- `lvl = generateLevel(level, seed)`;
- **`isValidFlowSolution(lvl.size, lvl.pairs, lvl.solution) === true`** — ПРЯМАЯ проверка проходимости
  (покрытие всех клеток + пути валидны), НЕ через солвер (нециркулярно);
- `lvl.pairs.length` в [band.pairsMin..pairsMax] (или парашют ≥2); концы все различны, в пределах поля;
- `countFlowSolutions(lvl, 1, cap) ≥ 1` — солвер находит решение (sanity; обычно = конструкция);
- таймаут на всё ≤ 60s (как блоки) — следим за скоростью генератора/солвера.
Прочее:
- детерминизм: `generateLevel(L,S)` дважды → deepEqual.
- кривая: `flowBandForLevel(1).size ≤ flowBandForLevel(25).size`; minBendRatio не убывает; size ≤ 8 для 1..50.
- `randomHamiltonian`: покрывает все клетки, простой путь (для size 5..8 × seeds); змейка-фолбэк всегда валидна.
- `normalizeFlow`: не кидает на [null, 42, '', {}, [], {level:-1}, битый pairs/paths]; валидный слот round-trip;
  дробные округляются.
- `isResumableFlowSlot`: level===max+1 → true; ≤max / >max+1 / null → false.
- `countFlowSolutions`: на сконструированном уровне ≥1; на заведомо-уникальном ==1; уважает nodeCap (не виснет).

## §8. Анти-циркулярность и риски (явно)
- Проходимость доказывается **конструкцией + `isValidFlowSolution`** (прямая проверка покрытия), НЕ солвером.
  Солвер — независимый witness качества. Тест §7 проверяет именно конструкцию ⇒ нет круга «солвер сам себя».
- Casual-винрейт-модель НЕ нужна (Flow — чистая дедукция без случайности; решаемо ⇒ аккуратный игрок решит).
- Скорость: гамильтон на 8×8 и солвер уникальности — потенциально медленные. Жёсткие потолки
  (`HAMILTON_STEP_CAP`, `SOLVE_NODE_CAP`) + парашют ⇒ генератор тотален и не виснет. Если уникальность на
  8×8 окажется дорогой — допустимо ослабить гейт до структурного (изгиб+нетривиальность) без уникальности:
  Якоря (проходим/много/сложнее) ОСТАЮТСЯ выполнены, теряем лишь «одно решение». Отметить в ревью.

## §9. После Фазы 1
Ревью + адверс-пас (особое внимание: тотальность generateLevel, скорость, нет непроходимых, детерминизм).
Затем Фаза 2 (briefs/flow-phase2.md): UI/drag/награды/durability/резюм — зеркало Блоков, с адверс-гейтом
безопасности кошелька перед выкатом к ней.
