"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { 
  AlertTriangle,
  Cloud,
  CloudOff,
  Wifi,
  WifiOff,
  Battery,
  BatteryWarning,
  Zap,
  ZapOff,
  Car,
  Server,
  ServerOff,
  Clock,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Timer,
  Thermometer,
} from "lucide-react"

type Severity = "critical" | "high" | "medium" | "low"

interface FailureScenario {
  id: string
  title: string
  description: string
  severity: Severity
  detection: string
  fallback: string[]
  recovery: string
  timeout?: string
}

const severityConfig: Record<Severity, { label: string; color: string; bgColor: string }> = {
  critical: { label: "Critical", color: "text-red-600", bgColor: "bg-red-500/10 border-red-500/30" },
  high: { label: "High", color: "text-orange-600", bgColor: "bg-orange-500/10 border-orange-500/30" },
  medium: { label: "Medium", color: "text-yellow-600", bgColor: "bg-yellow-500/10 border-yellow-500/30" },
  low: { label: "Low", color: "text-blue-600", bgColor: "bg-blue-500/10 border-blue-500/30" },
}

// ══════════════════════════════════════════════════════════════════════════════
// FAILURE SCENARIOS
// ══════════════════════════════════════════════════════════════════════════════

const cloudFailures: FailureScenario[] = [
  {
    id: "cloud-disconnect",
    title: "Enexa Cloud Unreachable",
    description: "Complete loss of connectivity between middleware and Enexa cloud services. No dispatch commands can be received.",
    severity: "critical",
    detection: "No heartbeat response from cloud for 30 seconds",
    timeout: "30 seconds",
    fallback: [
      "Middleware switches to LOCAL AUTONOMOUS MODE",
      "Use last known day-ahead schedule if available (valid for up to 24h)",
      "If no schedule: fall back to REACTIVE BMS rules",
      "Continue pushing telemetry to local buffer (replay when reconnected)",
      "Alert site operator via local HMI and SMS if configured",
    ],
    recovery: "Resume cloud commands immediately upon reconnection. Replay buffered telemetry.",
  },
  {
    id: "cloud-partial",
    title: "Intermittent Cloud Connectivity",
    description: "Unstable connection with frequent packet loss or high latency (>2s RTT).",
    severity: "high",
    detection: "3+ failed requests in 60-second window OR latency >2000ms",
    fallback: [
      "Increase command batch size to reduce round-trips",
      "Cache commands locally and apply on confirmation",
      "Switch to 5-minute dispatch intervals instead of real-time",
      "Prioritize critical commands (emergency stops, safety overrides)",
    ],
    recovery: "Gradually return to real-time dispatch as connection stabilizes.",
  },
  {
    id: "cloud-auth-fail",
    title: "Authentication/Authorization Failure",
    description: "API credentials expired, revoked, or certificate mismatch.",
    severity: "high",
    detection: "HTTP 401/403 responses from cloud API",
    fallback: [
      "Attempt credential refresh using refresh token",
      "If refresh fails: switch to LOCAL AUTONOMOUS MODE",
      "Log security event for audit",
      "Alert system administrator immediately",
    ],
    recovery: "Require manual credential re-provisioning by authorized personnel.",
  },
]

const middlewareFailures: FailureScenario[] = [
  {
    id: "mw-crash",
    title: "Middleware Process Crash",
    description: "The middleware controller software has crashed or become unresponsive.",
    severity: "critical",
    detection: "Watchdog timer expiry (no heartbeat for 10 seconds)",
    timeout: "10 seconds",
    fallback: [
      "Hardware watchdog triggers automatic process restart",
      "If restart fails 3x: reboot entire control box",
      "During restart: all equipment enters SAFE STATE",
      "Battery: hold current SOC, no charge/discharge",
      "EV chargers: continue active sessions at current power, no new sessions",
    ],
    recovery: "Middleware auto-recovers state from persistent storage on restart.",
  },
  {
    id: "mw-memory",
    title: "Memory/Storage Exhaustion",
    description: "Control box running low on memory or disk space for telemetry buffering.",
    severity: "medium",
    detection: "Memory usage >90% OR disk usage >95%",
    fallback: [
      "Purge oldest telemetry data (FIFO)",
      "Reduce telemetry resolution (1s -> 5s intervals)",
      "Disable non-critical logging",
      "Alert for maintenance",
    ],
    recovery: "Restore normal operation after resource cleanup or hardware upgrade.",
  },
  {
    id: "mw-time-drift",
    title: "Clock Synchronization Loss",
    description: "System clock has drifted significantly, affecting schedule execution.",
    severity: "high",
    detection: "NTP sync failure for >1 hour OR time delta >30 seconds",
    fallback: [
      "Use relative timestamps for immediate commands",
      "Pause schedule-based operations until sync restored",
      "Continue real-time reactive control",
      "Log all events with local monotonic timestamps",
    ],
    recovery: "Re-sync via NTP and recalibrate schedule offsets.",
  },
]

