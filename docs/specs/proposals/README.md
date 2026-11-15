# Propuestas de especificación

`docs/specs/SPEC-*.md` es el contrato de un módulo: cambiarlo es un evento de versión mayor y
requiere aprobación. Dos agentes editando el mismo spec a la vez producen un contrato que nadie
aprobó, y el que lo aprueba no lee el diff.

Mientras un task toca un spec, ese spec queda **congelado** y sólo lo edita su dueño.

Los demás agentes proponen aquí: `SPEC-catalog-store.T60.md`, con el cambio exacto, el motivo y
la alternativa descartada. El dueño integra la propuesta en el `SPEC-*`, anota la aprobación y
borra el archivo de propuesta.

## Qué hacer con un documento que dice «propuesta» y está en la carpeta canónica

La carpeta canónica guarda **contratos**, y un contrato se reconoce por el código que lo sigue, no
por lo que promete el encabezado. Cuando un documento de `docs/specs/` dice «propuesta», la
decisión se toma con una medida, no con la impresión:

| Lo que se mide | Qué se hace |
|---|---|
| El código sigue el documento: las rutas, los símbolos y las reglas que promete existen | **Se queda en la carpeta canónica.** Es el contrato: su encabezado se corrige para decir lo que es, y se anota la aprobación —o, si no la hay, lo que sigue pendiente y por qué |
| Nada de eso existe: el documento no crea módulo y nada de él está implementado | **Se mueve a `proposals/`** con `git mv`, para que el historial lo siga |

La medida se toma en el código, no en el encabezado. Un documento que promete una ruta que el
servidor no tiene, o un componente que la interfaz no tiene, es una propuesta por mucho que esté
en `docs/specs/`. Y al revés: un contrato en vigor no se degrada a propuesta porque su encabezado
no se actualizó —se corrige el encabezado.

## Cómo se llama el archivo

`SPEC-<módulo>.T<id>.md`, con el **id del task que escribió la propuesta** —`SPEC-anime-detail.T145.md`
la escribió T145—. Cuando el cambio no viene de un task, el sufijo es descriptivo:
`SPEC-anime-detail.fuentes.md`, `SPEC-anime-detail.pelicula.md`.

## Un archivo, un sitio

Un documento no vive en los dos sitios a la vez: o está en `docs/specs/` y es un contrato, o está en
`proposals/` y es una propuesta. Integrar una propuesta borra su archivo **en el mismo commit** que
la aplica.
