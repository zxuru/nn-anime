# Persistencia entre versiones

**Qué garantiza este documento:** que actualizar nn-anime —instalador NSIS, copia
portable, `bun run start` o el binario compilado— **no pierde** el progreso, el
historial, las listas del usuario ni los ajustes, y que cualquier cambio de
esquema futuro pasa por una migración con copia de seguridad. Lo que dice aquí
se mide en `bun test` y en `bun run e2e`; no es una promesa de diseño.

## 1. Inventario: qué dato vive dónde

Todo lo del usuario vive en el directorio de **datos locales**. En la ventana instalada de Windows
es `%LOCALAPPDATA%\nn-anime-data`, **hermana** de la carpeta de instalación
(`%LOCALAPPDATA%\nn-anime`); el CLI usa `%LOCALAPPDATA%\nn-anime` porque no se instala. En POSIX es
`~/.local/share/nn-anime` y la configuración `~/.config/nn-anime`. `NN_ANIME_DATA_DIR` mueve la raíz.
Nunca está en la carpeta del ejecutable.

| Dato | Dónde | Formato | Sobrevive a actualizar |
|---|---|---|---|
| Progreso por episodio/película | `dataDir/nn-anime.db`, tabla `watch_event` (`position_s`, `duration_s`, `finished`, `started_at`) | SQLite | Sí: migraciones aditivas + copia previa |
| «Continuar viendo» | Derivado de `watch_event` (`GET /api/watch/recent`); no hay almacén aparte | SQLite | Sí |
| Historial de visionado | `watch_event` (`GET /api/watch/history`) | SQLite | Sí |
| Último contenido abierto / descubrimiento | `anime`, `search_cache`, `trending_cache`, `feed_cache`, `episode_page` | SQLite | Sí (caché, prescindible) |
| Marcas de visto / quiero ver / favoritos | `watched_title`, `plan_to_watch`, `favorite` | SQLite | Sí |
| Historial de búsquedas | `search_history` | SQLite | Sí |
| Ajustes de la aplicación | `setting` (JSON) y `configDir/config.json` | SQLite + JSON | Sí |
| Preferencia de reproducción automática y de modo extendido | `localStorage` del webview (`nn-anime:autoplay`, `nn-anime:extendido`) | Cadena | Sí, es del perfil del webview |
| Progreso local del navegador | `localStorage`, `nn-anime:progreso:<provider>:<ref>` (con `:tmp` para la escritura atómica) | JSON | Sí; es una copia de comodidad, la fuente de verdad es `watch_event` |
| Descargas | fila en `download` (SQLite) + archivos en la carpeta que elige el usuario | SQLite + archivos | Fila sí; los archivos, donde el usuario los puso |
| Plugins de proveedor | `configDir/providers`, selección en `setting` | TypeScript | Sí |
| Caché | `cacheDir` | Archivos | Sí, desechable |
| Copias de seguridad | `dataDir/backups/nn-anime-backup-<fecha>-v<versión>.db` (5 por defecto) | SQLite | Sí |
| Servidor extraído del `.exe` | `dataDir/bin/<versión>/` | Ejecutable | Sí; una actualización deja la anterior intacta |
| Perfil del webview (Tauri) | `dataDir/webview/` | Directorio de WebView2/WKWebView | Sí |
| Registro del anfitrión | `dataDir/registro.log` | Texto | Sí |

Los datos **no** se guardan junto al ejecutable. La única excepción es el modo portable **explícito**:
quien crea `portable.txt` al lado del `.exe` elige que todo viaje con el programa; y ni en ese caso el
reemplazo del ejecutable borra los datos, porque sólo se renombra el `.exe`. El respaldo silencioso al
directorio del ejecutable y la carpeta de datos dentro de la instalación se **retiraron**
(`desktop/src-tauri/src/entorno.rs`): el instalador de Tauri en modo `currentUser` instala en
`%LOCALAPPDATA%\nn-anime` y los datos van a `%LOCALAPPDATA%\nn-anime-data`. Una instalación anterior,
que guardaba los datos dentro de la carpeta de instalación, los traslada una sola vez al arrancar.

### Cómo se comprueba que el instalador y el portable no tocan los datos

- El NSIS de Tauri instala **por usuario** (`installMode: currentUser`,
  `%LOCALAPPDATA%\nn-anime`) y no contiene ninguna ruta de datos: la base la crea el programa al
  arrancar, en `%LOCALAPPDATA%\nn-anime-data`.
- La copia portable actualiza **sólo el `.exe`** (renombrar → escribir → borrar el viejo):
  `desktop/src-tauri/src/actualizacion.rs`.
- `packaging/windows/probar-instalador.ps1` (lo ejecuta el CI en Windows) comprueba, con el
  instalador de verdad, que la base nace en `%LOCALAPPDATA%\nn-anime-data` y **no** en la carpeta de
  instalación, y que sigue ahí después de desinstalar.
- `scripts/desktop.test.ts` comprueba en cada `bun test` que el anfitrión no tiene un camino de datos
  hacia el directorio del ejecutable, que la carpeta de datos es hermana de la de instalación y que el
  modo portable es explícito.
- `packages/core/src/config.test.ts` fija las rutas por plataforma y que `NN_ANIME_DATA_DIR` manda.

## 2. Regla: todo cambio de esquema requiere migración y test de migración

**No se toca una migración publicada.** Las instalaciones que ya la aplicaron no
la vuelven a ejecutar; editarla hace que dos instalaciones con la misma versión
tengan esquemas distintos. Un cambio de esquema es siempre un archivo
`NNNN-nombre.sql` nuevo.

