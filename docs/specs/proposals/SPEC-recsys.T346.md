# SPEC-recsys · formato real, catálogo e idioma (T346)

## Qué cambia

`Candidate` gana dos campos opcionales que la ficha ya guardaba y el motor no
veía:

```ts
episodeCount?: number
status?: 'airing' | 'finished' | 'upcoming' | 'unknown'
```

`TasteSignals` gana:

```ts
audio?: 'sub' | 'dub' | 'either'
catalog?: 'airing' | 'classic' | 'either'
audioByProvider?: ReadonlyMap<string, { sub: boolean; dub: boolean }>
```

## Reglas

- **Series largas y cortas dejan de ser lo mismo.** Con `episodeCount`, una serie
  de 24 o más capítulos satisface «larga» y una de 13 o menos satisface «corta».
  Sin dato, la respuesta es `0.5`: no consta, no se adivina.
- **El catálogo ordena por estado.** «Emisión actual» premia `airing`; «clásicos»
  premia `finished`. `unknown` y `upcoming` se quedan a medias.
- **El idioma es de la fuente.** El candidato no publica si tiene doblaje; el
  plugin declara `sub` y `dub` para todo su catálogo. La tabla se resuelve en el
  servidor y el motor sigue siendo puro.
- **Cada preferencia nueva tiene su razón:** `reason.taste-catalog` y
  `reason.taste-audio`, con el mismo trato que formato y tono.

## Contrato HTTP

- `GET /api/taste` añade `autoOpen: boolean`. El arnés de pruebas lo apaga con
  `RONA_TASTE_AUTO_OPEN=0` para que las pruebas que ya existían no aterricen en
  `/gustos`.
- `DELETE /api/taste` borra el perfil y deja la encuesta en `not_started`. No toca
  el historial: las señales de comportamiento se derivan de él.

## Alternativa descartada

Deducir la duración por el nombre del título o por `kind`. Un `tv` de seis
capítulos y otro de veinticuatro son el mismo `kind`; usar el nombre sería medir
la obra por cómo se llama, que es justo lo que la ficha evita.
