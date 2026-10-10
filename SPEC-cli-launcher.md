# Spec: cli-launcher

Module id: `cli-launcher` · Depende de: `core`, `server` · Paquete: `packages/cli`
Convenciones (Commands, Project Structure, Code Style, Testing Strategy, Boundaries):
heredadas de `SPEC-nn-anime.md`. Este documento define sólo lo propio del módulo.

## Objective

Un solo comando que hace lo que hace `ani-cli`: arranca, resuelve todo y deja al usuario
viendo contenido. Sin pasos manuales, sin configuración previa, sin terminal interactiva.

Éxito significa:

1. `nn-anime` ejecuta migraciones, levanta el server en `127.0.0.1` en un puerto libre y abre
   el navegador en una URL con token, en menos de 2 s en un equipo ya instalado.
2. `nn-anime "shingeki"` abre directamente el resultado de búsqueda de ese término.
3. Ctrl+C cierra el server, mata el mpv hijo si lo hay y deja la base consistente.
4. Si el puerto está ocupado, elige otro y lo informa. Nunca falla por puerto ocupado.
5. Si `mpv` no está instalado, la app arranca igual y el reproductor web sigue funcionando.

## Contrato

Interfaz de línea de comandos. Es la única superficie pública del módulo.

```
nn-anime [query] [flags]

Argumentos:
  query                 texto opcional; si existe, abre /search?q=<query>

Flags:
  -p, --port <n>        puerto fijo. Por defecto: 7717, y si está ocupado, uno libre del SO
      --no-open         no abrir el navegador; imprime la URL
      --data-dir <p>    sobrescribe $XDG_DATA_HOME/nn-anime
      --config-dir <p>  sobrescribe $XDG_CONFIG_HOME/nn-anime
      --provider <id>   restringe la búsqueda a un proveedor. Repetible
      --lang <code>     idioma de los mensajes del CLI. Por defecto `es`, o `NN_ANIME_LANG`
  -v, --verbose         nivel de log debug
  -h, --help
      --version
```

Códigos de salida: `0` normal, `1` error de arranque, `2` uso incorrecto de flags,
`3` migración fallida, `130` interrupción por señal.

Comportamiento de arranque, en orden estricto:

1. Resolver rutas XDG y crear directorios con modo `0700`.
2. Cargar `config.json` si existe. Flags de CLI ganan sobre config.
3. Abrir la base y correr migraciones pendientes de `catalog-store`.
4. Cargar plugins de proveedor de `providers/`. Un plugin roto se reporta y se omite.
5. Generar un token de arranque de un solo uso, de 32 bytes con CSPRNG.
6. `Bun.serve` en `127.0.0.1:<puerto>`, con las cabeceras de seguridad del spec de proyecto en
   todas las respuestas.
7. Si `--no-open` no está, abrir el navegador en `/?boot=<token>` con `xdg-open`, `open` o `start`
   según SO.
8. Imprimir la URL de arranque y la lista de proveedores activos.
9. El server canjea `boot` por una cookie `HttpOnly; SameSite=Strict; Path=/`, redirige a `/` con
   la URL limpia y quema el token. A partir de ahí el token de sesión no vuelve a aparecer en
   ninguna URL ni es accesible desde JavaScript.
10. Esperar señales. En `SIGINT` o `SIGTERM`: cerrar server, matar mpv hijo, cerrar SQLite,
    salir con el código correspondiente.

## Estructura del módulo

```
packages/cli/
├─ bin/nn-anime              shim ejecutable (#!/usr/bin/env bun)
├─ src/index.ts              parseo de flags y orquestación
├─ src/args.ts               parser de flags, sin dependencias externas
├─ src/open-browser.ts       apertura por SO, con fallback a imprimir la URL
├─ src/lifecycle.ts          señales, cierre ordenado, registro de hijos
└─ src/args.test.ts
```

## Success Criteria

Estado a `13320b7`: **once verificados, tres pendientes por diseño.**

- [x] `bun run start` imprime la URL y el navegador abre la home. **Verificado** en modo producción
      con `curl`, y con un navegador real: `xdg-open` lanzó Firefox y el navegador consumió el token.
- [x] Tras el canje, la barra de direcciones muestra `/` sin parámetro `boot`, y `document.cookie`
      no expone la cookie de sesión. **Verificado** por la cabecera `Location: /` y por el atributo
      `HttpOnly`, que es lo que impide leerla desde JavaScript. No se comprobó en un navegador.
