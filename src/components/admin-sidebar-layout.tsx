"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  ChevronRight,
  GitFork,
  History,
  KeyRound,
  LogOut,
  MessageCircle,
  MessageCircleCode,
  MessageSquare,
  Search,
  Shield,
  Smartphone,
  UserCheck,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

interface AdminSidebarLayoutProps {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    role: string;
  };
}

const navigationGroups = [
  {
    group: "Overview",
    items: [
      { name: "Live Inbox", href: "/", icon: MessageSquare, exact: true },
      { name: "Customer Directory", href: "/customers", icon: Users },
      { name: "WhatsApp Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    group: "Channels & Automation",
    items: [
      { name: "WhatsApp Senders", href: "/admin/numbers", icon: Smartphone, badge: "Twilio Ready" },
      { name: "Routing Rules", href: "/admin/routing", icon: GitFork },
      { name: "Saved Replies", href: "/admin/replies", icon: MessageCircleCode },
      { name: "Webhook Diagnostics", href: "/admin/webhooks", icon: Activity },
    ],
  },
  {
    group: "Administration",
    items: [
      { name: "Team & Roles", href: "/admin/team", icon: UserCheck },
      { name: "Alert Settings", href: "/admin/alerts", icon: Bell },
      { name: "Audit Trail", href: "/admin/audit", icon: History },
      { name: "Data Retention", href: "/admin/privacy", icon: Shield },
      { name: "Account Security", href: "/account/security", icon: KeyRound },
    ],
  },
];

export function AdminSidebarLayout({ children, user }: AdminSidebarLayoutProps) {
  return (
    <SidebarProvider>
      <AdminSidebarFrame user={user}>{children}</AdminSidebarFrame>
    </SidebarProvider>
  );
}

function AdminSidebarFrame({ children, user }: AdminSidebarLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredGroups = useMemo(
    () => navigationGroups.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery)),
    })).filter((group) => group.items.length > 0),
    [normalizedQuery],
  );

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const userInitials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";
  const pageName = pathname.split("/").filter(Boolean).slice(-1)[0]
    ?.replaceAll("-", " ") || "Dashboard";

  return (
    <div className="flex min-h-svh w-full bg-background font-sans antialiased">
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-4">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label="Relay CRM home"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <MessageCircle className="size-5" />
            </span>
            <span className="grid min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">Relay CRM</span>
              <span className="truncate text-xs text-sidebar-foreground/65">Multi-Account Workspace</span>
            </span>
            <span className="size-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15 group-data-[collapsible=icon]:hidden" title="System live" />
          </Link>
          <label className="relative group-data-[collapsible=icon]:hidden">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/55" />
            <input
              aria-label="Search navigation"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search navigation..."
              className="h-9 w-full rounded-md border border-sidebar-border bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            />
          </label>
        </SidebarHeader>

        <SidebarContent className="gap-1 py-2">
          {filteredGroups.length > 0 ? filteredGroups.map((group) => (
            <SidebarGroup key={group.group} className="px-2 py-1">
              <SidebarGroupLabel className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/60">
                {group.group}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const active = "exact" in item && item.exact
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const Icon = item.icon;

                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.name}
                          className="h-9 px-2.5 text-sm text-sidebar-foreground/80 data-[active=true]:text-sidebar-accent-foreground"
                        >
                          <Link href={item.href} onClick={() => setOpenMobile(false)}>
                            <Icon />
                            <span>{item.name}</span>
                          </Link>
                        </SidebarMenuButton>
                        {"badge" in item && item.badge && (
                          <SidebarMenuBadge className="right-2 h-5 rounded-full border border-primary/15 bg-primary/5 px-2 text-[10px] font-medium text-primary">
                            {item.badge}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )) : (
            <p className="px-4 py-6 text-center text-sm text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
              No matching pages
            </p>
          )}
        </SidebarContent>

        <SidebarSeparator />
        <SidebarFooter className="p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" className="h-12 gap-3 px-2">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <span className="grid min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  <span className="truncate text-xs text-sidebar-foreground/60">{user.email}</span>
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px] capitalize group-data-[collapsible=icon]:hidden">
                  {user.role}
                </Badge>
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-60">
              <DropdownMenuLabel>
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/">
                  <MessageSquare />
                  Go to Inbox
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/account/security">
                  <KeyRound />
                  Account Security
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-svh min-w-0 overflow-x-hidden">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger aria-label="Toggle navigation" />
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Link href="/" className="hidden truncate text-muted-foreground hover:text-foreground sm:inline">Relay CRM</Link>
              <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
              <span className="truncate font-medium capitalize text-foreground">{pageName}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/">
                <MessageSquare />
                <span className="hidden sm:inline">Open Inbox</span>
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2 text-muted-foreground hover:text-foreground">
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </SidebarInset>
    </div>
  );
}
