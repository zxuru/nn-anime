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
      --version          versión

Entorno (para el modo servidor):
  NN_ANIME_HOST          interfaz donde escucha. Por defecto 127.0.0.1
  NN_ANIME_PORT          puerto. Por defecto 7717
  NN_ANIME_NO_OPEN=1     no abre el navegador al arrancar
  NN_ANIME_TOKEN         token fijo; obligatorio fuera de loopback
  NN_ANIME_PUBLIC_ORIGIN origen público (https://…); marca la cookie Secure
  NN_ANIME_LOCKED=1      sin alta de plugins ni gestión de repositorios`,

  'cli.version': 'nn-anime {version}',

  'cli.env.invalidHost': 'NN_ANIME_HOST no es un nombre de host válido: {value}.',
  'cli.env.invalidPort':
    'NN_ANIME_PORT no es un puerto válido: {value}. Se espera un entero entre {min} y {max}.',
  'cli.env.invalidOrigin': 'NN_ANIME_PUBLIC_ORIGIN no es un origen http(s) válido: {value}.',
  'cli.env.noTokenOnServer':
    'Se va a servir en {where}, que no es loopback, y no hay NN_ANIME_TOKEN. Define un token fijo (por ejemplo: openssl rand -base64 32) o vuelve a NN_ANIME_HOST=127.0.0.1.',
  'cli.env.weakToken':
    'NN_ANIME_TOKEN es demasiado corto para un servidor: usa al menos {min} caracteres aleatorios.',
  'cli.env.loopbackOnServer':
    'NN_ANIME_ALLOW_LOOPBACK desactiva la protección SSRF y no se admite con un host que no sea loopback. Quita esa variable.',
  'cli.env.publicOriginHint':
    'Aviso: sin NN_ANIME_PUBLIC_ORIGIN la cookie no se marca Secure. Si hay HTTPS delante, define el origen público (https://…).',

  'cli.usage.unknownFlag': 'Bandera desconocida: {flag}. Usa --help para ver las admitidas.',
  'cli.usage.missingValue': 'La bandera {flag} necesita un valor.',
  'cli.usage.invalidPort': 'Puerto inválido: {value}. Se espera un entero entre {min} y {max}.',

  'cli.url': 'Servidor en {url}',
  'cli.server.login': 'Entra en {url} y pega el token de NN_ANIME_TOKEN.',
  'cli.server.locked':
    'Modo restringido: no se pueden añadir ni activar plugins desde la interfaz.',
  'cli.port.busy': 'El puerto {port} estaba ocupado; se usa el {chosen}.',
  'cli.open.failed': 'No se pudo abrir el navegador. Abre esta dirección a mano: {url}',
  'cli.server.failed': 'No se pudo arrancar el servidor: {detail}',
  'cli.port.busyBlocked':
    'El puerto {port} está ocupado y el proxy de desarrollo apunta a él. Libéralo o cambia el origen del proxy. Detalle: {detail}',
  'cli.port.busyFixed':
    'El puerto {port} está ocupado y este arranque no puede usar otro. Libéralo o cambia NN_ANIME_PORT. Detalle: {detail}',
  'cli.migration.failed': 'No se pudo preparar la base de datos: {message}',
  // Con la ruta absoluta y el error concreto, que es lo que hace falta cuando el
  // fallo llega a un registro y ya no hay consola donde preguntar.
  'cli.migration.failedPath': 'No se pudo preparar la base de datos en {path}: {message}',
  'cli.dirs.failed': 'No se pudieron preparar los directorios de la aplicación: {message}',
  'cli.prune.atStartup':
    'La base superaba el tamaño previsto: se limpiaron {rows} filas de datos viejos.',
  'cli.settings.invalid': 'No se pudieron leer los ajustes: {message}',

  'cli.providers.active': 'Proveedores activos: {list}',
  'cli.providers.none':
    'Sin proveedores. Añade el repositorio recomendado en Ajustes ({repo}) o copia un plugin a {dir}.',
  'cli.providers.rejected': 'Proveedor rechazado: {message}',
  'cli.providers.directory': 'No se pudieron leer los plugins: {message}',

  'cli.migrate.applied': 'Migraciones aplicadas: {versions}. Versión del esquema: {version}.',
  'cli.migrate.none': 'No hay migraciones pendientes. Versión del esquema: {version}.',
  'cli.migrate.failed': 'No se pudo preparar la base de datos: {message}',

  'cli.prune.total': 'Limpieza terminada: {total} filas.',
  'cli.prune.table': '  {table}: {rows}',
  'cli.prune.failed': 'No se pudo limpiar la base de datos: {message}',
}
