# SPEC-anime-detail.T108 — la ficha y el historial, con proveedores cargados

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-anime-detail.md`.

## Qué cambia

En la regla «Sólo se relacionan títulos que la base ya conoce»:

> - **Sólo se relacionan títulos que la base ya conoce**, y «la base» son las **fichas abiertas y los
>   listados cacheados** —búsquedas, tendencias y novedades—.

pasa a:

> - **Sólo se relacionan títulos que la base ya conoce y que la aplicación puede abrir**, y «la base»
>   son las **fichas abiertas y los listados cacheados** —búsquedas, tendencias y novedades—. De un
>   proveedor desmarcado en Ajustes quedan fichas en la base —desmarcar no borra—, así que la
>   sección no ofrece sus tarjetas: ninguna de las dos lecturas locales de la ficha lleva
>   referencias de un proveedor que no esté cargado.

En «`server` — dos rutas y un umbral», el párrafo:

> Las dos son locales: no llaman al proveedor y no llevan `X-Cache`. Un proveedor desconocido sigue
> siendo 404; una referencia que no está en la base devuelve lista vacía, que es la verdad —nadie
> abrió esa ficha todavía—.

pasa a:

> Las dos son locales: no llaman al proveedor y no llevan `X-Cache`. Un proveedor desconocido sigue
> siendo 404; una referencia que no está en la base devuelve lista vacía, que es la verdad —nadie
> abrió esa ficha todavía—. Y lo que devuelven son referencias de **proveedores cargados**: ni un
> hermano de saga ni una fuente alternativa de un proveedor desmarcado, porque su ficha contesta
> 404.

En el párrafo de `GET /api/watch/recent` se añade, al final:

> La fila tampoco lleva visionados de un proveedor que ya no está cargado, por el mismo motivo: la
> tarjeta abriría una ficha que contesta 404.

## Por qué

Medido con la instalación real, `animex` desmarcado en Ajustes: `/api/watch/recent` devolvía su
visionado, y con el mismo título en la base, `/api/anime/:providerId/:ref/related` y `/sources`
ofrecían fichas suyas —el visionado apareció en un control con una base sembrada a mano, porque en
la base real ese visionado no llegaba al 2 % que pide la fila—. Todas esas tarjetas llevan a la misma
ficha, que contesta `404 no hay ningún proveedor llamado animex`.

## Alternativa descartada

**Filtrar sólo la home.** Deja el fallo en la ficha: la sección de relacionados y el selector de
fuentes siguen ofreciendo al proveedor ausente, y el usuario llega al 404 por otro camino. La regla
es una sola y vale para las siete lecturas; partirlas en dos entregas deja una mitad mintiendo.
