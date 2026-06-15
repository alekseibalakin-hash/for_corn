import { useState } from 'react';
import { motion } from 'framer-motion';
import { BUILD_TAG } from './constants';
import { Board } from './components/Board';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ExpiryBanner } from './components/ExpiryBanner';
import { GameOver } from './components/GameOver';
import { Header } from './components/Header';
import { Onboarding } from './components/Onboarding';
import { RedeemCelebration } from './components/RedeemCelebration';
import { RevealModal } from './components/RevealModal';
import { ScoreBoard } from './components/ScoreBoard';
import { VictoryBanner } from './components/VictoryBanner';
import { Wallet } from './components/Wallet';
import { useGame } from './useGame';

function LoadingSplash() {
  return (
    <div className="flex h-full items-center justify-center">
      <motion.div
        animate={{ scale: [1, 1.15, 1] }}
        transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
        className="text-5xl"
      >
        ❤️
      </motion.div>
    </div>
  );
}

export default function App() {
  const game = useGame();
  const [walletOpen, setWalletOpen] = useState(false);
  const now = Date.now();

  if (game.loading) return <LoadingSplash />;

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-3 px-4 py-4">
      <Header
        rewardsRedeemed={game.rewardsRedeemed}
        walletCount={game.wallet.length}
        onOpenWallet={() => setWalletOpen(true)}
      />

      <ExpiryBanner reminder={game.reminder} now={now} onDismiss={game.dismissReminder} />

      <ScoreBoard score={game.score} best={game.bestScore} streak={game.dailyStreak} onNewGame={game.requestNewGame} />

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

      <Wallet
        open={walletOpen}
        wallet={game.wallet}
        history={game.history}
        rewardsRedeemed={game.rewardsRedeemed}
        completedCount={game.completedCount}
        totalAchievements={game.totalAchievements}
        now={now}
        onRedeem={(id) => {
          // Закрываем кошелёк, чтобы праздничный экран показался на весь экран чисто.
          setWalletOpen(false);
          game.redeem(id);
        }}
        onClose={() => setWalletOpen(false)}
      />

      <RevealModal reveal={game.activeReveal} onCollect={game.collectReveal} />
      <RedeemCelebration info={game.redeemCelebration} onClose={game.closeRedeem} />
      {/* Победный баннер — только когда не открыт праздник использования, чтобы не наслаивались. */}
      <VictoryBanner show={game.showVictory && !game.redeemCelebration} onClose={game.dismissVictory} />
      <Onboarding show={game.showOnboarding} onStart={game.dismissOnboarding} />

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
