#!/usr/bin/env bun
/**
 * Un agente por worktree.
 *
 * Varios agentes sobre el mismo directorio comparten el índice de git y los
 * mismos archivos: dos commits a la vez se llevan el stage del otro y
 * `tasks/todo.md` pierde la mitad de las ediciones. El worktree da a cada
 * agente su árbol, su índice y su base de datos.
 *
 * El reclamo del task va en un ref porque los refs viven en el directorio común
 * del repositorio —los ven todos los worktrees— y `git update-ref` con valor
 * antiguo vacío crea el ref sólo si no existe: es un lock atómico sin remoto ni
 * proceso servidor.
 *
 * Uso:
 *   bun run scripts/agente.ts abrir T60
 *   bun run scripts/agente.ts cerrar T60
 *   bun run scripts/agente.ts abandonar T60 --si
 *   bun run scripts/agente.ts estado
 *   bun run scripts/agente.ts limpiar --si
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const RAIZ = resolve(dirname(Bun.fileURLToPath(import.meta.url)), '..')
const RAMA_BASE = 'main'

/** 9000 en adelante: por debajo viven el 7717 del CLI, 5173 de Vite y 7802 de e2e. */
const PUERTO_BASE = 9000

/** El id tal y como se usa en `tasks/todo.md`: `T60`, `T6a`, `T26b`. */
export function idDeTask(entrada: string): string {
  const coincidencia = /^T(\d+)([a-z]?)$/i.exec(entrada.trim())

  if (!coincidencia) {
    throw new Error(`id de task inválido: «${entrada}». Se espera T60, T6a, T26b…`)
  }

  return `T${coincidencia[1] ?? ''}${(coincidencia[2] ?? '').toLowerCase()}`
}

export function nombreRama(id: string): string {
  return `tarea/${idDeTask(id)}`
}

/**
 * Dentro del repo y en `.gitignore`: el sandbox de escritura de un agente se limita al
 * workspace, así que un directorio hermano no se puede crear. Anidado no estorba porque
 * `bun test` y biome respetan `.gitignore` (medido: la sonda de `.worktrees/` no se ejecuta).
 */
export function rutaWorktree(raiz: string, id: string): string {
  return `${raiz.replace(/\/+$/, '')}/.worktrees/${idDeTask(id)}`
}

export function nombreClaim(id: string): string {
  return `refs/claims/${idDeTask(id)}`
}

/**
 * Puerto distinto por task, derivado del id para que no dependa de un registro
 * compartido. El sufijo suma uno: `T6` y `T6a` son tasks distintas.
 */
export function puertoDe(id: string): number {
  const limpio = idDeTask(id)
  const ultimo = limpio.slice(limpio.length - 1)
  const sufijo = /[a-z]/.test(ultimo) ? ultimo.charCodeAt(0) - 96 : 0

  return PUERTO_BASE + Number.parseInt(limpio.slice(1), 10) + sufijo
}

interface Salida {
  readonly code: number
  readonly out: string
  readonly err: string
}

/**
 * Ejecuta git y devuelve su salida, **sin tuberías**.
 *
 * `Bun.spawnSync` con `stdout: 'pipe'` muere con `EPERM` en el sandbox de escritura de este
 * entorno: no deja crear la tubería con la que se captura al hijo. Redirigir a archivos dentro de
 * `.tmp/` y leerlos después captura lo mismo sin tubería, y también funciona fuera del sandbox.
 */
function git(args: readonly string[], cwd: string): Salida {
  // `.tmp/` puede no existir en un clon recién hecho, y `mkdtempSync` no crea el padre.
  mkdirSync(join(RAIZ, '.tmp'), { recursive: true })
  const temporal = mkdtempSync(join(RAIZ, '.tmp', 'agente-git-'))
  const rutaOut = join(temporal, 'out')
  const rutaErr = join(temporal, 'err')
  const out = openSync(rutaOut, 'w')
  const err = openSync(rutaErr, 'w')

  try {
    const proceso = Bun.spawnSync(['git', ...args], { cwd, stdout: out, stderr: err })

    return {
      code: proceso.exitCode,
      out: readFileSync(rutaOut, 'utf8').trim(),
      err: readFileSync(rutaErr, 'utf8').trim(),
    }
  } finally {
    closeSync(out)
    closeSync(err)
    rmSync(temporal, { recursive: true, force: true })
  }
}

