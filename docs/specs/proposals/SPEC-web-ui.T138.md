# Propuesta: la búsqueda cruzada en la página de búsqueda

Task: T138 · Spec afectado: `SPEC-web-ui.md` (la ruta `/api/search` y la página `/search`)

Estado: propuesta, sin integrar. La integra el dueño del spec, que anota la aprobación y borra este
archivo.

## El cambio exacto

**El SSE de `/api/search` gana un evento**, y sigue recibiendo lo mismo (`q`, `provider`, `media`):

```ts
export const searchEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('results'), providerId: z.string(), results: z.array(searchResultSchema) }),
  // Nuevo: lo que AniList tiene del término como estudio o como género.
  z.strictObject({ type: z.literal('anilist'), items: z.array(discoverItemSchema) }),
  z.strictObject({ type: z.literal('error'), /* … */ }),
  z.strictObject({ type: z.literal('done'), providers: z.number().int().nonnegative() }),
])
```

Sus piezas son las del descubrimiento —`discoverItemSchema`, con portada por la ruta local y **con
`ref` cuando la base ya conoce la obra**— y no las de un proveedor: una obra que ninguna fuente tiene
no tiene referencia que ofrecer. `ref` decide lo mismo que en el top y en la parrilla: con ficha
local abre la ficha, sin ella la búsqueda de su título.

El evento de cierre es el de siempre y **no se adelanta**: el `done` de los proveedores se retiene
hasta que la cruzada ha hablado, porque la pantalla concluye «nada coincide» al cerrar.

**La página `/search` gana una sección**, debajo de la rejilla de proveedores: el mosaico de siempre
—el de las filas de AniList de la home— con las piezas de la cruzada, cada una con su sello «En tus
fuentes» cuando la base la conoce. El anuncio de la región `aria-live` cuenta también esas piezas:
una búsqueda por género sin nada en los proveedores y veinte piezas en pantalla no puede anunciarse
como «0 resultados».

## Por qué

Es la mitad que las fuentes no pueden contestar, y va **aparte** de la rejilla de proveedores porque
no es lo mismo: una dice «esto es lo que hay», la otra «esto es lo que tus fuentes tienen». Mezclar
las dos formas en la misma lista obligaría a la rejilla a pintar dos clases de tarjeta y a contar dos
cosas distintas en el mismo recuento.

El evento sale como propio y no dentro de `results` por una razón que se ve en el contrato:
`searchResultSchema` exige una referencia de proveedor y estas piezas pueden no tenerla. Meterlas ahí
sería inventar una referencia para lo que ninguna fuente tiene.

## La alternativa descartada

**Filtrar la lista de AniList a lo que ya está en los proveedores.** Deja la pantalla sin la mitad de
lo que se pidió —lo que AniList sabe y las fuentes no tienen es justo lo que rellena el hueco— y
convierte la cruzada en una segunda forma de pintar lo mismo.

**Pedir la lista a AniList al abrir la página, por una ruta propia.** Sería una petición más por
búsqueda, con su propio ciclo de vida y su propia cancelación; el SSE que ya existe lleva la
cancelación del cliente puesta —cortar la conexión aborta la consulta al tercero— y el orden de los
eventos es exactamente lo que hay que ordenar aquí.
