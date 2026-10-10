// Plugin de prueba con mala idea: exporta las dos formas a la vez. No hay forma
// de saber cuál es la buena, así que se rechaza nombrando el archivo.
const uno = {
  id: 'ambos',
  name: 'Ambos',
  apiVersion: '1',
  capabilities: { search: true, sub: true, dub: false, trending: false },
  async search() {
    return []
  },
  async getAnime() {
    return { ref: { providerId: 'ambos', value: 'a' }, title: 'A', genres: [], studios: [] }
  },
  async getEpisodes() {
    return []
  },
  async resolveStream() {
    return []
  },
}

export default uno
export const providers = [uno]
