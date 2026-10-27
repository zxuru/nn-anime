# Plan de tareas: descargas (fase 1)

Spec: `docs/specs/proposals/SPEC-descargas.T181.md` · Estado: **spec escrita, código sin abrir** ·
2026-10-26.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios marcados y medidos, sin `any` ni `@ts-ignore` ni `as` para silenciar, sin tests saltados,
tope de cinco archivos de implementación por task y commit atómico que cita el task.

## Decisiones

- **D2 resuelta:** MP4 primero (copia directa o remux con ffmpeg); si no hay ffmpeg, segmentos
  locales reproducibles sólo en la aplicación. El usuario quiere poder abrir lo descargado fuera de
  nn-anime, y un MP4 es lo que lo hace cierto.
- **D3** (transporte de watch party) y **D5** (formato de manga) siguen abiertas y no bloquean esta
  fase.
- La capacidad `downloads` entra como enmienda de `CAPABILITY-MAP`; la aprueba el humano con esta
  spec. `download` es una capacidad **opcional** del plugin; ausente es no.

## Tareas

| Roadmap | Task | Estado | Depende de |
|---|---|---|---|
| 1.1 Spec | **T181** | hecho: propuesta entregada | — |
| 1.2 Contrato: `capabilities.download` + fixture | **T182** | hecho | T181 |
| 1.3 Motor de descargas (cola, pausa, reanudar, ffmpeg/segmentos) | T183 | **siguiente** | T182 |
| 1.4 Interfaz: botón, página Descargas, progreso | T184 | pendiente | T183 |
| 1.5 Reproducción local y sin red | T185 | pendiente | T183, T184 |
| 1.6 Escritorio: selector de carpeta y aviso | T186 | pendiente | T184 |
| 1.7 Gestión de espacio y borrado | T187 | pendiente | T183, T184 |

## Orden y cortes

1. **T182** no toca el motor: sólo el vocabulario del contrato y el fixture. Se puede medir con la
   conformidad y con una prueba que afirme que un proveedor sin `download` no ofrece el botón.
2. **T183** es el task grande y se corta por dentro si hace falta:
   - T183a: tabla `download`, repositorio y cola persistente.
   - T183b: descarga directa `file` + reanudación por rangos.
   - T183c: HLS con ffmpeg y respaldo de segmentos.
   - T183d: guardias de ruta, host, espacio y cancelación.
   Cada uno con su prueba y su commit; el motor no se da por hecho hasta que el servidor HTTP falso
   sirve un HLS completo.
3. **T184/T185** van juntas en la práctica: la página de Descargas y el reproductor local comparten
   el estado. Si el corte de cinco archivos aprieta, primero la API y la página, después el
   reproductor.
4. **T186** necesita el anfitrión Tauri; el selector de carpeta es del anfitrión, no del servidor.
   En el navegador la carpeta es un ajuste de texto y el botón «abrir carpeta» no existe.
5. **T187** cierra la fase: borrar, límites y el informe de lo que no se pudo medir.

## Lo que no se hace en esta fase

- Manga (2B), watch party (3) y DRM.
- Precarga silenciosa: toda descarga la pide el usuario.
- Compartir archivos o abrir la red más allá de la lista blanca del proxy.

## Criterio de cierre de la fase

El de la spec: un episodio descargado se ve sin conexión y se abre fuera de la aplicación cuando es
MP4; pausar, reanudar, cancelar y borrar no dejan huérfanos; un manifiesto o un nombre hostil no
salen de donde deben; el disco lleno se dice con el número que falta. Todo con `typecheck`, `lint`,
`bun test`, `e2e` y `coverage:gate` en verde.
