import "./globals.css";

export const metadata = {
  title: "Photo Batch Processor",
  description:
    "Deduplicate and batch-crop photos entirely in your browser — nothing is uploaded.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
