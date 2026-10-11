# Spec: recsys
> **Los criterios de esta lista no son el registro que se mantiene.** El trabajo se cierra contra la
> aceptación de cada tarea en `tasks/todo.md`, que está marcada **y medida mutando la implementación**;
> esta lista es el contrato —el *qué*— y duplica aquélla. Se decidió en el Checkpoint H: mantener dos
> listas de lo mismo acaba con una de las dos mintiendo, y la que mintió durante la v1 fue ésta.


Module id: `recsys` · Depende de: `core`, `catalog-store` · Paquete: `packages/recsys`
Convenciones heredadas de `SPEC-nn-anime.md`.

## Objective

Recomendar animes concordantes con lo que el usuario busca y ve, sin salir de la máquina, sin
GPU y sin servicio externo. Cada recomendación explica por qué está ahí.

Éxito significa:

1. Con al menos 5 episodios vistos de 3 títulos distintos, la home muestra recomendaciones
   distintas de las de un usuario sin historial.
2. Toda recomendación trae al menos una razón legible en español, del tipo "porque viste X" o
   "comparte 3 géneros con lo que buscaste".
3. El motor es una función pura sobre datos locales: se testea sin red y sin server.
4. La recomendación incorpora lo que el usuario está buscando ahora, no sólo lo que vio.
5. Menos de 50 ms para 10 recomendaciones sobre un historial de 500 registros.

## Contrato

Funciones puras. Sin acceso a base ni a red: reciben las señales, devuelven el ranking.

```ts
// packages/recsys/src/index.ts

export interface Signals {
  /** Títulos con al menos un episodio visto, más reciente primero. */
  readonly watched: readonly WatchedSignal[]
  readonly favorites: readonly RefSignal[]
  /** Búsquedas recientes, más reciente primero. */
  readonly searches: readonly SearchSignal[]
  /** Hora actual inyectada: el motor no lee el reloj. */
  readonly now: Date
}

export interface WatchedSignal {
  readonly ref: ProviderRef
  readonly tags: readonly string[]
  readonly year?: number
  readonly studios: readonly string[]
  /** 0..1. Episodios vistos entre episodios totales. */
  readonly completion: number
  readonly at: Date
}

export interface SearchSignal {
  readonly query: string
  /** Títulos que el usuario abrió desde esa búsqueda. */
  readonly openedRefs: readonly ProviderRef[]
  readonly at: Date
}

export interface Candidate {
  readonly ref: ProviderRef
  readonly title: string
  readonly tags: readonly string[]
  readonly year?: number
  readonly studios: readonly string[]
  /** 0..1, popularidad dentro del proveedor si está disponible. */
  readonly popularity?: number
  readonly coverUrl?: string
}

export interface Recommendation {
  readonly candidate: Candidate
  /** 0..1, normalizado. */
  readonly score: number
  /** Al menos una. Ordenadas por aporte al score, de mayor a menor. */
  readonly reasons: readonly Reason[]
  readonly components: {
    readonly affinity: number
    readonly covisit: number
    readonly recency: number
    readonly diversity: number
  }
}

export interface Reason {
  readonly kind: 'similar-to-watched' | 'shares-tags' | 'same-studio' | 'co-watched'
    | 'matches-search' | 'popular' | 'cold-start'
  readonly text: string
  readonly evidence: readonly string[]
}

export function recommend(
  signals: Signals,
  candidates: readonly Candidate[],
  options?: RecommendOptions,
): readonly Recommendation[]

export interface RecommendOptions {
  readonly limit?: number          // por defecto 20
  readonly mmrLambda?: number      // por defecto 0.7
  readonly seed?: number           // para tests deterministas
}
```

Algoritmo v1, en este orden:

1. **Vector de afinidad.** Cada título visto pondera sus tags, estudio y año. Peso =
   `recencia × completitud`. Recencia decae exponencial con semivida de 30 días. Completitud
   sube el peso hasta 1,0; abandonar en el episodio 1 pesa poco.
2. **Similitud de contenido.** Similitud coseno entre el vector de afinidad y los tags del
   candidato, con IDF sobre el corpus de candidatos para que un tag universal como "Acción" no
   domine. Bonus de 0,1 si comparte estudio.
3. **Co-visita.** Cuenta de pares (candidato, título visto) que aparecen en la misma sesión de
   visionado, entendida como eventos separados por menos de 6 h. Normalizado por el par más
   frecuente. Esta señal es la única "colaborativa" y es puramente local.
