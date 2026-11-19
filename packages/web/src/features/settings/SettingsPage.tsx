/**
 * Página de ajustes.
 *
 * Existe para que el usuario pueda ver qué está pasando: qué proveedores hay y
 * cuáles se rechazaron, dónde vive cada cosa y si hay reproductor externo. Sin
 * esta página, un plugin roto es un misterio y una ruta de datos es un dato que
 * nadie encuentra.
 *
 * La página está partida en nueve secciones y un índice las recorre. Antes era una
 * lista plana: para llegar al tema había que pasar por proveedores, repositorios,
 * alta, TMDB, rutas, mpv y saltos. Las secciones y sus nombres viven en
 * `secciones.ts`; el índice y los `id` salen de la misma lista, así que un enlace
 * no puede quedar apuntando a una sección que ya no existe.
 *
 * El aviso de seguridad no es decorativo y va **en la página**, no sólo en el
 * documento: un plugin se ejecuta sin sandbox con los permisos del usuario, y eso
 * hay que decirlo donde se instalan plugins, no a un clic de distancia. El
 * documento entero se abre en un diálogo, servido desde el propio `SECURITY.md`:
 * una sola fuente para lo que se lee en el repo y lo que se lee en la pantalla.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { ExternalLink, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { FALLO_SIN_CAUSA } from '../../api/fallo'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Skeleton } from '../../components/Skeleton'
import { t } from '../../i18n'
import { ANCLAS } from '../guia/guia'
import { SeccionGuia } from '../guia/SeccionGuia'
import { guardarExtendido, leerExtendido } from '../player/extendido'
import { almacenLocal } from '../player/storage'
import { AvisosSettings } from './AvisosSettings'
import { DownloadsSettings } from './DownloadsSettings'
import { IndiceAjustes, useSeccionActiva } from './IndiceAjustes'
import { ProfileSettings } from './ProfileSettings'
import { ProviderList } from './ProviderList'
import { ProviderRepos } from './ProviderRepos'
import { QualitySettings } from './QualitySettings'
import { RegisterProvider } from './RegisterProvider'
import { SecurityNoticeDialog } from './SecurityNotice'
import { SkipSettings } from './SkipSettings'
import { SECCIONES, SECCIONES_AJUSTES } from './secciones'
import { ThemeToggle } from './ThemeToggle'
import { useProviderRepos } from './useProviderRepos'
import { useSecurityNotice } from './useSecurityNotice'
import { useSettings } from './useSettings'

export function SettingsPage(): ReactNode {
  const {
    state,
    data,
    error,
    setTheme,
    setProviderPriority,
    setAdultContent,
    setDiscordPresence,
    register,
    refresh,
  } = useSettings()
  const repos = useProviderRepos(refresh)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const notice = useSecurityNotice(noticeOpen)
  // La sección que se está leyendo. Sin observador se queda sin marcar; el índice
  // sigue navegando igual. Sólo hay secciones que observar cuando los datos están.
  const activa = useSeccionActiva(data !== undefined)

  /**
   * El ancla de la dirección.
   *
   * El primer arranque enlaza a `/settings#fuentes` para no dejar al usuario
   * buscando la sección entre nueve. La navegación de la aplicación empuja la
   * dirección sin recargar, así que el navegador no salta solo: se hace aquí,
   * cuando los datos ya pintaron las secciones —antes no existen—. Se aplica una
   * sola vez: los ajustes se vuelven a leer al cambiar el tema o la lista de
   * proveedores, y volver a saltar a la sección en cada cambio sería pelear con
   * quien está leyendo. Los enlaces del índice, que son `#seccion` sobre esta
   * misma página, los sigue resolviendo el navegador.
   */
  const anclaAplicada = useRef(false)

  useEffect(() => {
    if (data === undefined || anclaAplicada.current) return

    const ancla = window.location.hash.replace(/^#/, '')
    if (ancla === '') return

    anclaAplicada.current = true
    document.getElementById(ancla)?.scrollIntoView({ block: 'start' })
  }, [data])

  /**
   * El modo extendido, que es preferencia del navegador y no del servidor.
   *
   * Como la reproducción automática: no viaja a ninguna parte y el reproductor
   * la lee al montarse. Aquí sólo se deja escrita para la próxima vez; la
   * pantalla de reproducción ya abierta no cambia por tocar esto.
   */
  const [extendido, setExtendido] = useState(() => leerExtendido(almacenLocal()))
  const preferirExtendido = (valor: boolean): void => {
    setExtendido(valor)
    guardarExtendido(almacenLocal(), valor)
  }

  const aviso = (
    <SecurityNoticeDialog
      open={noticeOpen}
      onClose={() => setNoticeOpen(false)}
      markdown={notice.markdown}
      error={notice.error}
    />
  )

  if (state === 'loading') {
    /*
     * La espera con la forma de la página.
     *
     * Antes eran el titular y «Cargando los ajustes…» sobre una página que luego
     * enseña el aviso de seguridad, un índice pegajoso y las secciones de campos:
     * el contenido entraba de golpe y el índice aparecía de la nada. El aviso y los
     * titulares de sección se saben sin preguntar, así que se pintan de verdad; lo
     * que se adelanta con esqueletos es el hueco de los campos.
     */
    return (
      <section className="pagina settings" aria-busy="true">
        <p className="solo-lectores" role="status">
          {t(DEFAULT_LOCALE, 'settings.loading')}
        </p>
        <h1>{t(DEFAULT_LOCALE, 'settings.title')}</h1>

        <aside className="settings__warning">
          <h2 className="settings__warning-title">
            {t(DEFAULT_LOCALE, 'settings.security.title')}
          </h2>
          <p>{t(DEFAULT_LOCALE, 'settings.security.body')}</p>
          <p>
            <Skeleton h="var(--renglon)" w="38%" />
          </p>
        </aside>

        <div className="settings__cuerpo">
          <div className="settings__indice" aria-hidden="true">
            <p className="settings__indice-titulo">{t(DEFAULT_LOCALE, 'settings.index.title')}</p>
            <Skeleton h="var(--text-xs)" w="55%" />
            {SECCIONES_AJUSTES.map((seccion) => (
              <Skeleton key={seccion.id} h="var(--control-size)" w="100%" />
            ))}
          </div>

          <div className="settings__secciones" aria-hidden="true">
            {SECCIONES_AJUSTES.map((seccion) => (
              <section className="settings__seccion" key={seccion.id}>
                <h2>{t(DEFAULT_LOCALE, seccion.titulo)}</h2>
                <Skeleton h="var(--text-xs)" w="22%" />
                <Skeleton h="var(--header-height)" />
                <Skeleton h="var(--header-height)" w="86%" />
              </section>
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (state === 'error' || data === undefined) {
    return (
      <section className="pagina settings">
        <h1>{t(DEFAULT_LOCALE, 'settings.title')}</h1>
        <ErrorNotice fallo={error ?? FALLO_SIN_CAUSA} />
      </section>
    )
  }

  return (
    <section className="pagina settings">
      <h1>{t(DEFAULT_LOCALE, 'settings.title')}</h1>

      {/* El aviso va primero a propósito: es lo que hay que leer antes de copiar
          un plugin, no después. */}
      <aside className="settings__warning">
        <h2 className="settings__warning-title">
          <TriangleAlert size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
          {t(DEFAULT_LOCALE, 'settings.security.title')}
        </h2>
        <p>{t(DEFAULT_LOCALE, 'settings.security.body')}</p>
        <p>
          <button
            type="button"
            className="settings__link settings__link--icono"
            aria-haspopup="dialog"
            onClick={() => setNoticeOpen(true)}
          >
            {t(DEFAULT_LOCALE, 'settings.security.open')}
            <ExternalLink size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
          </button>
        </p>
      </aside>

      {aviso}

      {data.locked ? (
        <aside className="settings__warning">
          <h2>{t(DEFAULT_LOCALE, 'settings.locked.title')}</h2>
          <p>{t(DEFAULT_LOCALE, 'settings.locked.body')}</p>
        </aside>
      ) : null}

      <div className="settings__cuerpo">
        <IndiceAjustes activa={activa} />

        <div className="settings__secciones">
          {/*
            Fuentes: lo que hace que haya algo que ver. Los proveedores van primero
            porque son la lista de la que todo depende; los repositorios y el alta
            son otras dos formas de llenarla, y TMDB es el respaldo de los
            metadatos que ellos no publican.
          */}
          <section
            className="settings__seccion"
            id={SECCIONES.fuentes.id}
            aria-labelledby={`${SECCIONES.fuentes.id}-titulo`}
          >
            <h2 id={`${SECCIONES.fuentes.id}-titulo`}>
              {t(DEFAULT_LOCALE, SECCIONES.fuentes.titulo)}
            </h2>

            <section data-tour={ANCLAS.ajustesProveedores}>
              <h3>{t(DEFAULT_LOCALE, 'settings.providers')}</h3>
              <ProviderList
                providers={data.providers}
                priority={data.providerPriority}
                onReorder={setProviderPriority}
              />
            </section>

            {/* Los repositorios van justo debajo de la lista de proveedores: es otra
                forma de llenarla, y la lista de arriba es donde se ve el resultado.
                En modo restringido no se ofrecen: escribir un plugin o marcar un
                archivo es ejecutar código, y la API tampoco registra esas rutas. */}
            {data.locked ? null : <ProviderRepos {...repos} />}

            {/*
              El alta manual va después de la lista y del repositorio, y
              **plegada**: son quince campos y el camino recomendado es añadir un
              repositorio, no rellenarlos. El `<details>` no esconde la función
              —el resumen dice lo que hay dentro—, sólo deja de darle el mismo
              peso que al camino que funciona en dos pasos.
            */}
            {data.locked ? null : (
              <details className="settings__advanced">
                <summary>{t(DEFAULT_LOCALE, 'settings.register.manual')}</summary>
                <RegisterProvider register={register} />
              </details>
            )}
          </section>

          {/*
            Reproducción: cómo se ve un episodio. El reproductor externo, los saltos
            de intro y ending, la calidad preferida y el modo extendido. No son
            preferencias del motor que se guarden en el servidor: los saltos, la
            calidad y el modo extendido viven en el navegador.
          */}
          <section
            className="settings__seccion"
            id={SECCIONES.reproduccion.id}
            aria-labelledby={`${SECCIONES.reproduccion.id}-titulo`}
          >
            <h2 id={`${SECCIONES.reproduccion.id}-titulo`}>
              {t(DEFAULT_LOCALE, SECCIONES.reproduccion.titulo)}
            </h2>

            <section>
              <h3>{t(DEFAULT_LOCALE, 'settings.mpv')}</h3>
              <p>
                {data.mpv.available
                  ? t(DEFAULT_LOCALE, 'settings.mpv.yes', { version: data.mpv.version ?? '?' })
                  : t(DEFAULT_LOCALE, 'settings.mpv.no')}
              </p>
            </section>

            <SkipSettings />

            {/* La calidad preferida. Es del navegador, como la velocidad: viaja
                en cada resolución y no en los ajustes del servidor. */}
            <QualitySettings />

            {/*
              El modo extendido del reproductor.

              Reutiliza el contenedor de botones del tema, igual que el contenido
              para adultos: es una fila de botones con estado —`aria-pressed`— y la
              regla no habla del tema. El texto de debajo dice lo que el nombre no
              dice: llena la ventana y **no** entra en la pantalla completa del
              sistema.
            */}
            <section>
              <h3>{t(DEFAULT_LOCALE, 'settings.extended')}</h3>
              <fieldset
                className="settings__theme"
                aria-label={t(DEFAULT_LOCALE, 'settings.extended')}
              >
                <button
                  type="button"
                  className="button"
                  aria-pressed={!extendido}
                  onClick={() => preferirExtendido(false)}
                >
                  {t(DEFAULT_LOCALE, 'settings.extended.off')}
                </button>
                <button
                  type="button"
                  className="button"
                  aria-pressed={extendido}
                  onClick={() => preferirExtendido(true)}
                >
                  {t(DEFAULT_LOCALE, 'settings.extended.on')}
                </button>
              </fieldset>
              <p>{t(DEFAULT_LOCALE, 'settings.extended.body')}</p>
            </section>
          </section>

          {/*
            Avisos: la insignia de «Quiero ver» en Novedades.

            Es una preferencia del navegador, como los saltos: el servidor marca
            la entrada con lo que sabe —lista y fecha— y aquí se decide si se
            enseña. No se oculta en modo restringido porque no escribe en el
            servidor ni añade plugins.
          */}
          <section
            className="settings__seccion"
            id={SECCIONES.avisos.id}
            aria-labelledby={`${SECCIONES.avisos.id}-titulo`}
          >
            <h2 id={`${SECCIONES.avisos.id}-titulo`}>
              {t(DEFAULT_LOCALE, SECCIONES.avisos.titulo)}
            </h2>

            <AvisosSettings />
          </section>

          {/*
            Descargas: dónde se guarda lo que se baja y cuánto queda.

            La carpeta se edita en la Biblioteca, con la cola y el espacio
            delante; aquí sólo se dice dónde está y se enlaza. Duplicar el
            formulario sería tener dos sitios que guardan la misma ruta.
          */}
          <section
            className="settings__seccion"
            id={SECCIONES.descargas.id}
            aria-labelledby={`${SECCIONES.descargas.id}-titulo`}
          >
            <h2 id={`${SECCIONES.descargas.id}-titulo`}>
              {t(DEFAULT_LOCALE, SECCIONES.descargas.titulo)}
            </h2>

            <DownloadsSettings />
          </section>

          {/*
            Perfil: la copia portátil de las marcas. Va después de las descargas
            porque no configura nada de esta instalación: exporta lo que el usuario
            ya construyó aquí para poder llevárselo a otra.
          */}
          <section
            className="settings__seccion"
            id={SECCIONES.perfil.id}
            aria-labelledby={`${SECCIONES.perfil.id}-titulo`}
          >
            <h2 id={`${SECCIONES.perfil.id}-titulo`}>
              {t(DEFAULT_LOCALE, SECCIONES.perfil.titulo)}
            </h2>

            <ProfileSettings />
          </section>

          {/* Apariencia: sólo el tema, pero es lo primero que se busca cuando algo
              se ve mal y no debe quedar enterrado entre los mandos del reproductor. */}
          <section
            className="settings__seccion"
            id={SECCIONES.apariencia.id}
            aria-labelledby={`${SECCIONES.apariencia.id}-titulo`}
          >
            <h2 id={`${SECCIONES.apariencia.id}-titulo`}>
              {t(DEFAULT_LOCALE, SECCIONES.apariencia.titulo)}
            </h2>

            <section data-tour={ANCLAS.ajustesTema}>
              <h3>{t(DEFAULT_LOCALE, 'settings.theme')}</h3>
              <ThemeToggle value={data.theme} onChange={setTheme} />
            </section>
          </section>

          {/*
            Privacidad y contenido: lo que se guarda para uno y lo que se publica
            fuera. Van juntos porque las dos decisiones son sobre la mirada de los
            demás, no sobre la aplicación.

            El contenido para adultos reutiliza el contenedor de botones del tema: es
            una fila de botones con estado —`aria-pressed`— y nada de la regla habla
            del tema. Una clase nueva sería la misma regla de CSS escrita dos veces
            para el mismo dibujo.
          */}
          <section
            className="settings__seccion"
            id={SECCIONES.privacidad.id}
            aria-labelledby={`${SECCIONES.privacidad.id}-titulo`}
          >
            <h2 id={`${SECCIONES.privacidad.id}-titulo`}>
              {t(DEFAULT_LOCALE, SECCIONES.privacidad.titulo)}
            </h2>

            <section>
              <h3>{t(DEFAULT_LOCALE, 'settings.adult')}</h3>
              <fieldset
                className="settings__theme"
                aria-label={t(DEFAULT_LOCALE, 'settings.adult')}
              >
                <button
                  type="button"
                  className="button"
                  aria-pressed={!data.adultContent}
                  onClick={() => setAdultContent(false)}
                >
                  {t(DEFAULT_LOCALE, 'settings.adult.hide')}
                </button>
                <button
                  type="button"
                  className="button"
                  aria-pressed={data.adultContent}
                  onClick={() => setAdultContent(true)}
                >
                  {t(DEFAULT_LOCALE, 'settings.adult.show')}
                </button>
              </fieldset>
              <p>{t(DEFAULT_LOCALE, 'settings.adult.help')}</p>
            </section>

            {/*
              La presencia de Discord.

              Reutiliza el contenedor de botones del tema, como el contenido para
              adultos: una fila con estado y ninguna regla nueva. Va aquí, junto a los
              otros ajustes de privacidad, y no con el reproductor: lo que decide es qué
              se publica fuera de la aplicación.
            */}
            {data.locked ? null : (
              <section>
                <h3>{t(DEFAULT_LOCALE, 'settings.discord')}</h3>
                <fieldset
                  className="settings__theme"
                  aria-label={t(DEFAULT_LOCALE, 'settings.discord')}
                >
                  {(
                    [
                      ['off', 'settings.discord.off'],
                      ['discreto', 'settings.discord.discreto'],
                      ['completo', 'settings.discord.completo'],
                    ] as const
                  ).map(([modo, etiqueta]) => (
                    <button
                      key={modo}
                      type="button"
                      className="button"
                      aria-pressed={data.discordPresence === modo}
                      onClick={() => setDiscordPresence(modo)}
                    >
                      {t(DEFAULT_LOCALE, etiqueta)}
                    </button>
                  ))}
                </fieldset>
                <p>{t(DEFAULT_LOCALE, 'settings.discord.help')}</p>
                {data.discordPresence === 'off' ? null : (
                  <p>
                    {data.discord.connected
                      ? t(DEFAULT_LOCALE, 'settings.discord.connected')
                      : t(DEFAULT_LOCALE, 'settings.discord.disconnected')}
                  </p>
                )}
              </section>
            )}
          </section>

          {/* Sistema: las rutas del disco. Es lo último que se toca y lo primero que
              se busca cuando algo no aparece. */}
          <section
            className="settings__seccion"
            id={SECCIONES.sistema.id}
            aria-labelledby={`${SECCIONES.sistema.id}-titulo`}
          >
            <h2 id={`${SECCIONES.sistema.id}-titulo`}>
              {t(DEFAULT_LOCALE, SECCIONES.sistema.titulo)}
            </h2>

            <section>
              <h3>{t(DEFAULT_LOCALE, 'settings.paths')}</h3>
              <dl className="settings__paths">
                <dt>{t(DEFAULT_LOCALE, 'settings.paths.data')}</dt>
                <dd>{data.paths.data}</dd>
                <dt>{t(DEFAULT_LOCALE, 'settings.paths.config')}</dt>
                <dd>{data.paths.config}</dd>
                <dt>{t(DEFAULT_LOCALE, 'settings.paths.cache')}</dt>
                <dd>{data.paths.cache}</dd>
              </dl>
            </section>
          </section>

          {/* La guía va al final: no configura nada, sólo repite lo que ya se vio.
              Su propio `<h2>` es el título de la sección; el índice la llama «Guía»
              con la misma clave. */}
          <section
            className="settings__seccion"
            id={SECCIONES.guia.id}
            aria-label={t(DEFAULT_LOCALE, SECCIONES.guia.titulo)}
          >
            <SeccionGuia />
          </section>
        </div>
      </div>
    </section>
  )
}
