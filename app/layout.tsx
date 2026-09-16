// Root layout - ChargePost EMS Simulator
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { ClerkProvider } from '@clerk/nextjs'
import { AppShell } from '@/components/app-shell'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Enexa - Amperio Specs',
  description: 'Integration specifications between Enexa Platform and Amperio Middleware for the ADS-TEC ChargePost — telemetry, dispatch, and configuration APIs.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/enexa-favicon.svg',
        type: 'image/svg+xml',
      },
    ],
  },
}

export const viewport: Viewport = {
  themeColor: '#203366',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      localization={{
        // The Clerk application name is "amperio" — the auth surface must be
        // pure enexa, so every string that interpolates {{applicationName}}
        // is overridden here.
        signIn: {
          start: {
            title: 'Sign in to enexa',
            subtitle: 'Welcome back! Please sign in to continue',
          },
        },
        signUp: {
          start: {
            title: 'Create your enexa account',
            subtitle: 'Invitation-only access to the platform',
          },
        },
      }}
    >
      <html lang="en">
        <body className="font-sans antialiased">
          <AppShell>
            {children}
          </AppShell>
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  )
}
