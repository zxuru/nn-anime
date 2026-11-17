# Propuesta: una tarjeta por obra, sin el índice de fuentes

Módulo: `provider-core` · Task: T272 · Estado: pendiente de que lo integre el dueño del spec.

## Qué cambia

El punto de «Agrupación de duplicados» deja de prometer «También en». La agrupación se mantiene
—título normalizado más año, una tarjeta por obra— y cambia sólo lo que la interfaz pinta: la
tarjeta no enumera las demás fuentes ni lleva sello de origen. Las otras fuentes de esa obra se
eligen en su ficha, que ya las recibe del servidor.

## Por qué

La regla que importa del contrato —una obra es una tarjeta, no una por proveedor— no cambia. Lo que
sobra es la presentación: un enlace por fuente en cada resultado convierte la rejilla en un índice
de proveedores y compite con el título, que es lo que el usuario busca. La referencia sigue sin
fusionarse: la tarjeta lleva a la ficha de una fuente concreta, y la preferencia de los ajustes
decide cuál.

## Lo que no cambia

El contrato del plugin, la respuesta del servidor y la identidad de la obra. La búsqueda sigue
devolviendo todos los proveedores en paralelo y el anuncio `aria-live` sigue contando obras.
