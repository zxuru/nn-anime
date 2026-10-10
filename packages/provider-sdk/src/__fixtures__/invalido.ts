// Plugin de prueba: declara otra versión del contrato y le falta un método.
const invalido = {
  id: 'invalido',
  name: 'Inválido',
  apiVersion: '2',
  capabilities: { search: true, sub: true, dub: false, trending: false },
  async search() {
    return []
  },
  async getAnime() {
    return { ref: { providerId: 'invalido', value: 'a' }, title: 'A', genres: [], studios: [] }
  },
}

export default invalido
