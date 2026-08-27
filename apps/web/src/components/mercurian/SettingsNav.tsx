import {
  ArchiveIcon,
  ArrowLeftIcon,
  BotIcon,
  CircleDotIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { useCallback, type ComponentType } from "react";

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar";
import {
  isSettingsSectionActive,
  visibleSettingsNavGroups,
  type SettingsSectionPath,
} from "./SettingsNav.logic";

const SECTION_ICONS: Readonly<Record<SettingsSectionPath, ComponentType<{ className?: string }>>> =
  {
    "/settings/trackers": CircleDotIcon,
    "/settings/providers": BotIcon,
    "/settings/preferences": SlidersHorizontalIcon,
    "/settings/archived": ArchiveIcon,
    "/settings/experiments": FlaskConicalIcon,
    "/settings/general": Settings2Icon,
    "/settings/appearance": PaletteIcon,
    "/settings/keybindings": KeyboardIcon,
    "/settings/source-control": GitBranchIcon,
    "/settings/connections": Link2Icon,
  };

/**
 * The panel the left sidebar yields to while you are in settings.
 *
 * Mercurian's sections and the fork's inherited ones are two groups rather
 * than one list, so what the design owns reads apart from what the fork
 * brought — without hiding anything that still works.
 */
export function SettingsNav({ pathname }: { readonly pathname: string }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();

  const goToSection = useCallback(
    (to: SettingsSectionPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to, hash: "", replace: true, hashScrollIntoView: false });
    },
    [isMobile, navigate, setOpenMobile],
  );

  // The same way out as the layout's Escape handler: back where you came
  // from, or the tree when settings is where you started.
  const leaveSettings = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, isMobile, navigate, setOpenMobile]);

  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        {visibleSettingsNavGroups(import.meta.env.DEV).map((group) => (
          <SidebarGroup key={group.label} className="gap-1 p-[var(--sidebar-content-inset)]">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.sections.map((section) => {
                const Icon = SECTION_ICONS[section.to];
                return (
                  <SidebarMenuItem key={section.to}>
                    <SidebarMenuButton
                      isActive={isSettingsSectionActive(pathname, section.to)}
                      onClick={() => goToSection(section.to)}
                    >
                      <Icon />
                      <span className="truncate">{section.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="p-[var(--sidebar-content-inset)]">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={leaveSettings}>
              <ArrowLeftIcon />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
