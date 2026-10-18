import { NextResponse } from 'next/server';
import { clienteServidor, perfilActual } from '@/lib/supabase/servidor';
import { responderPregunta } from '@/lib/ia';
import type { Kpis } from '@/lib/tipos';

/**
 * POST /api/asistente
 *
 * El asistente comercial. El orden importa y es el punto clave:
 *
 *   1. Postgres calcula los indicadores (kpis_resumen).
 *   2. Esos números, ya calculados, se le pasan al modelo.
 *   3. El modelo sólo los interpreta y redacta.
 *
 * El modelo nunca consulta la base ni estima cifras por su cuenta,
 * así que no puede inventar una venta que no ocurrió.
 */
export async function POST(peticion: Request) {
  const perfil = await perfilActual();
  if (!perfil) {
    return NextResponse.json({ error: 'Necesitas iniciar sesión.' }, { status: 401 });
  }

  let cuerpo: { pregunta?: string; dias?: number };
  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: 'El cuerpo no es JSON válido.' }, { status: 400 });
  }

  const pregunta = String(cuerpo.pregunta ?? '').trim();
  if (!pregunta) {
    return NextResponse.json({ error: 'Escribe una pregunta.' }, { status: 400 });
  }
  if (pregunta.length > 500) {
    return NextResponse.json({ error: 'La pregunta es demasiado larga.' }, { status: 400 });
  }

  const dias = Math.min(Math.max(Number(cuerpo.dias) || 30, 1), 365);

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc('kpis_resumen', { p_dias: dias });

  if (error) {
    return NextResponse.json(
      { error: `No pudimos leer los indicadores: ${error.message}` },
      { status: 500 },
    );
  }

  const { motor, respuesta } = await responderPregunta(pregunta, data as Kpis);

  return NextResponse.json({ respuesta, motor, periodo_dias: dias });
}
