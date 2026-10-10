// Plugin de prueba: agrupa dos proveedores en un solo archivo, con el export
// `providers` que el contrato acepta.
function make(id: string, name: string) {
  return {
    id,
    name,
    apiVersion: '1',
    capabilities: { search: true, sub: true, dub: true, trending: false },
    async search() {
      return []
    },
    async getAnime() {
      return { ref: { providerId: id, value: `${id}-1` }, title: name, genres: [], studios: [] }
    },
    async getEpisodes() {
      return []
    },
    async resolveStream() {
      return []
    },
  }
}

export const providers = [make('agrupado-uno', 'Uno'), make('agrupado-dos', 'Dos')]