function exigir(salida: Salida, contexto: string): string {
  if (salida.code !== 0) {
    throw new Error(`${contexto}: ${salida.err || salida.out || `código ${salida.code}`}`)
  }

  return salida.out
}

export function abrir(id: string, raiz: string = RAIZ): string {
  const limpio = idDeTask(id)
  const ruta = rutaWorktree(raiz, limpio)
  const rama = nombreRama(limpio)
  const claim = nombreClaim(limpio)
  const base = exigir(git(['rev-parse', RAMA_BASE], raiz), `no hay rama ${RAMA_BASE}`)

  const reclamo = git(['update-ref', claim, base, ''], raiz)
  if (reclamo.code !== 0) {
    throw new Error(`${limpio} ya está reclamado. Quién lo tiene: bun run scripts/agente.ts estado`)
  }

  const alta = git(['worktree', 'add', ruta, '-b', rama, RAMA_BASE], raiz)
  if (alta.code !== 0) {
    // Un alta fallida deja la rama creada a medias: sin borrarla, el reintento muere
    // con «una rama llamada tarea/T60 ya existe» y el reclamo queda en un limbo.
    git(['branch', '-D', rama], raiz)
    git(['update-ref', '-d', claim], raiz)
    throw new Error(`no se pudo crear el worktree: ${alta.err || alta.out}`)
  }

  const puerto = puertoDe(limpio)
  console.log(
    [
      `${limpio} abierto.`,
      `  Worktree  ${ruta}`,
      `  Rama      ${rama}`,
      `  Reclamo   ${claim}`,
      `  Puerto    ${puerto}`,
      `  Datos     NN_ANIME_DATA_DIR=${ruta}/.data/`,
      '',
      'Siguiente:',
      `  cd ${ruta} && bun install`,
      `  bun run start -- --port ${puerto}`,
      `  bun run scripts/agente.ts cerrar ${limpio}     # desde la raíz, al terminar`,
    ].join('\n'),
  )

  return ruta
}

export function cerrar(id: string, raiz: string = RAIZ): void {
  const limpio = idDeTask(id)
  const ruta = rutaWorktree(raiz, limpio)
  const rama = nombreRama(limpio)
  const claim = nombreClaim(limpio)

  if (!existsSync(ruta)) {
    throw new Error(`no hay worktree en ${ruta}`)
  }

  const sucio = exigir(git(['status', '--porcelain'], ruta), `no se pudo leer ${ruta}`)
  if (sucio !== '') {
    throw new Error(`quedan cambios sin commitear en ${limpio}:\n${sucio}`)
  }

  exigir(git(['rebase', RAMA_BASE], ruta), `${limpio} no se pudo rebasar sobre ${RAMA_BASE}`)

  // El merge se hace desde la raíz, que es el árbol de integración: si ahí hay
  // trabajo a medias que el merge tocaría, git lo rechaza y no se pierde nada.
  const sucioRaiz = git(['status', '--porcelain'], raiz).out
  if (sucioRaiz !== '') {
    console.log(
      `Aviso: el árbol de integración viene sucio; el merge puede rechazarse.\n${sucioRaiz}`,
    )
  }

  exigir(
    git(['merge', '--no-ff', '-m', `merge: integrar ${limpio} (${rama})`, rama], raiz),
    `${limpio} no se pudo integrar en ${RAMA_BASE}`,
  )

  exigir(git(['worktree', 'remove', ruta], raiz), `no se pudo borrar el worktree ${ruta}`)
  git(['branch', '-d', rama], raiz)
  git(['update-ref', '-d', claim], raiz)

  console.log(`${limpio} integrado en ${RAMA_BASE}; worktree, rama y reclamo borrados.`)
}

/** Destructivo: tira los commits de la rama sin integrarlos. Exige `--si`. */
export function abandonar(id: string, confirmado: boolean, raiz: string = RAIZ): void {
  const limpio = idDeTask(id)

  if (!confirmado) {
    throw new Error(
      `abandonar ${limpio} borra su worktree y su rama, con lo que no se haya integrado. Repite con --si.`,
    )
  }

  const ruta = rutaWorktree(raiz, limpio)

  git(['worktree', 'remove', '--force', ruta], raiz)
  git(['branch', '-D', nombreRama(limpio)], raiz)
  git(['update-ref', '-d', nombreClaim(limpio)], raiz)

  console.log(`${limpio} abandonado. Reclamo libre.`)
}

