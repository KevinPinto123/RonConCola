/**
 * Un solo lugar donde se leen las variables de entorno.
 *
 * Regla de la casa: si falta una credencial, el sistema lo dice con
 * nombre y apellido en vez de inventarse un valor o fallar en silencio.
 * Así nadie se lleva la sorpresa de que "funcionaba en la demo".
 */

export type EstadoIntegracion = {
  nombre: string;
  listo: boolean;
  /** Variables que faltan, con el nombre exacto que va en el .env */
  faltan: string[];
  /** Qué hace el sistema mientras tanto */
  sinCredencial: string;
};

function leer(nombre: string): string | undefined {
  const valor = process.env[nombre];
  return valor && valor.trim() !== '' ? valor.trim() : undefined;
}

// ---------------------------------------------------------------
// Supabase: imprescindible. Sin esto no hay tienda ni panel.
// ---------------------------------------------------------------
export const SUPABASE_URL = leer('NEXT_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = leer('NEXT_PUBLIC_SUPABASE_ANON_KEY');

export const supabaseConfigurado = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function exigirSupabase(): { url: string; anonKey: string } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const faltan = [
      !SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
      !SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ].filter(Boolean);
    throw new Error(
      `Falta configurar Supabase. Define en .env.local: ${faltan.join(', ')}. ` +
        'Copia .env.example y sigue INSTALACION.md.',
    );
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}

// ---------------------------------------------------------------
// WhatsApp: el pedido se coordina por ahí.
//
// NO hay número por defecto a propósito. Poner uno inventado haría
// que los pedidos de prueba le lleguen a un desconocido.
// ---------------------------------------------------------------
export const WHATSAPP_NUMERO = leer('NEXT_PUBLIC_WHATSAPP_NUMERO');

export const whatsappConfigurado = Boolean(WHATSAPP_NUMERO);

// ---------------------------------------------------------------
// Claude: redacta sugerencias y responde preguntas del asistente.
//
// Sin la llave el sistema NO se cae: usa reglas locales deterministas
// (similitud de texto en Postgres y plantillas). Eso sí, lo dice en
// pantalla para que nadie confunda una heurística con la IA.
// ---------------------------------------------------------------
export const ANTHROPIC_API_KEY = leer('ANTHROPIC_API_KEY');
export const MODELO_IA = leer('MODELO_IA') ?? 'claude-sonnet-5-5';

export const iaConfigurada = Boolean(ANTHROPIC_API_KEY);

// ---------------------------------------------------------------
// Resumen para mostrar en el panel
// ---------------------------------------------------------------
export function estadoIntegraciones(): EstadoIntegracion[] {
  return [
    {
      nombre: 'Base de datos (Supabase)',
      listo: supabaseConfigurado,
      faltan: [
        !SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
        !SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ].filter(Boolean) as string[],
      sinCredencial: 'La tienda y el panel no pueden funcionar sin esto.',
    },
    {
      nombre: 'WhatsApp',
      listo: whatsappConfigurado,
      faltan: whatsappConfigurado ? [] : ['NEXT_PUBLIC_WHATSAPP_NUMERO'],
      sinCredencial:
        'El pedido igual se guarda con su código, pero el botón de WhatsApp queda desactivado ' +
        'hasta que se cargue el número real del negocio.',
    },
    {
      nombre: 'Asistente con IA (Claude)',
      listo: iaConfigurada,
      faltan: iaConfigurada ? [] : ['ANTHROPIC_API_KEY'],
      sinCredencial:
        'Modo demostración: las categorías y los duplicados se proponen con reglas locales ' +
        '(similitud de texto en la base). Los números del tablero no cambian: se calculan en SQL.',
    },
  ];
}
