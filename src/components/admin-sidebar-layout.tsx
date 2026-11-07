"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  ChevronRight,
  ExternalLink,
  GitFork,
  History,
  KeyRound,
  LogOut,
  Menu,
  MessageCircle,
  MessageCircleCode,
  MessageSquare,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface AdminSidebarLayoutProps {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    role: string;
  };
}

export function AdminSidebarLayout({ children, user }: AdminSidebarLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigationGroups = [
    {
      group: "Overview",
      items: [
        { name: "Live Inbox", href: "/", icon: MessageSquare, exact: true },
        { name: "Customer Directory", href: "/customers", icon: Users, exact: false },
        { name: "WhatsApp Reports", href: "/reports", icon: BarChart3, exact: false },
      ],
    },
    {
      group: "Channels & Automation",
      items: [
        {
          name: "WhatsApp Senders",
          href: "/admin/numbers",
          icon: Smartphone,
          exact: false,
          badge: "Twilio Ready",
        },
        { name: "Routing Rules", href: "/admin/routing", icon: GitFork, exact: false },
        { name: "Saved Replies", href: "/admin/replies", icon: MessageCircleCode, exact: false },
        { name: "Webhook Diagnostics", href: "/admin/webhooks", icon: Activity, exact: false },
      ],
    },
    {
      group: "Administration",
      items: [
        { name: "Team & Roles", href: "/admin/team", icon: UserCheck, exact: false },
        { name: "Alert Settings", href: "/admin/alerts", icon: Bell, exact: false },
        { name: "Audit Trail", href: "/admin/audit", icon: History, exact: false },
        { name: "Data Retention", href: "/admin/privacy", icon: Shield, exact: false },
        { name: "Account Security", href: "/account/security", icon: KeyRound, exact: false },
      ],
    },
  ];

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

  // Sidebar content component shared between desktop and mobile drawer
  const SidebarContent = (
    <div className="flex h-full flex-col bg-card">
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between border-b px-5">
        <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-90">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <MessageCircle className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-foreground">Relay CRM</span>
            <span className="text-[10px] font-medium text-muted-foreground">Multi-Account Workspace</span>
          </div>
        </Link>
        <span className="flex size-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" title="System Live" />
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navigationGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="space-y-1">
            <p className="px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {group.group}
            </p>
            <div className="mt-1 space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary font-semibold shadow-xs"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        className={cn(
                          "size-4 shrink-0 transition-colors",
                          isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )}
                      />
                      <span>{item.name}</span>
                    </div>
                    {item.badge && (
                      <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-semibold bg-primary/10 text-primary border-primary/20">
                        {item.badge}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* User Footer Profile */}
      <div className="border-t p-3 bg-muted/20">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted/60 transition-colors outline-none cursor-pointer"
            >
              <Avatar className="size-8 border">
                <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">{user.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">{user.email}</p>
              </div>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-medium shrink-0">
                {user.role}
              </Badge>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56" side="top">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-xs font-medium leading-none">{user.name}</p>
                <p className="text-[11px] leading-none text-muted-foreground">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/" className="cursor-pointer">
                <MessageSquare className="mr-2 size-4" />
                <span>Go to Inbox</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/security" className="cursor-pointer">
                <KeyRound className="mr-2 size-4" />
                <span>Account Security</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive focus:text-destructive">
              <LogOut className="mr-2 size-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background font-sans antialiased">
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r bg-card shadow-xs">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop & Sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] bg-card shadow-xl">
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 md:px-8 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label="Toggle Navigation Menu"
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Link href="/" className="hover:text-foreground">Relay CRM</Link>
              <ChevronRight className="size-3.5" />
              <span className="font-semibold text-foreground capitalize">
                {pathname.split("/").filter(Boolean).slice(-1)[0]?.replace("-", " ") || "Dashboard"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
                <MessageSquare className="size-3.5" />
                <span className="hidden sm:inline">Open Inbox</span>
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="gap-1 text-xs text-muted-foreground hover:text-foreground h-8"
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

