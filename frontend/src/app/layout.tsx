import "./globals.css";

export const metadata = {
  title: "Portal JILIU | La Promesa",
  description: "Plataforma de notas y asignaciones",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
