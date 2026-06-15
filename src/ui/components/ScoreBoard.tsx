import { RotateCcw, Trophy } from 'lucide-react';

interface ScoreBoardProps {
  score: number;
  best: number;
  streak: number;
  onNewGame: () => void;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-card bg-board px-4 py-1.5 text-center">
      <div className="text-[0.65rem] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-lg font-extrabold leading-tight text-ink">{value}</div>
    </div>
  );
}

export function ScoreBoard({ score, best, streak, onNewGame }: ScoreBoardProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Stat label="Очки" value={score} />
        <Stat label="Лучший" value={best} />
        {streak > 1 && (
          <div className="flex items-center gap-1 rounded-card bg-primary/10 px-3 py-1.5 text-primary">
            <Trophy className="h-4 w-4" />
            <span className="text-sm font-extrabold">{streak} дн</span>
          </div>
        )}
      </div>
      <button
        onClick={onNewGame}
        className="flex items-center gap-1.5 rounded-card bg-primary px-3.5 py-2 text-sm font-bold text-white shadow-soft active:scale-95 transition"
      >
        <RotateCcw className="h-4 w-4" />
        Новая
      </button>
    </div>
  );
}
