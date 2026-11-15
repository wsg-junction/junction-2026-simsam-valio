import { BadgeCheck, Bot, Boxes, History, House, Package, Settings, SlidersHorizontal } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import type { Overview } from '@/lib/api';

const items = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/approvals', label: 'Approvals', icon: BadgeCheck, badge: true },
  { to: '/orders', label: 'Orders', icon: Package },
  { to: '/stock', label: 'Stock', icon: Boxes, stockBadge: true },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/rules', label: 'Rules', icon: SlidersHorizontal },
  { to: '/activity', label: 'Activity', icon: History },
];

export function AppSidebar({ overview }: { overview?: Overview }) {
  const { pathname } = useLocation();
  const isActive = (to: string, end?: boolean) => (end ? pathname === to : pathname.startsWith(to));
  const approver = overview?.mandate.approver ?? 'Maria Virtanen, Head Chef';
  const [name] = approver.split(', ');
  const pending = overview?.orderCounts.pending ?? 0;
  const stockAlerts = overview?.stockAlerts.length ?? 0;

  return (
    <Sidebar
      collapsible="icon"
      variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild>
              <NavLink to="/">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg font-bold">
                  A
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Valio Aimo</span>
                  <span className="text-muted-foreground truncate text-xs">{overview?.mandate.buyer ?? 'Agent Console'}</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.to, item.end)}
                    tooltip={item.label}>
                    <NavLink to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                  {item.stockBadge && stockAlerts > 0 && (
                    <SidebarMenuBadge className="bg-muted text-foreground rounded-full">{stockAlerts}</SidebarMenuBadge>
                  )}
                  {item.badge && pending > 0 && (
                    <SidebarMenuBadge className="bg-warning text-black rounded-full">{pending}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:hidden">
          <Avatar className="size-7 rounded-full">
            <AvatarFallback className="bg-primary/10 text-primary text-[11px] font-semibold">
              {name
                .split(' ')
                .map((p) => p[0])
                .join('')}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate text-sm">{name}</span>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            asChild
            aria-label="Settings">
            <NavLink to="/settings">
              <Settings />
            </NavLink>
          </Button>
        </div>
        <p className="text-muted-foreground px-1 text-[11px] group-data-[collapsible=icon]:hidden">
          Demo with synthetic data
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
