import { expect, type Page, test } from '@playwright/test'
import { AVISOS, CLAVE_GUIA, RECORRIDOS, VERSION_GUIA } from '../src/features/guia/guia'
import { BASE } from './fixtures'

/**
 * La guía, en el navegador.
 *
 * Lo que se mide aquí no se puede medir sin DOM: que cada pantalla estrene su
 * recorrido la primera vez, que avance, que cerrarlo lo dé por visto, que un
 * aviso de novedad salga una vez y que Ajustes sea el índice. El `setup` deja
 * todos los recorridos vistos para que el resto de la suite no se los encuentre
 * encima.
 */

const POPOVER = '.driver-popover.nn-guia'
const TODOS = RECORRIDOS.map((recorrido) => recorrido.id)
const TODOS_LOS_AVISOS = AVISOS.map((aviso) => aviso.id)

interface EstadoLeido {
  recorridos: string[]
  tutorialsDisabled: boolean
}

/**
 * El estado que la guía dejó en el almacén, leído del navegador.
 *
 * Se mide lo guardado y no lo que la prueba cree haber pulsado: la mitad de este
 * trabajo es que la decisión sobreviva a una recarga.
 */
async function estadoGuardado(page: Page): Promise<EstadoLeido | null> {
  return page.evaluate((clave) => {
    const crudo = localStorage.getItem(clave)
    if (crudo === null) return null

    let datos: unknown
    try {
      datos = JSON.parse(crudo)
    } catch {
      return null
    }

    if (typeof datos !== 'object' || datos === null) return null

    const registro: Record<string, unknown> = {}
    if (!Array.isArray(datos)) {
      for (const [nombre, valor] of Object.entries(datos)) registro[nombre] = valor
    }

    const recorridos = Array.isArray(registro.recorridos)
      ? registro.recorridos.filter((id): id is string => typeof id === 'string')
      : []

    return { recorridos, tutorialsDisabled: registro.tutorialsDisabled === true }
  }, CLAVE_GUIA)
}

/** Siembra el estado de la guía en el almacén del navegador. */
async function sembrarEstado(
  page: Page,
  estado: {
    recorridos?: readonly string[]
    vistos?: readonly string[]
    tutorialsDisabled?: boolean
  } = {},
): Promise<void> {
  await page.evaluate(
    ({ clave, v, recorridos, vistos, tutorialsDisabled }) => {
      localStorage.setItem(clave, JSON.stringify({ v, recorridos, vistos, tutorialsDisabled }))
    },
    {
      clave: CLAVE_GUIA,
      v: VERSION_GUIA,
      recorridos: estado.recorridos ?? [],
      vistos: estado.vistos ?? [],
      tutorialsDisabled: estado.tutorialsDisabled ?? false,
    },
  )
}

