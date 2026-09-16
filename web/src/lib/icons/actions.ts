import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
import Maximize2Icon from '@lucide/svelte/icons/maximize-2'
import MenuIcon from '@lucide/svelte/icons/menu'
import Minimize2Icon from '@lucide/svelte/icons/minimize-2'
import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close'
import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open'
import XIcon from '@lucide/svelte/icons/x'

export const actionIcons = {
  back: ArrowLeftIcon,
  close: XIcon,
  expand: Maximize2Icon,
  menu: MenuIcon,
  restore: Minimize2Icon,
  sidebarCollapse: PanelLeftCloseIcon,
  sidebarExpand: PanelLeftOpenIcon,
} as const
