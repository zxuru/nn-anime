/**
 * Direcciones con las que un invitado puede llegar a esta instancia.
 *
 * Una sala vive en el servidor de una persona; el invitado necesita escribir a
 * mano la dirección de ese servidor. Se enumeran las IPv4 no internas porque
 * `0.0.0.0` no es una dirección a la que ir, y un nombre mDNS puede no
 * resolverse desde otra red. Sin interfaces útiles queda el loopback, que sirve
 * para probar en la misma máquina y para decir la verdad en la interfaz.
 */

import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os'

export type Interfaces = Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>

export function lanUrls(port: number, interfaces: Interfaces = networkInterfaces()): string[] {
  const urls: string[] = []

  for (const lista of Object.values(interfaces)) {
    for (const info of lista ?? []) {
      if (info.internal) continue
      if (info.family !== 'IPv4') continue

      const url = `http://${info.address}:${port}`
      if (!urls.includes(url)) urls.push(url)
    }
  }

  return urls.length > 0 ? urls : [`http://127.0.0.1:${port}`]
}
