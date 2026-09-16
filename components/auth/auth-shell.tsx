import Image from "next/image"

/**
 * enexa-branded split-screen shell for the Clerk auth pages.
 * BRANDING RULE: this surface is pure enexa — no Amperio references anywhere
 * (the production domain is amperio.enexa.app but the product identity shown
 * to signing-in users is enexa).
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full">
      {/* Brand panel (hidden on mobile) */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-[#203366] p-12 lg:flex">
        <div className="flex items-center gap-3">
          <Image src="/enexa-favicon.svg" alt="" width={40} height={40} priority />
          <span className="text-2xl font-semibold tracking-tight text-white">enexa</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-balance text-4xl font-semibold leading-tight text-white">
            Energy dispatch, under control.
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-white/70">
            Fleet telemetry, price-aware dispatch and financial reporting for
            distributed battery storage — in one operations platform.
          </p>
        </div>

        <p className="text-xs text-white/50">
          &copy; {new Date().getFullYear()} enexa. All rights reserved.
        </p>

        {/* Signature accent: single orange beam echoing the enexa mark */}
        <div
          aria-hidden
          className="absolute -right-24 top-1/2 h-[140%] w-48 -translate-y-1/2 rotate-12 bg-[#E47A3C] opacity-90"
        />
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-background px-6 py-12">
        <div className="flex items-center gap-2.5 lg:hidden">
          <Image src="/enexa-favicon.svg" alt="" width={32} height={32} priority />
          <span className="text-xl font-semibold tracking-tight text-foreground">enexa</span>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Shared Clerk appearance: align the prebuilt components with the enexa
 * palette. Social providers toggled on in the Clerk Dashboard show up here
 * automatically — no code change needed.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#E47A3C",
    colorText: "#1a2035",
    borderRadius: "0.5rem",
  },
  elements: {
    card: "shadow-none border border-border",
    headerTitle: "text-[#203366]",
    formButtonPrimary: "bg-[#E47A3C] hover:bg-[#d06c31] text-white",
    footerActionLink: "text-[#E47A3C] hover:text-[#d06c31]",
  },
} as const
