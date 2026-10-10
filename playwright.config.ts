/**
 * Configuración del e2e.
 *
 * El servidor lo levanta Playwright con `scripts/e2e-server.ts`: base temporal,
 * plugin de fixture y sin abrir navegador. El puerto es fijo y no se reutiliza un
 * servidor que ya esté corriendo, porque un servidor de desarrollo apuntando a
 * los datos reales del usuario no es lo que hay que probar.
 *
 * El navegador vive en `.tmp/`, dentro del repositorio: el directorio de caché
 * del sistema no siempre se puede escribir, y un e2e que falla por permisos de
 * caché no prueba nada.
 */

import { defineConfig, devices } from '@playwright/test'

const PUERTO = Number(process.env.NN_ANIME_E2E_PORT ?? '7801')

export default defineConfig({
  testDir: 'packages/web/e2e',
  // `.e2e.ts` y no `.spec.ts`: `bun test` recoge los `.spec.ts` de todo el
  // repositorio, y los recogía también aquí, donde no hay `bun:test` y todo
  // fallaba. Dos ejecutores distintos necesitan dos nombres distintos.
  testMatch: '**/*.e2e.ts',
  // Tres intentos por defecto: el criterio del spec es que los tests sean
  // estables en tres ejecuciones seguidas, y un `retries` alto escondería la
  // inestabilidad en vez de arreglarla.
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PUERTO}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    // El token de arranque es de un solo uso: se canjea una vez y las demás
    // pruebas reutilizan la sesión guardada.
    { name: 'setup', testMatch: /setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { storageState: '.tmp/e2e-state.json' },
    },
  ],
  webServer: {
    command: 'bun run scripts/e2e-server.ts',
    url: `http://127.0.0.1:${PUERTO}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
  },
})
