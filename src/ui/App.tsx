import { lazy, Suspense, useState } from 'react';
import { RewardsProvider, useRewards } from '../rewards';
import { Hub } from './Hub';
import { LoadingSplash } from './components/LoadingSplash';
import { Onboarding } from './components/Onboarding';
import { RedeemCelebration } from './components/RedeemCelebration';
import { RevealModal } from './components/RevealModal';
import { VictoryBanner } from './components/VictoryBanner';
import { Wallet } from './components/Wallet';

// 2048 грузится ОТДЕЛЬНЫМ чанком (DESIGN-HUB §5): хаб стартует лёгким, будущие игры
// (match3, zuma) не утяжелят старт. Никаких статических импортов из games/g2048.
const Game2048 = lazy(() => import('../games/g2048'));

type View = 'hub' | 'g2048';

function Shell() {
  const rewards = useRewards();
  const [view, setView] = useState<View>('hub');
  const [walletOpen, setWalletOpen] = useState(false);
  const now = Date.now();

  if (rewards.loading) return <LoadingSplash />;

  const openWallet = () => setWalletOpen(true);

  return (
    <>
      {view === 'hub' ? (
        <Hub onPlay={(id) => id === '2048' && setView('g2048')} onOpenWallet={openWallet} />
      ) : (
        <Suspense fallback={<LoadingSplash />}>
          <Game2048 onBack={() => setView('hub')} onOpenWallet={openWallet} />
        </Suspense>
      )}

      {/* Общие оверлеи наградного слоя — поверх любого вида (хаб/игра). */}
      <Wallet
        open={walletOpen}
        wallet={rewards.wallet}
        history={rewards.history}
        rewardsRedeemed={rewards.rewardsRedeemed}
        completedCount={rewards.completedCount}
        totalAchievements={rewards.totalAchievements}
        now={now}
        onRedeem={(id) => {
          // Закрываем кошелёк, чтобы праздничный экран показался на весь экран чисто.
          setWalletOpen(false);
          rewards.redeem(id);
        }}
        onClose={() => setWalletOpen(false)}
      />

      <RevealModal reveal={rewards.activeReveal} onCollect={rewards.collectReveal} />
      <RedeemCelebration info={rewards.redeemCelebration} onClose={rewards.closeRedeem} />
      {/* Победный баннер — только когда не открыт праздник использования, чтобы не наслаивались. */}
      <VictoryBanner show={rewards.showVictory && !rewards.redeemCelebration} onClose={rewards.dismissVictory} />
      {/* Онбординг — один раз при первом входе в хаб. */}
      <Onboarding show={rewards.showOnboarding} onStart={rewards.dismissOnboarding} />
    </>
  );
}

export default function App() {
  return (
    <RewardsProvider>
      <Shell />
    </RewardsProvider>
  );
}
