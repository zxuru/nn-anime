# Propuestas de especificación

`docs/specs/SPEC-*.md` es el contrato de un módulo: cambiarlo es un evento de versión mayor y
requiere aprobación. Dos agentes editando el mismo spec a la vez producen un contrato que nadie
aprobó, y el que lo aprueba no lee el diff.

Mientras un task toca un spec, ese spec queda **congelado** y sólo lo edita su dueño.

Los demás agentes proponen aquí: `SPEC-catalog-store.T60.md`, con el cambio exacto, el motivo y
la alternativa descartada. El dueño integra la propuesta en el `SPEC-*`, anota la aprobación y
borra el archivo de propuesta.
