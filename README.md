# Chicken Horde V7.2 3D — Farm Defense

Static multiplayer game for GitHub Pages. The host runs the match; phones join as controllers through PeerJS/WebRTC. The game keeps the V5.2 rules and changes the host rendering to real-time 3D.

## V7.2 — Leaderboard global (Supabase)
1. **Crear la tabla** (elige una):
   - Supabase → *SQL Editor* → *New query* → pega `supabase/migrations/20261001000000_global_leaderboard.sql` → *Run*.
   - O con la integración de GitHub activada (working directory `.`, rama `main`): al hacer push de la carpeta `supabase/` la tabla se crea sola.
2. **Copiar las claves**: Supabase → *Project Settings* → *API* (o *Data API*): copia el *Project URL* y la clave pública **anon / publishable**. Nunca uses la `service_role` / `secret`.
3. En `index.html` pon: `supabaseUrl: 'https://xxxx.supabase.co', supabaseKey: 'eyJ…'`.

Cada Game Over envía el puntaje de cada jugador. El lobby y el Game Over muestran pestañas 🌎 GLOBAL · 7 DAYS · THIS PC (la última es el récord local de antes). Si Supabase no responde, se muestra el récord local. La tabla solo permite leer e insertar (no editar ni borrar) y rechaza puntajes imposibles para la ola alcanzada.

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

## Conexión en redes con proxy (servidor relay)

Las librerías (three.js, PeerJS y el generador QR) ahora están en `vendor/`, así que el juego no depende de CDNs que un proxy pueda bloquear.

Cada partida intenta **P2P (WebRTC)** primero y, si en ~4.5 s no conecta, cambia automáticamente al **relay por WebSocket** (puerto 443, igual que una página web normal). El lobby muestra el estado `P2P` y `RELAY`, y cada jugador indica por cuál vía está conectado.

**Opción recomendada: un solo servicio en Render (gratis)**
1. Sube todo este proyecto a GitHub.
2. En render.com → *New Web Service* → elige el repo (deja *Root Directory* vacío). Build: `npm install`. Start: `npm start`.
3. En `index.html` cambia `relayUrl: ''` por `relayUrl: 'same-origin'`.
4. Abre `https://TU-SERVICIO.onrender.com/?host=1`. El servidor sirve el juego y el relay a la vez.

**Opción GitHub Pages + relay aparte**: despliega solo `server/` en Render/Railway/Fly y pon `relayUrl: 'wss://TU-SERVICIO.onrender.com'` en `index.html`. También puedes probar sin editar nada con `?host=1&relay=wss://TU-SERVICIO.onrender.com` (el QR incluye el parámetro).

Notas: el plan gratis de Render "duerme" el servicio tras inactividad; abre `/health` unos segundos antes de jugar para despertarlo. Si tu red además permite TURN, puedes añadir servidores en `iceServers`.

## Publish on GitHub Pages

1. Upload this folder's contents to the repository root or a Pages-enabled folder.
2. Enable GitHub Pages for that branch/folder.
3. Open `https://<username>.github.io/<repository>/?host=1` on the host computer.
4. Players scan the lobby QR code and enter a name. The lobby stays open until the host presses **START GAME**. After Game Over, **RETURN TO LOBBY** keeps the same room, QR code, and roster.
5. The lobby preloads the 3D models before enabling the start button.

## Camera and visuals

- Fixed, tilted top-down 3D perspective inspired by the reference image.
- Dynamic camera follows the player group while keeping Mama Hen in view; it zooms out as players spread apart and eases back in when they regroup.
- Real GLB models for the player chicken, Mama Hen, fox, wolf, eagle, snake, Chupacabras, eggs, house, ground, grass, trees, and rocks. The rifle is loaded from OBJ/MTL. Missing model files fall back to simple 3D shapes.
- Nameplates, health bars, player color, shield, damage flashes, angel-style player death animation, stylized enemy blood splashes, projectiles, enemy attacks, tornadoes, and wave countdown render in the 3D scene. Lobby player models are enlarged for easier recognition. Battle fog softens the outer 10% of the arena and blends into an extended pasture plane; the center and outer map have additional obstacle lanes. Grass tufts are rendered as instanced meshes to increase ground detail with few draw calls. Enemy health bars are depth-tested so they do not float through the house or other scenery.
- The models and textures are loaded from local files in `assets/models`; Three.js itself is loaded from jsDelivr.