const batteryFailures: FailureScenario[] = [
  {
    id: "batt-comm-loss",
    title: "Battery BMS Communication Loss",
    description: "Cannot communicate with battery management system. State of charge unknown.",
    severity: "critical",
    detection: "No CAN/Modbus response for 5 seconds",
    timeout: "5 seconds",
    fallback: [
      "IMMEDIATELY cease all battery operations",
      "Open battery contactors if safe to do so",
      "Route all loads directly to grid",
      "Alert maintenance team",
    ],
    recovery: "Manual inspection required before resuming battery operations.",
  },
  {
    id: "batt-soc-invalid",
    title: "Invalid SOC Reading",
    description: "SOC value is out of range, stuck, or changing impossibly fast.",
    severity: "high",
    detection: "SOC <0% OR >100% OR delta >10% per minute without corresponding power flow",
    fallback: [
      "Mark SOC as UNTRUSTED",
      "Estimate SOC from power flow integration (coulomb counting)",
      "Apply conservative limits: assume SOC is 20% lower than estimated",
      "Reduce max charge/discharge rates by 50%",
    ],
    recovery: "Recalibrate SOC after full charge cycle or manual verification.",
  },
  {
    id: "batt-thermal",
    title: "Battery Thermal Alarm",
    description: "Battery temperature outside safe operating range.",
    severity: "critical",
    detection: "Cell temperature >45C OR <0C OR delta >5C between cells",
    timeout: "Immediate",
    fallback: [
      "IMMEDIATELY reduce power to 0",
      "Activate cooling system if available",
      "If >55C: emergency disconnect",
      "Do not resume until temperature normalizes for 15 minutes",
    ],
    recovery: "Automatic resume after thermal stabilization. Log event for analysis.",
  },
  {
    id: "batt-contactor",
    title: "Contactor Failure",
    description: "Battery contactor stuck open or closed, or feedback mismatch.",
    severity: "critical",
    detection: "Command vs feedback state mismatch for >2 seconds",
    fallback: [
      "Attempt 3 close/open cycles",
      "If stuck closed: reduce power to 0, alert immediately",
      "If stuck open: battery unavailable, switch to grid-only mode",
      "Never force contactor - risk of welding",
    ],
    recovery: "Physical inspection and contactor replacement required.",
  },
]

const gridFailures: FailureScenario[] = [
  {
    id: "grid-outage",
    title: "Grid Power Outage",
    description: "Complete loss of grid connection. Site is islanded.",
    severity: "critical",
    detection: "Grid voltage <180V OR frequency outside 47-53Hz for >100ms",
    timeout: "100 milliseconds",
    fallback: [
      "IMMEDIATE transition to island mode",
      "Battery becomes grid-forming (if capable)",
      "Shed non-critical loads per priority table",
      "Limit EV charging to minimum or suspend new sessions",
      "Preserve battery for critical loads",
    ],
    recovery: "Wait for stable grid (5 minutes), then soft reconnection with ramp-up.",
  },
  {
    id: "grid-quality",
    title: "Poor Grid Power Quality",
    description: "Voltage sags, swells, harmonics, or frequency deviations.",
    severity: "medium",
    detection: "Voltage outside 207-253V OR THD >8% OR frequency outside 49.5-50.5Hz",
    fallback: [
      "Reduce grid import/export rates",
      "Use battery to buffer power quality issues",
      "Delay non-urgent charging operations",
      "Log power quality events for utility reporting",
    ],
    recovery: "Resume normal operation when quality metrics return to acceptable range.",
  },
  {
    id: "grid-meter-fail",
    title: "Grid Meter Communication Failure",
    description: "Cannot read grid meter. Import/export values unknown.",
    severity: "high",
    detection: "No meter response for 10 seconds OR CRC errors",
    fallback: [
      "Estimate grid power from: Grid = Load - Battery",
      "Mark grid readings as ESTIMATED",
      "Apply conservative limits to prevent export violations",
      "Reduce battery discharge to avoid accidental export",
    ],
    recovery: "Restore meter communication and verify accuracy before resuming.",
  },
]

