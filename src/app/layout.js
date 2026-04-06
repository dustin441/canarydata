import './globals.css';

export const metadata = {
  title: 'Canary Data — Media Monitoring Dashboard',
  description: 'Track live mentions, sentiment, and incident patterns across your entire media landscape in one unified view.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
