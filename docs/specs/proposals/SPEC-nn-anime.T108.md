# SPEC-nn-anime.T108 — una lectura local no ofrece lo que no se puede abrir

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-nn-anime.md`.

## Qué cambia

En §Contrato HTTP, después del párrafo «El contrato de proveedor (`Provider`) no vive aquí», se
añade:

> **Una lectura local no ofrece lo que la aplicación no puede abrir.** Las respuestas que salen de la
> base —el ranking de recomendaciones, «último añadido», continuar viendo, favoritos, el catálogo por
> género, los relacionados y las otras fuentes del título— sólo llevan referencias de **proveedores
> cargados en ese momento**. Deshabilitar un proveedor en Ajustes no borra sus filas —volver a
> habilitarlo tiene que devolver el historial a su sitio—, así que el corte se hace al leer.
>
> Las lecturas de **una referencia concreta** no cambian: `/api/anime/:providerId/:ref`, sus
> episodios, `/related`, `/sources` y `/watched` siguen contestando 404 cuando el proveedor no está
> cargado, que es su regla de siempre y la correcta. `/api/cover/:providerId/:ref` es la excepción y
> se queda como está: sirve la imagen de una referencia **ya cacheada** —la pide un cliente que ya la
> tiene— y no ofrece ninguna tarjeta nueva; acotarla no cierra una puerta, sólo rompe la portada de
> una tarjeta que ya estaba pintada.

## Por qué

Con la instalación real delante: `animex` desmarcado en Ajustes, sus filas todavía en la base
—2 fichas, 5 búsquedas cacheadas, 1 visionado—, y la home pintando **«The Ramparts of Ice Season 2»
como destacado**, con su portada y su motivo. Al pulsarla, la ficha contestaba `404 no hay ningún
proveedor llamado animex`: la aplicación ofrecía una puerta que ella misma había cerrado.

Estaba en todas las lecturas locales, no sólo en el destacado: medido con la misma base,
`/api/recommendations`, `/api/catalog/recent`, `/api/watch/recent`, `/api/favorites`,
`/api/anime/:id/:ref/related` y `/api/anime/:id/:ref/sources` devolvían referencias de `animex`.
`/api/feed` y `/api/trending` no: ésas preguntan a los proveedores cargados y nunca lo ofrecieron.

Escribir la regla aquí, y no sólo en cada módulo, tiene un motivo práctico: es la que un lector del
contrato necesita para no volver a añadir una lectura local sin acotar. El filtro vive en un solo
módulo del servidor (`packages/server/src/provider-scope.ts`) precisamente para que la octava
lectura no repita el fallo.

## Alternativa descartada

**Borrar las filas del proveedor al desmarcarlo.** Es más simple de escribir y peor de usar: el
historial de visionado y los favoritos de ese proveedor desaparecerían para siempre, y volver a
marcarlo —que es lo que se hace cuando el plugin falló al cargar por un archivo a medias— no los
devolvería. El propio spec de los repositorios dice que un plugin que hoy no carga recupera su sitio
cuando vuelve; borrar sus datos lo contradice.

**Filtrar en cada ruta.** Se probó a medir: son siete lecturas en seis archivos, y la regla se
repite con la esperanza de que nadie añada la octava sin copiarla. Una sola pieza que las envuelve
tiene el mismo efecto y un solo sitio donde equivocarse.