export function estado(raiz: string = RAIZ): void {
  const reclamos = git(['for-each-ref', '--format=%(refname)', 'refs/claims/'], raiz)
  const lineas = reclamos.out === '' ? [] : reclamos.out.split('\n')
  const arboles = git(['worktree', 'list', '--porcelain'], raiz).out

  console.log(
    `Reclamos:\n${lineas.length > 0 ? lineas.map((l) => `  ${l}`).join('\n') : '  (ninguno)'}`,
  )
  console.log(`Worktrees:\n${arboles}`)
  console.log(`Restos: ${restosSinRegistrar(raiz).length} directorios sin registrar en .worktrees/`)
}

/* ------------------------------------------------------------------ *
 * Podar los worktrees restos
 * ------------------------------------------------------------------ */

/**
 * Las carpetas cuyo contenido se regenera: ni fuente ni trabajo commiteado. Lo que hay
 * dentro no se pierde al borrar el directorio que las contiene, así que un resto que sólo
 * tiene esto se puede tirar sin mirar nada más.
 */
const CARPETAS_REGENERABLES = new Set([
  'node_modules',
  '.tmp',
  '.data',
  'dist',
  'build',
  'coverage',
  '.vite',
  '.bun-cache',
  'release',
])

/** Cuántos archivos se miran antes de rendirse: un resto con más, no se toca. */
const MAXIMO_ARCHIVOS = 500

/** Cuántos cambios se nombran en el informe: los que hay, no una lista sin fin. */
const MAXIMO_CAMBIOS = 20

/** Lo que se ha averiguado de un directorio suelto de `.worktrees/`. */
export interface Juicio {
  readonly nombre: string
  readonly ruta: string
  /** La rama que se le supone: la de sus metadatos de git, o la que su nombre indica. */
  readonly rama: string | undefined
  /** La rama sigue en pie en git: integración comprobada y rama todavía viva. */
  readonly ramaEnPie: boolean
  readonly borrar: boolean
  readonly motivo: string
  /** Los cambios sin commitear que lo salvan, en palabras de git. */
  readonly cambios: readonly string[]
}

export interface Resumen {
  readonly juicios: readonly Juicio[]
  readonly borrados: readonly string[]
  readonly conservados: readonly Juicio[]
}

/**
 * La ruta tal y como la comparan git y este script: con barras hacia delante y sin
 * distinguir mayúsculas en Windows, donde `C:\Repo` y `c:/repo` son el mismo directorio.
 */
function normalizar(ruta: string): string {
  const limpia = ruta.replace(/\\/g, '/').replace(/\/+$/, '')

  return process.platform === 'win32' ? limpia.toLowerCase() : limpia
}

/**
 * El repositorio principal: el directorio donde vive `.worktrees/`.
 *
 * El script puede correr desde un worktree, y entonces `.worktrees/` no está debajo de
 * él: los restos se acumulan en el repositorio principal, que es el que los tiene que
 * podar. `git rev-parse --git-common-dir` da la raíz común de todos los worktrees.
 */
function raizPrincipal(raiz: string): string {
  const comun = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], raiz)

  if (comun.code !== 0 || comun.out === '') {
    return raiz
  }

  return dirname(comun.out)
}

/** Los worktrees que git tiene registrados: ruta normalizada → rama. */
function worktreesRegistrados(raiz: string): Map<string, string | undefined> {
  const registrados = new Map<string, string | undefined>()
  const lineas = git(['worktree', 'list', '--porcelain'], raiz).out.split('\n')
  let actual: string | undefined

  for (const linea of lineas) {
    if (linea.startsWith('worktree ')) {
      actual = normalizar(linea.slice('worktree '.length))
      registrados.set(actual, undefined)
    } else if (linea.startsWith('branch ') && actual !== undefined) {
      registrados.set(actual, linea.slice('branch '.length).replace('refs/heads/', ''))
    }
  }

  return registrados
}

/** Los directorios de `.worktrees/` que git no tiene registrados: los restos. */
function restosSinRegistrar(raiz: string): string[] {
  const raizRepo = raizPrincipal(raiz)
  const registradas = worktreesRegistrados(raizRepo)

  return listarDirectorios(join(raizRepo, '.worktrees')).filter(
    (ruta) => !registradas.has(normalizar(ruta)),
  )
}

