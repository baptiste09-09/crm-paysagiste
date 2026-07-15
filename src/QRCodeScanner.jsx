import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export default function QRCodeScanner({ onScan, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          onScan(code.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          tick();
        }
      } catch (e) {
        setError("Caméra inaccessible (autorisation refusée ou indisponible). Utilise la saisie manuelle à la place.");
      }
    }

    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {error ? (
        <div style={{ fontSize: 12.5, color: "#B5473F", textAlign: "center" }}>{error}</div>
      ) : (
        <video ref={videoRef} style={{ width: "100%", borderRadius: 8, background: "#000" }} muted playsInline />
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <button
        onClick={onCancel}
        style={{ fontSize: 12.5, color: "#5A5347", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
      >
        Annuler
      </button>
    </div>
  );
}
