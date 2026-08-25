// @ts-check
/**
 * src/main.jsx — Smart BERRY Modern Vite Entry Point.
 * Renders the new modular React application shell inspired by the Bonsai UI aesthetic.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.jsx';

const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(<App />);
}
