# SPEC-discovery.T108 — el arranque en frío y los proveedores cargados

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-discovery.md`.

## Qué cambia

En `/api/catalog/recent`, paso a paso, se añade un paso y el que hoy es el 4 pasa a ser el 5:

> 4. **Sólo referencias de proveedores cargados.** La fila es local y la base conserva lo de un
>    proveedor que se desmarcó en Ajustes, así que el corte se hace al leer: una tarjeta cuya ficha
>    contesta 404 es una puerta que la aplicación abre y cierra a la vez.
> 5. Sin escrituras y sin migración: es una lectura.

En «Qué entra al motor de recomendación», el párrafo:

> Los candidatos de `gatherSignals` pasan a incluir **los títulos de `search_cache`**, con sus tags
> del corpus cacheado cuando el título ya está en `anime`. Es lo que hace que quien busca y no abre
> nada tenga destacado y top 5.

pasa a:

> Los candidatos de `gatherSignals` pasan a incluir **los títulos de `search_cache`**, con sus tags
> del corpus cacheado cuando el título ya está en `anime`. Es lo que hace que quien busca y no abre
> nada tenga destacado y top 5. Los candidatos —y las señales de visionado que los puntúan— son
> **sólo de proveedores cargados**: el destacado de la home no puede ser un título que la ficha
> contesta con 404.

## Por qué

Medido con la instalación real: `animex` desmarcado, y `/api/recommendations` devolvía **«The
Ramparts of Ice Season 2» como primer elemento** —el destacado de la home, con su portada y su
motivo— y `/api/catalog/recent` otras dos de sus fichas. La ficha de ese título contestaba `404 no
hay ningún proveedor llamado animex`.

No es una hipótesis sobre la base del usuario: se reprodujo contra una **copia de su base**, con los
proveedores cargados que él tiene (`animeav1` y `jkanime`). El destacado pasó a ser un título de
`animeav1`, con su razón real, en cuanto la lectura se acotó.

## Alternativa descartada

**Quitar los candidatos al escribir y no al leer.** Borrar lo del proveedor desmarcado pierde el
historial y los favoritos, que volver a marcarlo debería devolver. El spec de los repositorios ya
dice que un plugin que hoy no carga recupera su sitio cuando vuelve.
