import React, { useEffect, useRef } from "react";
import QRCode from "qrcode";

export default function QRCodeDisplay({ value, size = 200 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current && value) {
      QRCode.toCanvas(canvasRef.current, value, { width: size, margin: 1 }, (err) => {
        if (err) console.error("Erreur génération QR:", err);
      });
    }
  }, [value, size]);

  return <canvas ref={canvasRef} style={{ borderRadius: 8 }} />;
}
