import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { validateContent } from './content';
import './index.css';

// Ранняя проверка целостности контента — и в деве, и в проде: битый JSON
// (опечатка в rewardId, пустой тир) виден сразу. Не бросаем — подарок не должен
// падать в белый экран из-за мелкой правки контента, но шумим в консоль.
{
  const problems = validateContent();
  if (problems.length) {
    const log = import.meta.env.DEV ? console.warn : console.error;
    log('[content] проблемы конфигов:', problems);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