test.describe('la guía de la aplicación', () => {
  test('el recorrido de Inicio sale solo, avanza y no vuelve', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate((clave) => localStorage.removeItem(clave), CLAVE_GUIA)
    await page.reload()

    const popover = page.locator(POPOVER)
    await expect(popover).toBeVisible({ timeout: 15_000 })
    await expect(popover).toContainText('Bienvenido a nn-anime')
    await expect(popover).toContainText('1 de 6')

    await page.locator('.driver-popover-next-btn').click()
    await expect(popover).toContainText('Aquí te mueves')
    await expect(popover).toContainText('2 de 6')

    await page.keyboard.press('Escape')
    await expect(page.locator('.driver-overlay')).toHaveCount(0)

    // Cerrarlo cuenta como verlo: al volver a abrir la aplicación no sale.
    await page.reload()
    await page.waitForTimeout(2000)
    await expect(page.locator(POPOVER)).toHaveCount(0)
  })

  test('cerrarlo nada más salir también lo da por visto', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate((clave) => localStorage.removeItem(clave), CLAVE_GUIA)
    // Sin esperar a `load`: el recorrido sale 900 ms después de montar, y aquí
    // hay que llegar antes para poder cerrarlo en su primera transición.
    await page.reload({ waitUntil: 'domcontentloaded' })

    /*
      El cierre se pide en cuanto el popover entra en el documento. El
      observador corre como microtarea, antes del fotograma en el que driver.js
      da el paso por «activo»: cerrando sin esperar la animación, la prueba no
      depende de los tiempos. Esa ventana era justo la que dejaba el recorrido
      sin marcar, y por eso volvía a salir en la visita siguiente.
    */
    await page.evaluate(() => {
      const observador = new MutationObserver(() => {
        if (document.querySelector('.driver-popover.nn-guia') === null) return

        observador.disconnect()
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
      })

      observador.observe(document.documentElement, { childList: true, subtree: true })
    })

    // No llega a verse: el observador lo cierra en el instante en que aparece.
    await expect(page.locator(POPOVER)).toHaveCount(0)
    await expect
      .poll(() => page.evaluate((clave) => localStorage.getItem(clave), CLAVE_GUIA))
      .toContain('"inicio"')
  })

  test('cada pantalla estrena el suyo: Buscar y Biblioteca', async ({ page }) => {
    await page.goto(`${BASE}/search`)
    await page.evaluate(
      ({ clave, v }) => {
        localStorage.setItem(clave, JSON.stringify({ v, recorridos: [], vistos: [] }))
      },
      { clave: CLAVE_GUIA, v: VERSION_GUIA },
    )
    await page.reload()

    const popover = page.locator(POPOVER)
    await expect(popover).toBeVisible({ timeout: 15_000 })
    await expect(popover).toContainText('Buscar')
    await expect(popover).toContainText('1 de 3')

    await page.keyboard.press('Escape')

    await page.goto(`${BASE}/library`)
    await expect(popover).toBeVisible({ timeout: 15_000 })
    await expect(popover).toContainText('Tu biblioteca')
    await expect(popover).toContainText('1 de 4')
  })

  test('un aviso de novedad sale una vez y se descarta', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate(
      ({ clave, v, recorridos }) => {
        localStorage.setItem(clave, JSON.stringify({ v, recorridos, vistos: [] }))
      },
      { clave: CLAVE_GUIA, v: VERSION_GUIA, recorridos: TODOS },
    )
    await page.reload()

    const faro = page.locator('.driver-hint')
    await expect(faro).toBeVisible({ timeout: 15_000 })
    await faro.click()

    const aviso = page.locator('.driver-popover.nn-guia-aviso')
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('Nuevo: descargas')

    await page.locator('.driver-popover-next-btn').click()
    await expect(page.locator('.driver-hint')).toHaveCount(0)

    await page.reload()
    await page.waitForTimeout(2000)
    await expect(page.locator('.driver-hint')).toHaveCount(0)
  })

  test('Ajustes abre el recorrido de una sección', async ({ page }) => {
    await page.goto(`${BASE}/settings`)

    await page.getByRole('button', { name: 'Inicio', exact: true }).click()

    await expect(page).toHaveURL(`${BASE}/`)
    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator(POPOVER)).toContainText('Bienvenido a nn-anime')
  })

  test('«Omitir tutorial» sale en cada paso y cierra el recorrido', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate((clave) => localStorage.removeItem(clave), CLAVE_GUIA)
    await page.reload()

    const popover = page.locator(POPOVER)
    const omitir = page.getByRole('button', { name: 'Omitir tutorial' })

    await expect(popover).toBeVisible({ timeout: 15_000 })
    await expect(popover).toContainText('1 de 6')
    await expect(omitir).toBeVisible()

    // Objetivo táctil de la casa: 44 px de alto. Si el botón se encoge en el
    // pie del popover, en un teléfono se falla al pulsarlo.
    const caja = await omitir.boundingBox()
    if (caja === null) throw new Error('el botón de omitir no tiene caja')
    expect(caja.height).toBeGreaterThanOrEqual(44)

    // Al avanzar, el botón sigue ahí: no es un mando de la bienvenida. Ése era
    // el defecto — omitir sólo existía en el primer paso.
    await page.locator('.driver-popover-next-btn').click()
    await expect(popover).toContainText('2 de 6')
    await expect(omitir).toBeVisible()

    await omitir.click()
    await expect(page.locator('.driver-overlay')).toHaveCount(0)
    // Omitir es cerrar: el recorrido queda visto y no vuelve a salir solo.
    await expect.poll(async () => (await estadoGuardado(page))?.recorridos).toContain('inicio')

    await page.reload()
    await page.waitForTimeout(2000)
    await expect(page.locator(POPOVER)).toHaveCount(0)
  })

  test('el clic fuera del popover cierra y lo da por visto', async ({ page }) => {
    await page.goto(`${BASE}/`)
    await page.evaluate((clave) => localStorage.removeItem(clave), CLAVE_GUIA)
    await page.reload()

    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 15_000 })

    // La esquina superior izquierda: fuera del recorte y del popover. El velo es
    // un `path` de driver.js, así que el clic llega a su manejador.
    await page.mouse.click(8, 8)
    await expect(page.locator('.driver-overlay')).toHaveCount(0)
    await expect.poll(async () => (await estadoGuardado(page))?.recorridos).toContain('inicio')
  })

  test('«Omitir todos los tutoriales» apaga también los recorridos futuros', async ({ page }) => {
    await page.goto(`${BASE}/settings`)
    await sembrarEstado(page, { recorridos: TODOS })
    await page.reload()

    await page.getByRole('button', { name: 'Omitir todos los tutoriales' }).click()

    // Sin diálogo de confirmación: no es destructivo y las secciones de arriba
    // siguen ahí para repetir cualquiera a mano.
    await expect(page.getByRole('button', { name: 'Inicio', exact: true })).toBeVisible()
    await expect.poll(async () => (await estadoGuardado(page))?.tutorialsDisabled).toBe(true)

    const guardado = await estadoGuardado(page)
    expect(guardado?.recorridos).toEqual(expect.arrayContaining(TODOS))

    /*
      Un recorrido pendiente que no está en la lista —como los que se añadirán en
      una versión futura— tampoco sale: la decisión es global. Y el aviso, que
      tampoco se descartó, se calla por el mismo interruptor.
    */
    await sembrarEstado(page, {
      recorridos: [],
      vistos: [],
      tutorialsDisabled: true,
    })
    await page.goto(`${BASE}/search`)
    await page.waitForTimeout(2500)
    await expect(page.locator(POPOVER)).toHaveCount(0)
    await expect(page.locator('.driver-hint')).toHaveCount(0)
  })

  test('el interruptor de Ajustes apaga y enciende los tutoriales', async ({ page }) => {
    await page.goto(`${BASE}/settings`)
    await sembrarEstado(page, { recorridos: TODOS, vistos: TODOS_LOS_AVISOS })
    await page.reload()

    const mostrar = page.getByRole('button', { name: 'Mostrar tutoriales' })
    const ocultar = page.getByRole('button', { name: 'Ocultar tutoriales' })

    await expect(mostrar).toHaveAttribute('aria-pressed', 'true')
    await ocultar.click()
    await expect(ocultar).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await estadoGuardado(page))?.tutorialsDisabled).toBe(true)

    // Con un recorrido pendiente —Buscar— y los tutoriales ocultos, no sale.
    await sembrarEstado(page, {
      recorridos: [],
      vistos: TODOS_LOS_AVISOS,
      tutorialsDisabled: true,
    })
    await page.goto(`${BASE}/search`)
    await page.waitForTimeout(2000)
    await expect(page.locator(POPOVER)).toHaveCount(0)

    // Encenderlo desde Ajustes vuelve a dejar salir los pendientes.
    await page.goto(`${BASE}/settings`)
    await expect(mostrar).toHaveAttribute('aria-pressed', 'false')
    await mostrar.click()
    await expect(mostrar).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await estadoGuardado(page))?.tutorialsDisabled).toBe(false)

    await page.goto(`${BASE}/search`)
    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(POPOVER)).toContainText('1 de 3')
  })

  test('«Reiniciar tutoriales» los devuelve todos y deja los avisos como estaban', async ({
    page,
  }) => {
    await page.goto(`${BASE}/settings`)
    await sembrarEstado(page, {
      recorridos: TODOS,
      vistos: TODOS_LOS_AVISOS,
      tutorialsDisabled: true,
    })
    await page.reload()

    await page.getByRole('button', { name: 'Reiniciar tutoriales' }).click()

    await expect.poll(async () => (await estadoGuardado(page))?.tutorialsDisabled).toBe(false)
    expect((await estadoGuardado(page))?.recorridos).toEqual([])

    // Buscar vuelve a estrenar su recorrido, como en la primera visita...
    await page.goto(`${BASE}/search`)
    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(POPOVER)).toContainText('1 de 3')

    // ...y el aviso descartado sigue descartado: su botón es otro. Se espera a
    // que el faro habría tenido tiempo de latir —sale 1500 ms después de montar—
    // para que la prueba no pase por llegar antes que el defecto.
    await page.waitForTimeout(2000)
    await expect(page.locator('.driver-hint')).toHaveCount(0)
  })
})