const evFailures: FailureScenario[] = [
  {
    id: "ev-charger-fault",
    title: "EV Charger Fault",
    description: "Charging station has reported a fault or is non-responsive.",
    severity: "high",
    detection: "Charger fault code OR no heartbeat for 30 seconds",
    fallback: [
      "Mark charger as UNAVAILABLE",
      "If session active: attempt graceful stop",
      "Redistribute power to remaining operational chargers",
      "Update availability in user-facing systems",
      "Alert maintenance",
    ],
    recovery: "Manual fault clear and test charge before returning to service.",
  },
  {
    id: "ev-overcurrent",
    title: "EV Charging Overcurrent",
    description: "Vehicle drawing more current than allowed by EVSE or cable rating.",
    severity: "high",
    detection: "Measured current >110% of setpoint for >5 seconds",
    fallback: [
      "Immediately reduce current setpoint by 20%",
      "If violation continues: pause charging for 30 seconds",
      "Log vehicle ID for pattern analysis",
      "Resume at reduced power level",
    ],
    recovery: "Gradual power increase if vehicle behaves correctly.",
  },
  {
    id: "ev-session-stuck",
    title: "Stuck Charging Session",
    description: "Session appears complete but connector still locked or billed.",
    severity: "medium",
    detection: "SOC 100% OR power <0.5kW for >10 minutes with connector locked",
    fallback: [
      "Send unlock command to EVSE",
      "Stop billing if metered session",
      "If unlock fails: alert user via app notification",
      "Mark session as REQUIRES_ATTENTION",
    ],
    recovery: "Manual intervention or vehicle departure.",
  },
]

const safetyFailures: FailureScenario[] = [
  {
    id: "emergency-stop",
    title: "Emergency Stop Activated",
    description: "Physical E-stop button pressed or safety system triggered.",
    severity: "critical",
    detection: "E-stop input active OR safety relay open",
    timeout: "Immediate",
    fallback: [
      "IMMEDIATE all-stop: battery, chargers, inverters",
      "Open all contactors",
      "Maintain only monitoring and communication",
      "Alert all registered contacts",
      "Do NOT auto-recover - requires physical reset",
    ],
    recovery: "Physical E-stop reset + authorized personnel confirmation.",
  },
  {
    id: "ground-fault",
    title: "Ground Fault Detected",
    description: "Insulation failure or ground fault current detected.",
    severity: "critical",
    detection: "RCD trip OR ground fault monitor alarm",
    timeout: "Immediate",
    fallback: [
      "Trip affected circuit immediately",
      "Isolate fault location if sectionalizing available",
      "Do not attempt auto-reclose on ground faults",
      "Alert electrical maintenance immediately",
    ],
    recovery: "Professional inspection and repair required.",
  },
  {
    id: "arc-fault",
    title: "Arc Fault Detected",
    description: "Potential arc fault in DC or AC wiring.",
    severity: "critical",
    detection: "AFCI trip OR arc signature in current waveform",
    timeout: "Immediate",
    fallback: [
      "Immediate shutdown of affected circuit",
      "Battery disconnect if DC side",
      "No auto-recovery",
    ],
    recovery: "Professional inspection and repair required.",
  },
]

