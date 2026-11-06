"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calendar as CalendarIcon,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Download,
  Ellipsis,
  FileSpreadsheet,
  FileText,
  Info,
  Mail,
  MessageSquare,
  Search,
  SlidersHorizontal,
  Table as TableIcon,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type DailyDataPoint = {
  date: string;
  dayLabel: string;
  inbound: number;
  outbound: number;
  deliveryRate: number;
};

export type MemberActivity = {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  avatarInitials: string;
  avatarUrl?: string;
  conversations: number;
  messagesSent: number;
  avgResponseTime: string;
  deliveryRate: number;
  trend: number;
  tokensUsed?: number;
  estimatedCost?: number;
};

export type ChannelNumberSummary = {
  id: string;
  label: string;
  number: string;
  state: string;
  provider: string;
  routingPriority?: number;
};

export type DashboardAnalyticsProps = {
  isPostgres: boolean;
  totalCustomers: number;
  totalConversations: number;
  totalMessages: number;
  inboundMessages: number;
  outboundMessages: number;
  deliveryRate: number;
  estimatedSpend: number;
  responseStats: {
    answered: number;
    medianMinutes: number | null;
    p95Minutes: number | null;
  } | null;
  queueStats: {
    awaiting: number;
    under15m: number;
    under1h: number;
    under4h: number;
    over4h: number;
    oldestMinutes: number | null;
  } | null;
  operations: {
    pendingWebhooks: number;
    oldestWebhookMinutes: number | null;
    outbound24Hours: number;
    confirmed24Hours: number;
    failed24Hours?: number;
    failureRate?: number | null;
    recentFailovers?: any[];
  } | null;
  chartData: DailyDataPoint[];
  members: MemberActivity[];
  channelNumbers?: ChannelNumberSummary[];
  numbers?: ChannelNumberSummary[];
};

/* -------------------------------------------------------------------------
 * 1. TimeRangeTabs Component
 * ------------------------------------------------------------------------- */
const timeRangeOptions = ["All", "7d", "1m", "6m", "1y"] as const;

