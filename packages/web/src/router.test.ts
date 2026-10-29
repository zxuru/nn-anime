import { describe, expect, test } from 'bun:test'
import { buildPath, createMemoryHistory, matchRoute } from './router'

describe('matchRoute', () => {
  test('reconoce la raíz', () => {
    expect(matchRoute('/')).toEqual({ name: 'home', params: {} })
  })

  test('reconoce la búsqueda', () => {
    expect(matchRoute('/search')).toEqual({ name: 'search', params: {} })
  })

  test('reconoce los ajustes', () => {
    expect(matchRoute('/settings')).toEqual({ name: 'settings', params: {} })
  })

  test('reconoce el perfil y su historial', () => {
    expect(matchRoute('/profile')).toEqual({ name: 'profile', params: {} })
    // El historial pagina por consulta, y la consulta no cambia de pantalla.
    expect(matchRoute('/history?page=3')).toEqual({ name: 'history', params: {} })
  })

  test('extrae los parámetros del detalle', () => {
    expect(matchRoute('/anime/fuente-ejemplo/titulo-1')).toEqual({
      name: 'detail',
      params: { providerId: 'fuente-ejemplo', ref: 'titulo-1' },
    })
  })

  test('extrae los parámetros del reproductor', () => {
    expect(matchRoute('/watch/fuente-ejemplo/titulo-1')).toEqual({
      name: 'watch',
      params: { providerId: 'fuente-ejemplo', ref: 'titulo-1' },
    })
  })

  test('reconoce la biblioteca, su reproductor y la dirección vieja', () => {
    expect(matchRoute('/library')).toEqual({ name: 'library', params: {} })
    expect(matchRoute('/library/7')).toEqual({ name: 'library-player', params: { id: '7' } })
    // El alias conserva los marcadores de la versión anterior.
    expect(matchRoute('/downloads')).toEqual({ name: 'downloads', params: {} })
  })

  test('descodifica los parámetros con caracteres escapados', () => {
    const match = matchRoute('/anime/fuente/titulo%20con%20espacios')

    expect(match.params.ref).toBe('titulo con espacios')
  })

  test('ignora la barra final', () => {
    expect(matchRoute('/search/')).toEqual({ name: 'search', params: {} })
  })

  test('ignora la cadena de consulta', () => {
    expect(matchRoute('/search?q=naruto')).toEqual({ name: 'search', params: {} })
  })

  test('una ruta desconocida no es un error, es not-found', () => {
    expect(matchRoute('/no-existe')).toEqual({ name: 'not-found', params: {} })
  })

  test('una ruta con la forma correcta pero sin parámetro no empareja', () => {
    expect(matchRoute('/anime/solo-uno')).toEqual({ name: 'not-found', params: {} })
  })

  test('una ruta vacía es la raíz', () => {
    expect(matchRoute('')).toEqual({ name: 'home', params: {} })
  })
})

describe('buildPath', () => {
  test('la raíz no lleva segmentos', () => {
    expect(buildPath('home')).toBe('/')
  })

  test('construye una ruta fija', () => {
    expect(buildPath('settings')).toBe('/settings')
  })

  test('construye las dos rutas del usuario: el perfil y su historial', () => {
    expect(buildPath('profile')).toBe('/profile')
    expect(buildPath('history')).toBe('/history')
  })

  test('construye la biblioteca y el reproductor de una descarga', () => {
    expect(buildPath('library')).toBe('/library')
    expect(buildPath('library-player', { id: '7' })).toBe('/library/7')
  })

  test('construye una ruta con parámetros', () => {
    expect(buildPath('detail', { providerId: 'fuente', ref: 'titulo-1' })).toBe(
      '/anime/fuente/titulo-1',
    )
  })

  test('codifica los parámetros', () => {
    expect(buildPath('detail', { providerId: 'fuente', ref: 'titulo con espacios' })).toBe(
      '/anime/fuente/titulo%20con%20espacios',
    )
  })

  test('ida y vuelta: construir y emparejar devuelve lo mismo', () => {
    const path = buildPath('watch', { providerId: 'fuente', ref: 'a/b' })
    const match = matchRoute(path)

    expect(match.name).toBe('watch')
    expect(match.params).toEqual({ providerId: 'fuente', ref: 'a/b' })
  })

  test('un nombre desconocido cae a la raíz', () => {
    expect(buildPath('not-found')).toBe('/')
  })
})

describe('createMemoryHistory', () => {
  test('empieza en la ruta indicada', () => {
    expect(createMemoryHistory('/search').path).toBe('/search')
  })

  test('push cambia la ruta', () => {
    const history = createMemoryHistory()

    history.push('/search')

    expect(history.path).toBe('/search')
  })

  test('replace cambia la ruta', () => {
    const history = createMemoryHistory()

    history.replace('/settings')

    expect(history.path).toBe('/settings')
  })

  test('avisa a quien está suscrito', () => {
    const history = createMemoryHistory()
    let notifications = 0
    history.subscribe(() => {
      notifications += 1
    })

    history.push('/search')

    expect(notifications).toBe(1)
  })

  test('el desregistro deja de avisar', () => {
    const history = createMemoryHistory()
    let notifications = 0
    const unsubscribe = history.subscribe(() => {
      notifications += 1
    })

    unsubscribe()
    history.push('/search')

    expect(notifications).toBe(0)
  })

  test('avisa a todos los suscritos', () => {
    const history = createMemoryHistory()
    let total = 0
    history.subscribe(() => {
      total += 1
    })
    history.subscribe(() => {
      total += 1
    })

    history.push('/search')

    expect(total).toBe(2)
  })
})