Las migraciones del repositorio son **inmutables** una vez registradas en
`packages/catalog-store/migrations.lock.json`. El bloqueo guarda la huella de
cada archivo y la última versión. `bun run scripts/migraciones.ts` falla si:

- una migración registrada cambia o desaparece;
- aparece una migración sin registrar (hay que ejecutar
  `bun run scripts/migraciones.ts --actualizar` y commitear el resultado);
- hay un hueco o una versión repetida;
- el bloqueo y las migraciones no dicen la misma versión;
- hay `CREATE TABLE`, `CREATE INDEX`, `CREATE VIEW`, `CREATE TRIGGER` o
  `ALTER TABLE` en el código de producción fuera de `migrations/` —el esquema se
  declara sólo en migraciones—;
- una migración es destructiva (`DROP TABLE/INDEX/VIEW/TRIGGER`,
  `ALTER TABLE … DROP`, `DELETE FROM`, `TRUNCATE`) sin la marca
  `-- nn-anime: destructiva-ok: <motivo>`;
- una migración trae `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT` (el runner ya
  envuelve cada archivo en su transacción).

El CI lo ejecuta en el trabajo `calidad` (paso «Migraciones»). En local:

```
bun run scripts/migraciones.ts                 # comprueba, igual que el CI
bun run scripts/migraciones.ts --actualizar    # registra la migración nueva
bun test packages/catalog-store                # migraciones desde cada versión anterior
```

Cada migración nueva tiene además que pasar `packages/catalog-store/src/migrations/upgrades.test.ts`,
que migra **desde cada versión anterior** con datos de usuario y comprueba que
siguen ahí.

## 3. Copia antes de migrar, rotación y restauración

`migrateDatabase` (`packages/catalog-store/src/migrations/migrate.ts`) es el
motor que usan el arranque real (`packages/cli/src/index.ts`) y
`bun run db:migrate`:

1. Lee la versión. Si la base es **más nueva** que el binario, no la toca y lo
   dice: abrir datos nuevos con una versión vieja los degradaría.
2. Si hay migraciones pendientes, hace una copia con `VACUUM INTO` (consistente
   aunque haya conexiones abiertas y WAL pendiente), la escribe en un temporal,
   la fuerza a disco y la renombra (`rename` atómico). Rota: conserva las
   `BACKUP_RETENTION = 5` más recientes en `dataDir/backups`.
3. Aplica las pendientes, una transacción por archivo.
4. Si una falla: **no se sale con la base a medias**. Se cierra la conexión, se
   borran `-wal`/`-shm`, se restaura la copia encima con temporal + `rename`, se
   comprueba con `PRAGMA integrity_check` y se arranca con la versión anterior y
   sus datos. El aviso dice qué migración falló y de qué copia se restauró.
   Nunca se arranca con una base vacía.
5. Si la copia no se puede hacer, **no se migra**: se devuelve el error y la
   base queda como estaba.

La copia va al lado de la base (`dataDir/backups`) porque un `VACUUM INTO` a otro
volumen sería una copia entre discos.

## 4. Guardado del progreso, robusto

- El reproductor informa cada ~250 ms; `useWatchEvents` manda la posición al
  servidor **cada 5 s**, y además en pausa, al soltar una búsqueda (`seeked`),
  al cambiar de episodio (desmontaje), con `visibilitychange` (pestaña oculta o
  ventana de Tauri escondida), `pagehide`, `beforeunload` y con el evento
  `nn-anime:ocultar-ventana`, que el anfitrión despacha desde Rust antes de
  ocultar la ventana en la bandeja o de cerrar el servidor al salir. Los avisos
  van en una cola para que dos `PATCH` no lleguen desordenados.
- `pagehide`/`beforeunload` usan `fetch(..., { keepalive: true })`: sin eso la
  petición se cancela con la página.
- `localStorage` se escribe en dos pasos (`:tmp` → definitiva) y se lee con
  recuperación del temporal: un cierre entre las dos escrituras no deja un JSON a
  medias.
- Al reanudar se retrocede 3 s (`RETROCESO_REANUDAR_S`) para tener contexto, sin
  bajar del mínimo de 10 s. El segundo que manda es el del enlace (`?at=`) o el
  del servidor; el progreso local es la reserva. Si la fuente cambió, la pantalla
  de error ofrece las demás con la misma referencia de episodio y la posición
  (`SourceFallback`), y el tiempo se conserva.

## 5. Qué se prueba

| Qué | Dónde |
|---|---|
| Migrar desde **cada** versión anterior con datos reales | `packages/catalog-store/src/migrations/upgrades.test.ts` |
| Orden, idempotencia, no destructivo, no tocar bases nuevas | `packages/catalog-store/src/db.test.ts` |
| Reglas de forma de las migraciones | `packages/catalog-store/src/migrations/policy.test.ts` |
| Copia, rotación, integridad, restauración atómica | `packages/catalog-store/src/migrations/backup.test.ts` |
| Migración rota forzada y restauración | `packages/catalog-store/src/migrations/migrate.test.ts` |
| Guardado y recuperación del progreso local | `packages/web/src/features/player/storage.test.ts` |
| Ritmo y cuerpo del guardado del visionado | `packages/web/src/features/player/useWatchEvents.test.ts` |
| Actualización real: dos servidores, migración 16 de prueba, mismo `dataDir` | `packages/web/e2e/persistencia.e2e.ts` |
| Regla de inmutabilidad y huecos del bloqueo | `scripts/migraciones.test.ts` |
| Datos fuera del directorio del ejecutable | `scripts/desktop.test.ts` |
