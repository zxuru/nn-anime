# RoNa en Docker

Además del uso local, RoNa se puede desplegar como contenedor en un servidor, un NAS o una LAN.
La imagen sirve **la interfaz y la API en el mismo origen**, igual que `bun run start`, pero escucha
en `0.0.0.0:8080` dentro del contenedor y guarda todos sus datos en `/data`.

> **No expongas el puerto a Internet sin `RONA_TOKEN` y sin TLS delante.** Los plugins se
> ejecutan **sin sandbox** con los permisos del proceso; un despliegue expuesto sin autenticación es
> un servidor de ejecución de código ajeno. El modelo de amenaza completo está en
> [SECURITY.md](../SECURITY.md).

## Construir la imagen

Desde la raíz del repositorio:

```bash
docker build -t rona:local .
```

La imagen es multi-stage: la primera etapa instala las dependencias y construye la interfaz con
`bun run build`; la segunda instala sólo las dependencias de producción; la final es `oven/bun` slim
y corre como usuario **no root** (`bun`, uid 1000).

La imagen **no incluye ningún proveedor ni scraper**. Tampoco incluye `desktop/`, las pruebas ni el
fixture del repositorio: lo único que lleva es la aplicación.

## Ejecutarla

```bash
TOKEN="$(openssl rand -base64 32)"

docker run -d --name RoNa \
  -p 127.0.0.1:8080:8080 \
  -e RONA_TOKEN="$TOKEN" \
  -v rona-data:/data \
  rona:local
```

Abre `http://127.0.0.1:8080/login`, pega el token y entra. Sin cookie, la interfaz y la API
responden **401**; `/healthz` es lo único público, además del formulario.

Si quieres entrar desde la LAN sin proxy, publica el puerto en la interfaz que corresponda
(`-p 8080:8080` o `-p 192.168.1.10:8080:8080`) y añade TLS cuanto antes: el token viaja en la
petición del formulario y, sin HTTPS, también lo ve quien esté en la red.

`docker-compose.yml` deja un ejemplo listo: puerto en loopback, volumen nombrado, `restart:
unless-stopped` y `RONA_TOKEN` obligatorio. Genera el token y arráncalo con:

```bash
export RONA_TOKEN="$(openssl rand -base64 32)"
docker compose up -d
```

## Variables de entorno

| Variable | Por defecto | Qué hace |
|---|---|---|
| `RONA_HOST` | `127.0.0.1` | Interfaz donde escucha. La imagen usa `0.0.0.0`. |
| `RONA_PORT` | `7717` | Puerto. La imagen usa `8080`. La bandera `--port` gana sobre la variable. |
| `RONA_NO_OPEN` | sin definir | `1` o `true`: no abre el navegador. La imagen lo pone. |
| `RONA_TOKEN` | sin definir | Token fijo del modo servidor. **Obligatorio** si el host o el origen público no son loopback. Mínimo 16 caracteres; usa 32 aleatorios. |
| `RONA_PUBLIC_ORIGIN` | sin definir | Origen canónico, por ejemplo `https://nn.example.com`. Fija el `Host`/`Origin` admitidos y marca la cookie `Secure` si es https. |
| `RONA_LOCKED` | sin definir | `1` o `true`: modo restringido. Sin alta de plugins, sin repositorios y sin `mpv`. |
| `RONA_PARTY` | sin definir | `1` o `true`: enciende las salas de watch party. Apagado, las rutas `/api/party/*` no existen. |
| `XDG_DATA_HOME` | — | La imagen lo pone en `/data`. |
| `XDG_CONFIG_HOME` | — | La imagen lo pone en `/data/config`. |
| `XDG_CACHE_HOME` | — | La imagen lo pone en `/data/cache`. |

Las variables de rutas (`RONA_DATA_DIR`, `RONA_CONFIG_DIR`, `RONA_CACHE_DIR`) siguen
funcionando si prefieres fijarlas a mano; el inventario completo está en
[`.env.example`](../.env.example).

Sin `RONA_TOKEN`, un arranque con `RONA_HOST=0.0.0.0` **se niega a empezar**: imprime qué
falta y sale con 1. El modo local (`127.0.0.1`, sin token) sigue siendo el de siempre, con su token
de arranque de un solo uso.

`RONA_ALLOW_LOOPBACK=1` **no** se admite en modo servidor: desactiva la protección SSRF del
proxy y el arranque lo rechaza.

## El volumen `/data`

| Qué | Dónde |
|---|---|
| Base de datos SQLite | `/data/rona/rona.db` |
| Configuración | `/data/config/rona/` |
| Plugins | `/data/config/rona/providers/` |
| Repositorios de proveedores descargados | `/data/rona/repos/` |
| Caché | `/data/cache/rona/` |

