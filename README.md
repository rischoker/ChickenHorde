# Rischoker Arcade

Hub de juegos estilo consola + servidor que sirve todos los juegos desde un solo dominio de Render:

| Ruta | Juego | Tipo |
|---|---|---|
| `/` | Hub (menú) | estático |
| `chicken-horde.onrender.com` | Chicken Horde | servicio propio en Render (el hub enlaza y lo despierta) |
| `/planetcat/` | Gato Swing | estático |
| `/battlecity/` | Battle City 3D | estático |
| `/flappyverbs/` | Flappy Verbs | estático |
| `/wordclimbers/` | Word Climbers | estático |
| `/castlequest/` | Castle Quest | con servidor (celulares en `/play`) |
| `/duelarena/` | Duel Arena | con servidor (celulares en `/duelarena/play.html`) |

## Publicar en Render (Web Service)

- **New → Blueprint** y eliges este repo (Render lee `render.yaml`), o bien **New → Web Service** con:
  - **Build Command:** `bash build.sh`
  - **Start Command:** `node server.js`
  - **Health Check Path:** `/health`
- **Environment** (opcional, para la clasificación mundial de Castle Quest): `SUPABASE_URL` y `SUPABASE_KEY`.

`build.sh` descarga la última versión de cada juego desde GitHub en cada despliegue.

## Si un juego falla al descargar

`build.sh` lo omite y el resto del arcade se publica igual. Al final del log aparece `!! Juegos omitidos en este deploy: …`.

## Actualizar los juegos

Haz push al repo del juego y luego, en Render: **Manual Deploy → Deploy latest commit**.

## Agregar un juego

- **Estático:** agrega una línea `clone <repo> <carpeta>` en `build.sh` y su bloque en `GAMES` dentro de `index.html`.
- **Con servidor:** agrega `clone <repo> apps/<carpeta>` (y su `npm install`) en `build.sh`, y un bloque en `APPS` dentro de `server.js` con su puerto y las rutas que usa.

## Plan gratis

El servicio se duerme tras 15 minutos sin visitas y tarda cerca de un minuto en despertar. Abre el arcade un minuto antes de la clase.
