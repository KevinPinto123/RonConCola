'use client';

import { useState, useRef, useEffect } from 'react';
import { Roncito } from '@/components/Roncito';

type Mensaje = {
  autor: 'humano' | 'roncito';
  texto: string;
  motor?: 'claude' | 'heuristica-local';
};

const SUGERENCIAS = [
  '¿Cómo vamos de ventas este mes?',
  '¿Qué productos debería reponer?',
  '¿Qué es lo que más se vende?',
  '¿Cuántos pedidos tengo pendientes?',
  '¿Me conviene llevar stock a la feria?',
];

export function Asistente({ iaActiva }: { iaActiva: boolean }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      autor: 'roncito',
      texto:
        '¡Humana! Pregúntame por las ventas, el stock o los pedidos. ' +
        'Respondo con los números del sistema, no con los que me gustaría que fueran.',
    },
  ]);
  const [pregunta, setPregunta] = useState('');
  const [dias, setDias] = useState(30);
  const [pensando, setPensando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [mensajes, pensando]);

  async function preguntar(texto: string) {
    const limpia = texto.trim();
    if (!limpia || pensando) return;

    setMensajes((m) => [...m, { autor: 'humano', texto: limpia }]);
    setPregunta('');
    setPensando(true);

    try {
      const respuesta = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta: limpia, dias }),
      });

      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.error ?? 'No pude responder.');

      setMensajes((m) => [
        ...m,
        { autor: 'roncito', texto: datos.respuesta, motor: datos.motor },
      ]);
    } catch (e) {
      setMensajes((m) => [
        ...m,
        {
          autor: 'roncito',
          texto: e instanceof Error ? e.message : 'Algo falló. Intenta de nuevo.',
        },
      ]);
    } finally {
      setPensando(false);
    }
  }

  return (
    <div className="space-y-4">
      {!iaActiva && (
        <p className="tarjeta-sutil bg-ron-amarillo-claro p-3 text-xs">
          <strong>Modo demostración:</strong> sin{' '}
          <code className="font-mono">ANTHROPIC_API_KEY</code> las respuestas se arman
          con plantillas locales. Los <strong>números son los mismos</strong> en ambos
          casos: salen de consultas SQL, no del modelo.
        </p>
      )}

      <div className="tarjeta flex h-[62vh] min-h-[420px] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b-[3px] border-ron-negro bg-ron-amarillo px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Roncito tamano={30} animo="alerta" className="text-ron-negro" />
            <span className="display">Roncito</span>
          </div>

          <label className="flex items-center gap-1.5 text-xs font-bold">
            Periodo
            <select
              className="campo !min-h-0 !w-auto !py-1 text-xs"
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
            >
              <option value={7}>7 días</option>
              <option value={30}>30 días</option>
              <option value={90}>90 días</option>
            </select>
          </label>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {mensajes.map((m, i) => (
            <div
              key={i}
              className={`flex gap-2 ${m.autor === 'humano' ? 'justify-end' : 'items-end'}`}
            >
              {m.autor === 'roncito' && (
                <Roncito tamano={34} animo="normal" className="shrink-0 text-ron-negro" />
              )}

              <div
                className={`max-w-[82%] rounded-[1.1rem] border-[2.5px] border-ron-negro px-3 py-2 text-sm ${
                  m.autor === 'humano'
                    ? 'bg-ron-amarillo'
                    : 'bg-white text-ron-negro shadow-[3px_3px_0_#141210]'
                }`}
              >
                <p className="whitespace-pre-wrap font-semibold">{m.texto}</p>

                {m.motor === 'heuristica-local' && (
                  <p className="mt-1 text-[0.65rem] opacity-60">
                    Respuesta armada con plantillas locales
                  </p>
                )}
              </div>
            </div>
          ))}

          {pensando && (
            <div className="flex items-end gap-2">
              <Roncito tamano={34} animo="dormido" className="shrink-0 text-ron-negro" />
              <div className="rounded-[1.1rem] border-[2.5px] border-ron-negro bg-white px-3 py-2 text-sm text-ron-negro">
                <span className="texto-tenue">Mirando los números…</span>
              </div>
            </div>
          )}

          <div ref={finRef} />
        </div>

        <div className="border-t-[3px] border-ron-negro p-3">
          <div className="sin-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
            {SUGERENCIAS.map((s) => (
              <button
                key={s}
                onClick={() => preguntar(s)}
                disabled={pensando}
                className="boton boton-claro boton-chico shrink-0 !text-[0.72rem]"
              >
                {s}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              preguntar(pregunta);
            }}
            className="flex gap-2"
          >
            <input
              className="campo !min-h-0 !py-2 text-sm"
              placeholder="Pregúntale a Roncito…"
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              disabled={pensando}
              maxLength={500}
              aria-label="Tu pregunta"
            />
            <button
              type="submit"
              disabled={pensando || !pregunta.trim()}
              className="boton boton-primario boton-chico"
            >
              Enviar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