El usuario de la imagen es `bun` (uid 1000). Con un volumen nombrado Docker hereda el dueño de la
imagen y no hay que hacer nada. Con un **bind-mount**, los permisos son tuyos:

```bash
sudo mkdir -p /srv/RoNa
sudo chown -R 1000:1000 /srv/RoNa
```

**Una sola réplica por volumen.** SQLite es un archivo con un solo escritor; dos contenedores sobre
el mismo `/data` acaban en `SQLITE_BUSY`. Si necesitas varias réplicas, necesitas otra base, y eso
hoy no está soportado.

## Instalar plugins

La imagen arranca **sin ningún proveedor**: hasta que instales uno, la interfaz se ve y no encuentra
nada. Hay dos caminos, y los dos son deliberados:

1. **Desde Ajustes**, con `RONA_LOCKED` sin poner. Pega el repositorio recomendado, mira qué
   trae y marca los archivos. Descargar no ejecuta nada; marcar un archivo es el momento en que se
   importa. Queda en `/data/config/rona/providers/` y se carga sin reiniciar.
2. **Montando el directorio** de plugins desde el host. Es lo que conviene en un servidor:

   ```yaml
   volumes:
     - rona-data:/data
     - ./providers:/data/config/rona/providers:ro
   ```

   Los archivos tienen que ser legibles por el uid 1000. El directorio se lee **al arrancar**:
   después de copiar uno, reinicia el contenedor.

Con `RONA_LOCKED=1` los plugins que ya estén en ese directorio se siguen cargando, pero la API
no ofrece añadir repositorios, escribir un plugin nuevo ni activar/desactivar archivos. El botón de
`mpv` tampoco existe. Es el modo que tiene sentido si la lista de plugins la decides tú y no quien
tiene el token.

Los plugins se ejecutan **sin sandbox**, con los permisos del proceso y dentro del contenedor. Eso
acota el sistema de archivos a lo que el contenedor ve, pero no es un sandbox: pueden leer `/data`,
hablar con la red y usar el `fetch` global. Ver [SECURITY.md](../SECURITY.md).

## Reverse proxy con Caddy

La forma recomendada: el contenedor escucha en loopback y Caddy pone TLS y el nombre.

```caddyfile
nn.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}
```

Y en el entorno del contenedor:

```yaml
RONA_PUBLIC_ORIGIN: https://nn.example.com
```

Caddy conserva la cabecera `Host`, que es lo que los guards necesitan. Con el origen público puesto,
el servidor sólo acepta ese `Host` (y `127.0.0.1` para su healthcheck) y marca la cookie `Secure`.
Sin él, acepta cualquier `Host` y la cookie no lleva `Secure`: úsalo sólo en una LAN de confianza y
con HTTP.

Si además quieres autenticación delante, Caddy puede ponerla; entonces el token de RoNa sigue
siendo la segunda puerta. No hay cuentas por usuario: **un token es un usuario**, y todos comparten
historial, favoritos y ajustes.

## Actualizar

```bash
docker compose pull
docker compose up -d
```

La base y los plugins viven en el volumen y sobreviven al cambio de imagen. La aplicación migra el
esquema al arrancar. Si vuelves a una imagen anterior, haz una copia del volumen antes: una
migración no se deshace sola.

Para una copia consistente, para el contenedor primero:

```bash
docker compose stop
docker run --rm -v rona-data:/data -v "$PWD:/copia" alpine \
  tar czf /copia/rona-data.tgz -C /data .
docker compose start
```

## Salud y diagnóstico

```bash
curl -s http://127.0.0.1:8080/healthz
# {"status":"ok"}
```

El `HEALTHCHECK` de la imagen usa ese endpoint, que no pide token y no cuenta versión, rutas ni
proveedores. Los registros del contenedor (`docker logs RoNa`) llevan el puerto y el modo, nunca
el token ni la URL de arranque.

## Lo que este despliegue no hace

- No incluye plugins ni scrapers: eso es responsabilidad de quien usa el programa.
- No tiene cuentas ni perfiles separados: un token, un historial.
- No escala horizontalmente con SQLite: una réplica por volumen.
- No pone TLS: eso es del reverse proxy.
- No limita la tasa de peticiones: si lo expones, ponlo en el proxy.
- No aísla los plugins: corren en el mismo proceso que el servidor.

## Publicación de la imagen

Cada release estable publica `ghcr.io/zxuru/rona:<versión>` y `ghcr.io/zxuru/rona:latest`, para
`linux/amd64` y `linux/arm64`, desde `.github/workflows/release.yml`. Un prerelease (`1.2.3-rc.1`)
publica sólo la etiqueta de su versión: `latest` se queda en la última estable. Los PRs construyen y
**arrancan** las dos arquitecturas bajo QEMU sin publicarlas. El detalle del proceso está en
[release.md](release.md).