/** Los subdirectorios de un directorio, saltando los ocultos. */
function listarDirectorios(directorio: string): string[] {
  if (!existsSync(directorio)) {
    return []
  }

  return readdirSync(directorio, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory() && !entrada.name.startsWith('.'))
    .map((entrada) => join(directorio, entrada.name))
}

/** La rama a la que apunta un `HEAD` de git: `ref: refs/heads/x` → `x`. */
function ramaDelHead(rutaHead: string): string | undefined {
  try {
    const contenido = readFileSync(rutaHead, 'utf8')

    return /^ref:\s*refs\/heads\/(.+)$/m.exec(contenido)?.[1]?.trim()
  } catch {
    return undefined
  }
}

/** La rama de un resto, por sus metadatos de git si los conserva. */
function ramaDeMetadatos(ruta: string): string | undefined {
  const metadatos = join(ruta, '.git')
  const info = statSync(metadatos, { throwIfNoEntry: false })

  if (info?.isDirectory()) {
    return ramaDelHead(join(metadatos, 'HEAD'))
  }

  if (info?.isFile()) {
    const destino = /^gitdir:\s*(.+)$/m.exec(readFileSync(metadatos, 'utf8'))?.[1]?.trim()
    if (destino !== undefined) {
      const gitdir = isAbsolute(destino) ? destino : resolve(ruta, destino)

      return ramaDelHead(join(gitdir, 'HEAD'))
    }
  }

  return undefined
}

/**
 * La rama que se le supone a un resto: la de sus metadatos si los tiene, si no la que su
 * nombre indica. El directorio de un worktree se llama como el task, y el task da nombre
 * a la rama; sin otra pista, el nombre es lo único que se sabe de él.
 */
function ramaDeResto(ruta: string, nombre: string, raiz: string): string | undefined {
  const deMetadatos = ramaDeMetadatos(ruta)
  if (deMetadatos !== undefined) {
    return deMetadatos
  }

  if (/^T\d+[a-z]?$/i.test(nombre)) {
    return nombreRama(nombre)
  }

  return ramaExiste(nombre, raiz) ? nombre : undefined
}

/** ¿Existe esa rama? */
function ramaExiste(rama: string, raiz: string): boolean {
  return git(['show-ref', '--verify', '--quiet', `refs/heads/${rama}`], raiz).code === 0
}

/**
 * ¿Está la rama dentro de la base? Un commit que no es ancestro de `main` es trabajo que
 * nadie ha integrado: esa rama no se toca.
 */
function estaIntegrada(rama: string, raiz: string): boolean {
  return git(['merge-base', '--is-ancestor', rama, RAMA_BASE], raiz).code === 0
}

/** El directorio `.git` del repositorio: `hash-object` lo necesita para aplicar los filtros. */
function directorioGit(raiz: string): string | undefined {
  const salida = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], raiz)

  return salida.code === 0 && salida.out !== '' ? salida.out : undefined
}

/**
 * Los archivos del resto, en rutas relativas con `/`: lo que no se regenera y no es
 * metadato de git. Un resto con más de `MAXIMO_ARCHIVOS` no se juzga: no se sabe qué
 * guarda y no se toca.
 */
function archivosDelResto(ruta: string): { archivos: string[]; demasiados: boolean } {
  const archivos: string[] = []
  let demasiados = false

  const recorrer = (directorio: string, prefijo: string): void => {
    if (demasiados) {
      return
    }

    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      if (entrada.name === '.git') {
        continue
      }

      const relativa = prefijo === '' ? entrada.name : `${prefijo}/${entrada.name}`

      if (entrada.isDirectory()) {
        if (!CARPETAS_REGENERABLES.has(entrada.name)) {
          recorrer(join(directorio, entrada.name), relativa)
        }
      } else {
        archivos.push(relativa)
        if (archivos.length > MAXIMO_ARCHIVOS) {
          demasiados = true
          return
        }
      }
    }
  }

  recorrer(ruta, '')

  return { archivos, demasiados }
}

