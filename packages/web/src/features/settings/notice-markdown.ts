/**
 * El aviso de seguridad, convertido en bloques.
 *
 * `SECURITY.md` es la fuente única: el documento que lee quien revisa el repo es
 * el mismo que enseña la aplicación. Para eso hay que entender el markdown que
 * ese documento usa, y nada más: títulos, párrafos, listas, tablas, negrita y
 * código en línea.
 *
 * Es un intérprete pequeño y con límites declarados, no un markdown completo:
 * no hay bloques de código, ni citas, ni anidamiento. Un documento más rico
 * pediría una dependencia, y eso pasa por el límite «Ask first» del spec. Aquí
 * se lee el documento que existe, y una prueba comprueba que el documento real
 * se convierte entero.
 *
 * Todo esto es una función pura: entra texto, salen datos. Es lo que permite
 * probarlo sin navegador y sin montar el componente.
 */

export type Inline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'strong'; readonly value: string }
  | { readonly kind: 'code'; readonly value: string }

export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly spans: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly spans: readonly Inline[] }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      readonly items: readonly (readonly Inline[])[]
    }
  | {
      readonly kind: 'table'
      readonly head: readonly (readonly Inline[])[]
      readonly rows: readonly (readonly (readonly Inline[])[])[]
    }

/** Negrita y código en línea. Es lo único con marca dentro de una línea. */
const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`/g

const HEADING = /^(#{1,3})\s+(.*)$/
const ORDERED = /^\d+\.\s+(.*)$/
const BULLET = /^-\s+(.*)$/
const SEPARATOR = /^\|[\s:|-]+\|$/
const CONTINUATION = /^\s{2,}\S/

/** Una línea con marca, troceada en tramos. */
export function inline(text: string): readonly Inline[] {
  const spans: Inline[] = []
  let cursor = 0

  for (const match of text.matchAll(INLINE)) {
    const at = match.index
    if (at > cursor) spans.push({ kind: 'text', value: text.slice(cursor, at) })

    const [raw = '', strong, code] = match
    if (strong !== undefined) spans.push({ kind: 'strong', value: strong })
    else if (code !== undefined) spans.push({ kind: 'code', value: code })

    cursor = at + raw.length
  }

  if (cursor < text.length) spans.push({ kind: 'text', value: text.slice(cursor) })

  return spans
}

/** Las celdas de una fila de tabla, sin las barras de los extremos. */
export function cells(line: string): readonly (readonly Inline[])[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')

  return body.split('|').map((cell) => inline(cell.trim()))
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? ''
  const next = lines[index + 1]

  return line.trimStart().startsWith('|') && next !== undefined && SEPARATOR.test(next.trim())
}

/** Une las líneas de continuación de un elemento de lista. */
function listItem(lines: readonly string[], index: number, first: string): [string, number] {
  const partes = [first]
  let cursor = index + 1

  while (cursor < lines.length && CONTINUATION.test(lines[cursor] ?? '')) {
    partes.push((lines[cursor] ?? '').trim())
    cursor += 1
  }

  return [partes.join(' '), cursor]
}

/**
 * El documento entero, en bloques.
 *
 * Un párrafo son sus líneas unidas con espacio: el documento está partido a mano
 * a 100 columnas y esas particiones no son parte del texto.
 */
export function parseNotice(markdown: string): readonly Block[] {
  const lines = markdown.split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.trim() === '') {
      index += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        spans: inline((heading[2] ?? '').trim()),
      })
      index += 1
      continue
    }

    if (isTableStart(lines, index)) {
      const head = cells(line)
      const rows: (readonly (readonly Inline[])[])[] = []
      index += 2

      while (index < lines.length && (lines[index] ?? '').trimStart().startsWith('|')) {
        rows.push(cells(lines[index] ?? ''))
        index += 1
      }

      blocks.push({ kind: 'table', head, rows })
      continue
    }

    const ordered = ORDERED.exec(line)
    const bullet = ordered === null ? BULLET.exec(line) : null
    if (ordered !== null || bullet !== null) {
      const items: (readonly Inline[])[] = []

      while (index < lines.length) {
        const current = lines[index] ?? ''
        const match = ordered !== null ? ORDERED.exec(current) : BULLET.exec(current)
        if (match === null) break

        const [text, next] = listItem(lines, index, (match[1] ?? '').trim())
        items.push(inline(text))
        index = next
      }

      blocks.push({ kind: 'list', ordered: ordered !== null, items })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      const startsBlock =
        current.trim() === '' ||
        HEADING.test(current) ||
        ORDERED.test(current) ||
        BULLET.test(current) ||
        isTableStart(lines, index)

      if (startsBlock) break

      paragraph.push(current.trim())
      index += 1
    }

    blocks.push({ kind: 'paragraph', spans: inline(paragraph.join(' ')) })
  }

  return blocks
}
