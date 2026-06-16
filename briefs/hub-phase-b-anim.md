# Бриф — Match-3: плавная анимация (переделка анимационного слоя)

> Вставь блок в кодинг-сессию. Это переделка ВИЗУАЛА Match-3 (Phase B в рабочем дереве, НЕ
> задеплоено). Подход выверен и адверсариально проверен (smooth/tapFixed/noRegression = ok).
> Жалобы пользователя: анимации рваные/некрасивые; тап по спецу «не сработал» (на деле он
> реализован, но длинный busy из-за лагов глотал тап). Оба чинит плавная анимация.

---

```
Match-3, ПЕРЕДЕЛКА АНИМАЦИИ (Phase B, та же кодовая база). Текущий визуал рваный: у фишек нет
стабильного id, поле рендерится по позициям, GemCell перемонтируется по value-key → фишки не
ПАДАЮТ, а «вспыхивают» на месте (pop-in scale 0.55→1) каждый шаг каскада; на каждом спеце вечный
пульс. Цель: настоящее плавное падение, как в 2048 (src/ui/tiles.ts + components/Board.tsx +
Tile.tsx — ИЗУЧИ их, это эталон). Тап-детонация спеца УЖЕ работает (logic.activateInPlace →
useMatch3.activateAt → Match3.handleTap) — НЕ сломать, только перестать глотать тап длинным busy.

Работай ТОЛЬКО в этой папке. Не трогай: src/games/match3/logic.ts (НИКАКИХ id в Gem/Board —
это гарантия 175 тестов), src/game/*, src/ui/tiles.ts, наградный слой, STORAGE_VERSION, 2048.

1) НОВЫЙ src/games/match3/gems.ts — UI-адаптер, ЗЕРКАЛО src/ui/tiles.ts (id живёт ТОЛЬКО здесь):
   - interface VisualGem { id:number; type:GemType; special?:Special; r:number; c:number; isNew:boolean; justMade?:boolean }
   - let idCounter=1; const nextId=()=>idCounter++  (как tiles.ts)
   - boardToGems(board): VisualGem[] — свежий id каждой непустой клетке, isNew:false. Зовётся на
     load / new-game / reshuffle / финальный settled-board.
   - gemsToBoard(gems): Board — сворачивает в plain {type,special} (id ОТБРАСЫВАЕТСЯ) для logic и
     персиста (зеркало tilesToGrid).
   - applyStep(prev:VisualGem[], step:CascadeStep): VisualGem[] — ВОСПРОИЗВЕСТИ ту же
     последовательность, что logic.step (logic.ts ~379-396), СОХРАНЯЯ id выживших:
       a) ретайрить (НЕ переносить id) гемы на позициях step.cleared И на позициях step.created
          (под создаваемый спец старый гем не выживает);
       b) created → НОВЫЙ VisualGem (nextId, justMade:true, type/special из step.created) на
          ПРЕД-гравитационной клетке created.r/c;
       c) ГРАВИТАЦИЯ один-в-один с logic.applyGravity (logic.ts ~208-216: по столбцам, write=SIZE-1,
          r=SIZE-1..0) — живые и created оседают вниз, СОХРАНЯЯ свои id, получая новые (r,c);
       d) верхние «дыры» столбца = рефилл: НОВЫЙ id, isNew:true, type/special из step.board[r][c]
          (источник истины по типам новых), финальная (r,c).
   ⚠ created.r/c — ПРЕД-гравитационная позиция; step.board[r][c] — ПОСТ-гравитация. НЕ брать тип
     created из step.board и НЕ ставить created сразу на финальную клетку — прогнать через гравитацию.

2) НОВЫЙ src/games/match3/gems.test.ts — ОБЯЗАТЕЛЬНЫЕ тесты (это замок от десинка, logic-тесты его НЕ ловят):
   - round-trip: gemsToBoard(boardToGems(b)) == b по {type,special};
   - ИНВАРИАНТ ГРАВИТАЦИИ: для серии шагов resolveSwap с фикс. seed (mulberry32; переиспользуй
     многокаскадный сетап из logic.test.ts) — gemsToBoard(applyStep(prev, step)) поэлементно
     == step.board по {type,special} НА КАЖДОМ шаге;
   - id-отношения: id выжившей (упавшей) фишки сохранён до/после applyStep; created/рефилл
     получили НОВЫЕ id. Проверять ОТНОШЕНИЯ, не конкретные числа (idCounter глобален).

3) src/games/match3/useMatch3.ts:
   - Добавить gems-состояние: const [gems,setGemsState]=useState<VisualGem[]>([]) + gemsRef + setGems.
   - На load / new-game / reshuffle / finishMove(settled): setGems(boardToGems(board)).
   - playResolve (пошаговый каскад): на settle-тике setGems(applyStep(gemsRef.current, st)) ВМЕСТО
     одного setBoard(st.board). board держим ПАРАЛЛЕЛЬНО (для logic/тача/handleTap).
   - swap: перед playResolve поменять (r,c) у ДВУХ VisualGem по id (чтоб слайдились); невалидный
     своп (revert) — своп+возврат и на gems.
   - board ОСТАВИТЬ в возврате хука (handleTap:172 и activateAt читают m3.board[r][c].special —
     удаление сломает тап-выбор и тап-детонацию). Отдавать gemsToBoard(gemsRef.current) или
     параллельный boardRef. Вернуть gems в API.
   - finishMove/buildM3Snapshot/prevSnapshot/rewards.grant НЕ менять (edge-triggering и награды от
     визуала не зависят). persist: gemsToBoard перед saveMatch3Board → PersistedMatch3 без id (форма
     не меняется). НЕ персистить VisualGem[] с id.
   - Тайминги (useMatch3 ~34-37): SWAP_MS 130→160, CLEAR_MS 200→140, SETTLE_MS 150→220
     (≈ время осёдки layout-spring stiffness700/damping42; короче → следующий шаг стартует посреди
     падения = джиттер), REVERT_MS 160. Если на телефоне дёргается при N≥3 каскадах — поднять
     SETTLE_MS или layout='position'.

4) src/games/match3/Match3.tsx — двухслойный рендер (как Board.tsx 2048):
   - ПОДЛОЖКА: статичная сетка 64 пустых bg-cell (grid-cols-8 grid-rows-8 gap-1) — «дыры» при падении.
   - СЛОЙ ГЕМОВ: <AnimatePresence><div className="absolute inset-2 grid grid-cols-8 grid-rows-8 gap-1">
     {m3.gems.map(g => <GemCell key={g.id} gem={g} selected=.../>)}</div></AnimatePresence>
   - GemCell = motion.div (как Tile.tsx): layout; style={{ gridColumnStart:g.c+1, gridRowStart:g.r+1 }};
     initial={ g.isNew ? { y:'-110%', opacity:0 } : false }; animate={{ y:0, opacity:1, scale: g.justMade ? [1,1.18,1] : 1 }};
     exit={{ scale:0.2, opacity:0 }}; transition={{ layout:{ type:'spring', stiffness:700, damping:42 }, default:{ duration:0.16 }, scale:{ duration:0.18, ease:'easeOut' } }}.
   - УДАЛИТЬ: initial scale:0.55 pop-in; value-key key=`${type}-${special}` (критично — иначе React
     ремоунтит при смене типа и падение не сыграет, ключ ТОЛЬКО g.id); вечный пульс (repeat:Infinity).
     Спецфишку отличать СТАТИЧНЫМ glow/значком (specialClasses) + разовый justMade-pop.
   - НЕ трогать: handleTap, cellFromPoint (по rect gridRef — повесить gridRef на контейнер геометрии
     8×8 поля), тач-слой {passive:false}+preventDefault, suppressClick, FX-слой (круги+💥 поверх
     настоящего падения — искры, не подмена движения), кнопки/счёт.
   - Анимировать ТОЛЬКО transform/opacity (GPU). Никаких box-shadow/color в хот-пути.

5) Метку сборки BUILD_TAG (constants.ts) подними при выкатке Phase B (сейчас 'v6' → 'v7').

Definition of done:
- npm run typecheck, npm test (175 существующих ЦЕЛЫ + новые gems.test.ts), npm run build — зелёное;
  Match3 — отдельный ленивый чанк.
- Инвариант-тест gemsToBoard(applyStep)==step.board проходит на многокаскадном seed (must-have).
- Прогон вживую (браузер, ?reset): своп → фишки реально ПАДАЮТ (без вспышек на месте), рефилл
  влетает сверху; собрать 4-в-ряд → спец со статичным glow + один pop; ТАП по спецу → детонация
  СРАЗУ (busy короткий, тап не глотается); каскады плавные; 2048 не сломан.
- Отчёт: что в gems.ts/applyStep, изменения useMatch3/Match3, тайминги, что осталось.
```

---

## Что проверит CTO-сессия после переделки
- Инвариант gemsToBoard(applyStep)==step.board (синхронизация гравитации адаптера с logic) — есть и зелёный.
- logic.ts не тронут; 175 существующих тестов целы; id только в gems.ts; персист без id (форма PersistedMatch3 не изменилась).
- Визуал: настоящее падение (layout-spring), нет pop-in/value-key/вечного пульса; FX поверх движения.
- Тап-детонация спеца жива и срабатывает сразу (короткий busy); своп/свайп целы.
- Данные жены/2048/кошелёк/edge-triggering — без регресса; STORAGE_VERSION='3'.
- Живой прогон: плавность + отзывчивый тап по спецу.
