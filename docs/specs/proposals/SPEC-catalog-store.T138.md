# Propuesta: el TTL de la búsqueda cruzada

Task: T138 · Spec afectado: `SPEC-catalog-store.md` (Data Model y tabla de TTL)

Estado: propuesta, sin integrar. La integra el dueño del spec, que anota la aprobación y borra este
archivo.

## El cambio exacto

La tabla de TTL gana una fila, con el mismo formato que las cuatro que añadió T121:

```ts
// packages/catalog-store/src/cache-policy.ts
export const TTL_SECONDS = {
  // …
  /*
   * Lo que AniList tiene de un término como estudio o como género: seis horas,
   * como el ranking. Un estudio estrena como mucho una vez por temporada y su
   * lista cambia cuando se anuncia la obra, no cada día. La añade T138.
   */
  anilistSearch: 21600,
} as const
```

No hay migración ni tabla nueva: la lista se guarda en `anilist_list_cache`, la que ya existe, con su
propia clave. Lo único que cambia es cuánto dura.

## Por qué

La lectura es la misma pregunta que el ranking —«qué obras tiene este estudio»— y cambia al mismo
ritmo: cuando se anuncia una temporada nueva, no cada día. Seis horas es lo que dura el top y el
mismo orden de magnitud que la parrilla, y cumple la condición que los términos de uso de AniList
piden a esta aplicación: TTL obligatorio y ni una petición que no responda a una pantalla.

La clave lleva el término normalizado, la mitad y el eje del interruptor de adultos, así que dos
grafías del mismo término comparten entrada y encender el interruptor no sirve la lista del estado
anterior.

## La alternativa descartada

**Reutilizar `anilistTop`.** Es lo que se hizo mientras se medía, y funciona, pero deja dos recursos
distintos —un ranking global y la lista de un estudio— colgando del mismo número: el día que uno de
los dos tenga que cambiar, cambia el otro sin que nadie lo haya decidido. La tabla de TTL existe
justo para eso.
