"use client"

import { useSimulation } from "@/lib/simulation-store"
import { PageHeader } from "@/components/page-header"
import { SourcesCitation } from "@/components/sources-citation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  CircleDollarSign,
  Battery,
  Zap,
  Receipt,
  Shield,
  TrendingDown,
  Scale,
  Wrench,
  Info,
} from "lucide-react"

type Severity = "critical" | "significant" | "minor" | "info"

interface LimitationItem {
  id: string
  title: string
  severity: Severity
  icon: React.ReactNode
  description: string
  impact: string
  realWorldRange: string
  recommendation: string
}

const severityConfig: Record<Severity, { label: string; variant: "destructive" | "default" | "secondary" | "outline" }> = {
  critical: { label: "Critical", variant: "destructive" },
  significant: { label: "Significant", variant: "default" },
  minor: { label: "Minor", variant: "secondary" },
  info: { label: "Info", variant: "outline" },
}

export function AssumptionsScreen() {
  const { siteSetup, gridPricing } = useSimulation()
  const { battery, wear, pv } = siteSetup

  const limitations: LimitationItem[] = [
    // ── CRITICAL ──
    {
      id: "battery-rte",
      title: "Battery Round-Trip Efficiency Not Modeled",
      severity: "critical",
      icon: <Battery className="size-4" />,
      description:
        "The simulation assumes every kWh stored in the battery comes back out at 100% efficiency. " +
        "In reality, AC-DC conversion, DC-DC conversion, and thermal losses reduce round-trip efficiency (RTE) to 85-90% for LFP/NMC battery systems. " +
        "The ADS-TEC ChargePost has an integrated DC-coupled battery, which avoids one AC-DC conversion stage (better than AC-coupled BESS), " +
        "but still has DC-DC conversion losses in the battery management system.",
      impact:
        `With ~${wear.maxDailyDischarge} kWh daily battery throughput and 88% RTE, approximately ` +
        `${Math.round(wear.maxDailyDischarge * 0.12)} kWh/day is lost to heat. ` +
        `At avg procurement of ~${((gridPricing.epexSpotPrices.reduce((a, b) => a + b, 0) / gridPricing.epexSpotPrices.length + gridPricing.gridFeesAndTaxes) * 100).toFixed(1)} ct/kWh, ` +
            `this is ~${((wear.maxDailyDischarge * 0.12) * (gridPricing.epexSpotPrices.reduce((a, b) => a + b, 0) / gridPricing.epexSpotPrices.length + gridPricing.gridFeesAndTaxes)).toFixed(2)} EUR/day hidden cost.`,
      realWorldRange: "85-92% round-trip efficiency (DC-coupled BESS at high end, AC-coupled at low end)",
      recommendation:
        "Add a batteryRoundTripEfficiency parameter (default 0.88) to the store. Every kWh discharged should cost 1/RTE kWh on the input side. " +
        "The optimizer must account for this -- sometimes it is cheaper to use grid directly than to cycle through battery at a loss.",
    },
    {
      id: "opex",
      title: "Operational Expenditure (OpEx) Not Modeled",
      severity: "critical",
      icon: <Receipt className="size-4" />,
      description:
        "The simulation only considers energy costs and battery wear. All ongoing operational costs of running a public EV charging station " +
        "are excluded. In Germany, operating a public HPC station requires Eichrecht-compliant metering (PTB-certified), a charging management " +
        "system (CPMS), payment processing, SIM/IoT connectivity, insurance, and regular maintenance.",
      impact:
        "Estimated daily OpEx for a single HPC unit:\n" +
        "  - Eichrecht backend (has-to-be, Plug Surfing, etc.): ~2-4 EUR/day\n" +
        "  - CPMS software license (ChargeCloud, Wirelane): ~3-5 EUR/day\n" +
        "  - Payment processing (e-clearing, card terminal): ~2-4% of revenue\n" +
        "  - Maintenance / service contract: ~5-14 EUR/day (for 320 kW HPC)\n" +
        "  - Insurance (liability + equipment): ~3-8 EUR/day\n" +
        "  - Connectivity (IoT SIM, VPN): ~0.50 EUR/day\n" +
        "  - Total estimate: 15-35 EUR/day or ~5,500-12,800 EUR/year",
      realWorldRange: "15-35 EUR/day for a single HPC station (depends on service level agreement and utilization)",
      recommendation:
        "Add a flat dailyOpEx field to the cost model. Even a rough estimate of 20 EUR/day would make the P&L far more realistic.",
    },
    {
      id: "capex",
      title: "Capital Expenditure (CAPEX) Amortization Not Modeled",
      severity: "critical",
      icon: <CircleDollarSign className="size-4" />,
      description:
        "The simulation does not account for the initial investment required to build the charging station. " +
        "This is often the largest single cost factor and determines the payback period / ROI.",
      impact:
        "Estimated CAPEX components:\n" +
        "  - ADS-TEC CP320 ChargePost: ~150,000-200,000 EUR\n" +
        "  - PV system (150 kWp rooftop): ~120,000-180,000 EUR\n" +
        "  - Grid connection upgrade (80 kW NS): ~15,000-40,000 EUR\n" +
        "  - Installation, civil works, signage: ~20,000-40,000 EUR\n" +
        "  - Total: ~305,000-460,000 EUR\n" +
        "  - Over 10 years: ~84-126 EUR/day amortization\n" +
        "  - Over 15 years: ~56-84 EUR/day amortization",
      realWorldRange: "300,000-460,000 EUR total investment; 55-130 EUR/day depending on depreciation period",
      recommendation:
        "Add CAPEX inputs (equipment cost, installation cost, depreciation years) and compute daily amortization. " +
        "This is essential for any investor/business case evaluation.",
    },
    // ── SIGNIFICANT ──
    {
      id: "roaming-fees",
      title: "Roaming & Payment Processing Fees Not Modeled",
      severity: "significant",
      icon: <Scale className="size-4" />,
      description:
        "When an EV driver charges via a Mobility Service Provider (MSP/EMP) like Maingau, ADAC, Shell Recharge, etc., " +
        "the CPO receives a roaming settlement, not the full ad-hoc retail price. Roaming platforms (Hubject intercharge, OCPI/Gireve) " +
        "take a fee, and the MSP takes a margin. Even for direct ad-hoc users, card payment processing has costs.",
      impact:
        "  - Roaming settlement: CPO typically receives 70-85% of the end-user price\n" +
        "  - Hubject/intercharge platform fee: ~0.50-2.00 EUR/session\n" +
        "  - Card payment processing: ~2-4% of transaction value\n" +
        `  - On ${gridPricing.retailPricePerKwh * 100} ct/kWh retail: effective revenue could be 42-52 ct/kWh via roaming\n` +
        "  - Typical CPO revenue mix: ~40% roaming, ~30% ad-hoc, ~30% subscription",
      realWorldRange: "Effective blended revenue: 42-55 ct/kWh (vs. 59 ct/kWh nominal ad-hoc)",
      recommendation:
        "Add a blendedRevenueDiscount factor (default ~15%) or model separate revenue streams for ad-hoc, roaming, and subscription users.",
    },
    {
      id: "retail-price",
      title: "Retail Price (59 ct/kWh) Below Market Ad-Hoc Average",
      severity: "significant",
      icon: <TrendingDown className="size-4" />,
      description:
        "The configured retail price of 59 ct/kWh is below typical German ad-hoc DC fast charging rates in 2025. " +
        "Major CPOs charge significantly more for ad-hoc (without subscription):\n" +
        "  - EnBW ad-hoc: 79 ct/kWh\n" +
        "  - Aral Pulse ad-hoc: 79 ct/kWh\n" +
        "  - Tesla Supercharger (non-Tesla): 55-60 ct/kWh\n" +
        "  - Ionity ad-hoc: 79 ct/kWh\n" +
        "  - Fastned: 69-73 ct/kWh\n" +
        "At 59 ct, this represents a deliberate competitive undercut or a subscription-tier price.",
      impact:
        "If ad-hoc market rate is 69-79 ct and you charge 59 ct, you leave 10-20 ct/kWh on the table. " +
        `On ${(siteSetup.wear.maxDailyDischarge * 2).toFixed(0)} kWh/day throughput, that is ` +
        `${((siteSetup.wear.maxDailyDischarge * 2) * 0.15).toFixed(0)} EUR/day potential uplift.`,
      realWorldRange: "49 ct (subscription) to 79 ct (ad-hoc) depending on provider and access model",
      recommendation:
        "This may be an intentional pricing strategy. Document whether 59 ct targets subscription users, " +
        "is a volume-attraction strategy, or should be raised to 69 ct market rate.",
    },
    {
      id: "negative-epex",
      title: "Negative EPEX Spot Prices Not Modeled",
      severity: "significant",
      icon: <Zap className="size-4" />,
      description:
        "The current EPEX Spot price profile has only positive prices (min 1.0 ct/kWh at 13:00). " +
        "In summer 2024/2025, Germany regularly saw negative day-ahead prices during solar surplus hours " +
        "(typically 11:00-15:00 on sunny weekends). Negative prices mean the CPO gets PAID to consume electricity.",
      impact:
        "On summer Saturdays in 2024, EPEX DAM prices in Germany reached -5 to -10 ct/kWh for several hours. " +
        "This means the optimizer could benefit from aggressively charging the battery during negative-price windows " +
        "(you get paid to fill the battery, then sell that energy to EV drivers at 59 ct). " +
        "Missing this underestimates the battery arbitrage opportunity by ~2-5 EUR/day on sunny days.",
      realWorldRange: "-10 to +15 ct/kWh typical range on summer weekends (2024/2025 data)",
      recommendation:
        "Allow negative values in the EPEX price input. Add preset profiles for different day types " +
        "(sunny weekend with negatives, cloudy weekday, winter evening peak).",
    },
    // ── MINOR ──
    {
      id: "14a-stromnev",
      title: "14a StromNEV Netzentgelt Reduction Not Modeled",
      severity: "minor",
      icon: <Shield className="size-4" />,
      description:
        "Since January 2024, controllable consumption devices (steuerbare Verbrauchseinrichtungen) including " +
        "EV chargers can opt into 14a StromNEV to receive reduced grid fees. The grid operator gains the right " +
        "to temporarily reduce the connection to 4.2 kW (per charging point) during grid congestion events. " +
        "In return, the Netzentgelt Arbeitspreis is reduced.",
      impact:
        "Potential Netzentgelt reduction of ~30-60% on the Arbeitspreis component. " +
        `With current Netzentgelt ~5.0 ct/kWh, savings could be 1.5-3.0 ct/kWh on all imported energy. ` +
        "However, the curtailment to 4.2 kW could disrupt HPC charging sessions during grid events (rare, typically < 100h/year).",
      realWorldRange: "1.5-3.0 ct/kWh reduction; curtailment risk during ~50-100 hours/year",
      recommendation:
        "Evaluate with local DSO whether 14a is compatible with battery-buffered HPC " +
        "(the battery can likely absorb curtailment events without impacting EV charging).",
    },
    {
      id: "idle-fees",
      title: "Idle/Blocking Fees Not Modeled",
      severity: "minor",
      icon: <CircleDollarSign className="size-4" />,
      description:
        "Many CPOs charge a Blockiergebiihr (blocking/idle fee) when an EV remains connected after charging is complete. " +
        "Typical rates are 10-15 ct/min, starting 10-15 minutes after charging ends. " +
        "This is both a revenue source and an incentive to free the connector for the next user.",
      impact:
        "With 25 daily sessions, if even 20% of users overstay by 10 minutes at 10 ct/min, " +
        "that is 5 sessions * 10 min * 0.10 EUR/min = 5 EUR/day additional revenue. " +
        "Actual data from German CPOs suggests idle fee revenue is ~3-8% of total charging revenue.",
      realWorldRange: "3-8% additional revenue on top of energy sales",
      recommendation:
        "Add an optional idle fee parameter. This is a minor revenue source but helps with realistic P&L.",
    },
    {
      id: "seasonality",
      title: "Single-Day Simulation (No Seasonal Variation)",
      severity: "minor",
      icon: <Info className="size-4" />,
      description:
        "The simulation models a single typical summer Saturday. Real-world performance varies dramatically by season: " +
        "winter has ~70% less PV output, different EPEX price curves (higher evening peaks, no midday solar dip), " +
        "and different EV charging patterns (lower battery efficiency in cold, more energy needed per session). " +
        "Annual financial projections from a single summer day will significantly overestimate PV contribution " +
        "and potentially overestimate margins.",
      impact:
        "Summer PV output ~6-8 kWh/kWp/day vs winter ~1-2 kWh/kWp/day in Germany. " +
        "Annual extrapolation from a summer day overestimates PV savings by ~40-60%. " +
        "Winter EPEX prices are typically higher (more gas-fired generation), " +
        "which means higher procurement costs but also higher grid arbitrage potential.",
      realWorldRange: "Annual PV yield: ~950-1,100 kWh/kWp/year (vs. summer day * 365 suggests ~1,800+)",
      recommendation:
        "Add representative profiles for 4 seasons or at least summer/winter. " +
        "Weight annual projections: ~5 months summer-like, ~4 months shoulder, ~3 months winter.",
    },
    {
      id: "ev-efficiency",
      title: "EV Battery Thermal Losses Not Modeled",
      severity: "minor",
      icon: <Battery className="size-4" />,
      description:
        "The energy requested by each EV session is computed as a simple percentage of battery capacity. " +
        "In reality, DC fast charging generates significant heat in both the charger and the EV battery. " +
        "The EV's Battery Management System (BMS) may throttle charging rate or require additional energy " +
        "for thermal management (heating in winter, cooling in summer). Typical DC fast charging efficiency " +
        "is 90-95% (energy delivered to battery vs. energy drawn from charger).",
      impact:
        "5-10% of energy drawn from the charger does not end up as usable SOC in the EV. " +
        "This means the CPO sells slightly more kWh than the EV actually stores, " +
        "which is actually favorable for revenue but means the kWh-per-session estimates " +
        "are slightly low (the meter bills the gross, not net).",
      realWorldRange: "90-95% charging efficiency at HPC rates",
      recommendation:
        "This slightly underestimates billed kWh per session. For accurate billing simulation, " +
        "add a dcChargingOverhead factor of ~5-8%.",
    },
    {
      id: "grid-reinforcement",
      title: "Grid Connection Upgrade Costs Not Modeled",
      severity: "minor",
      icon: <Wrench className="size-4" />,
      description:
        "The simulation assumes an 80 kW grid connection exists. In practice, upgrading a supermarket's " +
        "grid connection or adding a dedicated connection for the charger involves DSO coordination, " +
        "potentially transformer upgrades, and significant lead times (6-18 months in Germany). " +
        "The cost depends heavily on the distance to the nearest suitable transformer and the required capacity.",
      impact:
        "Grid connection costs:\n" +
        "  - NS 80 kW (if transformer has capacity): ~5,000-15,000 EUR\n" +
        "  - NS 80 kW (if transformer upgrade needed): ~20,000-50,000 EUR\n" +
        "  - New dedicated MS connection: ~50,000-150,000 EUR\n" +
        "These are one-time costs rolled into CAPEX.",
      realWorldRange: "5,000-150,000 EUR depending on local grid infrastructure",
      recommendation: "Include in CAPEX amortization when that module is added.",
    },
  ]

  const critical = limitations.filter((l) => l.severity === "critical")
  const significant = limitations.filter((l) => l.severity === "significant")
  const minor = limitations.filter((l) => l.severity === "minor")

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Not Modeled"
        description="What this simulation does not model -- known gaps and simplifications before optimization"
      />
      <div className="flex-1 overflow-auto p-6 space-y-8">
        <div className="w-full space-y-8">
          {/* Summary banner */}
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">
                    {limitations.length} known limitations identified
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    This simulation models energy flows, battery cycling, PV production, and hourly price arbitrage
                    for a single ADS-TEC CP320 ChargePost on a typical summer Saturday. The following factors are
                    <strong> not yet included</strong> in the financial model. They should be considered when
                    interpreting results and before using the optimizer output for investment decisions.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="destructive">{critical.length} Critical</Badge>
                    <Badge variant="default">{significant.length} Significant</Badge>
                    <Badge variant="secondary">{minor.length} Minor</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Critical limitations */}
          {critical.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="text-xs">Critical</Badge>
                <h2 className="text-sm font-semibold text-foreground">
                  Missing cost/revenue factors that materially affect the P&L
                </h2>
              </div>
              <div className="space-y-4">
                {critical.map((item) => (
                  <LimitationCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {/* Significant limitations */}
          {significant.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="text-xs">Significant</Badge>
                <h2 className="text-sm font-semibold text-foreground">
                  Factors that could shift results by 10-30%
                </h2>
              </div>
              <div className="space-y-4">
                {significant.map((item) => (
                  <LimitationCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {/* Minor limitations */}
          {minor.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">Minor</Badge>
                <h2 className="text-sm font-semibold text-foreground">
                  Refinements for higher fidelity (under 10% impact)
                </h2>
              </div>
              <div className="space-y-4">
                {minor.map((item) => (
                  <LimitationCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {/* What IS modeled */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">What this simulation DOES cover</h2>
            <Card>
              <CardContent className="p-5">
                <div className="grid gap-3 sm:grid-cols-2 text-xs">
                  {[
                    "EPEX Spot prices at 15-min resolution (96 quarter-hour slots per day)",
                    "Dynamic grid import cost (EPEX + itemized fees/taxes)",
                    "Leistungspreis (demand charge) on peak 15-min grid draw",
                    "Battery wear cost based on cycle life and replacement cost",
                    "PV production profile (PVGIS-based, with system losses)",
                    "PV self-consumption savings at hourly avoided procurement cost",
                    "Flat retail pricing model (59 ct/kWh ad-hoc)",
                    "Grid export via EEG, Direktvermarktung, or spot-indexed",
                    "25 realistic sequential EV charging sessions",
                    "1-minute resolution energy flow simulation",
                    "Equipment constraints (grid cap, battery SOC floor/ceiling, discharge rate)",
                    "Per-kWh margin analysis by energy source (PV / Grid / Battery)",
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="size-1.5 rounded-full bg-chart-3 mt-1.5 shrink-0" />
                      <span className="text-muted-foreground">{item}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Sources & References */}
          <SourcesCitation
            title="Sources: All Model Assumptions"
            sources={[
              {
                label: "ADS-TEC Energy -- ChargePost CP320 Datasheet",
                url: "https://www.ads-tec-energy.com/en/products/chargepost-cp320/",
                detail: "Battery 143 kWh LFP, max output 320 kW, grid connection 80 kW, SOC range 20-90%. Basis for all equipment parameters.",
                date: "2024",
              },
              {
                label: "EPEX SPOT -- German Market Data (Day-Ahead & Intraday)",
                url: "https://www.epexspot.com/en/market-data",
                detail: "15-min resolution price data for Germany/Luxembourg. Summer Saturday patterns: 1-14 ct/kWh range, midday solar surplus dip.",
                date: "2024",
              },
              {
                label: "PVGIS -- EU JRC Photovoltaic Geographical Information System",
                url: "https://re.jrc.ec.europa.eu/pvg_tools/en/",
                detail: "PV capacity factors for 48 deg N, 30 deg tilt, south-facing. 14% system loss. Hourly profile for July Saturday.",
                date: "2024",
              },
              {
                label: "Bundesnetzagentur -- Grid Fee Schedules & SMARD Market Data",
                url: "https://www.smard.de/en",
                detail: "Netzentgelt ~5.0 ct, Stromsteuer 2.05 ct, KAV 0.11 ct, Offshore 0.66 ct. Total grid surcharge ~7.82 ct/kWh.",
                date: "2024",
              },
              {
                label: "EEG 2023/2024 -- Feed-in Tariffs & Direktvermarktung Rules",
                url: "https://www.gesetze-im-internet.de/eeg_2014/",
                detail: "PV 100-750 kWp partial surplus: ~5.68 ct/kWh. Mandatory Direktvermarktung for > 100 kWp.",
                date: "2024",
              },
              {
                label: "Fastned, Ionity, EnBW, Allego -- HPC Station Data & Pricing",
                url: "https://fastnedcharging.com/en/investor-relations",
                detail: "HPC session data: arrival SOC 25-35%, departure 65-75%, session times 20-35 min. Retail prices 49-79 ct/kWh.",
                date: "2023-2024",
              },
            ]}
          />
        </div>
      </div>
    </div>
  )
}

function LimitationCard({ item }: { item: LimitationItem }) {
  const cfg = severityConfig[item.severity]
  return (
    <Card>
      <CardHeader className="border-b pb-3">
        <div className="flex items-start gap-3">
          <div className={`flex size-8 items-center justify-center rounded-md shrink-0 ${
            item.severity === "critical" ? "bg-destructive/10 text-destructive" :
            item.severity === "significant" ? "bg-primary/10 text-primary" :
            "bg-muted text-muted-foreground"
          }`}>
            {item.icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm">{item.title}</CardTitle>
              <Badge variant={cfg.variant} className="text-[10px]">{cfg.label}</Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Description */}
        <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
          {item.description}
        </div>

        {/* Impact */}
        <div className="rounded-md bg-muted/50 p-3 space-y-1">
          <p className="text-[10px] font-semibold text-foreground uppercase tracking-wider">Estimated Impact</p>
          <p className="text-xs text-muted-foreground font-mono whitespace-pre-line leading-relaxed">
            {item.impact}
          </p>
        </div>

        {/* Real-world range */}
        <div className="flex items-start gap-2 text-xs">
          <span className="text-muted-foreground shrink-0 font-medium">Real-world range:</span>
          <span className="text-foreground">{item.realWorldRange}</span>
        </div>

        {/* Recommendation */}
        <div className="rounded-md border border-dashed p-3">
          <p className="text-[10px] font-semibold text-foreground uppercase tracking-wider mb-1">Recommendation</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{item.recommendation}</p>
        </div>
      </CardContent>
    </Card>
  )
}
