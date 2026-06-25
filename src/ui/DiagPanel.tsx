import { useEffect, useState } from 'react';
import { useRewards } from '../rewards';
import { diagLog } from '../rewards/diagLog';
import { depthMirror, blocksDepthMirror } from '../games/match3/depthMirror';
import { byteLength, STORAGE_KEYS } from '../storage';
import { getWebApp, supportsCloudStorage } from '../telegram';
import { BUILD_TAG } from './constants';

// Диаг-панель (вариант A инструментации). Снимает ПОЛНЫЙ дамп состояния её аппы + журнал событий
// кошелька для диагностики любого фидбека («пропал купон», «сбросился уровень», «счёт не тот»).
// ТОЛЬКО чтение — ничего не мутирует (кроме diagLog.clear по явной кнопке). Вход: ?diag=1 или 7 тапов
// по версии-футеру (см. App.tsx). Скрыта от обычной игры.

const LIMIT_4KB = 4096; // лимит значения CloudStorage — превышение ⇒ запись может срезаться/падать

function size(obj: unknown): number {
  try {
    return obj == null ? 0 : byteLength(JSON.stringify(obj));
  } catch {
    return -1;
  }
}

export function DiagPanel({ onClose }: { onClose: () => void }) {
  const { repo, wallet, history, rewardsRedeemed, dailyStreak, completedCount, totalAchievements } = useRewards();
  const [dump, setDump] = useState<string>('Снимаю дамп…');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const safe = async <T,>(p: Promise<T>): Promise<T | { __error: string }> => {
        try {
          return await p;
        } catch (e) {
          return { __error: String(e) };
        }
      };
      const [progress, g2048, m3, w5, bb, walletBlob, historyBlob] = await Promise.all([
        safe(repo.loadProgress()),
        safe(repo.loadStats()),
        safe(repo.loadMatch3Stats()),
        safe(repo.loadW5Stats()),
        safe(repo.loadBlocksStats()),
        safe(repo.loadWallet()),
        safe(repo.loadHistory()),
      ]);
      if (!alive) return;

      let backend = 'unknown';
      try {
        const tg = getWebApp();
        backend = supportsCloudStorage(tg)
          ? `CloudStorage${tg.isMock ? ' (mock)' : ` (Telegram ${tg.version ?? '?'})`}`
          : 'localStorage/memory';
      } catch {
        /* getWebApp недоступен — оставим 'unknown' */
      }
      const sizes: Record<string, number> = {
        [STORAGE_KEYS.wallet]: size(walletBlob),
        [STORAGE_KEYS.history]: size(historyBlob),
        [STORAGE_KEYS.progress]: size(progress),
        [STORAGE_KEYS.stats]: size(g2048),
        [STORAGE_KEYS.match3Stats]: size(m3),
        [STORAGE_KEYS.w5Stats]: size(w5),
        [STORAGE_KEYS.bbStats]: size(bb),
      };
      const over4k = Object.entries(sizes)
        .filter(([, b]) => b > LIMIT_4KB)
        .map(([k, b]) => `${k}=${b}b`);
      const log = diagLog.read();

      const data = {
        ts: new Date(Date.now()).toISOString(),
        buildTag: BUILD_TAG,
        backend,
        rewards: {
          walletLive: wallet.length,
          wallet: wallet.map((c) => ({ id: c.id, tier: c.tier, rewardId: c.rewardId, expiresAt: c.expiresAt, note: c.note })),
          historyCount: history.length,
          historyRecent: history.slice(0, 20).map((h) => ({ id: h.id, tier: h.tier, reason: h.reason, resolvedAt: h.resolvedAt })),
          rewardsRedeemed,
          dailyStreak,
          completed: `${completedCount}/${totalAchievements}`,
        },
        // Кошелёк, прочитанный из хранилища ПРЯМО СЕЙЧАС (сравни с walletLive — если меньше, запись не долетела).
        walletInStorage: Array.isArray(walletBlob) ? walletBlob.length : walletBlob,
        progress,
        games: { g2048, m3, w5, bb },
        mirrors: { spicyDepth: depthMirror.read(), blocksDepth: blocksDepthMirror.read() },
        sizes,
        over4k: over4k.length ? over4k : 'нет (всё под лимитом)',
        // Окно журнала: с какого по какое время покрыты события (старейшее → новейшее).
        logCoverage: log.length
          ? { count: log.length, oldest: new Date(log[0].t).toISOString(), newest: new Date(log[log.length - 1].t).toISOString() }
          : { count: 0 },
        eventLog: log,
      };
      setDump(JSON.stringify(data, null, 2));
    })();
    return () => {
      alive = false;
    };
  }, [repo, wallet, history, rewardsRedeemed, dailyStreak, completedCount, totalAchievements]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dump);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Telegram WebView может не дать clipboard — выделяем textarea, скопируешь вручную.
      const ta = document.getElementById('diag-dump') as HTMLTextAreaElement | null;
      ta?.select();
    }
  };

  const events = diagLog.read();

  return (
    <div className="fixed inset-0 z-[100] flex flex-col gap-2 overflow-auto bg-board p-3 text-ink">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-extrabold">🛠 Диагностика · {BUILD_TAG}</span>
        <button onClick={onClose} className="rounded-card bg-white/70 px-3 py-1.5 text-sm font-bold shadow-soft active:scale-95">
          Закрыть
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={copy} className="rounded-card bg-primary px-3 py-1.5 text-sm font-bold text-white shadow-soft active:scale-95">
          {copied ? 'Скопировано ✓' : '📋 Копировать дамп'}
        </button>
        <button
          onClick={() => {
            diagLog.clear();
            onClose();
          }}
          className="rounded-card bg-white/70 px-3 py-1.5 text-sm font-bold shadow-soft active:scale-95"
        >
          Очистить журнал
        </button>
      </div>

      {/* Быстрый человекочитаемый журнал событий (старые→новые). */}
      <div className="rounded-card bg-white/60 p-2 text-[11px] font-mono leading-tight">
        <div className="mb-1 font-bold">Журнал ({events.length}):</div>
        {events.length === 0 && <div className="text-muted">пусто — событий ещё не было</div>}
        {events.slice(-40).map((e, i) => (
          <div key={i}>
            {new Date(e.t).toLocaleTimeString()} · <b>{e.ev}</b>{' '}
            {Object.entries(e)
              .filter(([k]) => k !== 't' && k !== 'ev')
              .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v)}`)
              .join(' ')}
          </div>
        ))}
      </div>

      {/* Полный JSON-дамп — это и копируется/пересылается мужу. */}
      <textarea
        id="diag-dump"
        readOnly
        value={dump}
        onFocus={(e) => e.currentTarget.select()}
        className="min-h-[40vh] flex-1 rounded-card bg-white/80 p-2 text-[10px] font-mono"
      />
      <p className="text-center text-[10px] text-muted">
        Скопируй дамп и пришли мужу. Только чтение — на игру не влияет.
      </p>
    </div>
  );
}
