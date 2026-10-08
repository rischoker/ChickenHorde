# Chicken Horde V9 — Farm Defense (Express + Socket.IO en Render)

La pantalla del proyector es el **host** (corre el juego 3D) y cada estudiante juega con su **celular como control**. Todo pasa por el propio servidor del juego en Render: no hay P2P ni CDNs, así que funciona detrás de los proxies de la academia mientras el dominio de Render esté permitido.

## Novedades V9

- Todo el juego en inglés y con una sola fuente (Bungee).
- **How to Play** con capturas del juego (botón ❓ en el host, el lobby, el celular y la portada).
- **Teclado + mouse**: botón **PLAY ON THIS PC** en el host (WASD mueve, el mouse apunta en el campo 3D, clic/Espacio dispara, flechas apuntan y disparan) y modo teclado automático para invitados en laptop.
- Noche en oleadas 10–19, 30–39… (día 20–29, 40–49…) con aviso "NIGHT FALLS", luciérnagas y tornados de fuego decorativos.
- Mecha Frog (oleada 10+): salta y dispara cohetes teledirigidos.
- Alien Overlord: blink retro, 3 ilusiones (25 % de su vida, solo distraen) y escudo prismático (75 % por 15 s; ilusiones 25 % por 5 s).
- Chupacabras: crece al aparecer y salta sobre jugadores desde la oleada 8 (cráter visual).
- Mushroom King: aparece desde un hongo gigante y lanza lluvia de esporas que crea hongos kamikaze.
- Globos de diálogo temáticos para los jefes y los gnomos; los gnomos van por Mama Hen hasta que un jugador los golpea.
- Chicken Hulk: puede recoger botiquines, al terminar vuelve al estado anterior (no muere) y grita "SMASH".
- Super Chicken con despegue de fuego y cacareo; nuevo gallinero; barra de Mama Hen debajo de la torreta; nuevas armas.

## Editar el código

`src/app.js` es el código fuente; `public/app.js` se genera con `npm run build` (esbuild, compatible con iPhones viejos). Render lo genera solo en cada deploy (`postinstall`).

## Estructura

```
server.js          Express + Socket.IO (salas, relay host⇄celulares, /healthz, /api/scores)
package.json       dependencias: express, socket.io, compression, esbuild
build.js           compila src/app.js → public/app.js
src/app.js         código fuente del juego (host + control)
render.yaml        blueprint de Render (opcional)
public/            el juego (index.html, app.js, renderer3d.mjs, style.css, assets/)
public/vendor/     three.js, socket.io.min.js y qrcode.js locales (sin CDNs)
supabase/          SQL de la tabla del leaderboard global
```

## Desplegar en Render

1. Sube esta carpeta a un repositorio de GitHub (por ejemplo `rischoker/ChickenHorde`).
2. Render → **New → Web Service** → elige el repo.
   - Runtime: **Node** · Build: `npm install` · Start: `npm start`
   - Health Check Path: `/healthz`
   - (O usa **New → Blueprint** y Render lee `render.yaml`.)
3. Abre `https://TU-SERVICIO.onrender.com/?host=1` (o `/host`) en el PC del proyector. Los estudiantes escanean el QR.

Variables opcionales: `SUPABASE_URL` y `SUPABASE_KEY` (ya traen tu proyecto por defecto), `PORT` (Render la pone sola).

**Plan gratis de Render:** el servicio se duerme tras ~15 min sin uso y tarda ~30–50 s en despertar. Abre `/healthz` o la pantalla host unos minutos antes de la clase. Si un reinicio ocurre en plena partida, el host recupera el mismo código de sala y los celulares vuelven solos.

## Probar en local

```
npm install
npm start          # http://localhost:3000/?host=1
```
Para probar con celulares en la misma Wi-Fi: `http://IP-DEL-PC:3000/?host=1`.

## Conexión y reconexión

- Socket.IO empieza con HTTPS long-polling y sube a WebSocket cuando la red lo permite (ideal para proxies).
- **Celular** se cae (Wi-Fi, pantalla bloqueada, cambio de app): se reconecta solo, vuelve a entrar a la sala y el host le devuelve el mismo pollito, color y puntaje (ventana de 45 s). Al volver a la app reconecta al instante.
- **Pantalla host** se cae o se recarga: la sala se mantiene 3 minutos; al volver recupera el mismo código y los celulares se re-enlazan sin escanear de nuevo. (Si se recarga la página, la partida en curso se reinicia.)
- **Servidor** reinicia: el host pide su mismo código y los celulares que siguen intentando entran otra vez.
- `GET /healthz` → `{ ok, uptime, rooms, sockets }`.

## Leaderboard global

El host envía y lee los puntajes a través de `/api/scores` en este servidor, que los guarda en Supabase. Así el PC del aula solo necesita llegar al dominio de Render. Si Supabase no responde, se muestra el récord local (pestaña THIS PC).
Tabla: ejecuta una vez `supabase/migrations/20261001000000_global_leaderboard.sql` en Supabase → SQL Editor.

## Controles

- Joystick izquierdo: mover · Joystick derecho: apuntar y disparar.
- Escritorio: WASD/flechas, mouse para apuntar, clic o espacio para disparar.
- `&fx=1` activa el bloom opcional en el host.

