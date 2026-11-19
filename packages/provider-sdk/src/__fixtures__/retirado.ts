// Plugin de prueba: un manifiesto anterior a T372, con el eje retirado.
// Tiene que cargar —romper el arranque de un plugin instalado está prohibido—,
// emitir un aviso y no filtrar por esos campos.
const retirado = {
  id: 'retirado',
  name: 'Proveedor con familias retiradas',
  apiVersion: '1',
  capabilities: {
    search: true,
    sub: true,
    dub: false,
    trending: false,
    families: ['live'],
    media: 'movies',
  },
  async search() {
    return []
  },
  async getAnime() {
    return { ref: { providerId: 'retirado', value: 'uno' }, title: 'Uno', genres: [], studios: [] }
  },
  async getEpisodes() {
    return []
  },
  async resolveStream() {
    return []
  },
}

export default retirado
