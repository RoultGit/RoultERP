import { FormularioInvitacion } from "./formulario";

export const metadata = { title: "Activar cuenta · RoultERP" };
export const dynamic = "force-dynamic";

export default async function Invitacion({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="tarjeta w-full max-w-sm p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold">Activar su cuenta</h1>
        {token ? (
          <>
            <p className="mb-4 text-sm" style={{ color: "var(--texto-suave)" }}>
              Elija la contraseña con la que entrará a RoultERP.
            </p>
            <FormularioInvitacion token={token} />
          </>
        ) : (
          <>
            <p className="mb-4 text-sm" style={{ color: "var(--texto-suave)" }}>
              Falta el enlace de invitación. Pida a un administrador de su empresa que le genere
              uno nuevo.
            </p>
            <a href="/entrar" className="boton boton-secundario">Volver</a>
          </>
        )}
      </div>
    </main>
  );
}
