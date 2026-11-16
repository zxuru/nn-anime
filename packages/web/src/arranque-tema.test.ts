import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  type AlmacenTema,
  CLAVE_TEMA,
  guardarTemaPreferido,
  leerTemaPreferido,
} from './features/settings/tema-arranque'

/**
 * El arranque temprano del tema.
 *
 * El script que corre antes del primer pintado es un archivo clásico y no un
 * módulo —la CSP no permite el código en línea—, así que no se puede importar:
 * se lee del disco y se ejecuta con un `window` y un `document` de mentira. Lo
 * que se mide es el archivo que se sirve, no una copia de su lógica.
 *
 * Los dos sentidos importan: claro guardado sobre sistema oscuro no puede
 * pintar negro, y oscuro guardado sobre sistema claro no puede pintar crema.
 */

const SRC = fileURLToPath(new URL('./', import.meta.url))
const PAQUETE = fileURLToPath(new URL('../', import.meta.url))
const SCRIPT = `${PAQUETE}public/theme-boot.js`
const HTML = `${PAQUETE}index.html`
const TOKENS = `${SRC}styles/tokens.css`
const GANCHO = `${SRC}features/settings/useSettings.ts`

/**
 * El script, leído una vez. Se ejecuta con `new Function` en cada caso: no
 * depende de un DOM, y así lo que se mide es el archivo que se sirve y no una
 * copia de su lógica.
 */
const fuente = readFileSync(SCRIPT, 'utf8')

async function leer(ruta: string): Promise<string> {
  const archivo = Bun.file(ruta)
  if (!(await archivo.exists())) throw new Error(`no existe ${ruta}`)

  return archivo.text()
}

interface Arranque {
  readonly tema: string | undefined
  readonly colorScheme: string
  readonly themeColor: string
}

/**
 * Ejecuta el script con el almacén y el sistema que se le den.
 *
 * `romperAlmacen` simula la política que bloquea `localStorage`: el script tiene
 * que caer al sistema y no lanzar. Un `matchMedia` ausente tampoco puede dejarlo
 * sin tema.
 */
function arrancar(
  guardado: string | null,
  sistemaClaro: boolean,
  opciones: { readonly romperAlmacen?: boolean; readonly sinMatchMedia?: boolean } = {},
): Arranque {
  const atributos = new Map<string, string>()
  const raiz = {
    style: { colorScheme: '' },
    setAttribute(nombre: string, valor: string): void {
      atributos.set(nombre, valor)
    },
  }
  const meta = {
    content: '',
    setAttribute(nombre: string, valor: string): void {
      if (nombre === 'content') meta.content = valor
    },
  }
  const ventana = {
    localStorage: {
      getItem(_clave: string): string | null {
        if (opciones.romperAlmacen === true) throw new Error('bloqueado')

        return guardado
      },
    },
    ...(opciones.sinMatchMedia === true
      ? {}
      : { matchMedia: (_consulta: string) => ({ matches: sistemaClaro }) }),
  }
  const documento = {
    documentElement: raiz,
    querySelector(selector: string) {
      return selector === 'meta[name="theme-color"]' ? meta : null
    },
  }

  const ejecutar = new Function('window', 'document', `'use strict'\n${fuente}`)
  ejecutar(ventana, documento)

  return {
    tema: atributos.get('data-theme'),
    colorScheme: raiz.style.colorScheme,
    themeColor: meta.content,
  }
}

