'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { iniciarSesion, type Resultado } from '@/app/panel/acciones';

function BotonEnviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="boton boton-primario w-full">
      {pending ? 'Entrando…' : 'Entrar al panel'}
    </button>
  );
}

export function FormularioIngreso() {
  const [estado, accion] = useActionState<Resultado | null, FormData>(iniciarSesion, null);

  return (
    <form action={accion} className="space-y-3">
      <div>
        <label className="etiqueta-campo" htmlFor="correo">
          Correo
        </label>
        <input
          id="correo"
          name="correo"
          type="email"
          required
          autoComplete="username"
          className="campo"
          placeholder="tu@correo.com"
        />
      </div>

      <div>
        <label className="etiqueta-campo" htmlFor="clave">
          Contraseña
        </label>
        <input
          id="clave"
          name="clave"
          type="password"
          required
          autoComplete="current-password"
          className="campo"
          placeholder="••••••••"
        />
      </div>

      {estado && !estado.ok && (
        <p
          role="alert"
          className="tarjeta-sutil border-ron-peligro bg-red-50 p-3 text-sm font-bold text-ron-peligro"
        >
          {estado.mensaje}
        </p>
      )}

      <BotonEnviar />
    </form>
  );
}
