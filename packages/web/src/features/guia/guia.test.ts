import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { messages as es } from '../../i18n/es'
import {
  ANCLAS,
  AVISOS,
  avisosPendientes,
  CLAVE_GUIA,
  conRecorrido,
  conTutorialesDeshabilitados,
  type EstadoGuia,
  estadoInicial,
  guardarEstado,
  leerEstado,
  normalizarEstado,
  omitirTodos,
  RECORRIDOS,
  recorridoDeRuta,
  recorridoPendiente,
  reiniciarRecorridos,
  selectorDeAncla,
  sinAviso,
  sinAvisos,
  VERSION_GUIA,
} from './guia'

/**
 * La guía se prueba sin navegador: los datos, el estado de lo visto y los
 * enlaces entre el catálogo, las anclas y el marcado. Lo que driver.js pinta se
 * mira en el navegador, no aquí.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function almacenFalso(inicial?: string): Pick<Storage, 'getItem' | 'setItem'> {
  const datos = new Map<string, string>()
  if (inicial !== undefined) datos.set(CLAVE_GUIA, inicial)

  return {
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => {
      datos.set(clave, valor)
    },
  }
}

/** El marcado de los componentes, menos el de la propia guía. */
async function marcado(): Promise<string> {
  const glob = new Bun.Glob('**/*.tsx')
  const partes: string[] = []

  for await (const relativa of glob.scan({ cwd: ROOT })) {
    // `BotonGuia` no pinta anclas: sólo abre el recorrido. El resto de la
    // carpeta son `.ts` y el glob no los mira.
    if (relativa.replaceAll('\\', '/') === 'features/guia/BotonGuia.tsx') continue
    partes.push(await Bun.file(`${ROOT}${relativa}`).text())
  }

  /*
   * La navegación no es un `.tsx`: sus anclas llegan al marcado por `data-tour`
   * desde `nav.ts`, la lista que comparten la cabecera y la barra del móvil. Sin
   * este archivo, las anclas de los cinco destinos se leerían como perdidas.
   */
  partes.push(await Bun.file(`${ROOT}nav.ts`).text())

  return partes.join('\n')
}

