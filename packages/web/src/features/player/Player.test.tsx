import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { Player } from './Player'

const ROOT = fileURLToPath(new URL('.', import.meta.url))

function render(node: ReactNode): string {
  return renderToString(
    <HistoryProvider history={createMemoryHistory('/watch/fixture/abc')}>{node}</HistoryProvider>,
  )
}

describe('el reproductor', () => {
  test('usa un `<video>` de verdad, no un `div` con imagen', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('<video')
    // React escribe el atributo con su nombre de propiedad; el navegador lo
    // entiende igual, y así lo comprueba la prueba.
    expect(html.toLowerCase()).toContain('playsinline')
  })

  test('los controles son botones con su texto', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    for (const texto of [
      'Reproducir',
      'Atrás 10 s',
      'Adelante 10 s',
      'Silenciar',
      'Pantalla completa',
    ]) {
      expect(html, texto).toContain(texto)
    }
    expect(html).toContain('type="button"')
  })

  test('el estado vive en una región `aria-live` educada', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('En pausa')
  })

  /**
   * El botón no cambia de tamaño al cambiar de estado.
   *
   * «Reproducir» y «Pausa» no ocupan lo mismo, y el botón medía lo que decía su
   * rótulo: al pausar encogía, los mandos de al lado se corrían y el modo
   * compatible saltaba de fila. Los dos rótulos van dentro del botón, en la misma
   * caja, y sólo el visible es el nombre del botón.
   */
  test('los mandos que cambian de rótulo llevan los dos estados dentro', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    for (const [atajo, rotulos] of [
      ['Space Enter K', ['Reproducir', 'Pausa']],
      ['M', ['Silenciar', 'Quitar silencio']],
    ] as const) {
      const boton = new RegExp(`<button[^>]*aria-keyshortcuts="${atajo}"[\\s\\S]*?</button>`).exec(
        html,
      )?.[0]

      expect(boton, atajo).toBeDefined()

      for (const rotulo of rotulos) {
        expect(boton, `${atajo}: falta «${rotulo}»`).toContain(rotulo)
      }

      // Uno de los dos rótulos está oculto, y ese no se anuncia: con los dos en
      // el nombre accesible, el lector de pantalla leería los dos estados.
      expect(boton?.match(/aria-hidden="true"/g)?.length, atajo).toBe(1)
    }
  })

  test('la atribución de hls.js aparece sólo cuando se usa HLS', () => {
    expect(render(<Player url="/stream/abc" kind="hls" />)).toContain('hls.js')
    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('hls.js')
  })

  test('los atajos se pintan como teclas, no como una frase', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    // Cada tecla va en su `kbd`: es lo que dice que se puede pulsar. Antes eran
    // una línea de texto corrido y no se leían como teclas.
    expect(html).toContain('<kbd')

    for (const tecla of ['Espacio', 'Enter', 'K', '←', '→', '↑', '↓', 'M', 'F']) {
      expect(html, tecla).toContain(`>${tecla}</kbd>`)
    }

    // Y cada tecla dice qué hace, que es lo que la hace aprendible.
    for (const hace of [
      'Pausa y reanudar',
      'Retroceder o avanzar 10 s',
      'Bajar o subir el volumen',
      'Silenciar',
      'Pantalla completa',
    ]) {
      expect(html, hace).toContain(hace)
    }
  })

  test('cada botón declara el atajo que lo dispara', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    // El atajo existe para quien no ve la ayuda de abajo: sin esto, un lector de
    // pantalla no tiene forma de saber que la barra espaciadora pausa.
    expect(html).toContain('aria-keyshortcuts="Space Enter K"')
    expect(html).toContain('aria-keyshortcuts="ArrowLeft"')
    expect(html).toContain('aria-keyshortcuts="ArrowRight"')
  })

  /**
   * El volumen se puede cambiar con el ratón, no sólo con las flechas.
   *
   * Hasta ahora el volumen sólo se movía con `↑` y `↓`: un mando que existe y no
   * se ve. La barra va de 0 a 100 —el número que se anuncia— y arranca en el
   * máximo, que es el volumen con el que el elemento empieza.
   */
  test('el volumen tiene su barra, con su nombre y de cero a cien', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('aria-label="Volumen"')
    expect(html).toContain('max="100"')
    expect(html).toContain('value="100"')
  })

  /**
   * El clic sobre la imagen y el doble clic.
   *
   * Un `<video>` sin `controls` no hace nada al pulsarlo, así que el gesto hay que
   * escribirlo. Se mira el marcado porque los manejadores no viajan en el HTML que
   * devuelve el render; lo que ocurre al pulsar de verdad lo mide el e2e del
   * reproductor.
   */
  test('el clic pausa y el doble clic pone pantalla completa', async () => {
    const fuente = await readFile(`${ROOT}Player.tsx`, 'utf8')

    expect(fuente).toContain('onClick={alClic}')
    expect(fuente).toContain('onDoubleClick={alDobleClic}')
  })

  test('mientras carga lo dice encima del video', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    // El reproductor arranca cargando, y ese estado tiene que verse: antes era
    // un párrafo debajo de los controles y la pantalla se quedaba en negro.
    expect(html).toContain('player__wait')
    expect(html).toContain('role="status"')
    expect(html).toContain('Cargando el video')
  })

  test('la URL que recibe es la del proxy, no una del upstream', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
  })

  test('la biblioteca se carga de forma diferida, no en el paquete inicial', async () => {
    const fuente = await readFile(`${ROOT}usePlayer.ts`, 'utf8')

    expect(fuente).toContain("await import('hls.js')")
    expect(fuente).not.toContain("from 'hls.js'")
  })

  test('el medio se vuelve a montar por la fuente, y por nada más', async () => {
    const fuente = await readFile(`${ROOT}usePlayer.ts`, 'utf8')
    // Las dependencias del efecto que monta el medio. Se ancla en `source.`
    // para no confundirlo con los `useCallback` del final del archivo.
    const dependencias = /}, \[source\.[^\]]*\]\)/.exec(fuente)?.[0] ?? ''

    // Con la posición de reanudación aquí, cada avance del video volvía a montar
    // el medio y la reproducción se quedaba en el segundo cero: cargaba, decía
    // la duración y no reproducía. Lo cubre además el e2e del reproductor.
    expect(dependencias).toBe('}, [source.kind, source.url])')
  })
})