const cyberSecurityFailures: FailureScenario[] = [
  {
    id: "cyber-invalid-cert",
    title: "Invalid or Expired Certificate",
    description: "TLS certificate validation failure when connecting to Enexa cloud.",
    severity: "high",
    detection: "SSL handshake failure OR certificate expiry warning",
    fallback: [
      "Reject connection immediately - do not proceed",
      "Switch to LOCAL AUTONOMOUS MODE",
      "Alert administrator for certificate renewal",
      "Log security event with certificate details",
    ],
    recovery: "Install new valid certificate. Verify chain of trust before resuming.",
  },
  {
    id: "cyber-replay-attack",
    title: "Replay Attack Detected",
    description: "Received command with old timestamp or duplicate sequence number.",
    severity: "high",
    detection: "Command timestamp >60s old OR sequence number already seen",
    fallback: [
      "Reject command immediately",
      "Log security event with full command payload",
      "Continue with last valid command",
      "Alert security team",
    ],
    recovery: "Investigate source of replayed commands. May indicate network MITM.",
  },
  {
    id: "cyber-unauthorized-cmd",
    title: "Unauthorized Command Source",
    description: "Command received from unrecognized or unauthorized source.",
    severity: "critical",
    detection: "Invalid API key OR command signed with unknown key",
    fallback: [
      "Reject command immediately",
      "Enter LOCAL AUTONOMOUS MODE",
      "Lock out remote commands until manual override",
      "Alert security team immediately",
    ],
    recovery: "Security audit required. Re-provision credentials if compromised.",
  },
  {
    id: "cyber-dos",
    title: "Denial of Service / Flooding",
    description: "Excessive requests overwhelming the middleware.",
    severity: "medium",
    detection: "Request rate >10x normal OR memory/CPU exhaustion",
    fallback: [
      "Enable rate limiting (drop excess requests)",
      "Prioritize local safety functions",
      "Reduce telemetry frequency",
      "Log source IPs for analysis",
    ],
    recovery: "Block attacking sources. Review firewall rules.",
  },
]

const firmwareFailures: FailureScenario[] = [
  {
    id: "fw-update-failed",
    title: "Firmware Update Failure",
    description: "OTA firmware update did not complete successfully.",
    severity: "high",
    detection: "Update process timeout OR checksum mismatch OR boot failure",
    fallback: [
      "Roll back to previous firmware version",
      "If rollback fails: enter SAFE STATE",
      "Alert maintenance team",
      "Do not attempt another update until diagnosed",
    ],
    recovery: "Manual firmware re-installation via local interface.",
  },
  {
    id: "fw-version-mismatch",
    title: "Firmware Version Incompatibility",
    description: "Middleware firmware incompatible with Enexa API version.",
    severity: "medium",
    detection: "API returns 426 Upgrade Required OR schema validation failures",
    fallback: [
      "Continue with reduced functionality",
      "Use last compatible command format",
      "Schedule firmware update",
      "Alert administrator",
    ],
    recovery: "Update middleware firmware to compatible version.",
  },
  {
    id: "fw-config-corrupt",
    title: "Configuration Corruption",
    description: "Stored configuration is invalid or corrupted.",
    severity: "high",
    detection: "Config parse failure OR CRC mismatch",
    fallback: [
      "Load factory default configuration",
      "Request fresh configuration from Enexa cloud",
      "If cloud unavailable: use safe defaults",
      "Alert administrator for re-provisioning",
    ],
    recovery: "Re-provision site configuration from Enexa admin portal.",
  },
]

const dataQualityFailures: FailureScenario[] = [
  {
    id: "data-stale",
    title: "Stale Telemetry Data",
    description: "Received data has old timestamps, indicating sensor or comm issues.",
    severity: "medium",
    detection: "Data timestamp >30 seconds old",
    fallback: [
      "Mark affected readings as STALE",
      "Use last known good value with decay confidence",
      "Increase polling frequency to detect recovery",
      "Apply conservative control limits",
    ],
    recovery: "Resume normal operation when fresh data arrives.",
  },
  {
    id: "data-range",
    title: "Out-of-Range Sensor Values",
    description: "Sensor reporting physically impossible values.",
    severity: "medium",
    detection: "Value outside defined min/max bounds OR NaN/Inf",
    fallback: [
      "Reject invalid reading",
      "Use redundant sensor if available",
      "Otherwise use model-based estimate",
      "Flag for calibration check",
    ],
    recovery: "Sensor recalibration or replacement.",
  },
  {
    id: "data-conflict",
    title: "Conflicting Sensor Readings",
    description: "Multiple sensors for same measurement show significant disagreement.",
    severity: "high",
    detection: "Delta between redundant sensors >10% of range",
    fallback: [
      "Use median/average of non-outlier values",
      "Identify and exclude the outlier sensor",
      "Reduce control authority until resolved",
      "Alert for sensor maintenance",
    ],
    recovery: "Sensor alignment or replacement.",
  },
]

