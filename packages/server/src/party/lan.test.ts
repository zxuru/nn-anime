import { describe, expect, test } from 'bun:test'
import { lanUrls } from './lan'

function interfaz(campos: Partial<Parameters<typeof lanUrls>[1]>): Parameters<typeof lanUrls>[1] {
  return campos
}

describe('lanUrls', () => {
  test('enumera las IPv4 externas y descarta loopback e IPv6', () => {
    const urls = lanUrls(7717, {
      eth0: [
        { address: '192.168.1.10', family: 'IPv4', internal: false } as never,
        { address: '127.0.0.1', family: 'IPv4', internal: true } as never,
        { address: 'fe80::1', family: 'IPv6', internal: false } as never,
      ],
    })

    expect(urls).toEqual(['http://192.168.1.10:7717'])
  })

  test('no repite direcciones', () => {
    const urls = lanUrls(7717, {
      eth0: [{ address: '10.0.0.5', family: 'IPv4', internal: false } as never],
      wlan0: [{ address: '10.0.0.5', family: 'IPv4', internal: false } as never],
    })

    expect(urls).toEqual(['http://10.0.0.5:7717'])
  })

  test('sin interfaces útiles cae a loopback, que es lo que siempre funciona', () => {
    expect(lanUrls(7717, {})).toEqual(['http://127.0.0.1:7717'])
  })

  test('una interfaz sin lista no rompe', () => {
    expect(lanUrls(7717, interfaz({ eth0: undefined }))).toEqual(['http://127.0.0.1:7717'])
  })
})
