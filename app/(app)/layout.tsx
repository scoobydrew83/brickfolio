import { AppShell } from '@/components/shell/AppShell';

/** Every app page: brand, nav and scan button. Shared pages (/share) use their own layout without them. */
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return <AppShell>{children}</AppShell>;
}
