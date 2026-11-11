import { createRoot } from 'react-dom/client';
import { Approve } from './Approve';
import '../popup/style.css';

//a window of its own, not the 360px toolbar popup: use its whole width
document.documentElement.classList.add('window');

createRoot(document.getElementById('root')!).render(<Approve />);