## Preserved gameplay

- Infinite waves with a 3-second countdown and groups of enemies. Enemy count increases 25% for each player after the first.
- All enemies, including Chupacabras, use the same speed on every wave. Enemy damage is reduced by 60%. V6.2.4 reduced enemy speed by a further 15%. Foxes jump, wolves attack in packs, eagles dive, snakes arrive in groups, and the later waves include moles, aliens, mages, ghosts, plants, and tornadoes. Chupacabras appears at wave 5 and rarely as an elite from wave 6 onward, with an eye-fire attack. Mole, tornado, alien, mage, ghost, and plant enemies use visible procedural 3D models, so separate GLB files are optional.
- Drops use a 10% chance per defeated enemy: shield, occasional medkit, permanent non-stacking double-shot, or permanent non-stacking rapid-fire. Double-shot now makes up 25% of successful power-up drops. Duplicate shot upgrades do not stack. Shield, double-shot, and rapid-fire pickups each play their supplied sound effect when SFX is enabled.
- At most two tornadoes spawn in a wave. Tornadoes deal 2 damage per contact, grow while aiming toward the henhouse, then dash across the map. Four nearby boulders provide defensive cover and block movement/projectiles. Moles and plants pressure the center.
- Mama Hen heals 8% after each completed wave. Player movement remains 15% faster; aiming auto-fires rapidly while held.
- Background music (Farm Rave) has its own play toggle and volume slider. Sound effects have a separate toggle; the chick death cue is synthesized with Web Audio.

## Controls

- Left virtual stick: move.
- Right virtual stick: aim and rapid-fire while held off-center.
- Desktop: WASD/arrows to move, mouse to aim, hold left-click or Space to fire.

## Files

- `index.html`: host lobby and phone controller; includes the Three.js import map.
- `app.js`: multiplayer, controls, waves, enemy AI, combat, drops, audio, and scoring.
- `renderer3d.mjs`: Three.js scene, dynamic camera, model preloader, and game rendering.

## V6.2.5 fixes

- Wolf, snake, and Chupacabras GLB skeletons now play their walk/run animations. Frustum culling is disabled for skinned meshes so stale bind-pose bounds cannot make moving models disappear.
- Tornado contact damage is fixed at 2 points per hit.
- `style.css`: responsive host and mobile controller styles.
- `assets/models/`: GLB, GLTF, OBJ/MTL models and required buffers/textures.

## Multiplayer notes

Pages and game assets are static. PeerJS is loaded from its public CDN and uses its public signaling service to establish browser-to-browser WebRTC connections. Internet access is needed for the CDN and signaling. The host retains disconnected players for 45 seconds. Controllers keep a stable local player ID and retry with backoff; if they reconnect during this window, their player and score are preserved. The host can kick a player from the lobby roster or from the PLAYERS menu during a match. An idle connection is treated as lost after 12 seconds, then kept for the 45-second reconnect window. A QR join panel is available from the host toolbar during a match and supports hover, keyboard focus, and tap.

PeerJS/WebRTC can retry signaling and recover brief dropouts, but browser-only static hosting cannot bypass networks that block WebRTC or require a TURN relay. For restrictive school proxies, configure a dedicated PeerServer plus TURN service; retry logic alone cannot make blocked UDP/TCP relay traffic pass.

## Asset credits

Forest models/texture: Kay Lousberg, KayKit Forest Nature Pack (CC0 1.0). Floor Grass Sliced B: Isa Lousberg. Grass and Shack: Quaternius. Fertile soil: Frank Lynam. Egg and animal models retain their original creator attribution from the supplied files.

- Power-up pickup audio is stored locally in `assets/audio/powerup-shield.mp3`, `powerup-double-shot.mp3`, and `powerup-rapid-fire.mp3` for static GitHub Pages hosting.

## V6.2.5 readability update

- The dynamic camera stays about 24% closer at any player spread. Player nameplates are substantially larger, with larger text and health bars that remain proportionate and auto-fit long names.
