import QRCode from "qrcode";

// Render a join URL to a QR data-URL (transparent bg so it sits on a card).
// data: URLs are allowed by the backend CSP (img-src ... data:).
export async function qrDataUrl(text: string, dark: boolean): Promise<string> {
  return QRCode.toDataURL(text, {
    margin: 1,
    width: 260,
    color: {
      dark: dark ? "#e9e9e9" : "#222222",
      light: "#00000000",
    },
  });
}
