// Plugin de prueba: usa el mismo id que `bueno.ts`. En orden alfabético éste va
// después, así que pierde: gana el primero, y el conflicto se reporta.
const duplicado = {
  id: 'bueno',
  name: 'Duplicado de bueno',
  apiVersion: '1',
  capabilities: { search: false, sub: true, dub: false, trending: false },
  async search() {
    return []
  },
  async getAnime() {
    return { ref: { providerId: 'bueno', value: 'otro' }, title: 'Otro', genres: [], studios: [] }
  },
  async getEpisodes() {
    return []
  },
  async resolveStream() {
    return []
  },
}

export default duplicado
