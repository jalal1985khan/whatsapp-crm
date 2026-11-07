"use client";

import * as React from "react";
import { Activity, ArrowDownLeft, ArrowUpRight, CheckCheck, Clock3, MessageSquare, Phone, Users, Wifi } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DailyDataPoint = { date: string; dayLabel: string; inbound: number; outbound: number; deliveryRate: number };
export type MemberActivity = { id: string; name: string; email: string; role: string; team: string; assignedConversations: number; awaitingReply: number };
export type ChannelNumberSummary = { id: string; label: string; number: string; state: string; provider: string };
type Props = {
  isPostgres: boolean; dataError?: string | null;
  totalCustomers: number; totalConversations: number; totalMessages: number; inboundMessages: number; outboundMessages: number; deliveryRate: number | null;
  responseStats: { answered: number; medianMinutes: number | null; p95Minutes: number | null } | null;
  queueStats: { awaiting: number; under15m: number; under1h: number; under4h: number; over4h: number; oldestMinutes: number | null } | null;
  operations: { pendingWebhooks: number; oldestWebhookMinutes: number | null; outbound24Hours: number; confirmed24Hours: number; failed24Hours: number; failureRate: number | null; recentFailovers: { from: string; to: string; outcome: string; reason: string; createdAt: string }[] } | null;
  chartData: DailyDataPoint[]; members: MemberActivity[]; numbers: ChannelNumberSummary[];
};
const config = { inbound: { label: "Inbound", color: "var(--chart-2)" }, outbound: { label: "Outbound", color: "var(--chart-1)" } } satisfies ChartConfig;
const fmt = new Intl.NumberFormat("en-US");
function duration(value: number | null) { if (value == null) return "—"; if (value < 1) return String(Math.round(value * 60)) + " sec"; if (value < 60) return String(Math.round(value)) + " min"; return String(Math.floor(value / 60)) + "h " + String(Math.round(value % 60)) + "m"; }
function Metric({ title, value, detail, icon: Icon }: { title: string; value: string; detail: string; icon: React.ComponentType<{ className?: string }> }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-2 pb-2"><CardTitle className="text-sm font-medium">{title}</CardTitle><Icon className="size-4 text-muted-foreground" /></CardHeader><CardContent><p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground">{children}</div>; }

