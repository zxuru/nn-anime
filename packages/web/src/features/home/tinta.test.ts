import { describe, expect, test } from 'bun:test'
import {
  isAniListImagePath,
  LADO_DE_LA_SONDA,
  luminanciaMedia,
  luminanciaRelativa,
  tintaDeLuminancia,
  UMBRAL_DE_TINTA,
  ZONA_DE_TEXTO,
} from './tinta'

/**
 * La decisión de la tinta de la marquesina, medida sin navegador.
 *
 * Lo que se prueba aquí es la parte pura: la fórmula con la que se mide un color,
 * la media de un lienzo y el umbral que reparte las dos tintas. El DOM —la imagen,
 * el lienzo y la lectura de píxeles— es del gancho, y lo mide el e2e.
 */

describe('la luminancia relativa de un color', () => {
  test('el negro es cero y el blanco uno', () => {
    expect(luminanciaRelativa(0, 0, 0)).toBe(0)
    expect(luminanciaRelativa(255, 255, 255)).toBeCloseTo(1, 5)
  })

  /**
   * La corrección de gamma, que es la mitad de la fórmula.
   *
   * Un gris medio no es la mitad de luminoso: lo es un 21,6 %. Sin la corrección,
   * un gris de 128 pasaría por un campo más claro de lo que se ve, y el umbral
   * —que está puesto para lo que se ve— elegiría la tinta equivocada en las
   * imágenes de medios tonos, que son casi todas.
   */
  test('un gris medio es un 21,6 % de luminancia, no la mitad', () => {
    expect(luminanciaRelativa(128, 128, 128)).toBeCloseTo(0.2158, 3)
  })

  /**
   * Y los pesos del ojo, que son la otra mitad.
   *
   * Un verde puro ilumina siete veces más que un azul puro. Con la media de los
   * canales, un banner azul y uno verde con el mismo brillo pedirían la misma
   * tinta, y la tinta se elige para el ojo.
   */
  test('el verde pesa mucho más que el azul', () => {
    expect(luminanciaRelativa(0, 255, 0)).toBeCloseTo(0.7152, 4)
    expect(luminanciaRelativa(0, 0, 255)).toBeCloseTo(0.0722, 4)
    expect(luminanciaRelativa(0, 255, 0)).toBeGreaterThan(luminanciaRelativa(0, 0, 255) * 5)
  })
})

describe('la luminancia media de un lienzo', () => {
  /** Un píxel RGBA, como los devuelve `getImageData`. */
  const pixel = (rojo: number, verde: number, azul: number): number[] => [rojo, verde, azul, 255]

  test('la media de un negro y un blanco es el medio', () => {
    const datos = [...pixel(0, 0, 0), ...pixel(255, 255, 255)]

    expect(luminanciaMedia(datos)).toBeCloseTo(0.5, 5)
  })

  /**
   * El alfa no cuenta.
   *
   * La sonda dibuja el banner sobre un lienzo vacío, así que el alfa es siempre
   * opaco; leerlo como si fuera un canal desplazaría la ventana y la media saldría
   * de píxeles que no son.
   */
  test('un alfa transparente no cambia la medida', () => {
    const opaco = [...pixel(255, 255, 255), ...pixel(0, 0, 0)]
    const transparente = [255, 255, 255, 0, 0, 0, 0, 0]

    expect(luminanciaMedia(transparente)).toBeCloseTo(luminanciaMedia(opaco), 6)
  })

  /**
   * Sin píxeles, un campo oscuro.
   *
   * Es la tinta de siempre y la que el velo oscuro sostiene sobre cualquier
   * imagen: quedarse sin medida no puede acabar en la tinta clara, que es la que
   * desaparece sobre una nieve.
   */
  test('sin píxeles no se inventa un campo claro', () => {
    expect(luminanciaMedia([])).toBe(0)
    expect(luminanciaMedia([255, 255])).toBe(0)
  })
})

describe('la tinta que le toca a un campo', () => {
  test('un campo oscuro lleva tinta crema', () => {
    expect(tintaDeLuminancia(0)).toBe('clara')
    expect(tintaDeLuminancia(UMBRAL_DE_TINTA - 0.01)).toBe('clara')
  })

  test('un campo claro la lleva oscura', () => {
    expect(tintaDeLuminancia(1)).toBe('oscura')
    expect(tintaDeLuminancia(UMBRAL_DE_TINTA + 0.01)).toBe('oscura')
  })

  /**
   * El umbral es un punto, y el punto tiene lado.
   *
   * La dirección no es un detalle de estilo: el velo de cada par está medido para
   * el peor caso de **su** lado del umbral (`a11y.test.ts`). Un campo justo en el
   * número cuenta como claro, así que la tinta que le toca es la oscura, y el velo
   * que lo sostiene es el claro.
   */
  test('el campo justo en el umbral pide la tinta oscura', () => {
    expect(tintaDeLuminancia(UMBRAL_DE_TINTA)).toBe('oscura')
  })
})

describe('la ruta local de una imagen de AniList', () => {
  test('acepta las dos clases de imagen que sirve el servidor', () => {
    expect(isAniListImagePath('/api/anilist/image/banner/101922')).toBe(true)
    expect(isAniListImagePath('/api/anilist/image/cover/101922')).toBe(true)
  })

  /**
   * Y nada más.
   *
   * Es lo que acaba en el `src` de una imagen: una dirección absoluta pediría la
   * imagen a un sitio que no es el servidor, desde el navegador de quien mira. La
   * forma entera —clase e id— se comprueba porque el prefijo solo dejaría pasar
   * `/api/anilist/image/banner/no-soy-un-id`, que la ruta contesta con un 404.
   */
  test('rechaza lo que no es una ruta de imagen de AniList', () => {
    const fuera = [
      'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922.jpg',
      '//otro.example/banner.jpg',
      '/api/anilist/image/banner/no-soy-un-id',
      '/api/anilist/image/sidebar/101922',
      '/api/anilist/image/101922',
      '/api/anilist/image/banner/101922?x=1',
      'javascript:alert(1)',
      '',
    ]

    for (const direccion of fuera) {
      expect(isAniListImagePath(direccion), direccion).toBe(false)
    }
  })
})

describe('las medidas de la sonda', () => {
  test('el lienzo es un cuadrado pequeño y la zona, la columna del texto', () => {
    expect(LADO_DE_LA_SONDA).toBe(16)
    // Poco más de la mitad: la columna de texto del reparto de la marquesina.
    expect(ZONA_DE_TEXTO).toBeGreaterThan(0.5)
    expect(ZONA_DE_TEXTO).toBeLessThan(0.7)
  })
})