describe('el estado de la guía', () => {
  test('una instalación nueva no vio ningún recorrido y conoce los avisos de hoy', () => {
    const estado = estadoInicial()

    expect(estado.recorridos).toEqual([])
    expect(estado.vistos).toEqual(AVISOS.map((aviso) => aviso.id))
    expect(estado.tutorialsDisabled).toBe(false)
  })

  test('el recorrido de la pantalla queda pendiente hasta que se ve', () => {
    const estado = estadoInicial()

    expect(recorridoPendiente(estado, 'home')?.id).toBe('inicio')
    expect(recorridoPendiente(conRecorrido(estado, 'inicio'), 'home')).toBeUndefined()
    expect(recorridoPendiente(conRecorrido(estado, 'inicio'), 'search')?.id).toBe('buscar')
  })

  test('una pantalla sin recorrido no tiene pendiente', () => {
    expect(recorridoPendiente(estadoInicial(), 'library-player')).toBeUndefined()
    expect(recorridoPendiente(estadoInicial(), 'not-found')).toBeUndefined()
  })

  test('marcar un recorrido no toca lo visto y repetirlo no cambia nada', () => {
    const inicial = estadoInicial()
    const visto = conRecorrido(inicial, 'inicio')

    expect(visto.recorridos).toEqual(['inicio'])
    expect(visto.vistos).toEqual(inicial.vistos)
    expect(conRecorrido(visto, 'inicio')).toBe(visto)
  })

  test('la biblioteca cubre la dirección vieja de descargas', () => {
    expect(recorridoDeRuta('library')?.id).toBe('biblioteca')
    expect(recorridoDeRuta('downloads')?.id).toBe('biblioteca')
  })

  test('un aviso publicado después de instalar queda pendiente', () => {
    const nuevo = {
      id: 'nuevo-2026-11',
      ancla: ANCLAS.tipo,
      titulo: 'x',
      cuerpo: 'y',
    }

    expect(avisosPendientes(estadoInicial(), 'home', [nuevo])).toEqual([nuevo])
  })

  test('un aviso de otra pantalla no sale en esta', () => {
    const soloHome = {
      id: 'solo-home',
      ancla: ANCLAS.destacado,
      titulo: 'x',
      cuerpo: 'y',
      rutas: ['home'] as const,
    }

    expect(avisosPendientes(estadoInicial(), 'search', [soloHome])).toEqual([])
    expect(avisosPendientes(estadoInicial(), 'home', [soloHome])).toEqual([soloHome])
  })

  test('descartar un aviso lo apunta y deja de estar pendiente', () => {
    const aviso = AVISOS[0]
    if (aviso === undefined) throw new Error('la guía no declara avisos')

    // Una instalación de antes del aviso: no está en lo visto y por eso late.
    const pendiente: EstadoGuia = { recorridos: [], vistos: [], tutorialsDisabled: false }
    expect(avisosPendientes(pendiente, 'home')).toContain(aviso)

    const estado = sinAviso(pendiente, aviso.id)

    expect(estado.vistos).toContain(aviso.id)
    expect(avisosPendientes(estado, 'home')).toEqual([])
  })

  test('restablecer los avisos los devuelve a la lista sin tocar los recorridos', () => {
    const aviso = AVISOS[0]
    if (aviso === undefined) throw new Error('la guía no declara avisos')

    const estado = conRecorrido(
      sinAviso({ recorridos: [], vistos: [], tutorialsDisabled: false }, aviso.id),
      'inicio',
    )

    expect(avisosPendientes(estado, 'home')).toEqual([])

    const restablecido = sinAvisos(estado)

    expect(restablecido.recorridos).toEqual(['inicio'])
    expect(avisosPendientes(restablecido, 'home')).toEqual([aviso])
  })

  test('un estado corrupto o de otra versión vuelve al inicial', () => {
    expect(normalizarEstado('nada')).toEqual(estadoInicial())
    expect(normalizarEstado({ v: 0, recorridos: ['inicio'], vistos: ['x'] })).toEqual(
      estadoInicial(),
    )
    expect(normalizarEstado(null)).toEqual(estadoInicial())
  })

  test('la versión 1 se migra: su bienvenida era el recorrido de Inicio', () => {
    expect(normalizarEstado({ v: 1, bienvenida: true, vistos: ['x'] })).toEqual({
      recorridos: ['inicio'],
      vistos: ['x'],
      tutorialsDisabled: false,
    })
    expect(normalizarEstado({ v: 1, bienvenida: false, vistos: [] })).toEqual({
      recorridos: [],
      vistos: [],
      tutorialsDisabled: false,
    })
  })

  /*
   * Las migraciones tienen que conservar lo ya visto: actualizar la aplicación
   * no puede ser el motivo de que vuelvan a salir seis tutoriales. Los dos
   * estados viejos no tenían el interruptor global, así que se migran encendido
   * —sin tutoriales apagados— y conservan sus recorridos.
   */
  test('la versión 1 llega a la 3 sin perder lo visto, encendida', () => {
    expect(VERSION_GUIA).toBe(3)
    expect(normalizarEstado({ v: 1, bienvenida: true, vistos: ['aviso'] })).toEqual({
      recorridos: ['inicio'],
      vistos: ['aviso'],
      tutorialsDisabled: false,
    })
  })

  test('la versión 2 llega a la 3 sin perder lo visto, encendida', () => {
    expect(normalizarEstado({ v: 2, recorridos: ['inicio', 'buscar'], vistos: ['aviso'] })).toEqual(
      {
        recorridos: ['inicio', 'buscar'],
        vistos: ['aviso'],
        tutorialsDisabled: false,
      },
    )
  })

  test('un estado de la versión 3 recuerda el interruptor y, sin el campo, está encendido', () => {
    expect(
      normalizarEstado({ v: 3, recorridos: ['inicio'], vistos: [], tutorialsDisabled: true })
        .tutorialsDisabled,
    ).toBe(true)
    // Un v3 a medias —o el que siembra el arnés del e2e— no apaga nada: apagar
    // los tutoriales es una decisión explícita, no el valor por defecto.
    expect(normalizarEstado({ v: 3, recorridos: [], vistos: [] }).tutorialsDisabled).toBe(false)
  })

  test('un estado a medias se queda con lo que se puede leer', () => {
    const estado = normalizarEstado({
      v: VERSION_GUIA,
      recorridos: [1, 'inicio', 'inicio'],
      vistos: [2, 'x', 'x'],
      tutorialsDisabled: 'sí',
    })

    expect(estado).toEqual({ recorridos: ['inicio'], vistos: ['x'], tutorialsDisabled: false })
  })

  test('guardar y leer el estado da la vuelta completa', () => {
    const deposito = almacenFalso()
    guardarEstado(deposito, conRecorrido(estadoInicial(), 'inicio'))

    expect(leerEstado(deposito).recorridos).toEqual(['inicio'])
    expect(leerEstado(deposito).tutorialsDisabled).toBe(false)
  })

  test('el interruptor apagado también sobrevive a guardar y leer', () => {
    const deposito = almacenFalso()
    guardarEstado(deposito, omitirTodos(estadoInicial()))

    const leido = leerEstado(deposito)

    expect(leido.tutorialsDisabled).toBe(true)
    expect(leido.recorridos).toEqual(RECORRIDOS.map((recorrido) => recorrido.id))
  })

  /*
   * El interruptor no es una lista de ids: es una decisión sobre el futuro. Un
   * recorrido que se publique mañana no está en `recorridos` y aun así no tiene
   * que salir. Se mide ruta a ruta porque es justo lo que falla si la regla se
   * escribiera como «ignora los que no están vistos».
   */
  test('con los tutoriales apagados no queda ningún recorrido pendiente', () => {
    const apagado = conTutorialesDeshabilitados(estadoInicial(), true)

    expect(apagado.recorridos).toEqual([])
    for (const recorrido of RECORRIDOS) {
      for (const ruta of recorrido.rutas) {
        expect(
          recorridoPendiente(apagado, ruta),
          `${recorrido.id} seguía pendiente`,
        ).toBeUndefined()
      }
    }
  })

  test('con los tutoriales apagados los avisos tampoco laten', () => {
    const apagado = conTutorialesDeshabilitados(estadoInicial(), true)

    // Un aviso publicado después: lo normal sería que latiera, y no debe.
    const nuevo = {
      id: 'nuevo-2026-11',
      ancla: ANCLAS.tipo,
      titulo: 'x',
      cuerpo: 'y',
    }

    expect(avisosPendientes(apagado, 'home')).toEqual([])
    expect(avisosPendientes(apagado, 'home', [nuevo])).toEqual([])
    // Y encenderlos no resucita los ya descartados ni los recorridos vistos.
    expect(conTutorialesDeshabilitados(apagado, false)).toEqual(estadoInicial())
  })

  test('«omitir todos» da por vistos los recorridos de hoy y apaga el de mañana', () => {
    const omitido = omitirTodos(estadoInicial())

    expect(omitido.tutorialsDisabled).toBe(true)
    expect(new Set(omitido.recorridos)).toEqual(
      new Set(RECORRIDOS.map((recorrido) => recorrido.id)),
    )
    // Los avisos no son tutoriales: sus descartes no se tocan al omitir.
    expect(omitido.vistos).toEqual(estadoInicial().vistos)
  })

  test('encender el interruptor no repite los recorridos ya vistos', () => {
    // Apagar y volver a encender es un paréntesis: lo visto sigue visto. Si
    // encender limpiara `recorridos`, el paréntesis se convertiría en un reinicio
    // silencioso y el usuario vería otra vez todo lo que ya sabía.
    const visto = conRecorrido(estadoInicial(), 'inicio')
    const encendido = conTutorialesDeshabilitados(conTutorialesDeshabilitados(visto, true), false)

    expect(encendido).toEqual(visto)
    expect(recorridoPendiente(encendido, 'home')).toBeUndefined()
  })

  test('«reiniciar tutoriales» devuelve todos y respeta los avisos descartados', () => {
    const aviso = AVISOS[0]
    if (aviso === undefined) throw new Error('la guía no declara avisos')

    const apagado = omitirTodos(sinAviso(estadoInicial(), aviso.id))
    const reiniciado = reiniciarRecorridos(apagado)

    expect(reiniciado.recorridos).toEqual([])
    expect(reiniciado.tutorialsDisabled).toBe(false)
    expect(recorridoPendiente(reiniciado, 'home')?.id).toBe('inicio')
    // Los avisos son otra cosa y tienen su botón: reiniciar los tutoriales no
    // vuelve a anunciar como nuevo lo que el usuario ya había descartado.
    expect(reiniciado.vistos).toContain(aviso.id)
    expect(avisosPendientes(reiniciado, 'home')).toEqual([])
  })

  test('sin almacén o con basura se lee el estado inicial', () => {
    expect(leerEstado(undefined).recorridos).toEqual([])
    expect(leerEstado(almacenFalso('{roto')).recorridos).toEqual([])
  })
})

