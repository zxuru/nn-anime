import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { messages as es } from '../../i18n/es'
import {
  ANCLAS,
  AVISOS,
  avisosPendientes,
  CLAVE_GUIA,
  conBienvenida,
  type EstadoGuia,
  estadoInicial,
  guardarEstado,
  leerEstado,
  normalizarEstado,
  PASOS,
  pasosPara,
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
    if (relativa.startsWith('features/guia/')) continue
    partes.push(await Bun.file(`${ROOT}${relativa}`).text())
  }

  return partes.join('\n')
}

describe('el estado de la guía', () => {
  test('una instalación nueva deja la bienvenida pendiente y conoce los avisos de hoy', () => {
    const estado = estadoInicial()

    expect(estado.bienvenida).toBe(false)
    expect(estado.vistos).toEqual(AVISOS.map((aviso) => aviso.id))
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
    const pendiente: EstadoGuia = { bienvenida: false, vistos: [] }
    expect(avisosPendientes(pendiente, 'home')).toContain(aviso)

    const estado = sinAviso(pendiente, aviso.id)

    expect(estado.vistos).toContain(aviso.id)
    expect(avisosPendientes(estado, 'home')).toEqual([])
  })

  test('marcar la bienvenida no toca lo visto', () => {
    const inicial = estadoInicial()
    const visto = conBienvenida(inicial)

    expect(visto.bienvenida).toBe(true)
    expect(visto.vistos).toEqual(inicial.vistos)
  })

  test('restablecer los avisos los devuelve a la lista sin tocar la bienvenida', () => {
    const aviso = AVISOS[0]
    if (aviso === undefined) throw new Error('la guía no declara avisos')

    const estado = conBienvenida(sinAviso({ bienvenida: false, vistos: [] }, aviso.id))

    expect(avisosPendientes(estado, 'home')).toEqual([])

    const restablecido = sinAvisos(estado)

    expect(restablecido.bienvenida).toBe(true)
    expect(avisosPendientes(restablecido, 'home')).toEqual([aviso])
  })

  test('un estado corrupto o de otra versión vuelve al inicial', () => {
    expect(normalizarEstado('nada')).toEqual(estadoInicial())
    expect(normalizarEstado({ v: 0, bienvenida: true, vistos: ['x'] })).toEqual(estadoInicial())
    expect(normalizarEstado(null)).toEqual(estadoInicial())
  })

  test('un estado a medias se queda con lo que se puede leer', () => {
    const estado = normalizarEstado({
      v: VERSION_GUIA,
      bienvenida: 'sí',
      vistos: [1, 'x', 'x'],
    })

    expect(estado).toEqual({ bienvenida: false, vistos: ['x'] })
  })

  test('guardar y leer el estado da la vuelta completa', () => {
    const deposito = almacenFalso()
    guardarEstado(deposito, conBienvenida(estadoInicial()))

    expect(leerEstado(deposito).bienvenida).toBe(true)
  })

  test('sin almacén o con basura se lee el estado inicial', () => {
    expect(leerEstado(undefined).bienvenida).toBe(false)
    expect(leerEstado(almacenFalso('{roto')).bienvenida).toBe(false)
  })
})

describe('los pasos de la guía', () => {
  test('cada paso apunta a un ancla declarada', () => {
    const anclas = new Set<string>(Object.values(ANCLAS))

    for (const paso of PASOS) {
      if (paso.ancla === undefined) continue
      expect(anclas.has(paso.ancla), `el paso ${paso.id} usa un ancla desconocida`).toBe(true)
    }
  })

  test('los identificadores de pasos y avisos no se repiten', () => {
    const ids = [...PASOS.map((paso) => paso.id), ...AVISOS.map((aviso) => aviso.id)]

    expect(new Set(ids).size).toBe(ids.length)
  })

  test('el recorrido se recorta a lo que la pantalla puede enseñar', () => {
    expect(pasosPara('home').map((paso) => paso.id)).toContain('destacado')
    expect(pasosPara('settings').map((paso) => paso.id)).not.toContain('destacado')
    expect(pasosPara('settings').map((paso) => paso.id)).toContain('cabecera')
  })

  test('el selector de ancla es el que busca driver.js', () => {
    expect(selectorDeAncla('cabecera')).toBe('[data-tour="cabecera"]')
  })
})

describe('los textos de la guía', () => {
  test('todas las claves de pasos y avisos existen en el catálogo', () => {
    for (const paso of PASOS) {
      expect(es[paso.titulo] ?? '', `falta ${paso.titulo}`).not.toBe('')
      expect(es[paso.cuerpo] ?? '', `falta ${paso.cuerpo}`).not.toBe('')
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