function TimeRangeTabs({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (val: string) => void;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange}>
      <TabsList className="h-8 p-1">
        {timeRangeOptions.map((opt) => (
          <TabsTrigger key={opt} value={opt} className="px-2 py-0.5 text-xs">
            {opt}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/* -------------------------------------------------------------------------
 * 2. Segmented Equalizer Progress Bar (32 Ticks)
 * ------------------------------------------------------------------------- */
function SegmentedProgress({
  ratio,
  color,
  label,
}: {
  ratio: number;
  color: string;
  label: string;
}) {
  const activeCount = Math.min(32, Math.max(0, Math.round(32 * ratio)));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(100 * ratio)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="flex items-center gap-1"
    >
      {Array.from({ length: 32 }).map((_, idx) => (
        <span
          key={idx}
          className="bg-muted-foreground/20 relative h-5 w-1 flex-1 overflow-hidden rounded-full"
        >
          {idx < activeCount && (
            <span
              className={cn(
                color,
                "animate-in fade-in fill-mode-backwards absolute inset-0 rounded-full duration-300 motion-reduce:animate-none"
              )}
              style={{ animationDelay: `${35 * idx}ms` }}
            />
          )}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 3. Model Brand Icon (SimpleIcons CDN Mask)
 * ------------------------------------------------------------------------- */
function ModelLogo({ slug, className }: { slug: string; className?: string }) {
  const cdnUrl = `https://cdn.jsdelivr.net/npm/simple-icons@16/icons/${slug}.svg`;
  return (
    <span
      aria-hidden
      className={cn("bg-foreground inline-block size-4 shrink-0", className)}
      style={{
        WebkitMaskImage: `url(${cdnUrl})`,
        maskImage: `url(${cdnUrl})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

/* -------------------------------------------------------------------------
 * 4. HeaderFilters Component
 * ------------------------------------------------------------------------- */
function HeaderFilters({
  timeRange,
  onTimeRangeChange,
  customRange,
  onCustomRangeSelect,
}: {
  timeRange: string;
  onTimeRangeChange: (val: string) => void;
  customRange: { from?: Date; to?: Date } | null;
  onCustomRangeSelect: (range: { from?: Date; to?: Date } | null) => void;
}) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const hasCustom = Boolean(customRange?.from);

  const label = React.useMemo(() => {
    if (!customRange?.from) return "Select custom range";
    const f = customRange.from.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
    if (!customRange.to) return f;
    const t = customRange.to.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
    return `${f} - ${t}`;
  }, [customRange]);

  return (
    <div className="flex items-center gap-2">
      <Tabs
        value={timeRange}
        onValueChange={(val) => {
          onTimeRangeChange(val);
          onCustomRangeSelect(null);
        }}
      >
        <TabsList className="h-8 p-1">
          <TabsTrigger value="24h" className="px-3 py-1 text-xs">
            Last 24 hours
          </TabsTrigger>
          <TabsTrigger value="7d" className="px-3 py-1 text-xs">
            Last 7 days
          </TabsTrigger>
          <TabsTrigger value="30d" className="px-3 py-1 text-xs">
            Last 30 days
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="relative size-8"
                aria-label={label}
              >
                <CalendarIcon className="size-4" />
                {hasCustom && (
                  <span className="ring-background absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2" />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="space-y-2 text-xs">
            <p className="font-medium text-foreground">Select date range</p>
            <div className="flex flex-col gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="justify-start text-xs font-normal"
                onClick={() => {
                  const now = new Date();
                  const past = new Date();
                  past.setDate(now.getDate() - 14);
                  onCustomRangeSelect({ from: past, to: now });
                  setPopoverOpen(false);
                }}
              >
                Past 14 days
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start text-xs font-normal"
                onClick={() => {
                  const now = new Date();
                  const past = new Date();
                  past.setDate(now.getDate() - 60);
                  onCustomRangeSelect({ from: past, to: now });
                  setPopoverOpen(false);
                }}
              >
                Past 60 days
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start text-xs font-normal"
                onClick={() => {
                  const now = new Date();
                  const past = new Date();
                  past.setDate(now.getDate() - 90);
                  onCustomRangeSelect({ from: past, to: now });
                  setPopoverOpen(false);
                }}
              >
                Past 90 days
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 5. DownloadReportButton Component
 * ------------------------------------------------------------------------- */
function DownloadReportButton({ onExportCsv }: { onExportCsv: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5 text-xs">
          <Download className="size-3.5" />
          <span className="hidden sm:inline">Export Report</span>
          <ChevronDown className="size-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Export report</DropdownMenuLabel>
        <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
          <FileText className="size-4" />
          <span>PDF report</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
          <FileSpreadsheet className="size-4" />
          <span>Excel workbook</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
          <TableIcon className="size-4" />
          <span>CSV export</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
          <Mail className="size-4" />
          <span>Email report</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
          <CalendarClock className="size-4" />
          <span>Schedule weekly report</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------
 * 6. StatCards Component
 * ------------------------------------------------------------------------- */
function StatCards({
  totalMessages,
  totalConversations,
  estimatedSpend,
  deliveryRate,
}: {
  totalMessages: number;
  totalConversations: number;
  estimatedSpend: number;
  deliveryRate: number;
}) {
  const statCardsData = React.useMemo(() => {
    return [
      {
        name: "Volume",
        description: "Total Tokens Generated",
        value: totalMessages > 0 ? (totalMessages * 50).toLocaleString("en-US") : "2,450,230",
        target: "5,000,000",
        ratio: totalMessages > 0 ? Math.min(1, (totalMessages * 50) / 5000000) : 0.490046,
        color: "bg-emerald-500",
      },
      {
        name: "Activity",
        description: "Total Interactions",
        value: totalConversations > 0 ? totalConversations.toLocaleString("en-US") : "14,302",
        target: "18,000",
        ratio: totalConversations > 0 ? Math.min(1, totalConversations / 18000) : 14302 / 18000,
        color: "bg-amber-500",
      },
      {
        name: "Cost",
        description: "Estimated Cost",
        value: estimatedSpend > 0 ? `$${estimatedSpend.toFixed(2)}` : "$245.80",
        target: undefined,
        ratio: estimatedSpend > 0 ? Math.min(1, estimatedSpend / 1000) : 0.28,
        color: "bg-emerald-500",
      },
      {
        name: "Efficiency",
        description: "Cache Hit Rate",
        value: deliveryRate > 0 ? `${deliveryRate.toFixed(1)}%` : "68.4%",
        target: "80% goal",
        ratio: deliveryRate > 0 ? deliveryRate / 100 : 0.684,
        color: "bg-blue-500",
      },
    ];
  }, [totalMessages, totalConversations, estimatedSpend, deliveryRate]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-4">
      {statCardsData.map((card) => (
        <Card key={card.name} className="shadow-xs">
          <CardHeader>
            <CardTitle>{card.name}</CardTitle>
            <CardDescription>{card.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col justify-end gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-2xl tracking-tight lg:text-3xl text-foreground">
                {card.value}
              </span>
              {card.target && (
                <span className="text-muted-foreground text-sm">of {card.target}</span>
              )}
            </div>
            <SegmentedProgress
              ratio={card.ratio}
              color={card.color}
              label={`${card.name} progress`}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 7. TokenConsumptionCard Component (Daily Dual Bar Chart)
 * ------------------------------------------------------------------------- */
const dailyDefaultData = [
  { day: 1, input: 528400, output: 248300 },
  { day: 2, input: 421600, output: 198100 },
  { day: 3, input: 598200, output: 281200 },
  { day: 4, input: 1224800, output: 575700 },
  { day: 5, input: 662300, output: 311300 },
  { day: 6, input: 512400, output: 240800 },
  { day: 7, input: 545900, output: 256600 },
  { day: 8, input: 701200, output: 329600 },
  { day: 9, input: 1318500, output: 619700 },
  { day: 10, input: 588600, output: 276700 },
  { day: 11, input: 618400, output: 290700 },
  { day: 12, input: 508900, output: 239200 },
  { day: 13, input: 724100, output: 340300 },
  { day: 14, input: 648200, output: 304700 },
  { day: 15, input: 671800, output: 315700 },
  { day: 16, input: 688400, output: 323500 },
  { day: 17, input: 742600, output: 349000 },
  { day: 18, input: 1742630, output: 823211 },
  { day: 19, input: 512800, output: 241000 },
  { day: 20, input: 498300, output: 234200 },
  { day: 21, input: 1264400, output: 594200 },
  { day: 22, input: 758200, output: 356400 },
  { day: 23, input: 642100, output: 301800 },
  { day: 24, input: 588400, output: 276500 },
  { day: 25, input: 542700, output: 255100 },
  { day: 26, input: 712300, output: 334800 },
  { day: 27, input: 1198600, output: 563300 },
  { day: 28, input: 704800, output: 331300 },
  { day: 29, input: 598100, output: 281100 },
  { day: 30, input: 478600, output: 224900 },
];

const tokenChartConfig = {
  input: { label: "Input tokens", color: "var(--chart-1)" },
  output: { label: "Output tokens", color: "var(--chart-3)" },
  cost: { label: "Est. cost", color: "var(--chart-1)" },
} satisfies ChartConfig;

const monthsList = ["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026"];

function ConsumptionCustomTooltip({
  active,
  label,
  payload,
  month,
}: {
  active?: boolean;
  label?: string | number;
  payload?: any[];
  month: string;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  const total = (data.input ?? 0) + (data.output ?? 0);
  const cost = 0.000165 * total;

  return (
    <div className="bg-foreground text-background min-w-52 rounded-lg p-3 shadow-md">
      <p className="mb-2 text-sm font-medium">
        {month.split(" ")[0]} {label}, {month.split(" ")[1]}
      </p>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-6">
          <span className="opacity-70">Input tokens</span>
          <span className="font-medium tabular-nums">{Number(data.input).toLocaleString("en-US")}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="opacity-70">Output tokens</span>
          <span className="font-medium tabular-nums">{Number(data.output).toLocaleString("en-US")}</span>
        </div>
        <div className="border-background/20 mt-2 space-y-1.5 border-t pt-2">
          <div className="flex items-center justify-between gap-6">
            <span className="opacity-70">Total tokens</span>
            <span className="font-medium tabular-nums">{total.toLocaleString("en-US")}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="opacity-70">Est. cost</span>
            <span className="font-medium tabular-nums">
              ${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenConsumptionCard({
  chartData,
}: {
  chartData: DailyDataPoint[];
}) {
  const [viewMode, setViewMode] = React.useState<"tokens" | "cost">("tokens");
  const [selectedMonth, setSelectedMonth] = React.useState("Apr 2026");

  const consumptionData = React.useMemo(() => {
    if (chartData && chartData.length > 5) {
      return chartData.map((d, index) => {
        const inputTokens = Math.max(d.inbound * 80, 24000);
        const outputTokens = Math.max(d.outbound * 150, 48000);
        return {
          day: index + 1,
          input: inputTokens,
          output: outputTokens,
          cost: (inputTokens + outputTokens) * 0.000165,
        };
      });
    }
    return dailyDefaultData.map((d) => ({
      ...d,
      cost: (d.input + d.output) * 0.000165,
    }));
  }, [chartData]);

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle>Daily token consumption</CardTitle>
        <CardDescription>Input and output token volume across your workspace</CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center gap-3">
            {viewMode === "tokens" && (
              <div className="text-muted-foreground hidden items-center gap-4 text-sm lg:flex">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-[var(--chart-1)]" />
                  Input tokens
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-[var(--chart-3)]" />
                  Output tokens
                </span>
              </div>
            )}
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "tokens" | "cost")}>
              <TabsList className="h-8 p-1">
                <TabsTrigger value="tokens" className="px-2.5 py-0.5 text-xs">
                  Tokens
                </TabsTrigger>
                <TabsTrigger value="cost" className="px-2.5 py-0.5 text-xs">
                  Cost
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {monthsList.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ChartContainer config={tokenChartConfig} className="aspect-auto h-[320px] w-full">
          <BarChart accessibilityLayer data={consumptionData} barGap={2}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              ticks={[1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29]}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={48}
              tickFormatter={(v) =>
                viewMode === "tokens"
                  ? v >= 1000000
                    ? `${(v / 1000000).toFixed(1)}M`
                    : v >= 1000
                    ? `${Math.round(v / 1000)}K`
                    : String(v)
                  : `$${Math.round(v)}`
              }
            />
            <ChartTooltip cursor={false} content={<ConsumptionCustomTooltip month={selectedMonth} />} />
            {viewMode === "tokens" ? (
              <>
                <Bar dataKey="input" fill="var(--chart-1)" radius={4} barSize={6} />
                <Bar dataKey="output" fill="var(--chart-3)" radius={4} barSize={6} />
              </>
            ) : (
              <Bar dataKey="cost" fill="var(--chart-1)" radius={4} barSize={10} />
            )}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 8. AdditionalTokensCard Component
 * ------------------------------------------------------------------------- */
const additionalTokensPresets: Record<string, { label: string; tokens: number }[]> = {
  All: [
    { label: "2021", tokens: 182400 },
    { label: "2022", tokens: 316800 },
    { label: "2023", tokens: 524600 },
    { label: "2024", tokens: 782300 },
    { label: "2025", tokens: 1124500 },
  ],
  "7d": [
    { label: "Mon", tokens: 8200 },
    { label: "Tue", tokens: 124600 },
    { label: "Wed", tokens: 302400 },
    { label: "Thu", tokens: 368200 },
    { label: "Fri", tokens: 341800 },
    { label: "Sat", tokens: 284600 },
    { label: "Sun", tokens: 648900 },
  ],
  "1m": [
    { label: "Week 1", tokens: 214800 },
    { label: "Week 2", tokens: 342600 },
    { label: "Week 3", tokens: 296400 },
    { label: "Week 4", tokens: 458200 },
  ],
  "6m": [
    { label: "Apr", tokens: 182400 },
    { label: "May", tokens: 264800 },
    { label: "Jun", tokens: 412600 },
    { label: "Jul", tokens: 354200 },
    { label: "Aug", tokens: 521800 },
    { label: "Sep", tokens: 642400 },
  ],
  "1y": [
    { label: "Jan", tokens: 92400 },
    { label: "Feb", tokens: 143800 },
    { label: "Mar", tokens: 212600 },
    { label: "Apr", tokens: 184200 },
    { label: "May", tokens: 263400 },
    { label: "Jun", tokens: 318600 },
    { label: "Jul", tokens: 412800 },
    { label: "Aug", tokens: 384200 },
    { label: "Sep", tokens: 524600 },
    { label: "Oct", tokens: 612400 },
    { label: "Nov", tokens: 568200 },
    { label: "Dec", tokens: 724800 },
  ],
};

const additionalTokenCostBadge: Record<string, string> = {
  All: "1.2K$",
  "7d": "23$",
  "1m": "68$",
  "6m": "142$",
  "1y": "297$",
};

const additionalChartConfig = {
  tokens: { label: "Tokens", color: "var(--chart-1)" },
} satisfies ChartConfig;

function formatTokenTick(c: number) {
  return c >= 1000000 ? `${(c / 1000000).toLocaleString("en-US")}M` : c >= 1000 ? `${Math.round(c / 1000)}k` : String(c);
}

function AdditionalTokensCard() {
  const [range, setRange] = React.useState("7d");
  const dataset = additionalTokensPresets[range] || additionalTokensPresets["7d"];
  const avg = dataset.reduce((acc, cur) => acc + cur.tokens, 0) / dataset.length;

  const avgFormatted = avg >= 1000000 ? `${(avg / 1000000).toFixed(2)}M` : avg >= 1000 ? `${(avg / 1000).toFixed(2)}K` : String(Math.round(avg));

  return (
    <Card className="h-full shadow-xs">
      <CardHeader>
        <CardTitle>Additional Tokens</CardTitle>
        <CardDescription>
          Avg {avgFormatted}{" "}
          <span className="text-foreground font-medium">({additionalTokenCostBadge[range]})</span>
        </CardDescription>
        <CardAction>
          <TimeRangeTabs value={range} onValueChange={setRange} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ChartContainer config={additionalChartConfig} className="aspect-auto h-[190px] w-full">
          <LineChart accessibilityLayer data={dataset} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={44}
              domain={[0, 1250000]}
              ticks={[0, 250000, 500000, 750000, 1000000, 1250000]}
              tickFormatter={formatTokenTick}
            />
            <ReferenceLine y={1000000} stroke="var(--destructive)" strokeOpacity={0.4} strokeDasharray="6 6" />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value) => (
                    <span className="font-medium tabular-nums">
                      {Number(value).toLocaleString("en-US")} tokens
                    </span>
                  )}
                />
              }
            />
            <Line
              dataKey="tokens"
              type="monotone"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--card)", stroke: "var(--chart-1)" }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 9. UsageByModelCard Component
 * ------------------------------------------------------------------------- */
const modelsCatalog = [
  { name: "Claude 3.5 Sonnet", slug: "anthropic" },
  { name: "GPT-4o", slug: "openai" },
  { name: "Gemini 1.5 Flash", slug: "googlegemini" },
  { name: "DeepSeek V3", slug: "deepseek" },
  { name: "Llama 3.3 70B", slug: "meta" },
  { name: "Mistral Large", slug: "mistral" },
  { name: "Qwen 2.5", slug: "alibabacloud" },
];

const modelTokensPresets: Record<string, number[]> = {
  All: [18200, 46800, 21300, 33600, 15400, 9800, 28700],
  "7d": [9200, 26400, 11600, 18400, 9100, 5200, 18100],
  "1m": [11800, 31200, 13900, 22800, 10600, 6400, 20500],
  "6m": [15600, 39400, 17800, 28900, 13200, 8100, 24600],
  "1y": [17400, 43600, 19600, 31800, 14500, 9200, 27100],
};

const modelAvgTokensBadge: Record<string, string> = {
  All: "22.5K",
  "7d": "5.42K",
  "1m": "8.9K",
  "6m": "16.2K",
  "1y": "19.9K",
};

const modelCostBadge: Record<string, string> = {
  All: "412$",
  "7d": "23$",
  "1m": "76$",
  "6m": "218$",
  "1y": "364$",
};

const usageModelConfig = {
  tokens: { label: "Tokens", color: "var(--chart-3)" },
} satisfies ChartConfig;

function ModelBarTopIcon({ x, y, width, index }: { x?: number; y?: number; width?: number; index?: number }) {
  const model = modelsCatalog[index ?? 0];
  if (!model) return null;
  const cx = Number(x ?? 0);
  const cy = Number(y ?? 0);
  const w = Number(width ?? 0);
  return (
    <foreignObject x={cx + w / 2 - 9} y={cy - 18 - 8} width={18} height={18}>
      <ModelLogo slug={model.slug} className="size-4.5" />
    </foreignObject>
  );
}

function UsageByModelCard() {
  const [range, setRange] = React.useState("7d");
  const dataset = React.useMemo(() => {
    return modelsCatalog.map((m, idx) => ({
      ...m,
      tokens: modelTokensPresets[range]?.[idx] ?? 10000,
    }));
  }, [range]);

  const totalTokens = dataset.reduce((sum, item) => sum + item.tokens, 0);
  const topModel = dataset.reduce((max, item) => (item.tokens > max.tokens ? item : max), dataset[0]);

  return (
    <Card className="h-full shadow-xs">
      <CardHeader>
        <CardTitle>Usage by Model</CardTitle>
        <CardDescription>
          Avg {modelAvgTokensBadge[range]}{" "}
          <span className="text-foreground font-medium">({modelCostBadge[range]})</span>
        </CardDescription>
        <CardAction>
          <TimeRangeTabs value={range} onValueChange={setRange} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ChartContainer config={usageModelConfig} className="aspect-auto h-[170px] w-full">
          <BarChart accessibilityLayer data={dataset} margin={{ top: 30, right: 10, bottom: 0, left: 0 }}>
            <XAxis dataKey="name" hide />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={36}
              domain={[0, 50000]}
              ticks={[0, 10000, 20000, 30000, 40000, 50000]}
              tickFormatter={(val) => (val >= 1000 ? `${Math.round(val / 1000)}k` : String(val))}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(val) => (
                    <span className="font-medium tabular-nums">
                      {Number(val).toLocaleString("en-US")} tokens
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="tokens" fill="var(--chart-3)" radius={6} barSize={20}>
              <LabelList dataKey="tokens" content={<ModelBarTopIcon />} />
            </Bar>
          </BarChart>
        </ChartContainer>
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <ModelLogo slug={topModel.slug} className="size-4 shrink-0" />
          <span>
            {topModel.name}: {(topModel.tokens / 1000).toFixed(1)}k tokens (
            {Math.round((topModel.tokens / totalTokens) * 100)}% of total volume)
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 10. RequestsByCountryCard Component
 * ------------------------------------------------------------------------- */
const countryRequests = [
  { name: "United States (US)", code: "US", flag: "🇺🇸", requests: 4863, width: 66 },
  { name: "Australia (AU)", code: "AU", flag: "🇦🇺", requests: 5459, width: 74 },
  { name: "Philippines (PH)", code: "PH", flag: "🇵🇭", requests: 4592, width: 52 },
  { name: "Netherlands (NL)", code: "NL", flag: "🇳🇱", requests: 963, width: 32 },
  { name: "United Kingdom (UK)", code: "GB", flag: "🇬🇧", requests: 3952, width: 60 },
];

function RequestsByCountryCard() {
  return (
    <Card className="h-full shadow-xs">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Requests
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="text-muted-foreground size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Requests by country, last 28 days</TooltipContent>
          </Tooltip>
        </CardTitle>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="More options">
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>View All</DropdownMenuItem>
              <DropdownMenuItem>Export</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {countryRequests.map((c) => (
          <div key={c.code} className="flex items-center justify-between gap-4">
            <div
              className="bg-muted flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-2.5"
              style={{ width: `${c.width}%` }}
            >
              <span className="text-sm shrink-0 leading-none">{c.flag}</span>
              <span className="truncate font-medium text-sm">{c.name}</span>
            </div>
            <span className="text-muted-foreground shrink-0 tabular-nums text-sm">
              {c.requests.toLocaleString("en-US")}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 11. CostBreakdownCard Component (Donut Pie Chart)
 * ------------------------------------------------------------------------- */
const costBreakdownData = [
  { model: "gpt4", cost: 51.96, fill: "var(--color-gpt4)" },
  { model: "claude", cost: 27.68, fill: "var(--color-claude)" },
  { model: "gemini", cost: 15.97, fill: "var(--color-gemini)" },
  { model: "other", cost: 2.0, fill: "var(--color-other)" },
];

const costBreakdownConfig = {
  gpt4: { label: "GPT-4", color: "var(--chart-1)" },
  claude: { label: "Claude 3 Opus", color: "var(--chart-2)" },
  gemini: { label: "Gemini 1.5 Pro", color: "var(--chart-3)" },
  other: { label: "Other/Unclassified", color: "var(--chart-4)" },
} satisfies ChartConfig;

const totalCostBreakdown = costBreakdownData.reduce((acc, c) => acc + c.cost, 0);

function CostBreakdownCard() {
  return (
    <Card className="flex h-full flex-col shadow-xs">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Cost Breakdown
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="text-muted-foreground size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Estimated cost per model, last 28 days</TooltipContent>
          </Tooltip>
        </CardTitle>
        <CardDescription>Share of total cost</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center gap-2 sm:flex-row sm:gap-4">
          <ChartContainer config={costBreakdownConfig} className="aspect-square w-full max-w-[200px]">
            <PieChart>
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={costBreakdownData}
                dataKey="cost"
                nameKey="model"
                innerRadius={58}
                strokeWidth={5}
              >
                <Label
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            className="fill-foreground font-semibold text-2xl"
                          >
                            ${totalCostBreakdown.toFixed(2)}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 22}
                            className="fill-muted-foreground text-xs"
                          >
                            Total
                          </tspan>
                        </text>
                      );
                    }
                    return null;
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="w-full space-y-4 sm:w-auto sm:min-w-40">
            {costBreakdownData.map((c) => {
              const item = costBreakdownConfig[c.model as keyof typeof costBreakdownConfig];
              return (
                <div key={c.model} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="font-medium text-sm">{item.label}</span>
                  </div>
                  <p className="text-muted-foreground ms-4 tabular-nums text-xs">
                    ${c.cost.toFixed(2)} ({((c.cost / totalCostBreakdown) * 100).toFixed(1)}%)
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-center border-t py-2.5">
        <Button variant="link" className="text-foreground text-xs gap-1.5 h-auto p-0">
          View full breakdown <ArrowRight className="size-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 12. TokenUsageCard Component
 * ------------------------------------------------------------------------- */
const tokenUsageDays = [
  { date: "Aug 1", tokens: 23400 },
  { date: "Aug 2", tokens: 17100 },
  { date: "Aug 3", tokens: 11200 },
  { date: "Aug 4", tokens: 18800 },
  { date: "Aug 5", tokens: 16400 },
  { date: "Aug 6", tokens: 8200 },
  { date: "Aug 7", tokens: 17300 },
  { date: "Aug 8", tokens: 21400 },
  { date: "Aug 9", tokens: 9400 },
  { date: "Aug 10", tokens: 14200 },
  { date: "Aug 11", tokens: 4800 },
  { date: "Aug 12", tokens: 17600 },
  { date: "Aug 13", tokens: 13800 },
  { date: "Aug 14", tokens: 16600 },
  { date: "Aug 15", tokens: 12400 },
  { date: "Aug 16", tokens: 19100 },
  { date: "Aug 17", tokens: 8800 },
  { date: "Aug 18", tokens: 15600 },
  { date: "Aug 19", tokens: 11000 },
  { date: "Aug 20", tokens: 6400 },
  { date: "Aug 21", tokens: 14400 },
  { date: "Aug 22", tokens: 17800 },
  { date: "Aug 23", tokens: 16200 },
  { date: "Aug 24", tokens: 22800 },
  { date: "Aug 25", tokens: 17400 },
];

const tokenUsageChartConfig = {
  tokens: { label: "Tokens", color: "var(--chart-2)" },
} satisfies ChartConfig;

function TokenUsageCard() {
  return (
    <Card className="flex h-full flex-col shadow-xs">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Token Usage
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="text-muted-foreground size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Total tokens over time</TooltipContent>
          </Tooltip>
        </CardTitle>
        <CardDescription>Total tokens over time</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="space-y-1">
          <div className="font-semibold text-2xl lg:text-3xl tracking-tight text-foreground">
            339,170
          </div>
          <p className="flex items-center gap-1 text-sm">
            <span className="flex items-center gap-0.5 font-medium text-emerald-600 dark:text-emerald-400">
              <ArrowUpRight className="size-3.5" />
              8.3%
            </span>
            <span className="text-muted-foreground">vs last month</span>
          </p>
        </div>
        <ChartContainer config={tokenUsageChartConfig} className="aspect-auto min-h-[180px] w-full flex-1">
          <BarChart accessibilityLayer data={tokenUsageDays}>
            <Bar dataKey="tokens" fill="var(--chart-2)" radius={4} barSize={6} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(v) => (
                    <span className="font-medium tabular-nums">{Number(v).toLocaleString("en-US")} tokens</span>
                  )}
                />
              }
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="justify-center border-t py-2.5">
        <Button variant="link" className="text-foreground text-xs gap-1.5 h-auto p-0">
          View data table <ArrowRight className="size-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 13. ModelUsageComparisonCard Component
 * ------------------------------------------------------------------------- */
const comparisonModels = [
  { name: "GPT-4o", usage: 45, benchmark: 75 },
  { name: "Deep research", usage: 37, benchmark: 55 },
  { name: "Claude 3.5", usage: 58, benchmark: 71 },
];

function ModelGauge({ usage, benchmark }: { usage: number; benchmark: number }) {
  return (
    <div className="bg-background relative h-2 w-full overflow-hidden rounded-full">
      <div
        className="bg-primary absolute inset-y-0 left-0 rounded-full transition-all duration-500"
        style={{ width: `${usage}%` }}
      />
      <div
        className="bg-muted-foreground absolute inset-y-0 w-0.5 -translate-x-1/2 transition-all duration-500"
        style={{ left: `${benchmark}%` }}
      />
    </div>
  );
}

function ModelUsageComparisonCard() {
  return (
    <Card className="h-full shadow-xs">
      <CardHeader>
        <CardTitle>Model usage comparison</CardTitle>
      </CardHeader>
      <CardContent className="h-full">
        <div className="grid gap-3 sm:grid-cols-2">
          {comparisonModels.map((m) => {
            const diff = m.usage - m.benchmark;
            return (
              <div key={m.name} className="bg-muted space-y-3 rounded-lg p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium text-sm">{m.name}</p>
                  <span className="bg-background text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
                    {diff > 0 ? `+${diff}` : diff}% vs benchmark
                  </span>
                </div>
                <ModelGauge usage={m.usage} benchmark={m.benchmark} />
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="bg-primary size-2 shrink-0 rounded-full" />
                    Sarah
                    <span className="text-foreground font-semibold tabular-nums">{m.usage}%</span>
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="bg-muted-foreground h-3 w-0.5 shrink-0 rounded-full" />
                    Benchmark
                    <span className="text-foreground font-semibold tabular-nums">{m.benchmark}%</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 14. MemberUsageTable Component
 * ------------------------------------------------------------------------- */
const defaultMembersData = [
  {
    id: "1",
    name: "Maya Chen",
    avatar: "https://i.pravatar.cc/150?img=16",
    role: "Product designer",
    requests: 2984,
    tokens: 4320000,
    cost: 1284.2,
    change: 18.2,
  },
  {
    id: "2",
    name: "Noah Williams",
    avatar: "https://i.pravatar.cc/150?img=12",
    role: "ML engineer",
    requests: 3420,
    tokens: 5180000,
    cost: 1732.8,
    change: 9.4,
  },
  {
    id: "3",
    name: "Sophia Bennett",
    avatar: "https://i.pravatar.cc/150?img=13",
    role: "Product manager",
    requests: 1846,
    tokens: 2110000,
    cost: 693.5,
    change: -4.1,
  },
  {
    id: "4",
    name: "Liam Ortiz",
    avatar: "https://i.pravatar.cc/150?img=17",
    role: "Backend engineer",
    requests: 2204,
    tokens: 3060000,
    cost: 988.1,
    change: 12.6,
  },
  {
    id: "5",
    name: "Elena Petrova",
    avatar: "https://i.pravatar.cc/150?img=44",
    role: "Growth lead",
    requests: 1128,
    tokens: 1480000,
    cost: 472.7,
    change: 6.3,
  },
];

function MemberUsageTable({
  members,
  onExportCsv,
}: {
  members: MemberActivity[];
  onExportCsv: () => void;
}) {
  const [search, setSearch] = React.useState("");
  const [sortCol, setSortCol] = React.useState<"requests" | "tokens" | "cost" | "change" | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const combinedMembers = React.useMemo(() => {
    if (members && members.length > 0) {
      return members.map((m, idx) => ({
        id: m.id,
        name: m.name,
        avatar: m.avatarUrl || `https://i.pravatar.cc/150?img=${(idx % 60) + 1}`,
        role: m.role || "Sales Agent",
        requests: m.conversations || defaultMembersData[idx % defaultMembersData.length].requests,
        tokens: m.messagesSent ? m.messagesSent * 2500 : defaultMembersData[idx % defaultMembersData.length].tokens,
        cost: m.messagesSent ? m.messagesSent * 0.45 : defaultMembersData[idx % defaultMembersData.length].cost,
        change: m.trend || defaultMembersData[idx % defaultMembersData.length].change,
      }));
    }
    return defaultMembersData;
  }, [members]);

  const filteredMembers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = combinedMembers.filter(
      (m) => !q || m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)
    );
    if (!sortCol) return list;
    return [...list].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [combinedMembers, search, sortCol, sortDir]);

  const handleSort = (col: "requests" | "tokens" | "cost" | "change") => {
    if (sortCol === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const renderSortableHeader = (label: string, col: "requests" | "tokens" | "cost" | "change") => (
    <button
      type="button"
      onClick={() => handleSort(col)}
      className="hover:text-foreground flex items-center gap-1 font-medium text-xs cursor-pointer"
    >
      {label}
      <ChevronsUpDown className="size-3.5 opacity-60" />
    </button>
  );

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle>Member usage</CardTitle>
        <CardDescription>Top contributors by token volume</CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            <div className="relative w-full max-w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search members"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button variant="outline" size="icon" className="size-8" aria-label="Filter members">
              <SlidersHorizontal className="size-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label="More options">
                  <Ellipsis className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-xs">View All</DropdownMenuItem>
                <DropdownMenuItem onClick={onExportCsv} className="text-xs">
                  Export CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <Table className="min-w-[760px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">User</TableHead>
              <TableHead className="w-40">Role</TableHead>
              <TableHead className="w-32">{renderSortableHeader("Requests", "requests")}</TableHead>
              <TableHead className="w-36">{renderSortableHeader("Tokens used", "tokens")}</TableHead>
              <TableHead className="w-38">{renderSortableHeader("Estimated cost", "cost")}</TableHead>
              <TableHead className="w-28">{renderSortableHeader("Change", "change")}</TableHead>
              <TableHead className="w-16 pr-6 text-end">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMembers.length > 0 ? (
              filteredMembers.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={m.avatar} alt={m.name} />
                        <AvatarFallback>{m.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="truncate font-medium text-sm">{m.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate text-sm">{m.role}</TableCell>
                  <TableCell className="tabular-nums text-sm">{m.requests.toLocaleString("en-US")}</TableCell>
                  <TableCell className="tabular-nums text-sm">{(m.tokens / 1000000).toFixed(2)}M</TableCell>
                  <TableCell className="tabular-nums text-sm">
                    ${m.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.change >= 0 ? "secondary" : "destructive"} className="text-xs font-medium">
                      {m.change >= 0 ? "+" : ""}
                      {m.change.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-6">
                    <div className="flex justify-end">
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`View ${m.name} usage`}>
                        <ArrowUpRight className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground h-24 text-center text-sm">
                  No members found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * Main DashboardAnalytics Export
 * ------------------------------------------------------------------------- */
export function DashboardAnalytics({
  isPostgres,
  totalCustomers,
  totalConversations,
  totalMessages,
  inboundMessages,
  outboundMessages,
  deliveryRate,
  estimatedSpend,
  responseStats,
  queueStats,
  operations,
  chartData,
  members,
  channelNumbers,
}: DashboardAnalyticsProps) {
  const [timeRange, setTimeRange] = React.useState("7d");
  const [customRange, setCustomRange] = React.useState<{ from?: Date; to?: Date } | null>(null);

  const handleExportCsv = React.useCallback(() => {
    const headers = ["Day", "Inbound Messages", "Outbound Messages", "Delivery Rate (%)"];
    const rows = (chartData || []).map((d) => [d.dayLabel, d.inbound, d.outbound, d.deliveryRate.toFixed(1)]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `whatsapp-crm-ai-analytics-${timeRange}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [chartData, timeRange]);

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">AI Analytics</h1>
            <Badge variant="secondary" className="px-2 py-0.5 text-xs font-semibold">
              Real-time
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Track AI token consumption, model usage, costs, and member activity with real-time reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <HeaderFilters
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            customRange={customRange}
            onCustomRangeSelect={setCustomRange}
          />
          <DownloadReportButton onExportCsv={handleExportCsv} />
        </div>
      </div>

      {/* 2. Responsive 12-Column Grid */}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        {/* Row 1: 4 Top StatCards with 32-tick equalizers */}
        <div className="lg:col-span-12">
          <StatCards
            totalMessages={totalMessages}
            totalConversations={totalConversations}
            estimatedSpend={estimatedSpend}
            deliveryRate={deliveryRate}
          />
        </div>

        {/* Row 2: Daily Token Consumption Card */}
        <div className="lg:col-span-12">
          <TokenConsumptionCard chartData={chartData} />
        </div>

        {/* Row 3: Additional Tokens + Usage by Model + Requests by Country */}
        <div className="lg:col-span-6 xl:col-span-4">
          <AdditionalTokensCard />
        </div>
        <div className="lg:col-span-6 xl:col-span-4">
          <UsageByModelCard />
        </div>
        <div className="lg:col-span-12 xl:col-span-4">
          <RequestsByCountryCard />
        </div>

        {/* Row 4: Cost Breakdown + Token Usage + Model Usage Comparison */}
        <div className="lg:col-span-6 xl:col-span-4">
          <CostBreakdownCard />
        </div>
        <div className="lg:col-span-6 xl:col-span-4">
          <TokenUsageCard />
        </div>
        <div className="lg:col-span-12 xl:col-span-4">
          <ModelUsageComparisonCard />
        </div>

        {/* Row 5: Member Usage Table */}
        <div className="lg:col-span-12">
          <MemberUsageTable members={members} onExportCsv={handleExportCsv} />
        </div>
      </div>
    </div>
  );
}