describe('los recorridos', () => {
  test('cada uno tiene id único, al menos una ruta y pasos', () => {
    const ids = RECORRIDOS.map((recorrido) => recorrido.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const recorrido of RECORRIDOS) {
      expect(recorrido.rutas.length, `${recorrido.id} no cubre ninguna ruta`).toBeGreaterThan(0)
      expect(recorrido.pasos.length, `${recorrido.id} no tiene pasos`).toBeGreaterThan(0)
    }
  })

  test('cada paso apunta a un ancla declarada', () => {
    const anclas = new Set<string>(Object.values(ANCLAS))

    for (const recorrido of RECORRIDOS) {
      for (const paso of recorrido.pasos) {
        if (paso.ancla === undefined) continue
        expect(
          anclas.has(paso.ancla),
          `el paso ${recorrido.id}/${paso.id} usa un ancla desconocida`,
        ).toBe(true)
      }
    }
  })

  test('los identificadores de pasos y avisos no se repiten dentro de su lista', () => {
    for (const recorrido of RECORRIDOS) {
      const ids = recorrido.pasos.map((paso) => paso.id)
      expect(new Set(ids).size, `${recorrido.id} repite un paso`).toBe(ids.length)
    }

    const avisos = AVISOS.map((aviso) => aviso.id)
    expect(new Set(avisos).size).toBe(avisos.length)
  })

  test('el selector de ancla es el que busca driver.js', () => {
    expect(selectorDeAncla('cabecera')).toBe('[data-tour="cabecera"]')
  })
})

