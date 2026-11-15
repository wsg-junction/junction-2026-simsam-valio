import { Leaf, MessageSquare, Monitor, Moon, MoreHorizontal, SquarePen, Sun, Trash2, Wallet, Workflow } from 'lucide-react';
import { useTheme } from 'next-themes';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { api, useLive } from './api';
import { chatStore, useChats } from './chats';

const SETTINGS = [
  { to: '/automations', label: 'Automations', icon: Workflow },
  { to: '/limits', label: 'Limits', icon: Wallet },
  { to: '/requirements', label: 'Requirements', icon: Leaf },
];

export function AssistantSidebar() {
  const chats = useChats();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const { data: attention } = useLive(api.attention, 8000);
  const urgent = attention?.filter((a) => a.tone !== 'info').length ?? 0;
  const close = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild>
              <NavLink
                to="/"
                onClick={close}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-700 text-sm font-bold text-white">
                  A
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Aimo Assistant</span>
                  <span className="text-muted-foreground truncate text-xs">Hotel Aurora Helsinki</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="New chat"
              isActive={pathname === '/'}>
              <NavLink
                to="/"
                onClick={close}>
                <SquarePen />
                <span>New chat</span>
              </NavLink>
            </SidebarMenuButton>
            {urgent > 0 && <SidebarMenuBadge className="rounded-full bg-amber-500 text-white">{urgent}</SidebarMenuBadge>}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Assistant settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SETTINGS.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.label}
                    isActive={pathname.startsWith(item.to)}>
                    <NavLink
                      to={item.to}
                      onClick={close}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {chats.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {chats.map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === `/c/${c.id}`}>
                      <NavLink
                        to={`/c/${c.id}`}
                        onClick={close}>
                        <MessageSquare className="opacity-60" />
                        <span>{c.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover>
                          <MoreHorizontal />
                          <span className="sr-only">More</span>
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="right"
                        align="start">
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            chatStore.remove(c.id);
                            if (pathname === `/c/${c.id}`) navigate('/');
                          }}>
                          <Trash2 />
                          Delete chat
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function UserMenu() {
  const { setTheme, theme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-2 py-1.5 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0">
          <Avatar className="size-7">
            <AvatarFallback className="bg-sky-500/15 text-[11px] font-semibold text-sky-700 dark:text-sky-300">MV</AvatarFallback>
          </Avatar>
          <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-medium">Maria Virtanen</span>
            <span className="text-muted-foreground truncate text-xs">Head Chef · demo data</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-56">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {[
          { v: 'light', label: 'Light', icon: Sun },
          { v: 'dark', label: 'Dark', icon: Moon },
          { v: 'system', label: 'System', icon: Monitor },
        ].map((t) => (
          <DropdownMenuItem
            key={t.v}
            onClick={() => setTheme(t.v)}>
            <t.icon />
            {t.label}
            {theme === t.v && <span className="text-muted-foreground ml-auto text-xs">On</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/app/">Open Agent Console</a>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => chatStore.clear()}>
          <Trash2 />
          Clear all chats
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
