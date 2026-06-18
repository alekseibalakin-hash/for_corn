/** @type {import('tailwindcss').Config} */
// Дизайн живёт в коде (DESIGN §9). Тёплая фиксированная палитра — чтобы подарок
// везде выглядел одинаково «нашим», независимо от темы Telegram.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FBF3EC', // фон-крем
        board: '#E7D3C7', // доска
        cell: '#F1E4DA', // пустая ячейка
        ink: '#5B4A42', // тёплый коричневый текст
        muted: '#B49A88', // приглушённый текст
        primary: '#D4537E', // акцент-роза
        lighttext: '#FBEAF0', // светлый текст на тёмных плитках
        // Веер плиток: персик → коралл → роза → золото
        tile: {
          2: '#FAEEDA',
          4: '#FAC775',
          8: '#F5C4B3',
          16: '#F0997B',
          32: '#E8895E',
          64: '#D85A30',
          128: '#ED93B1',
          256: '#D4537E',
          512: '#993556',
          gold: '#854F0B', // 1024+
        },
      },
      fontFamily: {
        sans: ['Nunito', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        tile: '0.625rem', // 10px — скруглённые плитки
        card: '1.25rem', // 20px — карточки/панели
      },
      boxShadow: {
        soft: '0 6px 20px -8px rgba(91, 74, 66, 0.25)',
        tile: '0 2px 0 0 rgba(91, 74, 66, 0.08)',
        lift: '0 12px 40px -12px rgba(212, 83, 126, 0.45)',
      },
      keyframes: {
        'pop-in': {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '60%': { transform: 'scale(1.12)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
        'merge-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },
        // «5 букв» — прыжок победного тайла (стагерная задержка через inline-style)
        'w5-bounce': {
          '0%, 100%': { transform: 'translateY(0) scaleY(1)' },
          '30%': { transform: 'translateY(-10px) scaleY(1.04)' },
          '60%': { transform: 'translateY(-5px) scaleY(1)' },
        },
        // «5 букв» — встряхивание строки на невалидном вводе
        'w5-shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '15%': { transform: 'translateX(-6px)' },
          '35%': { transform: 'translateX(6px)' },
          '55%': { transform: 'translateX(-5px)' },
          '75%': { transform: 'translateX(5px)' },
          '90%': { transform: 'translateX(-2px)' },
        },
        // «5 букв» — мягкий поп при вводе буквы
        'w5-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'pop-in': 'pop-in 180ms ease-out',
        'merge-pop': 'merge-pop 160ms ease-out',
        'w5-bounce': 'w5-bounce 0.4s ease-in-out both',
        'w5-shake': 'w5-shake 0.5s ease-in-out',
        'w5-pop': 'w5-pop 0.1s ease-out',
      },
    },
  },
  plugins: [],
};
