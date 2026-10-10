// Plugin de prueba: el caso que tiene que funcionar. Sin dependencias, para que
// el fixture no arrastre nada del proyecto.
const bueno = {
  id: 'bueno',
  name: 'Proveedor bueno',
  apiVersion: '1',
  capabilities: { search: true, sub: true, dub: false, trending: false },
  async search() {
    return []
  },
  async getAnime() {
    return { ref: { providerId: 'bueno', value: 'uno' }, title: 'Uno', genres: [], studios: [] }
  },
  async getEpisodes() {
    return []
  },
  async resolveStream() {
    return []
  },
}

export default bueno
