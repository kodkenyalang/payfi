import { Providers } from "./providers";

export const metadata = {
  title: "PayFi PayStream",
  description: "AI-gated freelance payment escrow on Somnia Agentic L1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
