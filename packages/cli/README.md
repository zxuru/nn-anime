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

## Aviso

**Los plugins se ejecutan con tus permisos y sin sandbox.** Este paquete no incluye ningún proveedor ni
scraper: hasta que copies uno en `~/.config/nn-anime/providers/`, la aplicación arranca y no encuentra
nada. El detalle está en [SECURITY.md](../../SECURITY.md).
