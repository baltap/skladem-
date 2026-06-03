import "./globals.css";

export const metadata = {
  title: "Heureka Real-Time Stock Verifier",
  description: "Dashboard for monitoring and analyzing merchant stock feed discrepancies using Puppeteer and Gemini Flash.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#090d16] text-[#f3f4f6]">
        {children}
      </body>
    </html>
  );
}
