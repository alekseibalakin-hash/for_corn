import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { BUILD_TAG } from '../../ui/constants';
import { LoadingSplash } from '../../ui/components/LoadingSplash';
import { MAX_GUESSES, type W5Mode } from './wordle.types';
import { useWordle } from './useWordle';
import { WordleBoard } from './WordleBoard';
import { WordleKeyboard } from './WordleKeyboard';

interface WordleProps {
  onBack: () => void;
}

// ---- Экран выбора режима ---------------------------------------------------

interface ModeSelectProps {
  onPickDaily: () => void;
  onPickEndless: () => void;
  onBack: () => void;
}

function ModeSelect({ onPickDaily, onPickEndless, onBack }: ModeSelectProps) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          aria-label="В меню хаба"
          className="flex items-center gap-1.5 rounded-card bg-white/70 px-3 py-2 text-sm font-bold text-ink shadow-soft active:scale-95 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Меню
        </button>
      </div>

      <div className="mt-6 text-center">
        <div className="text-3xl font-extrabold text-ink">5 букв 🔤</div>
        <p className="mt-1 text-sm font-semibold text-muted">Угадай слово за 6 попыток ❤️</p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <button
          onClick={onPickDaily}
          className="flex items-center gap-4 rounded-card bg-white/80 p-5 text-left shadow-soft active:scale-[0.98] transition"
        >
          <span className="text-4xl leading-none">📅</span>
          <span className="flex flex-col">
            <span className="text-lg font-extrabold text-ink">Ежедневное</span>
            <span className="text-sm font-semibold text-muted">Одно слово в день — угадай первой ❤️</span>
          </span>
        </button>

        <button
          onClick={onPickEndless}
          className="flex items-center gap-4 rounded-card bg-white/80 p-5 text-left shadow-soft active:scale-[0.98] transition"
        >
          <span className="text-4xl leading-none">∞</span>
          <span className="flex flex-col">
            <span className="text-lg font-extrabold text-ink">Бесконечное</span>
            <span className="text-sm font-semibold text-muted">Слово за словом — расслабься и играй ❤️</span>
          </span>
        </button>
      </div>

      <p className="mt-auto text-center text-[10px] font-semibold text-muted/50">{BUILD_TAG}</p>
    </div>
  );
}

// ---- Игра ------------------------------------------------------------------

interface WordleGameProps {
  mode: W5Mode;
  onBack: () => void;
  onExitToModes: () => void;
}

function WordleGame({ mode, onBack, onExitToModes }: WordleGameProps) {
  const w = useWordle(mode);

  if (w.loading) return <LoadingSplash />;

  const modeLabel = mode === 'daily' ? '📅 Ежедневное' : '∞ Бесконечное';
  const showOverlay = w.status !== 'playing' && w.revealingRow === null;

  return (
    <div className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-4 py-3">
      {/* Шапка */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <button
          onClick={onExitToModes}
          aria-label="К выбору режима"
          className="flex items-center gap-1.5 rounded-card bg-white/70 px-3 py-2 text-sm font-bold text-ink shadow-soft active:scale-95 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Меню
        </button>
        <div className="text-center">
          <div className="text-base font-extrabold text-ink">5 букв 🔤</div>
          <div className="text-xs font-semibold text-muted">{modeLabel}</div>
        </div>
        {/* Заглушка для симметрии */}
        <div className="w-[72px]" />
      </div>

      {/* Поле (занимает остаток высоты) — прокручивается на маленьких экранах */}
      <div className="relative flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-3">
        <WordleBoard
          answer={w.answer}
          guesses={w.guesses}
          input={w.input}
          shakeRow={w.shakeRow}
          revealingRow={w.revealingRow}
          status={w.status}
        />

        {/* Оверлей финала */}
        {showOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-cream/85 backdrop-blur-[2px]">
            <div className="mx-4 rounded-card bg-white/96 p-6 text-center shadow-lift">
              {w.status === 'won' ? (
                <>
                  <div className="text-5xl">🎉</div>
                  <h2 className="mt-3 text-xl font-extrabold text-ink">Угадала!</h2>
                  <p className="mt-1 text-sm font-semibold text-muted">
                    {w.guesses.length === 1
                      ? 'С первой попытки! Вау! 💛'
                      : `С ${w.guesses.length} из ${MAX_GUESSES} попыток 💛`}
                  </p>
                </>
              ) : (
                <>
                  <div className="text-5xl">💛</div>
                  <h2 className="mt-3 text-xl font-extrabold text-ink">Не в этот раз</h2>
                  <p className="mt-1 text-sm font-semibold text-muted">Было слово:</p>
                </>
              )}

              <div className="mt-3 rounded-tile bg-board px-6 py-2 text-2xl font-extrabold tracking-widest text-ink">
                {w.answer.toUpperCase()}
              </div>

              <div className="mt-4">
                {mode === 'endless' ? (
                  <button
                    onClick={w.startNew}
                    className="rounded-card bg-primary px-8 py-3 text-sm font-extrabold text-white shadow-soft active:scale-95 transition"
                  >
                    Ещё раз ▶
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold text-muted">Новое слово завтра 📅</p>
                    <button
                      onClick={onBack}
                      className="rounded-card bg-board px-6 py-2.5 text-sm font-bold text-ink shadow-soft active:scale-95 transition"
                    >
                      В меню хаба
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Клавиатура — всегда внизу */}
      <div className="shrink-0">
        <WordleKeyboard
          letterStatuses={w.letterStatuses}
          onLetter={w.addLetter}
          onDelete={w.deleteLetter}
          onSubmit={w.submitGuess}
        />
        <p className="mt-1 text-center text-[10px] font-semibold text-muted/50">{BUILD_TAG}</p>
      </div>
    </div>
  );
}

// ---- Точка входа -----------------------------------------------------------

/**
 * Внешний Wordle: держит выбор режима (null → ModeSelect; иначе → WordleGame с key).
 * key по режиму → перемонтаж = чистый сброс состояния и таймеров при смене режима.
 */
export default function Wordle({ onBack }: WordleProps) {
  const [mode, setMode] = useState<W5Mode | null>(null);

  if (mode === null) {
    return (
      <ModeSelect
        onPickDaily={() => setMode('daily')}
        onPickEndless={() => setMode('endless')}
        onBack={onBack}
      />
    );
  }

  return (
    <WordleGame
      key={`w5-${mode}`}
      mode={mode}
      onBack={onBack}
      onExitToModes={() => setMode(null)}
    />
  );
}
