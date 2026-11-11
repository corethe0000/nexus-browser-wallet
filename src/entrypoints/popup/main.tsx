import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

//opened as a page of its own (Settings > Open in a tab), not as the toolbar popup
if (new URLSearchParams(location.search).has('tab')) {
  document.documentElement.classList.add('tab');
}

createRoot(document.getElementById('root')!).render(<App />);
