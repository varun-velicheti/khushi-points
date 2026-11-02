import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Full-screen camera scanner for the customer's app QR. Returns the text in the QR.
export default function Scanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = () => {
      const v = video.current;
      if (done || !v || !ctx) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const w = Math.min(640, v.videoWidth), h = Math.round((v.videoHeight / v.videoWidth) * w);
        canvas.width = w; canvas.height = h;
        ctx.drawImage(v, 0, 0, w, h);
        const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
        if (code?.data) { done = true; onResult(code.data); return; }
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setErr("Camera not available. Allow camera access in the browser, or type the customer's number or member code instead."));
    if (!navigator.mediaDevices) setErr("This browser cannot use the camera. Type the number or member code instead.");

    return () => { done = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onResult]);

  return (
    <div className="scanner" role="dialog" aria-label="Scan customer's app QR">
      <div className="scanner-box">
        {err ? <p className="msg err">{err}</p> : <video ref={video} playsInline muted />}
        <p className="hint" style={{ color: "#fff" }}>Point the camera at the QR in the customer's Khushi Points app.</p>
        <button className="btn alt" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
