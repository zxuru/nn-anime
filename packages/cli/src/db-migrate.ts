#!/usr/bin/env bun
/**
 * Comando `bun run db:migrate`.
 *
 * Marcador hasta T16. Se niega a salir con 0 porque no ha migrado nada: un
 * comando de base de datos que dice «todo bien» sin haber hecho nada es peor
 * que uno que falla. T16 lo sustituye por el runner real de `catalog-store`.
 */

process.stderr.write(
  'db:migrate: todavía no hay base de datos que migrar. Llega en T16 con catalog-store.\n',
)

process.exit(1)
