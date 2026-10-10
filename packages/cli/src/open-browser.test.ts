import { describe, expect, test } from 'bun:test'
import { browserCommand, openInBrowser } from './open-browser'

const URL = 'http://127.0.0.1:7717/?boot=secreto'

interface SpawnSpy {
  readonly calls: (readonly string[])[]
  readonly spawn: (argv: readonly string[]) => { readonly exited: Promise<number> }
}

function spy(exitCode = 0, throws = false): SpawnSpy {
  const calls: (readonly string[])[] = []

  return {
    calls,
    spawn: (argv) => {
      calls.push(argv)
      if (throws) throw new Error('no existe el comando')
      return { exited: Promise.resolve(exitCode) }
    },
  }
}

describe('browserCommand', () => {
  test('en Linux usa xdg-open', () => {
    expect(browserCommand('linux')).toEqual(['xdg-open'])
  })

  test('en macOS usa open', () => {
    expect(browserCommand('darwin')).toEqual(['open'])
  })

  test('en Windows usa cmd con start', () => {
    expect(browserCommand('win32')).toEqual(['cmd', '/c', 'start', ''])
  })

  test('ante una plataforma desconocida cae a xdg-open', () => {
    expect(browserCommand('freebsd')).toEqual(['xdg-open'])
  })
})

describe('openInBrowser', () => {
  test('pasa la dirección al comando', async () => {
    const target = spy()

    await openInBrowser(URL, { spawn: target.spawn, platform: 'linux' })

    expect(target.calls).toEqual([['xdg-open', URL]])
  })

  test('devuelve verdadero cuando el comando sale con 0', async () => {
    expect(await openInBrowser(URL, { spawn: spy(0).spawn, platform: 'linux' })).toBe(true)
  })

  test('devuelve falso cuando el comando sale con otro código', async () => {
    expect(await openInBrowser(URL, { spawn: spy(4).spawn, platform: 'linux' })).toBe(false)
  })

  test('devuelve falso cuando el comando no se puede lanzar', async () => {
    expect(await openInBrowser(URL, { spawn: spy(0, true).spawn, platform: 'linux' })).toBe(false)
  })

  test('no lanza nunca: abrir el navegador es una comodidad', async () => {
    await expect(
      openInBrowser(URL, { spawn: spy(0, true).spawn, platform: 'linux' }),
    ).resolves.toBe(false)
  })

  test('en macOS lanza open con la dirección', async () => {
    const target = spy()

    await openInBrowser(URL, { spawn: target.spawn, platform: 'darwin' })

    expect(target.calls).toEqual([['open', URL]])
  })

  test('en Windows la dirección va después del título vacío', async () => {
    const target = spy()

    await openInBrowser(URL, { spawn: target.spawn, platform: 'win32' })

    expect(target.calls).toEqual([['cmd', '/c', 'start', '', URL]])
  })
})
