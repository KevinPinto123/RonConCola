'use client';

import { createBrowserClient } from '@supabase/ssr';
import { exigirSupabase } from '@/lib/entorno';

/**
 * Cliente de Supabase para el navegador.
 *
 * Usa la llave publicable, que por diseño es visible para cualquiera.
 * Eso no es un problema aquí: las políticas RLS y las funciones
 * SECURITY DEFINER de la migración 004 definen qué se puede hacer con
 * ella. Leer el catálogo: sí. Cambiar un precio o un stock: no.
 */
let instancia: ReturnType<typeof createBrowserClient> | null = null;

export function clienteNavegador() {
  if (!instancia) {
    const { url, anonKey } = exigirSupabase();
    instancia = createBrowserClient(url, anonKey);
  }
  return instancia;
}
