import { createRoot } from 'react-dom/client';
import '@glass-sdk/liquid-glass/styles.css';
import { disableNativeContextMenu } from '../shared/context-menu.js';
import { enableWindowDragging } from '../shared/window-drag.js';
import App from './App.jsx';
import './styles.css';

enableWindowDragging();
disableNativeContextMenu();
createRoot(document.getElementById('root')).render(<App />);