## V7.3 — Nuevas armas y ajustes
- **CHICKEN SEEKER**: el Mushroom King de la ola 8 lo suelta al 100%, y de nuevo cada 5 olas (13, 18, 23…). Lanzacohetes con misiles rastreadores: mismo alcance que la metralleta, 3 de daño por misil (laser 2 + 50%), ráfaga más lenta (260 ms; 150 ms con Rapid Fire). Los misiles vuelan por encima de los obstáculos. Se pierde al caer, igual que el láser.
- **CHICKEN HULK**: cae solo en la ola 8 y luego cada 8 olas (16, 24…). Dura hasta el final de esa ola; al empezar la siguiente el jugador vuelve a la normalidad con todo lo que tenía antes. Pollito 50% más grande, verde oscuro con brillo verde, solo golpes cuerpo a cuerpo con un "pío pío" muy grave, **dash** automático hacia el enemigo al que apunta (hasta ~260 de distancia, cada 1.1 s), 60% menos daño recibido y no puede recoger power-ups. Mata enemigos normales de un golpe; los elites reciben triple daño (9 por golpe).
- **Plantas**: una semilla brillante cae, se entierra en un montículo y la planta brota (~2 s) antes de poder disparar o recibir daño. Su daño bajó 10%.
- El cartel de MAMA HEN se mueve a un lado del gallinero cuando la Chicken Turret está activa.
- Voces: `assets/audio/powerup-seeker.mp3` y `assets/audio/powerup-hulk.mp3`.

## V7.1 — Ajustes
- Aliens (los que disparan láser) 50% más grandes, en grupos de máximo 3 y con la mitad de alcance del láser (335).
- Medkit: si quien lo recoge tiene 99–100% de vida, cura a Mama Hen +20%.
- Sonido mágico de teletransporte para los magos.
- Sonidos propios: `powerup-laser.mp3`, `powerup-turret.mp3`, `powerup-medkit.mp3`, `next-wave.mp3`, `super-chicken.mp3`.
- Se quitaron los árboles de las esquinas y los bordes; los power-ups que caen junto a un obstáculo se mueven al punto libre más cercano.
- Contador gigante rojo 3-2-1 en el centro; al terminar suena `next-wave.mp3` y aparece "WAVE N".
- **SUPER CHICKEN** (1 vez por partida): cuando Mama Hen llega al 15% lanza un huevo-cohete gigante al centro del mapa; la explosión hace un flash blanco y elimina a todos los enemigos presentes (no a los que aún no salen). Mama Hen es invulnerable durante el vuelo del huevo.
- QR del lobby más grande; al pasar el puntero (o tocarlo) se muestra a pantalla grande.

## V7 — Novedades

**Arreglos urgentes (iPhone)**
- El nombre ya acepta todas las letras: el control de teclado (WASD/espacio) bloqueaba A, D, W, S y espacio incluso mientras se escribía.
- El mando del teléfono ya no hace zoom: se bloquean pinch, doble toque y gestos de iOS (Safari ignora `user-scalable=no`).

**Nuevas mecánicas**
- **Chicken Turret**: al matar al Chupacabras de la ola 5 cae una torreta (no expira). Al recogerla se monta en el techo del gallinero y dispara a velocidad normal al enemigo más cercano el resto de la partida.
- **Chicken Laser** (desde la ola 6, máximo 1 por ola): rayo de corto alcance con doble daño; atraviesa cercas/heno pero no árboles ni rocas. Se conserva hasta que el jugador cae.
- **Elites nuevos**: Mushroom King (1 por ola desde la 8, lanza anillos de esporas) y Alien Overlord (1 por ola desde la 10, triple rayo y teletransporte). Aparecen a mitad de ola.
- **Resurrección**: párate bajo el pollito caído; un círculo de carga de 5 s lo revive (60 HP + escudo breve). Si te alejas, el progreso se reinicia.
- **Topos**: un hoyo con tierra temblando aparece ~1.7 s antes de que salga el topo (no se le puede dañar mientras emerge).

**Mejoras visuales**
- Mapa pintado con caminos de tierra, patio del gallinero, flores y variación de pasto; el pasto y los árboles se mueven con el viento; efectos brillantes con sprites de luz. El bloom opcional se activa con `&fx=1` (apagado por defecto porque en algunas pantallas dejaba el canvas verde).
- Obstáculos coherentes con la granja: rocas y árboles bloquean todo; pacas de heno y troncos son **cobertura baja** (bloquean el paso de la horda, pero las balas pasan por encima) para canalizar a los enemigos.
- Power-ups rediseñados en 3D con pilar de luz, anillo pulsante, etiqueta y parpadeo antes de desaparecer.
- Sonido "peep peep" cuando un pollito recibe daño (y vibración en teléfonos Android).
- Mama Hen más grande con animación de cacareo y bocadillo **CLUCK!!** cuando la atacan.
- Pollitos con colores aleatorios bien separados, animación de caminar/respirar/retroceso al disparar; el arma se sostiene a un lado (ya no atraviesa el cuerpo).
- Lobby con escenario 3D donde baila el pollito de cada jugador; el teléfono muestra el color de tu pollito, tu vida y el estado de resurrección.
- Lobos más grandes, águilas ya no vuelan de espaldas (y aletean), animaciones procedurales para zorros, fantasmas, plantas, aliens y magos; nuevo tornado y nuevo mago (modelos GLB); teletransporte con columna de luz y partículas.
- Nameplates de elites del mismo tamaño que los de jugadores, con color y símbolo propio (calavera, corona, estrella).


