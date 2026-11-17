# Changelog

Todas las versiones de nn-anime. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

**Este archivo es el cuerpo de la release.** `release.yml` saca de aquí la sección de la versión que
está publicando —desde `## [X.Y.Z]` hasta el encabezado siguiente— y la pega tal cual, así que lo que
se escriba aquí es lo que se lee en la página de descargas. La versión la sube `release-please` en los
diez `package.json`; este archivo lo mantiene él cuando el PR de release se fusiona.

## [0.9.0](https://github.com/zxuru/nn-anime/compare/v0.8.0...v0.9.0) (2026-11-17)


### Features

* **core:** familias de contenido y formato en el contrato (T257a) ([8a46074](https://github.com/zxuru/nn-anime/commit/8a460740d0cdc2ce01511ddced47015840739b13))
* **desktop:** auto-reemplazo en toda copia y consulta unica (T250) ([29f85da](https://github.com/zxuru/nn-anime/commit/29f85da47252f83261e38d49c4c0d1b23cbabfc4))
* **desktop:** el límite del updater, visible fuera de Windows (T243) ([72f8e73](https://github.com/zxuru/nn-anime/commit/72f8e734a601fd8f5d3b9e8bcdf3d6a94fcc9e39))
* **icono:** el SVG de la marca es el maestro y los binarios salen de él ([1f823fb](https://github.com/zxuru/nn-anime/commit/1f823fbd31a71127531e14bd7243fe3197e5eff4))
* **icono:** la R-raposa, con detalle por tamaño ([551201a](https://github.com/zxuru/nn-anime/commit/551201af1b439fd6623d38b706a202c6a0f74d3c))
* **package:** publicar solo artefactos portables (T251) ([8196cfc](https://github.com/zxuru/nn-anime/commit/8196cfc2180c5648aefa856b22c1dbf8fd04abfd))
* **repo:** cada paquete con su umbral de cobertura (T225) ([16a352b](https://github.com/zxuru/nn-anime/commit/16a352b27dd72e51fc9e96e21b62b481ff4f8526))
* **repo:** el comando que poda los worktrees restos (T223) ([d4f58f2](https://github.com/zxuru/nn-anime/commit/d4f58f2b73ffa8abf2f59e0384f048aebd1f9d46))
* **server:** la home anuncia su caché y su primera pintura (T261) ([d70c1e9](https://github.com/zxuru/nn-anime/commit/d70c1e96ce681772d243c8878a2cec71ccc3ec4a))
* **server:** presencia de Discord con modo discreto (T253) ([fd8c4f1](https://github.com/zxuru/nn-anime/commit/fd8c4f1a251194c1ff927b52e1cb03d4de96e227))
* **web:** Ajustes en secciones, con índice (T256) ([49e1baa](https://github.com/zxuru/nn-anime/commit/49e1baaad90db93b3e8339553d04949c668e5089))
* **web:** aplicar la marca y añadir favicon (T277) ([3385262](https://github.com/zxuru/nn-anime/commit/3385262354f2d697555fb9f6966acce955916f3d))
* **web:** el motivo a la vista, el hero y el mosaico (T268) ([15b498a](https://github.com/zxuru/nn-anime/commit/15b498a3a8b833c6a77af8149f2f22c4b0401bdb))
* **web:** el recorrido completo por teclado (T262) ([dff9d0e](https://github.com/zxuru/nn-anime/commit/dff9d0eddd2aa57b1e95a5a0fe4acd295f4e3ea2))
* **web:** el tema antes del primer pintado, description y pie (T239) ([dcc8ddd](https://github.com/zxuru/nn-anime/commit/dcc8dddcd9c7d290ffcc9c7a5ca858545b6473d4))
* **web:** la búsqueda enfoca su campo y la tarjeta pierde el sello (T272) ([d27ac54](https://github.com/zxuru/nn-anime/commit/d27ac54d672485dd0965dc6dc94131cb9399824e))
* **web:** las esperas con la forma de lo que llega (T271) ([624d3db](https://github.com/zxuru/nn-anime/commit/624d3db389fc452dbfe05b97b7a46a95074d7f17))
* **web:** probar la obra en otra fuente cuando la ficha falla (T231) ([934f66b](https://github.com/zxuru/nn-anime/commit/934f66ba8465912651b1b34c8b2fe1b81b075e66))
* **web:** servir Space Mono desde el repo (T238) ([a13a0c4](https://github.com/zxuru/nn-anime/commit/a13a0c4a4e57d9282af5825e9ba59dcd74bbf760))
* **web:** ya conozco cómo funciona, omitir todos los tutoriales (T254) ([1927253](https://github.com/zxuru/nn-anime/commit/19272533ae2a1843fe3249a6ab3babb9a61b209d))


### Bug Fixes

* **catalog-store:** cerrar el bloqueo de migraciones (T277) ([dadb5b6](https://github.com/zxuru/nn-anime/commit/dadb5b6814b6c4ce68ccfab999d5fa00f86161d1))
* **catalog-store:** una tarjeta por episodio en el historial (T264) ([a2a4132](https://github.com/zxuru/nn-anime/commit/a2a4132c05d93efd21e5b55a8b66c636d00cd6bc))
* **deps:** ajustar el contexto del parche picomatch (T277) ([74572bd](https://github.com/zxuru/nn-anime/commit/74572bd86b7fbe79bc5ff190c74a9e3a84bb598e))
* **deps:** corregir el formato del parche de picomatch (T277) ([ac3b60e](https://github.com/zxuru/nn-anime/commit/ac3b60e975306d84e5c5ca19377979af7e52b665))
* **deps:** mitigar ReDoS en picomatch (T277; 19 pruebas bloqueadas por sandbox) ([33509d3](https://github.com/zxuru/nn-anime/commit/33509d3d7747e51764bd1eb0a7cf7649831d48c4))
* **desktop:** el servidor no sobrevive a la muerte del anfitrión (T232) ([21894d4](https://github.com/zxuru/nn-anime/commit/21894d4111b65a5a2be6ba67a45bd3261360a94d))
* **desktop:** excluir la constante legacy en Linux (T277) ([0feb9b1](https://github.com/zxuru/nn-anime/commit/0feb9b1bd2ad9f0c2793e44d003e97fd6c59fe73))
* **docker:** incluir parche de picomatch al instalar (T277) ([dc7dd83](https://github.com/zxuru/nn-anime/commit/dc7dd832070e2661df741ffced01dd64cfe38824))
* **icon:** nombrar el SVG maestro para accesibilidad (T277) ([e2f2d5d](https://github.com/zxuru/nn-anime/commit/e2f2d5dc961aa78843db4cb88baed7dab996b4df))
* **repo:** el gancho crea su temporal aunque .tmp/ no exista (T248) ([0bb4eed](https://github.com/zxuru/nn-anime/commit/0bb4eed13606ed509da376ad1a40e2f1477c20eb))
* **server:** una obra, una recomendación (T273) ([c4a37d5](https://github.com/zxuru/nn-anime/commit/c4a37d5a35c837229963b486c996141aed089143))
* **web:** el esqueleto de la ficha y las expectativas del e2e (T266) ([9612372](https://github.com/zxuru/nn-anime/commit/961237243f88e90b0ef15d901c0f044ca8af04cc))
* **web:** el final del episodio, el contraste móvil y el menú (T267) ([5a38e40](https://github.com/zxuru/nn-anime/commit/5a38e40a84632900931e5ebb202be90fcab4901e))
* **web:** la copia de la home, sin jerga ni promesas (T270) ([455feb0](https://github.com/zxuru/nn-anime/commit/455feb06dc0b58b5a6c70b6b2a5a7b57212b48cd))
* **web:** la deuda visual medida del shell (T236) ([d933bc4](https://github.com/zxuru/nn-anime/commit/d933bc4b283f6499df4a1cd0730e68ba4c3f7804))
* **web:** la espera de buscar, una lista y sin consulta vacia (T274) ([3e34569](https://github.com/zxuru/nn-anime/commit/3e34569e9b107dd54db5a5b988689e5472b471b5))
* **web:** la home dice la verdad, busca y no repite (T275) ([dfa28ac](https://github.com/zxuru/nn-anime/commit/dfa28ac82d4efdd1fafc55235d486daa61f15367))
* **web:** la licencia de hls.js sale del modo extendido (T265) ([8aeb589](https://github.com/zxuru/nn-anime/commit/8aeb58980bc59dd30742e3c55a41472f8b751451))
* **web:** la parrilla y las novedades distinguen la fuente caida (T275b) ([49a8a0a](https://github.com/zxuru/nn-anime/commit/49a8a0ad2abea7043aaeb0f17cb237e977bc1b8a))
* **web:** la presencia de Discord no se borra sola (T271) ([926e6ae](https://github.com/zxuru/nn-anime/commit/926e6aeaef48d57f2cbebddf170d45e3e9e3c48b))
* **web:** la sala cabe sin desplazamiento y la lista llena su columna (T266) ([037ddb1](https://github.com/zxuru/nn-anime/commit/037ddb1d277d831604a33f4adeb945dd8f14ae18))
* **web:** quitar el buscador de la home (T276) ([038b22c](https://github.com/zxuru/nn-anime/commit/038b22c9528e3ac69d58475407d13bf766e36b1d))
* **web:** teclado, lámina, mandos y lista del reproductor (T269) ([79bcf88](https://github.com/zxuru/nn-anime/commit/79bcf88a94cb51e7f4861c67cc4b714f41cba928))

## [0.8.0](https://github.com/zxuru/nn-anime/compare/v0.7.0...v0.8.0) (2026-11-10)


### Features

* **catalog-store:** persistencia entre versiones con copias y restauración ([2b30723](https://github.com/zxuru/nn-anime/commit/2b30723bd35508739f4b6f9c101d6d90a6cfd543))
* **watch-party:** sala de visionado LAN con relevo del invitado (fase 3) ([926deab](https://github.com/zxuru/nn-anime/commit/926deab737971f6c21258f1f5feeb9c31c7ca243))
* **web:** omitir tutoriales y modo extendido del reproductor ([6bfb12f](https://github.com/zxuru/nn-anime/commit/6bfb12f98e33845d3ebf1b8fc423697f6c9cc586))


### Bug Fixes

* **desktop:** la prueba de carpetas usa el separador de su plataforma ([11337d6](https://github.com/zxuru/nn-anime/commit/11337d6368999a424ad6c0eee7321bfe9b3368b8))
* **desktop:** las constantes de datos solo existen donde se usan ([bb91649](https://github.com/zxuru/nn-anime/commit/bb91649dca163163c24b2a22a48aefb2083e033d))
* **e2e:** el cartel de favoritos espera a la lista guardada ([4cb0d28](https://github.com/zxuru/nn-anime/commit/4cb0d2807b80793dae92565993561f0f59a1e7b6))
* **e2e:** la banda mide su titular cuando la ficha ya cargo ([b34cabc](https://github.com/zxuru/nn-anime/commit/b34cabcc3fe2eab88d53114a27534c1ea4191e8f))
* **e2e:** la persistencia monta el plugin y la interfaz donde toca ([e33fdfb](https://github.com/zxuru/nn-anime/commit/e33fdfbcdde1a113d46a53b19ec6d95fbc4962d8))
* **e2e:** los e2e del reproductor miden el comportamiento nuevo ([645d476](https://github.com/zxuru/nn-anime/commit/645d47674ad618376ca240dec93a1a8ab8e352dc))
* **packaging:** el aviso del instalador interpola bien la ruta de datos ([55508b5](https://github.com/zxuru/nn-anime/commit/55508b5c6ad773785df691b6ede6aa4a8fe2889c))
* **player:** el Escape del menu cierra el menu y no el modo extendido ([70c7e62](https://github.com/zxuru/nn-anime/commit/70c7e628cc802fca2ee8ccd4d4b5fdaa789c871d))
* **player:** recuperar fragLoadError con reintentos, media y renovacion de fuente ([c4ca082](https://github.com/zxuru/nn-anime/commit/c4ca082459f182bc224531823a89e6eae5aaf810))
* **release:** la version del Cargo.lock vuelve a llevar la anotacion ([3a39524](https://github.com/zxuru/nn-anime/commit/3a395245ace566c74520c364fc6811649e287316))

## [0.7.0](https://github.com/zxuru/nn-anime/compare/v0.6.0...v0.7.0) (2026-10-30)


### Features

* **media-proxy:** buscar ffmpeg donde esta de verdad (T200) ([ef237ed](https://github.com/zxuru/nn-anime/commit/ef237ed409a3260d54e60c47f72ac037f8ae4ebe))
* **media-proxy:** el progreso del HLS con total estimado (T198) ([393bb39](https://github.com/zxuru/nn-anime/commit/393bb39f96ea5f856dc0ddc05d7555d2c3c35c70))
* **media-proxy:** el remux a MP4 sin ffmpeg, con mux.js (T202) ([339a631](https://github.com/zxuru/nn-anime/commit/339a6311e23c3593f0a50798b55329fe44c1f6fd))
* **recsys:** la popularidad no explica una recomendación (T209) ([e34f5b8](https://github.com/zxuru/nn-anime/commit/e34f5b8398f0f7fa9b4c49c116682fc4d4688aeb))
* **server:** apuntar la serie entera desde la ficha (T204) ([9d5b161](https://github.com/zxuru/nn-anime/commit/9d5b16158e0fe40f4c9c96281960749c669fe004))
* **server:** convertir con mux.js cuando no hay ffmpeg (T202) ([3325f9d](https://github.com/zxuru/nn-anime/commit/3325f9d74672626262bc6b58004e92e6301b1196))
* **server:** convertir en MP4 una descarga en segmentos (T200) ([2e3f300](https://github.com/zxuru/nn-anime/commit/2e3f3005e2c2e0e0e0be4c68e20206c82e56d8be))
* **web:** el aviso y el boton de convertir a MP4 (T200) ([01de69c](https://github.com/zxuru/nn-anime/commit/01de69c07e4c9bc30a48dc633e83fd2b58d3fb1a))
* **web:** iconos y arreglos visuales en biblioteca, perfil y ajustes (T208) ([91a7655](https://github.com/zxuru/nn-anime/commit/91a765509f661e5bec7a82a4ec5549ea1368ec76))
* **web:** la carga de la ficha con esqueleto, adelanto y estados de error (T210) ([6a126a1](https://github.com/zxuru/nn-anime/commit/6a126a1223139ccc10f6f2079a6ec9bebe80ee2b))
* **web:** la cola de descargas, delante y colapsable (T205) ([1ad13fc](https://github.com/zxuru/nn-anime/commit/1ad13fc9d725f04881fb19207342a291beef729c))
* **web:** la guía de primeros pasos y los avisos de novedad (T201) ([bc7e4d1](https://github.com/zxuru/nn-anime/commit/bc7e4d18e51024160cc9ccc43e958852114871f7))
* **web:** la librería de iconos y la barra del móvil (T207) ([509b676](https://github.com/zxuru/nn-anime/commit/509b676c8ca4679442927ee390283a13721b94b0))
* **web:** la serie entera en el reproductor de la biblioteca (T206) ([02fbfa9](https://github.com/zxuru/nn-anime/commit/02fbfa9d443cc9d26501060833f6e604ec3f90fa))
* **web:** un recorrido por pantalla en la guía (T203) ([1d88a56](https://github.com/zxuru/nn-anime/commit/1d88a5659eec73d5b10d7639f1d6fec916672247))


### Bug Fixes

* **e2e:** la banda se mide en la ficha cargada, no en el esqueleto ([de51746](https://github.com/zxuru/nn-anime/commit/de517463151b0eaa03ee835c56215d3cdf99e67e))
* **server:** la descarga sin ffmpeg se reproduce y dice que es segmentos (T199) ([f0606a8](https://github.com/zxuru/nn-anime/commit/f0606a8a9271265c54e3862c1400651caa19ccf1))
* **web:** el cierre de la guía deja memoria y el salto busca su rótulo (T213) ([00cd535](https://github.com/zxuru/nn-anime/commit/00cd535aac52139410f317cbe5c8186a61eff737))
* **web:** la búsqueda que abre una ficha deja el rastro (T211) ([e5eff5b](https://github.com/zxuru/nn-anime/commit/e5eff5b8b35cf24ed1973cb76808d839cbe98902))
* **web:** la ficha fría carga sus adornos sin recargar (T212) ([1fbec92](https://github.com/zxuru/nn-anime/commit/1fbec926bb28e6245bccf89f029d6136047c141e))

## [0.6.0](https://github.com/zxuru/nn-anime/compare/v0.5.0...v0.6.0) (2026-10-29)


### Features

* **web:** la biblioteca con la cola y el reproductor local (T196) ([d4ea0d4](https://github.com/zxuru/nn-anime/commit/d4ea0d41e8f9e7e9c7b8e07ff6cd1e8521f0336c))


### Bug Fixes

* **desktop:** el listón de Linux no marca código muerto del updater (release 0.6.0) ([a4b3501](https://github.com/zxuru/nn-anime/commit/a4b35012ff914459e724d8f331e1d9081f7d3796))

## [0.5.0](https://github.com/zxuru/nn-anime/compare/v0.4.0...v0.5.0) (2026-10-29)


### Features

* **desktop:** auto-actualización con el updater de Tauri (T189) ([3e73a2a](https://github.com/zxuru/nn-anime/commit/3e73a2a8319af11fef60cc98939ea936f062d6a7))
* **desktop:** la copia portable se actualiza en sitio (T189) ([4a15cae](https://github.com/zxuru/nn-anime/commit/4a15caec682ceaa90565c659d088836a72b6830c))
* **server:** el listado de carpetas del selector (T192) ([0fd2dfc](https://github.com/zxuru/nn-anime/commit/0fd2dfc77bf0ddbf348800e9580c7fe79d986c95))
* **web:** descargar sin permiso de la fuente y el fallo en un tooltip (T190) ([e696834](https://github.com/zxuru/nn-anime/commit/e6968340db6d2f270ea5e4f552a098f5473cb307))
* **web:** el explorador de carpetas del selector (T193) ([6df0e20](https://github.com/zxuru/nn-anime/commit/6df0e205d784b53cee56692284084a37efc1241f))
* **web:** la carpeta de descargas se elige escribiendo la ruta (T191) ([837e98a](https://github.com/zxuru/nn-anime/commit/837e98aa1352e7dedc28cbd45a50b009c8f70945))
* **web:** la medida de la prosa y el corte de los titulares ([da694ee](https://github.com/zxuru/nn-anime/commit/da694eece5074acc638f4bba524562fa11d9c89b))
* **web:** mover el frontend por estado y marcar el destino actual ([6954518](https://github.com/zxuru/nn-anime/commit/6954518c6abf203fdfd5892832475a6fe8792de3))


### Bug Fixes

* **web:** el aire de la vitrina sigue a la masa y el tramo vacío es un renglón ([bf127c2](https://github.com/zxuru/nn-anime/commit/bf127c20eed8c8962f2f924f390f0b0888619eb4))
* **web:** la interfaz se adapta al teléfono, no sólo se encoge ([89ba62d](https://github.com/zxuru/nn-anime/commit/89ba62d000228350943ec9ac85cf90a9e8cfef04))
* **web:** la nota del tramo, la puntuación de la pieza y el vacío de la home ([71009bc](https://github.com/zxuru/nn-anime/commit/71009bce12babe87636373482c70cad3b79c2dd7))
* **web:** las carpetas del selector se leen como filas (T193) ([27f8ed2](https://github.com/zxuru/nn-anime/commit/27f8ed2c4dd4fd031728535ef0158d019ed600e5))
* **web:** las pruebas del menú miden el menú que queda en el documento ([4d0faf6](https://github.com/zxuru/nn-anime/commit/4d0faf650969a85f764626ee5f90f522667f1cd0))


### Performance Improvements

* **web:** la marquesina se pinta una vez y su cartel no espera a las miniaturas (T195) ([7502c7b](https://github.com/zxuru/nn-anime/commit/7502c7b6b7c2febcecc8e3f8b4a28d97c78955da))

## [0.4.0](https://github.com/zxuru/nn-anime/compare/v0.3.3...v0.4.0) (2026-10-28)


### Features

* **desktop:** el selector de carpeta de descargas (T186) ([96e71f8](https://github.com/zxuru/nn-anime/commit/96e71f8fef54acae9c9b874d6868786a6994ff75))
* **server:** el espacio y el borrado de descargas (T187) ([e6f6fc7](https://github.com/zxuru/nn-anime/commit/e6f6fc7580d55dc28eb0cad64e574379ea15eefa))
* **web:** la copia local manda en el reproductor (T185) ([abbe85e](https://github.com/zxuru/nn-anime/commit/abbe85e7619cccb72fd5cfd96ba71eea8f5c9dbc))


### Bug Fixes

* **desktop:** el lock fusionado recupera windows-sys 0.59 (T186) ([7c23e37](https://github.com/zxuru/nn-anime/commit/7c23e3717852e161845918b528b89727f02e30e7))
* **release:** el dispatch le dice el repositorio a gh (T172) ([7aec184](https://github.com/zxuru/nn-anime/commit/7aec1849d4aff507603d4f9c652f3f9830084713))
* **web:** el reproductor sin contorno blanco (T188) ([8c1c332](https://github.com/zxuru/nn-anime/commit/8c1c332d9625e372753f9bbecd0f0bca47d8b121))

## [0.3.3](https://github.com/zxuru/nn-anime/compare/v0.3.2...v0.3.3) (2026-10-26)


### Bug Fixes

* **desktop:** devolver la anotación de release-please al Cargo.lock ([5388e54](https://github.com/zxuru/nn-anime/commit/5388e541b821787cc38d4e5eaf6267ec09e85576))

## [0.3.2](https://github.com/zxuru/nn-anime/compare/v0.3.1...v0.3.2) (2026-10-26)


### Bug Fixes

* **ci,release:** el listón de main y la release por id (T172) ([d917f59](https://github.com/zxuru/nn-anime/commit/d917f599139adfcd0db0a73f3907348949d61a8e))
* **ci:** el listón de main con Biome 2.6 (T172) ([36ebecf](https://github.com/zxuru/nn-anime/commit/36ebecff261083f88bd162f89d432731270391f7))
* **release:** disparar y publicar la release por id (T172) ([3188e4f](https://github.com/zxuru/nn-anime/commit/3188e4f6c442d3e8cdc10e0b41a6f765d9b072da))

## [0.3.1](https://github.com/zxuru/nn-anime/compare/v0.3.0...v0.3.1) (2026-10-25)


### Bug Fixes

* **release:** bajar sólo los instaladores (T170) ([b14bdda](https://github.com/zxuru/nn-anime/commit/b14bdda81bfe43c66de7423fecafed472f4acf21))
* **release:** no publicar el artefacto de buildx (T170) ([e873a3e](https://github.com/zxuru/nn-anime/commit/e873a3e9816aab2429d7aa50befca789d782dc4c))

## [0.3.0](https://github.com/zxuru/nn-anime/compare/v0.2.0...v0.3.0) (2026-10-25)


### Features

* **cli:** host, puerto y modo servidor por entorno (T168) ([c1b79b3](https://github.com/zxuru/nn-anime/commit/c1b79b3634e9bf724edba12bb0dc6ce388645a5f))
* **docker:** desplegar nn-anime como contenedor y en modo servidor (T168) ([6b64376](https://github.com/zxuru/nn-anime/commit/6b6437608dcc68a7878304538a46b11d456ba177))
* **docker:** imagen, compose y publicación multi-arquitectura (T168) ([d6b2fc0](https://github.com/zxuru/nn-anime/commit/d6b2fc046c47908e981ab1e29721ad1c4b554579))
* **server:** token fijo, login, healthz y modo restringido (T168) ([c9adf5a](https://github.com/zxuru/nn-anime/commit/c9adf5a1152cd4d5a37fdba4d9a3388bf0c07553))


### Bug Fixes

* **cli:** declarar la dependencia de media-proxy (T168) ([75c0274](https://github.com/zxuru/nn-anime/commit/75c027491508c1008a992a055bb2d498cb383884))
* **cli:** preferir el origen público en modo token (T168) ([32e6cbe](https://github.com/zxuru/nn-anime/commit/32e6cbed00246f8a38f2e5faa760deefcdf9f15f))
* **docker:** copiar las dependencias por paquete al runtime (T168) ([ceeb6b7](https://github.com/zxuru/nn-anime/commit/ceeb6b7e90cac0cf4e974a41129b2913b1285b90))
* **lint:** quitar imports sin uso y ordenar dos selectores (T168) ([a07d574](https://github.com/zxuru/nn-anime/commit/a07d574ec3ee1362c0cff8101590a70931c4dee2))

## [0.2.0](https://github.com/zxuru/nn-anime/compare/v0.1.0...v0.2.0) (2026-10-24)


### Features

* **web,cli:** el primer arranque recomienda el repositorio de proveedores (T165) ([aabc1f8](https://github.com/zxuru/nn-anime/commit/aabc1f8ad9009e7f864577d6e5736e619c49c447))


### Bug Fixes

* **web:** la marquesina de reserva usa la tinta del tema (T165) ([333af73](https://github.com/zxuru/nn-anime/commit/333af73fc887353318a786ccbff527c37616ccc1))
* **web:** los esqueletos se ven y la home dice que carga (T165) ([df1f92a](https://github.com/zxuru/nn-anime/commit/df1f92ab2645ddc9d53eecb6e093500e4ae895f3))

## [0.1.0] - 2026-10-16

La primera versión que se instala y se usa sin saber nada de terminales.

### Añadido

- **La ventana propia.** El acceso del escritorio —y el del menú Inicio, y el del menú de
  aplicaciones— abre una **ventana con la interfaz dentro**, no una consola. Detrás está el webview del
  sistema: WebView2 en Windows, WKWebView en macOS y WebKitGTK en Linux.
- **Un solo archivo para Windows.** `nn-anime-X.Y.Z-windows-x64.exe` lleva dentro el servidor y la
  interfaz: se descarga, se ejecuta y abre la ventana, sin instalar nada. El servidor se extrae a
  `%LOCALAPPDATA%\nn-anime\bin\<versión>` y se verifica con su SHA-256 antes de lanzarlo. Con un
  `portable.txt` al lado, los datos viajan con el `.exe`.
- **La X oculta la ventana en la bandeja; «Salir» apaga la aplicación.** El anfitrión le pide el
  cierre al servidor y espera a que salga; no queda ningún proceso vivo. Cerrar el servidor de golpe
  tampoco lo deja huérfano en Linux.
- **Una sola aplicación a la vez.** Volver a pulsar el acceso enfoca la ventana que ya está, en vez de
  abrir un segundo servidor sobre la misma base de datos.
- **Los enlaces externos abren en el navegador** y no se llevan la ventana.
- **Instaladores autocontenidos**, sin Bun, Node ni Python en la máquina de quien los usa:
  - Windows x64: el archivo único y el instalador `.exe`, por usuario y sin permisos de administrador.
    El instalador instala ese mismo archivo.
  - macOS: `.dmg` para Apple Silicon y para Intel.
  - Linux x64: AppImage, `.deb` y `.rpm`.
- **La release se publica sola.** `release-please` mantiene el PR de versión y, al fusionarlo, el tag
  dispara `release.yml`: compila el archivo único y los instaladores, calcula `SHA256SUMS.txt` y
  publica. Hay un solo publicador.

### Notas

- Los instaladores salen **sin firmar** mientras no haya certificados configurados. Windows avisa con
  SmartScreen y macOS con Gatekeeper la primera vez; el `SHA256SUMS.txt` de la release sirve para
  comprobar que la descarga llegó entera.
- Desinstalar **no borra los datos**: la base, los ajustes y los plugins viven en la carpeta del
  usuario y se quedan donde están.
- No hay ningún proveedor instalado de fábrica: hasta que se copie un plugin, la aplicación arranca,
  se ve y no encuentra nada. Se explica en [la guía de plugins](docs/providers.md).
