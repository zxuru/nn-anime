/**
 * Los saltos de intro, ending y resumen, como funciones puras.
 *
 * La decisión de qué se ofrece y a dónde lleva es la parte que más fácil se
 * rompe de la función y la única que se puede probar sin un navegador: qué
 * intervalo está activo con la posición de ahora, a qué segundo se salta con el
 * margen elegido y con qué clave se recuerda un intervalo ya saltado.
 *
 * El margen es una preferencia de quien mira —cuántos segundos antes del final
 * quiere caer— y no una regla del servidor: el servidor publica `start` y `end`,
 * que es lo que sabe, y aquí se decide dónde se suelta la reproducción.
 */

import type { SkipInterval } from '@nn-anime/core/schema'

/** El margen máximo, en segundos. Más que eso dejaría el salto dentro del propio intervalo. */
export const MARGEN_MAXIMO_S = 5

/** El margen mínimo: saltar exactamente al final del intervalo. */
export const MARGEN_MINIMO_S = 0

/** El tipo de intervalo, tal como lo publica el servidor. */
export type TipoDeSalto = SkipInterval['type']

/**
 * La clave i18n de cada tipo.
 *
 * El tipo es vocabulario del servidor (`op`, `ed`, `recap`) y la interfaz no lo
 * enseña: se traduce aquí, en un solo sitio, para que un tipo nuevo sin texto se
 * vea como una clave suelta y no como una frase inventada.
 */
const ETIQUETAS: Readonly<Record<TipoDeSalto, string>> = {
  op: 'player.skip.op',
  ed: 'player.skip.ed',
  recap: 'player.skip.recap',
}

/** La clave i18n de la etiqueta del botón para ese tipo. */
export function etiquetaDeSalto(tipo: TipoDeSalto): string {
  return ETIQUETAS[tipo]
}

/**
 * Un margen que la aplicación acepta: entero de 0 a 5.
 *
 * Se redondea en vez de descartar porque lo que llega puede venir de un
 * `<select>` —que da cadenas— o de un almacén escrito a mano; un valor fuera de
 * rango se recorta al borde, que es lo que haría un deslizador.
 */
export function margenValido(margenS: number): number {
  if (!Number.isFinite(margenS)) return MARGEN_MINIMO_S

  return Math.min(Math.max(Math.round(margenS), MARGEN_MINIMO_S), MARGEN_MAXIMO_S)
}

/**
 * El segundo al que lleva saltar.
 *
 * Es el final menos el margen: quien lo pide así quiere caer un poco antes para
 * no perderse el arranque de lo que viene. Nunca antes del principio del
 * intervalo, aunque el margen sea mayor que el intervalo entero: saltar hacia
 * atrás no es saltar.
 *
 * Con la **duración real** —que es la del elemento, no la que publicó el
 * servidor— el destino se recorta a ella: hay episodios cuyo `ed` termina más
 * allá del final del archivo (medido: 1448 con 1440 de duración), y mandar
 * `currentTime` a un segundo que no existe lo deja en la duración, pero apunta
 * un progreso imposible. Sin duración se devuelve el destino tal cual, que es lo
 * que sabe la lógica pura.
 */
export function destinoDeSalto(
  intervalo: SkipInterval,
  margenS: number,
  duracionS?: number,
): number {
  const destino = Math.max(intervalo.start, intervalo.end - margenValido(margenS))

  if (duracionS === undefined || !Number.isFinite(duracionS) || duracionS <= 0) return destino

  return Math.min(destino, duracionS)
}

/**
 * ¿La posición cae dentro del intervalo?
 *
 * El final no cuenta: en `end` el opening ya terminó y el botón sobra. Es la
 * misma convención de medio abierto que usa el servidor al normalizar.
 */
export function dentroDelIntervalo(intervalo: SkipInterval, posicionS: number): boolean {
  return posicionS >= intervalo.start && posicionS < intervalo.end
}

/**
 * El orden en que se prefieren dos intervalos que acaban en el mismo segundo.
 *
 * Lo que la interfaz enseña es una sola etiqueta, así que hay que elegir. La
 * intro manda sobre el ending y éste sobre el resumen: son los nombres con los
 * que la gente reconoce el trozo, y un empate de finales es tan raro que no
 * merece una regla más complicada que ésta.
 */
const PREFERENCIA: Readonly<Record<TipoDeSalto, number>> = { op: 0, ed: 1, recap: 2 }

/**
 * El intervalo activo en esa posición, si hay uno.
 *
 * AniSkip publica intervalos que se solapan de verdad —`mixed-op` y `op` del
 * mismo episodio con extremos distintos—, así que entre los activos se elige el
 * que **termina más lejos**: saltar al final del más corto dejaría la
 * reproducción dentro del otro, el botón volvería a aparecer y el salto
 * automático encadenaría dos saltos seguidos. Ese caso está medido en `SNK`
 * episodio 1 y en `Kimetsu` episodio 1.
 *
 * A igualdad de final, manda el tipo: un solo botón, con una sola etiqueta, es
 * lo que se puede pulsar.
 */
export function intervaloActivo(
  intervalos: readonly SkipInterval[],
  posicionS: number,
): SkipInterval | undefined {
  let elegido: SkipInterval | undefined

  for (const intervalo of intervalos) {
    if (!dentroDelIntervalo(intervalo, posicionS)) continue
    if (elegido === undefined) {
      elegido = intervalo
      continue
    }
    if (intervalo.end > elegido.end) {
      elegido = intervalo
      continue
    }
    if (intervalo.end === elegido.end && PREFERENCIA[intervalo.type] < PREFERENCIA[elegido.type]) {
      elegido = intervalo
    }
  }

  return elegido
}

/**
 * La clave con la que se recuerda un intervalo saltado.
 *
 * Lleva el episodio además del intervalo: `op` de 5 a 20 existe en todos los
 * capítulos, y sin la referencia del episodio el segundo capítulo no volvería a
 * ofrecer su intro por culpa del primero. El final entra en la clave para que un
 * intervalo que el servidor corrija no herede la marca del viejo.
 */
export function claveDeIntervalo(episodio: string, intervalo: SkipInterval): string {
  return `${episodio}|${intervalo.type}|${intervalo.start}|${intervalo.end}`
}

/**
 * El número de episodio que lleva la referencia, si lo lleva.
 *
 * La dirección del reproductor no siempre trae `?n=`: sólo lo escribe la ficha,
 * que lo tiene en la mano. Para el resto de enlaces —viejos, escritos a mano—
 * queda la referencia, que en los proveedores de esta aplicación numera de dos
 * formas: la almohadilla (`aurora-nocturna#3`) y la barra (`dandadan/12`). Sin
 * número no se piden saltos, porque el contrato del servidor los pide por número
 * de episodio y adivinarlo sería pedir los de otro capítulo.
 */
export function numeroDeEpisodio(episodeRef: string): number | undefined {
  const almohadilla = episodeRef.indexOf('#')
  const barra = episodeRef.lastIndexOf('/')
  const corte = almohadilla !== -1 ? almohadilla : barra
  if (corte === -1) return undefined

  const numero = Number(episodeRef.slice(corte + 1))

  return Number.isInteger(numero) && numero > 0 ? numero : undefined
}
