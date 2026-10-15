/**
 * El banner de la marquesina y la tinta que le toca.
 *
 * La marquesina se pintaba siempre sobre el mismo degradado oscuro, así que su
 * texto era crema y ya está. Con el banner de AniList el campo pasa a ser una
 * imagen cualquiera, y una imagen puede ser una nieve: sobre una nieve, el crema
 * desaparece. Aquí se decide de qué color va el texto **antes** de enseñar la
 * imagen.
 *
 * La decisión es una sola medida —la luminancia media del trozo de banner que
 * queda debajo del texto— y unas cuantas funciones puras, para poder medirlas sin
 * navegador. El DOM —la imagen, el lienzo y la lectura de píxeles— lo pone el
 * gancho del final. Es la misma partición que `compat-paint` y `useCompatPaint`.
 *
 * Dos reglas sostienen la garantía, y las dos se miden en `a11y.test.ts`:
 *
 * 1. **El velo va al tono del campo**, que es justo el contrario de la tinta. Una
 *    tinta oscura sobre un velo oscuro no se lee: lo que aplana la imagen hasta
 *    que el texto se lee es un velo de su mismo color, con la opacidad mínima que
 *    llevan los tokens.
 * 2. **El umbral y el mínimo van juntos.** El umbral decide la dirección y el
 *    mínimo garantiza el contraste del peor caso de esa dirección —el campo en el
 *    propio umbral—, así que mover uno sin el otro rompe la prueba.
 */

import { useEffect, useState } from 'react'

/**
 * El umbral de luminancia que separa un campo claro de uno oscuro.
 *
 * En el medio, porque es lo que reparte: por debajo manda el velo oscuro —el de
 * siempre— y por encima la tinta se da la vuelta. El mínimo del velo está medido
 * contra este número: subirlo dejaría el campo de la tinta crema demasiado claro
 * para la tinta más tenue, y `a11y.test.ts` lo dice.
 */
export const UMBRAL_DE_TINTA = 0.5

/**
 * La parte del ancho del banner que se mira.
 *
 * La columna del texto es la primera del reparto de la marquesina —`1fr` contra
 * `0.58fr`—, así que ocupa poco más de la mitad izquierda. Y lo que importa es el
 * tono de debajo del texto, no el de la imagen entera: un banner oscuro con una
 * esquina blanca a la derecha —donde va el cartel— no pide tinta oscura para el
 * titular.
 */
export const ZONA_DE_TEXTO = 0.64

/** El lado del lienzo de la sonda, en píxeles. 256 lecturas bastan para un tono. */
export const LADO_DE_LA_SONDA = 16

/** De qué color va el texto que se apoya en el campo de la marquesina. */
export type Tinta = 'clara' | 'oscura'

/**
 * La luminancia relativa de un color, con la fórmula de WCAG 2.1.
 *
 * Es la misma que mide el contraste de la paleta, y aquí se usa para lo mismo: un
 * número que dice si un color es claro u oscuro **como lo ve el ojo** y no como lo
 * dice su media aritmética. El verde pesa siete veces más que el azul, así que un
 * verde y un azul del mismo brillo no son el mismo tono.
 */
