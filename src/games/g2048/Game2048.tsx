import { ArrowLeft, Gift } from 'lucide-react';
import { useRewards } from '../../rewards';
import { useGame2048 } from './useGame2048';
import { Board } from '../../ui/components/Board';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog';
import { ExpiryBanner } from '../../ui/components/ExpiryBanner';
import { GameOver } from '../../ui/components/GameOver';
import { LoadingSplash } from '../../ui/components/LoadingSplash';
import { ScoreBoard } from '../../ui/components/ScoreBoard';
import { BUILD_TAG } from '../../ui/constants';

interface Game2048Props {
  onBack: () => void;
  onOpenWallet: () => void;
}

/**
 * Экран игры 2048 — грузится ЛЕНИВО (React.lazy) отдельным чанком, чтобы старт хаба был
 * лёгким и будущие игры не утяжеляли его. Игровое состояние — в useGame2048; кошелёк,
 * раскрытия, стрик и «подарено N» — из общего наградного слоя (rewards-контекст).
 * Общие оверлеи (RevealModal/RedeemCelebration/Victory/Onboarding/Wallet) живут в App.
 */
export default function Game2048({ onBack, onOpenWallet }: Game2048Props) {
  const rewards = useRewards();
  const game = useGame2048();
  const now = Date.now();

  if (game.loading) return <LoadingSplash />;

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-3 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          aria-label="В меню хаба"
          className="flex items-center gap-1.5 rounded-card bg-white/70 px-3 py-2 text-sm font-bold text-ink shadow-soft active:scale-95 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Меню
        </button>
        <button
          onClick={onOpenWallet}
          aria-label="Кошелёк наград"
          className="relative shrink-0 rounded-card bg-white/70 p-2.5 text-primary shadow-soft active:scale-95 transition"
        >
          <Gift className="h-6 w-6" />
          {rewards.wallet.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-white">
              {rewards.wallet.length}
            </span>
          )}
        </button>
      </div>

      <ExpiryBanner reminder={rewards.reminder} now={now} onDismiss={rewards.dismissReminder} />

      <ScoreBoard score={game.score} best={game.bestScore} streak={rewards.dailyStreak} onNewGame={game.requestNewGame} />

      <div className="relative mt-1">
        <Board tiles={game.tiles} onMove={game.move} />
        {game.won && !game.gameOver && (
          <div className="absolute left-3 top-3 z-10 rounded-full bg-primary/90 px-2.5 py-1 text-xs font-extrabold text-white shadow-soft">
            🏆 2048!
          </div>
        )}
        <GameOver show={game.gameOver} score={game.score} onNewGame={game.startNewGame} />
      </div>

      <p className="mt-1 text-center text-xs font-semibold text-muted">
        Свайпай по полю или жми стрелки. Собирай подарки ❤️
      </p>
      <p className="text-center text-[10px] font-semibold text-muted/50">{BUILD_TAG}</p>

      <ConfirmDialog
        show={game.confirmNewGame}
        title="Начать новую игру?"
        message="Текущая партия завершится, очки уйдут в общий счёт."
        confirmLabel="Поехали"
        cancelLabel="Продолжить"
        onConfirm={game.startNewGame}
        onCancel={game.cancelNewGame}
      />
    </div>
  );
}