- [x] Un segundo uso del mismo token de arranque devuelve 401. **Verificado** en vivo, y el token
      además caduca a los cinco minutos.
- [x] Ninguna respuesta del server carece de las cabeceras de seguridad del spec de proyecto.
      **Verificado** en siete familias de respuesta y en la tabla completa de rutas.
- [x] `nn-anime --port 7717` con 7717 ocupado arranca en otro puerto y lo informa. **Verificado** en
      vivo: «El puerto 7717 estaba ocupado; se usa el 38109». En desarrollo falla en su lugar, a
      propósito: el proxy apunta a un puerto fijo.
- [x] `nn-anime "naruto"` abre `/search?q=naruto`. **Verificado** en vivo con
      `nn-anime naruto shippuden` → `Location: /search?q=naruto%20shippuden`.
- [x] `nn-anime --help` sale con código 0 y no arranca el server. **Verificado** por test, con el
      arranque inyectado para poder afirmar que no se llama.
- [x] `nn-anime --port abc` sale con código 2. **Verificado**.
- [ ] Ctrl+C durante la reproducción en mpv deja el proceso mpv muerto: se verifica con `pgrep`.
      → **T29**, cuando exista el reproductor. El cierre ordenado ya está y mata a los hijos
      registrados, pero todavía no hay ningún hijo que matar.
- [x] Con una migración rota a propósito, sale con código 3 y no arranca el server. **Verificado**
      con la migración inyectada. T16 sustituye el marcador por el runner real.
- [x] Con `mpv` ausente del `PATH`, la app arranca y `/api/health` informa `mpv: false`.
      **Verificado** en vivo, y es el estado real de esta máquina.
- [ ] Ningún archivo fuera de las rutas XDG se crea o modifica. **Parcialmente verificado**: con
      los tres directorios indicados, el arranque no toca las rutas reales —de hecho falla si no se
      le indica la de caché en un entorno donde no puede escribir en ellas—, y hay tests de
      `ensureDirs` con directorios temporales. Falta una comprobación explícita de que no se abre
      nada fuera de las rutas dadas, que es de **T46**.
- [ ] `package.json` del CLI declara `bin`, `files` y `publishConfig`; `bun pm pack` produce un
      tarball instalable, sin publicarlo. **Parcial**: `bin` está declarado y el shim funciona
      (`nn-anime 0.1.0`), y `bun pm pack` sale con 0. Falta `files` y `publishConfig` en **T46**, y
      hay dos cosas que hay que resolver antes de publicar de verdad, descubiertas al ejecutarlo:
      el paquete **incluye los tests** (no hay `files` que los excluya) y las dependencias son
      `workspace:*`, que npm no sabe resolver —`bun publish` sí las reescribe—.
- [x] Añadir un idioma al CLI es un archivo de catálogo más una entrada en `LOCALES` de `core`.
      **Verificado** en el sentido que importa: el mecanismo está probado, los mensajes salen del
      catálogo —hay un test que falla si aparece una clave sin usar— y hoy `--lang en` cae a `es`
      sin fallar. El inglés no está traducido.

## Boundaries

**Always**

- Imprimir la URL aunque el navegador se abra, para copiar y pegar.
- Registrar todo proceso hijo y matarlo en el cierre ordenado.
- Mantener el arranque libre de llamadas de red salientes; sólo se sirve local.

**Ask first**

- Añadir un modo distinto de arranque (bandeja del sistema, demonio, servicio de usuario).
- Abrir el server a la red local.
- Publicar el paquete en npm. El repo queda listo para hacerlo desde v1; ejecutarlo es aparte.

**Never**

- Escuchar en `0.0.0.0`.
- Persistir el token de sesión o el de arranque.
- Imprimir en consola el token de arranque más allá de la URL que se abre.
- Escribir la cookie de sesión desde JavaScript.
- Bloquear el arranque esperando a un proveedor de red.
- Matar procesos por nombre; sólo los hijos registrados.

## Open Questions

1. ¿Se quiere además un modo terminal puro, tipo `nn-anime --list`, para listar resultados sin
   navegador? ani-cli lo hace con un menú interactivo. No está en v1.
2. ¿El binario debe quedar en el `PATH` vía `bun link`, o basta `bun run start` en desarrollo?
