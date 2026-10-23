import { useContext } from "react";
import { ToastContext } from "../context/toastContext";

/** `const toast = useToast(); toast.show("Mensagem", "success" | "error" | "warning" | "info")` */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
