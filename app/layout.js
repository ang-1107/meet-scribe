import "@/app/globals.css";

export const metadata = {
  title: "Meet Scribe",
  description: "Google Meet AI scribe: join, transcribe, summarize, review"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}