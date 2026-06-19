import { AnimatePresence, motion } from 'framer-motion';

interface ConfirmDialogProps {
  show: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** §B1: опциональная дополнительная кнопка (например «Потратить желание»). */
  extraLabel?: string;
  onExtra?: () => void;
}

export function ConfirmDialog({ show, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, extraLabel, onExtra }: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-card bg-cream p-5 text-center shadow-lift"
          >
            <h3 className="text-lg font-extrabold text-ink">{title}</h3>
            <p className="mt-1 text-sm font-semibold text-muted">{message}</p>
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="flex-1 rounded-card bg-board py-2.5 font-bold text-ink active:scale-95 transition"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 rounded-card bg-primary py-2.5 font-bold text-white active:scale-95 transition"
                >
                  {confirmLabel}
                </button>
              </div>
              {extraLabel && onExtra && (
                <button
                  onClick={onExtra}
                  className="w-full rounded-card bg-board py-2.5 text-sm font-bold text-ink active:scale-95 transition"
                >
                  {extraLabel}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
