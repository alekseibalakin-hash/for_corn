import { useCallback, useEffect, useRef, useState } from 'react';
import { useRewards } from '../../rewards';
import {
  betterStatus,
  getDateKey,
  MAX_GUESSES,
  normalizeW5,
  normalizeW5Daily,
  normalizeW5Stats,
  scoreGuess,
  REVEAL_PER_TILE_MS,
  WORD_LEN,
  type LetterStatus,
  type W5Mode,
  type W5DailyState,
  type W5Stats,
} from './wordle.types';
import { localYMD, previousYMD, type StatSnapshot } from '../../engine';
import { mulberry32, seededShuffle } from '../../engine/rng';
import answersRaw from '../../../content/wordle/answers.json';
import allowedRaw from '../../../content/wordle/allowed.json';

export const ANSWERS: readonly string[] = answersRaw as string[];
const ALLOWED_SET = new Set<string>(allowedRaw as string[]);

// Фикс-сид: перемешиваем список один раз при загрузке модуля.
// Одинаковый сид на всех устройствах → слово дня одинаково для всех.
// Полный цикл без повторов = ANSWERS.length дней.
const DAILY_SEED = 0x9e3779b1;
export const SHUFFLED_ANSWERS: readonly string[] = seededShuffle(ANSWERS, mulberry32(DAILY_SEED));

// Полное время раскрытия одной строки: последний тайл стартует в (WORD_LEN-1)*300, флип 300мс
const REVEAL_TOTAL_MS = (WORD_LEN - 1) * REVEAL_PER_TILE_MS + 350;

export function isAllowedWord(word: string): boolean {
  return ALLOWED_SET.has(word);
}

export function getDailyWord(): string {
  return SHUFFLED_ANSWERS[getDateKey() % SHUFFLED_ANSWERS.length];
}

export function getRandomWord(): string {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}

/** Плоский snapshot для движка ачивок (только числовые поля, без lastDailyWonDate). */
function buildW5Snapshot(stats: W5Stats): StatSnapshot {
  return {
    w5_dailyPlayed: stats.dailyPlayed,
    w5_dailyWins: stats.dailyWins,
    w5_endlessPlayed: stats.endlessPlayed,
    w5_endlessWins: stats.endlessWins,
    w5_bestGuess: stats.bestGuess,
    w5_dailyStreak: stats.w5_dailyStreak,
    w5_maxDailyStreak: stats.w5_maxDailyStreak,
  };
}

/** Обновляет дневную серию побед (только для daily-режима, идемпотентно в сутки). */
function updateW5Streak(stats: W5Stats, today: string): W5Stats {
  if (stats.lastDailyWonDate === today) return stats;
  const continued = stats.lastDailyWonDate === previousYMD(today);
  const w5_dailyStreak = continued ? stats.w5_dailyStreak + 1 : 1;
  return {
    ...stats,
    w5_dailyStreak,
    w5_maxDailyStreak: Math.max(stats.w5_maxDailyStreak, w5_dailyStreak),
    lastDailyWonDate: today,
  };
}

/**
 * Хук «5 букв». Держит состояние партии, персистит через репозиторий.
 *
 * 🔒 Гард данных: loadOkRef=false при сбое mount-загрузки → saveDaily/saveStats
 * возвращаются ранее (не перезаписывают реальные данные дефолтом).
 * Образец: useMatch3/useGame2048/RewardsProvider (бриф §11).
 */
