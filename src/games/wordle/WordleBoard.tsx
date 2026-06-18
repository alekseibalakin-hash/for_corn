import { useEffect, useState } from 'react';
import { MAX_GUESSES, REVEAL_PER_TILE_MS, scoreGuess, WORD_LEN, type LetterStatus } from './wordle.types';

// ---- Тайл ----------------------------------------------------------------

function statusTileClass(status: LetterStatus): string {
  switch (status) {
    case 'correct':
      return 'bg-[var(--w5-correct)] border-[var(--w5-correct)] text-white';
    case 'present':
      return 'bg-[var(--w5-present)] border-[var(--w5-present)] text-white';
    case 'absent':
      return 'bg-[var(--w5-absent)] border-[var(--w5-absent)] text-white/90';
  }
}

interface TileProps {
  /** Буква (строчная, нормализованная). Пустая строка = пустой тайл. */
  letter: string;
  /** Статус раскрытия (null = ещё не раскрыт). */
  status: LetterStatus | null;
  /** Тайл прямо сейчас в процессе flip-анимации. */
  isRevealing: boolean;
  /** Задержка старта анимации в мс (стагер по колонкам). */
  delayMs: number;
  /** Прыжок победного тайла (только для выигрышной строки). */
  isBouncing: boolean;
  bounceDelay: number;
}

/**
 * Один тайл 5 букв. Flip-анимация реализована через React-state:
 *  phase 0 → scaleY(1), без цвета
 *  phase 1 → scaleY(0) [«на ребре», цвет ещё не виден]
 *  phase 2 → scaleY(1) с финальным цветом
 * Переход 0→1 за 150 мс, 1→2 за 150 мс. Задержка старта = delayMs (стагер).
 */
function Tile({ letter, status, isRevealing, delayMs, isBouncing, bounceDelay }: TileProps) {
  // Инициализируем phase=2 если уже раскрыт (загрузка из стораджа — без анимации).
  const [phase, setPhase] = useState<0 | 1 | 2>(() => (status && !isRevealing ? 2 : 0));
  const [showColor, setShowColor] = useState<boolean>(() => !!(status && !isRevealing));

  useEffect(() => {
    if (!isRevealing) {
      // Не анимируем: если есть статус → показать цвет, иначе сбросить.
      setPhase(status ? 2 : 0);
      setShowColor(!!status);
      return;
    }
    // Flip-анимация со стагером
    setPhase(0);
    setShowColor(false);
    const t1 = setTimeout(() => setPhase(1), delayMs);
    const t2 = setTimeout(() => {
      setShowColor(true);
      setPhase(2);
    }, delayMs + 150);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isRevealing, delayMs, status]);

  const scaleY = phase === 1 ? 0 : 1;

  return (
    <div
      style={{
        transform: `scaleY(${scaleY})`,
        transition: isRevealing ? 'transform 0.15s ease-in-out' : undefined,
        animationDelay: isBouncing ? `${bounceDelay}ms` : undefined,
      }}
      className={[
        'flex aspect-square w-full items-center justify-center rounded-tile',
        'border-2 text-lg font-extrabold select-none uppercase leading-none',
        showColor && status ? statusTileClass(status) : letter ? 'border-ink/30 bg-cell text-ink' : 'border-board/60 bg-cell',
        isBouncing ? 'animate-w5-bounce' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {letter.toUpperCase()}
    </div>
  );
}

// ---- Строка ----------------------------------------------------------------

interface RowProps {
  /** Отправленное слово (5 букв, нормализованное). Undefined = незаполненная строка. */
  word?: string;
  /** Результат раскраски (только для отправленных строк). */
  result?: LetterStatus[];
  /** Буквы текущего ввода (только для активной строки). */
  inputLetters?: string;
  /** Строка прямо сейчас переворачивается. */
  isRevealing?: boolean;
  /** Строка встряхивается (невалидное слово). */
  isShaking?: boolean;
  /** Строка победная и тайлы прыгают. */
  isBouncing?: boolean;
}

function BoardRow({ word, result, inputLetters, isRevealing, isShaking, isBouncing }: RowProps) {
  return (
    <div className={`grid grid-cols-5 gap-1.5 ${isShaking ? 'animate-w5-shake' : ''}`}>
      {Array.from({ length: WORD_LEN }, (_, c) => {
        const letter = word ? word[c] : (inputLetters?.[c] ?? '');
        const status = result?.[c] ?? null;
        return (
          <Tile
            key={c}
            letter={letter}
            status={status}
            isRevealing={!!isRevealing}
            delayMs={c * REVEAL_PER_TILE_MS}
            isBouncing={!!isBouncing}
            bounceDelay={c * 100}
          />
        );
      })}
    </div>
  );
}

// ---- Поле 5×6 --------------------------------------------------------------

interface WordleBoardProps {
  answer: string;
  guesses: string[];
  input: string;
  shakeRow: number | null;
  revealingRow: number | null;
  status: 'playing' | 'won' | 'lost';
}

export function WordleBoard({ answer, guesses, input, shakeRow, revealingRow, status }: WordleBoardProps) {
  const rows = Array.from({ length: MAX_GUESSES }, (_, r) => {
    const isSubmitted = r < guesses.length;
    const isActive = r === guesses.length && revealingRow === null;
    const isRevealingNow = r === revealingRow;
    const isShaking = r === shakeRow;
    const wonRow = guesses.length - 1;
    const isBouncing = status === 'won' && r === wonRow && revealingRow === null;

    if (isSubmitted) {
      const result = scoreGuess(guesses[r], answer);
      return (
        <BoardRow
          key={r}
          word={guesses[r]}
          result={result}
          isRevealing={isRevealingNow}
          isShaking={isShaking}
          isBouncing={isBouncing}
        />
      );
    }
    if (isActive) {
      return <BoardRow key={r} inputLetters={input} isShaking={isShaking} />;
    }
    return <BoardRow key={r} />;
  });

  return <div className="flex w-full flex-col gap-1.5">{rows}</div>;
}
