"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Props = {
  email?: string | null;
  redirectPath?: string; // default: "/update-password"
  className?: string;    // default: "btn"
  fullWidth?: boolean;   // default: true
  label?: string;        // default: "Cambiar contraseña"
};

export default function ChangePasswordButton({
  email,
  redirectPath = "/update-password",
  className = "btn",
  fullWidth = true,
  label = "Cambiar contraseña",
}: Props) {
  const [sending, setSending] = useState(false);

  // ✅ toast interno (no depende de flash)
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const timer = useRef<number | null>(null);

  function showToast(text: string, kind: "ok" | "err" = "ok") {
    setToast({ text, kind });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 1600);
  }

  async function handleClick() {
    if (!email) {
      showToast("❌ No se encontró el email del usuario.", "err");
      return;
    }

    setSending(true);
    try {
      const redirectTo = `${window.location.origin}${redirectPath}`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;

      showToast("✅ Te envié un correo para cambiar la contraseña", "ok");
    } catch (e: any) {
      showToast(e?.message || "❌ Error enviando correo de cambio de contraseña", "err");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* ✅ toast floating */}
      {toast && (
        <div
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 9999,
            padding: "12px 14px",
            borderRadius: 14,
            fontWeight: 900,
            color: toast.kind === "ok" ? "rgb(21,128,61)" : "rgb(185,28,28)",
            background: "var(--card)",
            border: "1px solid var(--stroke)",
            boxShadow: "var(--shadow)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          {toast.text}
        </div>
      )}

      <button
        type="button"
        className={className}
        onClick={handleClick}
        disabled={sending}
        style={fullWidth ? { width: "100%" } : undefined}
      >
        {sending ? "Enviando..." : label}
      </button>
    </>
  );
}
