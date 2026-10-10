# Decisión del Checkpoint F: HLS se queda en v1

**Fecha:** ronda 35. **Quién decide:** revisión humana del Checkpoint F.

## Qué se preguntó

El riesgo 1 de la tabla de riesgos decía: «la reescritura de HLS se vuelve un pozo sin fondo:
variantes, claves, discontinuidad, URLs relativas anidadas». El plan fijaba la decisión **en el
Checkpoint F y no a mitad de camino**, con un plan B declarado: en v1 sólo streams `file` (mp4) y HLS
para v1.1.

## Qué se decidió

**HLS se mantiene en v1.** No se aplica el plan B.

## Con qué se decidió

- T27 y T28 están hechos y probados: reescritura de variantes y segmentos, claves, inicializadores,
  discontinuidad y tope de líneas, contra **tres playlists de fixture versionadas** en el repositorio,
  con sus salidas esperadas también versionadas. Un cambio de formato se ve en el diff.
- El reproductor web carga `hls.js` con importación dinámica, y `bun run build` confirma que sale en su
  propio trozo: no engorda la búsqueda.
- El proxy reescribe las URIs para que todo pase por él, incluidos claves e inicializadores: un
  segmento o una clave pedidos directamente al upstream dejarían al descubierto su dirección.

## Qué queda fuera, y por qué

- **No se soportan playlists en vivo** (`#EXT-X-MEDIA-SEQUENCE` cambiando): la caché de playlists es de
  10 s y no hay refresco de lista. Un directo necesitaría otra cosa.
- **No se soporta `#EXT-X-BYTERANGE`**: los segmentos por rango no se reescriben.
- **No hay pruebas con un upstream real de HLS**: los fixtures son inventados y viven en el
  repositorio. La verificación contra un sitio real es del e2e (T43) y de uso manual.

## La otra decisión de este checkpoint

Para poder verificar la reproducción en el navegador (criterio 1 del Checkpoint F) sin abrir la lista
blanca de destinos en producción, se acordó una **excepción de loopback sólo en modo test**: el proxy
aceptará `127.0.0.1` cuando una variable de entorno de test lo permita, y el e2e de T43 servirá un mp4
y un HLS locales. La lista blanca sigue intacta en producción, y la excepción lleva su propia prueba
—incluida la de que **sin** la variable, el loopback se sigue rechazando—.
