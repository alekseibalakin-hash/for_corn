// Ласковое обращение (DESIGN §15). Это персональный подарок — имя из Telegram не
// показываем, всегда обращаемся «Кукурузка».
export const PET_NAME = 'Кукурузка';

// Видимая метка сборки — чтобы глазами понять, загрузилась ли новая версия (а не кэш).
// Поднимай при каждом деплое, который хочешь подтвердить визуально.
// STORAGE_VERSION при этом НЕ трогаем (иначе сотрёт данные жены).
export const BUILD_TAG = 'v5';

/**
 * Соглашение неймспейса статов хаба (DESIGN-HUB §3):
 *  - global (владелец rewards): `rewardsRedeemed`, `dailyStreak` — в Progress.
 *  - 2048: БЕЗ префикса (`maxTileThisGame`, `sessionScore`, `totalScore`, `bestScore`,
 *    `bestTile`, `gamesPlayed`, `totalMoves`, `timeToCurrentMaxTileSec`) — ачивки не трогаем.
 *  - match3 (ФАЗА B): С префиксом `m3_` (`m3_score`, `m3_bestScore`, `m3_combo`,
 *    `m3_gemsCleared`, `m3_gamesPlayed`, `m3_moves`). Здесь зафиксировано как соглашение;
 *    сами ачивки m3 в фазе A НЕ добавляем.
 */
export const M3_STAT_PREFIX = 'm3_';

/** Плитка игры на хабе. `status:'soon'` — задизейблена («скоро ✨»). */
export interface GameTile {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  status: 'play' | 'soon';
}

/** Каталог игр хаба. В фазе A: 2048 играбелен, Match-3 — «скоро». */
export const GAMES: GameTile[] = [
  { id: '2048', title: '2048 с любовью', subtitle: 'Складывай плитки, собирай подарки ❤️', emoji: '🌽', status: 'play' },
  { id: 'm3', title: 'Match-3', subtitle: 'Собирай тройки — скоро ✨', emoji: '🍓', status: 'soon' },
];
