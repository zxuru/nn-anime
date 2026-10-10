/**
 * Arranque de la interfaz.
 *
 * El token de arranque no se lee aquí ni en ningún otro sitio de la interfaz:
 * el canje `/?boot=...` lo hace el server y devuelve una cookie `HttpOnly`. En
 * desarrollo, el proxy de Vite deja pasar esa petición al server.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { createBrowserHistory, HistoryProvider } from './router'
import './styles/tokens.css'
import './styles/shell.css'

const container = document.getElementById('root')
if (container === null) throw new Error('falta el elemento #root')

createRoot(container).render(
  <StrictMode>
    <HistoryProvider history={createBrowserHistory()}>
      <App />
    </HistoryProvider>
  </StrictMode>,
)