function ScenarioCard({ scenario }: { scenario: FailureScenario }) {
  const config = severityConfig[scenario.severity]
  
  return (
    <Card className={`border ${config.bgColor}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{scenario.title}</CardTitle>
            <CardDescription className="mt-1">{scenario.description}</CardDescription>
          </div>
          <Badge variant="outline" className={config.color}>
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
              <AlertCircle className="size-3.5 text-muted-foreground" />
              Detection
            </p>
            <p className="text-muted-foreground">{scenario.detection}</p>
            {scenario.timeout && (
              <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                <Timer className="size-3" />
                Response required within: {scenario.timeout}
              </p>
            )}
          </div>
          <div>
            <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
              <RefreshCw className="size-3.5 text-muted-foreground" />
              Recovery
            </p>
            <p className="text-muted-foreground">{scenario.recovery}</p>
          </div>
        </div>
        
        <Separator />
        
        <div>
          <p className="font-medium text-foreground mb-2 flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-green-600" />
            Fallback Actions (in order)
          </p>
          <ol className="space-y-1.5">
            {scenario.fallback.map((action, idx) => (
              <li key={idx} className="flex items-start gap-2 text-muted-foreground">
                <span className="flex-shrink-0 size-5 rounded-full bg-muted text-[10px] font-semibold flex items-center justify-center">
                  {idx + 1}
                </span>
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}

function ScenarioSection({ 
  title, 
  description, 
  icon: Icon, 
  scenarios 
}: { 
  title: string
  description: string
  icon: React.ElementType
  scenarios: FailureScenario[] 
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-4">
        {scenarios.map(scenario => (
          <ScenarioCard key={scenario.id} scenario={scenario} />
        ))}
      </div>
    </div>
  )
}

export function ExceptionHandlingScreen() {
  return (
    <div className="w-full py-8 px-6 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <ShieldAlert className="size-7 text-orange-500" />
          Exception Handling & Fallback Strategies
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          This document defines how the system should respond to various failure scenarios.
          The middleware is responsible for implementing these fallback behaviors to ensure
          safe, continuous operation even when components fail.
        </p>
      </div>

      {/* Severity Legend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Severity Levels</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-red-600">Critical</Badge>
              <span className="text-muted-foreground">Immediate action, safety risk</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-orange-600">High</Badge>
              <span className="text-muted-foreground">Urgent, degraded operation</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-yellow-600">Medium</Badge>
              <span className="text-muted-foreground">Can operate with workaround</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-blue-600">Low</Badge>
              <span className="text-muted-foreground">Minor impact, log and monitor</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Operating Modes */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="size-4" />
            Operating Modes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="p-4 rounded-lg bg-background border">
              <div className="flex items-center gap-2 font-semibold text-green-600 mb-2">
                <Cloud className="size-4" />
                CLOUD CONNECTED
              </div>
              <p className="text-muted-foreground">
                Normal operation. Enexa cloud sends optimized dispatch commands in real-time.
                Full telemetry reporting. All features enabled.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-background border">
              <div className="flex items-center gap-2 font-semibold text-yellow-600 mb-2">
                <CloudOff className="size-4" />
                LOCAL AUTONOMOUS
              </div>
              <p className="text-muted-foreground">
                Cloud unreachable. Middleware uses cached day-ahead schedule or falls back to
                reactive BMS rules. Buffers telemetry for later sync.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-background border">
              <div className="flex items-center gap-2 font-semibold text-red-600 mb-2">
                <ShieldAlert className="size-4" />
                SAFE STATE
              </div>
              <p className="text-muted-foreground">
                Critical failure or E-stop. All active operations stopped. Equipment held in
                safe configuration. Requires manual intervention.
              </p>
            </div>
          </div>
          
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
            <span className="font-medium text-green-600">CLOUD CONNECTED</span>
            <ArrowRight className="size-4" />
            <span className="font-medium text-yellow-600">LOCAL AUTONOMOUS</span>
            <ArrowRight className="size-4" />
            <span className="font-medium text-red-600">SAFE STATE</span>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            Degradation path: System progressively falls back to safer modes as failures accumulate
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Cloud & Connectivity */}
      <ScenarioSection
        title="Cloud Connectivity Failures"
        description="Loss of communication with Enexa cloud services"
        icon={CloudOff}
        scenarios={cloudFailures}
      />

      <Separator />

      {/* Middleware Failures */}
      <ScenarioSection
        title="Middleware Controller Failures"
        description="Issues with the local control box software or hardware"
        icon={ServerOff}
        scenarios={middlewareFailures}
      />

      <Separator />

      {/* Battery Failures */}
      <ScenarioSection
        title="Battery System Failures"
        description="Issues with battery, BMS, or energy storage components"
        icon={BatteryWarning}
        scenarios={batteryFailures}
      />

      <Separator />

      {/* Grid Failures */}
      <ScenarioSection
        title="Grid Connection Failures"
        description="Issues with utility grid connection or power quality"
        icon={ZapOff}
        scenarios={gridFailures}
      />

      <Separator />

      {/* EV Charger Failures */}
      <ScenarioSection
        title="EV Charger Failures"
        description="Issues with charging stations or vehicle communication"
        icon={Car}
        scenarios={evFailures}
      />

      <Separator />

      {/* Safety System Failures */}
      <ScenarioSection
        title="Safety System Events"
        description="Emergency stops and protective device activations"
        icon={ShieldAlert}
        scenarios={safetyFailures}
      />

      <Separator />

      {/* Data Quality Issues */}
      <ScenarioSection
        title="Data Quality Issues"
        description="Sensor failures, stale data, or measurement conflicts"
        icon={AlertCircle}
        scenarios={dataQualityFailures}
      />

      <Separator />

      {/* Cyber Security */}
      <ScenarioSection
        title="Cyber Security Incidents"
        description="Authentication failures, attacks, and unauthorized access"
        icon={ShieldAlert}
        scenarios={cyberSecurityFailures}
      />

      <Separator />

      {/* Firmware Issues */}
      <ScenarioSection
        title="Firmware & Configuration"
        description="Update failures, version mismatches, and configuration issues"
        icon={Server}
        scenarios={firmwareFailures}
      />

      <Separator />

      {/* Implementation Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="size-4 text-green-600" />
            Middleware Implementation Checklist
          </CardTitle>
          <CardDescription>
            Requirements for the Middleware to achieve robust exception handling
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-3">
              <h4 className="font-semibold">Hardware Requirements</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  Hardware watchdog timer (10s timeout)
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  Persistent storage for schedule cache (min 100MB)
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  Real-time clock with battery backup
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  Redundant network interfaces (LTE + Ethernet)
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  UPS for controller (min 5 minute runtime)
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold">Software Requirements</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  Telemetry ring buffer (min 24h at 1s resolution)
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  Reactive BMS algorithm implementation (fallback)
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  State machine for operating mode transitions
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  Structured logging with severity levels
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-600 mt-0.5 shrink-0" />
                  Alert notification system (local HMI + remote)
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Testing Requirements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="size-4 text-yellow-600" />
            Required Failure Injection Tests
          </CardTitle>
          <CardDescription>
            All scenarios must be tested before production deployment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              Before deploying the Middleware, Amperio must demonstrate successful handling of:
            </p>
            <ul className="grid md:grid-cols-2 gap-2 mt-3">
              <li className="flex items-center gap-2">
                <XCircle className="size-4 text-red-500" />
                Cloud disconnect for 1 hour (simulate network drop)
              </li>
              <li className="flex items-center gap-2">
                <XCircle className="size-4 text-red-500" />
                Middleware process kill and auto-restart
              </li>
              <li className="flex items-center gap-2">
                <XCircle className="size-4 text-red-500" />
                Battery BMS communication interruption
              </li>
              <li className="flex items-center gap-2">
                <XCircle className="size-4 text-red-500" />
                Grid power outage and island transition
              </li>
              <li className="flex items-center gap-2">
                <XCircle className="size-4 text-red-500" />
                E-stop activation and recovery sequence
              </li>
              <li className="flex items-center gap-2">
                <XCircle className="size-4 text-red-500" />
                Simultaneous multi-charger faults
              </li>
              <li className="flex items-center gap-2">
                <XCircle className="size-4 text-red-500" />
                Clock drift simulation (NTP block)
              </li>
              <li className="flex items-center gap-2">
                <XCircle className="size-4 text-red-500" />
                Memory exhaustion under load
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
