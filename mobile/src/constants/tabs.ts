/** The app's main tabs, shared by the native and web tab bars. */
export const TABS = [
  { name: 'index', label: 'Today', sf: 'flame.fill', md: 'local_fire_department' },
  { name: 'rigs', label: 'Rigs', sf: 'truck.box.fill', md: 'fire_truck' },
  { name: 'supplies', label: 'Supplies', sf: 'shippingbox.fill', md: 'inventory_2' },
  { name: 'schedule', label: 'Schedule', sf: 'person.3.fill', md: 'groups' },
  { name: 'calendar', label: 'Calendar', sf: 'calendar', md: 'calendar_month' },
] as const;