describe('los textos de la guía', () => {
  test('todas las claves de recorridos, pasos y avisos existen en el catálogo', () => {
    for (const recorrido of RECORRIDOS) {
      expect(es[recorrido.titulo] ?? '', `falta ${recorrido.titulo}`).not.toBe('')

      for (const paso of recorrido.pasos) {
        expect(es[paso.titulo] ?? '', `falta ${paso.titulo}`).not.toBe('')
        expect(es[paso.cuerpo] ?? '', `falta ${paso.cuerpo}`).not.toBe('')
      }
    }

    for (const aviso of AVISOS) {
      expect(es[aviso.titulo] ?? '', `falta ${aviso.titulo}`).not.toBe('')
      expect(es[aviso.cuerpo] ?? '', `falta ${aviso.cuerpo}`).not.toBe('')
    }
  })
})

describe('las anclas de la guía', () => {
  test('cada ancla declarada está en el marcado', async () => {
    const fuente = await marcado()

    for (const clave of Object.keys(ANCLAS) as (keyof typeof ANCLAS)[]) {
      // El valor llega al DOM por `data-tour` o por la prop `dataTour` del
      // enlace; las dos formas nombran la constante, que es lo que se comprueba.
      expect(fuente.includes(`ANCLAS.${clave}`), `falta ANCLAS.${clave} en el marcado`).toBe(true)
    }
  })
})
