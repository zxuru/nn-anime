# Watch party: ver a la vez, cada uno desde su fuente

La sala sincroniza **sólo el estado de reproducción**: qué título, qué episodio, en qué segundo,
pausado o no y a qué velocidad. Nunca viaja el vídeo, ni un ticket del proxy, ni una URL de stream.
Cada participante reproduce el episodio desde su propia instancia y con sus propios proveedores o
descargas.

Está **apagada por defecto** y es experimental. Se enciende con `NN_ANIME_PARTY=1`; sin esa variable
las rutas de sala ni siquiera existen (una petición a ellas es un 404).

## Cómo se usa

### Anfitrión

El anfitrión tiene que escuchar en la red local: en modo local el servidor sólo atiende `127.0.0.1`,
así que un invitado no puede llegar. Con el modo servidor ya existe la puerta (`NN_ANIME_TOKEN`), y
la sala se cuelga de ella:

```bash
export NN_ANIME_TOKEN="$(openssl rand -base64 32)"
NN_ANIME_HOST=0.0.0.0 NN_ANIME_PARTY=1 bun run start
```

1. Entra con el token en la pantalla de acceso.
2. Abre el episodio que quiere ver.
3. Pulsa **Ver juntos** en la cabecera del reproductor.
4. Comparte el **código** (16 caracteres, en grupos de cuatro) y una de las direcciones que enseña el
   panel —por ejemplo `192.168.1.10:7717`—. El panel las saca de las interfaces de red de la máquina.
5. Cuando termina, **Cerrar sala**. La sala también caduca sola.

### Invitado

El invitado no abre la interfaz del anfitrión: abre **la suya** y deja que su servidor hable con el
del anfitrión. Así no se comparte la sesión de la aplicación del anfitrión (su historial, sus ajustes,
sus descargas) y no hay que abrir CORS ni relajar el CSP.

1. Arranca su propia instancia con la función encendida: `NN_ANIME_PARTY=1 bun run start`.
2. Abre el mismo episodio que el anfitrión (la sala no resuelve el contenido por ti todavía; ver
   «Lo que falta»).
3. Pulsa **Unirse**, escribe la dirección del anfitrión, el código y un nombre.
4. La barra de sala dice quién manda y cómo va la sincronización. Si se queda atrás, se resincroniza
   solo; el botón **Resincronizar** fuerza la corrección.

## Qué garantiza y qué no

- **El anfitrión manda.** El estado autoritativo es el suyo; el invitado reporta posición y si está
  listo, y corrige su `<video>` contra el reloj del anfitrión. Un invitado no puede cambiar lo que ven
  los demás.
- **Deriva tolerada:** 0,5 s. Por debajo de 0,15 s no se toca nada; entre 0,15 s y 1,5 s se ajusta la
  velocidad un poco; a partir de 1,5 s se salta. La píldora de estado lo dice.
- **Cada uno necesita su fuente.** Si un invitado no tiene el episodio, lo verá en el roster y el
  resto sigue. No se comparten `providerId`, referencias ni tickets.
- **No hay servidor central.** La sala vive en la instancia del anfitrión y muere con el proceso o al
  caducar. No hay cuentas, ni historial de salas, ni telemetría.
- **El invitado no es un usuario del anfitrión.** Su credencial es un token de sala que se queda en
  la memoria de **su** servidor; la pestaña sólo habla con su propio origen. El token del modo
  servidor del anfitrión no se comparte.

## Límites

| Qué | Tope |
|---|---|
| Participantes por sala | 8 |
| Salas por instancia | 4 |
| Vida de la sala | 4 h por defecto (máximo 12 h) |
| Mensajes del invitado | 10/s por participante |
| Intentos de entrar | 20/min por instancia (ventana de un minuto) |
| Mensaje o cuerpo | 4 KiB por mensaje de estado |

Los intentos de entrada se limitan por instancia y no por IP: el servidor no recibe una dirección
remota fiable con el adaptador HTTP actual. El código tiene 80 bits de entropía, así que 20 intentos
por minuto no acercan la fuerza bruta a nada.

## Red y seguridad

- **LAN de confianza.** Sin TLS, el código de sala y el estado viajan sin cifrar por la red local. No
  expongas el puerto a Internet para una sala. Si lo haces, pone TLS delante y no compartas el token
  de la aplicación.
- **El invitado conecta a la dirección que teclea.** Es una acción dirigida por la persona; su
  servidor sólo compone las rutas fijas de la sala sobre ese origen, no sigue redirecciones y no hace
  de proxy de contenido.
- **Sin persistencia.** Las salas viven en memoria y no se escriben en SQLite ni en un log: ni
  códigos, ni nombres, ni IPs, ni tokens en claro (se guarda su SHA-256).
- **El riesgo residual está en [SECURITY.md](../SECURITY.md).** Ahí se declara lo que no se mitiga.

## Cómo está hecho

| Pieza | Dónde |
|---|---|
| Protocolo, tipos y corrección de deriva | `packages/core/src/party.ts` |
| Salas en memoria, credenciales y límites | `packages/server/src/party/store.ts` |
| Rutas del anfitrión y del servidor invitado | `packages/server/src/party/routes.ts` |
| El invitado desde su propio servidor (SSE y reenvío) | `packages/server/src/party/remote.ts` |
| Interfaz, hook del reproductor y cliente | `packages/web/src/features/party/` |

`NN_ANIME_PARTY=1` llega al servidor desde el entorno; ver `packages/cli/src/server-env.ts`.

```bash
bun test packages/core/src/party.test.ts packages/server/src/party
bun test packages/web/src/features/party
```

## Lo que falta

- **WebRTC P2P** para redes distintas sin túnel (decisión **D3** del roadmap). Hoy el modo remoto
  necesita que el invitado llegue al servidor del anfitrión por la LAN o por un túnel del usuario; el
  transporte P2P sigue sin implementar.
- **Coincidencia de contenido** (roadmap 3.6): la sala dice qué título y episodio, pero el invitado
  tiene que abrirlo él. El estado ya lleva título, temporada y número de episodio; falta el
  identificador común (AniList) para emparejar entre proveedores.
- **Esperar a todos** y **control compartido**: v1 es del anfitrión y sin pausa coordinada.
- **mpv**: el reproductor externo no se sincroniza.
- **Hub**: la sala no sirve el vídeo del anfitrión a navegadores sin instancia; cada uno reproduce el
  suyo.
