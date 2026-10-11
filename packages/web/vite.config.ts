import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Puerto del server local. Debe coincidir con `DEFAULT_PORT` del CLI. */
const API_ORIGIN = process.env.NN_ANIME_API_ORIGIN ?? 'http://127.0.0.1:7717'

/**
 * Sirve el aviso de seguridad en `/SECURITY.md`, que es lo que enlaza `/settings`.
 *
 * El documento vive en la raíz del repo, fuera del build de la interfaz. Sin
 * esto la petición no encuentra archivo, el servido de estáticos cae al
 * `index.html` —el enrutado es del cliente— y el enlace no lleva a ninguna
 * parte: parece que la página se recarga.
 *
 * En desarrollo lo sirve este middleware; en el build el documento se emite como
 * recurso de `dist`, que es lo que sirve el server. Una sola fuente: el archivo
 * de la raíz, nunca una copia.
 */
function securityDoc(): Plugin {
  const source = fileURLToPath(new URL('../../SECURITY.md', import.meta.url))
  const fileName = 'SECURITY.md'

  return {
    name: 'nn-anime:security-doc',
    configureServer(server) {
      server.middlewares.use(`/${fileName}`, (_request, response) => {
        response.setHeader('content-type', 'text/markdown; charset=utf-8')
        // El documento cambia sin cambiar de nombre, así que no se cachea.
        response.setHeader('cache-control', 'no-store')
        response.end(readFileSync(source))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: readFileSync(source) })
    },
  }
}

/**
 * El server local es estricto con `Host` y con `Origin`, y hace bien: esas
 * comprobaciones son las que bloquean el DNS rebinding y el CSRF.
 *
 * En desarrollo, el navegador habla con Vite, no con el server. Por eso el
 * proxy reescribe las dos cabeceras para que la petición llegue con el mismo
 * aspecto que tendría en producción. La alternativa —relajar los guards en
 * desarrollo— dejaría el camino de producción sin probar hasta el final.
 */
function strictProxy() {
  return {
    target: API_ORIGIN,
    changeOrigin: true,
    configure: (proxy: {
      on: (
        event: string,
        handler: (proxyReq: { setHeader(k: string, v: string): void }) => void,
      ) => void
    }): void => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('origin', API_ORIGIN)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), securityDoc()],
  server: {
    port: 5173,
    // Sólo IPv4 en loopback. El valor por defecto de Vite escucha en `localhost`,
    // que en esta máquina resuelve a `[::1]`, y entonces la dirección que abre
    // el CLI (`127.0.0.1`) no respondería.
    host: '127.0.0.1',
    // Estricto a propósito: si el puerto cambia, el origen que abre el CLI deja
    // de coincidir y la cookie de sesión acabaría en otro sitio. Mejor fallar.
    strictPort: true,
    proxy: {
      // El orden importa: Vite recorre las claves en orden de inserción y `/`
      // es prefijo de todo. Si fuera primero, se tragaría `/api` y `/stream` y
      // la interfaz recibiría HTML donde espera JSON.
      '/api': strictProxy(),
      '/stream': strictProxy(),
      // Sin `boot` en la URL, Vite sirve la interfaz; con él, la petición va al
      // server para canjear el token de arranque. Es lo único que no puede
      // proxificarse a ciegas.
      '/': {
        ...strictProxy(),
        bypass: (req: { url?: string }) => (req.url?.includes('boot=') ? undefined : req.url),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
