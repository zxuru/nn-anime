/**
 * Catálogo español del CLI.
 *
 * Añadir un idioma es copiar este archivo, traducirlo y registrarlo en
 * `i18n/index.ts`. Ningún componente ni ningún mensaje de error cambia.
 */

import type { Messages } from '@nn-anime/core'

export const messages: Messages = {
  'cli.help.body': `nn-anime — ver anime con interfaz, arrancado desde la terminal

Uso:
  nn-anime [consulta] [banderas]

Banderas:
  -p, --port <n>         puerto fijo. Por defecto 7717, o uno libre del sistema
      --no-open          no abrir el navegador; imprime la dirección
      --data-dir <ruta>  carpeta de datos
      --config-dir <ruta>
                         carpeta de configuración
      --provider <id>    limita la búsqueda a un proveedor. Repetible
      --lang <código>    idioma de los mensajes
  -v, --verbose          mensajes de depuración
  -h, --help             esta ayuda
      --version          versión`,

  'cli.version': 'nn-anime {version}',

  'cli.usage.unknownFlag': 'Bandera desconocida: {flag}. Usa --help para ver las admitidas.',
  'cli.usage.missingValue': 'La bandera {flag} necesita un valor.',
  'cli.usage.invalidPort': 'Puerto inválido: {value}. Se espera un entero entre {min} y {max}.',

  'cli.notImplemented':
    'El arranque del servidor todavía no está implementado en esta tarea del plan.',

  'cli.url': 'Servidor en {url}',
  'cli.port.busy': 'El puerto {port} estaba ocupado; se usa el {chosen}.',
  'cli.open.failed': 'No se pudo abrir el navegador. Abre esta dirección a mano: {url}',
  'cli.server.failed': 'No se pudo arrancar el servidor en ningún puerto.',
  'cli.migration.failed': 'No se pudo preparar la base de datos: {message}',
}
