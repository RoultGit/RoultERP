import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/sesion";
import { FormularioEntrar } from "./formulario";

export const metadata = { title: "Entrar · RoultERP" };

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string }>;
}) {
  // Quien ya tiene sesión no debería ver el formulario de entrada.
  if (await sesionActual()) redirect("/");
  const { siguiente = "/" } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">RoultERP</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--texto-suave)" }}>
            Sistema de gestión empresarial
          </p>
        </div>
        <div className="bloque p-6">
          <FormularioEntrar siguiente={siguiente} />
        </div>
      </div>
    </main>
  );
}
