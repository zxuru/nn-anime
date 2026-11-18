# SPEC-recsys · perfil de gustos declarado (T345)

## Qué cambia

`RecommendSignals` gana un campo opcional `taste: TasteSignals` con lo que el usuario declaró en
la encuesta, ya resuelto contra el corpus:

```ts
interface TasteSignals {
  genres: { name: string; weight: number }[]
  excludedGenres: readonly string[]
  liked: readonly Candidate[]
  format?: 'long-series' | 'short-series' | 'movies'
  tone?: 'dark' | 'light' | 'emotional'
  behaviorEvents: number
}
```

`recommend()` mezcla esa señal con el historial. Sin `taste`, la salida es la de siempre.

## Reglas

- **La cuota se desplaza con el comportamiento.** `declaredShare(behaviorEvents)` vale 1 sin
  visionados y baja de forma lineal hasta `0,15` a los 20. El mínimo es deliberado: lo declarado
  no se borra por una racha.
- **Los géneros excluidos filtran.** Un candidato con un género excluido no aparece, aunque encaje
  por todo lo demás.
- **Los títulos marcados entran como vector.** Se resuelven contra el corpus del servidor; un
  título que la base no conoce no aporta nada.
- **Formato y tono ordenan, no excluyen.** El catálogo no publica número de episodios, así que
  «series largas» y «temporadas cortas» comparten la señal de serie; el tono se deduce de los
  géneros del título.
- **Cada señal declarada lleva su razón.** Las claves nuevas son `reason.taste-genre`,
  `reason.taste-title`, `reason.taste-format` y `reason.taste-tone`.

## Contrato HTTP

| Ruta | Qué hace |
|---|---|
| `GET /api/taste` | Perfil y `skipLimit`. Sin fila devuelve un perfil `not_started`. |
| `POST /api/taste` | Guarda la encuesta. `status: completed` sustituye; `skipped` cuenta la omisión y conserva lo que no se haya marcado. |
| `GET /api/taste/titles` | Hasta 12 títulos del catálogo ya conocido, con portada. |
| `GET /api/taste/rows?media=` | Filas por género declarado, sin añadir nada al catálogo. |

El perfil se guarda en `taste_profile` (una fila por `userId`; hoy `local`). Cada señal guarda
`source: 'survey' | 'behavior'` y `updatedAt`; las de comportamiento se derivan del historial de
visionado, que sigue siendo su fuente de verdad, en lugar de duplicarlo.

## Alternativa descartada

Guardar también los pesos de comportamiento en la tabla del perfil. Se descartó porque el
historial de visionado ya es la fuente de verdad y una copia se quedaría vieja en cuanto una
reproducción no llegara a persistirse.