describe('pistas y reanudación', () => {
  test('pinta una pista por subtítulo, con su idioma y su etiqueta', () => {
    const html = render(
      <Player
        url="/stream/abc"
        kind="hls"
        tracks={[{ url: '/api/subtitles/xyz', lang: 'es', label: 'Español' }]}
      />,
    )

    expect(html).toContain('<track')
    expect(html).toContain('src="/api/subtitles/xyz"')
    // React escribe el atributo con el nombre de la propiedad, igual que con
    // `playsInline`: el navegador lo entiende igual.
    expect(html.toLowerCase()).toContain('srclang="es"')
    expect(html).toContain('label="Español"')
  })

  test('la primera pista es la que viene marcada por defecto', () => {
    const html = render(
      <Player
        url="/stream/abc"
        kind="hls"
        tracks={[
          { url: '/api/subtitles/a', lang: 'es', label: 'Español' },
          { url: '/api/subtitles/b', lang: 'en', label: 'Inglés' },
        ]}
      />,
    )

    expect(html.match(/default=""/g)?.length).toBe(1)
  })

  test('una pista con una dirección de fuera no se convierte en atributo', () => {
    const html = render(
      <Player
        url="/stream/abc"
        kind="hls"
        tracks={[{ url: 'https://otro.example/es.vtt', lang: 'es', label: 'Español' }]}
      />,
    )

    expect(html).not.toContain('otro.example')
  })

  test('sin pistas no hay ningún `<track>`', () => {
    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('<track')
  })
})

describe('el modo compatible', () => {
  test('empieza apagado y el botón lo dice', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    // El camino normal es el del navegador; el lienzo sólo aparece cuando la
    // sonda —o quien está mirando la pantalla— lo enciende.
    expect(html).not.toContain('<canvas')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Modo compatible')
  })

  test('el lienzo del modo compatible se pide por CPU', async () => {
    const fuente = await readFile(`${ROOT}useCompatPaint.ts`, 'utf8')

    // Es el arreglo entero: un canvas por GPU pasa por la misma conversión YUV
    // que deja el cuadro negro, así que pedirlo por CPU no es un detalle.
    expect(fuente).toContain('willReadFrequently: true')
    // Y el `<video>` no se sustituye: sigue siendo quien reproduce, quien lleva
    // los subtítulos y quien habla con hls.js.
    expect(fuente).not.toContain('video.src')
  })
})
