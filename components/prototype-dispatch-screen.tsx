"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  Target,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Zap,
  Battery,
  Car,
  Activity,
} from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

// Generate mock dispatch logs
function generateMockDispatchLogs() {
  const commands = [
    { type: "P_grid", description: "Grid power setpoint" },
    { type: "P_cp_lim", description: "EV charge limit" },
    { type: "soc_cp_max", description: "Battery SOC target" },
    { type: "charging_mode", description: "Charging mode" },
  ]
  
  const logs = []
  const now = Date.now()
  
  for (let i = 0; i < 50; i++) {
    const timestamp = new Date(now - i * 900000) // 15 min intervals
    const command = commands[Math.floor(Math.random() * commands.length)]
    const commanded = Math.round(Math.random() * 100000 - 50000)
    const actual = commanded + Math.round((Math.random() * 0.1 - 0.05) * commanded)
    const deviation = Math.abs(((actual - commanded) / commanded) * 100)
    const status = deviation < 2 ? "success" : deviation < 5 ? "warning" : "error"
    
    logs.push({
      id: `cmd-${i.toString().padStart(4, "0")}`,
      timestamp: timestamp.toISOString(),
      command_type: command.type,
      description: command.description,
      unit_id: Math.random() > 0.5 ? 1 : 2,
      commanded_value: commanded,
      actual_value: actual,
      deviation_pct: deviation,
      status,
      ack_latency_ms: Math.round(50 + Math.random() * 150),
      epex_price: 70 + Math.random() * 60,
      reason: command.type === "P_grid" 
        ? (commanded < 0 ? "Price arbitrage (high price)" : "SOC recovery (low price)")
        : command.type === "P_cp_lim"
          ? (commanded > 100000 ? "Fast charge requested" : "Load management")
          : "Schedule optimization",
    })
  }
  
  return logs
}

export function PrototypeDispatchScreen() {
  const [logs] = useState(generateMockDispatchLogs)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [commandFilter, setCommandFilter] = useState<string>("all")
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false
      if (commandFilter !== "all" && log.command_type !== commandFilter) return false
      if (searchQuery && !log.id.includes(searchQuery) && !log.reason.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
  }, [logs, statusFilter, commandFilter, searchQuery])

  const stats = useMemo(() => {
    const success = logs.filter(l => l.status === "success").length
    const warning = logs.filter(l => l.status === "warning").length
    const error = logs.filter(l => l.status === "error").length
    const avgLatency = logs.reduce((sum, l) => sum + l.ack_latency_ms, 0) / logs.length
    return { success, warning, error, avgLatency, total: logs.length }
  }, [logs])

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle2 className="size-4 text-green-500" />
      case "warning": return <AlertTriangle className="size-4 text-yellow-500" />
      case "error": return <XCircle className="size-4 text-red-500" />
      default: return <Clock className="size-4 text-muted-foreground" />
    }
  }

  const getCommandIcon = (type: string) => {
    switch (type) {
      case "P_grid": return <Zap className="size-4" />
      case "P_cp_lim": return <Car className="size-4" />
      case "soc_cp_max": return <Battery className="size-4" />
      case "charging_mode": return <Activity className="size-4" />
      default: return <Target className="size-4" />
    }
  }

  const formatValue = (type: string, value: number) => {
    if (type === "soc_cp_max") return `${value}%`
    if (type === "charging_mode") return ["Off", "Single", "Dual", "Disabled"][value] || value
    return `${(value / 1000).toFixed(1)} kW`
  }

  return (
    <div className="w-full py-8 px-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Target className="size-7 text-orange-500" />
          Dispatch Log & Verification
        </h1>
        <p className="text-muted-foreground">
          Command execution history and setpoint tracking
        </p>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Commands</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Target className="size-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Successful</p>
                <p className="text-2xl font-bold text-green-500">{stats.success}</p>
              </div>
              <CheckCircle2 className="size-8 text-green-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Warnings</p>
                <p className="text-2xl font-bold text-yellow-500">{stats.warning}</p>
              </div>
              <AlertTriangle className="size-8 text-yellow-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Errors</p>
                <p className="text-2xl font-bold text-red-500">{stats.error}</p>
              </div>
              <XCircle className="size-8 text-red-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Avg Latency</p>
                <p className="text-2xl font-bold">{stats.avgLatency.toFixed(0)} ms</p>
              </div>
              <Clock className="size-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input 
                placeholder="Search by command ID or reason..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <Filter className="size-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
            <Select value={commandFilter} onValueChange={setCommandFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Command Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Commands</SelectItem>
                <SelectItem value="P_grid">Grid Power</SelectItem>
                <SelectItem value="P_cp_lim">EV Charge Limit</SelectItem>
                <SelectItem value="soc_cp_max">SOC Target</SelectItem>
                <SelectItem value="charging_mode">Charging Mode</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Dispatch Log Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Command History</CardTitle>
          <CardDescription>Showing {filteredLogs.length} of {logs.length} commands</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Command</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Commanded</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Deviation</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.slice(0, 20).map((log) => (
                  <Collapsible key={log.id} asChild open={expandedRows.has(log.id)}>
                    <>
                      <TableRow 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleRow(log.id)}
                      >
                        <TableCell>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="size-6 p-0">
                              {expandedRows.has(log.id) ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {new Date(log.timestamp).toLocaleString("de-DE", {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getCommandIcon(log.command_type)}
                            <span className="font-mono text-xs">{log.command_type}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">Unit {log.unit_id}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatValue(log.command_type, log.commanded_value)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatValue(log.command_type, log.actual_value)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`font-mono text-sm ${
                            log.deviation_pct < 2 ? "text-green-500" : 
                            log.deviation_pct < 5 ? "text-yellow-500" : "text-red-500"
                          }`}>
                            {log.deviation_pct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(log.status)}
                            <span className="capitalize text-xs">{log.status}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      <CollapsibleContent asChild>
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-muted-foreground">Command ID</p>
                                <p className="font-mono">{log.id}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Ack Latency</p>
                                <p className="font-mono">{log.ack_latency_ms} ms</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">EPEX Price</p>
                                <p className="font-mono">{log.epex_price.toFixed(1)} EUR/MWh</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Reason</p>
                                <p>{log.reason}</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted-foreground">Showing 20 of {filteredLogs.length} entries</p>
            <Button variant="outline" size="sm">Load More</Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Command Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Latest Command Payload</CardTitle>
          <CardDescription>Most recent dispatch command sent to middleware</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
            <pre>{`{
  "timestamp": "${new Date().toISOString()}",
  "site_id": "site-001",
  "station": {
    "operation_mode": 1,
    "grid_mgmt_mode": 1,
    "P_grid_clearance_w": 87000
  },
  "chargers": [
    {
      "unit_id": 1,
      "charging_mode": 2,
      "P_grid_w": -30000,
      "P_cp_lim_w": 150000,
      "soc_cp_max_pct": 90
    },
    {
      "unit_id": 2,
      "charging_mode": 2,
      "P_grid_w": -30000,
      "P_cp_lim_w": 150000,
      "soc_cp_max_pct": 90
    }
  ]
}`}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