describe('el tema antes del primer pintado', () => {
  test('el script del paquete se puede leer y es el que carga el HTML', async () => {
    expect(fuente.length).toBeGreaterThan(0)

    const html = await leer(HTML)
    expect(html).toContain('<script src="/theme-boot.js"></script>')
  })

  test('claro guardado sobre un sistema oscuro pinta claro', () => {
    const salida = arrancar('light', false)

    expect(salida.tema).toBe('light')
    expect(salida.colorScheme).toBe('light')
    expect(salida.themeColor).toBe('#f2ede3')
  })

  test('oscuro guardado sobre un sistema claro pinta oscuro', () => {
    const salida = arrancar('dark', true)

    expect(salida.tema).toBe('dark')
    expect(salida.colorScheme).toBe('dark')
    expect(salida.themeColor).toBe('#08080a')
  })

  test('sin preferencia guardada manda el sistema, en los dos sentidos', () => {
    expect(arrancar(null, true).tema).toBe('light')
    expect(arrancar(null, false).tema).toBe('dark')
  })

  test('«system» guardado se resuelve con el sistema, no se aplica tal cual', () => {
    expect(arrancar('system', true)).toMatchObject({ tema: 'light', colorScheme: 'light' })
    expect(arrancar('system', false)).toMatchObject({ tema: 'dark', colorScheme: 'dark' })
  })

  test('un valor que no es un tema se ignora y manda el sistema', () => {
    expect(arrancar('arcoiris', false).tema).toBe('dark')
  })

  test('un almacén bloqueado o un navegador sin matchMedia no dejan la página sin tema', () => {
    expect(arrancar('light', false, { romperAlmacen: true }).tema).toBe('dark')
    expect(arrancar(null, false, { sinMatchMedia: true }).tema).toBe('dark')
  })

  /**
   * La clave y los colores están en dos archivos que no se pueden importar entre
   * sí. Esto es lo que impide que uno cambie y el otro se quede atrás: el script
   * nombra la clave del módulo y cada color que pinta existe en los tokens.
   */
  test('la clave y los colores del script son los de la aplicación', async () => {
    const tokens = await leer(TOKENS)

    expect(fuente).toContain(CLAVE_TEMA)

    const colores = fuente.match(/#[0-9a-f]{6}/g) ?? []
    expect(colores.length).toBe(2)

    for (const color of colores) expect(tokens).toContain(color)
  })

  /**
   * Tras hidratar manda el servidor. El script dejó `color-scheme` en el `style`
   * del documento, así que si el gancho sólo cambiara `data-theme` el tema del
   * arranque seguiría ganando: se mide que reescribe las dos cosas y que guarda
   * la preferencia para el próximo arranque.
   */
  test('el gancho reescribe el tema y lo guarda para el próximo arranque', async () => {
    const gancho = await leer(GANCHO)

    expect(gancho).toContain('raiz.dataset.theme = resuelto')
    expect(gancho).toContain('raiz.style.colorScheme = resuelto')
    expect(gancho).toContain('guardarTemaPreferido(tema)')
  })
})

describe('la preferencia de tema en el almacén', () => {
  function almacen(inicial: string | null): AlmacenTema & { readonly valor: string | null } {
    let valor = inicial

    return {
      get valor(): string | null {
        return valor
      },
      getItem: (_clave: string) => valor,
      setItem: (_clave: string, nuevo: string) => {
        valor = nuevo
      },
    }
  }

  test('guarda y lee los tres valores del contrato', () => {
    for (const tema of ['dark', 'light', 'system'] as const) {
      const caja = almacen(null)

      guardarTemaPreferido(tema, caja)

      expect(leerTemaPreferido(caja)).toBe(tema)
      expect(caja.valor).toBe(tema)
    }
  })

  test('un valor ajeno no se lee como tema', () => {
    expect(leerTemaPreferido(almacen('arcoiris'))).toBeUndefined()
    expect(leerTemaPreferido(almacen(null))).toBeUndefined()
  })

  test('sin almacén no lanza', () => {
    expect(leerTemaPreferido(undefined)).toBeUndefined()
    expect(() => guardarTemaPreferido('light', undefined)).not.toThrow()
  })

  test('un almacén que lanza no rompe la aplicación', () => {
    const roto: AlmacenTema = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
    }

    expect(leerTemaPreferido(roto)).toBeUndefined()
    expect(() => guardarTemaPreferido('light', roto)).not.toThrow()
  })
})

describe('el HTML de arranque', () => {
  test('lleva description y theme-color', async () => {
    const html = await leer(HTML)

    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]{40,}"/)
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}"/)
  })

  /**
   * El orden es la medición: el script tiene que ejecutarse en el `head` y antes
   * del módulo que monta React. Un `defer` o un módulo lo dejarían para después
   * del primer fotograma y el destello volvería.
   */
  test('el tema se ejecuta antes de montar la aplicación', async () => {
    const html = await leer(HTML)
    const tema = html.indexOf('/theme-boot.js')
    const modulo = html.indexOf('/src/main.tsx')

    expect(tema).toBeGreaterThan(-1)
    expect(modulo).toBeGreaterThan(tema)
    expect(html.indexOf('</head>')).toBeGreaterThan(tema)
    expect(html).toContain('<html lang="es">')
  })
})
