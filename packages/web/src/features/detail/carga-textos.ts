/**
 * Los textos de la carga de la ficha.
 *
 * Van aquí y no en `DetailPage` para que la pantalla no tenga cadenas sueltas,
 * como el resto de la interfaz. El catálogo tiene una prueba que falla si una
 * clave queda sin usar, así que cada una de estas la usa alguien.
 */
export const CARGA = {
  /** Sólo para lectores de pantalla: el estado de la carga. */
  status: 'detail.loading',
  /** El aviso de que el proveedor tarda. */
  slow: 'detail.slow',
  /** La tarjeta de error genérica. */
  errorTitle: 'detail.error.title',
  errorBody: 'detail.error.body',
  provider: 'detail.error.provider',
  retry: 'error.retry',
  back: 'detail.error.back',
  /** El 404: mensaje distinto y sin reintento. */
  notFoundTitle: 'detail.notFound.title',
} as const
