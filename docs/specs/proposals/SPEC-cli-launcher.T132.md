# Propuesta: una línea de arranque legible por máquina y el cierre por `stdin`

**Módulo:** `cli-launcher` (y un apunte sobre `core`) · **Task:** T132 · **Estado:** propuesta,
**implementada en T134** y pendiente de aprobación. El dueño del spec la integra en
`docs/specs/SPEC-cli-launcher.md`, anota la aprobación y borra este archivo.

Contexto completo en `docs/estudio-tauri.md`. Aquí va sólo el cambio de contrato, exacto, con lo que
se midió al implementarlo.

> **Correcciones respecto a la primera versión.** (1) Pedía una bandera `--web-root`: se retira,
> porque `packages/cli/src/resources.ts` ya resuelve la interfaz y las migraciones por variable de
> entorno, recurso incrustado o árbol de fuentes, y tiene sus pruebas. (2) El cierre por `stdin`
> incluía «o al cerrarse el `stdin`»: **se retira también**, y el motivo está medido en el cambio 2.

## Cambio 1 — una línea nueva por `stdout`, sin traducir

Al final del paso 8 del arranque (imprimir la URL y la lista de proveedores), una línea más, **fija**:

```
NN_ANIME_BOOT {"port":41235,"url":"http://127.0.0.1:41235/?boot=<token>"}
```

- El prefijo es literal y **no pasa por el catálogo i18n**: quien la lee es un programa, no una
  persona.
- `port` va aparte de la URL porque es lo único de esa línea que es seguro escribir en un log.
- **No se registra en el log**, igual que hoy no se registra la URL.
- Sale también con `--no-open` y sin él: es información, no un modo.

**Dónde vive el formato.** En `packages/core` (`boot-line.ts`): `BOOT_LINE_PREFIX`, el esquema
`bootLineSchema`, `formatBootLine` y `parseBootLine`. Es el mismo archivo el que la escribe y el que
la lee, y eso es lo que impide que los dos se separen. El primer consumidor es
`scripts/package/smoke.ts`, que arranca el ejecutable empaquetado en las tres plataformas del CI y
necesitaba saber dónde escucha.

**Motivo.** Un anfitrión necesita la URL con el token, y lo único que hay hoy es la línea humana
traducida por i18n (`packages/cli/src/boot.ts`). Analizarla funciona **porque sólo existe el catálogo
en español**: medido el 2026-10-16, con `NN_ANIME_LANG=en` la línea sigue diciendo «Servidor en …»,
porque el inglés no está traducido. El día que se traduzca, cualquier lector que analice la línea
humana se rompe sin avisar. Esta línea quita esa dependencia.

**Alternativa descartada: `--handshake <ruta>`, un archivo con la URL.** Es la forma habitual y se
descarta por una razón del propio spec: dejaría el token de arranque en disco, y «Persistir el token
de sesión o el de arranque» está en la lista de *Never* de este módulo. Una tubería no persiste nada.

## Cambio 2 — el cierre por `stdin`: sólo la línea, **nunca** el fin de la entrada

El paso 10 pasa a:

> 10. Esperar señales **o la línea `shutdown` por la entrada estándar**. En `SIGINT`, en `SIGTERM` o al
>     recibir la línea: cerrar server, matar mpv hijo, cerrar SQLite. Sale con el código de la señal
>     (130, 143) o con `0` si fue una petición por la entrada.

**El fin de la entrada no cierra nada, y es una decisión, no un olvido.** La forma normal de lanzar
este servidor es con la entrada cerrada: `stdin: 'ignore'` está en `scripts/package/smoke.ts`, en
`scripts/e2e-server.ts`, en `scripts/build.ts`, en `scripts/dev.ts` y en los tres scripts de
empaquetado. Si el fin de la entrada cerrara, **el servidor moriría al nacer** y el CI se pondría rojo
en las tres plataformas.

**Motivo del cambio.** En Windows no hay `SIGTERM` de verdad: matar el proceso que lanzó el servidor
es `TerminateProcess`, sin señal, sin `finally`. Medido el 2026-10-16 sobre el ejecutable
empaquetado: tras un `Stop-Process -Force` no se ejecutó **ni una** de las tareas del cierre ordenado
(el `stderr` quedó vacío y la `-wal` sin pasar por el punto de control). Con una línea por la entrada
estándar, el anfitrión tiene una forma de pedir el cierre que existe en las tres plataformas.

**Al anfitrión que muere de golpe lo cubre el sistema operativo, no esta función**: Job Object en
Windows y `PR_SET_PDEATHSIG` en Linux. Es del anfitrión, no del CLI, y por eso no se pide aquí.

## Cambio 3 — la lista de *Never*, con una línea más

Añadir a *Never*:

> - Escribir el token de arranque en disco.

Y a *Always*:

> - Imprimir la línea `NN_ANIME_BOOT` aunque el navegador se abra, y no registrarla.

## Qué **no** cambia

- **Ningún camino de hoy cambia de comportamiento**: las dos cosas son aditivas. La línea de arranque
  se suma a las que ya se imprimen, y sin nadie escribiendo por la entrada —una terminal interactiva
  no escribe— el cierre por señales sigue siendo el único camino.
- El arranque sigue sin llamadas de red salientes, sigue escuchando sólo en `127.0.0.1` y sigue sin
  persistir el token.
- Los códigos de salida de las señales no cambian: 130 y 143.
- La resolución de la interfaz y las migraciones no se toca.

## Cómo se verifica — y cómo se midió

1. La línea aparece **una sola vez**, con el puerto y la dirección del arranque, y **no aparece en el
   log con `-v`**. Medido: prueba de `boot` sobre la salida completa y prueba de `start` de que el log
   serializado no contiene `boot=`.
2. **Con `--lang en` la línea sigue siendo analizable**: medido, la humana también sale en español
   porque el inglés no está traducido, y la de máquina no depende de eso.
3. Con `shutdown\n` por la entrada, el proceso sale con **0**, cierra la base y mata el hijo
   registrado. **Medido sobre el ejecutable empaquetado**: anunció su puerto, la línea lo cerró en
   **17 ms** y el log dijo `{"reason":"stdin","msg":"cerrando"}`.
4. **El fin de la entrada no cierra.** Medido con un doble de la entrada que anota a qué eventos se
   suscribe: sólo se suscribe a `data`. Si alguien añade la escucha de `end`, la prueba falla.
5. Una línea partida en dos trozos (`shut` + `down\n`) también cierra: sin eso, quien escribe sin
   vaciar el búfer se quedaría sin cierre y sin saber por qué.
