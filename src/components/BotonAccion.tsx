'use client';

import { useState, useTransition } from 'react';
import type { Resultado } from '@/app/panel/acciones';

/**
 * Botón para acciones sin formulario (liberar reservas, por ejemplo).
 *
 * Se bloquea mientras la operación viaja al servidor: así un doble clic
 * nervioso no dispara la misma operación dos veces. De todos modos la
 * base rechazaría la segunda, pero es mejor no llegar a eso.
 */
export function BotonAccion({
  accion,
  etiqueta,
  cargando = 'Procesando…',
  confirmar,
  variante = 'claro',
}: {
  accion: () => Promise<Resultado>;
  etiqueta: string;
  cargando?: string;
  confirmar?: string;
  variante?: 'claro' | 'primario' | 'oscuro' | 'peligro';
}) {
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<Resultado | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pendiente}
        className={`boton boton-chico boton-${variante}`}
        onClick={() => {
          if (confirmar && !window.confirm(confirmar)) return;
          iniciar(async () => setResultado(await accion()));
        }}
      >
        {pendiente ? cargando : etiqueta}
      </button>

      {resultado && (
        <span
          role="status"
          className={`text-xs font-bold ${resultado.ok ? 'text-ron-exito' : 'text-ron-peligro'}`}
        >
          {resultado.mensaje}
        </span>
      )}
    </span>
  );
}
