# Propuesta: el interruptor de contenido para adultos y su marca

Task: T128 · Spec afectado: `SPEC-web-ui.md` · Estado: pendiente de que lo integre el dueño del
spec.

## El cambio exacto

1. **`GET /api/settings` gana `adultContent: boolean`, con `false` por defecto.** `PATCH
   /api/settings` lo acepta, y el `refine` que hoy exige «al menos uno de los dos» pasa a exigir
   «al menos uno de los tres». La clave en la tabla de ajustes es `adultContent`, como `theme` y
   `providerPriority`: el ajuste vive en la base y no en el navegador, por la razón que ya está
   escrita en `routes/settings.ts` —un ajuste de `localStorage` no se puede leer desde el servidor
   y se pierde al cambiar de navegador—.
2. **La página de ajustes lleva el interruptor en su propio bloque, con el aviso escrito.** El
   bloque dice qué hace —«enseñar también el contenido que AniList marca para adultos»— y qué no
   —«no comprueba la edad de nadie»—, porque un interruptor sin consecuencia declarada se enciende
   por curiosidad y se deja encendido.
3. **El cambio se ve sin reiniciar.** Encender o apagar el interruptor tiene que notarse en la
   vitrina sin recargar: las listas se vuelven a leer y las filas del panel se repintan. El
   precedente es el de los proveedores —desmarcar una casilla se ve al instante— y el ajuste se
   aplica en la lectura, así que no hay nada que reiniciar; lo que hay que hacer es **volver a
   pedir**.
4. **La marca `+18` va donde el dato llega: en la pieza de las listas de AniList y en la ficha.**
   La pieza la lee de `discoverItem.adult` / `airingItem.adult`, y la ficha de `enrichment.adult`
   —el enriquecido de la obra emparejada—. Es texto y no sólo color: un borde o un tinte no lo lee
   un lector de pantalla, y el repo ya tiene una pasada de accesibilidad que lo vigila. Los textos
   van a `packages/web/src/i18n/es.ts`, no sueltos en el componente.

## Por qué

Con el interruptor **apagado** la marca no se ve nunca —no hay nada marcado que enseñar—, y eso es
correcto. La marca existe para el estado **encendido**: quien pide ver todo tiene derecho a saber
cuál de las piezas es la que el filtro estaría escondiendo, y sin eso el desbloqueo convierte una
vitrina mixta en una vitrina indistinguible. El interruptor y la marca son la misma decisión vista
desde los dos lados, y por eso van juntos.

El interruptor es un booleano y no una lista de géneros ni un umbral: el único dato que la
aplicación tiene es `isAdult`, que ya es booleano. Ofrecer más granularidad sería inventar una
clasificación que nadie publica.

## Las alternativas descartadas

- **Guardarlo en `localStorage`.** Ya descartado para el tema y por el mismo motivo: el servidor es
  quien decide qué pide a AniList y qué sirve, y un ajuste que sólo lee el navegador no puede
  cambiar ninguna de las dos cosas.
- **Una pantalla intermedia de edad** («¿tienes 18 años?»). No comprueba nada —es un botón—, y en un
  servidor local de un solo usuario la sesión la tiene quien abre el puerto. Finge una garantía que
  no existe; el aviso escrito no la finge.
- **Marcar `Ecchi`.** Es un género de catálogo corriente y marcarlo dejaría fichas con `+18` que no
  lo son. Un aviso que miente se acaba ignorando, y con él los que sí importan.
- **Un ajuste por proveedor.** El criterio es de la obra y no de la fuente: la misma obra puede
  venir de dos fuentes y la decisión es la misma. Con un booleano por proveedor, apagar uno dejaría
  la obra entrando por el otro.

## Lo que la propuesta no afirma

Que con el interruptor apagado desaparezca todo lo que el usuario consideraría para adultos. La
interfaz sólo puede esconder lo que el servidor no le manda, y el servidor sólo filtra donde tiene
señal: las filas de proveedor —búsqueda, tendencias, novedades, favoritos, historial, «seguir
viendo»— se filtran sólo si la referencia se marcó antes, con el interruptor encendido. La ficha de
un título al que el usuario llegue por su cuenta no se bloquea: es su catálogo, y esconderle una
ficha que ya abrió antes no protege a nadie.