/** El hash del contenido de cada archivo, para compararlo con el del árbol de la rama. */
function hashesDe(
  directorio: string,
  archivos: readonly string[],
  gitDir: string | undefined,
): Map<string, string> {
  const hashes = new Map<string, string>()
  const LOTE = 100
  // Un resto puede tener su `.git` apuntando a un directorio que ya no existe: sin
  // `--git-dir` git no llega a ningún repositorio y no puede ni leer el archivo.
  const prefijo = gitDir === undefined ? [] : ['--git-dir', gitDir]

  for (let inicio = 0; inicio < archivos.length; inicio += LOTE) {
    const lote = archivos.slice(inicio, inicio + LOTE)
    const salida = git([...prefijo, 'hash-object', '--', ...lote], directorio)
    const lineas = salida.out === '' ? [] : salida.out.split('\n')

    lote.forEach((archivo, indice) => {
      const hash = lineas[indice]
      if (hash !== undefined) {
        hashes.set(archivo, hash)
      }
    })
  }

  return hashes
}

/** El árbol de una rama: ruta → hash del blob. */
function arbolDe(raiz: string, ref: string): Map<string, string> {
  const arbol = new Map<string, string>()

  for (const entrada of git(['ls-tree', '-r', '-z', ref], raiz).out.split('\0')) {
    if (entrada === '') {
      continue
    }

    const [meta, ruta] = entrada.split('\t')
    const hash = meta?.split(' ')[2]
    if (ruta !== undefined && hash !== undefined) {
      arbol.set(ruta, hash)
    }
  }

  return arbol
}

/** Lo que el resto tiene y su rama no: trabajo sin commitear. */
function comparar(
  archivos: readonly string[],
  hashes: ReadonlyMap<string, string>,
  arbol: ReadonlyMap<string, string>,
): string[] {
  const cambios: string[] = []

  for (const archivo of archivos) {
    const hash = hashes.get(archivo)
    const enArbol = arbol.get(archivo)

    if (hash === undefined) {
      cambios.push(`sin comprobar: ${archivo}`)
    } else if (enArbol === undefined) {
      cambios.push(`sin versionar: ${archivo}`)
    } else if (enArbol !== hash) {
      cambios.push(`modificado: ${archivo}`)
    }
  }

  return cambios
}

/**
 * Qué se hace con un directorio suelto de `.worktrees/`.
 *
 * Se borra sólo cuando no hay nada que perder: la rama ya está integrada en la base y
 * dentro del directorio no hay ni un archivo que la rama no tenga, con el mismo
 * contenido. Con la rama sin integrar o con cambios sin commitear, se conserva y se dice
 * qué hay.
 */
export function juzgar(ruta: string, raiz: string): Juicio {
  const nombre = basename(ruta)
  const rama = ramaDeResto(ruta, nombre, raiz)
  const viva = rama !== undefined && ramaExiste(rama, raiz)
  const { archivos, demasiados } = archivosDelResto(ruta)

  if (demasiados) {
    return {
      nombre,
      ruta,
      rama,
      ramaEnPie: viva,
      borrar: false,
      motivo: `más de ${MAXIMO_ARCHIVOS} archivos: no se sabe qué guarda`,
      cambios: [],
    }
  }

  if (viva && rama !== undefined && !estaIntegrada(rama, raiz)) {
    return {
      nombre,
      ruta,
      rama,
      ramaEnPie: true,
      borrar: false,
      motivo: `la rama ${rama} no está integrada en ${RAMA_BASE}`,
      cambios: [],
    }
  }

  // El árbol contra el que se compara es el de la rama si sigue en pie; si no, el de la
  // base: sin rama no hay otro árbol contra el que mirar, y la base es lo prudente.
  const referencia = viva && rama !== undefined ? rama : RAMA_BASE
  const cambios = comparar(
    archivos,
    hashesDe(ruta, archivos, directorioGit(raiz)),
    arbolDe(raiz, referencia),
  ).slice(0, MAXIMO_CAMBIOS)

  if (cambios.length > 0) {
    return {
      nombre,
      ruta,
      rama,
      ramaEnPie: viva,
      borrar: false,
      motivo: viva
        ? 'tiene cambios sin commitear'
        : `no hay rama que comprobar sus archivos contra ${RAMA_BASE}`,
      cambios,
    }
  }

  return {
    nombre,
    ruta,
    rama,
    ramaEnPie: viva,
    borrar: true,
    motivo: viva
      ? `la rama ${rama} ya está integrada en ${RAMA_BASE}`
      : `sin rama propia: dentro no queda nada que no esté en ${RAMA_BASE}`,
    cambios: [],
  }
}

