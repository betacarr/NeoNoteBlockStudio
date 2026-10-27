import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { installRendererDiagnostics } from './ui/diagnostics';

installRendererDiagnostics();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
