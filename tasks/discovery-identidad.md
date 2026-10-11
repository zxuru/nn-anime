# Descubrimiento: la misma obra con dos nombres

Origen: con la búsqueda de «danmachi» delante, la misma obra sale **dos veces** y con dos nombres
—«Danmachi» en `jkanime`, «Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka» en `animeav1`—
y las dos fichas enseñan secciones de relacionados distintas. Con las palabras de quien lo reportó:
«me salen con un nombre pero otros con el original pero ambos responden, más uno toma que hay
relacionados y otros que no».

Medido sobre la base de desarrollo (`~/.local/share/nn-anime/nn-anime.db`, 57 fichas, dos
proveedores activos), las cuatro filas de la obra:

| proveedor | título | referencia | año |
|---|---|---|---|
| jkanime | Danmachi | `dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka` | 2015 |
| animeav1 | Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka | `danmachi` | 2015 |
| animeav1 | Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka III | `danmachi-iii` | 2020 |
| jkanime | Danmachi: Sword Oratoria | `dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka-gaiden-sword-oratoria` | 2017 |

Antes de esta entrega, la ficha de `jkanime/…-darou-ka` relacionaba **una** entrega y la de
`animeav1/danmachi` **otra**: cada una veía sólo la mitad de su propia saga. Y en la búsqueda, dos
tarjetas de la misma obra.

La sesión que trabaja en `tasks/discovery-fuentes.md` (T74–T76) arregla la mitad de la familia —una
tarjeta por obra en el arranque en frío, «También en» en la ficha— con la clave *título normalizado
más año*, y **declara este caso como su límite**: dos fuentes que escriben el título distinto no
emparejan. Esta entrega es ese límite.

## Decisiones

1. **La identidad se arma con lo que la fuente ya dijo, sin red.** El nombre que muestra, su
   `titleAlt` —que el contrato de plugins tiene desde el principio y sólo se pintaba bajo el
   título— y la referencia escrita como título: en estos catálogos el slug de la referencia suele
   ser el título original, y es donde los dos nombres de esta obra se encuentran (`danmachi` por un
   lado, `dungeon-ni-deai-wo-motomeru-no-wa-machigatteiru-darou-ka` por el otro). Una referencia sin
   letras es un identificador y no cuenta.
2. **La clave es título base más temporada, no título de saga.** El título de saga corta el
   subtítulo y juntaría la película con la serie: `sagaTitle('Kimetsu no Yaiba Movie 1: Mugenjou-hen')`
   es `kimetsu no yaiba`, igual que el de la serie. La temporada entra porque el título base la
   quita: «Overlord» y «Overlord IV» son dos obras.
3. **Dos obras son la misma cuando los nombres de una están todos entre los de la otra, o cuando
   comparten un nombre visible.** Lo primero es el caso de esta captura; lo segundo es el de
   siempre —dos fuentes con el mismo título y referencias distintas— y el de una tercera fuente que
   use el nombre inglés. Un nombre que sólo tiene una de las dos —el subtítulo del spin-off— deja la
   pareja fuera.
4. **El año no entra en la identidad.** Los proveedores no lo devuelven en los resultados de
   búsqueda (medido: 0 de 46 listados cacheados lo llevan), así que una regla que dependiera de él
   no agruparía nada en la pantalla donde se reportó el defecto. El año se sigue usando donde ya se
   usaba: la agrupación de T74, que lo tiene.
5. **El nombre que pinta la tarjeta es el más largo de la obra.** Cuando dos fuentes nombran lo
   mismo, la corta suele ser el alias con el que se la conoce y la larga el título original
   completo. Es una heurística y se llama así: una fuente con un subtítulo de más le gana el nombre
   a la que acierta. El orden es estable, así que a igualdad de largo manda el que llegó primero.
6. **La ficha sigue siendo la de su fuente.** No se fusionan referencias: la tarjeta enlaza a una
   ficha concreta, con sus episodios y su reproductor, y las demás fuentes quedan a un clic.

Rige el **Definition of Done** de `tasks/plan.md`.

## T78 — `core` + `catalog-store` + `web`: una obra con dos nombres

**Qué:** `namesOf`, `workKeys` y `sameWork` en `core/identity.ts`; la agrupación de la búsqueda por
esa identidad, con el nombre más largo delante; y las **dos** lecturas de la ficha —los hermanos de
saga y las otras fuentes de la misma obra— comparando contra las sagas de **todos** los nombres.

**Por qué:** es la pieza que faltaba para que la misma obra sea una: la tarjeta, el nombre, la
sección de hermanos y el «también en». La lectura vive donde ya vivía —una consulta preparada, el
mismo mapa por obra y el mismo orden— y la identidad es pura, así que se mide sin base y sin
navegador.

**Archivos:** `packages/core/src/identity.ts` (nuevo), `packages/core/src/index.ts`,
`packages/core/package.json` (la subruta `./identity`), `packages/catalog-store/src/repositories/related.ts`,
`packages/web/src/features/search/useSearchStream.ts`.

**Aceptación:**

- [x] `sameWork` junta las dos fichas reales de la tabla de arriba y **no** junta la serie con su
      spin-off ni con su película. Medido mutando: quitar la regla de los nombres anidados deja en
      rojo «la misma obra con dos nombres distintos es la misma»; usar el título de saga como clave,
      «la película no es la serie».
- [x] La búsqueda devuelve **una** tarjeta para la obra, con el nombre más largo. Medido mutando:
      `porNombre` a cero deja en rojo las dos pruebas del grupo.
- [x] La ficha de `jkanime/…-darou-ka` y la de `animeav1/danmachi` devuelven **lo mismo**: la
      tercera temporada y el spin-off. Medido mutando: comparar sólo contra la saga del título de la
      ficha deja las dos listas vacías.
- [x] La misma obra en otra fuente no se lista como hermana, aunque la nombre distinto. Medido
      mutando: quitar la exclusión la deja en rojo.
- [x] «También en» ofrece la otra fuente cuando los nombres no coinciden: la lectura de T75 pasa de
      `titleKey` a `sameWork`, y el año sigue siendo parte de la comparación. Medido mutando: volver
      al título normalizado deja la ficha sin «también en».
- [x] Sigue siendo **una** consulta preparada por lectura (contador de consultas de
      `related.test.ts`) y el prefiltro de SQL cubre los nombres de la obra, no sólo su título.
- [x] Sin `any`, sin `@ts-ignore`, sin `as` para silenciar, sin pruebas saltadas.

**Verificación:** `bun test` 1255 pasan, 0 fallan en `core`, `catalog-store`, `web` y `server` ·
`tsc --noEmit` 0 · `biome check` 0 errores.

**Depende de:** nada. **Tamaño:** M.

## Lo que queda, y se declara

1. **El arranque en frío sigue con la clave de T74** (título normalizado más año), que no ve este
   caso: la misma obra puede salir dos veces en «Último añadido» y en «Novedades», con dos nombres.
   El arreglo es cambiar la clave de `routes/discovery.ts` y `routes/recommendations.ts` por
   `sameWork`, y va en su propio task: son dos archivos de implementación más, y esta entrega ya
   está en el tope de cinco.
2. **«Continuar viendo» y favoritos no se agrupan**, por la misma razón que declaró T74: son
   historial de lo que se vio y dónde.
3. **El nombre largo gana por longitud**, no por ser el original: una fuente con un subtítulo de más
   le gana el nombre a la que acierta. Se declara aquí en vez de descubrirlo en la interfaz.
