import type { LetterStatus } from './wordle.types';

// Русская ЙЦУКЕН клавиатура БЕЗ Ё (бриф §5 — как у Яндекс/Тинькофф «5 букв»).
const ROWS = [
  ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
  ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
  ['←', 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', 'ВВОД'],
] as const;

function keyBgClass(status: LetterStatus | undefined): string {
  switch (status) {
    case 'correct':
      return 'bg-[var(--w5-correct)] text-white';
    case 'present':
      return 'bg-[var(--w5-present)] text-white';
    case 'absent':
      return 'bg-[var(--w5-absent)] text-white/90';
    default:
      return 'bg-board text-ink';
  }
}

interface WordleKeyboardProps {
  letterStatuses: Record<string, LetterStatus>;
  onLetter: (l: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
}

export function WordleKeyboard({ letterStatuses, onLetter, onDelete, onSubmit }: WordleKeyboardProps) {
  return (
    <div className="flex flex-col gap-1.5 pb-1">
      {ROWS.map((row, ri) => (
        <div key={ri} className="flex justify-center gap-1">
          {row.map((key) => {
            const isAction = key === '←' || key === 'ВВОД';
            const status = isAction ? undefined : letterStatuses[key];
            return (
              <button
                key={key}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault(); // предотвращаем потерю фокуса и задержку
                  if (key === '←') onDelete();
                  else if (key === 'ВВОД') onSubmit();
                  else onLetter(key);
                }}
                className={[
                  'flex items-center justify-center rounded-md font-bold',
                  'select-none transition-transform active:scale-90',
                  'min-h-[44px] text-sm',
                  isAction ? 'flex-[1.5] px-1 text-xs' : 'flex-1',
                  isAction ? 'bg-board text-ink' : keyBgClass(status),
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {key === '←' ? '⌫' : key.toUpperCase()}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
