import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryHistory, HistoryProvider } from '../../router'
import { Player } from './Player'
import { presentacionWebKit, soporteDeVentanaFlotante } from './usePictureInPicture'

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

  /**
   * Los mandos son botones con nombre.
   *
   * Con iconos no queda texto a la vista, así que el nombre accesible es lo único
   * que dice qué hace cada uno: sin él, un lector de pantalla lee «botón» seis
   * veces seguidas. Y con un dibujo dentro, el dibujo va `aria-hidden` para que el
   * nombre no se lea dos veces.
   */
  test('los controles son botones con su nombre accesible', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    for (const texto of [
      'Reproducir',
      'Retroceder 10 segundos',
      'Adelantar 10 segundos',
      'Silenciar',
      'Modo extendido',
      'Pantalla completa',
    ]) {
      expect(html, texto).toContain(`aria-label="${texto}"`)
      expect(html, texto).toContain(`title="${texto}"`)
    }
    expect(html).toContain('type="button"')
    // El dibujo no se anuncia: el nombre ya lo dice el botón.
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThan(3)
  })

  /**
   * El estado vive fuera de la pantalla, en una región educada.
   *
   * Fuera de la pantalla porque la frase —«En pausa, 0:31 de 24:55»— repetía lo
   * que ya dicen el reloj y el icono, y ocupaba sitio debajo del video. Y educada
   * porque el estado cambia a cada rato: una región que interrumpe cada segundo
   * hace inservible la página con un lector de pantalla.
   */
  test('el estado vive en una región `aria-live` educada y fuera de la pantalla', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('solo-lectores')
    expect(html).toContain('En pausa')
  })

  /**
   * El anuncio no se rehace con el reloj.
   *
   * Es la mitad que no se ve en el marcado: `status` sólo cambia en los eventos
   * que se cuentan —empezar, parar, buscar, terminar o fallar—, así que el
   * `timeupdate` no lo toca. Se mira el código porque un render sin navegador no
   * tiene eventos; el e2e mide que el texto no cambie mientras el video avanza.
   */
  test('el anuncio sólo se rehace cuando pasa algo que se cuenta', async () => {
    const fuente = await readFile(`${ROOT}usePlayer.ts`, 'utf8')

    // `alTiempo` es el que corre cuatro veces por segundo: no puede tocar
    // `status`, y la única forma de tocarlo es pasar por `anunciar`.
    const alTiempo = /const alTiempo = \(\): void => \{([\s\S]*?)\n {4}\}/.exec(fuente)?.[1] ?? ''
    expect(alTiempo).not.toContain('anunciar')

    for (const evento of [
      'const alReproducir',
      'const alPausar',
      'const alBuscar',
      'const alTerminar',
      'const alError',
    ]) {
      const cuerpo = new RegExp(`${evento}[\\s\\S]*?\\n {4}\\}`).exec(fuente)?.[0] ?? ''
      expect(cuerpo, evento).toContain('anunciar(')
    }
  })

  /**
   * El mando anuncia un solo estado, y el mismo mando sirve para los dos.
   *
   * Antes esto se resolvía con dos rótulos superpuestos dentro del botón —el que
   * no tocaba, `visibility: hidden`— porque el botón medía lo que medía su texto.
   * Con el dibujo y el nombre accesible, lo que hay que medir es lo otro: que el
   * nombre sea **uno**, el del estado actual, y que el botón siga midiendo lo
   * mismo en los dos estados —eso lo mide el e2e—.
   */
  test('cada mando dice un solo estado, y el que toca', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    const boton = (atajo: string): string =>
      new RegExp(`<button[^>]*aria-keyshortcuts="${atajo}"[\\s\\S]*?</button>`).exec(html)?.[0] ??
      ''

    const reproduccion = boton('Space Enter K')
    expect(reproduccion).toContain('aria-label="Reproducir"')
    expect(reproduccion).not.toContain('aria-label="Pausar"')

    const silencio = boton('M')
    expect(silencio).toContain('aria-label="Silenciar"')
    expect(silencio).not.toContain('aria-label="Activar sonido"')
  })

  test('la atribución de hls.js aparece sólo cuando se usa HLS', () => {
    const hls = render(<Player url="/stream/abc" kind="hls" />)

    expect(hls).toContain('hls.js')
    // La clase propia es de la que cuelga el esconderla en el modo extendido:
    // sin ella, la nota vuelve a quitarle alto a la imagen.
    expect(hls).toContain('player__attribution')
    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('hls.js')
  })

  test('los atajos se pintan como teclas, no como una frase', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    // Cada tecla va en su `kbd`: es lo que dice que se puede pulsar. Antes eran
    // una línea de texto corrido y no se leían como teclas.
    expect(html).toContain('<kbd')

    for (const tecla of ['Espacio', 'Enter', 'K', '←', '→', '↑', '↓', 'M', 'F', 'S']) {
      expect(html, tecla).toContain(`>${tecla}</kbd>`)
    }

    // Y cada tecla dice qué hace, que es lo que la hace aprendible.
    for (const hace of [
      'Pausa y reanudar',
      'Retroceder o avanzar 10 s',
      'Bajar o subir el volumen',
      'Silenciar',
      'Pantalla completa',
      'Saltar intro u ending',
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

  /**
   * La portada, sólo cuando el proveedor dio una.
   *
   * El atributo es lo que llena el marco antes del primer fotograma: sin él, el
   * reproductor enseña un rectángulo negro mientras carga, que es justo lo que
   * P5 denunciaba. Y sin portada no se pone un valor inventado: el atributo no
   * aparece y el `<video>` se queda con su fondo.
   */
  test('la portada se pinta sólo si existe', () => {
    expect(
      render(<Player url="/stream/abc" kind="file" poster="/api/cover/fixture/aurora" />),
    ).toContain('poster="/api/cover/fixture/aurora"')
    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('poster=')
  })

  /**
   * La barra de progreso dice el tiempo en palabras.
   *
   * `0:31 / 24:55` es lo que se lee; lo que se oye tiene que ser una frase. Y la
   * barra lleva tres capas —carril, búfer y reproducido— porque el navegador no
   * deja pedirle dos tramos de color al carril de un `input`.
   */
  test('la barra de progreso lleva búfer, lo reproducido y el tiempo en palabras', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('player__track')
    expect(html).toContain('player__buffer')
    expect(html).toContain('player__played')
    expect(html).toMatch(/aria-valuetext="[^"]*segundos de[^"]*segundos"/)
  })

  /**
   * El botón grande de reproducir es decoración.
   *
   * No lleva nombre accesible ni recibe el puntero: el dibujo se ve, pero el
   * mando que se anuncia es el de la barra y el gesto es del video entero. Un
   * segundo botón llamado «Reproducir» sería, además, un nombre ambiguo para
   * cualquiera que lo busque. Se mira el código porque el overlay sólo existe
   * cuando hay imagen y eso no pasa en un render sin navegador.
   */
  test('el botón grande no compite con el mando de la barra', async () => {
    const fuente = await readFile(`${ROOT}Player.tsx`, 'utf8')
    const overlay = /\{enPausa \? \(([\s\S]*?)\) : null\}/.exec(fuente)?.[1] ?? ''

    expect(overlay).toContain('player__play-icon')
    expect(overlay).toContain('aria-hidden="true"')
    // Sin manejador y sin botón: el clic es del video entero —que es toda la
    // superficie— y el mando que se anuncia es el de la barra.
    expect(overlay).not.toContain('onClick')
    expect(overlay).not.toContain('<button')
  })

  test('la URL que recibe es la del proxy, no una del upstream', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    // Desde que los mandos son de lucide, cada `<svg>` trae su `xmlns`: es el
    // único http(s) que puede aparecer. Se quita y se mira el resto —una
    // dirección del proveedor en el medio seguiría haciendo fallar la prueba—.
    const sinEspacioDeNombres = html.replaceAll('http://www.w3.org/2000/svg', '')

    expect(sinEspacioDeNombres).not.toContain('http://')
    expect(sinEspacioDeNombres).not.toContain('https://')
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

describe('los saltos', () => {
  /** El salto que la pantalla calcula: clave del intervalo, etiqueta y destino. */
  const SALTO = {
    key: 'fixture:aurora-nocturna#3|op|5|20',
    labelKey: 'player.skip.op',
    destinoS: 20,
  }

  /**
   * El botón, dentro del marco y con su nombre.
   *
   * `aria-keyshortcuts` no es adorno: dice que `S` lo dispara, y el botón lleva
   * texto porque un mando sin nombre no se puede pulsar con un lector de
   * pantalla. Sin intervalo no hay botón: la pantalla queda como estaba.
   */
  test('el botón se pinta con su etiqueta y su atajo, y sin intervalo no existe', () => {
    const html = render(<Player url="/stream/abc" kind="file" skip={SALTO} onSkip={() => {}} />)

    expect(html).toContain('player__skip')
    expect(html).toContain('Saltar intro')
    expect(html).toContain('aria-keyshortcuts="S"')
    // Dentro del marco, que viaja entero dentro del escenario a pantalla completa.
    expect(html.indexOf('player__frame')).toBeLessThan(html.indexOf('player__skip'))

    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('player__skip')
  })

  /**
   * Las marcas de los intervalos en la barra: contexto de dónde está el opening.
   *
   * Sólo se pintan con datos. Sin ellos la barra queda exactamente como estaba
   * —la lista vacía es el caso normal, no la excepción—.
   */
  test('los intervalos se marcan en la barra, y sin datos no hay marcas', () => {
    const conDatos = render(
      <Player url="/stream/abc" kind="file" intervals={[{ type: 'op', start: 5, end: 20 }]} />,
    )

    expect(conDatos.match(/player__skip-marker/g)?.length).toBe(1)
    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('player__skip-marker')
    expect(render(<Player url="/stream/abc" kind="file" intervals={[]} />)).not.toContain(
      'player__skip-marker',
    )
  })

  /**
   * La pantalla completa se pide sobre el escenario.
   *
   * El navegador no pinta nada que quede fuera del elemento a pantalla completa,
   * y los mandos son hermanos del marco: pedirla sobre el video o sobre el marco
   * los deja fuera, con la barra, los saltos y el botón de salir. Lo mide el e2e
   * —los mandos visibles y pulsables dentro de la pantalla completa—, y aquí se
   * sujeta el contrato: `usePlayer` acepta el objetivo y `Player` le pasa el
   * escenario.
   */
  test('la pantalla completa se pide sobre el escenario, no sobre el `<video>`', async () => {
    const fuente = await readFile(`${ROOT}Player.tsx`, 'utf8')

    expect(fuente).toContain('fullscreenTarget: objetivoPantalla')
    expect(fuente).toContain('const objetivoPantalla = useCallback(() => escenario.current, [])')
    expect(fuente).toContain('ref={escenario}')
  })
})

describe('la velocidad y la ventana flotante', () => {
  /**
   * La velocidad se elige del menú y se recuerda.
   *
   * La lista es cerrada y cada opción declara si es la puesta. El texto lleva
   * coma decimal: `0,75×` y no `0.75×`.
   */
  test('el menú ofrece las cinco velocidades y marca la normal', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('Velocidad')
    for (const velocidad of ['0,75×', '1×', '1,25×', '1,5×', '2×']) {
      expect(html, velocidad).toContain(`>${velocidad}</button>`)
    }

    // Sin almacén en el servidor, la preferencia es la normal.
    expect(html).toMatch(/aria-pressed="true"[^>]*>1×</)
  })

  test('la velocidad se guarda en el almacén del navegador', async () => {
    const fuente = await readFile(`${ROOT}Player.tsx`, 'utf8')

    expect(fuente).toContain('leerVelocidad(almacenLocal())')
    expect(fuente).toContain('guardarVelocidad(almacenLocal(), valor)')
    expect(fuente).toContain('setRate(valor)')
  })

  /**
   * El audio no se repite en el menú.
   *
   * El conmutador de subtitulado y doblado vive fuera del reproductor, en la fila
   * de mandos de la pantalla, y es el único: una segunda copia en el menú eran dos
   * listas con el mismo nombre accesible y dos formas de cambiar lo mismo, que el
   * ojo lee como un ajuste distinto y puede desincronizarse del de fuera.
   */
  test('el menú de ajustes no repite el conmutador de audio', () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    expect(html).toContain('player__menu')
    expect(html).not.toContain('audio-switch')
    expect(html).not.toContain('Subtitulado')
  })

  /**
   * La reproducción automática, en la fila y no en el menú.
   *
   * Se toca al terminar un capítulo, no al configurar la aplicación, y dentro del
   * menú sólo se encontraba abriéndolo. Es un interruptor y no una acción: lleva
   * `aria-pressed` y su nombre no cambia con el estado, como el modo compatible.
   * Sin pantalla que ofrezca el ajuste no se pinta, igual que antes.
   */
  test('la reproducción automática vive en la fila, no en el menú', () => {
    const html = render(<Player url="/stream/abc" kind="file" autoplay onAutoplay={() => {}} />)

    expect(html).toContain('class="button player__control player__autoplay"')
    expect(html).toContain('aria-label="Reproducción automática"')
    expect(html).toContain('aria-pressed="true"')
    // Delante de los ajustes en la fila —no dentro de su menú— y sin casilla en
    // él: un mando, no dos formas de cambiar lo mismo.
    expect(html.indexOf('player__autoplay')).toBeLessThan(html.indexOf('player__settings'))
    expect(html).not.toContain('player__switch')

    expect(
      render(<Player url="/stream/abc" kind="file" autoplay={false} onAutoplay={() => {}} />),
    ).toContain('aria-pressed="false"')

    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('player__autoplay')
  })

  /**
   * El picture-in-picture no se ofrece donde no existe.
   *
   * En el render de servidor no hay `document`, así que el mando no aparece. El
   * soporte se pregunta con `pictureInPictureEnabled` y el estado sale de los
   * eventos del video, no de haber pulsado el botón.
   */
  test('sin soporte no hay mando, y el soporte se pregunta al navegador', async () => {
    expect(render(<Player url="/stream/abc" kind="file" />)).not.toContain('Ventana flotante')

    const fuente = await readFile(`${ROOT}usePictureInPicture.ts`, 'utf8')

    expect(fuente).toContain('document.pictureInPictureEnabled === true')
    expect(fuente).toContain('requestPictureInPicture')
    expect(fuente).toContain('enterpictureinpicture')
  })

  /**
   * El mando de la ventana flotante, donde se busca.
   *
   * El render de servidor no tiene `document`, así que se le da un doble mínimo
   * para medir el marcado: el botón vive dentro del marco y **no** en el menú de
   * ajustes. Es lo que separa «existe» de «se encuentra».
   */
  test('con soporte, el mando vive en el marco y no en el menú', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { pictureInPictureEnabled: true, pictureInPictureElement: null },
    })

    try {
      const html = render(<Player url="/stream/abc" kind="file" />)

      expect(html).toContain('class="button player__control player__pip"')
      expect(html).toContain('aria-label="Ventana flotante"')
      expect(html).toContain('aria-pressed="false"')
      expect(html.indexOf('player__pip')).toBeLessThan(html.indexOf('player__settings'))
      expect(html).not.toContain('player__menu-action" aria-pressed="false">Ventana flotante')
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, 'document')
      } else {
        Object.defineProperty(globalThis, 'document', descriptor)
      }
    }
  })

  /**
   * WebKit es la otra puerta.
   *
   * Safari no expone `document.pictureInPictureEnabled`; ofrece
   * `webkitSupportsPresentationMode` y cambia con `webkitSetPresentationMode`.
   * La decisión se prueba con un doble y la rama se mide por el fuente: sin un
   * Mac o un iPhone, la reproducción real no se puede declarar medida.
   */
  test('la ventana flotante también se pregunta a WebKit', async () => {
    const webkit = {
      webkitSupportsPresentationMode: (mode: 'picture-in-picture' | 'inline'): boolean =>
        mode === 'picture-in-picture',
      webkitPresentationMode: 'inline' as const,
    }

    expect(soporteDeVentanaFlotante(webkit)).toBe(true)
    expect(soporteDeVentanaFlotante({ webkitSupportsPresentationMode: () => false })).toBe(false)
    expect(soporteDeVentanaFlotante(null)).toBe(false)
    expect(presentacionWebKit(webkit)).toBe(false)
    expect(presentacionWebKit({ ...webkit, webkitPresentationMode: 'picture-in-picture' })).toBe(
      true,
    )

    const fuente = await readFile(`${ROOT}usePictureInPicture.ts`, 'utf8')
    expect(fuente).toContain('webkitSetPresentationMode')
    expect(fuente).toContain('webkitpresentationmodechanged')
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
  /**
   * El interruptor vive en el menú de ajustes.
   *
   * Estaba en la fila de mandos, con el mismo peso que reproducir: una opción
   * técnica que se toca una vez al lado de lo que se toca cada minuto. El menú
   * sigue en el documento cerrado —es lo que permite animar la salida—, pero
   * `inert` y `aria-hidden` lo dejan fuera del foco y de la lectura; encenderlo
   * de verdad lo mide el e2e.
   */
  test('empieza apagado y vive en el menú de ajustes, cerrado e inerte', async () => {
    const html = render(<Player url="/stream/abc" kind="file" />)

    // El camino normal es el del navegador; el lienzo sólo aparece cuando la
    // sonda —o quien está mirando la pantalla— lo enciende.
    expect(html).not.toContain('<canvas')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Ajustes"')
    // El menú cerrado no se alcanza: ni foco, ni lector de pantalla.
    expect(html).toContain('data-abierto="false"')
    expect(html).toContain('inert=""')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('Modo compatible')

    const fuente = await readFile(`${ROOT}Player.tsx`, 'utf8')

    // El único interruptor del archivo es el del menú: un segundo sitio donde
    // encenderlo sería un segundo estado que mantener.
    expect(fuente.match(/player\.compat'\)/g)?.length).toBe(1)
    expect(fuente).toContain('aria-pressed={pintando}')
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
