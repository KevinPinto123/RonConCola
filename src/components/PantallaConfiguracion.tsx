import { Roncito } from '@/components/Roncito';
import { estadoIntegraciones } from '@/lib/entorno';

/**
 * Pantalla de primer arranque.
 *
 * Si falta una credencial, esto aparece en lugar de un error genérico:
 * dice exactamente qué variable falta y qué hacer. Es la diferencia
 * entre "algo falló" y "copia .env.example y pon esta línea".
 */
export function PantallaConfiguracion({ error }: { error?: string }) {
  const integraciones = estadoIntegraciones();

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="tarjeta overflow-hidden">
        <div className="border-b-[3px] border-ron-negro bg-ron-amarillo px-6 py-7 text-center">
          <Roncito tamano={92} animo="alerta" className="mx-auto text-ron-negro" />
          <h1 className="display mt-3 text-2xl">Falta conectar la base de datos</h1>
          <p className="mt-1 text-sm font-bold opacity-75">
            Roncito no atiende hasta que el sistema esté enchufado.
          </p>
        </div>

        <div className="space-y-4 p-6">
          {error && (
            <p className="tarjeta-sutil border-ron-peligro bg-red-50 p-3 text-sm font-bold text-ron-peligro">
              {error}
            </p>
          )}

          <ul className="space-y-3">
            {integraciones.map((i) => (
              <li key={i.nombre} className="tarjeta-sutil p-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-bold">{i.nombre}</span>
                  <span className={`etiqueta ${i.listo ? 'etiqueta-listo' : 'etiqueta-espera'}`}>
                    {i.listo ? 'Listo' : 'Falta'}
                  </span>
                </div>

                {!i.listo && (
                  <div className="mt-2 text-xs">
                    <p className="font-bold">Variables que faltan:</p>
                    <ul className="mt-1 space-y-0.5">
                      {i.faltan.map((v) => (
                        <li key={v}>
                          <code className="rounded bg-ron-gris px-1.5 py-0.5 font-mono text-[0.72rem] text-ron-negro">
                            {v}
                          </code>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 texto-tenue">{i.sinCredencial}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="tarjeta-sutil bg-ron-amarillo-claro p-4 text-sm">
            <p className="display mb-2">Cómo arreglarlo</p>
            <ol className="space-y-1.5 text-xs">
              <li>
                <strong>1.</strong> Copia <code className="font-mono">.env.example</code> a{' '}
                <code className="font-mono">.env.local</code>.
              </li>
              <li>
                <strong>2.</strong> Completa los valores desde Supabase → Project Settings → API.
              </li>
              <li>
                <strong>3.</strong> Pega{' '}
                <code className="font-mono">supabase/INSTALAR_TODO.sql</code> en el editor
                SQL de Supabase y ejecútalo.
              </li>
              <li>
                <strong>4.</strong> Reinicia con <code className="font-mono">npm run dev</code>.
              </li>
            </ol>
            <p className="mt-3 text-xs texto-tenue">
              El paso a paso completo está en <code className="font-mono">INSTALACION.md</code>.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
