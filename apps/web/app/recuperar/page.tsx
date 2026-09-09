export const metadata = { title: "Recuperar contraseña · RoultERP" };

export default function Recuperar() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="tarjeta w-full max-w-sm p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold">Recuperar contraseña</h1>
        <p className="mb-4 text-sm" style={{ color: "var(--texto-suave)" }}>
          El envío de correos todavía no está configurado. Mientras tanto, pida a un administrador
          de su empresa que le genere un enlace de restablecimiento.
        </p>
        <a href="/entrar" className="boton boton-secundario">
          Volver
        </a>
      </div>
    </main>
  );
}
