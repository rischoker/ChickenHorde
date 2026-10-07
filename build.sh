#!/usr/bin/env bash
# Descarga la última versión de cada juego e instala lo necesario.
# Si un juego no se puede descargar (repo renombrado, privado, caído…), se omite y el arcade sigue funcionando.
set -u
VERSIONS=""
FAILED=""

note_version () {   # $1 = clave, $2 = carpeta con .git
  VERSIONS="$VERSIONS\"$1\":$(git -C "$2" log -1 --format='{"hash":"%h","date":"%cI"}'),"
}

clone () {          # $1 = repo en GitHub, $2 = carpeta destino
  rm -rf "$2"
  if git clone --depth 1 "https://github.com/rischoker/$1.git" "$2"; then
    echo ">> $1: $(git -C "$2" log -1 --format='%h · %cd · %s' --date=format:'%Y-%m-%d %H:%M')"
    note_version "$(basename "$2" | tr A-Z a-z)" "$2"
    rm -rf "$2/.git"
  else
    echo "!! $1: no se pudo descargar, se omite"; rm -rf "$2"; FAILED="$FAILED $1"
  fi
}

version_only () {   # juegos que viven en otro servicio: solo se anota su versión
  local tmp=".tmp_$2"; rm -rf "$tmp"
  if git clone --depth 1 --filter=blob:none --no-checkout "https://github.com/rischoker/$1.git" "$tmp" 2>/dev/null; then
    echo ">> $1 (servicio aparte): $(git -C "$tmp" log -1 --format='%h · %cd · %s' --date=format:'%Y-%m-%d %H:%M')"
    note_version "$2" "$tmp"
  else
    echo "!! $1: no se pudo leer su versión"
  fi
  rm -rf "$tmp"
}

# Juegos estáticos (se sirven tal cual)
clone Battlecity   battlecity
clone planetcat    planetcat
clone flappyverbs  flappyverbs
clone wordclimbers wordclimbers

# Juegos con servidor dentro del arcade
clone castlequest  apps/castlequest
if [ -d apps/castlequest ]; then
  (cd apps/castlequest && npm install --omit=dev --no-audit --no-fund) || { echo "!! castlequest: falló npm install, se omite"; rm -rf apps/castlequest; FAILED="$FAILED castlequest"; }
fi

clone DuelArena    apps/duelarena
if [ -d apps/duelarena ]; then
  (cd apps/duelarena && npm install --omit=dev --no-audit --no-fund) || { echo "!! DuelArena: falló npm install, se omite"; rm -rf apps/duelarena; FAILED="$FAILED DuelArena"; }
fi

# Juegos en su propio servicio de Render (solo versión para la cinta "ACTUALIZADO")
version_only ChickenHorde chickenhorde     # https://chicken-horde.onrender.com

# Versión de cada juego (el hub muestra "ACTUALIZADO" en la tarjeta)
echo "{${VERSIONS%,}}" > versions.json

# Dependencias del arcade (esto sí es obligatorio)
set -e
npm install --omit=dev --no-audit --no-fund

[ -n "$FAILED" ] && echo "!! Juegos omitidos en este deploy:$FAILED" || echo ">> Todos los juegos listos"
