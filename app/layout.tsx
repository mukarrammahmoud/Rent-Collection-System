import type { Metadata } from 'next'
import { Geist, Geist_Mono, IBM_Plex_Sans, Outfit } from 'next/font/google'
import './globals.css'
import { cn } from '@/lib/utils'
import { PersonaSwitcher } from '@/components/persona-switcher'

const outfitHeading = Outfit({ subsets: ['latin'], variable: '--font-heading' })
const ibmPlexSans = IBM_Plex_Sans({ subsets: ['latin'], variable: '--font-sans' })
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Rent Collection System',
  description: 'Enterprise multi-tenant rent collection and ledger system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={cn(
        'h-full',
        'antialiased',
        geistSans.variable,
        geistMono.variable,
        'font-sans',
        ibmPlexSans.variable,
        outfitHeading.variable,
      )}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <PersonaSwitcher />
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  )
}
