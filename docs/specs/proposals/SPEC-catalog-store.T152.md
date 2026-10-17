# Propuesta: el Perfil, su Historial y la marca de «quiero ver»

Task: T152 (cierre del trabajo de T146–T151) · Specs afectados: `SPEC-catalog-store.md` (contrato
de repositorio y estructura), `SPEC-nn-anime.md` (Data Model) y `SPEC-web-ui.md` (superficie HTTP)

Estado: propuesta, sin integrar. La integra el dueño del spec, que anota la aprobación y borra este
archivo.

## El cambio exacto

### 1. `SPEC-catalog-store.md` — la tabla y tres métodos

El contrato de la fachada gana tres métodos, con el mismo estilo que los de las otras dos marcas:

```ts
// packages/catalog-store/src/index.ts (fachada CatalogStore)
/**
 * La marca de «quiero ver». Es independiente de `favorite` y de `watched_title`:
 * escribir aquí no toca ninguna de las otras dos.
 */
setPlanToWatch(ref: ProviderRef, value: boolean): Promise<void>
listPlanToWatch(): Promise<readonly PlanToWatchTitle[]>
/**
 * El historial, por páginas: todo lo que se reprodujo, lo terminado incluido.
 *
 * No es un parámetro de `listRecentlyWatched`: aquélla alimenta «continuar viendo»
 * y es señal de afinidad del motor, así que su semántica no se toca.
 */
listWatchHistory(limit: number, offset: number): Promise<readonly WatchRecord[]>
```

`PlanToWatchTitle` es `AnimeSummary` más `createdAt: Date`, hermana de `WatchedTitle`.

La estructura del módulo gana un archivo: `src/repositories/plan-to-watch.ts`. Y las migraciones,
una más: `0012-quiero-ver.sql`.

```sql
CREATE TABLE plan_to_watch (
  anime_id   INTEGER PRIMARY KEY REFERENCES anime (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
```

`PRUNED_TABLES` gana `plan_to_watch`, y `doomedAnime` —la consulta que decide qué se puede
limpiar— gana su `NOT EXISTS`, junto al del favorito y el de la marca de visto.

### 2. `SPEC-nn-anime.md` — el Data Model

La lista de tablas del Data Model gana una fila:

```
plan_to_watch    anime_id, created_at — la escribió T147. Tercera marca del usuario, hermana de
                 `favorite` y de `watched_title`: tabla propia porque la marca es del usuario y el
                 refresco del proveedor reescribe la fila del título, así que una columna la
                 pisaría. Sin TTL: querer ver algo no se vence
```

Es la duodécima tabla. La tabla de TTL **no cambia**: el historial y las marcas se leen de la base
y no se cachean, así que no hay recurso nuevo con caducidad.

### 3. `SPEC-web-ui.md` — dos pantallas y cuatro rutas

Las pantallas de la interfaz ganan dos, y la superficie HTTP que consumen, cuatro rutas:

```
GET  /api/plan-to-watch           -> { items: AnimeSummary[] }
POST /api/plan-to-watch           -> { ref, value } -> 204 | 400 | 404
GET  /api/watch/history?page=N    -> { items: WatchHistoryItem[], page, hasMore }
GET  /api/profile                 -> { favorites, watched, planToWatch, history }
```

`WatchHistoryItem` es `ContinueWatchingItem` más `id` (la fila del visionado) y `finished`.

## Por qué

**La tercera marca, y por qué es una tabla y no una columna.** El usuario pidió «los que quiere ver»
además de lo visto y lo favorito. Las tres son listas independientes suyas, y la decisión se midió:
marcar como vista una obra **no** la saca de pendientes. La alternativa —acoplarlas— borraría una
marca a mano sin decirlo, y además inventaría una regla de producto que nadie pidió.

**El historial, aparte de «continuar viendo».** Son dos preguntas distintas sobre la misma tabla:
«qué dejé a medias» —que además es señal de afinidad del motor— y «qué he reproducido». La primera
descarta lo terminado y agrupa por episodio; la segunda no hace ninguna de las dos cosas. Meter un
parámetro en `listRecentlyWatched` habría cambiado, para servir una pantalla, la lectura de la que
dependen la home y el motor. La proyección SQL vive en una constante que comparten las dos consultas,
así que no pueden divergir.

**El `id` de la fila en el historial, y no en «continuar viendo».** «Continuar viendo» agrupa por
episodio, así que cada episodio sale una vez; el historial **no agrupa**, así que el mismo episodio
reproducido dos veces son dos renglones idénticos. Sin un identificador propio, la lista no tiene con
qué distinguirlos. Lo encontró la guarda del linter sobre claves de lista, que es exactamente el
sitio donde ese defecto se manifiesta.

**Una ruta agregada y no cuatro lecturas.** Una pantalla que enseña el estado del único usuario no
puede pintar tres secciones y callar la cuarta porque una lectura falló: con `/api/profile`, o está
el Perfil o está en error y se puede reintentar.

**El Perfil es la vista del estado del usuario, no una identidad.** El proyecto declara fuera de
alcance las cuentas y el multiusuario (`CAPABILITY-MAP.md`), así que «Perfil» aquí no tiene
credenciales, nombre ni nada que sincronizar: es la pantalla que responde «¿qué he hecho yo aquí?».

**Nada de esto sale a la red.** Las cuatro listas se leen de la base y el filtro de contenido para
adultos es local (`sinMarcadas`): abrir el Perfil no justifica preguntarle nada a AniList.

## La alternativa descartada

**Cuatro peticiones en paralelo desde la interfaz**, una por lista. Se descartó por el estado a
medias: con una que falla, tres secciones se pintan y la cuarta queda en un hueco que nadie explica,
y la pantalla no tiene forma de decir que le falta un trozo. La ruta agregada cuesta una respuesta
más grande y compra un estado de error único y honesto.

**Reutilizar `watched_title` para lo pendiente** con un valor de estado en vez de un booleano
—`visto | pendiente | ninguno`—. Se descartó por lo mismo que el acoplamiento: son dos listas del
usuario y una fila no puede estar en las dos, así que marcar como vista una obra pendiente la
sacaría de pendientes sin preguntar. Tres tablas pequeñas cuestan menos que una regla que borra
marcas.

**Guardar la página del historial en un estado del componente** en vez de en la dirección. Se
descartó porque pierde lo que el resto de la aplicación ya hace: recargar, compartir el enlace y
volver con el botón de atrás a la página anterior en vez de salir de la pantalla.

## Lo que **no** cambia, y conviene que se lea

- **`recsys` no lee la marca de «quiero ver».** La marca se guarda y se muestra, y el motor la
  ignorará hasta que se decida lo contrario. Fue una decisión explícita de alcance: es una señal
  positiva fuerte y meterla en el motor es un cambio de comportamiento de las recomendaciones, no un
  detalle del Perfil. Queda como trabajo de seguimiento.
- **La marca de visto de `/api/watched-titles` sigue sin filtrar por adultos.** Es una pregunta de
  estado —«¿esta obra está marcada?»— y la lee el botón de la ficha; filtrarla lo dejaría en «no
  está» sobre una obra que sí lo está. La lista de «quiero ver» **sí** filtra, porque pinta tarjetas.
