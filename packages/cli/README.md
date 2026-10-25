# @nn-anime/cli

El lanzador de nn-anime: sirve la interfaz y la API en `127.0.0.1` y abre el navegador con un **token de
arranque de un solo uso**. Sin ese token no se entra, y es lo que impide que cualquier página del
navegador hable con tu aplicación local.

```bash
bunx @nn-anime/cli start        # o, instalado:  nn-anime start
```

Requiere **Bun 1.4 o superior**: el servidor y este lanzador se ejecutan desde el código fuente con
Bun, no desde un artefacto compilado. El paquete trae el código, no la interfaz construida: la interfaz
se construye con `bun run build` desde el repositorio.

## Modo servidor

Para escuchar fuera de loopback hay que dar un token fijo. Sin él, el arranque se niega:

```bash
NN_ANIME_HOST=0.0.0.0 NN_ANIME_PORT=8080 NN_ANIME_NO_OPEN=1 \
NN_ANIME_TOKEN="$(openssl rand -base64 32)" nn-anime start
```

La interfaz se abre en `/login`, que pide el token una vez y deja una cookie `HttpOnly`. El token no
viaja en ninguna URL. `NN_ANIME_PUBLIC_ORIGIN` fija el origen público y marca la cookie `Secure` si es
HTTPS; `NN_ANIME_LOCKED=1` desactiva el alta y activación de plugins desde la interfaz. El inventario
completo está en [`.env.example`](../../.env.example) y la guía de despliegue en
[docs/docker.md](../../docs/docker.md).

## Aviso

**Los plugins se ejecutan con tus permisos y sin sandbox.** Este paquete no incluye ningún proveedor ni
scraper: hasta que copies uno en `~/.config/nn-anime/providers/`, la aplicación arranca y no encuentra
nada. El detalle está en [SECURITY.md](../../SECURITY.md).