/** El informe: qué se va a borrar y qué se va a dejar, con el porqué. */
function informe(juicios: readonly Juicio[], registradas: number): void {
  const ancho = Math.max(...juicios.map((juicio) => juicio.nombre.length), 0)

  console.log(
    `Restos en .worktrees/: ${juicios.length} directorios que git no tiene registrados (${registradas} worktrees registrados, que no se tocan).`,
  )
  console.log('')

  for (const juicio of juicios) {
    const nombre = juicio.nombre.padEnd(ancho)
    console.log(`  ${nombre}  ${juicio.motivo}  → ${juicio.borrar ? 'se borra' : 'se conserva'}`)

    for (const cambio of juicio.cambios) {
      console.log(`      ${cambio}`)
    }
  }
}

/**
 * Poda los worktrees restos: los directorios de `.worktrees/` que git no tiene
 * registrados y cuya rama ya está integrada en la base.
 *
 * Sin `--si` no borra nada: dice qué borraría. Con `--si` borra lo que puede y deja
 * intacto lo que tiene algo dentro: una rama sin integrar, cambios sin commitear o
 * archivos que no se pueden comprobar.
 */
export function limpiar(confirmado: boolean, raiz: string = RAIZ): Resumen {
  const raizRepo = raizPrincipal(raiz)
  const registradas = worktreesRegistrados(raizRepo)
  const candidatos = listarDirectorios(join(raizRepo, '.worktrees')).filter(
    (ruta) => !registradas.has(normalizar(ruta)),
  )
  const juicios = candidatos.map((ruta) => juzgar(ruta, raizRepo))
  const paraBorrar = juicios.filter((juicio) => juicio.borrar)
  const conservados = juicios.filter((juicio) => !juicio.borrar)

  if (juicios.length === 0) {
    console.log('No hay worktrees restos: .worktrees/ sólo tiene los que git tiene registrados.')
    return { juicios, borrados: [], conservados }
  }

  informe(juicios, registradas.size)
  console.log('')
  console.log(`Plan: borrar ${paraBorrar.length}, conservar ${conservados.length}.`)

  if (!confirmado) {
    console.log('Nada se ha tocado: repite con --si para borrarlos.')
    return { juicios, borrados: [], conservados }
  }

  const borrados: string[] = []
  const ramasBorradas: string[] = []
  for (const juicio of paraBorrar) {
    rmSync(juicio.ruta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    borrados.push(juicio.nombre)
    if (juicio.rama !== undefined) {
      ramasBorradas.push(juicio.rama)
    }
  }

  console.log(
    borrados.length > 0
      ? `Borrados ${borrados.length}: ${borrados.join(', ')}`
      : 'No se ha borrado nada.',
  )

  const ramasEnPie = [...new Set(ramasBorradas)]
  if (ramasEnPie.length > 0) {
    console.log(
      `Ramas ya integradas que siguen en pie: ${ramasEnPie.join(', ')}. Bórralas con \`git branch -d\` si sobran.`,
    )
  }

  return { juicios, borrados, conservados }
}

function requerido(valor: string | undefined, uso: string): string {
  if (valor === undefined || valor === '') {
    throw new Error(`falta el id del task. Uso: ${uso}`)
  }

  return valor
}

const USO = [
  'Uso: bun run scripts/agente.ts <orden> <T60>',
  '',
  '  abrir <id>              crea worktree, rama y reclamo',
  '  cerrar <id>             rebasa, integra en main y limpia',
  '  abandonar <id> --si     tira la rama sin integrarla (destructivo)',
  '  estado                  reclamos abiertos y worktrees',
  '  limpiar                 dice qué worktrees restos hay y no toca nada',
  '  limpiar --si            borra los worktrees restos ya integrados',
].join('\n')

export function main(argv: readonly string[], raiz: string = RAIZ): number {
  const [orden, id, ...resto] = argv

  try {
    switch (orden) {
      case 'abrir':
        abrir(requerido(id, 'abrir <T60>'), raiz)
        return 0
      case 'cerrar':
        cerrar(requerido(id, 'cerrar <T60>'), raiz)
        return 0
      case 'abandonar':
        abandonar(requerido(id, 'abandonar <T60> --si'), resto.includes('--si'), raiz)
        return 0
      case 'estado':
        estado(raiz)
        return 0
      case 'limpiar':
        limpiar(resto.includes('--si') || id === '--si', raiz)
        return 0
      default:
        console.log(USO)
        return orden === undefined || orden === '--help' || orden === '-h' ? 0 : 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (import.meta.main) {
  process.exitCode = main(Bun.argv.slice(2))
}
