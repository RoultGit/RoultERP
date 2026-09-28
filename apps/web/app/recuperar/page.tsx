export const metadata = { title: "Recuperar contraseña · RoultERP" };

export default function Recuperar() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="tarjeta w-full max-w-sm p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold">Recuperar contraseña</h1>
        {/*
          Esta pantalla decía lo mismo cuando el administrador todavía no podía
          generar el enlace, así que mandaba a la gente a pedir algo que no
          existía. Ahora sí existe: está en Usuarios y roles, junto a cada
          persona.
        */}
        <p className="mb-4 text-sm" style={{ color: "var(--texto-suave)" }}>
          El envío de correos todavía no está configurado. Pida a un administrador de su empresa
          que entre a <strong>Usuarios y roles</strong> y pulse <strong>Restablecer clave</strong>
          {" "}en su fila: le dará un enlace de un solo uso para que elija una contraseña nueva.
        </p>
        <a href="/entrar" className="boton boton-secundario">
          Volver
        </a>
      </div>
    </main>
  );
}
