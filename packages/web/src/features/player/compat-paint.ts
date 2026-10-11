/**
 * El pintado de los fotogramas cuando la GPU del navegador no los pinta.
 *
 * Con `<video>` + MSE el decodificador y el camino de composición los elige el
 * navegador, y **no hay API para pedirle el de software**: cuando el camino de
 * GPU no entrega imagen —un equipo con Wayland y NVIDIA, con el VA-API descartado
 * por el propio Chromium— el audio suena, `currentTime` avanza y el cuadro sale
 * negro. Lo que sí se puede es no depender de ese camino: dibujar los fotogramas
 * en un canvas 2D rasterizado por CPU. El canvas llega al compositor como una
 * textura RGBA corriente, sin la conversión YUV en la GPU que es la que falla.
 *
 * Aquí viven las decisiones —la sonda, el tamaño del lienzo y el bucle— como
 * funciones puras, para poder medirlas sin navegador: el DOM lo pone el gancho
 * `useCompatPaint`. Es la misma partición que en `controls.ts`.
 */

/** Lado máximo, en píxeles, del canvas de la sonda. La sonda no necesita más. */
export const PROBE_SIDE = 64

/**
 * Canal mínimo, de 0 a 255, para dar por hecho que hay imagen.
 *
 * Ocho y no cero: un cuadro negro de verdad guarda uno o dos niveles de ruido en
 * la compresión, y con cero el ruido pasaría por imagen. Un cuadro con algo se
 * ve a la primera, así que el umbral bajo no pierde fotogramas.
 */
export const MIN_VISIBLE_CHANNEL = 8

/** Ancho máximo del lienzo que se pinta por CPU. Un 4K por CPU cuesta cuatro veces más. */
export const MAX_CANVAS_WIDTH = 1920

/** Lo que dijo cada camino al mirar el mismo fotograma. */
export interface FrameProbe {
  readonly gpu: boolean
  readonly cpu: boolean
}

/**
 * ¿La lectura de un fotograma tiene imagen?
 *
 * Se miran los canales de color y **no el alfa**: un cuadro negro con alfa opaco
 * es `[0, 0, 0, 255]`, y contar el alfa daría por buena una imagen que no está.
 */
export function frameHasImage(
  data: ArrayLike<number>,
  umbral: number = MIN_VISIBLE_CHANNEL,
): boolean {
  for (let indice = 0; indice + 2 < data.length; indice += 4) {
    const rojo = data[indice] ?? 0
    const verde = data[indice + 1] ?? 0
    const azul = data[indice + 2] ?? 0

    if (rojo >= umbral || verde >= umbral || azul >= umbral) return true
  }

  return false
}

/**
 * ¿Hay que pintar por CPU?
 *
 * Sólo cuando el camino de GPU no trajo imagen **y** el de CPU sí. Si los dos
 * vienen vacíos no hay nada que pintar —y el caso es el otro, el que el
 * reproductor ya cuenta con «el audio suena y la imagen no llega»—, y si el de
 * GPU trae imagen no hay nada que arreglar.
 */
export function probeDecision(sonda: FrameProbe): boolean {
  return !sonda.gpu && sonda.cpu
}

/**
 * El tamaño del lienzo para un fotograma.
 *
 * Se conserva la relación y se recorta el ancho al tope: el coste de pintar por
 * CPU crece con los píxeles, y por encima de 1920 no se gana nada que se vea.
 */
export function canvasSize(
  width: number,
  height: number,
  maxWidth: number = MAX_CANVAS_WIDTH,
): { readonly width: number; readonly height: number } {
  if (width <= maxWidth) return { width, height }

  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) }
}

export interface PainterDeps {
  readonly videoWidth: () => number
  readonly videoHeight: () => number
  /** Cambia el tamaño del lienzo. El navegador lo deja en blanco al hacerlo. */
  readonly resize: (width: number, height: number) => void
  /** Pinta el fotograma actual. */
  readonly paint: () => void
  /** Programa el siguiente fotograma: `requestVideoFrameCallback` o el de animación. */
  readonly requestFrame: (callback: () => void) => number
  readonly cancelFrame: (handle: number) => void
  readonly maxWidth?: number | undefined
}

/**
 * El bucle que pinta. Devuelve cómo pararlo.
 *
 * Se vuelve a programar desde dentro, y no con un temporizador: el elemento avisa
 * cuando hay fotograma nuevo, así que un video en pausa no gasta CPU. Sin tamaño
 * de fotograma no se pinta nada —un `<video>` de sólo audio mide cero— y el
 * lienzo se redimensiona **sólo cuando el tamaño cambia**, porque cada cambio lo
 * borra y redibujarlo dos veces por fotograma es tirar trabajo.
 */
export function startCompatPainter(deps: PainterDeps): () => void {
  const tope = deps.maxWidth ?? MAX_CANVAS_WIDTH
  let vivo = true
  let ultimo: { readonly width: number; readonly height: number } | undefined
  let programado: number | undefined

  const paso = (): void => {
    if (!vivo) return

    const ancho = deps.videoWidth()
    const alto = deps.videoHeight()

    if (ancho > 0 && alto > 0) {
      const tamano = canvasSize(ancho, alto, tope)

      if (tamano.width !== ultimo?.width || tamano.height !== ultimo?.height) {
        deps.resize(tamano.width, tamano.height)
        ultimo = tamano
      }

      deps.paint()
    }

    programado = deps.requestFrame(paso)
  }

  programado = deps.requestFrame(paso)

  return () => {
    vivo = false

    if (programado !== undefined) deps.cancelFrame(programado)
  }
}
