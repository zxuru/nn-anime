import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { type AppOptions, createApp } from './app'
import { SESSION_COOKIE, type Session } from './session'
import { confine } from './static-assets'

const PORT = 7717
const BASE = `http://127.0.0.1:${PORT}`
const BOOT_TOKEN = 'token-de-prueba'

function fakeSession(): Session {
  return {
    cookieName: SESSION_COOKIE,
    value: 'sesion',
    matches: (candidate) => candidate === 'sesion',
  }
}

function appWithAssets(webRoot: string): Hono {
  const options: AppOptions = {
    port: PORT,
    session: fakeSession(),
    bootToken: BOOT_TOKEN,
    version: '0.1.0',
    webRoot,
  }
  return createApp(options)
}

async function withAssets<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'nn-anime-web-'))

  try {
    await writeFile(join(root, 'index.html'), '<!doctype html><div id="root"></div>')
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)')
    await writeFile(join(root, 'assets', 'app.css'), 'body{}')
    return await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('confine', () => {
  test('deja pasar una ruta relativa normal', () => {
    expect(confine('/srv/web', '/assets/app.js')).toBe('/srv/web/assets/app.js')
  })

  test('la raíz se resuelve al propio directorio', () => {
    expect(confine('/srv/web', '/')).toBe('/srv/web')
  })

  test('bloquea el ascenso con puntos suspensivos', () => {
    expect(confine('/srv/web', '/../../etc/passwd')).toBeUndefined()
  })

  test('bloquea el ascenso escondido en medio', () => {
    expect(confine('/srv/web', '/assets/../../secretos')).toBeUndefined()
  })

  test('no se deja engañar por un prefijo parecido', () => {
    expect(confine('/srv/web', '/../web-otro/x')).toBeUndefined()
  })

  test('una ruta con punto normal no se bloquea', () => {
    expect(confine('/srv/web', '/assets/./app.js')).toBe('/srv/web/assets/app.js')
  })
})

describe('servido de la interfaz', () => {
  test('sirve el index en la raíz', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/`)

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('id="root"')
      expect(response.headers.get('content-type')).toContain('text/html')
    })
  })

  test('sirve una ruta del enrutador con el index, porque el enrutado es del cliente', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/anime/fuente/titulo-1`)

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('id="root"')
    })
  })

  test('sirve un recurso con su tipo de contenido', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/assets/app.js`)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/javascript')
    })
  })

  test('sirve el CSS con su tipo de contenido', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/assets/app.css`)

      expect(response.headers.get('content-type')).toContain('text/css')
    })
  })

  test('no cachea el HTML, que es el que cambia entre versiones', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/`)

      expect(response.headers.get('cache-control')).toBe('no-store')
    })
  })

  test('cachea los recursos, que llevan hash en el nombre', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/assets/app.js`)

      expect(response.headers.get('cache-control')).toContain('immutable')
    })
  })

  test('el ascenso con puntos suspensivos no sirve nada de fuera de la raíz', async () => {
    await withAssets(async (root) => {
      // Da igual si llega escapado o no: el analizador de URL colapsa los `..`
      // antes de que los veamos, y `confine` los rechaza si sobrevivieran. Lo
      // que se comprueba es la propiedad que importa: el contenido de fuera de
      // la raíz no sale nunca.
      for (const path of ['/%2e%2e/%2e%2e/etc/passwd', '/../../etc/passwd']) {
        const response = await appWithAssets(root).request(`${BASE}${path}`)

        expect(await response.text(), path).not.toContain('root:')
      }
    })
  })

  test('una secuencia de escape inválida no rompe el servidor', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/%zz`)

      expect(response.status).toBe(404)
    })
  })

  test('un enlace simbólico que apunta fuera no se sirve', async () => {
    await withAssets(async (root) => {
      await writeFile(join(root, '..', 'secreto-nn-anime.txt'), 'no deberías verme')
      await symlink(join(root, '..', 'secreto-nn-anime.txt'), join(root, 'enlace.txt'))

      const response = await appWithAssets(root).request(`${BASE}/enlace.txt`)

      // La ruta está confinada, pero el contenido del enlace no es un fichero
      // del build: se sirve el index, no el secreto.
      const body = await response.text()
      expect(body).not.toContain('no deberías verme')

      await rm(join(root, '..', 'secreto-nn-anime.txt'), { force: true })
    })
  })

  test('sin build en disco, deja pasar al resto de la aplicación', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nn-anime-vacio-'))

    try {
      const response = await appWithAssets(root).request(`${BASE}/no-existe`)

      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('id="root"')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('no intercepta la API cuando no hay sesión', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/api/health`)

      expect(response.status).toBe(401)
    })
  })

  test('no intercepta la API ni siquiera con sesión válida', async () => {
    await withAssets(async (root) => {
      // Éste es el caso que importa: el guard deja pasar, y sin la salida
      // explícita el servido de estáticos devolvería el `index.html`, porque el
      // archivo `/api/health` no existe. El cliente recibiría HTML donde espera
      // JSON, y el test de «sin sesión» no lo detectaba.
      const response = await appWithAssets(root).request(`${BASE}/api/health`, {
        headers: { cookie: `${SESSION_COOKIE}=sesion` },
      })

      const body = await response.text()
      expect(response.status).toBe(200)
      expect(body).toContain('"version"')
      expect(body).not.toContain('id="root"')
    })
  })

  test('no intercepta el proxy de video con sesión válida', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/stream/abc`, {
        headers: { cookie: `${SESSION_COOKIE}=sesion` },
      })

      expect(await response.text()).not.toContain('id="root"')
    })
  })

  test('la interfaz servida lleva las cabeceras de seguridad', async () => {
    await withAssets(async (root) => {
      const response = await appWithAssets(root).request(`${BASE}/`)

      expect(response.headers.get('content-security-policy')).toBeString()
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    })
  })
})
