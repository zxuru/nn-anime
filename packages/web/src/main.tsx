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
import { ErrorBoundary } from './components/ErrorBoundary'
import { createBrowserHistory, HistoryProvider } from './router'
// Las hojas de driver.js van primero: traen `all: unset` y colores fijos, y las
// de la casa —que vienen después— son las que visten la guía. El orden importa
// más que la especificidad.
import 'driver.js/dist/driver.css'
import 'driver.js/dist/hints.css'
import './styles/tokens.css'
import './styles/shell.css'

const container = document.getElementById('root')
if (container === null) throw new Error('falta el elemento #root')

createRoot(container).render(
  <StrictMode>
    {/*
      La red va por fuera del armazón: un fallo dentro de la aplicación —incluido
      el armazón y el enrutado— tiene que acabar en una pantalla que se pueda
      recargar, no en un documento en blanco.
    */}
    <ErrorBoundary>
      <HistoryProvider history={createBrowserHistory()}>
        <App />
      </HistoryProvider>
    </ErrorBoundary>
  </StrictMode>,
)
