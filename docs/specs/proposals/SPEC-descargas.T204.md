# Propuesta · descargar la serie entera desde la ficha (T204)

Sobre la propuesta `SPEC-descargas.T181.md`, sin cambiar lo que ya declara: el alta de un episodio,
la cola, el motor y las rutas de archivo se quedan como están. Esto añade el gesto que faltaba en la
ficha —apuntar todos los capítulos de un título— y una ruta que lo sirve.

## La ruta

```
POST /api/downloads/series  { providerId, animeRef } → { episodes, pending, complete }
```

- **El cliente no manda episodios.** Manda el título; el servidor lee su lista con el mismo lector
  paginado que usa la ficha (`getEpisodesPage`), así que ve lo que la fuente declara ahora, incluidos
  los títulos que sólo pagina el plugin (`capabilities.episodePages`).
- **Orden de descarga.** La lista se ordena por temporada y número antes de crear las filas: apuntar
  una serie es bajarla desde el primer capítulo. La cola mantiene su concurrencia (2 por defecto);
  «en orden» no significa «de uno en uno».
- **Idempotencia.** Cada fila se crea con el alta que ya existe, que no duplica por
  `(provider_id, episode_ref)`. Lo completo no vuelve a la cola; lo que ya estaba en cola se
  engancha otra vez con `queue.add`, que ignora lo que ya está.
- **Tope.** Cien páginas por petición y ocho segundos por página. Una fuente que conteste «hay más»
  para siempre no deja la petición abierta, y una página sin episodios nuevos la corta —una
  paginación que solapa no puede hacer un bucle—.
- **Errores.** `400` cuerpo inválido, `404` proveedor desconocido y, para el fallo de la lista, el
  mismo criterio que `/episodes` (`statusForEpisodes`): `404`, `409` o `502` con el motivo del
  proveedor.
- **Números de la respuesta.** `episodes` es lo que el proveedor declaró; `pending`, lo que está en
  cola o bajando tras el alta; `complete`, lo que ya estaba. No son una promesa de los capítulos
  futuros de una serie en emisión.

## La ficha

- Un bloque **Descargas** en la barra lateral, debajo de las tres marcas del usuario: botón
  «Descargar la serie» —o «Descargar la película»—, el estado del alta y un enlace a la biblioteca.
  Un fallo no cierra el botón: volver a pulsar es el reintento.
- El estado dice lo que pasó sin redondearlo a «hecho»: cuántos esperan turno, o que ya está
  descargada, o cuántos quedaron descargados de los que hay.
- **El selector de modos sólo se pinta cuando hay más de uno.** La ficha de una fuente que sólo
  ofrece subtitulado enseñaba dos botones, uno apagado con su explicación: un mando que no manda. El
  modo sigue viajando con cada episodio porque lo elige `chosenMode`.

## Fuera de esta propuesta

- Seguir la serie para bajar capítulos que aún no existen: esto apunta lo que la fuente declara hoy.
- Descargar temporadas sueltas o un rango de capítulos.
- Cambiar la concurrencia de la cola para una serie.