export function DashboardAnalytics({ isPostgres, dataError, totalCustomers, totalConversations, totalMessages, inboundMessages, outboundMessages, deliveryRate, responseStats, queueStats, operations, chartData, members, numbers }: Props) {
  const [range, setRange] = React.useState("7d");
  const chart = React.useMemo(() => {
    const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - (range === "today" ? 0 : range === "7d" ? 6 : 29));
    return chartData.filter((item) => new Date(item.date + "T23:59:59").getTime() >= cutoff.getTime());
  }, [chartData, range]);
  const totals = chart.reduce((sum, item) => ({ inbound: sum.inbound + item.inbound, outbound: sum.outbound + item.outbound }), { inbound: 0, outbound: 0 });
  function exportCsv() {
    const csv = [["Date", "Inbound", "Outbound", "Delivery rate (%)"], ...chart.map((row) => [row.date, String(row.inbound), String(row.outbound), row.deliveryRate.toFixed(1)])].map((row) => row.map((cell) => "\"" + cell.replaceAll("\"", "\"\"") + "\"").join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "whatsapp-crm-report-" + range + ".csv"; link.click(); URL.revokeObjectURL(url);
  }
  const configuredActive = numbers.filter((number) => number.state.toLowerCase() === "active").length;
  return <div className="mx-auto w-full max-w-7xl flex flex-col gap-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1"><div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">WhatsApp reports</h1><Badge variant={isPostgres ? "secondary" : "outline"}>{isPostgres ? "Live CRM data" : dataError ? "Data unavailable" : "Database required"}</Badge></div><p className="text-sm text-muted-foreground">Messaging volume, delivery health, reply times, and team workload.</p></div>
      <div className="flex flex-wrap items-center gap-2"><Tabs value={range} onValueChange={setRange}><TabsList><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="7d">7 days</TabsTrigger><TabsTrigger value="30d">30 days</TabsTrigger></TabsList></Tabs><Button variant="outline" onClick={exportCsv} disabled={!isPostgres || !chart.length}>Export CSV</Button></div>
    </header>
    {!isPostgres && <Alert variant="destructive"><Activity className="size-4" /><AlertTitle>Report data is unavailable</AlertTitle><AlertDescription>{dataError || "Connect the CRM database to view verified WhatsApp metrics. Sample values are not displayed."}</AlertDescription></Alert>}
    {dataError && isPostgres && <Alert variant="destructive"><Activity className="size-4" /><AlertTitle>Could not load CRM metrics</AlertTitle><AlertDescription>{dataError} No sample values are shown.</AlertDescription></Alert>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="WhatsApp message overview">
      <Metric title="Customers" value={isPostgres ? fmt.format(totalCustomers) : "—"} detail="Current CRM contacts" icon={Users} />
      <Metric title="Active conversations" value={isPostgres ? fmt.format(totalConversations) : "—"} detail="Open or waiting now" icon={MessageSquare} />
      <Metric title="Inbound messages" value={isPostgres ? fmt.format(totals.inbound) : "—"} detail={"Selected period · " + (range === "today" ? "today" : range)} icon={ArrowDownLeft} />
      <Metric title="Outbound messages" value={isPostgres ? fmt.format(totals.outbound) : "—"} detail={"Selected period · " + (range === "today" ? "today" : range)} icon={ArrowUpRight} />
      <Metric title="Delivery rate" value={!isPostgres || deliveryRate == null ? "—" : deliveryRate.toFixed(1) + "%"} detail={deliveryRate == null ? "No final outcomes recorded" : "Delivered/read message outcome"} icon={CheckCheck} />
    </section>
    <section className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2"><CardHeader className="flex flex-row items-start justify-between gap-3"><div className="flex flex-col gap-1"><CardTitle>Message activity</CardTitle><CardDescription>Inbound and outbound messages by day</CardDescription></div><Badge variant="outline">{range === "today" ? "Today" : "Last " + range}</Badge></CardHeader><CardContent>
        {isPostgres && chart.length ? <ChartContainer config={config} className="h-[300px] w-full"><BarChart accessibilityLayer data={chart}><CartesianGrid vertical={false} /><XAxis dataKey="dayLabel" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} /><ChartTooltip cursor={false} content={<ChartTooltipContent />} /><Bar dataKey="inbound" fill="var(--color-inbound)" radius={[4, 4, 0, 0]} /><Bar dataKey="outbound" fill="var(--color-outbound)" radius={[4, 4, 0, 0]} /></BarChart></ChartContainer> : <Empty>{isPostgres ? "No messages in this period." : "Connect the database to view message activity."}</Empty>}
        <p className="mt-3 text-xs text-muted-foreground">Inbound {fmt.format(isPostgres ? totals.inbound : 0)} · Outbound {fmt.format(isPostgres ? totals.outbound : 0)} · Total messages all time {fmt.format(isPostgres ? totalMessages : 0)}</p>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Response performance</CardTitle><CardDescription>First replies over the last 30 days</CardDescription></CardHeader><CardContent>{isPostgres && responseStats ? <div className="flex flex-col gap-4"><div><p className="text-xs text-muted-foreground">Conversations answered</p><p className="text-3xl font-semibold tabular-nums">{fmt.format(responseStats.answered)}</p></div><Separator /><div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-muted-foreground">Median first reply</p><p className="font-semibold tabular-nums">{duration(responseStats.medianMinutes)}</p></div><div><p className="text-xs text-muted-foreground">95th percentile</p><p className="font-semibold tabular-nums">{duration(responseStats.p95Minutes)}</p></div></div></div> : <Empty>Response metrics unavailable.</Empty>}</CardContent></Card>
    </section>
    <section className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-4" />Reply queue</CardTitle><CardDescription>Open or waiting conversations without a sent reply</CardDescription></CardHeader><CardContent>{isPostgres && queueStats ? <div className="flex flex-col gap-5"><div className="flex items-end justify-between"><div><p className="text-3xl font-semibold tabular-nums">{fmt.format(queueStats.awaiting)}</p><p className="text-xs text-muted-foreground">Awaiting reply</p></div><div className="text-right"><p className="font-medium">{duration(queueStats.oldestMinutes)}</p><p className="text-xs text-muted-foreground">Oldest wait</p></div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Under 15m", queueStats.under15m], ["15–60m", queueStats.under1h], ["1–4h", queueStats.under4h], ["Over 4h", queueStats.over4h]].map(([label, value]) => <div key={String(label)} className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{fmt.format(Number(value))}</p></div>)}</div></div> : <Empty>Queue metrics unavailable.</Empty>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4" />Delivery health</CardTitle><CardDescription>Provider outcomes over the last 24 hours</CardDescription></CardHeader><CardContent>{isPostgres && operations ? <div className="grid grid-cols-2 gap-3">{[["Outbound", operations.outbound24Hours], ["Confirmed delivered", operations.confirmed24Hours], ["Failed", operations.failed24Hours], ["Webhook backlog", operations.pendingWebhooks]].map(([label, value]) => <div key={String(label)} className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{fmt.format(Number(value))}</p></div>)}</div> : <Empty>Delivery metrics unavailable.</Empty>}</CardContent></Card>
    </section>
    <section className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2"><CardHeader><CardTitle>Team workload</CardTitle><CardDescription>Assigned conversations and conversations waiting for a reply.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead className="pl-6">Team member</TableHead><TableHead>Role and team</TableHead><TableHead className="text-right">Assigned</TableHead><TableHead className="pr-6 text-right">Awaiting reply</TableHead></TableRow></TableHeader><TableBody>{isPostgres && members.length ? members.map((member) => <TableRow key={member.id}><TableCell className="pl-6"><p className="font-medium">{member.name}</p><p className="text-xs text-muted-foreground">{member.email}</p></TableCell><TableCell>{member.role}<p className="text-xs text-muted-foreground">{member.team}</p></TableCell><TableCell className="text-right tabular-nums">{fmt.format(member.assignedConversations)}</TableCell><TableCell className="pr-6 text-right tabular-nums">{fmt.format(member.awaitingReply)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">{isPostgres ? "No assigned conversations." : "Team data unavailable."}</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Phone className="size-4" />WhatsApp senders</CardTitle><CardDescription>{configuredActive} active of {numbers.length} configured</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{isPostgres && numbers.length ? numbers.map((number) => <div key={number.id} className="flex items-center gap-3 rounded-md border p-3"><span className="flex size-8 items-center justify-center rounded-md bg-muted"><Wifi className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{number.label}</p><p className="truncate text-xs text-muted-foreground">{number.number} · {number.provider}</p></div><Badge variant={number.state.toLowerCase() === "active" ? "secondary" : "outline"}>{number.state}</Badge></div>) : <Empty>No WhatsApp senders available.</Empty>}</CardContent></Card>
    </section>
    {isPostgres && operations?.recentFailovers?.length ? <Card><CardHeader><CardTitle>Recent sender failovers</CardTitle><CardDescription>Recorded sender number transitions</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">{operations.recentFailovers.map((item, index) => <div key={item.createdAt + index} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div><span className="font-medium">{item.from}</span><span className="mx-2 text-muted-foreground">→</span><span className="font-medium">{item.to}</span><p className="text-xs text-muted-foreground">{item.reason}</p></div><div className="flex items-center gap-2"><Badge variant="outline">{item.outcome}</Badge><span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span></div></div>)}</CardContent></Card> : null}
    <p className="text-xs text-muted-foreground">Delivery rate is based on final confirmed and failed message outcomes. Pending provider statuses are not included.</p>
  </div>;
}
