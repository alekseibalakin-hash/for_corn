import { Gift, Sparkles } from 'lucide-react';
import { joysWord } from '../format';
import { PET_NAME } from '../constants';

interface HeaderProps {
  rewardsRedeemed: number;
  walletCount: number;
  onOpenWallet: () => void;
}

export function Header({ rewardsRedeemed, walletCount, onOpenWallet }: HeaderProps) {
  // Всегда ласковое имя, без имени из Telegram (DESIGN §15).
  const greeting = `Привет, ${PET_NAME} ❤️`;
  const meta =
    rewardsRedeemed > 0
      ? `подарено ${rewardsRedeemed} ${joysWord(rewardsRedeemed)} 💝`
      : 'твои радости ещё впереди ✨';

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-extrabold text-ink">{greeting}</h1>
        <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-muted">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
          {meta}
        </p>
      </div>

      <button
        onClick={onOpenWallet}
        aria-label="Кошелёк наград"
        className="relative shrink-0 rounded-card bg-white/70 p-2.5 text-primary shadow-soft active:scale-95 transition"
      >
        <Gift className="h-6 w-6" />
        {walletCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-white">
            {walletCount}
          </span>
        )}
      </button>
    </header>
  );
}
