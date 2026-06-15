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
      },
      animation: {
        'pop-in': 'pop-in 180ms ease-out',
        'merge-pop': 'merge-pop 160ms ease-out',
      },
    },
  },
  plugins: [],
};
