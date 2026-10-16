# Propuesta: una línea de arranque legible por máquina y el cierre por `stdin`

**Módulo:** `cli-launcher` · **Task:** T132 · **Estado:** propuesta, sin aprobar. El dueño del spec
la integra en `docs/specs/SPEC-cli-launcher.md`, anota la aprobación y borra este archivo.

Contexto completo en `docs/estudio-tauri.md`. Aquí va sólo el cambio de contrato, exacto.

> **Corrección de la primera versión de esta propuesta.** Pedía también una bandera `--web-root` para
> que el binario compilado encontrara el build de la interfaz. **Ya no hace falta**: la rama
> `ci/instalables-y-releases` trae `packages/cli/src/resources.ts`, que resuelve la interfaz y las
> migraciones en este orden —variable de entorno (`NN_ANIME_WEB_DIR`, `NN_ANIME_MIGRATIONS_DIR`),
> recurso incrustado con `--asset`, árbol de fuentes— y tiene sus pruebas. Una bandera nueva sería una
> segunda forma de decir lo mismo, y la que existe está probada. Se retira del pedido.

## Cambio 1 — una línea nueva por `stdout`, sin traducir

Al final del paso 8 del arranque (imprimir la URL y los proveedores), una línea más, **fija**:

```
NN_ANIME_BOOT {"port":41235,"url":"http://127.0.0.1:41235/?boot=<token>"}
```

- El prefijo es literal y **no pasa por el catálogo i18n**: quien la lee es un programa, no una
  persona.
- `port` va aparte de la URL porque el puerto es lo único que es seguro escribir en un log.
- **No se registra en el log**, igual que hoy no se registra la URL.
- Sale también con `--no-open` y sin él: es información, no un modo.

**Motivo.** El anfitrión de escritorio necesita la URL con el token, y lo único que hay hoy es la
línea humana traducida por i18n (`packages/cli/src/boot.ts:381`). Analizar texto traducido es un
contrato que se rompe al traducir. Y hoy la única forma de que un anfitrión sepa dónde escuchar es
leer esa misma línea.

**Alternativa descartada: `--handshake <ruta>`, un archivo con la URL.** Es la forma habitual y se
descarta por una razón del propio spec: dejaría el token de arranque en disco, y «Persistir el token
de sesión o el de arranque» está en la lista de *Never* de este módulo. Una tubería no persiste nada.

## Cambio 2 — el cierre también por `stdin`

El paso 10 pasa a:

> 10. Esperar señales **o el cierre del `stdin`**. En `SIGINT`, en `SIGTERM`, al recibir la línea
>     `shutdown` por `stdin` o al cerrarse el `stdin`: cerrar server, matar mpv hijo, cerrar SQLite,
>     salir con `0` en los dos últimos casos y con el código de la señal en los dos primeros.

**Motivo.** En Windows no hay `SIGTERM` de verdad: el `kill` de un proceso padre es
`TerminateProcess`, sin señal, sin `finally`. Mientras «la consola **es** la aplicación» eso no se
nota —cerrarla manda `SIGINT`—, pero con una ventana el cierre lo pide el anfitrión, y sin esto cada
cierre deja un `mpv` huérfano y un SQLite que nadie cerró. La entrada estándar existe en las tres
plataformas.

## Cambio 3 — la lista de *Never*, con una línea más

Añadir a *Never*:

> - Escribir el token de arranque en disco.

Y a *Always*:

> - Imprimir la línea `NN_ANIME_BOOT` aunque el navegador se abra, y no registrarla.

## Qué **no** cambia

- **Ningún camino de hoy cambia de comportamiento**: las dos cosas son aditivas. La línea de arranque
  se suma a las que ya se imprimen, y sin nadie escribiendo por `stdin` —una terminal interactiva no
  escribe— el cierre por señales sigue siendo el único camino.
- El arranque sigue sin llamadas de red salientes, sigue escuchando sólo en `127.0.0.1` y sigue sin
  persistir el token.
- Los códigos de salida no cambian.
- La resolución de la interfaz y las migraciones no se toca: la de `resources.ts` se queda como está.

## Cómo se verifica

1. `NN_ANIME_BOOT` aparece **una sola vez** en la salida, su JSON valida contra un esquema, y **no
   aparece en el log con `-v`**. **Mutación**: quitar la línea deja al anfitrión sin URL, y la prueba
   que la lee tiene que fallar.
2. Con `shutdown\n` por `stdin`, el proceso sale con `0`, la base queda cerrada y el hijo de prueba
   registrado queda muerto. **Mutación**: dejar de escuchar el `stdin` deja el proceso vivo.
3. Con el `stdin` cerrado sin escribir nada, el proceso sale igual con `0` (es el caso de un
   anfitrión que muere de golpe).
4. Y lo que **no** debe cambiar: sin `stdin` y sin señales, el proceso sigue vivo sirviendo; y
   `SIGINT` sigue saliendo con 130, como hoy.