4. **Señal de búsqueda.** Los términos buscados se cruzan con título y tags de candidatos. Un
   candidato abierto desde una búsqueda reciente y no visto sube fuerte y se marca
   `matches-search`.
5. **Penalización por repetición.** Se resta afinidad a los títulos ya vistos, salvo que la
   completitud sea menor a 0,3 y hayan pasado más de 30 días: ahí puede volver como reencuentro.
6. **Diversidad final.** Reranking con MMR sobre los tags, `lambda` 0,7 por defecto, para no
   devolver seis temporadas de lo mismo.
7. **Arranque en frío.** Sin historial, se usan favoritos y búsquedas; sin nada de eso, se
   devuelven los candidatos por popularidad con razón `cold-start` y el texto explica que es
   popularidad porque todavía no hay historial. Desde T50 los candidatos incluyen además los
   títulos que dejó una búsqueda en `search_cache`, aunque nadie abriera su ficha: entran sin
   vector y sólo pueden puntuar por popularidad. El motor **no** cambia: quien arma la lista de
   candidatos es la ruta.

Determinismo: con el mismo `Signals`, los mismos `candidates`, el mismo `seed` y el mismo
`now`, la salida es idéntica y en el mismo orden. Ningún desempate depende del orden de
iteración de un `Map` sin criterio explícito.

## Estructura del módulo

```
packages/recsys/
├─ src/index.ts          fachada recommend()
├─ src/affinity.ts       vector de afinidad, decaimiento, IDF
├─ src/covisit.ts        sesiones y pares
├─ src/search-signal.ts  cruce de búsquedas con candidatos
├─ src/mmr.ts            reranking por diversidad
├─ src/reasons.ts        generación de textos en español
└─ src/*.test.ts
```

## Success Criteria

- [ ] Con `signals` vacíos, `recommend` devuelve `cold-start` ordenado por popularidad.
- [ ] Con historial de acción, un candidato de acción puntúa más alto que uno de romance con el
      resto de condiciones iguales.
- [ ] Un tag presente en el 80 % del corpus tiene menos peso IDF que uno presente en el 5 %.
- [ ] Un título visto al 100 % no reaparece en el top 10.
- [ ] Un título visto al 10 % hace más de 30 días sí puede reaparecer.
- [ ] Cada recomendación del top 20 tiene al menos una razón con `text` no vacío.
- [ ] Con `seed` fijo, dos ejecuciones dan resultados idénticos y en el mismo orden.
- [ ] Dos títulos del mismo tag no copan el top 5: MMR lo impide, verificado con un test.
- [ ] 500 registros de historial y 5000 candidatos: `recommend` tarda menos de 50 ms.
- [ ] Ningún test del paquete hace red ni abre la base: se verifica con un test que corre en
      un entorno sin `fetch` y sin `bun:sqlite` disponible.

## Boundaries

**Always**

- Recibir el historial ya resuelto: este paquete no consulta `catalog-store` por su cuenta.
- Devolver al menos una razón por recomendación.
- Mantener la salida determinista dado `seed` y `now`.
- Explicar cada componente del score por separado, para poder depurar una recomendación rara.

**Ask first**

- Añadir embeddings, modelo de machine learning o cualquier dependencia que pese más de 5 MB.
- Cambiar la firma de `recommend` o el tipo `Reason`.
- Introducir aleatoriedad no sembrada.

**Never**

- Llamar a un servicio externo ni a un LLM.
- Enviar el historial a ningún lado.
- Leer el reloj del sistema dentro del motor: `now` se inyecta.
- Recomendar contenido que el proveedor no tenga disponible para el usuario.

## Privacy

El motor es local por diseño. La consecuencia buscada es que no exista ningún punto del sistema
donde el historial del usuario salga del equipo. Cualquier propuesta futura de "mejorar las
recomendaciones con un servicio" choca con este spec y requiere aprobación explícita.

## Open Questions

1. ¿El peso de la señal de búsqueda debe decaer con el tiempo igual que el visionado? Se propone
   semivida de 3 días, mucho más corta.
2. ¿Se debe poder fijar un "no me interesa" por título que alimente el ranking? No está en v1.
3. ¿La UI muestra los componentes del score o sólo la razón? Se propone mostrar sólo la razón,
   con los componentes detrás de un `title` para depurar.
