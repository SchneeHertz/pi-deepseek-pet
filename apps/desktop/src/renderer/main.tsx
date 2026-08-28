import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PetView } from './pet-view.js';
import { SettingsView } from './settings-view.js';
import './styles.css';

const view = new URLSearchParams(window.location.search).get('view');
const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');

createRoot(root).render(<StrictMode>{view === 'settings' ? <SettingsView /> : <PetView />}</StrictMode>);