export function luminanciaRelativa(rojo: number, verde: number, azul: number): number {
  const canal = (valor: number): number => {
    const proporcion = valor / 255

    return proporcion <= 0.03928 ? proporcion / 12.92 : ((proporcion + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * canal(rojo) + 0.7152 * canal(verde) + 0.0722 * canal(azul)
}

/**
 * La luminancia media de un lienzo en RGBA.
 *
 * El alfa no entra en la media: la sonda dibuja el banner sobre un lienzo vacío, y
 * ahí el alfa es siempre opaco. Lo que se mide es el color que se ve.
 *
 * Sin píxeles devuelve cero —un campo oscuro, la tinta de siempre—: quedarse sin
 * medida no puede acabar en una tinta clara sobre una imagen que nadie ha mirado.
 */
export function luminanciaMedia(datos: ArrayLike<number>): number {
  let suma = 0
  let cuenta = 0

  for (let indice = 0; indice + 3 < datos.length; indice += 4) {
    suma += luminanciaRelativa(datos[indice] ?? 0, datos[indice + 1] ?? 0, datos[indice + 2] ?? 0)
    cuenta += 1
  }

  return cuenta === 0 ? 0 : suma / cuenta
}

/**
 * La tinta que le toca a un campo de esta luminancia.
 *
 * Una comparación y ya: lo que tiene miga es el número con el que se compara y lo
 * que lo sostiene, no la decisión.
 */
export function tintaDeLuminancia(luminancia: number): Tinta {
  return luminancia >= UMBRAL_DE_TINTA ? 'oscura' : 'clara'
}

/** El banner que se va a pintar, con la tinta que le tocó. */
export interface BannerMedido {
  /**
   * Lo que va en el `src` de la imagen: una ruta local de AniList, ya comprobada
   * con `isAniListImagePath`. No es la dirección que llegó del enriquecimiento,
   * sino la que la página está dispuesta a pedir.
   */
  readonly src: string
  readonly tinta: Tinta
}

/**
 * La forma de una ruta de imagen de AniList, tal y como la compone el servidor
 * —`anilistImagePath` en `core`—: la clase de imagen y un id entero.
 */
const RUTA_DE_IMAGEN = /^\/api\/anilist\/image\/(?:cover|banner)\/\d+$/

/**
 * ¿La dirección es una ruta local de imagen de AniList?
 *
 * Se comprueba la **forma entera** y no el prefijo, al contrario que `isProxyPath`
 * —que es la lista blanca de los subtítulos y del stream, y ahí el prefijo es todo
 * lo que hay que decir—. Aquí lo que entra acaba en el `src` de una imagen, y una
 * dirección absoluta sería pedirle la imagen a un sitio que no es el servidor,
 * desde el navegador de quien mira y con su dirección IP. La CSP ya lo cortaría;
 * esto lo corta antes, que es donde se puede decir por qué.
 */
export function isAniListImagePath(url: string): boolean {
  return RUTA_DE_IMAGEN.test(url)
}

/**
 * El tono del trozo de banner que queda debajo del texto, o `undefined` si no se
 * pudo leer.
 *
 * `undefined` es «no hay medida» y no «campo oscuro»: leer los píxeles de un
 * lienzo manchado por una imagen de otro origen lanza, y una imagen servida por el
 * propio servidor no lo hace pero la aplicación no tiene por qué depender de eso.
 * Sin medida, el banner se enseña igual con la tinta de siempre —el velo la
 * sostiene sobre cualquier imagen—; lo que no se hace es inventarse el tono.
 */
function leerBanner(imagen: HTMLImageElement): Tinta | undefined {
  const ancho = imagen.naturalWidth
  const alto = imagen.naturalHeight

  if (ancho === 0 || alto === 0) return undefined

  const lienzo = document.createElement('canvas')
  lienzo.width = LADO_DE_LA_SONDA
  lienzo.height = LADO_DE_LA_SONDA

  const contexto = lienzo.getContext('2d', { willReadFrequently: true })
  if (contexto === null) return undefined

  try {
    // Se dibuja **sólo la zona del texto** y ya reducida al lado de la sonda: el
    // navegador promedia al escalar, que es exactamente la media que se quiere.
    contexto.drawImage(
      imagen,
      0,
      0,
      Math.max(1, Math.round(ancho * ZONA_DE_TEXTO)),
      alto,
      0,
      0,
      LADO_DE_LA_SONDA,
      LADO_DE_LA_SONDA,
    )

    const pixeles = contexto.getImageData(0, 0, LADO_DE_LA_SONDA, LADO_DE_LA_SONDA)

    return tintaDeLuminancia(luminanciaMedia(pixeles.data))
  } catch {
    return undefined
  }
}

/**
 * El banner del destacado, ya medido, o `undefined` mientras no lo esté.
 *
 * La medida necesita la imagen cargada, así que de aquí sale el banner entero —la
 * ruta y la tinta— y la marquesina no pinta la imagen hasta tenerlo. Si la pintara
 * antes, el campo enseñaría la imagen con la tinta de siempre durante un fotograma,
 * que es justo el parpadeo que este trabajo evita. El precio es que el banner
 * aparece cuando termina de cargar, como cualquier imagen.
 *
 * Una dirección que no sea la ruta local de una imagen de AniList no se pide
 * siquiera: el campo se queda con su degradado. Y un fallo —la imagen que no
 * llega— deja lo mismo, que es lo que hacía antes de que hubiera banners.
 */
export function useBannerDeLaMarquesina(url: string | undefined): BannerMedido | undefined {
  const [banner, setBanner] = useState<BannerMedido | undefined>(undefined)

  useEffect(() => {
    // Cada dirección empieza de cero: mientras la imagen nueva no llegue, la
    // marquesina se queda con su degradado antes que con el banner de la obra
    // anterior, que ya no es la que se está enseñando.
    setBanner(undefined)

    if (url === undefined || !isAniListImagePath(url)) return

    let vivo = true
    const imagen = new Image()

    imagen.onload = () => {
      if (!vivo) return

      // Sin medida se pinta con la tinta de siempre, que el velo sostiene sobre
      // cualquier imagen: quedarse sin banner por no poder leer unos píxeles sería
      // perder lo que se venía a enseñar.
      setBanner({ src: url, tinta: leerBanner(imagen) ?? 'clara' })
    }

    imagen.onerror = () => {
      if (vivo) setBanner(undefined)
    }

    imagen.src = url

    return () => {
      vivo = false
      imagen.onload = null
      imagen.onerror = null
    }
  }, [url])

  return banner
}
