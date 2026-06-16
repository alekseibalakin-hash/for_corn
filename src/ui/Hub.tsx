import { Trophy } from 'lucide-react';
import { useRewards } from '../rewards';
import { Header } from './components/Header';
import { ExpiryBanner } from './components/ExpiryBanner';
import { BUILD_TAG, GAMES, type GameTile } from './constants';

interface HubProps {
  /** Открыть игру по id (в фазе A играбелен только '2048'). */
  onPlay: (gameId: string) => void;
  onOpenWallet: () => void;
}

function GameCard({ tile, onPlay }: { tile: GameTile; onPlay: (id: string) => void }) {
  const playable = tile.status === 'play';
  return (
    <button
      type="button"
      disabled={!playable}
      onClick={() => playable && onPlay(tile.id)}
      aria-label={playable ? `Играть в ${tile.title}` : `${tile.title} — скоро`}
      className={`relative flex flex-col items-center gap-2 rounded-card p-5 text-center shadow-soft transition ${
        playable ? 'bg-white/80 active:scale-95' : 'cursor-not-allowed bg-board/40'
      }`}
    >
      {!playable && (
        <span className="absolute right-2 top-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-extrabold text-primary">
          скоро ✨
        </span>
      )}
      <span className={`text-5xl ${playable ? '' : 'opacity-50 grayscale'}`}>{tile.emoji}</span>
      <span className={`text-base font-extrabold ${playable ? 'text-ink' : 'text-muted'}`}>{tile.title}</span>
      <span className="text-xs font-semibold leading-snug text-muted">{tile.subtitle}</span>
    </button>
  );
}

/**
 * Хаб приятностей (DESIGN-HUB §5) — корневой вид: плитки игр (2048 играбелен, Match-3
 * «скоро»), вход в общий кошелёк, «выполнено X из N заданий» по всему хабу. Тёплая
 * палитра/Nunito — как в игре. Онбординг показывается оверлеем из App при первом входе.
 */
export function Hub({ onPlay, onOpenWallet }: HubProps) {
  const rewards = useRewards();
  const now = Date.now();

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-4 px-4 py-4">
      <Header rewardsRedeemed={rewards.rewardsRedeemed} walletCount={rewards.wallet.length} onOpenWallet={onOpenWallet} />

      <ExpiryBanner reminder={rewards.reminder} now={now} onDismiss={rewards.dismissReminder} />

      {rewards.dailyStreak > 1 && (
        <div className="flex items-center justify-center gap-1.5 rounded-card bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
          <Trophy className="h-4 w-4" />
          {rewards.dailyStreak} дней подряд — ты умница ❤️
        </div>
      )}

      <div>
        <h2 className="mb-2 px-1 text-sm font-extrabold uppercase tracking-wide text-muted">Выбери игру</h2>
        <div className="grid grid-cols-2 gap-3">
          {GAMES.map((tile) => (
            <GameCard key={tile.id} tile={tile} onPlay={onPlay} />
          ))}
        </div>
      </div>

      <div className="mt-auto pt-2 text-center">
        <p className="text-sm font-bold text-muted">
          выполнено {rewards.completedCount} из {rewards.totalAchievements} заданий 💝
        </p>
        <p className="mt-1 text-[10px] font-semibold text-muted/50">{BUILD_TAG}</p>
      </div>
    </div>
  );
}