export function useWordle(mode: W5Mode) {
  const rewards = useRewards();
  const repo = rewards.repo;

  const [loading, setLoading] = useState(true);
  const [answer, setAnswerState] = useState('');
  const [guesses, setGuessesState] = useState<string[]>([]);
  const [status, setStatusState] = useState<'playing' | 'won' | 'lost'>('playing');
  const [input, setInput] = useState('');
  const [shakeRow, setShakeRow] = useState<number | null>(null);
  // Индекс строки, которая прямо сейчас «переворачивается» (reveal-анимация).
  const [revealingRow, setRevealingRowState] = useState<number | null>(null);
  const [stats, setStatsState] = useState<W5Stats>(normalizeW5Stats(null));

  // Зеркала для синхронного чтения в обработчиках и таймерах.
  const answerRef = useRef(answer);
  const guessesRef = useRef(guesses);
  const statusRef = useRef(status);
  const statsRef = useRef(stats);
  const revealingRef = useRef(revealingRow);
  const setAnswer = (v: string) => { answerRef.current = v; setAnswerState(v); };
  const setGuesses = (v: string[]) => { guessesRef.current = v; setGuessesState(v); };
  const setStatus = (v: 'playing' | 'won' | 'lost') => { statusRef.current = v; setStatusState(v); };
  const setStats = (v: W5Stats) => { statsRef.current = v; setStatsState(v); };
  const setRevealingRow = (v: number | null) => { revealingRef.current = v; setRevealingRowState(v); };

  // Если mount-загрузка бросила исключение — НЕ пишем ничего (бриф §11).
  const loadOkRef = useRef(true);

  const aliveRef = useRef(true);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const after = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id);
      if (aliveRef.current) fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  const saveDaily = useCallback(
    (d: W5DailyState) => {
      if (!loadOkRef.current) return; // mount-load упал — не рискуем затереть реальные данные
      void repo.saveW5Daily(d).catch((err) => console.warn('[w5] не удалось сохранить w5.daily:', err));
    },
    [repo],
  );

  const saveStats = useCallback(
    (s: W5Stats) => {
      if (!loadOkRef.current) return;
      void repo.saveW5Stats(s).catch((err) => console.warn('[w5] не удалось сохранить w5.stats:', err));
    },
    [repo],
  );

  // ---- Загрузка. После boot наградного слоя (Shell гейтит на rewards.loading). ----
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const [dailyP, statsP] = await Promise.all([repo.loadW5Daily(), repo.loadW5Stats()]);
        if (cancelled) return;

        loadOkRef.current = true;
        const loadedStats = normalizeW5Stats(statsP);
        setStats(loadedStats);

        if (mode === 'daily') {
          const today = getDateKey();
          const word = getDailyWord();
          const saved = normalizeW5Daily(dailyP);

          if (saved && saved.dateKey === today) {
            // Уже играли сегодня — восстанавливаем без анимации
            setAnswer(word);
            setGuesses(saved.guesses.map(normalizeW5));
            setStatus(saved.status);
            setRevealingRow(null);
          } else {
            // Новый день
            setAnswer(word);
            setGuesses([]);
            setStatus('playing');
          }
        } else {
          // Endless: случайное слово, статы обновим при завершении
          setAnswer(getRandomWord());
          setGuesses([]);
          setStatus('playing');
        }

        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.warn('[w5] загрузка не удалась, играем без персиста:', err);
        loadOkRef.current = false; // mount-load упал ⇒ НЕ пишем (не затираем реальные данные)
        setAnswer(mode === 'daily' ? getDailyWord() : getRandomWord());
        setGuesses([]);
        setStatus('playing');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, mode]);

  const addLetter = useCallback((letter: string) => {
    if (statusRef.current !== 'playing') return;
    if (revealingRef.current !== null) return;
    const normalized = normalizeW5(letter);
    if (!/^[а-я]$/.test(normalized)) return;
    setInput((prev) => (prev.length < WORD_LEN ? prev + normalized : prev));
  }, []);

  const deleteLetter = useCallback(() => {
    if (revealingRef.current !== null) return;
    setInput((prev) => prev.slice(0, -1));
  }, []);

  const submitGuess = useCallback(() => {
    const word = normalizeW5(input);
    if (word.length !== WORD_LEN) return;
    if (statusRef.current !== 'playing') return;
    if (revealingRef.current !== null) return;

    if (!ALLOWED_SET.has(word)) {
      // Невалидное слово: встряхиваем текущую строку
      const rowIdx = guessesRef.current.length;
      setShakeRow(rowIdx);
      after(550, () => setShakeRow(null));
      return;
    }

    const newGuesses = [...guessesRef.current, word];
    const rowIdx = newGuesses.length - 1;
    setGuesses(newGuesses);
    setInput('');
    setRevealingRow(rowIdx);

    // Сохраняем прогресс немедленно (защита от краша во время анимации)
    if (mode === 'daily') {
      saveDaily({ dateKey: getDateKey(), guesses: newGuesses, status: 'playing' });
    }

    after(REVEAL_TOTAL_MS, () => {
      setRevealingRow(null);

      const won = word === answerRef.current;
      const lost = !won && newGuesses.length >= MAX_GUESSES;
      const newStatus: 'playing' | 'won' | 'lost' = won ? 'won' : lost ? 'lost' : 'playing';
      setStatus(newStatus);

      if (newStatus !== 'playing') {
        const prev = statsRef.current;
        const isDaily = mode === 'daily';
        const baseNext: W5Stats = {
          ...prev,
          dailyPlayed: isDaily ? prev.dailyPlayed + 1 : prev.dailyPlayed,
          dailyWins: isDaily && won ? prev.dailyWins + 1 : prev.dailyWins,
          endlessPlayed: !isDaily ? prev.endlessPlayed + 1 : prev.endlessPlayed,
          endlessWins: !isDaily && won ? prev.endlessWins + 1 : prev.endlessWins,
          bestGuess: won
            ? prev.bestGuess === 0
              ? newGuesses.length
              : Math.min(prev.bestGuess, newGuesses.length)
            : prev.bestGuess,
        };
        const next = won && isDaily ? updateW5Streak(baseNext, localYMD(Date.now())) : baseNext;
        setStats(next);
        saveStats(next);

        if (mode === 'daily') {
          saveDaily({ dateKey: getDateKey(), guesses: newGuesses, status: newStatus });
        }

        rewards.grant('w5', buildW5Snapshot(next), buildW5Snapshot(prev));
        rewards.notifyGameEnded(); // #5 (адверс-ревью): hub-wide счётчик партий для реверс-подарка (§B2)
      }
    });
  }, [input, after, mode, saveDaily, saveStats, rewards]);

  // Физическая клавиатура (для тестирования на десктопе).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') { submitGuess(); return; }
      if (e.key === 'Backspace') { deleteLetter(); return; }
      addLetter(e.key);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submitGuess, addLetter, deleteLetter]);

  /** Новая игра (только для endless). */
  const startNew = useCallback(() => {
    if (mode !== 'endless') return;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setAnswer(getRandomWord());
    setGuesses([]);
    setStatus('playing');
    setInput('');
    setRevealingRow(null);
    setShakeRow(null);
  }, [mode]);

  // Цвета клавиш: лучший достигнутый статус по уже раскрытым строкам.
  const revealedCount = revealingRow !== null ? revealingRow : guesses.length;
  const letterStatuses: Record<string, LetterStatus> = {};
  for (let r = 0; r < revealedCount; r++) {
    const res = scoreGuess(guesses[r], answer);
    for (let c = 0; c < WORD_LEN; c++) {
      const l = guesses[r][c];
      if (!letterStatuses[l] || betterStatus(res[c], letterStatuses[l])) {
        letterStatuses[l] = res[c];
      }
    }
  }

  return {
    loading,
    answer,
    guesses,
    status,
    input,
    shakeRow,
    revealingRow,
    letterStatuses,
    addLetter,
    deleteLetter,
    submitGuess,
    startNew,
  };
}

export type WordleApi = ReturnType<typeof useWordle>;
