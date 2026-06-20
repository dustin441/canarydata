import './globals.css';

export const metadata = {
  title: 'Canary Data — Media Monitoring Dashboard',
  description: 'Track live mentions, sentiment, and incident patterns across your entire media landscape in one unified view.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32', type: 'image/x-icon' },
      { url: '/canary-logo.png', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/canary-logo.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
