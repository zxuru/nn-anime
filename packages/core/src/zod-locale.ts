/**
 * Los mensajes de Zod, en el idioma de la aplicación.
 *
 * Zod 4 trae catálogos de idioma. Sin esto, un `config.json` con un tipo
 * cambiado enseñaba «Invalid input: expected number, received string» en un CLI
 * que habla español. Es configuración global del proceso: se carga una sola vez
 * y vale para todos los schemas, también para los que se crean después.
 */

import { z } from 'zod'

z.config(z.locales.es())
