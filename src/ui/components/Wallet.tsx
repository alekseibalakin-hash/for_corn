import { AnimatePresence, motion } from 'framer-motion';
import { Clock, Gift, Heart, X } from 'lucide-react';
import type { Coupon, HistoryEntry } from '../../engine';
import { couponEmoji, expiryLabel, isExpiringSoon, joysWord, rewardText, rewardTitle } from '../format';
import { tierEmoji } from '../../content';

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ActiveCoupon({ coupon, now, onRedeem }: { coupon: Coupon; now: number; onRedeem: (id: string) => void }) {
  const soon = isExpiringSoon(coupon.expiresAt, now);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`rounded-card bg-white/80 p-3.5 shadow-soft ring-1 ${soon ? 'ring-primary/60' : 'ring-transparent'}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-3xl">{couponEmoji(coupon)}</span>
        <div className="min-w-0 flex-1">
          <div className="font-extrabold text-ink">{rewardTitle(coupon)}</div>
          <div className="text-sm font-semibold text-muted">{rewardText(coupon)}</div>
          {coupon.note && <div className="mt-1 text-xs font-semibold italic text-primary">{coupon.note}</div>}
          <div
            className={`mt-1.5 flex items-center gap-1 text-xs font-bold ${soon ? 'text-primary' : 'text-muted'}`}
          >
            <Clock className="h-3.5 w-3.5" />
            {expiryLabel(coupon.expiresAt, now)}
          </div>
        </div>
      </div>
      <button
        onClick={() => onRedeem(coupon.id)}
        className="mt-3 w-full rounded-card bg-primary py-2.5 text-sm font-bold text-white shadow-soft active:scale-95 transition"
      >
        Использовать
      </button>
    </motion.div>
  );
}

function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const redeemed = entry.reason === 'redeemed';
  return (
    <div className="flex items-center gap-3 rounded-card bg-board/50 px-3 py-2 opacity-80">
      <span className="text-xl grayscale">{tierEmoji(entry.tier)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-ink">{rewardTitle(entry)}</div>
        <div className="text-xs font-semibold text-muted">
          {redeemed ? 'использован' : 'сгорел'} · {fmtDate(entry.resolvedAt)}
        </div>
      </div>
      <span className={`text-xs font-bold ${redeemed ? 'text-primary' : 'text-muted'}`}>
        {redeemed ? '💝' : '🥀'}
      </span>
    </div>
  );
}

interface WalletProps {
  open: boolean;
  wallet: Coupon[];
  history: HistoryEntry[];
  rewardsRedeemed: number;
  completedCount: number;
  totalAchievements: number;
  now: number;
  onRedeem: (id: string) => void;
  onClose: () => void;
}

export function Wallet({
  open,
  wallet,
  history,
  rewardsRedeemed,
  completedCount,
  totalAchievements,
  now,
  onRedeem,
  onClose,
}: WalletProps) {
  const sorted = [...wallet].sort((a, b) => a.expiresAt - b.expiresAt);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30 backdrop-blur-sm sm:items-center"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-md flex-col rounded-t-card bg-cream shadow-lift sm:rounded-card"
          >
            <div className="flex items-center justify-between border-b border-board px-5 py-4">
              <h2 className="flex items-center gap-2 text-lg font-extrabold text-ink">
                <Gift className="h-5 w-5 text-primary" /> Кошелёк наград
              </h2>
              <button onClick={onClose} aria-label="Закрыть" className="text-muted active:scale-90">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 pt-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-muted">
                <Heart className="h-4 w-4 text-primary" />
                {rewardsRedeemed > 0
                  ? `ты подарила себе ${rewardsRedeemed} ${joysWord(rewardsRedeemed)}`
                  : 'здесь копятся твои подарки'}
              </span>
              <span className="shrink-0 text-xs font-bold text-muted">
                выполнено {completedCount} из {totalAchievements}
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {sorted.length === 0 && history.length === 0 && (
                <p className="py-10 text-center text-sm font-semibold text-muted">
                  Пока пусто — играй, и здесь появятся подарки ❤️
                </p>
              )}

              <AnimatePresence>
                {sorted.map((coupon) => (
                  <ActiveCoupon key={coupon.id} coupon={coupon} now={now} onRedeem={onRedeem} />
                ))}
              </AnimatePresence>

              {history.length > 0 && (
                <div className="pt-2">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">История</div>
                  <div className="space-y-1.5">
                    {history.map((entry) => (
                      <HistoryItem key={entry.id} entry={entry} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
