/**
 * La entrada automática del modo desarrollo.
 *
 * En desarrollo la interfaz la sirve Vite en otro origen y el token de arranque
 * se queda en la terminal: abrir `127.0.0.1:5173` en un segundo navegador daba
 * la pantalla de «la sesión no vale». Esta ruta del server permite que el
 * middleware de Vite mande allí a quien no traiga una sesión vigente, y el
 * server devuelve el `?boot=` de siempre.
 *
 * **Sólo existe en desarrollo** (`RONA_DEV_ORIGIN`): en un arranque normal la
 * ruta no se registra y quien la pida recibe 404. El servidor sigue atado a
 * loopback, así que la cesión no sale de la máquina; aun así, es una relajación
 * deliberada y por eso la ruta, el parámetro y su motivo viven en un módulo
 * propio y no escondidos en un condicional.
 */

/** Ruta que el middleware de Vite usa para pedir una sesión nueva. */
export const DEV_BOOT_PATH = '/__dev/boot'

/** Destino local al que volver después de canjear, para no perder el enlace. */
export const DEV_BOOT_NEXT_PARAM = 'next'
