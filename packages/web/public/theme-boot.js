/**
 * El tema, antes del primer pintado.
 *
 * Se carga como script clásico y bloqueante en el `head`: la CSP es
 * `default-src 'self'` sin `'unsafe-inline'`, así que un `<script>` con el código
 * dentro no se ejecutaría. Este archivo se sirve desde el propio paquete
 * (`public/` lo copia el build tal cual) y se ejecuta antes de que el navegador
 * pinte el `body`.
 *
 * La preferencia guardada es una caché de la del servidor: `useAppTheme` escribe
 * aquí el tema que acaba de leer y sigue mandando después de hidratar. El
 * arranque sólo adelanta el atributo, `color-scheme` y el color de la barra del
 * navegador; sin preferencia guardada se respeta `prefers-color-scheme`.
 *
 * La clave y los dos colores están atados a `tema-arranque.ts` y a
 * `tokens.css` por una prueba: si uno cambia sin el otro, la prueba falla.
 */
const CLAVE = 'rona:tema'
const COLORES = { dark: '#08080a', light: '#f2ede3' }

function temaGuardado() {
  try {
    return window.localStorage.getItem(CLAVE)
  } catch {
    // El almacenamiento puede estar bloqueado por política: entonces no hay
    // preferencia y se sigue al sistema, que es lo que hacía antes.
    return null
  }
}

function prefiereClaro() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  )
}

const guardado = temaGuardado()
let tema = 'dark'
if (guardado === 'light' || guardado === 'dark') tema = guardado
else if (prefiereClaro()) tema = 'light'

const raiz = document.documentElement
raiz.setAttribute('data-theme', tema)
// CSSOM y no un atributo `style` en el HTML: la CSP bloquea el atributo escrito
// en el marcado, no la propiedad que escribe el script. La hoja vuelve a
// declararlo por tema cuando carga, y el gancho lo reescribe al hidratar.
raiz.style.colorScheme = tema

const meta = document.querySelector('meta[name="theme-color"]')
if (meta !== null) meta.setAttribute('content', COLORES[tema])
