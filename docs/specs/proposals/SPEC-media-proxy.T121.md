# Propuesta: `fetchAllowed` sale también con POST

Task: T121 · Spec afectado: `SPEC-media-proxy.md` (sección del guardián de destinos)

## El cambio exacto

`AllowedFetchOptions` gana dos campos opcionales:

```ts
readonly method?: 'GET' | 'POST' | undefined
readonly body?: string | undefined
```

y la petición los pasa tal cual al `fetch` inyectado (`redirect: 'manual'` y las comprobaciones de
destino no cambian; el método no interviene en ellas).

## El motivo

AniList publica su API **sólo por POST** en un único endpoint GraphQL. `fetchAllowed` es la función
que ya implementa «salir a la red con el destino comprobado en cada salto» y no admite método: sin
esto, el cliente de AniList tendría que reescribir la revalidación de redirecciones por su cuenta
—la copia que el proyecto evita— o salirse de ella, que es peor.

La restricción del vocabulario es deliberada: `GET` y `POST`. Esto es una puerta de salida, no un
cliente HTTP; un `DELETE` que llegue aquí es un error de quien llama y es mejor que no compile.

## La alternativa descartada

**Un `fetchAllowedPost` aparte**: duplica el bucle de saltos y la comprobación por salto, que es
justo el código cuya unicidad hace que una redirección no escape. Dos copias divergen, y la que se
olvide de revalidar es la que se explota.

## Lo que no cambia

- `GET` sigue siendo el valor por defecto: quien ya llama sin método no cambia de comportamiento.
- La comprobación de destino se repite en cada salto, también en un POST.
- El tope de saltos (`MAX_REDIRECTS = 5`) y el error de lista agotada son los mismos.
