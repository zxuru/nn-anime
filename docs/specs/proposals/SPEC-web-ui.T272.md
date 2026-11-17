# Propuesta: la búsqueda enfoca su campo y la tarjeta no lleva sello

Módulo: `web-ui` · Task: T272 · Estado: pendiente de que lo integre el dueño del spec.

## Qué cambia

1. **El campo de título se lleva el foco al entrar en `/search`**, tanto en una carga completa como
   en una navegación sin recarga desde la cabecera. Se enfoca con `preventScroll`, para no mover la
   página de quien llega con una consulta ya puesta.
2. **El armazón no devuelve el foco al `main` cuando la pantalla nueva ya enfocó algo dentro.** Hoy
   el `Shell` mueve el foco al contenido en cada cambio de camino; el efecto de la búsqueda corre
   antes —de dentro hacia fuera— y el del armazón lo borraba. La guarda es general: cualquier
   pantalla que reclame el foco al montarse lo conserva.
3. **La tarjeta de resultado pierde el sello «Origen: …» y la fila «También en».** La obra sigue
   saliendo una sola vez; la preferencia de proveedor sigue decidiendo a qué ficha lleva, y las
   demás fuentes de esa obra se eligen en su ficha, donde ya estaban.

## Por qué

Buscar es la acción de la pantalla y el campo es lo único que hay antes de escribir; sin el foco
había que tabular desde la cabecera para empezar. El `main` es un destino razonable cuando la
pantalla no pide nada, pero no cuando la propia pantalla tiene un control principal.

En la tarjeta, lo que se busca es una obra. Un sello de proveedor en cada resultado competía con el
título sin cambiar la decisión de nadie, y la lista de fuentes alternativas convertía cada tarjeta
en un índice de proveedores. Elegir dónde verla es una decisión de la ficha, que ya la ofrece con
los nombres declarados por cada fuente.

## Alternativas descartadas

- **El atributo `autoFocus`.** Funciona al montar, pero no permite pedir `preventScroll` y deja el
  `scroll` de la página a merced del navegador. El efecto explícito dice lo mismo y mide lo mismo.
- **Diferir el foco del armazón con un temporizador.** El orden de los efectos ya es determinista;
  un retardo escondería una carrera que se arregla con una guarda.
- **Quitar la agrupación por obra.** La tarjeta duplicada es el contenido repetido que T66 corrigió;
  lo que se retira es la lista de fuentes, no la identidad de la obra.
- **Mover el sello al `title` de la tarjeta.** Un dato de proveedor que sólo aparece al pasar el
  puntero no se lee en táctil ni con teclado.

## Lo que la propuesta no afirma

No cambia la ficha: su sección «También en» sigue ofreciendo cada fuente. Tampoco toca la identidad
de la obra ni el anuncio `aria-live`, que sigue contando obras y no respuestas. El foco del armazón
sigue moviéndose al `main` en todas las pantallas que no reclaman uno propio.
