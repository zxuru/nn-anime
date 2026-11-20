/**
 * Techo por caso de las suites que abren una SQLite nueva por prueba.
 *
 * Bun corta cada caso a los 5 s por defecto. Los `conApp` de este directorio
 * crean un directorio temporal, abren la base y aplican las 23 migraciones,
 * cada una en su propia transacción (`catalog-store/migrations/runner.ts`): son
 * 23 `fsync` por caso y cientos por tanda. En Linux entra de sobra; en Windows,
 * con 16 ficheros en paralelo y otra sesión escribiendo en el mismo disco —o
 * Defender escaneando los `.db` recién creados—, un caso puede quedarse
 * esperando E/S más de los 5 s del techo.
 *
 * 20 s es cuatro veces el techo por defecto: absorbe el pico sin tapar un
 * cuelgue, que sigue fallando. No es un reintento: el caso corre una vez.
 */
export const TIEMPO_DE_PRUEBA_MS = 20_000
