import { useEffect, useState } from 'react';
import { useRewards } from '../rewards';
import { getWebApp } from '../telegram';

// ⚠️ ВРЕМЕННЫЙ диагностик прод-бага «глубина спайси пиниться на 25» (НЕ воспроизводится локально —
// Telegram CloudStorage/localStorage). Показывается ТОЛЬКО при ?diag=1. Read-only, кроме безобидной
// канарейки diag_open_count (своя клетка). Не трогает её данные. УДАЛЯЕТСЯ вместе с реальным фиксом.
export function DiagPanel() {
  const { repo } = useRewards();
  const [info, setInfo] = useState<Array<[string, string]>>([]);

  useEffect(() => {
    (async () => {
      const out: Array<[string, string]> = [];
      const push = (k: string, v: unknown) => out.push([k, String(v)]);

      let userId: string | number | undefined;
      try {
        const wa = getWebApp();
        userId = wa.initDataUnsafe?.user?.id;
        push('userId', userId ?? '(нет)');
        push('isMock', wa.isMock ?? false);
      } catch (e) {
        push('webapp_err', e);
      }

      // Cloud-глубина — как её видит игра (через тот же repo/store, что и боевой код).
      try {
        const stats = await repo.loadMatch3Stats();
        push('cloud_maxSpicyLevel', stats?.maxSpicyLevel ?? '(null)');
        push('cloud_stats_raw', JSON.stringify(stats));
      } catch (e) {
        push('cloud_err', e);
      }

      // Незаконченный спайси-слот (резюм «Продолжить уровень N»).
      try {
        const board = (await repo.loadMatch3Board()) as { spicy?: { level?: number } } | null;
        push('slot_level', board?.spicy?.level ?? '(нет слота)');
      } catch (e) {
        push('slot_err', e);
      }

      // localStorage-зеркало глубины — оба возможных ключа (на случай расхождения id/local).
      try {
        push('mirror_byId', localStorage.getItem(`spicy_depth_${userId}`));
        push('mirror_local', localStorage.getItem('spicy_depth_local'));
      } catch (e) {
        push('mirror_err', e);
      }

      // КАНАРЕЙКА персистентности localStorage: счётчик открытий. Растёт между перезаходами ⇒
      // localStorage переживает сессии. Всегда =1 ⇒ Telegram-вебвью чистит localStorage (зеркало бесполезно).
      try {
        const next = (parseInt(localStorage.getItem('diag_open_count') ?? '0', 10) || 0) + 1;
        localStorage.setItem('diag_open_count', String(next));
        push('ls_open_count', next);
      } catch (e) {
        push('canary_err', e);
      }

      // Что реально лежит в localStorage (видны ключи match3_*/spicy_depth_*/diag_*).
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) keys.push(k);
        }
        push('ls_keys', keys.join(', ') || '(пусто)');
      } catch (e) {
        push('ls_keys_err', e);
      }

      setInfo(out);
    })();
  }, [repo]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#fff',
        color: '#111',
        padding: 16,
        overflow: 'auto',
        font: '13px/1.5 ui-monospace, monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>🩺 ДИАГНОСТИКА (v16-diag)</div>
      <div style={{ marginBottom: 12, color: '#a00' }}>
        Сделай скрин этого экрана и пришли мужу. Потом ЗАКРОЙ приложение и ОТКРОЙ снова — пришли второй
        скрин (важно поле ls_open_count: выросло оно или нет).
      </div>
      {info.length === 0 && <div>загрузка…</div>}
      {info.map(([k, v]) => (
        <div key={k} style={{ marginBottom: 4 }}>
          <b>{k}</b> = {v}
        </div>
      ))}
    </div>
  );
}
