#!/usr/bin/env bash
# ============================================================
# Levanta un Postgres limpio en Docker, aplica las migraciones,
# carga los datos de demostración y corre la prueba del flujo
# completo. No toca Supabase ni ningún dato real.
#
#   bash supabase/pruebas/correr.sh
# ============================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash en Windows no debe reescribir las rutas del contenedor

CONTENEDOR=rcc-pg
BD=ronconcola
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▸ Levantando Postgres de prueba…"
if ! docker inspect "$CONTENEDOR" >/dev/null 2>&1; then
  docker run -d --name "$CONTENEDOR" \
    -e POSTGRES_PASSWORD=ron -e POSTGRES_DB="$BD" \
    -p 55432:5432 postgres:16-alpine >/dev/null
fi
docker start "$CONTENEDOR" >/dev/null 2>&1 || true

for _ in $(seq 1 60); do
  docker exec "$CONTENEDOR" pg_isready -U postgres -d "$BD" >/dev/null 2>&1 && break
  sleep 1
done

echo "▸ Copiando el SQL al contenedor…"
docker exec "$CONTENEDOR" rm -rf /sql
# Desde el directorio padre y con ruta relativa: en Windows, los dos puntos
# de "C:\..." confunden a docker cp, que los lee como separador origen:destino.
( cd "$RAIZ/.." && docker cp "$(basename "$RAIZ")" "$CONTENEDOR:/sql" >/dev/null )

echo "▸ Partiendo de una base vacía…"
docker exec "$CONTENEDOR" psql -U postgres -d "$BD" -q \
  -c "drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;" >/dev/null

correr() {
  echo "   · $1"
  docker exec "$CONTENEDOR" psql -U postgres -d "$BD" -v ON_ERROR_STOP=1 -q -f "/sql/$1" 2>&1 \
    | grep -Ev '^(NOTICE|DETAIL|psql:.*NOTICE)' || true
}

echo "▸ Aplicando migraciones…"
correr pruebas/00_stub_auth.sql
correr migraciones/001_esquema.sql
correr migraciones/002_funciones.sql
correr migraciones/003_vistas_kpis_importacion.sql
correr migraciones/004_seguridad.sql

echo "▸ Cargando datos de demostración…"
correr datos-demo/semilla.sql

echo "▸ Ejecutando la prueba del flujo completo…"
echo
docker exec "$CONTENEDOR" psql -U postgres -d "$BD" -v ON_ERROR_STOP=1 -q \
  -f "/sql/pruebas/01_flujo_completo.sql" 2>&1 \
  | sed 's/^psql:[^ ]*:[0-9]*: //' \
  | grep -Ev '^(DETAIL|CONTEXT|HINT)'
