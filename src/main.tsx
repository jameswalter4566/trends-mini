import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WalletProvider } from './lib/wallet';
import { XAuthProvider } from './lib/xauth';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider>
      <XAuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </XAuthProvider>
    </WalletProvider>
  </React.StrictMode>,
);
