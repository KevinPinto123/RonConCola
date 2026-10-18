'use client';

import { useState } from 'react';
import { soles } from '@/lib/dinero';

type Punto = { dia: string; total_centimos: number; operaciones: number };

/**
 * Ventas por día.
 *
 * Una sola serie, así que no lleva leyenda: el título ya dice qué se está
 * mirando. Las barras se anclan en la base, llevan el amarillo de la marca
 * con contorno negro (se distinguen igual en modo claro y oscuro) y el
 * valor aparece al pasar el cursor, para no tapar el gráfico con números.
 */
export function GraficoVentas({ datos }: { datos: Punto[] }) {
  const [activo, setActivo] = useState<number | null>(null);

  if (!datos.length) {
    return (
      <p className="py-10 text-center text-sm texto-tenue">
        Todavía no hay ventas registradas en este periodo.
      </p>
    );
  }

  const maximo = Math.max(...datos.map((d) => d.total_centimos), 1);
  const diaPico = datos.reduce((a, b) => (b.total_centimos > a.total_centimos ? b : a));

  // Geometría en unidades del viewBox; el SVG escala al ancho disponible.
  const ancho = 100;
  const alto = 42;
  const baseY = alto - 7; // deja aire abajo para las fechas
  const topeY = 5;
  const paso = ancho / datos.length;
  const anchoBarra = Math.max(paso - 1.6, 0.8); // ~2px de respiro entre barras

  const formatearDia = (iso: string) => {
    const [, mes, dia] = iso.split('-');
    return `${dia}/${mes}`;
  };

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${ancho} ${alto}`}
          className="w-full"
          style={{ height: '220px' }}
          role="img"
          aria-label={`Ventas diarias de los últimos ${datos.length} días. Máximo ${soles(maximo)} el ${diaPico.dia}.`}
          onMouseLeave={() => setActivo(null)}
        >
          {/* Rejilla discreta: orienta sin competir con los datos */}
          {[0, 0.5, 1].map((f) => {
            const y = baseY - (baseY - topeY) * f;
            return (
              <line
                key={f}
                x1="0"
                x2={ancho}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.15"
                opacity="0.18"
              />
            );
          })}

          {datos.map((d, i) => {
            const altura = (d.total_centimos / maximo) * (baseY - topeY);
            const x = i * paso + (paso - anchoBarra) / 2;
            const y = baseY - altura;
            const resaltado = activo === i;

            return (
              <g key={d.dia}>
                {/* Zona sensible: más ancha que la barra, para acertar con el dedo */}
                <rect
                  x={i * paso}
                  y={0}
                  width={paso}
                  height={baseY}
                  fill="transparent"
                  onMouseEnter={() => setActivo(i)}
                  onFocus={() => setActivo(i)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.dia}: ${soles(d.total_centimos)} en ${d.operaciones} operaciones`}
                  style={{ cursor: 'pointer', outline: 'none' }}
                />
                {d.total_centimos > 0 && (
                  <rect
                    x={x}
                    y={y}
                    width={anchoBarra}
                    height={Math.max(altura, 0.4)}
                    rx="0.6"
                    fill="var(--color-ron-amarillo)"
                    stroke="currentColor"
                    strokeWidth={resaltado ? '0.6' : '0.35'}
                    opacity={activo === null || resaltado ? 1 : 0.55}
                    style={{ transition: 'opacity 0.12s ease' }}
                  />
                )}
              </g>
            );
          })}

          {/* Línea de base, el ancla visual de las barras */}
          <line
            x1="0"
            x2={ancho}
            y1={baseY}
            y2={baseY}
            stroke="currentColor"
            strokeWidth="0.3"
            opacity="0.5"
          />

          {/* Sólo el primer y el último día: más fechas se vuelven ilegibles */}
          <text x="0" y={alto - 1.5} fontSize="2.4" fill="currentColor" opacity="0.6">
            {formatearDia(datos[0].dia)}
          </text>
          <text
            x={ancho}
            y={alto - 1.5}
            fontSize="2.4"
            textAnchor="end"
            fill="currentColor"
            opacity="0.6"
          >
            {formatearDia(datos[datos.length - 1].dia)}
          </text>
        </svg>

        {/* Detalle del día señalado */}
        <div className="mt-1 min-h-[2.6rem] text-sm" aria-live="polite">
          {activo !== null ? (
            <span className="tarjeta-sutil inline-block px-2.5 py-1">
              <strong className="display">{formatearDia(datos[activo].dia)}</strong>
              {' · '}
              {soles(datos[activo].total_centimos)}
              {' · '}
              <span className="texto-tenue">
                {datos[activo].operaciones}{' '}
                {datos[activo].operaciones === 1 ? 'operación' : 'operaciones'}
              </span>
            </span>
          ) : (
            <span className="texto-tenue">
              Mejor día: {formatearDia(diaPico.dia)} con {soles(diaPico.total_centimos)}.
              <span className="hidden sm:inline"> Pasa el cursor por una barra para ver el detalle.</span>
            </span>
          )}
        </div>
      </div>
    </figure>
  );
}
