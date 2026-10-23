import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { ToastContext } from "./toastContext";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const DURATION_MS = 2800;

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const show = useCallback((message, type = "info") => {
    clearTimeout(timerRef.current);
    setToast({ message, type, key: Date.now() });
    timerRef.current = setTimeout(() => setToast(null), DURATION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  const Icon = toast ? ICONS[toast.type] || Info : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className="toast-viewport" role="status" aria-live="polite">
          <div key={toast.key} className={`toast toast--${toast.type}`}>
            <Icon size={18} aria-hidden="true" />
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
